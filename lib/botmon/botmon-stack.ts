import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { createTruncatedName } from '../helpers/name-truncation';

// Assuming Bus and Auth constructs are imported from their respective files
import { Bus } from '../bus/bus-stack';
import { Auth } from '../auth/auth-stack';

export interface BotmonProps {
  /**
   * The deployment environment name (e.g., dev, staging, prod)
   */
  environmentName: string;

  /**
   * Reference to the deployed Bus construct
   */
  bus: Bus;

  /**
   * Reference to the deployed Auth construct
   */
  auth: Auth;

  /**
   * Custom JavaScript file path/URL for UI customization (from context/params)
   */
  customJs?: string;

  /**
   * Custom Logins string (from context/params)
   */
  logins?: string;

  /**
   * Whether to create a new Cognito identity pool (true) or use an existing one (false)
   */
  createCognito?: boolean;

  /**
   * ID of existing Cognito identity pool to use if createCognito is false
   */
  existingCognitoId?: string;
}

export class Botmon extends Construct {

  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly cloudfrontDistribution: cloudfront.Distribution;
  public readonly restApi: apigateway.RestApi;
  public readonly uiBucket: s3.Bucket;
  private readonly leoStatsTable: dynamodb.Table;
  public readonly healthCheckTopic: sns.ITopic;
  public readonly leoBotmonSnsRole: iam.IRole;
  private readonly props: BotmonProps;

  constructor(scope: Construct, id: string, props: BotmonProps) {
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
        sortKey: { name: 'bucket', type: dynamodb.AttributeType.STRING }, // Corrected SK
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
        roleName: createTruncatedName(stack.stackName, id, 'BotmonRole', props.environmentName),
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
        roleName: createTruncatedName(stack.stackName, id, 'ApiLambdaRole', props.environmentName),
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
        roleName: createTruncatedName(stack.stackName, id, 'SnsRole', props.environmentName),
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
    const createBotmonLambda = (
        lambdaId: string,
        entryFilePathPart: string, // CHANGED: Expect path like 'system/get' or 'cron/save'
        role: iam.IRole,
        additionalEnv?: { [key: string]: string },
        timeout: cdk.Duration = cdk.Duration.minutes(1),
        memorySize: number = 256,
        defineOptions?: { [key: string]: string }
    ): nodejs.NodejsFunction => {
        const stack = cdk.Stack.of(this);
        // Use a truncated function name format
        const functionName = createTruncatedName(stack.stackName, lambdaId, '', props.environmentName);

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
                    'leo-sdk', // ADD leo-sdk as external for Botmon lambdas
                    'later'    // Mark 'later' as external to avoid bundling issues
                ],
                sourceMap: true,
                define: defineOptions
            },
        });
    }

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
    const showPagesLambda = createBotmonLambda(
        'ShowPages',
        'showPages',
        apiLambdaRole,
        undefined, // No additional env vars
        undefined, // Default timeout
        undefined, // Default memory
        { // Define options for this lambda
            '__CONFIG__': JSON.stringify({}), // Define __CONFIG__ as empty object
            '__PAGES__': JSON.stringify(['index']) // Define __PAGES__ with placeholder page
        }
    );
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
                time: '30 */1 * * * *', // Schedule from CFN
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
    const uiBucket = new s3.Bucket(this, 'websitebucket', {
        bucketName: cdk.Fn.join('-', [stack.stackName.toLowerCase(), id.toLowerCase(), 'ui', props.environmentName.toLowerCase()]),
        websiteIndexDocument: 'index.html',
        websiteErrorDocument: 'index.html',
        publicReadAccess: false, // Access via CloudFront OAI
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
        sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', '..' , 'bus-ui', 'dist'))], // Need correct path
        destinationBucket: uiBucket,
        distribution: distribution,
        distributionPaths: ['/*'], // Invalidate CloudFront cache
    });

    // 7. Cognito Identity Pool & Roles (Refined Policies - Placeholders)
    // ... Identity Pool ...

    let identityPoolRef: string;
    if (props.createCognito !== false) {
      // Create new identity pool if createCognito is true or undefined
      const identityPool = new cognito.CfnIdentityPool(this, 'CognitoIdentityPool', {
          allowUnauthenticatedIdentities: true, // Or false based on requirements
          identityPoolName: cdk.Fn.join('-', [stack.stackName, id, 'IdentityPool', props.environmentName]),
          // cognitoIdentityProviders: [], // Add User Pool info if using one
          // supportedLoginProviders: { ... }, // If using social logins
      });
      this.identityPool = identityPool;
      identityPoolRef = identityPool.ref;
    } else if (props.existingCognitoId) {
      // Use existing identity pool ID
      identityPoolRef = props.existingCognitoId;
      // We need to create a placeholder for the identityPool property
      this.identityPool = {
        ref: props.existingCognitoId
      } as any as cognito.CfnIdentityPool;
    } else {
      throw new Error('Either createCognito must be true or existingCognitoId must be provided');
    }

    const unauthRole = new iam.Role(this, 'CognitoUnauthenticatedRole', {
        roleName: createTruncatedName(stack.stackName, id, 'CognitoUnauthRole', props.environmentName),
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
        roleName: createTruncatedName(stack.stackName, id, 'CognitoAuthRole', props.environmentName),
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