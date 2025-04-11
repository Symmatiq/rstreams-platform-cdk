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
            partitionKey: { name: "identity", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
        });
        this.leoAuthTable = leoAuth;
        const leoAuthUser = new aws_dynamodb_1.Table(this, "LeoAuthUser", {
            partitionKey: { name: "identity_id", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
        });
        this.leoAuthUserTable = leoAuthUser;
        const leoAuthPolicy = new aws_dynamodb_1.Table(this, "LeoAuthPolicy", {
            partitionKey: { name: "name", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            stream: aws_dynamodb_1.StreamViewType.NEW_IMAGE,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
        });
        this.leoAuthPolicyTable = leoAuthPolicy;
        const leoAuthIdentity = new aws_dynamodb_1.Table(this, "LeoAuthIdentity", {
            partitionKey: { name: "identity", type: aws_dynamodb_1.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            sortKey: { name: "policy", type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            stream: aws_dynamodb_1.StreamViewType.KEYS_ONLY,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
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
                            // Include table ARNs
                            aws_cdk_lib_1.Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${stackName}-LeoAuth*', { stackName: aws_cdk_lib_1.Stack.of(this).stackName }),
                            // Explicitly include stream ARNs
                            aws_cdk_lib_1.Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${stackName}-${id}-LeoAuthPolicy-${env}/stream/*', {
                                stackName: aws_cdk_lib_1.Stack.of(this).stackName,
                                id: id.toLowerCase(),
                                env: props.environmentName
                            }),
                            aws_cdk_lib_1.Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${stackName}-${id}-LeoAuthIdentity-${env}/stream/*', {
                                stackName: aws_cdk_lib_1.Stack.of(this).stackName,
                                id: id.toLowerCase(),
                                env: props.environmentName
                            })
                        ],
                    })
                ]
            })
        });
        // Define LeoAuthRole AFTER tables, with an EMPTY managedPolicies array initially
        const leoAuthRole = new aws_iam_1.Role(this, "LeoAuthRole", {
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
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, "..", "..", "lambda", "auth", "normalize-data", "index.js"),
            handler: "handler",
            environment,
            role: leoAuthRole,
            bundling: {
                externalModules: [],
                nodeModules: [
                    'leo-config', 'leo-aws', 'leo-logger'
                ],
                sourceMap: true,
            },
            logRetention: aws_logs_1.RetentionDays.ONE_WEEK,
            timeout: aws_cdk_lib_1.Duration.minutes(1),
        });
        // Explicitly grant access to the table and its stream
        leoAuthPolicy.grantStreamRead(normalizeDataLambda);
        leoAuthIdentity.grantStreamRead(normalizeDataLambda);
        normalizeDataLambda.addEventSourceMapping("LeoAuthPolicyEventSource", {
            eventSourceArn: leoAuthPolicy.tableStreamArn,
            batchSize: 1,
            enabled: true,
            startingPosition: aws_lambda_1.StartingPosition.TRIM_HORIZON,
        });
        // Add explicit dependency on the table to ensure stream is fully created
        normalizeDataLambda.node.addDependency(leoAuthPolicy);
        new aws_events_1.Rule(this, "ScheduleDataNormalization", {
            schedule: aws_events_1.Schedule.cron({ minute: "*" }),
            targets: [new aws_events_targets_1.LambdaFunction(normalizeDataLambda)],
        });
        const seedDatabaseLambda = new aws_lambda_nodejs_1.NodejsFunction(this, "SeedDatabase", {
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, "..", "..", "lambda", "auth", "seed-database", "index.js"),
            handler: "handler",
            environment,
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            role: leoAuthRole,
            bundling: {
                externalModules: [],
                nodeModules: [
                    'leo-config', 'leo-aws', 'leo-logger'
                ],
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
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, "..", "..", "lambda", "auth", "api", "authorize", "index.js"),
            handler: "handler",
            environment,
            role: apiRole,
            bundling: {
                externalModules: [],
                nodeModules: [
                    'leo-config', 'leo-auth'
                ],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBRTdCLG1EQUFxRDtBQUNyRCx1REFBd0Q7QUFDeEQsbUVBQXdEO0FBQ3hELHFFQUErRDtBQUMvRCx1RUFBZ0U7QUFDaEUsdURBQW1FO0FBQ25FLDJDQUF1QztBQUN2QyxnRUFBaUU7QUFFakUsMkRBT2tDO0FBQ2xDLGlEQVM2QjtBQUM3Qiw2Q0FNcUI7QUFDckIsaUVBQWlFO0FBWWpFLE1BQWEsSUFBSyxTQUFRLHNCQUFTO0lBUWpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBZ0I7UUFDeEQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEtBQUssR0FBRyxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU3QiwrQkFBK0I7UUFDL0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxvQkFBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDekMsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDOUQsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztZQUNwQyxXQUFXLEVBQUUsMEJBQVcsQ0FBQyxlQUFlO1lBQ3hDLGdDQUFnQyxFQUFFO2dCQUNoQywwQkFBMEIsRUFBRSxJQUFJO2FBQ2pDO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUM7UUFFNUIsTUFBTSxXQUFXLEdBQUcsSUFBSSxvQkFBSyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDakQsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FB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S0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN4RyxNQUFNLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzlCLENBQUM7YUFBTSxDQUFDO1lBQ0osaUVBQWlFO1lBQ2pFLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSx5QkFBZSxDQUFDO2dCQUNwQyxHQUFHLEVBQUUsb0JBQW9CO2dCQUN6QixPQUFPLEVBQUUsQ0FBQywrQkFBK0IsQ0FBQztnQkFDMUMsU0FBUyxFQUFFLENBQUMsMEJBQTBCLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sV0FBVyxDQUFDO2FBQ2xGLENBQUMsQ0FBQyxDQUFDO1FBQ1IsQ0FBQztRQUVELE1BQU0sb0JBQW9CLEdBQUcsSUFBSSwyQkFBUSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUN0RSxjQUFjLEVBQUUsa0JBQWtCO1lBQ2xDLFlBQVksRUFBRSx3QkFBYSxDQUFDLE9BQU87U0FDcEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSw0QkFBYyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM3QyxZQUFZLEVBQUUsb0JBQW9CLENBQUMsWUFBWTtTQUNoRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqUUQsb0JBaVFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IFJ1bGUsIFNjaGVkdWxlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCB7IFByb3ZpZGVyIH0gZnJvbSBcImF3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXNcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHNcIjtcbmltcG9ydCB7IFJ1bnRpbWUsIFN0YXJ0aW5nUG9zaXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgY3JlYXRlVHJ1bmNhdGVkTmFtZSB9IGZyb20gJy4uL2hlbHBlcnMvbmFtZS10cnVuY2F0aW9uJztcblxuaW1wb3J0IHtcbiAgVGFibGUsXG4gIEF0dHJpYnV0ZVR5cGUsXG4gIFN0cmVhbVZpZXdUeXBlLFxuICBQcm9qZWN0aW9uVHlwZSxcbiAgQmlsbGluZ01vZGUsXG4gIElUYWJsZSxcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHtcbiAgUm9sZSxcbiAgSVJvbGUsXG4gIFNlcnZpY2VQcmluY2lwYWwsXG4gIEFjY291bnRSb290UHJpbmNpcGFsLFxuICBNYW5hZ2VkUG9saWN5LFxuICBQb2xpY3lEb2N1bWVudCxcbiAgUG9saWN5U3RhdGVtZW50LFxuICBQb2xpY3ksXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQge1xuICBDdXN0b21SZXNvdXJjZSxcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxuICBGbixcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBBd3MgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aFByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBkZXBsb3ltZW50IGVudmlyb25tZW50IG5hbWUgKGUuZy4sIGRldiwgc3RhZ2luZywgcHJvZClcbiAgICovXG4gIGVudmlyb25tZW50TmFtZTogc3RyaW5nO1xuICBzZWNyZXRBcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBBdXRoIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0F1dGhUYWJsZTogSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXV0aFVzZXJUYWJsZTogSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXV0aFBvbGljeVRhYmxlOiBJVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9BdXRoSWRlbnRpdHlUYWJsZTogSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXV0aE1hbmFnZWRQb2xpY3k6IE1hbmFnZWRQb2xpY3k7XG4gIHB1YmxpYyByZWFkb25seSBhdXRob3JpemVMYW1iZGFSb2xlOiBJUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXV0aFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHN0YWNrID0gU3RhY2sub2YodGhpcyk7XG5cbiAgICAvLyBEZWZpbmUgRHluYW1vREIgVGFibGVzIEZJUlNUXG4gICAgY29uc3QgbGVvQXV0aCA9IG5ldyBUYWJsZSh0aGlzLCBcIkxlb0F1dGhcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiaWRlbnRpdHlcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xuICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5RW5hYmxlZDogdHJ1ZVxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmxlb0F1dGhUYWJsZSA9IGxlb0F1dGg7XG5cbiAgICBjb25zdCBsZW9BdXRoVXNlciA9IG5ldyBUYWJsZSh0aGlzLCBcIkxlb0F1dGhVc2VyXCIsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImlkZW50aXR5X2lkXCIsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IHtcbiAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IHRydWVcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5sZW9BdXRoVXNlclRhYmxlID0gbGVvQXV0aFVzZXI7XG5cbiAgICBjb25zdCBsZW9BdXRoUG9saWN5ID0gbmV3IFRhYmxlKHRoaXMsIFwiTGVvQXV0aFBvbGljeVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJuYW1lXCIsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgc3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfSU1BR0UsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xuICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5RW5hYmxlZDogdHJ1ZVxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmxlb0F1dGhQb2xpY3lUYWJsZSA9IGxlb0F1dGhQb2xpY3k7XG5cbiAgICBjb25zdCBsZW9BdXRoSWRlbnRpdHkgPSBuZXcgVGFibGUodGhpcywgXCJMZW9BdXRoSWRlbnRpdHlcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiaWRlbnRpdHlcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJwb2xpY3lcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBzdHJlYW06IFN0cmVhbVZpZXdUeXBlLktFWVNfT05MWSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7XG4gICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMubGVvQXV0aElkZW50aXR5VGFibGUgPSBsZW9BdXRoSWRlbnRpdHk7XG5cbiAgICBsZW9BdXRoSWRlbnRpdHkuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcInBvbGljeS1pZGVudGl0eS1pZFwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwicG9saWN5XCIsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwiaWRlbnRpdHlcIiwgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBQcm9qZWN0aW9uVHlwZS5LRVlTX09OTFksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYSBzZXBhcmF0ZSBNYW5hZ2VkIFBvbGljeSBmb3IgRHluYW1vREIgYWNjZXNzXG4gICAgY29uc3QgZHluYW1vQWNjZXNzTWFuYWdlZFBvbGljeSA9IG5ldyBNYW5hZ2VkUG9saWN5KHRoaXMsICdMZW9BdXRoRHluYW1vRGJNYW5hZ2VkUG9saWN5Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdHcmFudHMgYWNjZXNzIHRvIExlb0F1dGggRHluYW1vREIgdGFibGVzJyxcbiAgICAgIGRvY3VtZW50OiBuZXcgUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6UHV0SXRlbVwiLCBcImR5bmFtb2RiOkJhdGNoV3JpdGVJdGVtXCIsIFwiZHluYW1vZGI6QmF0Y2hHZXRJdGVtXCIsXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6R2V0SXRlbVwiLCBcImR5bmFtb2RiOlVwZGF0ZUl0ZW1cIiwgXCJkeW5hbW9kYjpHZXRSZWNvcmRzXCIsXG4gICAgICAgICAgICAgIFwiZHluYW1vZGI6UXVlcnlcIiwgXCJkeW5hbW9kYjpTY2FuXCIsIFwiZHluYW1vZGI6R2V0U2hhcmRJdGVyYXRvclwiLFxuICAgICAgICAgICAgICBcImR5bmFtb2RiOkRlc2NyaWJlU3RyZWFtXCIsIFwiZHluYW1vZGI6TGlzdFN0cmVhbXNcIlxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgLy8gSW5jbHVkZSB0YWJsZSBBUk5zXG4gICAgICAgICAgICAgICBGbi5zdWIoJ2Fybjphd3M6ZHluYW1vZGI6JHtBV1M6OlJlZ2lvbn06JHtBV1M6OkFjY291bnRJZH06dGFibGUvJHtzdGFja05hbWV9LUxlb0F1dGgqJyxcbiAgICAgICAgICAgICAgICAgeyBzdGFja05hbWU6IFN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSB9XG4gICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgLy8gRXhwbGljaXRseSBpbmNsdWRlIHN0cmVhbSBBUk5zXG4gICAgICAgICAgICAgICBGbi5zdWIoJ2Fybjphd3M6ZHluYW1vZGI6JHtBV1M6OlJlZ2lvbn06JHtBV1M6OkFjY291bnRJZH06dGFibGUvJHtzdGFja05hbWV9LSR7aWR9LUxlb0F1dGhQb2xpY3ktJHtlbnZ9L3N0cmVhbS8qJyxcbiAgICAgICAgICAgICAgICAgeyBcbiAgICAgICAgICAgICAgICAgICBzdGFja05hbWU6IFN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgICAgICBpZDogaWQudG9Mb3dlckNhc2UoKSxcbiAgICAgICAgICAgICAgICAgICBlbnY6IHByb3BzLmVudmlyb25tZW50TmFtZVxuICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgRm4uc3ViKCdhcm46YXdzOmR5bmFtb2RiOiR7QVdTOjpSZWdpb259OiR7QVdTOjpBY2NvdW50SWR9OnRhYmxlLyR7c3RhY2tOYW1lfS0ke2lkfS1MZW9BdXRoSWRlbnRpdHktJHtlbnZ9L3N0cmVhbS8qJyxcbiAgICAgICAgICAgICAgICAgeyBcbiAgICAgICAgICAgICAgICAgICBzdGFja05hbWU6IFN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSwgXG4gICAgICAgICAgICAgICAgICAgaWQ6IGlkLnRvTG93ZXJDYXNlKCksXG4gICAgICAgICAgICAgICAgICAgZW52OiBwcm9wcy5lbnZpcm9ubWVudE5hbWVcbiAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KVxuICAgICAgICBdXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIExlb0F1dGhSb2xlIEFGVEVSIHRhYmxlcywgd2l0aCBhbiBFTVBUWSBtYW5hZ2VkUG9saWNpZXMgYXJyYXkgaW5pdGlhbGx5XG4gICAgY29uc3QgbGVvQXV0aFJvbGUgPSBuZXcgUm9sZSh0aGlzLCBcIkxlb0F1dGhSb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW10sIC8vIFN0YXJ0IHdpdGggZW1wdHkgYXJyYXlcbiAgICAgIC8vIE5PIGlubGluZVBvbGljaWVzIGhlcmVcbiAgICB9KTtcblxuICAgIC8vIEFkZCBleHBsaWNpdCBkZXBlbmRlbmN5IHRvIGVuc3VyZSBwb2xpY3kgaXMgc3ludGhlc2l6ZWQgYmVmb3JlIGF0dGFjaG1lbnRcbiAgICBsZW9BdXRoUm9sZS5ub2RlLmFkZERlcGVuZGVuY3koZHluYW1vQWNjZXNzTWFuYWdlZFBvbGljeSk7XG5cbiAgICAvLyBBdHRhY2ggQUxMIG1hbmFnZWQgcG9saWNpZXMgQUZURVIgdGhlIHJvbGUgaXMgZGVmaW5lZFxuICAgIGxlb0F1dGhSb2xlLmFkZE1hbmFnZWRQb2xpY3koTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIlxuICAgICkpO1xuICAgIGxlb0F1dGhSb2xlLmFkZE1hbmFnZWRQb2xpY3koZHluYW1vQWNjZXNzTWFuYWdlZFBvbGljeSk7XG5cbiAgICBjb25zdCBhcGlSb2xlQXNzdW1lUG9saWN5ID0gbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKTtcbiAgICBjb25zdCBhcGlSb2xlID0gbmV3IFJvbGUodGhpcywgXCJBcGlSb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogYXBpUm9sZUFzc3VtZVBvbGljeSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBNYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIlxuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcbiAgICB0aGlzLmF1dGhvcml6ZUxhbWJkYVJvbGUgPSBhcGlSb2xlO1xuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICByZWdpb246IHN0YWNrLnJlZ2lvbixcbiAgICAgICAgTGVvQXV0aDogbGVvQXV0aC50YWJsZU5hbWUsXG4gICAgICAgIExlb0F1dGhVc2VyOiBsZW9BdXRoVXNlci50YWJsZU5hbWUsXG4gICAgICAgIExlb0F1dGhQb2xpY3k6IGxlb0F1dGhQb2xpY3kudGFibGVOYW1lLFxuICAgICAgICBMZW9BdXRoSWRlbnRpdHk6IGxlb0F1dGhJZGVudGl0eS50YWJsZU5hbWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHtcbiAgICAgIFJlc291cmNlczogcmVzb3VyY2VzLFxuICAgICAgTEVPX0VOVklST05NRU5UOiBwcm9wcy5lbnZpcm9ubWVudE5hbWUsXG4gICAgfTtcblxuICAgIGNvbnN0IG5vcm1hbGl6ZURhdGFMYW1iZGEgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgXCJOb3JtYWxpemVEYXRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLlwiLCBcIi4uXCIsIFwibGFtYmRhXCIsIFwiYXV0aFwiLCBcIm5vcm1hbGl6ZS1kYXRhXCIsIFwiaW5kZXguanNcIiksXG4gICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgIGVudmlyb25tZW50LFxuICAgICAgcm9sZTogbGVvQXV0aFJvbGUsXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW10sXG4gICAgICAgICAgbm9kZU1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgJ2xlby1jb25maWcnLCAnbGVvLWF3cycsICdsZW8tbG9nZ2VyJ1xuICAgICAgICAgIF0sXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgfSk7XG4gICAgXG4gICAgLy8gRXhwbGljaXRseSBncmFudCBhY2Nlc3MgdG8gdGhlIHRhYmxlIGFuZCBpdHMgc3RyZWFtXG4gICAgbGVvQXV0aFBvbGljeS5ncmFudFN0cmVhbVJlYWQobm9ybWFsaXplRGF0YUxhbWJkYSk7XG4gICAgbGVvQXV0aElkZW50aXR5LmdyYW50U3RyZWFtUmVhZChub3JtYWxpemVEYXRhTGFtYmRhKTtcbiAgICBcbiAgICBub3JtYWxpemVEYXRhTGFtYmRhLmFkZEV2ZW50U291cmNlTWFwcGluZyhcIkxlb0F1dGhQb2xpY3lFdmVudFNvdXJjZVwiLCB7XG4gICAgICBldmVudFNvdXJjZUFybjogbGVvQXV0aFBvbGljeS50YWJsZVN0cmVhbUFybiEsXG4gICAgICBiYXRjaFNpemU6IDEsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgc3RhcnRpbmdQb3NpdGlvbjogU3RhcnRpbmdQb3NpdGlvbi5UUklNX0hPUklaT04sXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQWRkIGV4cGxpY2l0IGRlcGVuZGVuY3kgb24gdGhlIHRhYmxlIHRvIGVuc3VyZSBzdHJlYW0gaXMgZnVsbHkgY3JlYXRlZFxuICAgIG5vcm1hbGl6ZURhdGFMYW1iZGEubm9kZS5hZGREZXBlbmRlbmN5KGxlb0F1dGhQb2xpY3kpO1xuICAgIFxuICAgIG5ldyBSdWxlKHRoaXMsIFwiU2NoZWR1bGVEYXRhTm9ybWFsaXphdGlvblwiLCB7XG4gICAgICBzY2hlZHVsZTogU2NoZWR1bGUuY3Jvbih7IG1pbnV0ZTogXCIqXCIgfSksXG4gICAgICB0YXJnZXRzOiBbbmV3IExhbWJkYUZ1bmN0aW9uKG5vcm1hbGl6ZURhdGFMYW1iZGEpXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNlZWREYXRhYmFzZUxhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBcIlNlZWREYXRhYmFzZVwiLCB7XG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi5cIiwgXCIuLlwiLCBcImxhbWJkYVwiLCBcImF1dGhcIiwgXCJzZWVkLWRhdGFiYXNlXCIsIFwiaW5kZXguanNcIiksXG4gICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgIGVudmlyb25tZW50LFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICByb2xlOiBsZW9BdXRoUm9sZSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXSxcbiAgICAgICAgICBub2RlTW9kdWxlczogW1xuICAgICAgICAgICAgICAnbGVvLWNvbmZpZycsICdsZW8tYXdzJywgJ2xlby1sb2dnZXInXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICB9LFxuICAgICAgIGxvZ1JldGVudGlvbjogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxlb0F1dGhNYW5hZ2VkUG9saWN5ID0gbmV3IE1hbmFnZWRQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgXCJMZW9BdXRoTWFuYWdlZFBvbGljeVwiLFxuICAgICAge1xuICAgICAgICBtYW5hZ2VkUG9saWN5TmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsIGlkLCAnUG9saWN5JywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdNYW5hZ2VkIHBvbGljeSBmb3IgTGVvIEF1dGggcGVybWlzc2lvbnMnLFxuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBzaWQ6ICdMZW9BdXRoRHluYW1vREJBY2Nlc3MnLFxuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hHZXRJdGVtJywgJ2R5bmFtb2RiOkJhdGNoV3JpdGVJdGVtJywgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlSXRlbScsICdkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOlNjYW4nLCAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbSdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb0F1dGhUYWJsZS50YWJsZUFybiwgdGhpcy5sZW9BdXRoVXNlclRhYmxlLnRhYmxlQXJuXVxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG4gICAgdGhpcy5sZW9BdXRoTWFuYWdlZFBvbGljeSA9IGxlb0F1dGhNYW5hZ2VkUG9saWN5O1xuXG4gICAgY29uc3QgYXV0aG9yaXplTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiQXV0aG9yaXplXCIsIHtcbiAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLlwiLCBcIi4uXCIsIFwibGFtYmRhXCIsIFwiYXV0aFwiLCBcImFwaVwiLCBcImF1dGhvcml6ZVwiLCBcImluZGV4LmpzXCIpLFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVyXCIsXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICAgIHJvbGU6IGFwaVJvbGUsXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW10sXG4gICAgICAgICAgbm9kZU1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgJ2xlby1jb25maWcnLCAnbGVvLWF1dGgnXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICB9LFxuICAgICAgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgfSk7XG5cbiAgICBhdXRob3JpemVMYW1iZGEuZ3JhbnRJbnZva2UobmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIikpO1xuXG4gICAgLy8gR3JhbnQgU2VjcmV0cyBNYW5hZ2VyIFJlYWQgQWNjZXNzXG4gICAgaWYgKHByb3BzLnNlY3JldEFybikge1xuICAgICAgICBjb25zdCBzZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldENvbXBsZXRlQXJuKHRoaXMsICdBdXRoU2VjcmV0UmVzb3VyY2UnLCBwcm9wcy5zZWNyZXRBcm4pO1xuICAgICAgICBzZWNyZXQuZ3JhbnRSZWFkKGFwaVJvbGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEdyYW50IGJyb2FkIHNlY3JldHMgbWFuYWdlciBhY2Nlc3MgaWYgbm8gc3BlY2lmaWMgQVJOIHByb3ZpZGVkXG4gICAgICAgIGFwaVJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBzaWQ6ICdSZWFkU2VjcmV0c0dlbmVyaWMnLFxuICAgICAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06c2VjcmV0OipgXVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2VlZERhdGFiYXNlUHJvdmlkZXIgPSBuZXcgUHJvdmlkZXIodGhpcywgXCJTZWVkRGF0YWJhc2VQcm92aWRlclwiLCB7XG4gICAgICBvbkV2ZW50SGFuZGxlcjogc2VlZERhdGFiYXNlTGFtYmRhLFxuICAgICAgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9EQVksXG4gICAgfSk7XG5cbiAgICBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgXCJDdXN0b21TZWVkRGF0YWJhc2VcIiwge1xuICAgICAgc2VydmljZVRva2VuOiBzZWVkRGF0YWJhc2VQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==