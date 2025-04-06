import * as path from "path";
import * as cdk from 'aws-cdk-lib';
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { createTruncatedName } from '../helpers/name-truncation';

import {
  Table,
  AttributeType,
  StreamViewType,
  ProjectionType,
  BillingMode,
  ITable,
} from "aws-cdk-lib/aws-dynamodb";
import {
  Role,
  IRole,
  ServicePrincipal,
  AccountRootPrincipal,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Policy,
} from "aws-cdk-lib/aws-iam";
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  Fn,
} from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from 'aws-cdk-lib/aws-iam';
import { Aws } from 'aws-cdk-lib';

export interface AuthProps {
  /**
   * The deployment environment name (e.g., dev, staging, prod)
   */
  environmentName: string;
  secretArn?: string;
}

export class Auth extends Construct {
  public readonly leoAuthTable: ITable;
  public readonly leoAuthUserTable: ITable;
  public readonly leoAuthPolicyTable: ITable;
  public readonly leoAuthIdentityTable: ITable;
  public readonly leoAuthManagedPolicy: ManagedPolicy;
  public readonly authorizeLambdaRole: IRole;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // Define DynamoDB Tables FIRST
    const leoAuth = new Table(this, "LeoAuth", {
      tableName: Fn.join('-', [stack.stackName, id, 'LeoAuth', props.environmentName]),
      partitionKey: { name: "identity", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
    });
    this.leoAuthTable = leoAuth;

    const leoAuthUser = new Table(this, "LeoAuthUser", {
      tableName: Fn.join('-', [stack.stackName, id, 'LeoAuthUser', props.environmentName]),
      partitionKey: { name: "identity_id", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
    });
    this.leoAuthUserTable = leoAuthUser;

    const leoAuthPolicy = new Table(this, "LeoAuthPolicy", {
      tableName: Fn.join('-', [stack.stackName, id, 'LeoAuthPolicy', props.environmentName]),
      partitionKey: { name: "name", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,
    });
    this.leoAuthPolicyTable = leoAuthPolicy;

    const leoAuthIdentity = new Table(this, "LeoAuthIdentity", {
      tableName: Fn.join('-', [stack.stackName, id, 'LeoAuthIdentity', props.environmentName]),
      partitionKey: { name: "identity", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: "policy", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.KEYS_ONLY,
    });
    this.leoAuthIdentityTable = leoAuthIdentity;

    leoAuthIdentity.addGlobalSecondaryIndex({
      indexName: "policy-identity-id",
      partitionKey: { name: "policy", type: AttributeType.STRING },
      sortKey: { name: "identity", type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    // Create a separate Managed Policy for DynamoDB access
    const dynamoAccessManagedPolicy = new ManagedPolicy(this, 'LeoAuthDynamoDbManagedPolicy', {
      managedPolicyName: createTruncatedName(stack.stackName, id, 'DynamoDbManagedPolicy', props.environmentName),
      description: 'Grants access to LeoAuth DynamoDB tables',
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:PutItem", "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem",
              "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:GetRecords",
              "dynamodb:Query", "dynamodb:Scan", "dynamodb:GetShardIterator",
              "dynamodb:DescribeStream", "dynamodb:ListStreams"
            ],
            resources: [
               Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${stackName}-LeoAuth*',
                 { stackName: Stack.of(this).stackName }
               )
            ],
          })
        ]
      })
    });

    // Define LeoAuthRole AFTER tables, with an EMPTY managedPolicies array initially
    const leoAuthRole = new Role(this, "LeoAuthRole", {
      roleName: createTruncatedName(stack.stackName, id, 'LeoAuthRole', props.environmentName),
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [], // Start with empty array
      // NO inlinePolicies here
    });

    // Add explicit dependency to ensure policy is synthesized before attachment
    leoAuthRole.node.addDependency(dynamoAccessManagedPolicy);

    // Attach ALL managed policies AFTER the role is defined
    leoAuthRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName(
      "service-role/AWSLambdaBasicExecutionRole"
    ));
    leoAuthRole.addManagedPolicy(dynamoAccessManagedPolicy);

    const apiRoleAssumePolicy = new ServicePrincipal("lambda.amazonaws.com");
    const apiRole = new Role(this, "ApiRole", {
      roleName: createTruncatedName(stack.stackName, id, 'ApiRole', props.environmentName),
      assumedBy: apiRoleAssumePolicy,
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });
    this.authorizeLambdaRole = apiRole;

    const resources = JSON.stringify({
        region: stack.region,
        LeoAuth: leoAuth.tableName,
        LeoAuthUser: leoAuthUser.tableName,
        LeoAuthPolicy: leoAuthPolicy.tableName,
        LeoAuthIdentity: leoAuthIdentity.tableName,
    });

    const environment = {
      Resources: resources,
      LEO_ENVIRONMENT: props.environmentName,
    };

    const normalizeDataLambda = new NodejsFunction(this, "NormalizeData", {
      functionName: createTruncatedName(stack.stackName, id, 'NormalizeData', props.environmentName),
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "lambda", "auth", "normalize-data", "index.js"),
      handler: "handler",
      environment,
      role: leoAuthRole,
      bundling: {
          externalModules: [
              'aws-sdk', 'leo-config', 'leo-aws', 'leo-logger'
          ],
          nodeModules: [],
          sourceMap: true,
      },
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.minutes(1),
    });
    
    normalizeDataLambda.addEventSourceMapping("LeoAuthPolicyEventSource", {
      eventSourceArn: leoAuthPolicy.tableStreamArn!,
      batchSize: 1,
      enabled: true,
      startingPosition: StartingPosition.TRIM_HORIZON,
    });
    

    new Rule(this, "ScheduleDataNormalization", {
      ruleName: Fn.join('-', [stack.stackName, id, 'ScheduleDataNormalizationRule', props.environmentName]),
      schedule: Schedule.cron({ minute: "*" }),
      targets: [new LambdaFunction(normalizeDataLambda)],
    });

    const seedDatabaseLambda = new NodejsFunction(this, "SeedDatabase", {
      functionName: createTruncatedName(stack.stackName, id, 'SeedDatabase', props.environmentName),
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "lambda", "auth", "seed-database", "index.js"),
      handler: "handler",
      environment,
      timeout: Duration.seconds(30),
      role: leoAuthRole,
      bundling: {
          externalModules: [
              'aws-sdk', 'leo-config', 'leo-aws', 'leo-logger'
          ],
          nodeModules: [],
          sourceMap: true,
      },
       logRetention: RetentionDays.ONE_WEEK,
    });

    const leoAuthManagedPolicy = new ManagedPolicy(
      this,
      "LeoAuthManagedPolicy",
      {
        managedPolicyName: createTruncatedName(stack.stackName, id, 'Policy', props.environmentName),
        description: 'Managed policy for Leo Auth permissions',
        statements: [
          new PolicyStatement({
            sid: 'LeoAuthDynamoDBAccess',
            actions: [
              'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem',
              'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:Query',
              'dynamodb:UpdateItem'
            ],
            resources: [this.leoAuthTable.tableArn, this.leoAuthUserTable.tableArn]
          }),
        ],
      }
    );
    this.leoAuthManagedPolicy = leoAuthManagedPolicy;

    const authorizeLambda = new NodejsFunction(this, "Authorize", {
      functionName: createTruncatedName(stack.stackName, id, 'Authorize', props.environmentName),
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "lambda", "auth", "api", "authorize", "index.js"),
      handler: "handler",
      environment,
      role: apiRole,
      bundling: {
          externalModules: [
              'aws-sdk', 'leo-config', 'leo-auth'
          ],
          nodeModules: [],
          sourceMap: true,
      },
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(30),
    });

    authorizeLambda.grantInvoke(new ServicePrincipal("apigateway.amazonaws.com"));

    // Grant Secrets Manager Read Access
    if (props.secretArn) {
        const secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'AuthSecretResource', props.secretArn);
        secret.grantRead(apiRole);
    } else {
        // Grant broad secrets manager access if no specific ARN provided
        apiRole.addToPolicy(new PolicyStatement({
            sid: 'ReadSecretsGeneric',
            actions: ['secretsmanager:GetSecretValue'],
            resources: [`arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:*`]
        }));
    }

    const seedDatabaseProvider = new Provider(this, "SeedDatabaseProvider", {
      onEventHandler: seedDatabaseLambda,
      logRetention: RetentionDays.ONE_DAY,
    });

    new CustomResource(this, "CustomSeedDatabase", {
      serviceToken: seedDatabaseProvider.serviceToken,
    });
  }
}
