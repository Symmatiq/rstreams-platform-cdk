"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Botmon = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const nodejs = require("aws-cdk-lib/aws-lambda-nodejs");
const iam = require("aws-cdk-lib/aws-iam");
const s3 = require("aws-cdk-lib/aws-s3");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const cognito = require("aws-cdk-lib/aws-cognito");
const logs = require("aws-cdk-lib/aws-logs");
const path = require("path");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const sns = require("aws-cdk-lib/aws-sns");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const name_truncation_1 = require("../helpers/name-truncation");
class Botmon extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        this.props = props;
        const stack = cdk.Stack.of(this);
        // 1. Botmon API Gateway (RestApi)
        const api = new apigateway.RestApi(this, 'BotmonRestApi', {
            description: 'Botmon API',
            deployOptions: {
                stageName: props.environmentName,
                tracingEnabled: true,
                metricsEnabled: true,
            },
        });
        this.restApi = api;
        const apiRoot = api.root.addResource('api'); // Base path for API
        // LeoStats Table (Refined based on CFN)
        this.leoStatsTable = new dynamodb.Table(this, 'LeoStats', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'bucket', type: dynamodb.AttributeType.STRING }, // Corrected SK
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Added stream
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
        });
        // Add GSI
        this.leoStatsTable.addGlobalSecondaryIndex({
            indexName: 'period-time-index',
            partitionKey: { name: 'period', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'time', type: dynamodb.AttributeType.NUMBER },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['current'],
        });
        // 2. IAM Roles
        // LeoBotmonRole (Refined based on CFN)
        const leoBotmonRole = new iam.Role(this, 'LeoBotmonRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                props.bus.leoBotPolicy, // Import Bus policy
            ],
        });
        leoBotmonRole.addToPolicy(new iam.PolicyStatement({
            sid: 'LeoStatsAccess',
            actions: [
                'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'
            ],
            resources: [this.leoStatsTable.tableArn]
        }));
        // ApiRole (Refined based on CFN)
        const apiLambdaRole = new iam.Role(this, 'BotmonApiLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                props.bus.leoBotPolicy, // Import Bus policy
            ],
        });
        // Add each policy statement directly to the role
        apiLambdaRole.addToPolicy(new iam.PolicyStatement({
            sid: 'InvokeStackLambdas',
            actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
            resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:${stack.stackName}-*`]
        }));
        apiLambdaRole.addToPolicy(new iam.PolicyStatement({
            sid: 'ReadSecrets',
            actions: ['secretsmanager:GetSecretValue'],
            resources: [`arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:*`] // Scope down if possible
        }));
        apiLambdaRole.addToPolicy(new iam.PolicyStatement({
            sid: 'LeoStatsAccess',
            actions: [
                'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:UpdateItem',
                'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'
            ],
            resources: [this.leoStatsTable.tableArn]
        }));
        apiLambdaRole.addToPolicy(new iam.PolicyStatement({
            sid: 'FilterLogs',
            actions: ['logs:FilterLogEvents'],
            resources: [`arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/*:*`] // Scope down if possible
        }));
        // Grant Bus/Auth access (redundant if covered by imported managed policies, but explicit)
        props.bus.leoStreamTable.grantReadWriteData(apiLambdaRole);
        props.bus.leoArchiveTable.grantReadData(apiLambdaRole);
        props.bus.leoEventTable.grantReadWriteData(apiLambdaRole);
        props.bus.leoSettingsTable.grantReadWriteData(apiLambdaRole);
        props.bus.leoCronTable.grantReadWriteData(apiLambdaRole);
        props.bus.leoSystemTable.grantReadWriteData(apiLambdaRole);
        props.bus.leoKinesisStream.grantReadWrite(apiLambdaRole);
        props.bus.leoS3Bucket.grantRead(apiLambdaRole);
        props.auth.leoAuthTable.grantReadData(apiLambdaRole);
        props.auth.leoAuthUserTable.grantReadData(apiLambdaRole);
        // LeoBotmonSnsRole (Refined based on CFN)
        const leoBotmonSnsRole = new iam.Role(this, 'LeoBotmonSnsRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                props.bus.leoBotPolicy,
            ],
        });
        leoBotmonSnsRole.addToPolicy(new iam.PolicyStatement({
            sid: 'SNSPolicy',
            actions: [
                'sns:ListTopics', 'sns:ListSubscriptionsByTopic', 'sns:GetTopicAttributes',
                'sns:CreateTopic', 'sns:Subscribe', 'sns:Unsubscribe', 'sns:Publish' // Added Publish
            ],
            resources: ['*'] // Scope down if possible
        }));
        this.leoBotmonSnsRole = leoBotmonSnsRole;
        // 3. Botmon Lambda Functions (Update Roles)
        // Helper function defined INSIDE constructor or as a private method to access instance members
        const createBotmonLambda = (lambdaId, entryFilePathPart, // CHANGED: Expect path like 'system/get' or 'cron/save'
        role, additionalEnv, timeout = cdk.Duration.minutes(1), memorySize = 256, defineOptions) => {
            const stack = cdk.Stack.of(this);
            // Use a truncated function name format
            const functionName = (0, name_truncation_1.createTruncatedName)(stack.stackName, lambdaId, '', props.environmentName);
            // Use entryFilePathPart to build the full entry path
            const entryPath = path.resolve(`./lambda/botmon/${entryFilePathPart}/index.js`);
            const projectRootPath = path.resolve(`./`); // Main project root
            // Environment variable setup using this.props and this.leoStatsTable
            const leoSdkEnv = JSON.stringify({
                region: stack.region,
                resources: {
                    LeoStream: this.props.bus.leoStreamTable.tableName,
                    LeoArchive: this.props.bus.leoArchiveTable.tableName,
                    LeoEvent: this.props.bus.leoEventTable.tableName,
                    LeoSettings: this.props.bus.leoSettingsTable.tableName,
                    LeoSystem: this.props.bus.leoSystemTable.tableName,
                    LeoS3: this.props.bus.leoS3Bucket.bucketName,
                    LeoKinesisStream: this.props.bus.leoKinesisStream.streamName,
                    LeoFirehoseStream: this.props.bus.leoFirehoseStreamName,
                    Region: stack.region
                }
            });
            const leoAuthSdkEnv = JSON.stringify({
                region: stack.region,
                resources: {
                    LeoAuth: this.props.auth.leoAuthTable.tableName,
                    LeoAuthUser: this.props.auth.leoAuthUserTable.tableName,
                    Region: stack.region
                }
            });
            const leoSdkData = JSON.parse(leoSdkEnv);
            leoSdkData.resources.LeoStats = this.leoStatsTable.tableName; // Access instance member
            const updatedLeoSdkEnv = JSON.stringify(leoSdkData);
            return new nodejs.NodejsFunction(this, lambdaId, {
                functionName: functionName,
                entry: entryPath,
                handler: 'handler',
                runtime: lambda.Runtime.NODEJS_22_X,
                role: role,
                environment: {
                    ...(additionalEnv ?? {}),
                    Resources: JSON.stringify({ LeoStats: this.leoStatsTable.tableName }), // Access instance member
                    leosdk: updatedLeoSdkEnv,
                    leoauthsdk: leoAuthSdkEnv,
                    NODE_ENV: this.props.environmentName,
                    BUS_STACK_NAME: this.props.bus.busStackNameOutput,
                    NODE_OPTIONS: '--enable-source-maps',
                    AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                },
                timeout: timeout,
                memorySize: memorySize,
                logRetention: logs.RetentionDays.ONE_WEEK,
                projectRoot: projectRootPath,
                bundling: {
                    externalModules: [
                    // 'aws-sdk', // Removed AWS SDK v2 dependency
                    ],
                    nodeModules: [
                        'leo-sdk', // ADD leo-sdk as nodeModule for Botmon lambdas
                        'later' // Mark 'later' as nodeModule to avoid bundling issues
                    ],
                    sourceMap: true,
                    define: defineOptions
                },
            });
        };
        // --- System Lambdas --- 
        // Instantiate separate Lambdas for each action
        const systemSaveLambda = createBotmonLambda('SystemSaveApi', 'system/save', apiLambdaRole);
        const systemGetLambda = createBotmonLambda('SystemGetApi', 'system/get', apiLambdaRole);
        // const systemProxyLambda = createBotmonLambda('SystemProxyApi', 'system/proxy', apiLambdaRole); // If proxy is needed
        // System API Gateway Integrations (Update integrations)
        const systemResource = apiRoot.addResource('system');
        const systemIdResource = systemResource.addResource('{id}');
        // REINSTATE addCorsPreflight for /{id}
        systemIdResource.addCorsPreflight({
            allowMethods: ['GET', 'POST', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS, // Consider more specific headers if possible
            statusCode: 200
        });
        // THEN add actual methods
        // POST methods point to systemSaveLambda
        systemIdResource.addMethod('POST', new apigateway.LambdaIntegration(systemSaveLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        systemResource.addMethod('POST', new apigateway.LambdaIntegration(systemSaveLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        // GET method points to systemGetLambda
        systemIdResource.addMethod('GET', new apigateway.LambdaIntegration(systemGetLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        // Keep CORS for /system (covers its own POST)
        systemResource.addCorsPreflight({
            allowMethods: ['POST', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // --- EventSettings Lambdas --- 
        const eventSettingsGetLambda = createBotmonLambda('EventSettingsGetApi', 'eventSettings/get', apiLambdaRole);
        const eventSettingsSaveLambda = createBotmonLambda('EventSettingsSaveApi', 'eventSettings/save', apiLambdaRole); // Create Save lambda
        // EventSettings API Gateway Integrations
        const eventSettingsResource = apiRoot.addResource('eventsettings');
        const eventSettingsEventResource = eventSettingsResource.addResource('{event}');
        // Point GET methods to GetLambda
        eventSettingsEventResource.addMethod('GET', new apigateway.LambdaIntegration(eventSettingsGetLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        eventSettingsResource.addMethod('GET', new apigateway.LambdaIntegration(eventSettingsGetLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        // Add POST/PUT methods pointing to SaveLambda (if they exist in original CFN - assuming they might based on CORS)
        // TODO: Verify if POST/PUT are actually needed/used for /eventsettings and /eventsettings/{event}
        eventSettingsResource.addMethod('POST', new apigateway.LambdaIntegration(eventSettingsSaveLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        eventSettingsEventResource.addMethod('PUT', new apigateway.LambdaIntegration(eventSettingsSaveLambda), { authorizationType: apigateway.AuthorizationType.IAM }); // Assuming PUT is on /{event}
        // Add CORS (Can potentially combine these if allowMethods match)
        eventSettingsEventResource.addCorsPreflight({
            allowMethods: ['GET', 'PUT', 'OPTIONS'], // Updated methods 
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        eventSettingsResource.addCorsPreflight({
            allowMethods: ['GET', 'POST', 'OPTIONS'], // Updated methods
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // Queues endpoint (uses EventSettingsGetApi - CORRECT, points to Get Lambda)
        const queuesResource = apiRoot.addResource('queues');
        queuesResource.addMethod('GET', new apigateway.LambdaIntegration(eventSettingsGetLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        queuesResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // --- Dashboard Lambda --- (Assuming 'dashboard' directory has index.js)
        const dashboardLambda = createBotmonLambda('DashboardApi', 'dashboard', apiLambdaRole);
        const dashboardResource = apiRoot.addResource('dashboard');
        const dashboardTypeResource = dashboardResource.addResource('{type}');
        const dashboardTypeIdResource = dashboardTypeResource.addResource('{id}');
        dashboardTypeIdResource.addMethod('GET', new apigateway.LambdaIntegration(dashboardLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        dashboardTypeIdResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // Add integration for /api/dashboard/{type}
        dashboardTypeResource.addMethod('GET', new apigateway.LambdaIntegration(dashboardLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        dashboardTypeResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // --- Cron Lambdas --- (Update paths based on actual structure)
        const cronSaveLambda = createBotmonLambda('CronSaveApi', 'cron/save', apiLambdaRole);
        const cronDeleteLambda = createBotmonLambda('CronDeleteApi', 'cron/delete', apiLambdaRole);
        const cronSaveOverridesLambda = createBotmonLambda('LeoCronSaveOverrides', 'cron/saveOverrides', apiLambdaRole);
        const cronGetLambda = createBotmonLambda('CronGetApi', 'cron/get', apiLambdaRole);
        // ... (rest of Cron/Bot integrations need to point to the correct lambda variables) ...
        // --- ShowPages Lambda --- 
        const showPagesLambda = createBotmonLambda('ShowPages', 'showPages', apiLambdaRole, undefined, // No additional env vars
        undefined, // Default timeout
        undefined, // Default memory
        {
            '__CONFIG__': JSON.stringify({}), // Define __CONFIG__ as empty object
            '__PAGES__': JSON.stringify(['index']) // Define __PAGES__ with placeholder page
        });
        const indexResource = api.root.addResource('index');
        indexResource.addMethod('ANY', new apigateway.LambdaIntegration(showPagesLambda));
        // Add integration for root path
        api.root.addMethod('ANY', new apigateway.LambdaIntegration(showPagesLambda));
        // Add integration for /gmaillogin.html
        const gmailLoginResource = api.root.addResource('gmaillogin.html');
        gmailLoginResource.addMethod('ANY', new apigateway.LambdaIntegration(showPagesLambda));
        // --- Other Lambdas --- (Update paths as needed)
        const statsProcessorLambda = createBotmonLambda('StatsProcessor', 'stats-processor', leoBotmonRole);
        statsProcessorLambda.addEventSourceMapping('BusKinesisSource', {
            eventSourceArn: props.bus.leoKinesisStream.streamArn,
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 100, // Adjust as needed
        });
        // HealthCheck SNS Topic
        const healthCheckTopic = new sns.Topic(this, 'HealthCheckSNS');
        this.healthCheckTopic = healthCheckTopic;
        // HealthSNS Lambda (Placeholder - Processes SNS messages from HealthCheckTopic)
        const healthSnsLambda = createBotmonLambda('HealthSNS', 'healthSNS', leoBotmonSnsRole);
        healthSnsLambda.addEventSource(new lambdaEventSources.SnsEventSource(healthCheckTopic));
        // LeoHealthCheck Lambda
        const leoHealthCheckLambda = createBotmonLambda('LeoHealthCheck', 'healthSNS', apiLambdaRole, {
            // Pass SNS Topic ARN and API Gateway URL to environment
            HEALTHCHECK_SNS_TOPIC_ARN: healthCheckTopic.topicArn,
            DOMAIN_URL: `https://${api.restApiId}.execute-api.${stack.region}.amazonaws.com/${props.environmentName}`, // Construct API GW URL
        });
        // Add permission for SNS to publish to the topic if needed by health check?
        healthCheckTopic.grantPublish(leoHealthCheckLambda); // HealthCheck lambda needs to publish results to the topic
        // LeoRegister Custom Resource
        // Use the service token directly from the Bus construct instead of importing
        const registerServiceToken = props.bus.installTriggerServiceToken;
        // Explicitly construct the resource and table references for the Leo SDK
        const leoSdkConfig = {
            region: stack.region,
            resources: {
                LeoStream: props.bus.leoStreamTable.tableName,
                LeoCron: props.bus.leoCronTable.tableName,
                LeoEvent: props.bus.leoEventTable.tableName,
                LeoSettings: props.bus.leoSettingsTable.tableName,
                LeoSystem: props.bus.leoSystemTable.tableName,
                LeoS3: props.bus.leoS3Bucket.bucketName,
                LeoKinesisStream: props.bus.leoKinesisStream.streamName,
                LeoFirehoseStream: props.bus.leoFirehoseStreamName,
                Region: stack.region,
                LeoStats: this.leoStatsTable.tableName
            }
        };
        // Custom Resource for Registering Replication Bots
        new cdk.CustomResource(this, 'LeoRegisterBots', {
            serviceToken: registerServiceToken,
            properties: {
                // Define the bots to register in the proper format that the Lambda expects
                // Pass lambdaArn and other required fields instead of nested objects
                lambdaArn: statsProcessorLambda.functionArn,
                Events: JSON.stringify([
                    {
                        "event": "system.stats",
                        "botId": "Stats_Processor",
                        "source": "Leo_Stats"
                    }
                ]),
                GenericBots: JSON.stringify([
                    {
                        id: 'stats_processor',
                        owner: 'leo',
                        lambdaArn: statsProcessorLambda.functionArn,
                        settings: {
                            batch: { size: { count: 1000, time: { seconds: 3 } } },
                            source: 'queue:monitor'
                        },
                        ignoreMonitor: true,
                        paused: false
                    },
                    {
                        id: 'Leo_health_check',
                        owner: 'leo',
                        lambdaArn: leoHealthCheckLambda.functionArn,
                        time: '30 */1 * * * *',
                        paused: false
                    }
                ]),
                LeoSdkConfig: JSON.stringify(leoSdkConfig),
                UpdateTrigger: new Date().toISOString()
            }
        });
        // StatsApi Lambda & Integration
        const statsLambda = createBotmonLambda('StatsApi', 'stats', apiLambdaRole);
        const statsResource = apiRoot.addResource('stats_v2'); // Path from CFN
        statsResource.addMethod('GET', new apigateway.LambdaIntegration(statsLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        statsResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // SnsApi Lambda & Integration (Update Role)
        const snsApiLambda = createBotmonLambda('SnsApi', 'sns', leoBotmonSnsRole);
        const snsGetResource = apiRoot.addResource('sns_get');
        snsGetResource.addMethod('GET', new apigateway.LambdaIntegration(snsApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        snsGetResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        const snsSaveResource = apiRoot.addResource('sns_save').addResource('{type}').addResource('{id}');
        snsSaveResource.addMethod('POST', new apigateway.LambdaIntegration(snsApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        snsSaveResource.addCorsPreflight({
            allowMethods: ['POST', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // SettingsApi Lambda & Integration
        const settingsApiLambda = createBotmonLambda('SettingsApi', 'settings', apiLambdaRole);
        const settingsResource = apiRoot.addResource('settings');
        settingsResource.addMethod('GET', new apigateway.LambdaIntegration(settingsApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        settingsResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        const settingsIdResource = settingsResource.addResource('{id}');
        settingsIdResource.addMethod('GET', new apigateway.LambdaIntegration(settingsApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        settingsIdResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // SearchQueueApi Lambda & Integration
        const searchQueueApiLambda = createBotmonLambda('SearchQueueApi', 'searchQueue', apiLambdaRole);
        const searchResource = apiRoot.addResource('search');
        const searchQueueResource = searchResource.addResource('{queue}');
        const searchQueueStartResource = searchQueueResource.addResource('{start}');
        searchQueueStartResource.addMethod('GET', new apigateway.LambdaIntegration(searchQueueApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        searchQueueStartResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        const searchQueueStartQueryResource = searchQueueStartResource.addResource('{query}');
        searchQueueStartQueryResource.addMethod('GET', new apigateway.LambdaIntegration(searchQueueApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        searchQueueStartQueryResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // QueueSchemaApi Lambda & Integration
        const queueSchemaApiLambda = createBotmonLambda('QueueSchemaApi', 'queueSchema', apiLambdaRole);
        const queueSchemaResource = apiRoot.addResource('queueSchema').addResource('{queue}');
        queueSchemaResource.addMethod('GET', new apigateway.LambdaIntegration(queueSchemaApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        queueSchemaResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // LogsApi Lambda & Integration
        const logsApiLambda = createBotmonLambda('LogsApi', 'logs', apiLambdaRole);
        const logsResource = apiRoot.addResource('logs').addResource('{lambda}').addResource('{id}');
        logsResource.addMethod('GET', new apigateway.LambdaIntegration(logsApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        logsResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // EventTraceApi Lambda & Integration
        const eventTraceApiLambda = createBotmonLambda('EventTraceApi', 'eventTrace', apiLambdaRole);
        const traceResource = apiRoot.addResource('trace').addResource('{queue}').addResource('{id}');
        traceResource.addMethod('GET', new apigateway.LambdaIntegration(eventTraceApiLambda), { authorizationType: apigateway.AuthorizationType.IAM });
        traceResource.addCorsPreflight({
            allowMethods: ['GET', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        // 4. S3 Bucket for UI (WebsiteBucket)
        const uiBucket = new s3.Bucket(this, 'websitebucket', {
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        this.uiBucket = uiBucket;
        // 5. CloudFront Distribution (CloudfrontDistribution)
        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI');
        uiBucket.grantRead(originAccessIdentity);
        const distribution = new cloudfront.Distribution(this, 'CloudfrontDistribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new origins.S3Origin(uiBucket, { originAccessIdentity }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            },
            // Add behavior for API Gateway
            additionalBehaviors: {
                '/api/*': {
                    origin: new origins.RestApiOrigin(api),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                }
            },
            errorResponses: [
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(0),
                },
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(0),
                },
            ],
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Adjust as needed
        });
        this.cloudfrontDistribution = distribution;
        // 6. S3 Deployment (DeployWebsite)
        // Assumes UI build output is in ../bus-ui/dist (or similar)
        // TODO: Confirm UI build output path
        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'bus-ui', 'dist'))], // Need correct path
            destinationBucket: uiBucket,
            distribution: distribution,
            distributionPaths: ['/*'], // Invalidate CloudFront cache
        });
        // 7. Cognito Identity Pool & Roles (Refined Policies - Placeholders)
        // ... Identity Pool ...
        let identityPoolRef;
        if (props.createCognito !== false) {
            // Create new identity pool if createCognito is true or undefined
            const identityPool = new cognito.CfnIdentityPool(this, 'CognitoIdentityPool', {
                allowUnauthenticatedIdentities: true, // Or false based on requirements
            });
            this.identityPool = identityPool;
            identityPoolRef = identityPool.ref;
        }
        else if (props.existingCognitoId) {
            // Use existing identity pool ID
            identityPoolRef = props.existingCognitoId;
            // We need to create a placeholder for the identityPool property
            this.identityPool = {
                ref: props.existingCognitoId
            };
        }
        else {
            throw new Error('Either createCognito must be true or existingCognitoId must be provided');
        }
        const unauthRole = new iam.Role(this, 'CognitoUnauthenticatedRole', {
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPoolRef },
                'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
            }, 'sts:AssumeRoleWithWebIdentity'),
            description: 'Cognito Unauthenticated Role - Needs Policy Review',
        });
        // Add policies using addToPolicy instead of inlinePolicies
        // Example: Allow reading public API endpoints if any
        unauthRole.addToPolicy(new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            resources: [api.arnForExecuteApi('GET', '/public/*')]
        }));
        const authRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPoolRef },
                'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
            }, 'sts:AssumeRoleWithWebIdentity'),
            description: 'Cognito Authenticated Role',
        });
        // Add invoke API policy using addToPolicy
        authRole.addToPolicy(new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            resources: [api.arnForExecuteApi('*', '/api/*')] // Scope to /api/*
        }));
        // Cognito Role Attachment
        new cognito.CfnIdentityPoolRoleAttachment(this, 'CognitoIdentityPoolRoleAttachment', {
            identityPoolId: identityPoolRef,
            roles: {
                unauthenticated: unauthRole.roleArn,
                authenticated: authRole.roleArn,
            }
        });
        // Outputs
        new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: distribution.distributionId });
        new cdk.CfnOutput(this, 'CloudFrontDomainName', { value: distribution.distributionDomainName });
        new cdk.CfnOutput(this, 'WebsiteBucketName', { value: uiBucket.bucketName });
        new cdk.CfnOutput(this, 'IdentityPoolIdOutput', { value: identityPoolRef });
        new cdk.CfnOutput(this, 'ApiGatewayEndpoint', { value: api.url });
    }
}
exports.Botmon = Botmon;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm90bW9uLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm90bW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFDdkMseURBQXlEO0FBQ3pELGlEQUFpRDtBQUNqRCx3REFBd0Q7QUFDeEQsMkNBQTJDO0FBQzNDLHlDQUF5QztBQUN6QywwREFBMEQ7QUFDMUQseURBQXlEO0FBQ3pELDhEQUE4RDtBQUM5RCxtREFBbUQ7QUFDbkQsNkNBQTZDO0FBQzdDLDZCQUE2QjtBQUU3QixxREFBcUQ7QUFDckQsMkNBQTJDO0FBRTNDLDJFQUEyRTtBQUMzRSxnRUFBaUU7QUEyQ2pFLE1BQWEsTUFBTyxTQUFRLHNCQUFTO0lBV25DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBa0I7UUFDMUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUVuQixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxrQ0FBa0M7UUFDbEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdEQsV0FBVyxFQUFFLFlBQVk7WUFDekIsYUFBYSxFQUFFO2dCQUNYLFNBQVMsRUFBRSxLQUFLLENBQUMsZUFBZTtnQkFDaEMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2FBQ3ZCO1NBQ0osQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLE9BQU8sR0FBRyxHQUFHLENBQUM7UUFDbkIsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxvQkFBb0I7UUFFakUsd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxhQUFhLEdB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LE9BQU87YUFDbEM7U0FDSixDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRSxFQUFFLEtBQUssRUFBRSxZQUFZLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQztRQUM1RixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFLEVBQUUsS0FBSyxFQUFFLFlBQVksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUM7UUFDaEcsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUM3RSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFDNUUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUVwRSxDQUFDO0NBQ0Y7QUFscEJELHdCQWtwQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIG5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCAqIGFzIHNuc1N1YnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJztcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xuaW1wb3J0IHsgY3JlYXRlVHJ1bmNhdGVkTmFtZSB9IGZyb20gJy4uL2hlbHBlcnMvbmFtZS10cnVuY2F0aW9uJztcblxuLy8gQXNzdW1pbmcgQnVzIGFuZCBBdXRoIGNvbnN0cnVjdHMgYXJlIGltcG9ydGVkIGZyb20gdGhlaXIgcmVzcGVjdGl2ZSBmaWxlc1xuaW1wb3J0IHsgQnVzIH0gZnJvbSAnLi4vYnVzL2J1cy1zdGFjayc7XG5pbXBvcnQgeyBBdXRoIH0gZnJvbSAnLi4vYXV0aC9hdXRoLXN0YWNrJztcblxuZXhwb3J0IGludGVyZmFjZSBCb3Rtb25Qcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZGVwbG95bWVudCBlbnZpcm9ubWVudCBuYW1lIChlLmcuLCBkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogUmVmZXJlbmNlIHRvIHRoZSBkZXBsb3llZCBCdXMgY29uc3RydWN0XG4gICAqL1xuICBidXM6IEJ1cztcblxuICAvKipcbiAgICogUmVmZXJlbmNlIHRvIHRoZSBkZXBsb3llZCBBdXRoIGNvbnN0cnVjdFxuICAgKi9cbiAgYXV0aDogQXV0aDtcblxuICAvKipcbiAgICogQ3VzdG9tIEphdmFTY3JpcHQgZmlsZSBwYXRoL1VSTCBmb3IgVUkgY3VzdG9taXphdGlvbiAoZnJvbSBjb250ZXh0L3BhcmFtcylcbiAgICovXG4gIGN1c3RvbUpzPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDdXN0b20gTG9naW5zIHN0cmluZyAoZnJvbSBjb250ZXh0L3BhcmFtcylcbiAgICovXG4gIGxvZ2lucz86IHN0cmluZztcblxuICAvKipcbiAgICogV2hldGhlciB0byBjcmVhdGUgYSBuZXcgQ29nbml0byBpZGVudGl0eSBwb29sICh0cnVlKSBvciB1c2UgYW4gZXhpc3Rpbmcgb25lIChmYWxzZSlcbiAgICovXG4gIGNyZWF0ZUNvZ25pdG8/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBJRCBvZiBleGlzdGluZyBDb2duaXRvIGlkZW50aXR5IHBvb2wgdG8gdXNlIGlmIGNyZWF0ZUNvZ25pdG8gaXMgZmFsc2VcbiAgICovXG4gIGV4aXN0aW5nQ29nbml0b0lkPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQm90bW9uIGV4dGVuZHMgQ29uc3RydWN0IHtcblxuICBwdWJsaWMgcmVhZG9ubHkgaWRlbnRpdHlQb29sOiBjb2duaXRvLkNmbklkZW50aXR5UG9vbDtcbiAgcHVibGljIHJlYWRvbmx5IGNsb3VkZnJvbnREaXN0cmlidXRpb246IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgcmVzdEFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgdWlCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHJpdmF0ZSByZWFkb25seSBsZW9TdGF0c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGhlYWx0aENoZWNrVG9waWM6IHNucy5JVG9waWM7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Cb3Rtb25TbnNSb2xlOiBpYW0uSVJvbGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvcHM6IEJvdG1vblByb3BzO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBCb3Rtb25Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgdGhpcy5wcm9wcyA9IHByb3BzO1xuXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XG5cbiAgICAvLyAxLiBCb3Rtb24gQVBJIEdhdGV3YXkgKFJlc3RBcGkpXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQm90bW9uUmVzdEFwaScsIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdCb3Rtb24gQVBJJyxcbiAgICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICAgICAgc3RhZ2VOYW1lOiBwcm9wcy5lbnZpcm9ubWVudE5hbWUsXG4gICAgICAgICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMucmVzdEFwaSA9IGFwaTtcbiAgICBjb25zdCBhcGlSb290ID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpOyAvLyBCYXNlIHBhdGggZm9yIEFQSVxuXG4gICAgLy8gTGVvU3RhdHMgVGFibGUgKFJlZmluZWQgYmFzZWQgb24gQ0ZOKVxuICAgIHRoaXMubGVvU3RhdHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnTGVvU3RhdHMnLCB7XG4gICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICdidWNrZXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDb3JyZWN0ZWQgU0tcbiAgICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsIC8vIEFkZGVkIHN0cmVhbVxuICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xuICAgICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlXG4gICAgICAgIH0sXG4gICAgfSk7XG4gICAgLy8gQWRkIEdTSVxuICAgIHRoaXMubGVvU3RhdHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICAgIGluZGV4TmFtZTogJ3BlcmlvZC10aW1lLWluZGV4JyxcbiAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwZXJpb2QnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcbiAgICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnY3VycmVudCddLFxuICAgIH0pO1xuXG4gICAgLy8gMi4gSUFNIFJvbGVzXG5cbiAgICAvLyBMZW9Cb3Rtb25Sb2xlIChSZWZpbmVkIGJhc2VkIG9uIENGTilcbiAgICBjb25zdCBsZW9Cb3Rtb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMZW9Cb3Rtb25Sb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgICAgIHByb3BzLmJ1cy5sZW9Cb3RQb2xpY3ksIC8vIEltcG9ydCBCdXMgcG9saWN5XG4gICAgICAgIF0sXG4gICAgfSk7XG4gICAgXG4gICAgbGVvQm90bW9uUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0xlb1N0YXRzQWNjZXNzJyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsICdkeW5hbW9kYjpCYXRjaFdyaXRlSXRlbScsICdkeW5hbW9kYjpVcGRhdGVJdGVtJywgJ2R5bmFtb2RiOlB1dEl0ZW0nLCAnZHluYW1vZGI6UXVlcnknLCAnZHluYW1vZGI6U2NhbicsICdkeW5hbW9kYjpHZXRJdGVtJ1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb1N0YXRzVGFibGUudGFibGVBcm5dXG4gICAgfSkpO1xuXG4gICAgLy8gQXBpUm9sZSAoUmVmaW5lZCBiYXNlZCBvbiBDRk4pXG4gICAgY29uc3QgYXBpTGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQm90bW9uQXBpTGFtYmRhUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICBwcm9wcy5idXMubGVvQm90UG9saWN5LCAvLyBJbXBvcnQgQnVzIHBvbGljeVxuICAgICAgICBdLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIEFkZCBlYWNoIHBvbGljeSBzdGF0ZW1lbnQgZGlyZWN0bHkgdG8gdGhlIHJvbGVcbiAgICBhcGlMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgIHNpZDogJ0ludm9rZVN0YWNrTGFtYmRhcycsXG4gICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJywgJ2xhbWJkYTpJbnZva2VBc3luYyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHtzdGFjay5zdGFja05hbWV9LSpgXVxuICAgIH0pKTtcbiAgICBcbiAgICBhcGlMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgIHNpZDogJ1JlYWRTZWNyZXRzJyxcbiAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpzZWNyZXQ6KmBdIC8vIFNjb3BlIGRvd24gaWYgcG9zc2libGVcbiAgICB9KSk7XG4gICAgXG4gICAgYXBpTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBzaWQ6ICdMZW9TdGF0c0FjY2VzcycsXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdkeW5hbW9kYjpCYXRjaEdldEl0ZW0nLCAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLCAnZHluYW1vZGI6VXBkYXRlSXRlbScsXG4gICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsICdkeW5hbW9kYjpRdWVyeScsICdkeW5hbW9kYjpTY2FuJywgJ2R5bmFtb2RiOkdldEl0ZW0nXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW3RoaXMubGVvU3RhdHNUYWJsZS50YWJsZUFybl1cbiAgICB9KSk7XG4gICAgXG4gICAgYXBpTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBzaWQ6ICdGaWx0ZXJMb2dzJyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkZpbHRlckxvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2xhbWJkYS8qOipgXSAvLyBTY29wZSBkb3duIGlmIHBvc3NpYmxlXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgQnVzL0F1dGggYWNjZXNzIChyZWR1bmRhbnQgaWYgY292ZXJlZCBieSBpbXBvcnRlZCBtYW5hZ2VkIHBvbGljaWVzLCBidXQgZXhwbGljaXQpXG4gICAgcHJvcHMuYnVzLmxlb1N0cmVhbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvQXJjaGl2ZVRhYmxlLmdyYW50UmVhZERhdGEoYXBpTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuYnVzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvU3lzdGVtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9TM0J1Y2tldC5ncmFudFJlYWQoYXBpTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuYXV0aC5sZW9BdXRoVGFibGUuZ3JhbnRSZWFkRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5hdXRoLmxlb0F1dGhVc2VyVGFibGUuZ3JhbnRSZWFkRGF0YShhcGlMYW1iZGFSb2xlKTtcblxuICAgIC8vIExlb0JvdG1vblNuc1JvbGUgKFJlZmluZWQgYmFzZWQgb24gQ0ZOKVxuICAgIGNvbnN0IGxlb0JvdG1vblNuc1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xlb0JvdG1vblNuc1JvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICAgICAgcHJvcHMuYnVzLmxlb0JvdFBvbGljeSxcbiAgICAgICAgXSxcbiAgICB9KTtcbiAgICBcbiAgICBsZW9Cb3Rtb25TbnNSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnU05TUG9saWN5JyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ3NuczpMaXN0VG9waWNzJywgJ3NuczpMaXN0U3Vic2NyaXB0aW9uc0J5VG9waWMnLCAnc25zOkdldFRvcGljQXR0cmlidXRlcycsXG4gICAgICAgICAgICAnc25zOkNyZWF0ZVRvcGljJywgJ3NuczpTdWJzY3JpYmUnLCAnc25zOlVuc3Vic2NyaWJlJywgJ3NuczpQdWJsaXNoJyAvLyBBZGRlZCBQdWJsaXNoXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogWycqJ10gLy8gU2NvcGUgZG93biBpZiBwb3NzaWJsZVxuICAgIH0pKTtcbiAgICBcbiAgICB0aGlzLmxlb0JvdG1vblNuc1JvbGUgPSBsZW9Cb3Rtb25TbnNSb2xlO1xuXG4gICAgLy8gMy4gQm90bW9uIExhbWJkYSBGdW5jdGlvbnMgKFVwZGF0ZSBSb2xlcylcbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gZGVmaW5lZCBJTlNJREUgY29uc3RydWN0b3Igb3IgYXMgYSBwcml2YXRlIG1ldGhvZCB0byBhY2Nlc3MgaW5zdGFuY2UgbWVtYmVyc1xuICAgIGNvbnN0IGNyZWF0ZUJvdG1vbkxhbWJkYSA9IChcbiAgICAgICAgbGFtYmRhSWQ6IHN0cmluZyxcbiAgICAgICAgZW50cnlGaWxlUGF0aFBhcnQ6IHN0cmluZywgLy8gQ0hBTkdFRDogRXhwZWN0IHBhdGggbGlrZSAnc3lzdGVtL2dldCcgb3IgJ2Nyb24vc2F2ZSdcbiAgICAgICAgcm9sZTogaWFtLklSb2xlLFxuICAgICAgICBhZGRpdGlvbmFsRW52PzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uID0gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgIG1lbW9yeVNpemU6IG51bWJlciA9IDI1NixcbiAgICAgICAgZGVmaW5lT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH1cbiAgICApOiBub2RlanMuTm9kZWpzRnVuY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcbiAgICAgICAgLy8gVXNlIGEgdHJ1bmNhdGVkIGZ1bmN0aW9uIG5hbWUgZm9ybWF0XG4gICAgICAgIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBsYW1iZGFJZCwgJycsIHByb3BzLmVudmlyb25tZW50TmFtZSk7XG5cbiAgICAgICAgLy8gVXNlIGVudHJ5RmlsZVBhdGhQYXJ0IHRvIGJ1aWxkIHRoZSBmdWxsIGVudHJ5IHBhdGhcbiAgICAgICAgY29uc3QgZW50cnlQYXRoID0gcGF0aC5yZXNvbHZlKGAuL2xhbWJkYS9ib3Rtb24vJHtlbnRyeUZpbGVQYXRoUGFydH0vaW5kZXguanNgKTtcbiAgICAgICAgY29uc3QgcHJvamVjdFJvb3RQYXRoID0gcGF0aC5yZXNvbHZlKGAuL2ApOyAvLyBNYWluIHByb2plY3Qgcm9vdFxuXG4gICAgICAgIC8vIEVudmlyb25tZW50IHZhcmlhYmxlIHNldHVwIHVzaW5nIHRoaXMucHJvcHMgYW5kIHRoaXMubGVvU3RhdHNUYWJsZVxuICAgICAgICBjb25zdCBsZW9TZGtFbnYgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICByZWdpb246IHN0YWNrLnJlZ2lvbixcbiAgICAgICAgICAgIHJlc291cmNlczoge1xuICAgICAgICAgICAgICAgIExlb1N0cmVhbTogdGhpcy5wcm9wcy5idXMubGVvU3RyZWFtVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIExlb0FyY2hpdmU6IHRoaXMucHJvcHMuYnVzLmxlb0FyY2hpdmVUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgTGVvRXZlbnQ6IHRoaXMucHJvcHMuYnVzLmxlb0V2ZW50VGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIExlb1NldHRpbmdzOiB0aGlzLnByb3BzLmJ1cy5sZW9TZXR0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBMZW9TeXN0ZW06IHRoaXMucHJvcHMuYnVzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBMZW9TMzogdGhpcy5wcm9wcy5idXMubGVvUzNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBMZW9LaW5lc2lzU3RyZWFtOiB0aGlzLnByb3BzLmJ1cy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbU5hbWUsXG4gICAgICAgICAgICAgICAgTGVvRmlyZWhvc2VTdHJlYW06IHRoaXMucHJvcHMuYnVzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgICAgICAgICBSZWdpb246IHN0YWNrLnJlZ2lvblxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgbGVvQXV0aFNka0VudiA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHJlZ2lvbjogc3RhY2sucmVnaW9uLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7XG4gICAgICAgICAgICAgICAgTGVvQXV0aDogdGhpcy5wcm9wcy5hdXRoLmxlb0F1dGhUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgTGVvQXV0aFVzZXI6IHRoaXMucHJvcHMuYXV0aC5sZW9BdXRoVXNlclRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBSZWdpb246IHN0YWNrLnJlZ2lvblxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgbGVvU2RrRGF0YSA9IEpTT04ucGFyc2UobGVvU2RrRW52KTtcbiAgICAgICAgbGVvU2RrRGF0YS5yZXNvdXJjZXMuTGVvU3RhdHMgPSB0aGlzLmxlb1N0YXRzVGFibGUudGFibGVOYW1lOyAvLyBBY2Nlc3MgaW5zdGFuY2UgbWVtYmVyXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRMZW9TZGtFbnYgPSBKU09OLnN0cmluZ2lmeShsZW9TZGtEYXRhKTtcblxuICAgICAgICByZXR1cm4gbmV3IG5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBsYW1iZGFJZCwge1xuICAgICAgICAgICAgZnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUsXG4gICAgICAgICAgICBlbnRyeTogZW50cnlQYXRoLCBcbiAgICAgICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgICAgICAgcm9sZTogcm9sZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgLi4uKGFkZGl0aW9uYWxFbnYgPz8ge30pLFxuICAgICAgICAgICAgICAgIFJlc291cmNlczogSlNPTi5zdHJpbmdpZnkoeyBMZW9TdGF0czogdGhpcy5sZW9TdGF0c1RhYmxlLnRhYmxlTmFtZSB9KSwgLy8gQWNjZXNzIGluc3RhbmNlIG1lbWJlclxuICAgICAgICAgICAgICAgIGxlb3NkazogdXBkYXRlZExlb1Nka0VudixcbiAgICAgICAgICAgICAgICBsZW9hdXRoc2RrOiBsZW9BdXRoU2RrRW52LFxuICAgICAgICAgICAgICAgIE5PREVfRU5WOiB0aGlzLnByb3BzLmVudmlyb25tZW50TmFtZSxcbiAgICAgICAgICAgICAgICBCVVNfU1RBQ0tfTkFNRTogdGhpcy5wcm9wcy5idXMuYnVzU3RhY2tOYW1lT3V0cHV0LFxuICAgICAgICAgICAgICAgIE5PREVfT1BUSU9OUzogJy0tZW5hYmxlLXNvdXJjZS1tYXBzJyxcbiAgICAgICAgICAgICAgICBBV1NfTk9ERUpTX0NPTk5FQ1RJT05fUkVVU0VfRU5BQkxFRDogJzEnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXQsXG4gICAgICAgICAgICBtZW1vcnlTaXplOiBtZW1vcnlTaXplLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICBwcm9qZWN0Um9vdDogcHJvamVjdFJvb3RQYXRoLFxuICAgICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgLy8gJ2F3cy1zZGsnLCAvLyBSZW1vdmVkIEFXUyBTREsgdjIgZGVwZW5kZW5jeVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgbm9kZU1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1zZGsnLCAvLyBBREQgbGVvLXNkayBhcyBub2RlTW9kdWxlIGZvciBCb3Rtb24gbGFtYmRhc1xuICAgICAgICAgICAgICAgICAgICAnbGF0ZXInICAgIC8vIE1hcmsgJ2xhdGVyJyBhcyBub2RlTW9kdWxlIHRvIGF2b2lkIGJ1bmRsaW5nIGlzc3Vlc1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICAgICAgICAgIGRlZmluZTogZGVmaW5lT3B0aW9uc1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tIFN5c3RlbSBMYW1iZGFzIC0tLSBcbiAgICAvLyBJbnN0YW50aWF0ZSBzZXBhcmF0ZSBMYW1iZGFzIGZvciBlYWNoIGFjdGlvblxuICAgIGNvbnN0IHN5c3RlbVNhdmVMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ1N5c3RlbVNhdmVBcGknLCAnc3lzdGVtL3NhdmUnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBzeXN0ZW1HZXRMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ1N5c3RlbUdldEFwaScsICdzeXN0ZW0vZ2V0JywgYXBpTGFtYmRhUm9sZSk7XG4gICAgLy8gY29uc3Qgc3lzdGVtUHJveHlMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ1N5c3RlbVByb3h5QXBpJywgJ3N5c3RlbS9wcm94eScsIGFwaUxhbWJkYVJvbGUpOyAvLyBJZiBwcm94eSBpcyBuZWVkZWRcblxuICAgIC8vIFN5c3RlbSBBUEkgR2F0ZXdheSBJbnRlZ3JhdGlvbnMgKFVwZGF0ZSBpbnRlZ3JhdGlvbnMpXG4gICAgY29uc3Qgc3lzdGVtUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdzeXN0ZW0nKTtcbiAgICBjb25zdCBzeXN0ZW1JZFJlc291cmNlID0gc3lzdGVtUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcblxuICAgIC8vIFJFSU5TVEFURSBhZGRDb3JzUHJlZmxpZ2h0IGZvciAve2lkfVxuICAgIHN5c3RlbUlkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BPU1QnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIC8vIENvbnNpZGVyIG1vcmUgc3BlY2lmaWMgaGVhZGVycyBpZiBwb3NzaWJsZVxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBUSEVOIGFkZCBhY3R1YWwgbWV0aG9kc1xuICAgIC8vIFBPU1QgbWV0aG9kcyBwb2ludCB0byBzeXN0ZW1TYXZlTGFtYmRhXG4gICAgc3lzdGVtSWRSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzeXN0ZW1TYXZlTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc3lzdGVtUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc3lzdGVtU2F2ZUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIC8vIEdFVCBtZXRob2QgcG9pbnRzIHRvIHN5c3RlbUdldExhbWJkYVxuICAgIHN5c3RlbUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzeXN0ZW1HZXRMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBcbiAgICAvLyBLZWVwIENPUlMgZm9yIC9zeXN0ZW0gKGNvdmVycyBpdHMgb3duIFBPU1QpXG4gICAgIHN5c3RlbVJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ1BPU1QnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cblxuICAgIC8vIC0tLSBFdmVudFNldHRpbmdzIExhbWJkYXMgLS0tIFxuICAgIGNvbnN0IGV2ZW50U2V0dGluZ3NHZXRMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0V2ZW50U2V0dGluZ3NHZXRBcGknLCAnZXZlbnRTZXR0aW5ncy9nZXQnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBldmVudFNldHRpbmdzU2F2ZUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnRXZlbnRTZXR0aW5nc1NhdmVBcGknLCAnZXZlbnRTZXR0aW5ncy9zYXZlJywgYXBpTGFtYmRhUm9sZSk7IC8vIENyZWF0ZSBTYXZlIGxhbWJkYVxuXG4gICAgLy8gRXZlbnRTZXR0aW5ncyBBUEkgR2F0ZXdheSBJbnRlZ3JhdGlvbnNcbiAgICBjb25zdCBldmVudFNldHRpbmdzUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdldmVudHNldHRpbmdzJyk7XG4gICAgY29uc3QgZXZlbnRTZXR0aW5nc0V2ZW50UmVzb3VyY2UgPSBldmVudFNldHRpbmdzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tldmVudH0nKTtcbiAgICBcbiAgICAvLyBQb2ludCBHRVQgbWV0aG9kcyB0byBHZXRMYW1iZGFcbiAgICBldmVudFNldHRpbmdzRXZlbnRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGV2ZW50U2V0dGluZ3NHZXRMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBldmVudFNldHRpbmdzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihldmVudFNldHRpbmdzR2V0TGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgXG4gICAgLy8gQWRkIFBPU1QvUFVUIG1ldGhvZHMgcG9pbnRpbmcgdG8gU2F2ZUxhbWJkYSAoaWYgdGhleSBleGlzdCBpbiBvcmlnaW5hbCBDRk4gLSBhc3N1bWluZyB0aGV5IG1pZ2h0IGJhc2VkIG9uIENPUlMpXG4gICAgLy8gVE9ETzogVmVyaWZ5IGlmIFBPU1QvUFVUIGFyZSBhY3R1YWxseSBuZWVkZWQvdXNlZCBmb3IgL2V2ZW50c2V0dGluZ3MgYW5kIC9ldmVudHNldHRpbmdzL3tldmVudH1cbiAgICBldmVudFNldHRpbmdzUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZXZlbnRTZXR0aW5nc1NhdmVMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBldmVudFNldHRpbmdzRXZlbnRSZXNvdXJjZS5hZGRNZXRob2QoJ1BVVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGV2ZW50U2V0dGluZ3NTYXZlTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7IC8vIEFzc3VtaW5nIFBVVCBpcyBvbiAve2V2ZW50fVxuXG4gICAgLy8gQWRkIENPUlMgKENhbiBwb3RlbnRpYWxseSBjb21iaW5lIHRoZXNlIGlmIGFsbG93TWV0aG9kcyBtYXRjaClcbiAgICBldmVudFNldHRpbmdzRXZlbnRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnUFVUJywgJ09QVElPTlMnXSwgLy8gVXBkYXRlZCBtZXRob2RzIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcbiAgICBldmVudFNldHRpbmdzUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BPU1QnLCAnT1BUSU9OUyddLCAvLyBVcGRhdGVkIG1ldGhvZHNcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBRdWV1ZXMgZW5kcG9pbnQgKHVzZXMgRXZlbnRTZXR0aW5nc0dldEFwaSAtIENPUlJFQ1QsIHBvaW50cyB0byBHZXQgTGFtYmRhKVxuICAgIGNvbnN0IHF1ZXVlc1Jlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgncXVldWVzJyk7XG4gICAgcXVldWVzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihldmVudFNldHRpbmdzR2V0TGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgcXVldWVzUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gLS0tIERhc2hib2FyZCBMYW1iZGEgLS0tIChBc3N1bWluZyAnZGFzaGJvYXJkJyBkaXJlY3RvcnkgaGFzIGluZGV4LmpzKVxuICAgIGNvbnN0IGRhc2hib2FyZExhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnRGFzaGJvYXJkQXBpJywgJ2Rhc2hib2FyZCcsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IGRhc2hib2FyZFJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnZGFzaGJvYXJkJyk7XG4gICAgY29uc3QgZGFzaGJvYXJkVHlwZVJlc291cmNlID0gZGFzaGJvYXJkUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3t0eXBlfScpO1xuICAgIGNvbnN0IGRhc2hib2FyZFR5cGVJZFJlc291cmNlID0gZGFzaGJvYXJkVHlwZVJlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgZGFzaGJvYXJkVHlwZUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihkYXNoYm9hcmRMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBkYXNoYm9hcmRUeXBlSWRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG4gICAgLy8gQWRkIGludGVncmF0aW9uIGZvciAvYXBpL2Rhc2hib2FyZC97dHlwZX1cbiAgICBkYXNoYm9hcmRUeXBlUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihkYXNoYm9hcmRMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBkYXNoYm9hcmRUeXBlUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gLS0tIENyb24gTGFtYmRhcyAtLS0gKFVwZGF0ZSBwYXRocyBiYXNlZCBvbiBhY3R1YWwgc3RydWN0dXJlKVxuICAgIGNvbnN0IGNyb25TYXZlTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdDcm9uU2F2ZUFwaScsICdjcm9uL3NhdmUnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBjcm9uRGVsZXRlTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdDcm9uRGVsZXRlQXBpJywgJ2Nyb24vZGVsZXRlJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3QgY3JvblNhdmVPdmVycmlkZXNMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0xlb0Nyb25TYXZlT3ZlcnJpZGVzJywgJ2Nyb24vc2F2ZU92ZXJyaWRlcycsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IGNyb25HZXRMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0Nyb25HZXRBcGknLCAnY3Jvbi9nZXQnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICAvLyAuLi4gKHJlc3Qgb2YgQ3Jvbi9Cb3QgaW50ZWdyYXRpb25zIG5lZWQgdG8gcG9pbnQgdG8gdGhlIGNvcnJlY3QgbGFtYmRhIHZhcmlhYmxlcykgLi4uXG5cbiAgICAvLyAtLS0gU2hvd1BhZ2VzIExhbWJkYSAtLS0gXG4gICAgY29uc3Qgc2hvd1BhZ2VzTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKFxuICAgICAgICAnU2hvd1BhZ2VzJyxcbiAgICAgICAgJ3Nob3dQYWdlcycsXG4gICAgICAgIGFwaUxhbWJkYVJvbGUsXG4gICAgICAgIHVuZGVmaW5lZCwgLy8gTm8gYWRkaXRpb25hbCBlbnYgdmFyc1xuICAgICAgICB1bmRlZmluZWQsIC8vIERlZmF1bHQgdGltZW91dFxuICAgICAgICB1bmRlZmluZWQsIC8vIERlZmF1bHQgbWVtb3J5XG4gICAgICAgIHsgLy8gRGVmaW5lIG9wdGlvbnMgZm9yIHRoaXMgbGFtYmRhXG4gICAgICAgICAgICAnX19DT05GSUdfXyc6IEpTT04uc3RyaW5naWZ5KHt9KSwgLy8gRGVmaW5lIF9fQ09ORklHX18gYXMgZW1wdHkgb2JqZWN0XG4gICAgICAgICAgICAnX19QQUdFU19fJzogSlNPTi5zdHJpbmdpZnkoWydpbmRleCddKSAvLyBEZWZpbmUgX19QQUdFU19fIHdpdGggcGxhY2Vob2xkZXIgcGFnZVxuICAgICAgICB9XG4gICAgKTtcbiAgICBjb25zdCBpbmRleFJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2luZGV4Jyk7XG4gICAgaW5kZXhSZXNvdXJjZS5hZGRNZXRob2QoJ0FOWScsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNob3dQYWdlc0xhbWJkYSkpO1xuICAgIC8vIEFkZCBpbnRlZ3JhdGlvbiBmb3Igcm9vdCBwYXRoXG4gICAgYXBpLnJvb3QuYWRkTWV0aG9kKCdBTlknLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzaG93UGFnZXNMYW1iZGEpKTtcbiAgICAvLyBBZGQgaW50ZWdyYXRpb24gZm9yIC9nbWFpbGxvZ2luLmh0bWxcbiAgICBjb25zdCBnbWFpbExvZ2luUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnZ21haWxsb2dpbi5odG1sJyk7XG4gICAgZ21haWxMb2dpblJlc291cmNlLmFkZE1ldGhvZCgnQU5ZJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2hvd1BhZ2VzTGFtYmRhKSk7XG5cbiAgICAvLyAtLS0gT3RoZXIgTGFtYmRhcyAtLS0gKFVwZGF0ZSBwYXRocyBhcyBuZWVkZWQpXG4gICAgY29uc3Qgc3RhdHNQcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ1N0YXRzUHJvY2Vzc29yJywgJ3N0YXRzLXByb2Nlc3NvcicsIGxlb0JvdG1vblJvbGUpO1xuICAgIHN0YXRzUHJvY2Vzc29yTGFtYmRhLmFkZEV2ZW50U291cmNlTWFwcGluZygnQnVzS2luZXNpc1NvdXJjZScsIHtcbiAgICAgICAgZXZlbnRTb3VyY2VBcm46IHByb3BzLmJ1cy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgICAgc3RhcnRpbmdQb3NpdGlvbjogbGFtYmRhLlN0YXJ0aW5nUG9zaXRpb24uTEFURVNULFxuICAgICAgICBiYXRjaFNpemU6IDEwMCwgLy8gQWRqdXN0IGFzIG5lZWRlZFxuICAgIH0pO1xuXG4gICAgLy8gSGVhbHRoQ2hlY2sgU05TIFRvcGljXG4gICAgY29uc3QgaGVhbHRoQ2hlY2tUb3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ0hlYWx0aENoZWNrU05TJyk7XG4gICAgdGhpcy5oZWFsdGhDaGVja1RvcGljID0gaGVhbHRoQ2hlY2tUb3BpYztcblxuICAgIC8vIEhlYWx0aFNOUyBMYW1iZGEgKFBsYWNlaG9sZGVyIC0gUHJvY2Vzc2VzIFNOUyBtZXNzYWdlcyBmcm9tIEhlYWx0aENoZWNrVG9waWMpXG4gICAgY29uc3QgaGVhbHRoU25zTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdIZWFsdGhTTlMnLCAnaGVhbHRoU05TJywgbGVvQm90bW9uU25zUm9sZSk7XG4gICAgaGVhbHRoU25zTGFtYmRhLmFkZEV2ZW50U291cmNlKG5ldyBsYW1iZGFFdmVudFNvdXJjZXMuU25zRXZlbnRTb3VyY2UoaGVhbHRoQ2hlY2tUb3BpYykpO1xuXG4gICAgLy8gTGVvSGVhbHRoQ2hlY2sgTGFtYmRhXG4gICAgY29uc3QgbGVvSGVhbHRoQ2hlY2tMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0xlb0hlYWx0aENoZWNrJywgJ2hlYWx0aFNOUycsIGFwaUxhbWJkYVJvbGUsIHtcbiAgICAgICAgLy8gUGFzcyBTTlMgVG9waWMgQVJOIGFuZCBBUEkgR2F0ZXdheSBVUkwgdG8gZW52aXJvbm1lbnRcbiAgICAgICAgSEVBTFRIQ0hFQ0tfU05TX1RPUElDX0FSTjogaGVhbHRoQ2hlY2tUb3BpYy50b3BpY0FybixcbiAgICAgICAgRE9NQUlOX1VSTDogYGh0dHBzOi8vJHthcGkucmVzdEFwaUlkfS5leGVjdXRlLWFwaS4ke3N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3Byb3BzLmVudmlyb25tZW50TmFtZX1gLCAvLyBDb25zdHJ1Y3QgQVBJIEdXIFVSTFxuICAgIH0pO1xuICAgIC8vIEFkZCBwZXJtaXNzaW9uIGZvciBTTlMgdG8gcHVibGlzaCB0byB0aGUgdG9waWMgaWYgbmVlZGVkIGJ5IGhlYWx0aCBjaGVjaz9cbiAgICBoZWFsdGhDaGVja1RvcGljLmdyYW50UHVibGlzaChsZW9IZWFsdGhDaGVja0xhbWJkYSk7IC8vIEhlYWx0aENoZWNrIGxhbWJkYSBuZWVkcyB0byBwdWJsaXNoIHJlc3VsdHMgdG8gdGhlIHRvcGljXG5cbiAgICAvLyBMZW9SZWdpc3RlciBDdXN0b20gUmVzb3VyY2VcbiAgICAvLyBVc2UgdGhlIHNlcnZpY2UgdG9rZW4gZGlyZWN0bHkgZnJvbSB0aGUgQnVzIGNvbnN0cnVjdCBpbnN0ZWFkIG9mIGltcG9ydGluZ1xuICAgIGNvbnN0IHJlZ2lzdGVyU2VydmljZVRva2VuID0gcHJvcHMuYnVzLmluc3RhbGxUcmlnZ2VyU2VydmljZVRva2VuO1xuXG4gICAgLy8gRXhwbGljaXRseSBjb25zdHJ1Y3QgdGhlIHJlc291cmNlIGFuZCB0YWJsZSByZWZlcmVuY2VzIGZvciB0aGUgTGVvIFNES1xuICAgIGNvbnN0IGxlb1Nka0NvbmZpZyA9IHtcbiAgICAgIHJlZ2lvbjogc3RhY2sucmVnaW9uLFxuICAgICAgcmVzb3VyY2VzOiB7XG4gICAgICAgIExlb1N0cmVhbTogcHJvcHMuYnVzLmxlb1N0cmVhbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTGVvQ3JvbjogcHJvcHMuYnVzLmxlb0Nyb25UYWJsZS50YWJsZU5hbWUsIFxuICAgICAgICBMZW9FdmVudDogcHJvcHMuYnVzLmxlb0V2ZW50VGFibGUudGFibGVOYW1lLFxuICAgICAgICBMZW9TZXR0aW5nczogcHJvcHMuYnVzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMZW9TeXN0ZW06IHByb3BzLmJ1cy5sZW9TeXN0ZW1UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExlb1MzOiBwcm9wcy5idXMubGVvUzNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgTGVvS2luZXNpc1N0cmVhbTogcHJvcHMuYnVzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgTGVvRmlyZWhvc2VTdHJlYW06IHByb3BzLmJ1cy5sZW9GaXJlaG9zZVN0cmVhbU5hbWUsXG4gICAgICAgIFJlZ2lvbjogc3RhY2sucmVnaW9uLFxuICAgICAgICBMZW9TdGF0czogdGhpcy5sZW9TdGF0c1RhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBDdXN0b20gUmVzb3VyY2UgZm9yIFJlZ2lzdGVyaW5nIFJlcGxpY2F0aW9uIEJvdHNcbiAgICBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdMZW9SZWdpc3RlckJvdHMnLCB7XG4gICAgICAgIHNlcnZpY2VUb2tlbjogcmVnaXN0ZXJTZXJ2aWNlVG9rZW4sXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgIC8vIERlZmluZSB0aGUgYm90cyB0byByZWdpc3RlciBpbiB0aGUgcHJvcGVyIGZvcm1hdCB0aGF0IHRoZSBMYW1iZGEgZXhwZWN0c1xuICAgICAgICAgICAgLy8gUGFzcyBsYW1iZGFBcm4gYW5kIG90aGVyIHJlcXVpcmVkIGZpZWxkcyBpbnN0ZWFkIG9mIG5lc3RlZCBvYmplY3RzXG4gICAgICAgICAgICBsYW1iZGFBcm46IHN0YXRzUHJvY2Vzc29yTGFtYmRhLmZ1bmN0aW9uQXJuLFxuICAgICAgICAgICAgRXZlbnRzOiBKU09OLnN0cmluZ2lmeShbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBcImV2ZW50XCI6IFwic3lzdGVtLnN0YXRzXCIsXG4gICAgICAgICAgICAgICAgICAgIFwiYm90SWRcIjogXCJTdGF0c19Qcm9jZXNzb3JcIixcbiAgICAgICAgICAgICAgICAgICAgXCJzb3VyY2VcIjogXCJMZW9fU3RhdHNcIlxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgR2VuZXJpY0JvdHM6IEpTT04uc3RyaW5naWZ5KFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnc3RhdHNfcHJvY2Vzc29yJyxcbiAgICAgICAgICAgICAgICAgICAgb3duZXI6ICdsZW8nLFxuICAgICAgICAgICAgICAgICAgICBsYW1iZGFBcm46IHN0YXRzUHJvY2Vzc29yTGFtYmRhLmZ1bmN0aW9uQXJuLFxuICAgICAgICAgICAgICAgICAgICBzZXR0aW5nczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmF0Y2g6IHsgc2l6ZTogeyBjb3VudDogMTAwMCwgdGltZTogeyBzZWNvbmRzOiAzIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiAncXVldWU6bW9uaXRvcidcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaWdub3JlTW9uaXRvcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgcGF1c2VkOiBmYWxzZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0xlb19oZWFsdGhfY2hlY2snLFxuICAgICAgICAgICAgICAgICAgICBvd25lcjogJ2xlbycsXG4gICAgICAgICAgICAgICAgICAgIGxhbWJkYUFybjogbGVvSGVhbHRoQ2hlY2tMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICAgICAgICAgICAgICAgIHRpbWU6ICczMCAqLzEgKiAqICogKicsXG4gICAgICAgICAgICAgICAgICAgIHBhdXNlZDogZmFsc2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICAgIExlb1Nka0NvbmZpZzogSlNPTi5zdHJpbmdpZnkobGVvU2RrQ29uZmlnKSxcbiAgICAgICAgICAgIFVwZGF0ZVRyaWdnZXI6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTdGF0c0FwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IHN0YXRzTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTdGF0c0FwaScsICdzdGF0cycsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IHN0YXRzUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdzdGF0c192MicpOyAvLyBQYXRoIGZyb20gQ0ZOXG4gICAgc3RhdHNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHN0YXRzTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc3RhdHNSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBTbnNBcGkgTGFtYmRhICYgSW50ZWdyYXRpb24gKFVwZGF0ZSBSb2xlKVxuICAgIGNvbnN0IHNuc0FwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnU25zQXBpJywgJ3NucycsIGxlb0JvdG1vblNuc1JvbGUpO1xuICAgIGNvbnN0IHNuc0dldFJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc25zX2dldCcpO1xuICAgIHNuc0dldFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc25zQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc25zR2V0UmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuICAgIGNvbnN0IHNuc1NhdmVSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3Nuc19zYXZlJykuYWRkUmVzb3VyY2UoJ3t0eXBlfScpLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgc25zU2F2ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNuc0FwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHNuc1NhdmVSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydQT1NUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gU2V0dGluZ3NBcGkgTGFtYmRhICYgSW50ZWdyYXRpb25cbiAgICBjb25zdCBzZXR0aW5nc0FwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnU2V0dGluZ3NBcGknLCAnc2V0dGluZ3MnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBzZXR0aW5nc1Jlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2V0dGluZ3MnKTtcbiAgICBzZXR0aW5nc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2V0dGluZ3NBcGlMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBzZXR0aW5nc1Jlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdPUFRJT05TJ10sIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcbiAgICBjb25zdCBzZXR0aW5nc0lkUmVzb3VyY2UgPSBzZXR0aW5nc1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgc2V0dGluZ3NJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2V0dGluZ3NBcGlMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBzZXR0aW5nc0lkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gU2VhcmNoUXVldWVBcGkgTGFtYmRhICYgSW50ZWdyYXRpb25cbiAgICBjb25zdCBzZWFyY2hRdWV1ZUFwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnU2VhcmNoUXVldWVBcGknLCAnc2VhcmNoUXVldWUnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBzZWFyY2hSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NlYXJjaCcpO1xuICAgIGNvbnN0IHNlYXJjaFF1ZXVlUmVzb3VyY2UgPSBzZWFyY2hSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3F1ZXVlfScpO1xuICAgIGNvbnN0IHNlYXJjaFF1ZXVlU3RhcnRSZXNvdXJjZSA9IHNlYXJjaFF1ZXVlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tzdGFydH0nKTtcbiAgICBzZWFyY2hRdWV1ZVN0YXJ0UmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzZWFyY2hRdWV1ZUFwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHNlYXJjaFF1ZXVlU3RhcnRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG4gICAgY29uc3Qgc2VhcmNoUXVldWVTdGFydFF1ZXJ5UmVzb3VyY2UgPSBzZWFyY2hRdWV1ZVN0YXJ0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3txdWVyeX0nKTtcbiAgICBzZWFyY2hRdWV1ZVN0YXJ0UXVlcnlSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNlYXJjaFF1ZXVlQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc2VhcmNoUXVldWVTdGFydFF1ZXJ5UmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gUXVldWVTY2hlbWFBcGkgTGFtYmRhICYgSW50ZWdyYXRpb25cbiAgICBjb25zdCBxdWV1ZVNjaGVtYUFwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnUXVldWVTY2hlbWFBcGknLCAncXVldWVTY2hlbWEnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBxdWV1ZVNjaGVtYVJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgncXVldWVTY2hlbWEnKS5hZGRSZXNvdXJjZSgne3F1ZXVlfScpO1xuICAgIHF1ZXVlU2NoZW1hUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihxdWV1ZVNjaGVtYUFwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHF1ZXVlU2NoZW1hUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gTG9nc0FwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IGxvZ3NBcGlMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0xvZ3NBcGknLCAnbG9ncycsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IGxvZ3NSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2xvZ3MnKS5hZGRSZXNvdXJjZSgne2xhbWJkYX0nKS5hZGRSZXNvdXJjZSgne2lkfScpO1xuICAgIGxvZ3NSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxvZ3NBcGlMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBsb2dzUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gRXZlbnRUcmFjZUFwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IGV2ZW50VHJhY2VBcGlMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0V2ZW50VHJhY2VBcGknLCAnZXZlbnRUcmFjZScsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IHRyYWNlUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCd0cmFjZScpLmFkZFJlc291cmNlKCd7cXVldWV9JykuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcbiAgICB0cmFjZVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZXZlbnRUcmFjZUFwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHRyYWNlUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gNC4gUzMgQnVja2V0IGZvciBVSSAoV2Vic2l0ZUJ1Y2tldClcbiAgICBjb25zdCB1aUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ3dlYnNpdGVidWNrZXQnLCB7XG4gICAgICAgIHdlYnNpdGVJbmRleERvY3VtZW50OiAnaW5kZXguaHRtbCcsXG4gICAgICAgIHdlYnNpdGVFcnJvckRvY3VtZW50OiAnaW5kZXguaHRtbCcsXG4gICAgICAgIHB1YmxpY1JlYWRBY2Nlc3M6IGZhbHNlLFxuICAgICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICB9KTtcbiAgICB0aGlzLnVpQnVja2V0ID0gdWlCdWNrZXQ7XG5cbiAgICAvLyA1LiBDbG91ZEZyb250IERpc3RyaWJ1dGlvbiAoQ2xvdWRmcm9udERpc3RyaWJ1dGlvbilcbiAgICBjb25zdCBvcmlnaW5BY2Nlc3NJZGVudGl0eSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpbkFjY2Vzc0lkZW50aXR5KHRoaXMsICdPQUknKTtcbiAgICB1aUJ1Y2tldC5ncmFudFJlYWQob3JpZ2luQWNjZXNzSWRlbnRpdHkpO1xuXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdDbG91ZGZyb250RGlzdHJpYnV0aW9uJywge1xuICAgICAgICBkZWZhdWx0Um9vdE9iamVjdDogJ2luZGV4Lmh0bWwnLFxuICAgICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4odWlCdWNrZXQsIHsgb3JpZ2luQWNjZXNzSWRlbnRpdHkgfSksXG4gICAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gQWRkIGJlaGF2aW9yIGZvciBBUEkgR2F0ZXdheVxuICAgICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzOiB7XG4gICAgICAgICAgICAnL2FwaS8qJzoge1xuICAgICAgICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUmVzdEFwaU9yaWdpbihhcGkpLFxuICAgICAgICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXG4gICAgICAgICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcbiAgICAgICAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICAgICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJfRVhDRVBUX0hPU1RfSEVBREVSLFxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBodHRwU3RhdHVzOiA0MDQsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5taW51dGVzKDApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTXzEwMCwgLy8gQWRqdXN0IGFzIG5lZWRlZFxuICAgIH0pO1xuICAgIHRoaXMuY2xvdWRmcm9udERpc3RyaWJ1dGlvbiA9IGRpc3RyaWJ1dGlvbjtcblxuICAgIC8vIDYuIFMzIERlcGxveW1lbnQgKERlcGxveVdlYnNpdGUpXG4gICAgLy8gQXNzdW1lcyBVSSBidWlsZCBvdXRwdXQgaXMgaW4gLi4vYnVzLXVpL2Rpc3QgKG9yIHNpbWlsYXIpXG4gICAgLy8gVE9ETzogQ29uZmlybSBVSSBidWlsZCBvdXRwdXQgcGF0aFxuICAgIG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdEZXBsb3lXZWJzaXRlJywge1xuICAgICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICcuLicgLCAnYnVzLXVpJywgJ2Rpc3QnKSldLCAvLyBOZWVkIGNvcnJlY3QgcGF0aFxuICAgICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdWlCdWNrZXQsXG4gICAgICAgIGRpc3RyaWJ1dGlvbjogZGlzdHJpYnV0aW9uLFxuICAgICAgICBkaXN0cmlidXRpb25QYXRoczogWycvKiddLCAvLyBJbnZhbGlkYXRlIENsb3VkRnJvbnQgY2FjaGVcbiAgICB9KTtcblxuICAgIC8vIDcuIENvZ25pdG8gSWRlbnRpdHkgUG9vbCAmIFJvbGVzIChSZWZpbmVkIFBvbGljaWVzIC0gUGxhY2Vob2xkZXJzKVxuICAgIC8vIC4uLiBJZGVudGl0eSBQb29sIC4uLlxuXG4gICAgbGV0IGlkZW50aXR5UG9vbFJlZjogc3RyaW5nO1xuICAgIGlmIChwcm9wcy5jcmVhdGVDb2duaXRvICE9PSBmYWxzZSkge1xuICAgICAgLy8gQ3JlYXRlIG5ldyBpZGVudGl0eSBwb29sIGlmIGNyZWF0ZUNvZ25pdG8gaXMgdHJ1ZSBvciB1bmRlZmluZWRcbiAgICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbCh0aGlzLCAnQ29nbml0b0lkZW50aXR5UG9vbCcsIHtcbiAgICAgICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IHRydWUsIC8vIE9yIGZhbHNlIGJhc2VkIG9uIHJlcXVpcmVtZW50c1xuICAgICAgfSk7XG4gICAgICB0aGlzLmlkZW50aXR5UG9vbCA9IGlkZW50aXR5UG9vbDtcbiAgICAgIGlkZW50aXR5UG9vbFJlZiA9IGlkZW50aXR5UG9vbC5yZWY7XG4gICAgfSBlbHNlIGlmIChwcm9wcy5leGlzdGluZ0NvZ25pdG9JZCkge1xuICAgICAgLy8gVXNlIGV4aXN0aW5nIGlkZW50aXR5IHBvb2wgSURcbiAgICAgIGlkZW50aXR5UG9vbFJlZiA9IHByb3BzLmV4aXN0aW5nQ29nbml0b0lkO1xuICAgICAgLy8gV2UgbmVlZCB0byBjcmVhdGUgYSBwbGFjZWhvbGRlciBmb3IgdGhlIGlkZW50aXR5UG9vbCBwcm9wZXJ0eVxuICAgICAgdGhpcy5pZGVudGl0eVBvb2wgPSB7XG4gICAgICAgIHJlZjogcHJvcHMuZXhpc3RpbmdDb2duaXRvSWRcbiAgICAgIH0gYXMgYW55IGFzIGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VpdGhlciBjcmVhdGVDb2duaXRvIG11c3QgYmUgdHJ1ZSBvciBleGlzdGluZ0NvZ25pdG9JZCBtdXN0IGJlIHByb3ZpZGVkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgdW5hdXRoUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29nbml0b1VuYXV0aGVudGljYXRlZFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5GZWRlcmF0ZWRQcmluY2lwYWwoJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsIHtcbiAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHsgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWQnOiBpZGVudGl0eVBvb2xSZWYgfSxcbiAgICAgICAgICAgICAnRm9yQW55VmFsdWU6U3RyaW5nTGlrZSc6IHsgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAndW5hdXRoZW50aWNhdGVkJyB9LFxuICAgICAgICB9LCAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknKSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVuYXV0aGVudGljYXRlZCBSb2xlIC0gTmVlZHMgUG9saWN5IFJldmlldycsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQWRkIHBvbGljaWVzIHVzaW5nIGFkZFRvUG9saWN5IGluc3RlYWQgb2YgaW5saW5lUG9saWNpZXNcbiAgICAvLyBFeGFtcGxlOiBBbGxvdyByZWFkaW5nIHB1YmxpYyBBUEkgZW5kcG9pbnRzIGlmIGFueVxuICAgIHVuYXV0aFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBcbiAgICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOkludm9rZSddLCBcbiAgICAgICByZXNvdXJjZXM6IFthcGkuYXJuRm9yRXhlY3V0ZUFwaSgnR0VUJywgJy9wdWJsaWMvKicpXSBcbiAgICB9KSk7XG5cbiAgICBjb25zdCBhdXRoUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29nbml0b0F1dGhlbnRpY2F0ZWRSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKCdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb20nLCB7XG4gICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7ICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sUmVmIH0sXG4gICAgICAgICAgICAgJ0ZvckFueVZhbHVlOlN0cmluZ0xpa2UnOiB7ICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yJzogJ2F1dGhlbnRpY2F0ZWQnIH0sXG4gICAgICAgIH0sICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eScpLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gQXV0aGVudGljYXRlZCBSb2xlJyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGQgaW52b2tlIEFQSSBwb2xpY3kgdXNpbmcgYWRkVG9Qb2xpY3lcbiAgICBhdXRoUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOkludm9rZSddLFxuICAgICAgICByZXNvdXJjZXM6IFthcGkuYXJuRm9yRXhlY3V0ZUFwaSgnKicsICcvYXBpLyonKV0gLy8gU2NvcGUgdG8gL2FwaS8qXG4gICAgfSkpO1xuXG4gICAgLy8gQ29nbml0byBSb2xlIEF0dGFjaG1lbnRcbiAgICBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCh0aGlzLCAnQ29nbml0b0lkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50Jywge1xuICAgICAgICBpZGVudGl0eVBvb2xJZDogaWRlbnRpdHlQb29sUmVmLFxuICAgICAgICByb2xlczoge1xuICAgICAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhSb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICBhdXRoZW50aWNhdGVkOiBhdXRoUm9sZS5yb2xlQXJuLFxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnREaXN0cmlidXRpb25JZCcsIHsgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZCB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERvbWFpbk5hbWUnLCB7IHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2Vic2l0ZUJ1Y2tldE5hbWUnLCB7IHZhbHVlOiB1aUJ1Y2tldC5idWNrZXROYW1lIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJZGVudGl0eVBvb2xJZE91dHB1dCcsIHsgdmFsdWU6IGlkZW50aXR5UG9vbFJlZiB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheUVuZHBvaW50JywgeyB2YWx1ZTogYXBpLnVybCB9KTtcblxuICB9XG59ICJdfQ==