"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth = void 0;
const path = require("path");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const custom_resources_1 = require("aws-cdk-lib/custom-resources");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const aws_events_targets_1 = require("aws-cdk-lib/aws-events-targets");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const constructs_1 = require("constructs");
const name_truncation_1 = require("../helpers/name-truncation");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
class Auth extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const stack = aws_cdk_lib_1.Stack.of(this);
        // Define DynamoDB Tables FIRST
        const leoAuth = new aws_dynamodb_1.Table(this, "LeoAuth", {
            tableName: aws_cdk_lib_1.Fn.join('-', [stack.stackName, id, 'LeoAuth', props.environmentName]),
            partitionKey: { name: "identity", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
        });
        this.leoAuthTable = leoAuth;
        const leoAuthUser = new aws_dynamodb_1.Table(this, "LeoAuthUser", {
            tableName: aws_cdk_lib_1.Fn.join('-', [stack.stackName, id, 'LeoAuthUser', props.environmentName]),
            partitionKey: { name: "identity_id", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
        });
        this.leoAuthUserTable = leoAuthUser;
        const leoAuthPolicy = new aws_dynamodb_1.Table(this, "LeoAuthPolicy", {
            tableName: aws_cdk_lib_1.Fn.join('-', [stack.stackName, id, 'LeoAuthPolicy', props.environmentName]),
            partitionKey: { name: "name", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            stream: aws_dynamodb_1.StreamViewType.NEW_IMAGE,
        });
        this.leoAuthPolicyTable = leoAuthPolicy;
        const leoAuthIdentity = new aws_dynamodb_1.Table(this, "LeoAuthIdentity", {
            tableName: aws_cdk_lib_1.Fn.join('-', [stack.stackName, id, 'LeoAuthIdentity', props.environmentName]),
            partitionKey: { name: "identity", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            sortKey: { name: "policy", type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            stream: aws_dynamodb_1.StreamViewType.KEYS_ONLY,
        });
        this.leoAuthIdentityTable = leoAuthIdentity;
        leoAuthIdentity.addGlobalSecondaryIndex({
            indexName: "policy-identity-id",
            partitionKey: { name: "policy", type: aws_dynamodb_1.AttributeType.STRING },
            sortKey: { name: "identity", type: aws_dynamodb_1.AttributeType.STRING },
            projectionType: aws_dynamodb_1.ProjectionType.KEYS_ONLY,
        });
        // Create a separate Managed Policy for DynamoDB access
        const dynamoAccessManagedPolicy = new aws_iam_1.ManagedPolicy(this, 'LeoAuthDynamoDbManagedPolicy', {
            managedPolicyName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'DynamoDbManagedPolicy', props.environmentName),
            description: 'Grants access to LeoAuth DynamoDB tables',
            document: new aws_iam_1.PolicyDocument({
                statements: [
                    new aws_iam_1.PolicyStatement({
                        actions: [
                            "dynamodb:PutItem", "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem",
                            "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:GetRecords",
                            "dynamodb:Query", "dynamodb:Scan", "dynamodb:GetShardIterator",
                            "dynamodb:DescribeStream", "dynamodb:ListStreams"
                        ],
                        resources: [
                            aws_cdk_lib_1.Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${stackName}-LeoAuth*', { stackName: aws_cdk_lib_1.Stack.of(this).stackName })
                        ],
                    })
                ]
            })
        });
        // Define LeoAuthRole AFTER tables, with an EMPTY managedPolicies array initially
        const leoAuthRole = new aws_iam_1.Role(this, "LeoAuthRole", {
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'LeoAuthRole', props.environmentName),
            assumedBy: new aws_iam_1.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [], // Start with empty array
            // NO inlinePolicies here
        });
        // Add explicit dependency to ensure policy is synthesized before attachment
        leoAuthRole.node.addDependency(dynamoAccessManagedPolicy);
        // Attach ALL managed policies AFTER the role is defined
        leoAuthRole.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
        leoAuthRole.addManagedPolicy(dynamoAccessManagedPolicy);
        const apiRoleAssumePolicy = new aws_iam_1.ServicePrincipal("lambda.amazonaws.com");
        const apiRole = new aws_iam_1.Role(this, "ApiRole", {
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'ApiRole', props.environmentName),
            assumedBy: apiRoleAssumePolicy,
            managedPolicies: [
                aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
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
        const normalizeDataLambda = new aws_lambda_nodejs_1.NodejsFunction(this, "NormalizeData", {
            functionName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'NormalizeData', props.environmentName),
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
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
            logRetention: aws_logs_1.RetentionDays.ONE_WEEK,
            timeout: aws_cdk_lib_1.Duration.minutes(1),
        });
        normalizeDataLambda.addEventSourceMapping("LeoAuthPolicyEventSource", {
            eventSourceArn: leoAuthPolicy.tableStreamArn,
            batchSize: 1,
            enabled: true,
            startingPosition: aws_lambda_1.StartingPosition.TRIM_HORIZON,
        });
        new aws_events_1.Rule(this, "ScheduleDataNormalization", {
            ruleName: aws_cdk_lib_1.Fn.join('-', [stack.stackName, id, 'ScheduleDataNormalizationRule', props.environmentName]),
            schedule: aws_events_1.Schedule.cron({ minute: "*" }),
            targets: [new aws_events_targets_1.LambdaFunction(normalizeDataLambda)],
        });
        const seedDatabaseLambda = new aws_lambda_nodejs_1.NodejsFunction(this, "SeedDatabase", {
            functionName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'SeedDatabase', props.environmentName),
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, "..", "..", "lambda", "auth", "seed-database", "index.js"),
            handler: "handler",
            environment,
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            role: leoAuthRole,
            bundling: {
                externalModules: [
                    'aws-sdk', 'leo-config', 'leo-aws', 'leo-logger'
                ],
                nodeModules: [],
                sourceMap: true,
            },
            logRetention: aws_logs_1.RetentionDays.ONE_WEEK,
        });
        const leoAuthManagedPolicy = new aws_iam_1.ManagedPolicy(this, "LeoAuthManagedPolicy", {
            managedPolicyName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'Policy', props.environmentName),
            description: 'Managed policy for Leo Auth permissions',
            statements: [
                new aws_iam_1.PolicyStatement({
                    sid: 'LeoAuthDynamoDBAccess',
                    actions: [
                        'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem',
                        'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:Query',
                        'dynamodb:UpdateItem'
                    ],
                    resources: [this.leoAuthTable.tableArn, this.leoAuthUserTable.tableArn]
                }),
            ],
        });
        this.leoAuthManagedPolicy = leoAuthManagedPolicy;
        const authorizeLambda = new aws_lambda_nodejs_1.NodejsFunction(this, "Authorize", {
            functionName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'Authorize', props.environmentName),
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
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
            logRetention: aws_logs_1.RetentionDays.ONE_WEEK,
            timeout: aws_cdk_lib_1.Duration.seconds(30),
        });
        authorizeLambda.grantInvoke(new aws_iam_1.ServicePrincipal("apigateway.amazonaws.com"));
        // Grant Secrets Manager Read Access
        if (props.secretArn) {
            const secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'AuthSecretResource', props.secretArn);
            secret.grantRead(apiRole);
        }
        else {
            // Grant broad secrets manager access if no specific ARN provided
            apiRole.addToPolicy(new aws_iam_1.PolicyStatement({
                sid: 'ReadSecretsGeneric',
                actions: ['secretsmanager:GetSecretValue'],
                resources: [`arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:*`]
            }));
        }
        const seedDatabaseProvider = new custom_resources_1.Provider(this, "SeedDatabaseProvider", {
            onEventHandler: seedDatabaseLambda,
            logRetention: aws_logs_1.RetentionDays.ONE_DAY,
        });
        new aws_cdk_lib_1.CustomResource(this, "CustomSeedDatabase", {
            serviceToken: seedDatabaseProvider.serviceToken,
        });
    }
}
exports.Auth = Auth;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBRTdCLG1EQUFxRDtBQUNyRCx1REFBd0Q7QUFDeEQsbUVBQXdEO0FBQ3hELHFFQUErRDtBQUMvRCx1RUFBZ0U7QUFDaEUsdURBQW1FO0FBQ25FLDJDQUF1QztBQUN2QyxnRUFBaUU7QUFFakUsMkRBT2tDO0FBQ2xDLGlEQVM2QjtBQUM3Qiw2Q0FNcUI7QUFDckIsaUVBQWlFO0FBWWpFLE1BQWEsSUFBSyxTQUFRLHNCQUFTO0lBUWpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBZ0I7UUFDeEQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEtBQUssR0FBRyxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU3QiwrQkFBK0I7UUFDL0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxvQkFBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDekMsU0FBUyxFQUFFLGdCQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDaEYsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDOUQsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztZQUNwQyxXQUFXLEVBQUUsMEJBQVcsQ0FBQyxlQUFlO1NBQ3pDLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDO1FBRTVCLE1BQU0sV0FBVyxHQUFHLElBQUksb0JBQUssQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2pELFNBQVMsRUFBRSxnQkFBRSxDQUFDLElBQUks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LGtCQUFrQjtZQUNsQyxZQUFZLEVBQUUsd0JBQWEsQ0FBQyxPQUFPO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksNEJBQWMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDN0MsWUFBWSxFQUFFLG9CQUFvQixDQUFDLFlBQVk7U0FDaEQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBMU9ELG9CQTBPQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBSdWxlLCBTY2hlZHVsZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgeyBQcm92aWRlciB9IGZyb20gXCJhd3MtY2RrLWxpYi9jdXN0b20tcmVzb3VyY2VzXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzXCI7XG5pbXBvcnQgeyBSdW50aW1lLCBTdGFydGluZ1Bvc2l0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IGNyZWF0ZVRydW5jYXRlZE5hbWUgfSBmcm9tICcuLi9oZWxwZXJzL25hbWUtdHJ1bmNhdGlvbic7XG5cbmltcG9ydCB7XG4gIFRhYmxlLFxuICBBdHRyaWJ1dGVUeXBlLFxuICBTdHJlYW1WaWV3VHlwZSxcbiAgUHJvamVjdGlvblR5cGUsXG4gIEJpbGxpbmdNb2RlLFxuICBJVGFibGUsXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7XG4gIFJvbGUsXG4gIElSb2xlLFxuICBTZXJ2aWNlUHJpbmNpcGFsLFxuICBBY2NvdW50Um9vdFByaW5jaXBhbCxcbiAgTWFuYWdlZFBvbGljeSxcbiAgUG9saWN5RG9jdW1lbnQsXG4gIFBvbGljeVN0YXRlbWVudCxcbiAgUG9saWN5LFxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHtcbiAgQ3VzdG9tUmVzb3VyY2UsXG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFjayxcbiAgRm4sXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlclwiO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgQXdzIH0gZnJvbSAnYXdzLWNkay1saWInO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1dGhQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZGVwbG95bWVudCBlbnZpcm9ubWVudCBuYW1lIChlLmcuLCBkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcbiAgc2VjcmV0QXJuPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aCBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBsZW9BdXRoVGFibGU6IElUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0F1dGhVc2VyVGFibGU6IElUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0F1dGhQb2xpY3lUYWJsZTogSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXV0aElkZW50aXR5VGFibGU6IElUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0F1dGhNYW5hZ2VkUG9saWN5OiBNYW5hZ2VkUG9saWN5O1xuICBwdWJsaWMgcmVhZG9ubHkgYXV0aG9yaXplTGFtYmRhUm9sZTogSVJvbGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEF1dGhQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCBzdGFjayA9IFN0YWNrLm9mKHRoaXMpO1xuXG4gICAgLy8gRGVmaW5lIER5bmFtb0RCIFRhYmxlcyBGSVJTVFxuICAgIGNvbnN0IGxlb0F1dGggPSBuZXcgVGFibGUodGhpcywgXCJMZW9BdXRoXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLCAnTGVvQXV0aCcsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiaWRlbnRpdHlcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgfSk7XG4gICAgdGhpcy5sZW9BdXRoVGFibGUgPSBsZW9BdXRoO1xuXG4gICAgY29uc3QgbGVvQXV0aFVzZXIgPSBuZXcgVGFibGUodGhpcywgXCJMZW9BdXRoVXNlclwiLCB7XG4gICAgICB0YWJsZU5hbWU6IEZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZCwgJ0xlb0F1dGhVc2VyJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJpZGVudGl0eV9pZFwiLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYmlsbGluZ01vZGU6IEJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICB9KTtcbiAgICB0aGlzLmxlb0F1dGhVc2VyVGFibGUgPSBsZW9BdXRoVXNlcjtcblxuICAgIGNvbnN0IGxlb0F1dGhQb2xpY3kgPSBuZXcgVGFibGUodGhpcywgXCJMZW9BdXRoUG9saWN5XCIsIHtcbiAgICAgIHRhYmxlTmFtZTogRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLCAnTGVvQXV0aFBvbGljeScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwibmFtZVwiLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYmlsbGluZ01vZGU6IEJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHN0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0lNQUdFLFxuICAgIH0pO1xuICAgIHRoaXMubGVvQXV0aFBvbGljeVRhYmxlID0gbGVvQXV0aFBvbGljeTtcblxuICAgIGNvbnN0IGxlb0F1dGhJZGVudGl0eSA9IG5ldyBUYWJsZSh0aGlzLCBcIkxlb0F1dGhJZGVudGl0eVwiLCB7XG4gICAgICB0YWJsZU5hbWU6IEZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZCwgJ0xlb0F1dGhJZGVudGl0eScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiaWRlbnRpdHlcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJwb2xpY3lcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBzdHJlYW06IFN0cmVhbVZpZXdUeXBlLktFWVNfT05MWSxcbiAgICB9KTtcbiAgICB0aGlzLmxlb0F1dGhJZGVudGl0eVRhYmxlID0gbGVvQXV0aElkZW50aXR5O1xuXG4gICAgbGVvQXV0aElkZW50aXR5LmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJwb2xpY3ktaWRlbnRpdHktaWRcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcInBvbGljeVwiLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiBcImlkZW50aXR5XCIsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogUHJvamVjdGlvblR5cGUuS0VZU19PTkxZLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgTWFuYWdlZCBQb2xpY3kgZm9yIER5bmFtb0RCIGFjY2Vzc1xuICAgIGNvbnN0IGR5bmFtb0FjY2Vzc01hbmFnZWRQb2xpY3kgPSBuZXcgTWFuYWdlZFBvbGljeSh0aGlzLCAnTGVvQXV0aER5bmFtb0RiTWFuYWdlZFBvbGljeScsIHtcbiAgICAgIG1hbmFnZWRQb2xpY3lOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdEeW5hbW9EYk1hbmFnZWRQb2xpY3knLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgZGVzY3JpcHRpb246ICdHcmFudHMgYWNjZXNzIHRvIExlb0F1dGggRHluYW1vREIgdGFibGVzJyxcbiAgICAgIGRvY3VtZW50OiBuZXcgUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6UHV0SXRlbVwiLCBcImR5bmFtb2RiOkJhdGNoV3JpdGVJdGVtXCIsIFwiZHluYW1vZGI6QmF0Y2hHZXRJdGVtXCIsXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6R2V0SXRlbVwiLCBcImR5bmFtb2RiOlVwZGF0ZUl0ZW1cIiwgXCJkeW5hbW9kYjpHZXRSZWNvcmRzXCIsXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6UXVlcnlcIiwgXCJkeW5hbW9kYjpTY2FuXCIsIFwiZHluYW1vZGI6R2V0U2hhcmRJdGVyYXRvclwiLFxuICAgICAgICAgICAgICBcImR5bmFtb2RiOkRlc2NyaWJlU3RyZWFtXCIsIFwiZHluYW1vZGI6TGlzdFN0cmVhbXNcIlxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgRm4uc3ViKCdhcm46YXdzOmR5bmFtb2RiOiR7QVdTOjpSZWdpb259OiR7QVdTOjpBY2NvdW50SWR9OnRhYmxlLyR7c3RhY2tOYW1lfS1MZW9BdXRoKicsXG4gICAgICAgICAgICAgICAgIHsgc3RhY2tOYW1lOiBTdGFjay5vZih0aGlzKS5zdGFja05hbWUgfVxuICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KVxuICAgICAgICBdXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIExlb0F1dGhSb2xlIEFGVEVSIHRhYmxlcywgd2l0aCBhbiBFTVBUWSBtYW5hZ2VkUG9saWNpZXMgYXJyYXkgaW5pdGlhbGx5XG4gICAgY29uc3QgbGVvQXV0aFJvbGUgPSBuZXcgUm9sZSh0aGlzLCBcIkxlb0F1dGhSb2xlXCIsIHtcbiAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdMZW9BdXRoUm9sZScsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwibGFtYmRhLmFtYXpvbmF3cy5jb21cIiksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtdLCAvLyBTdGFydCB3aXRoIGVtcHR5IGFycmF5XG4gICAgICAvLyBOTyBpbmxpbmVQb2xpY2llcyBoZXJlXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgZXhwbGljaXQgZGVwZW5kZW5jeSB0byBlbnN1cmUgcG9saWN5IGlzIHN5bnRoZXNpemVkIGJlZm9yZSBhdHRhY2htZW50XG4gICAgbGVvQXV0aFJvbGUubm9kZS5hZGREZXBlbmRlbmN5KGR5bmFtb0FjY2Vzc01hbmFnZWRQb2xpY3kpO1xuXG4gICAgLy8gQXR0YWNoIEFMTCBtYW5hZ2VkIHBvbGljaWVzIEFGVEVSIHRoZSByb2xlIGlzIGRlZmluZWRcbiAgICBsZW9BdXRoUm9sZS5hZGRNYW5hZ2VkUG9saWN5KE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcbiAgICApKTtcbiAgICBsZW9BdXRoUm9sZS5hZGRNYW5hZ2VkUG9saWN5KGR5bmFtb0FjY2Vzc01hbmFnZWRQb2xpY3kpO1xuXG4gICAgY29uc3QgYXBpUm9sZUFzc3VtZVBvbGljeSA9IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwibGFtYmRhLmFtYXpvbmF3cy5jb21cIik7XG4gICAgY29uc3QgYXBpUm9sZSA9IG5ldyBSb2xlKHRoaXMsIFwiQXBpUm9sZVwiLCB7XG4gICAgICByb2xlTmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsIGlkLCAnQXBpUm9sZScsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICBhc3N1bWVkQnk6IGFwaVJvbGVBc3N1bWVQb2xpY3ksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcbiAgICAgICAgKSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgdGhpcy5hdXRob3JpemVMYW1iZGFSb2xlID0gYXBpUm9sZTtcblxuICAgIGNvbnN0IHJlc291cmNlcyA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcmVnaW9uOiBzdGFjay5yZWdpb24sXG4gICAgICAgIExlb0F1dGg6IGxlb0F1dGgudGFibGVOYW1lLFxuICAgICAgICBMZW9BdXRoVXNlcjogbGVvQXV0aFVzZXIudGFibGVOYW1lLFxuICAgICAgICBMZW9BdXRoUG9saWN5OiBsZW9BdXRoUG9saWN5LnRhYmxlTmFtZSxcbiAgICAgICAgTGVvQXV0aElkZW50aXR5OiBsZW9BdXRoSWRlbnRpdHkudGFibGVOYW1lLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSB7XG4gICAgICBSZXNvdXJjZXM6IHJlc291cmNlcyxcbiAgICAgIExFT19FTlZJUk9OTUVOVDogcHJvcHMuZW52aXJvbm1lbnROYW1lLFxuICAgIH07XG5cbiAgICBjb25zdCBub3JtYWxpemVEYXRhTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiTm9ybWFsaXplRGF0YVwiLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ05vcm1hbGl6ZURhdGEnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uXCIsIFwiLi5cIiwgXCJsYW1iZGFcIiwgXCJhdXRoXCIsIFwibm9ybWFsaXplLWRhdGFcIiwgXCJpbmRleC5qc1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICByb2xlOiBsZW9BdXRoUm9sZSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgICAgICdhd3Mtc2RrJywgJ2xlby1jb25maWcnLCAnbGVvLWF3cycsICdsZW8tbG9nZ2VyJ1xuICAgICAgICAgIF0sXG4gICAgICAgICAgbm9kZU1vZHVsZXM6IFtdLFxuICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDEpLFxuICAgIH0pO1xuICAgIFxuICAgIG5vcm1hbGl6ZURhdGFMYW1iZGEuYWRkRXZlbnRTb3VyY2VNYXBwaW5nKFwiTGVvQXV0aFBvbGljeUV2ZW50U291cmNlXCIsIHtcbiAgICAgIGV2ZW50U291cmNlQXJuOiBsZW9BdXRoUG9saWN5LnRhYmxlU3RyZWFtQXJuISxcbiAgICAgIGJhdGNoU2l6ZTogMSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzdGFydGluZ1Bvc2l0aW9uOiBTdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTixcbiAgICB9KTtcbiAgICBcblxuICAgIG5ldyBSdWxlKHRoaXMsIFwiU2NoZWR1bGVEYXRhTm9ybWFsaXphdGlvblwiLCB7XG4gICAgICBydWxlTmFtZTogRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLCAnU2NoZWR1bGVEYXRhTm9ybWFsaXphdGlvblJ1bGUnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKSxcbiAgICAgIHNjaGVkdWxlOiBTY2hlZHVsZS5jcm9uKHsgbWludXRlOiBcIipcIiB9KSxcbiAgICAgIHRhcmdldHM6IFtuZXcgTGFtYmRhRnVuY3Rpb24obm9ybWFsaXplRGF0YUxhbWJkYSldLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2VlZERhdGFiYXNlTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiU2VlZERhdGFiYXNlXCIsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsIGlkLCAnU2VlZERhdGFiYXNlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLlwiLCBcIi4uXCIsIFwibGFtYmRhXCIsIFwiYXV0aFwiLCBcInNlZWQtZGF0YWJhc2VcIiwgXCJpbmRleC5qc1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIHJvbGU6IGxlb0F1dGhSb2xlLFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgJ2F3cy1zZGsnLCAnbGVvLWNvbmZpZycsICdsZW8tYXdzJywgJ2xlby1sb2dnZXInXG4gICAgICAgICAgXSxcbiAgICAgICAgICBub2RlTW9kdWxlczogW10sXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgICBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgfSk7XG5cbiAgICBjb25zdCBsZW9BdXRoTWFuYWdlZFBvbGljeSA9IG5ldyBNYW5hZ2VkUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgIFwiTGVvQXV0aE1hbmFnZWRQb2xpY3lcIixcbiAgICAgIHtcbiAgICAgICAgbWFuYWdlZFBvbGljeU5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ1BvbGljeScsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnTWFuYWdlZCBwb2xpY3kgZm9yIExlbyBBdXRoIHBlcm1pc3Npb25zJyxcbiAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgc2lkOiAnTGVvQXV0aER5bmFtb0RCQWNjZXNzJyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsICdkeW5hbW9kYjpCYXRjaFdyaXRlSXRlbScsICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLCAnZHluYW1vZGI6R2V0SXRlbScsICdkeW5hbW9kYjpTY2FuJywgJ2R5bmFtb2RiOlF1ZXJ5JyxcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sZW9BdXRoVGFibGUudGFibGVBcm4sIHRoaXMubGVvQXV0aFVzZXJUYWJsZS50YWJsZUFybl1cbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuICAgIHRoaXMubGVvQXV0aE1hbmFnZWRQb2xpY3kgPSBsZW9BdXRoTWFuYWdlZFBvbGljeTtcblxuICAgIGNvbnN0IGF1dGhvcml6ZUxhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhvcml6ZVwiLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ0F1dGhvcml6ZScsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi5cIiwgXCIuLlwiLCBcImxhbWJkYVwiLCBcImF1dGhcIiwgXCJhcGlcIiwgXCJhdXRob3JpemVcIiwgXCJpbmRleC5qc1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICByb2xlOiBhcGlSb2xlLFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgJ2F3cy1zZGsnLCAnbGVvLWNvbmZpZycsICdsZW8tYXV0aCdcbiAgICAgICAgICBdLFxuICAgICAgICAgIG5vZGVNb2R1bGVzOiBbXSxcbiAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICB9LFxuICAgICAgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgfSk7XG5cbiAgICBhdXRob3JpemVMYW1iZGEuZ3JhbnRJbnZva2UobmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIikpO1xuXG4gICAgLy8gR3JhbnQgU2VjcmV0cyBNYW5hZ2VyIFJlYWQgQWNjZXNzXG4gICAgaWYgKHByb3BzLnNlY3JldEFybikge1xuICAgICAgICBjb25zdCBzZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldENvbXBsZXRlQXJuKHRoaXMsICdBdXRoU2VjcmV0UmVzb3VyY2UnLCBwcm9wcy5zZWNyZXRBcm4pO1xuICAgICAgICBzZWNyZXQuZ3JhbnRSZWFkKGFwaVJvbGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEdyYW50IGJyb2FkIHNlY3JldHMgbWFuYWdlciBhY2Nlc3MgaWYgbm8gc3BlY2lmaWMgQVJOIHByb3ZpZGVkXG4gICAgICAgIGFwaVJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBzaWQ6ICdSZWFkU2VjcmV0c0dlbmVyaWMnLFxuICAgICAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06c2VjcmV0OipgXVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2VlZERhdGFiYXNlUHJvdmlkZXIgPSBuZXcgUHJvdmlkZXIodGhpcywgXCJTZWVkRGF0YWJhc2VQcm92aWRlclwiLCB7XG4gICAgICBvbkV2ZW50SGFuZGxlcjogc2VlZERhdGFiYXNlTGFtYmRhLFxuICAgICAgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9EQVksXG4gICAgfSk7XG5cbiAgICBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgXCJDdXN0b21TZWVkRGF0YWJhc2VcIiwge1xuICAgICAgc2VydmljZVRva2VuOiBzZWVkRGF0YWJhc2VQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==