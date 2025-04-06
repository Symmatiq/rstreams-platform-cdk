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
            restApiName: cdk.Fn.join('-', [stack.stackName, id, 'api', props.environmentName]),
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
            tableName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'leostats', props.environmentName]),
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'bucket', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Added stream
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
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'BotmonRole', props.environmentName),
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
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'ApiLambdaRole', props.environmentName),
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
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'SnsRole', props.environmentName),
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
                    Resources: JSON.stringify({ LeoStats: this.leoStatsTable.tableName }),
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
                        'aws-sdk',
                        'leo-sdk',
                        'later' // Mark 'later' as external to avoid bundling issues
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
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
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
            allowMethods: ['GET', 'PUT', 'OPTIONS'],
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            statusCode: 200
        });
        eventSettingsResource.addCorsPreflight({
            allowMethods: ['GET', 'POST', 'OPTIONS'],
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
            '__CONFIG__': JSON.stringify({}),
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
        const healthCheckTopic = new sns.Topic(this, 'HealthCheckSNS', {
            topicName: cdk.Fn.join('-', [stack.stackName, id, 'HealthCheckSNS', props.environmentName]),
        });
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
        new cdk.CustomResource(this, 'LeoRegisterBots', {
            serviceToken: registerServiceToken,
            properties: {
                // Define the bots to register (StatsProcessor, LeoHealthCheck)
                StatsProcessor: {
                    id: 'stats_processor',
                    owner: 'leo',
                    settings: {
                        batch: { size: { count: 1000, time: { seconds: 3 } } },
                        source: 'queue:monitor' // Assuming this queue name is correct
                    },
                    ignoreMonitor: true,
                    paused: false,
                    lambdaName: statsProcessorLambda.functionName
                },
                LeoHealthCheck: {
                    id: 'Leo_health_check',
                    owner: 'leo',
                    time: '30 */1 * * * *',
                    paused: false,
                    lambdaName: leoHealthCheckLambda.functionName
                },
                UpdateTrigger: new Date().toISOString() // Force update
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
        const uiBucket = new s3.Bucket(this, 'WebsiteBucket', {
            bucketName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'ui', props.environmentName]),
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true, // For easy cleanup in dev
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
            sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'bus-ui', 'dist'))],
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
                allowUnauthenticatedIdentities: true,
                identityPoolName: cdk.Fn.join('-', [stack.stackName, id, 'IdentityPool', props.environmentName]),
                // cognitoIdentityProviders: [], // Add User Pool info if using one
                // supportedLoginProviders: { ... }, // If using social logins
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
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'CognitoUnauthRole', props.environmentName),
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
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'CognitoAuthRole', props.environmentName),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm90bW9uLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm90bW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFDdkMseURBQXlEO0FBQ3pELGlEQUFpRDtBQUNqRCx3REFBd0Q7QUFDeEQsMkNBQTJDO0FBQzNDLHlDQUF5QztBQUN6QywwREFBMEQ7QUFDMUQseURBQXlEO0FBQ3pELDhEQUE4RDtBQUM5RCxtREFBbUQ7QUFDbkQsNkNBQTZDO0FBQzdDLDZCQUE2QjtBQUU3QixxREFBcUQ7QUFDckQsMkNBQTJDO0FBRTNDLDJFQUEyRTtBQUMzRSxnRUFBaUU7QUEyQ2pFLE1BQWEsTUFBTyxTQUFRLHNCQUFTO0lBV25DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBa0I7UUFDMUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUVuQixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxrQ0FBa0M7UUFDbEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdEQsV0FBVyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDbEYsV0FBVyxFQUFFLFlBQVk7WUFDekIsYUFBYSxFQUFFO2dCQUNYLFNBQVMsRUFBRSxLQUFLLENBQUMsZUFBZTtnQkFDaEMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2FBQ3ZCO1NBQ0osQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLE9BQU8sR0FB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MUIsSUFBSSxPQUFPLENBQUMsNkJBQTZCLENBQUMsSUFBSSxFQUFFLG1DQUFtQyxFQUFFO1lBQ2pGLGNBQWMsRUFBRSxlQUFlO1lBQy9CLEtBQUssRUFBRTtnQkFDSCxlQUFlLEVBQUUsVUFBVSxDQUFDLE9BQU87Z0JBQ25DLGFBQWEsRUFBRSxRQUFRLENBQUMsT0FBTzthQUNsQztTQUNKLENBQUMsQ0FBQztRQUVILFVBQVU7UUFDVixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFLEVBQUUsS0FBSyxFQUFFLFlBQVksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFDO1FBQzVGLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLHNCQUFzQixFQUFFLENBQUMsQ0FBQztRQUNoRyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQzdFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUM1RSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBRXBFLENBQUM7Q0FDRjtBQTVuQkQsd0JBNG5CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCc7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgc25zU3VicyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnMnO1xuaW1wb3J0ICogYXMgbGFtYmRhRXZlbnRTb3VyY2VzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlcyc7XG5pbXBvcnQgeyBjcmVhdGVUcnVuY2F0ZWROYW1lIH0gZnJvbSAnLi4vaGVscGVycy9uYW1lLXRydW5jYXRpb24nO1xuXG4vLyBBc3N1bWluZyBCdXMgYW5kIEF1dGggY29uc3RydWN0cyBhcmUgaW1wb3J0ZWQgZnJvbSB0aGVpciByZXNwZWN0aXZlIGZpbGVzXG5pbXBvcnQgeyBCdXMgfSBmcm9tICcuLi9idXMvYnVzLXN0YWNrJztcbmltcG9ydCB7IEF1dGggfSBmcm9tICcuLi9hdXRoL2F1dGgtc3RhY2snO1xuXG5leHBvcnQgaW50ZXJmYWNlIEJvdG1vblByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBkZXBsb3ltZW50IGVudmlyb25tZW50IG5hbWUgKGUuZy4sIGRldiwgc3RhZ2luZywgcHJvZClcbiAgICovXG4gIGVudmlyb25tZW50TmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBSZWZlcmVuY2UgdG8gdGhlIGRlcGxveWVkIEJ1cyBjb25zdHJ1Y3RcbiAgICovXG4gIGJ1czogQnVzO1xuXG4gIC8qKlxuICAgKiBSZWZlcmVuY2UgdG8gdGhlIGRlcGxveWVkIEF1dGggY29uc3RydWN0XG4gICAqL1xuICBhdXRoOiBBdXRoO1xuXG4gIC8qKlxuICAgKiBDdXN0b20gSmF2YVNjcmlwdCBmaWxlIHBhdGgvVVJMIGZvciBVSSBjdXN0b21pemF0aW9uIChmcm9tIGNvbnRleHQvcGFyYW1zKVxuICAgKi9cbiAgY3VzdG9tSnM/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEN1c3RvbSBMb2dpbnMgc3RyaW5nIChmcm9tIGNvbnRleHQvcGFyYW1zKVxuICAgKi9cbiAgbG9naW5zPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGNyZWF0ZSBhIG5ldyBDb2duaXRvIGlkZW50aXR5IHBvb2wgKHRydWUpIG9yIHVzZSBhbiBleGlzdGluZyBvbmUgKGZhbHNlKVxuICAgKi9cbiAgY3JlYXRlQ29nbml0bz86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIElEIG9mIGV4aXN0aW5nIENvZ25pdG8gaWRlbnRpdHkgcG9vbCB0byB1c2UgaWYgY3JlYXRlQ29nbml0byBpcyBmYWxzZVxuICAgKi9cbiAgZXhpc3RpbmdDb2duaXRvSWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBCb3Rtb24gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuXG4gIHB1YmxpYyByZWFkb25seSBpZGVudGl0eVBvb2w6IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sO1xuICBwdWJsaWMgcmVhZG9ubHkgY2xvdWRmcm9udERpc3RyaWJ1dGlvbjogY2xvdWRmcm9udC5EaXN0cmlidXRpb247XG4gIHB1YmxpYyByZWFkb25seSByZXN0QXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gIHB1YmxpYyByZWFkb25seSB1aUJ1Y2tldDogczMuQnVja2V0O1xuICBwcml2YXRlIHJlYWRvbmx5IGxlb1N0YXRzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgaGVhbHRoQ2hlY2tUb3BpYzogc25zLklUb3BpYztcbiAgcHVibGljIHJlYWRvbmx5IGxlb0JvdG1vblNuc1JvbGU6IGlhbS5JUm9sZTtcbiAgcHJpdmF0ZSByZWFkb25seSBwcm9wczogQm90bW9uUHJvcHM7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEJvdG1vblByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICB0aGlzLnByb3BzID0gcHJvcHM7XG5cbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcblxuICAgIC8vIDEuIEJvdG1vbiBBUEkgR2F0ZXdheSAoUmVzdEFwaSlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdCb3Rtb25SZXN0QXBpJywge1xuICAgICAgICByZXN0QXBpTmFtZTogY2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZCwgJ2FwaScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0JvdG1vbiBBUEknLFxuICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICBzdGFnZU5hbWU6IHByb3BzLmVudmlyb25tZW50TmFtZSxcbiAgICAgICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5yZXN0QXBpID0gYXBpO1xuICAgIGNvbnN0IGFwaVJvb3QgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYXBpJyk7IC8vIEJhc2UgcGF0aCBmb3IgQVBJXG5cbiAgICAvLyBMZW9TdGF0cyBUYWJsZSAoUmVmaW5lZCBiYXNlZCBvbiBDRk4pXG4gICAgdGhpcy5sZW9TdGF0c1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdMZW9TdGF0cycsIHtcbiAgICAgICAgdGFibGVOYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksICdsZW9zdGF0cycsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgc29ydEtleTogeyBuYW1lOiAnYnVja2V0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ29ycmVjdGVkIFNLXG4gICAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLCAvLyBBZGRlZCBzdHJlYW1cbiAgICB9KTtcbiAgICAvLyBBZGQgR1NJXG4gICAgdGhpcy5sZW9TdGF0c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgICAgaW5kZXhOYW1lOiAncGVyaW9kLXRpbWUtaW5kZXgnLFxuICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3BlcmlvZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3RpbWUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUiB9LFxuICAgICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgICAgbm9uS2V5QXR0cmlidXRlczogWydjdXJyZW50J10sXG4gICAgfSk7XG5cbiAgICAvLyAyLiBJQU0gUm9sZXNcblxuICAgIC8vIExlb0JvdG1vblJvbGUgKFJlZmluZWQgYmFzZWQgb24gQ0ZOKVxuICAgIGNvbnN0IGxlb0JvdG1vblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xlb0JvdG1vblJvbGUnLCB7XG4gICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdCb3Rtb25Sb2xlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICBwcm9wcy5idXMubGVvQm90UG9saWN5LCAvLyBJbXBvcnQgQnVzIHBvbGljeVxuICAgICAgICBdLFxuICAgIH0pO1xuICAgIFxuICAgIGxlb0JvdG1vblJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdMZW9TdGF0c0FjY2VzcycsXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdkeW5hbW9kYjpCYXRjaEdldEl0ZW0nLCAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLCAnZHluYW1vZGI6VXBkYXRlSXRlbScsICdkeW5hbW9kYjpQdXRJdGVtJywgJ2R5bmFtb2RiOlF1ZXJ5JywgJ2R5bmFtb2RiOlNjYW4nLCAnZHluYW1vZGI6R2V0SXRlbSdcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sZW9TdGF0c1RhYmxlLnRhYmxlQXJuXVxuICAgIH0pKTtcblxuICAgIC8vIEFwaVJvbGUgKFJlZmluZWQgYmFzZWQgb24gQ0ZOKVxuICAgIGNvbnN0IGFwaUxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0JvdG1vbkFwaUxhbWJkYVJvbGUnLCB7XG4gICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdBcGlMYW1iZGFSb2xlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICBwcm9wcy5idXMubGVvQm90UG9saWN5LCAvLyBJbXBvcnQgQnVzIHBvbGljeVxuICAgICAgICBdLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIEFkZCBlYWNoIHBvbGljeSBzdGF0ZW1lbnQgZGlyZWN0bHkgdG8gdGhlIHJvbGVcbiAgICBhcGlMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgIHNpZDogJ0ludm9rZVN0YWNrTGFtYmRhcycsXG4gICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJywgJ2xhbWJkYTpJbnZva2VBc3luYyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHtzdGFjay5zdGFja05hbWV9LSpgXVxuICAgIH0pKTtcbiAgICBcbiAgICBhcGlMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgIHNpZDogJ1JlYWRTZWNyZXRzJyxcbiAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpzZWNyZXQ6KmBdIC8vIFNjb3BlIGRvd24gaWYgcG9zc2libGVcbiAgICB9KSk7XG4gICAgXG4gICAgYXBpTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBzaWQ6ICdMZW9TdGF0c0FjY2VzcycsXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdkeW5hbW9kYjpCYXRjaEdldEl0ZW0nLCAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLCAnZHluYW1vZGI6VXBkYXRlSXRlbScsXG4gICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsICdkeW5hbW9kYjpRdWVyeScsICdkeW5hbW9kYjpTY2FuJywgJ2R5bmFtb2RiOkdldEl0ZW0nXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW3RoaXMubGVvU3RhdHNUYWJsZS50YWJsZUFybl1cbiAgICB9KSk7XG4gICAgXG4gICAgYXBpTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBzaWQ6ICdGaWx0ZXJMb2dzJyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkZpbHRlckxvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2xhbWJkYS8qOipgXSAvLyBTY29wZSBkb3duIGlmIHBvc3NpYmxlXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgQnVzL0F1dGggYWNjZXNzIChyZWR1bmRhbnQgaWYgY292ZXJlZCBieSBpbXBvcnRlZCBtYW5hZ2VkIHBvbGljaWVzLCBidXQgZXhwbGljaXQpXG4gICAgcHJvcHMuYnVzLmxlb1N0cmVhbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvQXJjaGl2ZVRhYmxlLmdyYW50UmVhZERhdGEoYXBpTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuYnVzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5idXMubGVvU3lzdGVtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGFwaUxhbWJkYVJvbGUpO1xuICAgIHByb3BzLmJ1cy5sZW9TM0J1Y2tldC5ncmFudFJlYWQoYXBpTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuYXV0aC5sZW9BdXRoVGFibGUuZ3JhbnRSZWFkRGF0YShhcGlMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5hdXRoLmxlb0F1dGhVc2VyVGFibGUuZ3JhbnRSZWFkRGF0YShhcGlMYW1iZGFSb2xlKTtcblxuICAgIC8vIExlb0JvdG1vblNuc1JvbGUgKFJlZmluZWQgYmFzZWQgb24gQ0ZOKVxuICAgIGNvbnN0IGxlb0JvdG1vblNuc1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xlb0JvdG1vblNuc1JvbGUnLCB7XG4gICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdTbnNSb2xlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICBwcm9wcy5idXMubGVvQm90UG9saWN5LFxuICAgICAgICBdLFxuICAgIH0pO1xuICAgIFxuICAgIGxlb0JvdG1vblNuc1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdTTlNQb2xpY3knLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnc25zOkxpc3RUb3BpY3MnLCAnc25zOkxpc3RTdWJzY3JpcHRpb25zQnlUb3BpYycsICdzbnM6R2V0VG9waWNBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAgICdzbnM6Q3JlYXRlVG9waWMnLCAnc25zOlN1YnNjcmliZScsICdzbnM6VW5zdWJzY3JpYmUnLCAnc25zOlB1Ymxpc2gnIC8vIEFkZGVkIFB1Ymxpc2hcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSAvLyBTY29wZSBkb3duIGlmIHBvc3NpYmxlXG4gICAgfSkpO1xuICAgIFxuICAgIHRoaXMubGVvQm90bW9uU25zUm9sZSA9IGxlb0JvdG1vblNuc1JvbGU7XG5cbiAgICAvLyAzLiBCb3Rtb24gTGFtYmRhIEZ1bmN0aW9ucyAoVXBkYXRlIFJvbGVzKVxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiBkZWZpbmVkIElOU0lERSBjb25zdHJ1Y3RvciBvciBhcyBhIHByaXZhdGUgbWV0aG9kIHRvIGFjY2VzcyBpbnN0YW5jZSBtZW1iZXJzXG4gICAgY29uc3QgY3JlYXRlQm90bW9uTGFtYmRhID0gKFxuICAgICAgICBsYW1iZGFJZDogc3RyaW5nLFxuICAgICAgICBlbnRyeUZpbGVQYXRoUGFydDogc3RyaW5nLCAvLyBDSEFOR0VEOiBFeHBlY3QgcGF0aCBsaWtlICdzeXN0ZW0vZ2V0JyBvciAnY3Jvbi9zYXZlJ1xuICAgICAgICByb2xlOiBpYW0uSVJvbGUsXG4gICAgICAgIGFkZGl0aW9uYWxFbnY/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24gPSBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogbnVtYmVyID0gMjU2LFxuICAgICAgICBkZWZpbmVPcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfVxuICAgICk6IG5vZGVqcy5Ob2RlanNGdW5jdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgICAgICAvLyBVc2UgYSB0cnVuY2F0ZWQgZnVuY3Rpb24gbmFtZSBmb3JtYXRcbiAgICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsIGxhbWJkYUlkLCAnJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKTtcblxuICAgICAgICAvLyBVc2UgZW50cnlGaWxlUGF0aFBhcnQgdG8gYnVpbGQgdGhlIGZ1bGwgZW50cnkgcGF0aFxuICAgICAgICBjb25zdCBlbnRyeVBhdGggPSBwYXRoLnJlc29sdmUoYC4vbGFtYmRhL2JvdG1vbi8ke2VudHJ5RmlsZVBhdGhQYXJ0fS9pbmRleC5qc2ApO1xuICAgICAgICBjb25zdCBwcm9qZWN0Um9vdFBhdGggPSBwYXRoLnJlc29sdmUoYC4vYCk7IC8vIE1haW4gcHJvamVjdCByb290XG5cbiAgICAgICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGUgc2V0dXAgdXNpbmcgdGhpcy5wcm9wcyBhbmQgdGhpcy5sZW9TdGF0c1RhYmxlXG4gICAgICAgIGNvbnN0IGxlb1Nka0VudiA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHJlZ2lvbjogc3RhY2sucmVnaW9uLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7XG4gICAgICAgICAgICAgICAgTGVvU3RyZWFtOiB0aGlzLnByb3BzLmJ1cy5sZW9TdHJlYW1UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgTGVvQXJjaGl2ZTogdGhpcy5wcm9wcy5idXMubGVvQXJjaGl2ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBMZW9FdmVudDogdGhpcy5wcm9wcy5idXMubGVvRXZlbnRUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgTGVvU2V0dGluZ3M6IHRoaXMucHJvcHMuYnVzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIExlb1N5c3RlbTogdGhpcy5wcm9wcy5idXMubGVvU3lzdGVtVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIExlb1MzOiB0aGlzLnByb3BzLmJ1cy5sZW9TM0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIExlb0tpbmVzaXNTdHJlYW06IHRoaXMucHJvcHMuYnVzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgICAgICAgICBMZW9GaXJlaG9zZVN0cmVhbTogdGhpcy5wcm9wcy5idXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lLFxuICAgICAgICAgICAgICAgIFJlZ2lvbjogc3RhY2sucmVnaW9uXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBsZW9BdXRoU2RrRW52ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgcmVnaW9uOiBzdGFjay5yZWdpb24sXG4gICAgICAgICAgICByZXNvdXJjZXM6IHtcbiAgICAgICAgICAgICAgICBMZW9BdXRoOiB0aGlzLnByb3BzLmF1dGgubGVvQXV0aFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBMZW9BdXRoVXNlcjogdGhpcy5wcm9wcy5hdXRoLmxlb0F1dGhVc2VyVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIFJlZ2lvbjogc3RhY2sucmVnaW9uXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBsZW9TZGtEYXRhID0gSlNPTi5wYXJzZShsZW9TZGtFbnYpO1xuICAgICAgICBsZW9TZGtEYXRhLnJlc291cmNlcy5MZW9TdGF0cyA9IHRoaXMubGVvU3RhdHNUYWJsZS50YWJsZU5hbWU7IC8vIEFjY2VzcyBpbnN0YW5jZSBtZW1iZXJcbiAgICAgICAgY29uc3QgdXBkYXRlZExlb1Nka0VudiA9IEpTT04uc3RyaW5naWZ5KGxlb1Nka0RhdGEpO1xuXG4gICAgICAgIHJldHVybiBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIGxhbWJkYUlkLCB7XG4gICAgICAgICAgICBmdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIGVudHJ5OiBlbnRyeVBhdGgsIFxuICAgICAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICAgICAgICByb2xlOiByb2xlLFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICAuLi4oYWRkaXRpb25hbEVudiA/PyB7fSksXG4gICAgICAgICAgICAgICAgUmVzb3VyY2VzOiBKU09OLnN0cmluZ2lmeSh7IExlb1N0YXRzOiB0aGlzLmxlb1N0YXRzVGFibGUudGFibGVOYW1lIH0pLCAvLyBBY2Nlc3MgaW5zdGFuY2UgbWVtYmVyXG4gICAgICAgICAgICAgICAgbGVvc2RrOiB1cGRhdGVkTGVvU2RrRW52LFxuICAgICAgICAgICAgICAgIGxlb2F1dGhzZGs6IGxlb0F1dGhTZGtFbnYsXG4gICAgICAgICAgICAgICAgTk9ERV9FTlY6IHRoaXMucHJvcHMuZW52aXJvbm1lbnROYW1lLFxuICAgICAgICAgICAgICAgIEJVU19TVEFDS19OQU1FOiB0aGlzLnByb3BzLmJ1cy5idXNTdGFja05hbWVPdXRwdXQsXG4gICAgICAgICAgICAgICAgTk9ERV9PUFRJT05TOiAnLS1lbmFibGUtc291cmNlLW1hcHMnLFxuICAgICAgICAgICAgICAgIEFXU19OT0RFSlNfQ09OTkVDVElPTl9SRVVTRV9FTkFCTEVEOiAnMScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdGltZW91dDogdGltZW91dCxcbiAgICAgICAgICAgIG1lbW9yeVNpemU6IG1lbW9yeVNpemUsXG4gICAgICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICAgIHByb2plY3RSb290OiBwcm9qZWN0Um9vdFBhdGgsXG4gICAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgICAgICAgICAnYXdzLXNkaycsIC8vIEtlZXAgYXdzLXNkayBleHRlcm5hbFxuICAgICAgICAgICAgICAgICAgICAnbGVvLXNkaycsIC8vIEFERCBsZW8tc2RrIGFzIGV4dGVybmFsIGZvciBCb3Rtb24gbGFtYmRhc1xuICAgICAgICAgICAgICAgICAgICAnbGF0ZXInICAgIC8vIE1hcmsgJ2xhdGVyJyBhcyBleHRlcm5hbCB0byBhdm9pZCBidW5kbGluZyBpc3N1ZXNcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkZWZpbmU6IGRlZmluZU9wdGlvbnNcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLSBTeXN0ZW0gTGFtYmRhcyAtLS0gXG4gICAgLy8gSW5zdGFudGlhdGUgc2VwYXJhdGUgTGFtYmRhcyBmb3IgZWFjaCBhY3Rpb25cbiAgICBjb25zdCBzeXN0ZW1TYXZlTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTeXN0ZW1TYXZlQXBpJywgJ3N5c3RlbS9zYXZlJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3Qgc3lzdGVtR2V0TGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTeXN0ZW1HZXRBcGknLCAnc3lzdGVtL2dldCcsIGFwaUxhbWJkYVJvbGUpO1xuICAgIC8vIGNvbnN0IHN5c3RlbVByb3h5TGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTeXN0ZW1Qcm94eUFwaScsICdzeXN0ZW0vcHJveHknLCBhcGlMYW1iZGFSb2xlKTsgLy8gSWYgcHJveHkgaXMgbmVlZGVkXG5cbiAgICAvLyBTeXN0ZW0gQVBJIEdhdGV3YXkgSW50ZWdyYXRpb25zIChVcGRhdGUgaW50ZWdyYXRpb25zKVxuICAgIGNvbnN0IHN5c3RlbVJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc3lzdGVtJyk7XG4gICAgY29uc3Qgc3lzdGVtSWRSZXNvdXJjZSA9IHN5c3RlbVJlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XG5cbiAgICAvLyBSRUlOU1RBVEUgYWRkQ29yc1ByZWZsaWdodCBmb3IgL3tpZH1cbiAgICBzeXN0ZW1JZFJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdQT1NUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCAvLyBDb25zaWRlciBtb3JlIHNwZWNpZmljIGhlYWRlcnMgaWYgcG9zc2libGVcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gVEhFTiBhZGQgYWN0dWFsIG1ldGhvZHNcbiAgICAvLyBQT1NUIG1ldGhvZHMgcG9pbnQgdG8gc3lzdGVtU2F2ZUxhbWJkYVxuICAgIHN5c3RlbUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc3lzdGVtU2F2ZUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHN5c3RlbVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHN5c3RlbVNhdmVMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICAvLyBHRVQgbWV0aG9kIHBvaW50cyB0byBzeXN0ZW1HZXRMYW1iZGFcbiAgICBzeXN0ZW1JZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc3lzdGVtR2V0TGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgXG4gICAgLy8gS2VlcCBDT1JTIGZvciAvc3lzdGVtIChjb3ZlcnMgaXRzIG93biBQT1NUKVxuICAgICBzeXN0ZW1SZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydQT1NUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG5cbiAgICAvLyAtLS0gRXZlbnRTZXR0aW5ncyBMYW1iZGFzIC0tLSBcbiAgICBjb25zdCBldmVudFNldHRpbmdzR2V0TGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdFdmVudFNldHRpbmdzR2V0QXBpJywgJ2V2ZW50U2V0dGluZ3MvZ2V0JywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3QgZXZlbnRTZXR0aW5nc1NhdmVMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0V2ZW50U2V0dGluZ3NTYXZlQXBpJywgJ2V2ZW50U2V0dGluZ3Mvc2F2ZScsIGFwaUxhbWJkYVJvbGUpOyAvLyBDcmVhdGUgU2F2ZSBsYW1iZGFcblxuICAgIC8vIEV2ZW50U2V0dGluZ3MgQVBJIEdhdGV3YXkgSW50ZWdyYXRpb25zXG4gICAgY29uc3QgZXZlbnRTZXR0aW5nc1Jlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnZXZlbnRzZXR0aW5ncycpO1xuICAgIGNvbnN0IGV2ZW50U2V0dGluZ3NFdmVudFJlc291cmNlID0gZXZlbnRTZXR0aW5nc1Jlc291cmNlLmFkZFJlc291cmNlKCd7ZXZlbnR9Jyk7XG4gICAgXG4gICAgLy8gUG9pbnQgR0VUIG1ldGhvZHMgdG8gR2V0TGFtYmRhXG4gICAgZXZlbnRTZXR0aW5nc0V2ZW50UmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihldmVudFNldHRpbmdzR2V0TGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgZXZlbnRTZXR0aW5nc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZXZlbnRTZXR0aW5nc0dldExhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIFxuICAgIC8vIEFkZCBQT1NUL1BVVCBtZXRob2RzIHBvaW50aW5nIHRvIFNhdmVMYW1iZGEgKGlmIHRoZXkgZXhpc3QgaW4gb3JpZ2luYWwgQ0ZOIC0gYXNzdW1pbmcgdGhleSBtaWdodCBiYXNlZCBvbiBDT1JTKVxuICAgIC8vIFRPRE86IFZlcmlmeSBpZiBQT1NUL1BVVCBhcmUgYWN0dWFsbHkgbmVlZGVkL3VzZWQgZm9yIC9ldmVudHNldHRpbmdzIGFuZCAvZXZlbnRzZXR0aW5ncy97ZXZlbnR9XG4gICAgZXZlbnRTZXR0aW5nc1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGV2ZW50U2V0dGluZ3NTYXZlTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgZXZlbnRTZXR0aW5nc0V2ZW50UmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihldmVudFNldHRpbmdzU2F2ZUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pOyAvLyBBc3N1bWluZyBQVVQgaXMgb24gL3tldmVudH1cblxuICAgIC8vIEFkZCBDT1JTIChDYW4gcG90ZW50aWFsbHkgY29tYmluZSB0aGVzZSBpZiBhbGxvd01ldGhvZHMgbWF0Y2gpXG4gICAgZXZlbnRTZXR0aW5nc0V2ZW50UmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BVVCcsICdPUFRJT05TJ10sIC8vIFVwZGF0ZWQgbWV0aG9kcyBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG4gICAgZXZlbnRTZXR0aW5nc1Jlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdQT1NUJywgJ09QVElPTlMnXSwgLy8gVXBkYXRlZCBtZXRob2RzXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuXG4gICAgLy8gUXVldWVzIGVuZHBvaW50ICh1c2VzIEV2ZW50U2V0dGluZ3NHZXRBcGkgLSBDT1JSRUNULCBwb2ludHMgdG8gR2V0IExhbWJkYSlcbiAgICBjb25zdCBxdWV1ZXNSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3F1ZXVlcycpO1xuICAgIHF1ZXVlc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZXZlbnRTZXR0aW5nc0dldExhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHF1ZXVlc1Jlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdPUFRJT05TJ10sIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcblxuICAgIC8vIC0tLSBEYXNoYm9hcmQgTGFtYmRhIC0tLSAoQXNzdW1pbmcgJ2Rhc2hib2FyZCcgZGlyZWN0b3J5IGhhcyBpbmRleC5qcylcbiAgICBjb25zdCBkYXNoYm9hcmRMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0Rhc2hib2FyZEFwaScsICdkYXNoYm9hcmQnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBkYXNoYm9hcmRSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2Rhc2hib2FyZCcpO1xuICAgIGNvbnN0IGRhc2hib2FyZFR5cGVSZXNvdXJjZSA9IGRhc2hib2FyZFJlc291cmNlLmFkZFJlc291cmNlKCd7dHlwZX0nKTtcbiAgICBjb25zdCBkYXNoYm9hcmRUeXBlSWRSZXNvdXJjZSA9IGRhc2hib2FyZFR5cGVSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xuICAgIGRhc2hib2FyZFR5cGVJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZGFzaGJvYXJkTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgZGFzaGJvYXJkVHlwZUlkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuICAgIC8vIEFkZCBpbnRlZ3JhdGlvbiBmb3IgL2FwaS9kYXNoYm9hcmQve3R5cGV9XG4gICAgZGFzaGJvYXJkVHlwZVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZGFzaGJvYXJkTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgZGFzaGJvYXJkVHlwZVJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdPUFRJT05TJ10sIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcblxuICAgIC8vIC0tLSBDcm9uIExhbWJkYXMgLS0tIChVcGRhdGUgcGF0aHMgYmFzZWQgb24gYWN0dWFsIHN0cnVjdHVyZSlcbiAgICBjb25zdCBjcm9uU2F2ZUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnQ3JvblNhdmVBcGknLCAnY3Jvbi9zYXZlJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3QgY3JvbkRlbGV0ZUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnQ3JvbkRlbGV0ZUFwaScsICdjcm9uL2RlbGV0ZScsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IGNyb25TYXZlT3ZlcnJpZGVzTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdMZW9Dcm9uU2F2ZU92ZXJyaWRlcycsICdjcm9uL3NhdmVPdmVycmlkZXMnLCBhcGlMYW1iZGFSb2xlKTtcbiAgICBjb25zdCBjcm9uR2V0TGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdDcm9uR2V0QXBpJywgJ2Nyb24vZ2V0JywgYXBpTGFtYmRhUm9sZSk7XG4gICAgLy8gLi4uIChyZXN0IG9mIENyb24vQm90IGludGVncmF0aW9ucyBuZWVkIHRvIHBvaW50IHRvIHRoZSBjb3JyZWN0IGxhbWJkYSB2YXJpYWJsZXMpIC4uLlxuXG4gICAgLy8gLS0tIFNob3dQYWdlcyBMYW1iZGEgLS0tIFxuICAgIGNvbnN0IHNob3dQYWdlc0xhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYShcbiAgICAgICAgJ1Nob3dQYWdlcycsXG4gICAgICAgICdzaG93UGFnZXMnLFxuICAgICAgICBhcGlMYW1iZGFSb2xlLFxuICAgICAgICB1bmRlZmluZWQsIC8vIE5vIGFkZGl0aW9uYWwgZW52IHZhcnNcbiAgICAgICAgdW5kZWZpbmVkLCAvLyBEZWZhdWx0IHRpbWVvdXRcbiAgICAgICAgdW5kZWZpbmVkLCAvLyBEZWZhdWx0IG1lbW9yeVxuICAgICAgICB7IC8vIERlZmluZSBvcHRpb25zIGZvciB0aGlzIGxhbWJkYVxuICAgICAgICAgICAgJ19fQ09ORklHX18nOiBKU09OLnN0cmluZ2lmeSh7fSksIC8vIERlZmluZSBfX0NPTkZJR19fIGFzIGVtcHR5IG9iamVjdFxuICAgICAgICAgICAgJ19fUEFHRVNfXyc6IEpTT04uc3RyaW5naWZ5KFsnaW5kZXgnXSkgLy8gRGVmaW5lIF9fUEFHRVNfXyB3aXRoIHBsYWNlaG9sZGVyIHBhZ2VcbiAgICAgICAgfVxuICAgICk7XG4gICAgY29uc3QgaW5kZXhSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdpbmRleCcpO1xuICAgIGluZGV4UmVzb3VyY2UuYWRkTWV0aG9kKCdBTlknLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzaG93UGFnZXNMYW1iZGEpKTtcbiAgICAvLyBBZGQgaW50ZWdyYXRpb24gZm9yIHJvb3QgcGF0aFxuICAgIGFwaS5yb290LmFkZE1ldGhvZCgnQU5ZJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2hvd1BhZ2VzTGFtYmRhKSk7XG4gICAgLy8gQWRkIGludGVncmF0aW9uIGZvciAvZ21haWxsb2dpbi5odG1sXG4gICAgY29uc3QgZ21haWxMb2dpblJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2dtYWlsbG9naW4uaHRtbCcpO1xuICAgIGdtYWlsTG9naW5SZXNvdXJjZS5hZGRNZXRob2QoJ0FOWScsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNob3dQYWdlc0xhbWJkYSkpO1xuXG4gICAgLy8gLS0tIE90aGVyIExhbWJkYXMgLS0tIChVcGRhdGUgcGF0aHMgYXMgbmVlZGVkKVxuICAgIGNvbnN0IHN0YXRzUHJvY2Vzc29yTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTdGF0c1Byb2Nlc3NvcicsICdzdGF0cy1wcm9jZXNzb3InLCBsZW9Cb3Rtb25Sb2xlKTtcbiAgICBzdGF0c1Byb2Nlc3NvckxhbWJkYS5hZGRFdmVudFNvdXJjZU1hcHBpbmcoJ0J1c0tpbmVzaXNTb3VyY2UnLCB7XG4gICAgICAgIGV2ZW50U291cmNlQXJuOiBwcm9wcy5idXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1Bcm4sXG4gICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IGxhbWJkYS5TdGFydGluZ1Bvc2l0aW9uLkxBVEVTVCxcbiAgICAgICAgYmF0Y2hTaXplOiAxMDAsIC8vIEFkanVzdCBhcyBuZWVkZWRcbiAgICB9KTtcblxuICAgIC8vIEhlYWx0aENoZWNrIFNOUyBUb3BpY1xuICAgIGNvbnN0IGhlYWx0aENoZWNrVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdIZWFsdGhDaGVja1NOUycsIHtcbiAgICAgICAgdG9waWNOYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLCAnSGVhbHRoQ2hlY2tTTlMnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKSxcbiAgICB9KTtcbiAgICB0aGlzLmhlYWx0aENoZWNrVG9waWMgPSBoZWFsdGhDaGVja1RvcGljO1xuXG4gICAgLy8gSGVhbHRoU05TIExhbWJkYSAoUGxhY2Vob2xkZXIgLSBQcm9jZXNzZXMgU05TIG1lc3NhZ2VzIGZyb20gSGVhbHRoQ2hlY2tUb3BpYylcbiAgICBjb25zdCBoZWFsdGhTbnNMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ0hlYWx0aFNOUycsICdoZWFsdGhTTlMnLCBsZW9Cb3Rtb25TbnNSb2xlKTtcbiAgICBoZWFsdGhTbnNMYW1iZGEuYWRkRXZlbnRTb3VyY2UobmV3IGxhbWJkYUV2ZW50U291cmNlcy5TbnNFdmVudFNvdXJjZShoZWFsdGhDaGVja1RvcGljKSk7XG5cbiAgICAvLyBMZW9IZWFsdGhDaGVjayBMYW1iZGFcbiAgICBjb25zdCBsZW9IZWFsdGhDaGVja0xhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnTGVvSGVhbHRoQ2hlY2snLCAnaGVhbHRoU05TJywgYXBpTGFtYmRhUm9sZSwge1xuICAgICAgICAvLyBQYXNzIFNOUyBUb3BpYyBBUk4gYW5kIEFQSSBHYXRld2F5IFVSTCB0byBlbnZpcm9ubWVudFxuICAgICAgICBIRUFMVEhDSEVDS19TTlNfVE9QSUNfQVJOOiBoZWFsdGhDaGVja1RvcGljLnRvcGljQXJuLFxuICAgICAgICBET01BSU5fVVJMOiBgaHR0cHM6Ly8ke2FwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7c3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMuZW52aXJvbm1lbnROYW1lfWAsIC8vIENvbnN0cnVjdCBBUEkgR1cgVVJMXG4gICAgfSk7XG4gICAgLy8gQWRkIHBlcm1pc3Npb24gZm9yIFNOUyB0byBwdWJsaXNoIHRvIHRoZSB0b3BpYyBpZiBuZWVkZWQgYnkgaGVhbHRoIGNoZWNrP1xuICAgIGhlYWx0aENoZWNrVG9waWMuZ3JhbnRQdWJsaXNoKGxlb0hlYWx0aENoZWNrTGFtYmRhKTsgLy8gSGVhbHRoQ2hlY2sgbGFtYmRhIG5lZWRzIHRvIHB1Ymxpc2ggcmVzdWx0cyB0byB0aGUgdG9waWNcblxuICAgIC8vIExlb1JlZ2lzdGVyIEN1c3RvbSBSZXNvdXJjZVxuICAgIC8vIFVzZSB0aGUgc2VydmljZSB0b2tlbiBkaXJlY3RseSBmcm9tIHRoZSBCdXMgY29uc3RydWN0IGluc3RlYWQgb2YgaW1wb3J0aW5nXG4gICAgY29uc3QgcmVnaXN0ZXJTZXJ2aWNlVG9rZW4gPSBwcm9wcy5idXMuaW5zdGFsbFRyaWdnZXJTZXJ2aWNlVG9rZW47XG5cbiAgICBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdMZW9SZWdpc3RlckJvdHMnLCB7XG4gICAgICAgIHNlcnZpY2VUb2tlbjogcmVnaXN0ZXJTZXJ2aWNlVG9rZW4sXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgIC8vIERlZmluZSB0aGUgYm90cyB0byByZWdpc3RlciAoU3RhdHNQcm9jZXNzb3IsIExlb0hlYWx0aENoZWNrKVxuICAgICAgICAgICAgU3RhdHNQcm9jZXNzb3I6IHtcbiAgICAgICAgICAgICAgICBpZDogJ3N0YXRzX3Byb2Nlc3NvcicsXG4gICAgICAgICAgICAgICAgb3duZXI6ICdsZW8nLFxuICAgICAgICAgICAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgICAgICAgICAgICAgIGJhdGNoOiB7IHNpemU6IHsgY291bnQ6IDEwMDAsIHRpbWU6IHsgc2Vjb25kczogMyB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgc291cmNlOiAncXVldWU6bW9uaXRvcicgLy8gQXNzdW1pbmcgdGhpcyBxdWV1ZSBuYW1lIGlzIGNvcnJlY3RcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGlnbm9yZU1vbml0b3I6IHRydWUsXG4gICAgICAgICAgICAgICAgcGF1c2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBsYW1iZGFOYW1lOiBzdGF0c1Byb2Nlc3NvckxhbWJkYS5mdW5jdGlvbk5hbWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBMZW9IZWFsdGhDaGVjazoge1xuICAgICAgICAgICAgICAgIGlkOiAnTGVvX2hlYWx0aF9jaGVjaycsXG4gICAgICAgICAgICAgICAgb3duZXI6ICdsZW8nLFxuICAgICAgICAgICAgICAgIHRpbWU6ICczMCAqLzEgKiAqICogKicsIC8vIFNjaGVkdWxlIGZyb20gQ0ZOXG4gICAgICAgICAgICAgICAgcGF1c2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBsYW1iZGFOYW1lOiBsZW9IZWFsdGhDaGVja0xhbWJkYS5mdW5jdGlvbk5hbWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBVcGRhdGVUcmlnZ2VyOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgLy8gRm9yY2UgdXBkYXRlXG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFN0YXRzQXBpIExhbWJkYSAmIEludGVncmF0aW9uXG4gICAgY29uc3Qgc3RhdHNMYW1iZGEgPSBjcmVhdGVCb3Rtb25MYW1iZGEoJ1N0YXRzQXBpJywgJ3N0YXRzJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3Qgc3RhdHNSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3N0YXRzX3YyJyk7IC8vIFBhdGggZnJvbSBDRk5cbiAgICBzdGF0c1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc3RhdHNMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBzdGF0c1Jlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdPUFRJT05TJ10sIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcblxuICAgIC8vIFNuc0FwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvbiAoVXBkYXRlIFJvbGUpXG4gICAgY29uc3Qgc25zQXBpTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTbnNBcGknLCAnc25zJywgbGVvQm90bW9uU25zUm9sZSk7XG4gICAgY29uc3Qgc25zR2V0UmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdzbnNfZ2V0Jyk7XG4gICAgc25zR2V0UmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzbnNBcGlMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBzbnNHZXRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG4gICAgY29uc3Qgc25zU2F2ZVJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc25zX3NhdmUnKS5hZGRSZXNvdXJjZSgne3R5cGV9JykuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcbiAgICBzbnNTYXZlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc25zQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc25zU2F2ZVJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ1BPU1QnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBTZXR0aW5nc0FwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IHNldHRpbmdzQXBpTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTZXR0aW5nc0FwaScsICdzZXR0aW5ncycsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IHNldHRpbmdzUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdzZXR0aW5ncycpO1xuICAgIHNldHRpbmdzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzZXR0aW5nc0FwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHNldHRpbmdzUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh7IFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ09QVElPTlMnXSwgXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLCBcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBhcGlnYXRld2F5LkNvcnMuREVGQVVMVF9IRUFERVJTLCBcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwIFxuICAgIH0pO1xuICAgIGNvbnN0IHNldHRpbmdzSWRSZXNvdXJjZSA9IHNldHRpbmdzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcbiAgICBzZXR0aW5nc0lkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzZXR0aW5nc0FwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIHNldHRpbmdzSWRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBTZWFyY2hRdWV1ZUFwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IHNlYXJjaFF1ZXVlQXBpTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdTZWFyY2hRdWV1ZUFwaScsICdzZWFyY2hRdWV1ZScsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IHNlYXJjaFJlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2VhcmNoJyk7XG4gICAgY29uc3Qgc2VhcmNoUXVldWVSZXNvdXJjZSA9IHNlYXJjaFJlc291cmNlLmFkZFJlc291cmNlKCd7cXVldWV9Jyk7XG4gICAgY29uc3Qgc2VhcmNoUXVldWVTdGFydFJlc291cmNlID0gc2VhcmNoUXVldWVSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3N0YXJ0fScpO1xuICAgIHNlYXJjaFF1ZXVlU3RhcnRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNlYXJjaFF1ZXVlQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgc2VhcmNoUXVldWVTdGFydFJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQoeyBcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdPUFRJT05TJ10sIFxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgXG4gICAgICAgIGFsbG93SGVhZGVyczogYXBpZ2F0ZXdheS5Db3JzLkRFRkFVTFRfSEVBREVSUywgXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCBcbiAgICB9KTtcbiAgICBjb25zdCBzZWFyY2hRdWV1ZVN0YXJ0UXVlcnlSZXNvdXJjZSA9IHNlYXJjaFF1ZXVlU3RhcnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3F1ZXJ5fScpO1xuICAgIHNlYXJjaFF1ZXVlU3RhcnRRdWVyeVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2VhcmNoUXVldWVBcGlMYW1iZGEpLCB7IGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSB9KTtcbiAgICBzZWFyY2hRdWV1ZVN0YXJ0UXVlcnlSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBRdWV1ZVNjaGVtYUFwaSBMYW1iZGEgJiBJbnRlZ3JhdGlvblxuICAgIGNvbnN0IHF1ZXVlU2NoZW1hQXBpTGFtYmRhID0gY3JlYXRlQm90bW9uTGFtYmRhKCdRdWV1ZVNjaGVtYUFwaScsICdxdWV1ZVNjaGVtYScsIGFwaUxhbWJkYVJvbGUpO1xuICAgIGNvbnN0IHF1ZXVlU2NoZW1hUmVzb3VyY2UgPSBhcGlSb290LmFkZFJlc291cmNlKCdxdWV1ZVNjaGVtYScpLmFkZFJlc291cmNlKCd7cXVldWV9Jyk7XG4gICAgcXVldWVTY2hlbWFSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHF1ZXVlU2NoZW1hQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgcXVldWVTY2hlbWFSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBMb2dzQXBpIExhbWJkYSAmIEludGVncmF0aW9uXG4gICAgY29uc3QgbG9nc0FwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnTG9nc0FwaScsICdsb2dzJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3QgbG9nc1Jlc291cmNlID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnbG9ncycpLmFkZFJlc291cmNlKCd7bGFtYmRhfScpLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgbG9nc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24obG9nc0FwaUxhbWJkYSksIHsgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNIH0pO1xuICAgIGxvZ3NSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyBFdmVudFRyYWNlQXBpIExhbWJkYSAmIEludGVncmF0aW9uXG4gICAgY29uc3QgZXZlbnRUcmFjZUFwaUxhbWJkYSA9IGNyZWF0ZUJvdG1vbkxhbWJkYSgnRXZlbnRUcmFjZUFwaScsICdldmVudFRyYWNlJywgYXBpTGFtYmRhUm9sZSk7XG4gICAgY29uc3QgdHJhY2VSZXNvdXJjZSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3RyYWNlJykuYWRkUmVzb3VyY2UoJ3txdWV1ZX0nKS5hZGRSZXNvdXJjZSgne2lkfScpO1xuICAgIHRyYWNlUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihldmVudFRyYWNlQXBpTGFtYmRhKSwgeyBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0gfSk7XG4gICAgdHJhY2VSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHsgXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnT1BUSU9OUyddLCBcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsIFxuICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWdhdGV3YXkuQ29ycy5ERUZBVUxUX0hFQURFUlMsIFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAgXG4gICAgfSk7XG5cbiAgICAvLyA0LiBTMyBCdWNrZXQgZm9yIFVJIChXZWJzaXRlQnVja2V0KVxuICAgIGNvbnN0IHVpQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnV2Vic2l0ZUJ1Y2tldCcsIHtcbiAgICAgICAgYnVja2V0TmFtZTogY2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZC50b0xvd2VyQ2FzZSgpLCAndWknLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKSxcbiAgICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6ICdpbmRleC5odG1sJyxcbiAgICAgICAgd2Vic2l0ZUVycm9yRG9jdW1lbnQ6ICdpbmRleC5odG1sJyxcbiAgICAgICAgcHVibGljUmVhZEFjY2VzczogZmFsc2UsIC8vIEFjY2VzcyB2aWEgQ2xvdWRGcm9udCBPQUlcbiAgICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsIC8vIEZvciBlYXN5IGNsZWFudXAgaW4gZGV2XG4gICAgfSk7XG4gICAgdGhpcy51aUJ1Y2tldCA9IHVpQnVja2V0O1xuXG4gICAgLy8gNS4gQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gKENsb3VkZnJvbnREaXN0cmlidXRpb24pXG4gICAgY29uc3Qgb3JpZ2luQWNjZXNzSWRlbnRpdHkgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5BY2Nlc3NJZGVudGl0eSh0aGlzLCAnT0FJJyk7XG4gICAgdWlCdWNrZXQuZ3JhbnRSZWFkKG9yaWdpbkFjY2Vzc0lkZW50aXR5KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCAnQ2xvdWRmcm9udERpc3RyaWJ1dGlvbicsIHtcbiAgICAgICAgZGVmYXVsdFJvb3RPYmplY3Q6ICdpbmRleC5odG1sJyxcbiAgICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHVpQnVja2V0LCB7IG9yaWdpbkFjY2Vzc0lkZW50aXR5IH0pLFxuICAgICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEFkZCBiZWhhdmlvciBmb3IgQVBJIEdhdGV3YXlcbiAgICAgICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgICAgICAgJy9hcGkvKic6IHtcbiAgICAgICAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlJlc3RBcGlPcmlnaW4oYXBpKSxcbiAgICAgICAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICAgICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgICAgICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSX0VYQ0VQVF9IT1NUX0hFQURFUixcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5taW51dGVzKDApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICAgICAgdHRsOiBjZGsuRHVyYXRpb24ubWludXRlcygwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHByaWNlQ2xhc3M6IGNsb3VkZnJvbnQuUHJpY2VDbGFzcy5QUklDRV9DTEFTU18xMDAsIC8vIEFkanVzdCBhcyBuZWVkZWRcbiAgICB9KTtcbiAgICB0aGlzLmNsb3VkZnJvbnREaXN0cmlidXRpb24gPSBkaXN0cmlidXRpb247XG5cbiAgICAvLyA2LiBTMyBEZXBsb3ltZW50IChEZXBsb3lXZWJzaXRlKVxuICAgIC8vIEFzc3VtZXMgVUkgYnVpbGQgb3V0cHV0IGlzIGluIC4uL2J1cy11aS9kaXN0IChvciBzaW1pbGFyKVxuICAgIC8vIFRPRE86IENvbmZpcm0gVUkgYnVpbGQgb3V0cHV0IHBhdGhcbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95V2Vic2l0ZScsIHtcbiAgICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnLi4nICwgJ2J1cy11aScsICdkaXN0JykpXSwgLy8gTmVlZCBjb3JyZWN0IHBhdGhcbiAgICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHVpQnVja2V0LFxuICAgICAgICBkaXN0cmlidXRpb246IGRpc3RyaWJ1dGlvbixcbiAgICAgICAgZGlzdHJpYnV0aW9uUGF0aHM6IFsnLyonXSwgLy8gSW52YWxpZGF0ZSBDbG91ZEZyb250IGNhY2hlXG4gICAgfSk7XG5cbiAgICAvLyA3LiBDb2duaXRvIElkZW50aXR5IFBvb2wgJiBSb2xlcyAoUmVmaW5lZCBQb2xpY2llcyAtIFBsYWNlaG9sZGVycylcbiAgICAvLyAuLi4gSWRlbnRpdHkgUG9vbCAuLi5cblxuICAgIGxldCBpZGVudGl0eVBvb2xSZWY6IHN0cmluZztcbiAgICBpZiAocHJvcHMuY3JlYXRlQ29nbml0byAhPT0gZmFsc2UpIHtcbiAgICAgIC8vIENyZWF0ZSBuZXcgaWRlbnRpdHkgcG9vbCBpZiBjcmVhdGVDb2duaXRvIGlzIHRydWUgb3IgdW5kZWZpbmVkXG4gICAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2wodGhpcywgJ0NvZ25pdG9JZGVudGl0eVBvb2wnLCB7XG4gICAgICAgICAgYWxsb3dVbmF1dGhlbnRpY2F0ZWRJZGVudGl0aWVzOiB0cnVlLCAvLyBPciBmYWxzZSBiYXNlZCBvbiByZXF1aXJlbWVudHNcbiAgICAgICAgICBpZGVudGl0eVBvb2xOYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLCAnSWRlbnRpdHlQb29sJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksXG4gICAgICAgICAgLy8gY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbXSwgLy8gQWRkIFVzZXIgUG9vbCBpbmZvIGlmIHVzaW5nIG9uZVxuICAgICAgICAgIC8vIHN1cHBvcnRlZExvZ2luUHJvdmlkZXJzOiB7IC4uLiB9LCAvLyBJZiB1c2luZyBzb2NpYWwgbG9naW5zXG4gICAgICB9KTtcbiAgICAgIHRoaXMuaWRlbnRpdHlQb29sID0gaWRlbnRpdHlQb29sO1xuICAgICAgaWRlbnRpdHlQb29sUmVmID0gaWRlbnRpdHlQb29sLnJlZjtcbiAgICB9IGVsc2UgaWYgKHByb3BzLmV4aXN0aW5nQ29nbml0b0lkKSB7XG4gICAgICAvLyBVc2UgZXhpc3RpbmcgaWRlbnRpdHkgcG9vbCBJRFxuICAgICAgaWRlbnRpdHlQb29sUmVmID0gcHJvcHMuZXhpc3RpbmdDb2duaXRvSWQ7XG4gICAgICAvLyBXZSBuZWVkIHRvIGNyZWF0ZSBhIHBsYWNlaG9sZGVyIGZvciB0aGUgaWRlbnRpdHlQb29sIHByb3BlcnR5XG4gICAgICB0aGlzLmlkZW50aXR5UG9vbCA9IHtcbiAgICAgICAgcmVmOiBwcm9wcy5leGlzdGluZ0NvZ25pdG9JZFxuICAgICAgfSBhcyBhbnkgYXMgY29nbml0by5DZm5JZGVudGl0eVBvb2w7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRWl0aGVyIGNyZWF0ZUNvZ25pdG8gbXVzdCBiZSB0cnVlIG9yIGV4aXN0aW5nQ29nbml0b0lkIG11c3QgYmUgcHJvdmlkZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCB1bmF1dGhSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2duaXRvVW5hdXRoZW50aWNhdGVkUm9sZScsIHtcbiAgICAgICAgcm9sZU5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ0NvZ25pdG9VbmF1dGhSb2xlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbCgnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tJywge1xuICAgICAgICAgICAgIFN0cmluZ0VxdWFsczogeyAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmF1ZCc6IGlkZW50aXR5UG9vbFJlZiB9LFxuICAgICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzogeyAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmFtcic6ICd1bmF1dGhlbnRpY2F0ZWQnIH0sXG4gICAgICAgIH0sICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eScpLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVW5hdXRoZW50aWNhdGVkIFJvbGUgLSBOZWVkcyBQb2xpY3kgUmV2aWV3JyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGQgcG9saWNpZXMgdXNpbmcgYWRkVG9Qb2xpY3kgaW5zdGVhZCBvZiBpbmxpbmVQb2xpY2llc1xuICAgIC8vIEV4YW1wbGU6IEFsbG93IHJlYWRpbmcgcHVibGljIEFQSSBlbmRwb2ludHMgaWYgYW55XG4gICAgdW5hdXRoUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgIGFjdGlvbnM6IFsnZXhlY3V0ZS1hcGk6SW52b2tlJ10sIFxuICAgICAgIHJlc291cmNlczogW2FwaS5hcm5Gb3JFeGVjdXRlQXBpKCdHRVQnLCAnL3B1YmxpYy8qJyldIFxuICAgIH0pKTtcblxuICAgIGNvbnN0IGF1dGhSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2duaXRvQXV0aGVudGljYXRlZFJvbGUnLCB7XG4gICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdDb2duaXRvQXV0aFJvbGUnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKCdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb20nLCB7XG4gICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7ICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sUmVmIH0sXG4gICAgICAgICAgICAgJ0ZvckFueVZhbHVlOlN0cmluZ0xpa2UnOiB7ICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yJzogJ2F1dGhlbnRpY2F0ZWQnIH0sXG4gICAgICAgIH0sICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eScpLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gQXV0aGVudGljYXRlZCBSb2xlJyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGQgaW52b2tlIEFQSSBwb2xpY3kgdXNpbmcgYWRkVG9Qb2xpY3lcbiAgICBhdXRoUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IFxuICAgICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOkludm9rZSddLFxuICAgICAgICByZXNvdXJjZXM6IFthcGkuYXJuRm9yRXhlY3V0ZUFwaSgnKicsICcvYXBpLyonKV0gLy8gU2NvcGUgdG8gL2FwaS8qXG4gICAgfSkpO1xuXG4gICAgLy8gQ29nbml0byBSb2xlIEF0dGFjaG1lbnRcbiAgICBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCh0aGlzLCAnQ29nbml0b0lkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50Jywge1xuICAgICAgICBpZGVudGl0eVBvb2xJZDogaWRlbnRpdHlQb29sUmVmLFxuICAgICAgICByb2xlczoge1xuICAgICAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhSb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICBhdXRoZW50aWNhdGVkOiBhdXRoUm9sZS5yb2xlQXJuLFxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnREaXN0cmlidXRpb25JZCcsIHsgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZCB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERvbWFpbk5hbWUnLCB7IHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2Vic2l0ZUJ1Y2tldE5hbWUnLCB7IHZhbHVlOiB1aUJ1Y2tldC5idWNrZXROYW1lIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJZGVudGl0eVBvb2xJZE91dHB1dCcsIHsgdmFsdWU6IGlkZW50aXR5UG9vbFJlZiB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheUVuZHBvaW50JywgeyB2YWx1ZTogYXBpLnVybCB9KTtcblxuICB9XG59ICJdfQ==