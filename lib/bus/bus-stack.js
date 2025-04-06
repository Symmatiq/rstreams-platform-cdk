"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bus = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const nodejs = require("aws-cdk-lib/aws-lambda-nodejs");
const kinesis = require("aws-cdk-lib/aws-kinesis");
const firehose = require("aws-cdk-lib/aws-kinesisfirehose"); // Use L1 construct if L2 is unavailable/insufficient
const s3 = require("aws-cdk-lib/aws-s3");
const logs = require("aws-cdk-lib/aws-logs");
const path = require("path");
const s3n = require("aws-cdk-lib/aws-s3-notifications");
const cr = require("aws-cdk-lib/custom-resources");
const name_truncation_1 = require("../helpers/name-truncation");
class Bus extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const stack = cdk.Stack.of(this);
        const exportPrefix = props.exportNamePrefix ?? stack.stackName;
        const isTrustingAccount = props.trustedArns && props.trustedArns.length > 0;
        // Define resources based on bus/cloudformation.json translation
        // 1. S3 Bucket (LeoS3)
        const leoS3 = new s3.Bucket(this, 'LeoS3', {
            bucketName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 's3', props.environmentName]),
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // Add versioning, encryption, lifecycle rules as needed from CFN
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });
        this.leoS3Bucket = leoS3;
        new cdk.CfnOutput(this, 'LeoS3Output', {
            value: leoS3.bucketName,
            exportName: `${exportPrefix}-LeoS3`
        });
        // 2. DynamoDB Tables (LeoStream, LeoArchive, LeoEvent, LeoSettings, LeoCron, LeoSystem)
        const createLeoTable = (tableName, partitionKey, sortKey, stream) => {
            const table = new dynamodb.Table(this, tableName, {
                tableName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), tableName.toLowerCase(), props.environmentName]),
                partitionKey: partitionKey,
                sortKey: sortKey,
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                stream: stream,
                pointInTimeRecovery: true, // Enable PITR by default
            });
            new cdk.CfnOutput(this, `${tableName}Output`, {
                value: table.tableName,
                exportName: `${exportPrefix}-${tableName}`
            });
            return table;
        };
        this.leoStreamTable = createLeoTable('LeoStream', { name: 'event', type: dynamodb.AttributeType.STRING }, { name: 'eid', type: dynamodb.AttributeType.STRING }, dynamodb.StreamViewType.NEW_IMAGE);
        // Add TTL to LeoStream table if streamTTLSeconds is provided
        if (props.streamTTLSeconds) {
            const cfnLeoStreamTable = this.leoStreamTable.node.defaultChild;
            cfnLeoStreamTable.timeToLiveSpecification = {
                attributeName: 'ttl',
                enabled: true
            };
        }
        this.leoArchiveTable = createLeoTable('LeoArchive', { name: 'id', type: dynamodb.AttributeType.STRING });
        this.leoEventTable = createLeoTable('LeoEvent', { name: 'event', type: dynamodb.AttributeType.STRING }, { name: 'sk', type: dynamodb.AttributeType.STRING }, dynamodb.StreamViewType.NEW_AND_OLD_IMAGES);
        this.leoSettingsTable = createLeoTable('LeoSettings', { name: 'id', type: dynamodb.AttributeType.STRING });
        this.leoCronTable = createLeoTable('LeoCron', { name: 'id', type: dynamodb.AttributeType.STRING }, undefined, dynamodb.StreamViewType.NEW_AND_OLD_IMAGES);
        this.leoSystemTable = createLeoTable('LeoSystem', { name: 'id', type: dynamodb.AttributeType.STRING });
        // 3. Kinesis Stream (LeoKinesisStream)
        const leoKinesis = new kinesis.Stream(this, 'LeoKinesisStream', {
            streamName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'kinesis', props.environmentName]),
            shardCount: props.kinesisShards ?? 1,
            // retentionPeriod: cdk.Duration.hours(24), // Default is 24h
            streamMode: props.kinesisShards ? kinesis.StreamMode.PROVISIONED : kinesis.StreamMode.ON_DEMAND, // Use provisioned if shards specified
        });
        this.leoKinesisStream = leoKinesis;
        new cdk.CfnOutput(this, 'LeoKinesisStreamOutput', {
            value: leoKinesis.streamName,
            exportName: `${exportPrefix}-LeoKinesisStream`
        });
        // 4. IAM Roles & Policies
        // LeoBotPolicy (Managed Policy based on CFN)
        const botPolicy = new iam.ManagedPolicy(this, 'LeoBotPolicy', {
            managedPolicyName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'LeoBotPolicy', props.environmentName),
            description: 'Common policy for Leo Bus Lambdas',
            statements: [
                new iam.PolicyStatement({
                    sid: 'LeoCronAccess',
                    actions: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Scan'],
                    resources: [this.leoCronTable.tableArn]
                }),
                new iam.PolicyStatement({
                    sid: 'EventBridgeCronManagement',
                    actions: ['events:PutRule', 'events:PutTargets', 'events:DeleteRule', 'events:RemoveTargets', 'events:DescribeRule'],
                    resources: [`arn:aws:events:${stack.region}:${stack.account}:rule/${stack.stackName}-${id.toLowerCase()}-*`]
                }),
                new iam.PolicyStatement({
                    sid: 'LambdaEventBridgePermissions',
                    actions: ['lambda:AddPermission', 'lambda:RemovePermission'],
                    resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:${stack.stackName}-${id.toLowerCase()}-*`]
                }),
                new iam.PolicyStatement({
                    sid: 'ReadSystemSettings',
                    actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
                    resources: [this.leoSystemTable.tableArn, this.leoSettingsTable.tableArn]
                }),
                // Add Kinesis/S3/Firehose write permissions?
                new iam.PolicyStatement({
                    sid: 'BusWriteAccess',
                    actions: ['kinesis:PutRecord', 'kinesis:PutRecords', 'firehose:PutRecord', 'firehose:PutRecordBatch', 's3:PutObject'],
                    resources: [
                        this.leoKinesisStream.streamArn,
                        `arn:aws:firehose:${stack.region}:${stack.account}:deliverystream/${cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'firehose', props.environmentName])}`,
                        this.leoS3Bucket.bucketArn,
                        `${this.leoS3Bucket.bucketArn}/*` // Grant PutObject on objects within the bucket
                    ]
                }),
                // Add read access to common tables needed by many bots
                new iam.PolicyStatement({
                    sid: 'BusReadAccess',
                    actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:Scan'],
                    resources: [
                        this.leoStreamTable.tableArn,
                        this.leoArchiveTable.tableArn,
                        this.leoEventTable.tableArn,
                        this.leoSettingsTable.tableArn,
                        this.leoCronTable.tableArn,
                        this.leoSystemTable.tableArn,
                    ]
                }),
                // Add stream read access?
                new iam.PolicyStatement({
                    sid: 'BusStreamReadAccess',
                    actions: [
                        'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:DescribeStream', 'dynamodb:ListStreams',
                        'kinesis:DescribeStream', 'kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:ListStreams'
                    ],
                    resources: [
                        this.leoStreamTable.tableStreamArn,
                        this.leoCronTable.tableStreamArn,
                        this.leoEventTable.tableStreamArn,
                        this.leoKinesisStream.streamArn,
                    ]
                }),
            ]
        });
        this.leoBotPolicy = botPolicy;
        new cdk.CfnOutput(this, 'LeoBotPolicyOutput', {
            value: botPolicy.managedPolicyArn,
            exportName: `${exportPrefix}-LeoBotPolicy`
        });
        // Role Creation Helper
        const createBusRole = (roleId, principal, additionalPolicies, managedPoliciesToAdd) => {
            const role = new iam.Role(this, roleId, {
                roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, roleId, props.environmentName),
                assumedBy: principal,
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                    botPolicy,
                    ...(managedPoliciesToAdd ?? [])
                ],
            });
            if (additionalPolicies && additionalPolicies.length > 0) {
                for (const policy of additionalPolicies) {
                    role.addToPolicy(policy);
                }
            }
            return role;
        };
        // LeoBotRole
        const botRolePrincipal = new iam.ServicePrincipal('lambda.amazonaws.com');
        if (isTrustingAccount) {
            const trustedPrincipals = props.trustedArns.map(arn => new iam.ArnPrincipal(arn));
            // How to combine ServicePrincipal and ArnPrincipals?
            // Using CompositePrincipal
            this.leoBotRole = createBusRole('LeoBotRole', new iam.CompositePrincipal(botRolePrincipal, ...trustedPrincipals));
        }
        else {
            this.leoBotRole = createBusRole('LeoBotRole', botRolePrincipal);
        }
        // LeoInstallRole
        this.leoInstallRole = createBusRole('LeoInstallRole', new iam.ServicePrincipal('lambda.amazonaws.com'), [
            new iam.PolicyStatement({
                sid: 'LeoInstallPermissions',
                actions: [
                    'lambda:AddPermission', 'lambda:RemovePermission',
                    's3:PutBucketNotification', 's3:GetBucketNotification',
                    'iam:ListAttachedRolePolicies', 'iam:AttachRolePolicy', 'iam:PassRole',
                    'dynamodb:UpdateItem' // Keep this? Seems covered by BotPolicy
                ],
                resources: ['*'], // Scope down these resources significantly
                // Example scoping:
                // lambda permissions: lambda ARNs in this stack
                // s3 notification: LeoS3 bucket ARN
                // iam: LeoFirehoseRole ARN
                // dynamodb: LeoCron table ARN
            })
        ]);
        // LeoKinesisRole
        this.leoKinesisRole = createBusRole('LeoKinesisRole', new iam.ServicePrincipal('lambda.amazonaws.com'), [
            // Inline policy from CFN seems covered by BotPolicy's BusReadAccess/BusStreamReadAccess/BusWriteAccess, verify
            new iam.PolicyStatement({
                sid: 'KinesisProcessorPermissions',
                actions: ['kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:DescribeStream', 'kinesis:ListStreams'],
                resources: [this.leoKinesisStream.streamArn]
            })
        ]);
        // LeoFirehoseRole (for Lambda, distinct from Firehose *Delivery* Role)
        this.leoFirehoseRole = createBusRole('LeoFirehoseRole', new iam.ServicePrincipal('lambda.amazonaws.com'), [
            new iam.PolicyStatement({
                sid: 'FirehoseLambdaSpecific',
                actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
                resources: [`arn:aws:firehose:${stack.region}:${stack.account}:deliverystream/${cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'firehose', props.environmentName])}`],
            })
        ]);
        // LeoCronRole
        this.leoCronRole = createBusRole('LeoCronRole', new iam.ServicePrincipal('lambda.amazonaws.com'), [
            // Specific policies for cron scheduling/triggering?
            // CFN policy seems covered by BotPolicy, verify
            // Need lambda:InvokeFunction for triggering other bots?
            new iam.PolicyStatement({
                sid: 'InvokeBots',
                actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
                resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:${stack.stackName}-${id.toLowerCase()}-*`]
            })
        ]);
        // Add lambdaInvokePolicy to LeoCronRole if provided
        if (props.lambdaInvokePolicy) {
            const invokePolicy = iam.ManagedPolicy.fromManagedPolicyArn(this, 'LambdaInvokePolicy', props.lambdaInvokePolicy);
            this.leoCronRole.addManagedPolicy(invokePolicy);
        }
        // 5. Firehose Delivery Stream (using its own role `firehoseDeliveryRole` defined below)
        const firehoseDeliveryRole = new iam.Role(this, 'FirehoseDeliveryRole', {
            roleName: (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'FirehoseRole', props.environmentName),
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });
        firehoseDeliveryRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [`arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/kinesisfirehose/${cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'firehose', props.environmentName])}:*`]
        }));
        this.leoS3Bucket.grantReadWrite(firehoseDeliveryRole);
        this.leoKinesisStream.grantRead(firehoseDeliveryRole);
        const leoFirehose = new firehose.CfnDeliveryStream(this, 'LeoFirehoseStream', {
            deliveryStreamName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'firehose', props.environmentName]),
            deliveryStreamType: 'KinesisStreamAsSource',
            kinesisStreamSourceConfiguration: {
                kinesisStreamArn: this.leoKinesisStream.streamArn,
                roleArn: firehoseDeliveryRole.roleArn // Use the dedicated Firehose role
            },
            s3DestinationConfiguration: {
                bucketArn: this.leoS3Bucket.bucketArn,
                roleArn: firehoseDeliveryRole.roleArn,
                prefix: 'firehose/',
                errorOutputPrefix: 'firehose-errors/',
                bufferingHints: {
                    intervalInSeconds: 300,
                    sizeInMBs: 5
                },
                compressionFormat: 'GZIP',
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), 'firehose', props.environmentName])}`,
                    logStreamName: 'S3Delivery'
                }
            }
        });
        this.leoFirehoseStreamName = leoFirehose.ref; // Assign Firehose name to property
        new cdk.CfnOutput(this, 'LeoFirehoseStreamOutput', {
            value: leoFirehose.ref,
            exportName: `${exportPrefix}-LeoFirehoseStream`
        });
        new cdk.CfnOutput(this, 'LeoFirehoseStreamNameOutput', {
            value: this.leoFirehoseStreamName,
            exportName: `${exportPrefix}-LeoFirehoseStreamName`
        });
        // 6. Lambda Functions (Update roles)
        const busLambdaEnvironment = {
            LEO_ENVIRONMENT: props.environmentName,
            LEO_STREAM_TABLE: this.leoStreamTable.tableName,
            LEO_ARCHIVE_TABLE: this.leoArchiveTable.tableName,
            LEO_EVENT_TABLE: this.leoEventTable.tableName,
            LEO_SETTINGS_TABLE: this.leoSettingsTable.tableName,
            LEO_CRON_TABLE: this.leoCronTable.tableName,
            LEO_SYSTEM_TABLE: this.leoSystemTable.tableName,
            LEO_KINESIS_STREAM: this.leoKinesisStream.streamName,
            LEO_S3_BUCKET: this.leoS3Bucket.bucketName,
            FIREHOSE_STREAM: leoFirehose.ref,
            // BUS_STACK_NAME needs to be determined - using exportPrefix for now
            BUS_STACK_NAME: exportPrefix,
            NODE_OPTIONS: '--enable-source-maps',
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        };
        // Helper function to create Bus Lambda functions with consistent settings
        function createBusLambda(scope, id, codeDir, // Directory name under lambda/bus/
        role, environment, timeout, memorySize) {
            // Use a truncated function name format with stack name included
            const functionName = (0, name_truncation_1.createTruncatedName)(stack.stackName, id, '', props.environmentName);
            // Resolve entry path relative to the individual lambda's directory within the project root
            const entryPath = path.resolve(`./lambda/bus/${codeDir}/index.js`);
            // Set projectRoot to the main CDK project directory, where package-lock.json is
            const projectRootPath = path.resolve(`./`);
            // Use memory size from props.lambdaMemory if available and specific to this function
            const defaultMemory = 1024; // Default memory if not specified
            let configuredMemory = memorySize || defaultMemory;
            // Check if we have memory config in props for this specific lambda
            if (props.lambdaMemory) {
                if (id === 'KinesisProcessor' && props.lambdaMemory.kinesisStreamProcessor) {
                    configuredMemory = props.lambdaMemory.kinesisStreamProcessor;
                }
                else if (id === 'FirehoseProcessor' && props.lambdaMemory.firehoseStreamProcessor) {
                    configuredMemory = props.lambdaMemory.firehoseStreamProcessor;
                }
                else if ((id === 'CronProcessor' || id === 'CronScheduler') && props.lambdaMemory.cronProcessor) {
                    configuredMemory = props.lambdaMemory.cronProcessor;
                }
                else if (id === 'LeoEventTrigger' && props.lambdaMemory.eventTrigger) {
                    configuredMemory = props.lambdaMemory.eventTrigger;
                }
                else if (id === 'LeoMonitor' && props.lambdaMemory.monitor) {
                    configuredMemory = props.lambdaMemory.monitor;
                }
            }
            const lambdaFunction = new nodejs.NodejsFunction(scope, id, {
                runtime: lambda.Runtime.NODEJS_22_X,
                entry: entryPath,
                handler: 'handler',
                functionName: functionName,
                role: role,
                environment: {
                    ...(environment || {}),
                },
                timeout: timeout || cdk.Duration.minutes(5),
                memorySize: configuredMemory,
                architecture: lambda.Architecture.X86_64,
                awsSdkConnectionReuse: true,
                projectRoot: projectRootPath,
                bundling: {
                    externalModules: [
                        'aws-sdk',
                        '@aws-sdk/client-iam',
                        'moment',
                        'leo-sdk',
                        'leo-cron',
                        'leo-logger',
                    ],
                    sourceMap: true,
                },
                logRetention: logs.RetentionDays.FIVE_DAYS,
            });
            cdk.Tags.of(lambdaFunction).add('Stack', cdk.Stack.of(scope).stackName);
            cdk.Tags.of(lambdaFunction).add('Construct', 'Lambda');
            return lambdaFunction;
        }
        // KinesisProcessor
        const kinesisProcessorLambda = createBusLambda(this, 'KinesisProcessor', 'kinesis-processor', this.leoKinesisRole, {
            // Environment variables specific to KinesisProcessor
            // Add leoStream, kinesisStream if needed from props or context
            leo_kinesis_stream: this.leoKinesisStream.streamName,
            REGION: cdk.Stack.of(this).region,
            TZ: process.env.TZ || 'UTC', // Use UTC if TZ not set
        }, cdk.Duration.minutes(15), 1024);
        // Grant permissions if needed (e.g., to write to other resources)
        this.leoKinesisStream.grantReadWrite(kinesisProcessorLambda);
        this.leoEventTable.grantReadWriteData(kinesisProcessorLambda);
        // Add other grants based on CFN policies
        // Add Kinesis event source mapping
        this.leoKinesisStream.grantReadWrite(kinesisProcessorLambda);
        this.leoEventTable.grantReadWriteData(kinesisProcessorLambda);
        // FirehoseProcessor
        const firehoseProcessorLambda = createBusLambda(this, 'FirehoseProcessor', 'firehose-processor', this.leoFirehoseRole, {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        // Grant permissions
        this.leoStreamTable.grantReadWriteData(firehoseProcessorLambda);
        this.leoSettingsTable.grantReadWriteData(firehoseProcessorLambda);
        this.leoSystemTable.grantReadWriteData(firehoseProcessorLambda);
        // Add other grants based on CFN policies
        // S3LoadTrigger
        const s3LoadTriggerLambda = createBusLambda(this, 'S3LoadTrigger', 's3-load-trigger', this.leoFirehoseRole, // Uses LeoFirehoseRole in CFN
        {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        // Grant permissions
        this.leoS3Bucket.grantRead(s3LoadTriggerLambda);
        this.leoKinesisStream.grantWrite(s3LoadTriggerLambda);
        // Add S3 event notification
        this.leoS3Bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(s3LoadTriggerLambda));
        // LeoMonitor
        const leoMonitorLambda = createBusLambda(this, 'LeoMonitor', 'leo-monitor', this.leoCronRole, {
            // Add MonitorShardHashKey if provided
            ...(props.monitorShardHashKey !== undefined ? { SHARD_HASH_KEY: props.monitorShardHashKey.toString() } : {})
        }, cdk.Duration.minutes(5), 1536 // Memory from CFN param, Timeout from CFN
        );
        this.leoCronTable.grantReadWriteData(leoMonitorLambda);
        // CronProcessor
        const cronProcessorLambda = createBusLambda(this, 'CronProcessor', 'cron', this.leoCronRole, {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        this.leoCronTable.grantReadWriteData(cronProcessorLambda);
        this.leoEventTable.grantReadWriteData(cronProcessorLambda);
        this.leoSettingsTable.grantReadWriteData(cronProcessorLambda);
        this.leoSystemTable.grantReadWriteData(cronProcessorLambda);
        // Add DynamoDB Event Source Mapping for Cron table stream to CronProcessor
        cronProcessorLambda.addEventSourceMapping('CronStreamSource', {
            eventSourceArn: this.leoCronTable.tableStreamArn,
            startingPosition: lambda.StartingPosition.TRIM_HORIZON,
            batchSize: 500 // Match CFN
        });
        // ArchiveProcessor
        const archiveLambda = createBusLambda(this, 'ArchiveProcessor', 'archive', this.leoBotRole, // Uses generic LeoBotRole
        {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        // Grant necessary permissions (e.g., S3 write to archive bucket if separate)
        this.leoS3Bucket.grantReadWrite(archiveLambda);
        // LeoEventTrigger - Defined directly to isolate from helper issues
        const leoEventTriggerLambda = new nodejs.NodejsFunction(this, 'LeoEventTrigger', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.resolve(__dirname, '../../lambda/bus/event-trigger/index.js'),
            handler: 'handler',
            functionName: (0, name_truncation_1.createTruncatedName)(stack.stackName, 'event-trigger', '', props.environmentName),
            role: this.leoCronRole,
            environment: {
                ...busLambdaEnvironment,
                // Add any specific environment variables if needed
            },
            timeout: cdk.Duration.minutes(5),
            memorySize: 1024,
            architecture: lambda.Architecture.X86_64,
            awsSdkConnectionReuse: true,
            bundling: {
                externalModules: [
                    'aws-sdk',
                    'moment',
                    'leo-sdk',
                    'leo-cron',
                    'leo-logger',
                ],
                sourceMap: true,
            },
            logRetention: logs.RetentionDays.FIVE_DAYS,
        });
        cdk.Tags.of(leoEventTriggerLambda).add('Stack', exportPrefix);
        cdk.Tags.of(leoEventTriggerLambda).add('Construct', 'Lambda');
        // Add DynamoDB Event Source Mapping for LeoEvent table
        leoEventTriggerLambda.addEventSourceMapping('EventTableSource', {
            eventSourceArn: this.leoEventTable.tableStreamArn,
            startingPosition: lambda.StartingPosition.TRIM_HORIZON,
            batchSize: 500 // Match CFN
        });
        // InstallFunction
        const installEnv = {
            APP_TABLE: this.leoSettingsTable.tableName,
            SYSTEM_TABLE: this.leoSystemTable.tableName,
            CRON_TABLE: this.leoCronTable.tableName,
            EVENT_TABLE: this.leoEventTable.tableName,
            STREAM_TABLE: this.leoStreamTable.tableName,
            KINESIS_TABLE: this.leoKinesisStream.streamName,
            LEO_KINESIS_STREAM_NAME: this.leoKinesisStream.streamName,
            LEO_FIREHOSE_STREAM_NAME: this.leoFirehoseStreamName,
            LEO_ARCHIVE_PROCESSOR_LOGICAL_ID: archiveLambda.node.id,
            LEO_MONITOR_LOGICAL_ID: leoMonitorLambda.node.id,
            LEO_FIREHOSE_ROLE_ARN: this.leoFirehoseRole.roleArn,
        };
        // Dependencies for environment variables - Assign after lambda definitions
        installEnv['LEO_EVENT_TRIGGER_LOGICAL_ID'] = leoEventTriggerLambda.node.id; // Now leoEventTriggerLambda is defined
        installEnv['LEO_S3_LOAD_TRIGGER_ARN'] = s3LoadTriggerLambda.functionArn;
        installEnv['LEO_CRON_PROCESSOR_ARN'] = cronProcessorLambda.functionArn;
        installEnv['LEO_KINESIS_PROCESSOR_ARN'] = kinesisProcessorLambda.functionArn;
        const installLambda = createBusLambda(this, 'InstallFunction', 'install', this.leoInstallRole, installEnv, // Convert to unknown first for assertion
        cdk.Duration.minutes(5), 1536 // Add memory size
        );
        // Add grants based on CFN policies (e.g., dynamodb:CreateTable, iam:PassRole)
        this.leoSettingsTable.grantReadWriteData(installLambda);
        this.leoSystemTable.grantReadWriteData(installLambda);
        this.leoCronTable.grantReadWriteData(installLambda);
        this.leoEventTable.grantReadWriteData(installLambda);
        this.leoStreamTable.grantReadWriteData(installLambda);
        this.leoKinesisStream.grantReadWrite(installLambda);
        // Add policies for CreateTable, PassRole etc. based on LeoInstallRole in CFN
        // CronScheduler (Lambda for triggering scheduled crons)
        const cronSchedulerLambda = createBusLambda(this, 'CronScheduler', 'cron-scheduler', this.leoCronRole, {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        this.leoCronTable.grantReadWriteData(cronSchedulerLambda); // Needs to read/write cron jobs
        // Needs EventBridge trigger (see LeoCronSchedule rule in CFN)
        // BusApiProcessor (Lambda for API Gateway)
        const busApiLambda = createBusLambda(this, 'BusApiProcessor', 'bus-api', this.leoBotRole, // Uses generic LeoBotRole
        {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        // Grant permissions based on API needs (e.g., DynamoDB access)
        // CreateReplicationBots (Lambda for Custom Resource)
        const createReplicationBotsLambda = createBusLambda(this, 'CreateReplicationBots', 'create-replication-bots', this.leoInstallRole, // Uses LeoInstallRole in CFN
        {}, // No specific env vars from CFN
        cdk.Duration.minutes(5), 1536 // Memory/Timeout from CFN
        );
        // Grant permissions (e.g., to create other resources if needed)
        // Create replicator Lambda used by the replication bots
        const replicateLambda = createBusLambda(this, 'ReplicateLambda', 'replicate', this.leoBotRole, {}, // No specific env vars
        cdk.Duration.minutes(5), 1536 // Memory size
        );
        // Grant permissions to access other accounts if needed
        if (props.trustedArns) {
            replicateLambda.addToRolePolicy(new iam.PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: props.trustedArns
            }));
        }
        // Allow writing to kinesis stream
        this.leoKinesisStream.grantWrite(replicateLambda);
        // Custom Resource for Registering Replication Bots
        const registerBotsProvider = new cr.Provider(this, 'RegisterBotsProvider', {
            onEventHandler: createReplicationBotsLambda,
            logRetention: logs.RetentionDays.ONE_DAY,
        });
        // Export the register service token for other stacks to use
        this.installTriggerServiceToken = registerBotsProvider.serviceToken;
        new cdk.CfnOutput(this, 'RegisterServiceTokenOutput', {
            value: registerBotsProvider.serviceToken,
            exportName: `${exportPrefix}-Register`
        });
        new cdk.CustomResource(this, 'RegisterReplicationBots', {
            serviceToken: registerBotsProvider.serviceToken,
            properties: {
                // Properties required by the createReplicationBotsLambda function based on original implementation
                QueueReplicationMapping: props.queueReplicationMapping || '[]',
                QueueReplicationDestinationLeoBotRoleARNs: props.queueReplicationDestinations
                    ? props.queueReplicationDestinations.join(',')
                    : undefined,
                ReplicatorLambdaName: (0, name_truncation_1.createTruncatedName)(stack.stackName, 'replicatelambda', '', props.environmentName)
            },
        });
        // 8. Outputs
        this.busStackNameOutput = exportPrefix; // Set the output value
        new cdk.CfnOutput(this, 'RegionOutput', {
            value: stack.region,
            exportName: `${exportPrefix}-Region`
        });
        new cdk.CfnOutput(this, 'AccountOutput', {
            value: stack.account,
            exportName: `${exportPrefix}-Account`
        });
        // Placeholder for Bus Stack Name export used in Botmon
        // This might need to be handled differently, maybe passed in props?
        new cdk.CfnOutput(this, 'BusStackNameOutput', {
            value: exportPrefix,
            description: 'Name of the Bus stack for reference by other stacks',
            exportName: `${exportPrefix}-BusStackName`
        });
    }
}
exports.Bus = Bus;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVzLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVzLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFDdkMscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsd0RBQXdEO0FBR3hELG1EQUFtRDtBQUNuRCw0REFBNEQsQ0FBQyxxREFBcUQ7QUFDbEgseUNBQXlDO0FBQ3pDLDZDQUE2QztBQUM3Qyw2QkFBNkI7QUFDN0Isd0RBQXdEO0FBQ3hELG1EQUFtRDtBQUluRCxnRUFBaUU7QUFzRWpFLE1BQWEsR0FBSSxTQUFRLHNCQUFTO0lBbUJoQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWU7UUFDdkQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsZ0JBQWdCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUMvRCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxXQUFXLElBQUksS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBRTVFLGdFQUFnRTtRQUVoRSx1QkFBdUI7UUFDdkIsTUFBTSxLQUFLLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDekMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDOUYsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxpRUFB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O1NBQ3hDLENBQUMsQ0FBQztRQUVILHVEQUF1RDtRQUN2RCxvRUFBb0U7UUFDcEUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsWUFBWTtZQUNuQixXQUFXLEVBQUUscURBQXFEO1lBQ2xFLFVBQVUsRUFBRSxHQUFHLFlBQVksZUFBZTtTQUM3QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUEzckJELGtCQTJyQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGtpbmVzaXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXMnO1xuaW1wb3J0ICogYXMgZmlyZWhvc2UgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXNmaXJlaG9zZSc7IC8vIFVzZSBMMSBjb25zdHJ1Y3QgaWYgTDIgaXMgdW5hdmFpbGFibGUvaW5zdWZmaWNpZW50XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgczNuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xuaW1wb3J0IHsgY3JlYXRlVHJ1bmNhdGVkTmFtZSB9IGZyb20gJy4uL2hlbHBlcnMvbmFtZS10cnVuY2F0aW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBCdXNQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZGVwbG95bWVudCBlbnZpcm9ubWVudCBuYW1lIChlLmcuLCBkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogQVJOcyBvZiB0cnVzdGVkIElBTSBwcmluY2lwbGVzIHRoYXQgY2FuIGFzc3VtZSByb2xlcyBmb3IgY3Jvc3MtYWNjb3VudCBhY2Nlc3MgaWYgbmVlZGVkLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gVHJ1c3RlZEFXU1ByaW5jaXBsZXMgcGFyYW1ldGVyKVxuICAgKi9cbiAgdHJ1c3RlZEFybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogTGlzdCBvZiBMZW9Cb3RSb2xlIEFSTnMgdGhpcyBzdGFjayB3aWxsIGFzc3VtZSBmb3IgcmVwbGljYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEpTT04gc3RyaW5nIHJlcHJlc2VudGluZyBxdWV1ZSByZXBsaWNhdGlvbiBtYXBwaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uTWFwcGluZyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZz86IHN0cmluZztcblxuICAvKipcbiAgICogQVdTIHBvbGljeSBBUk4gdG8gYWRkIHRvIExlb0Nyb25Sb2xlIGZvciBjcm9zcy1hY2NvdW50IGxhbWJkYSBpbnZvY2F0aW9uLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTGFtYmRhSW52b2tlUG9saWN5IHBhcmFtZXRlcilcbiAgICovXG4gIGxhbWJkYUludm9rZVBvbGljeT86IHN0cmluZztcblxuICAvKipcbiAgICogTnVtYmVyIG9mIHNoYXJkcyBmb3IgS2luZXNpcyBzdHJlYW0uXG4gICAqIChDb3JyZXNwb25kcyB0byBLaW5lc2lzU2hhcmRzIHBhcmFtZXRlcilcbiAgICovXG4gIGtpbmVzaXNTaGFyZHM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIE1lbW9yeSBjb25maWd1cmF0aW9ucyBmb3IgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICovXG4gIGxhbWJkYU1lbW9yeT86IHtcbiAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGZpcmVob3NlU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGNyb25Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgZXZlbnRUcmlnZ2VyPzogbnVtYmVyO1xuICAgIG1vbml0b3I/OiBudW1iZXI7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRUTCBzZWNvbmRzIGZvciBzdHJlYW0gcmVjb3Jkcy5cbiAgICogKENvcnJlc3BvbmRzIHRvIFN0cmVhbVRUTFNlY29uZHMgcGFyYW1ldGVyKVxuICAgKi9cbiAgc3RyZWFtVFRMU2Vjb25kcz86IG51bWJlcjtcblxuICAvKipcbiAgICogSGFzaCBrZXkgdG8gdXNlIGZvciB0aGUgbW9uaXRvciBkYXRhLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTW9uaXRvclNoYXJkSGFzaEtleSBwYXJhbWV0ZXIpXG4gICAqL1xuICBtb25pdG9yU2hhcmRIYXNoS2V5PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBzdGFjayBuYW1lIGlkZW50aWZpZXIsIHVzZWQgZm9yIGNyZWF0aW5nIHByZWRpY3RhYmxlIGV4cG9ydCBuYW1lcy5cbiAgICovXG4gIGV4cG9ydE5hbWVQcmVmaXg/OiBzdHJpbmc7XG5cbiAgc3RhY2s/OiBjZGsuU3RhY2s7XG4gIGlzVHJ1c3RpbmdBY2NvdW50PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIEJ1cyBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBsZW9TdHJlYW1UYWJsZTogZHluYW1vZGIuSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXJjaGl2ZVRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9FdmVudFRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9TZXR0aW5nc1RhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Dcm9uVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb1N5c3RlbVRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9LaW5lc2lzU3RyZWFtOiBraW5lc2lzLklTdHJlYW07XG4gIHB1YmxpYyByZWFkb25seSBsZW9TM0J1Y2tldDogczMuSUJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGJ1c1N0YWNrTmFtZU91dHB1dDogc3RyaW5nOyAvLyBUbyByZXBsYWNlIHRoZSBTU00gcGFyYW0gdmFsdWVcbiAgcHVibGljIHJlYWRvbmx5IGxlb0JvdFJvbGU6IGlhbS5JUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0luc3RhbGxSb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9LaW5lc2lzUm9sZTogaWFtLklSb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvRmlyZWhvc2VSb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Dcm9uUm9sZTogaWFtLklSb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQm90UG9saWN5OiBpYW0uSU1hbmFnZWRQb2xpY3k7XG4gIHB1YmxpYyByZWFkb25seSBpbnN0YWxsVHJpZ2dlclNlcnZpY2VUb2tlbjogc3RyaW5nOyAvLyBTZXJ2aWNlIHRva2VuIGZvciBSZWdpc3RlclJlcGxpY2F0aW9uQm90c1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvRmlyZWhvc2VTdHJlYW1OYW1lOiBzdHJpbmc7IC8vIEFkZCBvdXRwdXQgZm9yIEZpcmVob3NlIHN0cmVhbSBuYW1lXG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEJ1c1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgIGNvbnN0IGV4cG9ydFByZWZpeCA9IHByb3BzLmV4cG9ydE5hbWVQcmVmaXggPz8gc3RhY2suc3RhY2tOYW1lO1xuICAgIGNvbnN0IGlzVHJ1c3RpbmdBY2NvdW50ID0gcHJvcHMudHJ1c3RlZEFybnMgJiYgcHJvcHMudHJ1c3RlZEFybnMubGVuZ3RoID4gMDtcblxuICAgIC8vIERlZmluZSByZXNvdXJjZXMgYmFzZWQgb24gYnVzL2Nsb3VkZm9ybWF0aW9uLmpzb24gdHJhbnNsYXRpb25cblxuICAgIC8vIDEuIFMzIEJ1Y2tldCAoTGVvUzMpXG4gICAgY29uc3QgbGVvUzMgPSBuZXcgczMuQnVja2V0KHRoaXMsICdMZW9TMycsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGNkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ3MzJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksIC8vIEVuc3VyZSB1bmlxdWUgbmFtZVxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBPciBERVNUUk9ZIGRlcGVuZGluZyBvbiByZXF1aXJlbWVudHNcbiAgICAgIC8vIEFkZCB2ZXJzaW9uaW5nLCBlbmNyeXB0aW9uLCBsaWZlY3ljbGUgcnVsZXMgYXMgbmVlZGVkIGZyb20gQ0ZOXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgIH0pO1xuICAgIHRoaXMubGVvUzNCdWNrZXQgPSBsZW9TMztcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVvUzNPdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBsZW9TMy5idWNrZXROYW1lLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb1MzYFxuICAgIH0pO1xuXG4gICAgLy8gMi4gRHluYW1vREIgVGFibGVzIChMZW9TdHJlYW0sIExlb0FyY2hpdmUsIExlb0V2ZW50LCBMZW9TZXR0aW5ncywgTGVvQ3JvbiwgTGVvU3lzdGVtKVxuICAgIGNvbnN0IGNyZWF0ZUxlb1RhYmxlID0gKHRhYmxlTmFtZTogc3RyaW5nLCBwYXJ0aXRpb25LZXk6IGR5bmFtb2RiLkF0dHJpYnV0ZSwgc29ydEtleT86IGR5bmFtb2RiLkF0dHJpYnV0ZSwgc3RyZWFtPzogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUpOiBkeW5hbW9kYi5UYWJsZSA9PiB7XG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCB0YWJsZU5hbWUsIHtcbiAgICAgICAgdGFibGVOYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksIHRhYmxlTmFtZS50b0xvd2VyQ2FzZSgpLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKSxcbiAgICAgICAgcGFydGl0aW9uS2V5OiBwYXJ0aXRpb25LZXksXG4gICAgICAgIHNvcnRLZXk6IHNvcnRLZXksXG4gICAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIE1ha2UgY29uZmlndXJhYmxlIGlmIG5lZWRlZFxuICAgICAgICBzdHJlYW06IHN0cmVhbSxcbiAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSwgLy8gRW5hYmxlIFBJVFIgYnkgZGVmYXVsdFxuICAgICAgfSk7XG4gICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBgJHt0YWJsZU5hbWV9T3V0cHV0YCwge1xuICAgICAgICAgIHZhbHVlOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS0ke3RhYmxlTmFtZX1gXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB0YWJsZTtcbiAgICB9O1xuXG4gICAgdGhpcy5sZW9TdHJlYW1UYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9TdHJlYW0nLCB7IG5hbWU6ICdldmVudCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHsgbmFtZTogJ2VpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19JTUFHRSk7XG4gICAgLy8gQWRkIFRUTCB0byBMZW9TdHJlYW0gdGFibGUgaWYgc3RyZWFtVFRMU2Vjb25kcyBpcyBwcm92aWRlZFxuICAgIGlmIChwcm9wcy5zdHJlYW1UVExTZWNvbmRzKSB7XG4gICAgICBjb25zdCBjZm5MZW9TdHJlYW1UYWJsZSA9IHRoaXMubGVvU3RyZWFtVGFibGUubm9kZS5kZWZhdWx0Q2hpbGQgYXMgZHluYW1vZGIuQ2ZuVGFibGU7XG4gICAgICBjZm5MZW9TdHJlYW1UYWJsZS50aW1lVG9MaXZlU3BlY2lmaWNhdGlvbiA9IHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogJ3R0bCcsXG4gICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgIH07XG4gICAgfVxuICAgIHRoaXMubGVvQXJjaGl2ZVRhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb0FyY2hpdmUnLCB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0pO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9FdmVudCcsIHsgbmFtZTogJ2V2ZW50JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMpO1xuICAgIHRoaXMubGVvU2V0dGluZ3NUYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9TZXR0aW5ncycsIHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvQ3JvbicsIHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgdW5kZWZpbmVkLCBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMpO1xuICAgIHRoaXMubGVvU3lzdGVtVGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvU3lzdGVtJywgeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9KTtcblxuICAgIC8vIDMuIEtpbmVzaXMgU3RyZWFtIChMZW9LaW5lc2lzU3RyZWFtKVxuICAgIGNvbnN0IGxlb0tpbmVzaXMgPSBuZXcga2luZXNpcy5TdHJlYW0odGhpcywgJ0xlb0tpbmVzaXNTdHJlYW0nLCB7XG4gICAgICBzdHJlYW1OYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksICdraW5lc2lzJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksXG4gICAgICBzaGFyZENvdW50OiBwcm9wcy5raW5lc2lzU2hhcmRzID8/IDEsIC8vIFVzZSBraW5lc2lzU2hhcmRzIHBhcmFtZXRlciBpZiBwcm92aWRlZCwgZGVmYXVsdCB0byAxXG4gICAgICAvLyByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygyNCksIC8vIERlZmF1bHQgaXMgMjRoXG4gICAgICBzdHJlYW1Nb2RlOiBwcm9wcy5raW5lc2lzU2hhcmRzID8ga2luZXNpcy5TdHJlYW1Nb2RlLlBST1ZJU0lPTkVEIDoga2luZXNpcy5TdHJlYW1Nb2RlLk9OX0RFTUFORCwgLy8gVXNlIHByb3Zpc2lvbmVkIGlmIHNoYXJkcyBzcGVjaWZpZWRcbiAgICB9KTtcbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0gPSBsZW9LaW5lc2lzO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMZW9LaW5lc2lzU3RyZWFtT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogbGVvS2luZXNpcy5zdHJlYW1OYW1lLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0tpbmVzaXNTdHJlYW1gXG4gICAgfSk7XG5cbiAgICAvLyA0LiBJQU0gUm9sZXMgJiBQb2xpY2llc1xuXG4gICAgLy8gTGVvQm90UG9saWN5IChNYW5hZ2VkIFBvbGljeSBiYXNlZCBvbiBDRk4pXG4gICAgY29uc3QgYm90UG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdMZW9Cb3RQb2xpY3knLCB7XG4gICAgICAgIG1hbmFnZWRQb2xpY3lOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdMZW9Cb3RQb2xpY3knLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbW1vbiBwb2xpY3kgZm9yIExlbyBCdXMgTGFtYmRhcycsXG4gICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgLy8gQWxsb3cgd3JpdGluZyB0byBMZW9Dcm9uXG4gICAgICAgICAgICAgICAgc2lkOiAnTGVvQ3JvbkFjY2VzcycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpQdXRJdGVtJywgJ2R5bmFtb2RiOkJhdGNoV3JpdGVJdGVtJywgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLCAnZHluYW1vZGI6RGVsZXRlSXRlbScsICdkeW5hbW9kYjpTY2FuJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sZW9Dcm9uVGFibGUudGFibGVBcm5dXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgLy8gQWxsb3cgbWFuYWdpbmcgRXZlbnRCcmlkZ2UgcnVsZXMgZm9yIGNyb25cbiAgICAgICAgICAgICAgICBzaWQ6ICdFdmVudEJyaWRnZUNyb25NYW5hZ2VtZW50JyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2V2ZW50czpQdXRSdWxlJywgJ2V2ZW50czpQdXRUYXJnZXRzJywgJ2V2ZW50czpEZWxldGVSdWxlJywgJ2V2ZW50czpSZW1vdmVUYXJnZXRzJywgJ2V2ZW50czpEZXNjcmliZVJ1bGUnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpldmVudHM6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06cnVsZS8ke3N0YWNrLnN0YWNrTmFtZX0tJHtpZC50b0xvd2VyQ2FzZSgpfS0qYF1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyAvLyBBbGxvdyBhZGRpbmcgTGFtYmRhIHBlcm1pc3Npb25zIGZvciBFdmVudEJyaWRnZSB0cmlnZ2Vyc1xuICAgICAgICAgICAgICAgIHNpZDogJ0xhbWJkYUV2ZW50QnJpZGdlUGVybWlzc2lvbnMnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkFkZFBlcm1pc3Npb24nLCAnbGFtYmRhOlJlbW92ZVBlcm1pc3Npb24nXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHtzdGFjay5zdGFja05hbWV9LSR7aWQudG9Mb3dlckNhc2UoKX0tKmBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgLy8gQWxsb3cgcmVhZGluZyBTeXN0ZW0vU2V0dGluZ3MgdGFibGVzXG4gICAgICAgICAgICAgICAgc2lkOiAnUmVhZFN5c3RlbVNldHRpbmdzJyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOkdldEl0ZW0nLCAnZHluYW1vZGI6UXVlcnknLCAnZHluYW1vZGI6U2NhbiddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMubGVvU3lzdGVtVGFibGUudGFibGVBcm4sIHRoaXMubGVvU2V0dGluZ3NUYWJsZS50YWJsZUFybl1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgLy8gQWRkIEtpbmVzaXMvUzMvRmlyZWhvc2Ugd3JpdGUgcGVybWlzc2lvbnM/XG4gICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBcbiAgICAgICAgICAgICAgICBzaWQ6ICdCdXNXcml0ZUFjY2VzcycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydraW5lc2lzOlB1dFJlY29yZCcsICdraW5lc2lzOlB1dFJlY29yZHMnLCAnZmlyZWhvc2U6UHV0UmVjb3JkJywgJ2ZpcmVob3NlOlB1dFJlY29yZEJhdGNoJywgJ3MzOlB1dE9iamVjdCddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuLFxuICAgICAgICAgICAgICAgICAgICBgYXJuOmF3czpmaXJlaG9zZToke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpkZWxpdmVyeXN0cmVhbS8ke2Nkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ2ZpcmVob3NlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSl9YCwgLy8gRmlyZWhvc2UgQVJOXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvUzNCdWNrZXQuYnVja2V0QXJuLCAvLyBHcmFudGluZyBQdXRPYmplY3Qgb24gYnVja2V0IEFSTiBpdHNlbGYgaXMgdXN1YWxseSBub3QgbmVlZGVkXG4gICAgICAgICAgICAgICAgICAgIGAke3RoaXMubGVvUzNCdWNrZXQuYnVja2V0QXJufS8qYCAvLyBHcmFudCBQdXRPYmplY3Qgb24gb2JqZWN0cyB3aXRoaW4gdGhlIGJ1Y2tldFxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgIC8vIEFkZCByZWFkIGFjY2VzcyB0byBjb21tb24gdGFibGVzIG5lZWRlZCBieSBtYW55IGJvdHNcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBzaWQ6ICdCdXNSZWFkQWNjZXNzJyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOkdldEl0ZW0nLCAnZHluYW1vZGI6QmF0Y2hHZXRJdGVtJywgJ2R5bmFtb2RiOlF1ZXJ5JywgJ2R5bmFtb2RiOlNjYW4nXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9TdHJlYW1UYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9BcmNoaXZlVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvRXZlbnRUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9TeXN0ZW1UYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIC8vIEFkZCBzdHJlYW0gcmVhZCBhY2Nlc3M/XG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgc2lkOiAnQnVzU3RyZWFtUmVhZEFjY2VzcycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0UmVjb3JkcycsICdkeW5hbW9kYjpHZXRTaGFyZEl0ZXJhdG9yJywgJ2R5bmFtb2RiOkRlc2NyaWJlU3RyZWFtJywgJ2R5bmFtb2RiOkxpc3RTdHJlYW1zJyxcbiAgICAgICAgICAgICAgICAgICAgJ2tpbmVzaXM6RGVzY3JpYmVTdHJlYW0nLCAna2luZXNpczpHZXRSZWNvcmRzJywgJ2tpbmVzaXM6R2V0U2hhcmRJdGVyYXRvcicsICdraW5lc2lzOkxpc3RTdHJlYW1zJ1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU3RyZWFtVGFibGUudGFibGVTdHJlYW1Bcm4hLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZVN0cmVhbUFybiEsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvRXZlbnRUYWJsZS50YWJsZVN0cmVhbUFybiEsIC8vIEFkZGVkIGV2ZW50IHN0cmVhbVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuLFxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICBdXG4gICAgfSk7XG4gICAgdGhpcy5sZW9Cb3RQb2xpY3kgPSBib3RQb2xpY3k7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0JvdFBvbGljeU91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IGJvdFBvbGljeS5tYW5hZ2VkUG9saWN5QXJuLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0JvdFBvbGljeWBcbiAgICB9KTtcblxuICAgIC8vIFJvbGUgQ3JlYXRpb24gSGVscGVyXG4gICAgY29uc3QgY3JlYXRlQnVzUm9sZSA9IChyb2xlSWQ6IHN0cmluZywgcHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbCwgYWRkaXRpb25hbFBvbGljaWVzPzogaWFtLlBvbGljeVN0YXRlbWVudFtdLCBtYW5hZ2VkUG9saWNpZXNUb0FkZD86IGlhbS5JTWFuYWdlZFBvbGljeVtdKTogaWFtLlJvbGUgPT4ge1xuICAgICAgICBjb25zdCByb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsIHJvbGVJZCwge1xuICAgICAgICAgICAgcm9sZU5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgcm9sZUlkLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBwcmluY2lwYWwsXG4gICAgICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgICAgICAgICBib3RQb2xpY3ksIC8vIEF0dGFjaCBjb21tb24gTGVvQm90UG9saWN5XG4gICAgICAgICAgICAgICAgLi4uKG1hbmFnZWRQb2xpY2llc1RvQWRkID8/IFtdKVxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChhZGRpdGlvbmFsUG9saWNpZXMgJiYgYWRkaXRpb25hbFBvbGljaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcG9saWN5IG9mIGFkZGl0aW9uYWxQb2xpY2llcykge1xuICAgICAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm9sZTtcbiAgICB9O1xuXG4gICAgLy8gTGVvQm90Um9sZVxuICAgIGNvbnN0IGJvdFJvbGVQcmluY2lwYWwgPSBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyk7XG4gICAgaWYgKGlzVHJ1c3RpbmdBY2NvdW50KSB7XG4gICAgICAgIGNvbnN0IHRydXN0ZWRQcmluY2lwYWxzID0gcHJvcHMudHJ1c3RlZEFybnMhLm1hcChhcm4gPT4gbmV3IGlhbS5Bcm5QcmluY2lwYWwoYXJuKSk7XG4gICAgICAgIC8vIEhvdyB0byBjb21iaW5lIFNlcnZpY2VQcmluY2lwYWwgYW5kIEFyblByaW5jaXBhbHM/XG4gICAgICAgIC8vIFVzaW5nIENvbXBvc2l0ZVByaW5jaXBhbFxuICAgICAgICB0aGlzLmxlb0JvdFJvbGUgPSBjcmVhdGVCdXNSb2xlKCdMZW9Cb3RSb2xlJywgbmV3IGlhbS5Db21wb3NpdGVQcmluY2lwYWwoYm90Um9sZVByaW5jaXBhbCwgLi4udHJ1c3RlZFByaW5jaXBhbHMpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxlb0JvdFJvbGUgPSBjcmVhdGVCdXNSb2xlKCdMZW9Cb3RSb2xlJywgYm90Um9sZVByaW5jaXBhbCk7XG4gICAgfVxuXG4gICAgLy8gTGVvSW5zdGFsbFJvbGVcbiAgICB0aGlzLmxlb0luc3RhbGxSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvSW5zdGFsbFJvbGUnLCBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksIFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgc2lkOiAnTGVvSW5zdGFsbFBlcm1pc3Npb25zJyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnbGFtYmRhOkFkZFBlcm1pc3Npb24nLCAnbGFtYmRhOlJlbW92ZVBlcm1pc3Npb24nLCAvLyBBZGRlZCByZW1vdmUgcGVybWlzc2lvblxuICAgICAgICAgICAgICAgICdzMzpQdXRCdWNrZXROb3RpZmljYXRpb24nLCAnczM6R2V0QnVja2V0Tm90aWZpY2F0aW9uJyxcbiAgICAgICAgICAgICAgICAnaWFtOkxpc3RBdHRhY2hlZFJvbGVQb2xpY2llcycsICdpYW06QXR0YWNoUm9sZVBvbGljeScsICdpYW06UGFzc1JvbGUnLCAvLyBBZGRlZCBQYXNzUm9sZVxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyAvLyBLZWVwIHRoaXM/IFNlZW1zIGNvdmVyZWQgYnkgQm90UG9saWN5XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gU2NvcGUgZG93biB0aGVzZSByZXNvdXJjZXMgc2lnbmlmaWNhbnRseVxuICAgICAgICAgICAgLy8gRXhhbXBsZSBzY29waW5nOlxuICAgICAgICAgICAgLy8gbGFtYmRhIHBlcm1pc3Npb25zOiBsYW1iZGEgQVJOcyBpbiB0aGlzIHN0YWNrXG4gICAgICAgICAgICAvLyBzMyBub3RpZmljYXRpb246IExlb1MzIGJ1Y2tldCBBUk5cbiAgICAgICAgICAgIC8vIGlhbTogTGVvRmlyZWhvc2VSb2xlIEFSTlxuICAgICAgICAgICAgLy8gZHluYW1vZGI6IExlb0Nyb24gdGFibGUgQVJOXG4gICAgICAgIH0pXG4gICAgXSk7XG5cbiAgICAvLyBMZW9LaW5lc2lzUm9sZVxuICAgIHRoaXMubGVvS2luZXNpc1JvbGUgPSBjcmVhdGVCdXNSb2xlKCdMZW9LaW5lc2lzUm9sZScsIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSwgW1xuICAgICAgICAvLyBJbmxpbmUgcG9saWN5IGZyb20gQ0ZOIHNlZW1zIGNvdmVyZWQgYnkgQm90UG9saWN5J3MgQnVzUmVhZEFjY2Vzcy9CdXNTdHJlYW1SZWFkQWNjZXNzL0J1c1dyaXRlQWNjZXNzLCB2ZXJpZnlcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgc2lkOiAnS2luZXNpc1Byb2Nlc3NvclBlcm1pc3Npb25zJyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsna2luZXNpczpHZXRSZWNvcmRzJywgJ2tpbmVzaXM6R2V0U2hhcmRJdGVyYXRvcicsICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtJywgJ2tpbmVzaXM6TGlzdFN0cmVhbXMnXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1Bcm5dXG4gICAgICAgIH0pXG4gICAgXSk7XG5cbiAgICAvLyBMZW9GaXJlaG9zZVJvbGUgKGZvciBMYW1iZGEsIGRpc3RpbmN0IGZyb20gRmlyZWhvc2UgKkRlbGl2ZXJ5KiBSb2xlKVxuICAgIHRoaXMubGVvRmlyZWhvc2VSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvRmlyZWhvc2VSb2xlJywgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLCBbXG4gICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgc2lkOiAnRmlyZWhvc2VMYW1iZGFTcGVjaWZpYycsXG4gICAgICAgICAgICBhY3Rpb25zOiBbJ2ZpcmVob3NlOlB1dFJlY29yZCcsICdmaXJlaG9zZTpQdXRSZWNvcmRCYXRjaCddLCAvLyBFbnN1cmUgRmlyZWhvc2Ugd3JpdGUgaXMgY292ZXJlZFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZmlyZWhvc2U6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZGVsaXZlcnlzdHJlYW0vJHtjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksICdmaXJlaG9zZScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pfWBdLFxuICAgICAgICAgfSlcbiAgICBdKTtcblxuICAgIC8vIExlb0Nyb25Sb2xlXG4gICAgdGhpcy5sZW9Dcm9uUm9sZSA9IGNyZWF0ZUJ1c1JvbGUoJ0xlb0Nyb25Sb2xlJywgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLCBbXG4gICAgICAgIC8vIFNwZWNpZmljIHBvbGljaWVzIGZvciBjcm9uIHNjaGVkdWxpbmcvdHJpZ2dlcmluZz9cbiAgICAgICAgLy8gQ0ZOIHBvbGljeSBzZWVtcyBjb3ZlcmVkIGJ5IEJvdFBvbGljeSwgdmVyaWZ5XG4gICAgICAgIC8vIE5lZWQgbGFtYmRhOkludm9rZUZ1bmN0aW9uIGZvciB0cmlnZ2VyaW5nIG90aGVyIGJvdHM/XG4gICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgc2lkOiAnSW52b2tlQm90cycsXG4gICAgICAgICAgICAgYWN0aW9uczogWydsYW1iZGE6SW52b2tlRnVuY3Rpb24nLCAnbGFtYmRhOkludm9rZUFzeW5jJ10sXG4gICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bGFtYmRhOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmZ1bmN0aW9uOiR7c3RhY2suc3RhY2tOYW1lfS0ke2lkLnRvTG93ZXJDYXNlKCl9LSpgXVxuICAgICAgICAgfSlcbiAgICBdKTtcblxuICAgIC8vIEFkZCBsYW1iZGFJbnZva2VQb2xpY3kgdG8gTGVvQ3JvblJvbGUgaWYgcHJvdmlkZWRcbiAgICBpZiAocHJvcHMubGFtYmRhSW52b2tlUG9saWN5KSB7XG4gICAgICBjb25zdCBpbnZva2VQb2xpY3kgPSBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybihcbiAgICAgICAgdGhpcywgXG4gICAgICAgICdMYW1iZGFJbnZva2VQb2xpY3knLCBcbiAgICAgICAgcHJvcHMubGFtYmRhSW52b2tlUG9saWN5XG4gICAgICApO1xuICAgICAgdGhpcy5sZW9Dcm9uUm9sZS5hZGRNYW5hZ2VkUG9saWN5KGludm9rZVBvbGljeSk7XG4gICAgfVxuXG4gICAgLy8gNS4gRmlyZWhvc2UgRGVsaXZlcnkgU3RyZWFtICh1c2luZyBpdHMgb3duIHJvbGUgYGZpcmVob3NlRGVsaXZlcnlSb2xlYCBkZWZpbmVkIGJlbG93KVxuICAgIGNvbnN0IGZpcmVob3NlRGVsaXZlcnlSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdGaXJlaG9zZURlbGl2ZXJ5Um9sZScsIHtcbiAgICAgICAgcm9sZU5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ0ZpcmVob3NlUm9sZScsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdmaXJlaG9zZS5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICBmaXJlaG9zZURlbGl2ZXJ5Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06bG9nLWdyb3VwOi9hd3Mva2luZXNpc2ZpcmVob3NlLyR7Y2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZC50b0xvd2VyQ2FzZSgpLCAnZmlyZWhvc2UnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKX06KmBdXG4gICAgfSkpO1xuXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5ncmFudFJlYWRXcml0ZShmaXJlaG9zZURlbGl2ZXJ5Um9sZSk7XG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZChmaXJlaG9zZURlbGl2ZXJ5Um9sZSk7XG5cbiAgICBjb25zdCBsZW9GaXJlaG9zZSA9IG5ldyBmaXJlaG9zZS5DZm5EZWxpdmVyeVN0cmVhbSh0aGlzLCAnTGVvRmlyZWhvc2VTdHJlYW0nLCB7XG4gICAgICAgIGRlbGl2ZXJ5U3RyZWFtTmFtZTogY2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZC50b0xvd2VyQ2FzZSgpLCAnZmlyZWhvc2UnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKSxcbiAgICAgICAgZGVsaXZlcnlTdHJlYW1UeXBlOiAnS2luZXNpc1N0cmVhbUFzU291cmNlJyxcbiAgICAgICAga2luZXNpc1N0cmVhbVNvdXJjZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIGtpbmVzaXNTdHJlYW1Bcm46IHRoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1Bcm4sXG4gICAgICAgICAgICByb2xlQXJuOiBmaXJlaG9zZURlbGl2ZXJ5Um9sZS5yb2xlQXJuIC8vIFVzZSB0aGUgZGVkaWNhdGVkIEZpcmVob3NlIHJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgczNEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIGJ1Y2tldEFybjogdGhpcy5sZW9TM0J1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgICAgICByb2xlQXJuOiBmaXJlaG9zZURlbGl2ZXJ5Um9sZS5yb2xlQXJuLCAvLyBVc2UgdGhlIGRlZGljYXRlZCBGaXJlaG9zZSByb2xlXG4gICAgICAgICAgICBwcmVmaXg6ICdmaXJlaG9zZS8nLCAvLyBBZGRlZCBwcmVmaXggZXhhbXBsZSwgY3VzdG9taXplIGFzIG5lZWRlZFxuICAgICAgICAgICAgZXJyb3JPdXRwdXRQcmVmaXg6ICdmaXJlaG9zZS1lcnJvcnMvJywgLy8gQWRkZWQgZXJyb3IgcHJlZml4IGV4YW1wbGVcbiAgICAgICAgICAgIGJ1ZmZlcmluZ0hpbnRzOiB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWxJblNlY29uZHM6IDMwMCxcbiAgICAgICAgICAgICAgICBzaXplSW5NQnM6IDVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb21wcmVzc2lvbkZvcm1hdDogJ0daSVAnLCAvLyBDaGFuZ2VkIHRvIEdaSVAgZXhhbXBsZVxuICAgICAgICAgICAgY2xvdWRXYXRjaExvZ2dpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2tpbmVzaXNmaXJlaG9zZS8ke2Nkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ2ZpcmVob3NlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSl9YCxcbiAgICAgICAgICAgICAgICBsb2dTdHJlYW1OYW1lOiAnUzNEZWxpdmVyeSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5sZW9GaXJlaG9zZVN0cmVhbU5hbWUgPSBsZW9GaXJlaG9zZS5yZWY7IC8vIEFzc2lnbiBGaXJlaG9zZSBuYW1lIHRvIHByb3BlcnR5XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVvRmlyZWhvc2VTdHJlYW1PdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBsZW9GaXJlaG9zZS5yZWYsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tTGVvRmlyZWhvc2VTdHJlYW1gXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0ZpcmVob3NlU3RyZWFtTmFtZU91dHB1dCcsIHsgLy8gT3B0aW9uYWxseSBleHBvcnQgbmFtZSB0b29cbiAgICAgICAgdmFsdWU6IHRoaXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0ZpcmVob3NlU3RyZWFtTmFtZWBcbiAgICB9KTtcblxuICAgIC8vIDYuIExhbWJkYSBGdW5jdGlvbnMgKFVwZGF0ZSByb2xlcylcbiAgICBjb25zdCBidXNMYW1iZGFFbnZpcm9ubWVudCA9IHtcbiAgICAgICAgTEVPX0VOVklST05NRU5UOiBwcm9wcy5lbnZpcm9ubWVudE5hbWUsXG4gICAgICAgIExFT19TVFJFQU1fVEFCTEU6IHRoaXMubGVvU3RyZWFtVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fQVJDSElWRV9UQUJMRTogdGhpcy5sZW9BcmNoaXZlVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fRVZFTlRfVEFCTEU6IHRoaXMubGVvRXZlbnRUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19TRVRUSU5HU19UQUJMRTogdGhpcy5sZW9TZXR0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX0NST05fVEFCTEU6IHRoaXMubGVvQ3JvblRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX1NZU1RFTV9UQUJMRTogdGhpcy5sZW9TeXN0ZW1UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19LSU5FU0lTX1NUUkVBTTogdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbU5hbWUsXG4gICAgICAgIExFT19TM19CVUNLRVQ6IHRoaXMubGVvUzNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgRklSRUhPU0VfU1RSRUFNOiBsZW9GaXJlaG9zZS5yZWYsIC8vIFBhc3MgRmlyZWhvc2UgbmFtZVxuICAgICAgICAvLyBCVVNfU1RBQ0tfTkFNRSBuZWVkcyB0byBiZSBkZXRlcm1pbmVkIC0gdXNpbmcgZXhwb3J0UHJlZml4IGZvciBub3dcbiAgICAgICAgQlVTX1NUQUNLX05BTUU6IGV4cG9ydFByZWZpeCxcbiAgICAgICAgTk9ERV9PUFRJT05TOiAnLS1lbmFibGUtc291cmNlLW1hcHMnLCAvLyBFbmFibGUgc291cmNlIG1hcHNcbiAgICAgICAgQVdTX05PREVKU19DT05ORUNUSU9OX1JFVVNFX0VOQUJMRUQ6ICcxJyxcbiAgICB9O1xuXG4gICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBCdXMgTGFtYmRhIGZ1bmN0aW9ucyB3aXRoIGNvbnNpc3RlbnQgc2V0dGluZ3NcbiAgICBmdW5jdGlvbiBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHNjb3BlOiBDb25zdHJ1Y3QsXG4gICAgICAgIGlkOiBzdHJpbmcsXG4gICAgICAgIGNvZGVEaXI6IHN0cmluZywgLy8gRGlyZWN0b3J5IG5hbWUgdW5kZXIgbGFtYmRhL2J1cy9cbiAgICAgICAgcm9sZTogaWFtLklSb2xlLFxuICAgICAgICBlbnZpcm9ubWVudD86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0sXG4gICAgICAgIHRpbWVvdXQ/OiBjZGsuRHVyYXRpb24sXG4gICAgICAgIG1lbW9yeVNpemU/OiBudW1iZXJcbiAgICApOiBub2RlanMuTm9kZWpzRnVuY3Rpb24ge1xuICAgICAgICAvLyBVc2UgYSB0cnVuY2F0ZWQgZnVuY3Rpb24gbmFtZSBmb3JtYXQgd2l0aCBzdGFjayBuYW1lIGluY2x1ZGVkXG4gICAgICAgIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJycsIHByb3BzLmVudmlyb25tZW50TmFtZSk7XG4gICAgICAgIC8vIFJlc29sdmUgZW50cnkgcGF0aCByZWxhdGl2ZSB0byB0aGUgaW5kaXZpZHVhbCBsYW1iZGEncyBkaXJlY3Rvcnkgd2l0aGluIHRoZSBwcm9qZWN0IHJvb3RcbiAgICAgICAgY29uc3QgZW50cnlQYXRoID0gcGF0aC5yZXNvbHZlKGAuL2xhbWJkYS9idXMvJHtjb2RlRGlyfS9pbmRleC5qc2ApOyBcbiAgICAgICAgLy8gU2V0IHByb2plY3RSb290IHRvIHRoZSBtYWluIENESyBwcm9qZWN0IGRpcmVjdG9yeSwgd2hlcmUgcGFja2FnZS1sb2NrLmpzb24gaXNcbiAgICAgICAgY29uc3QgcHJvamVjdFJvb3RQYXRoID0gcGF0aC5yZXNvbHZlKGAuL2ApOyBcblxuICAgICAgICAvLyBVc2UgbWVtb3J5IHNpemUgZnJvbSBwcm9wcy5sYW1iZGFNZW1vcnkgaWYgYXZhaWxhYmxlIGFuZCBzcGVjaWZpYyB0byB0aGlzIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGRlZmF1bHRNZW1vcnkgPSAxMDI0OyAvLyBEZWZhdWx0IG1lbW9yeSBpZiBub3Qgc3BlY2lmaWVkXG4gICAgICAgIGxldCBjb25maWd1cmVkTWVtb3J5ID0gbWVtb3J5U2l6ZSB8fCBkZWZhdWx0TWVtb3J5O1xuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBtZW1vcnkgY29uZmlnIGluIHByb3BzIGZvciB0aGlzIHNwZWNpZmljIGxhbWJkYVxuICAgICAgICBpZiAocHJvcHMubGFtYmRhTWVtb3J5KSB7XG4gICAgICAgICAgICBpZiAoaWQgPT09ICdLaW5lc2lzUHJvY2Vzc29yJyAmJiBwcm9wcy5sYW1iZGFNZW1vcnkua2luZXNpc1N0cmVhbVByb2Nlc3Nvcikge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWRNZW1vcnkgPSBwcm9wcy5sYW1iZGFNZW1vcnkua2luZXNpc1N0cmVhbVByb2Nlc3NvcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoaWQgPT09ICdGaXJlaG9zZVByb2Nlc3NvcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmZpcmVob3NlU3RyZWFtUHJvY2Vzc29yKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5maXJlaG9zZVN0cmVhbVByb2Nlc3NvcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoKGlkID09PSAnQ3JvblByb2Nlc3NvcicgfHwgaWQgPT09ICdDcm9uU2NoZWR1bGVyJykgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmNyb25Qcm9jZXNzb3IpIHtcbiAgICAgICAgICAgICAgICBjb25maWd1cmVkTWVtb3J5ID0gcHJvcHMubGFtYmRhTWVtb3J5LmNyb25Qcm9jZXNzb3I7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGlkID09PSAnTGVvRXZlbnRUcmlnZ2VyJyAmJiBwcm9wcy5sYW1iZGFNZW1vcnkuZXZlbnRUcmlnZ2VyKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5ldmVudFRyaWdnZXI7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGlkID09PSAnTGVvTW9uaXRvcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5Lm1vbml0b3IpIHtcbiAgICAgICAgICAgICAgICBjb25maWd1cmVkTWVtb3J5ID0gcHJvcHMubGFtYmRhTWVtb3J5Lm1vbml0b3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYW1iZGFGdW5jdGlvbiA9IG5ldyBub2RlanMuTm9kZWpzRnVuY3Rpb24oc2NvcGUsIGlkLCB7XG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCwgLy8gVXBkYXRlZCB0byBOb2RlLmpzIDIyIHJ1bnRpbWVcbiAgICAgICAgICAgIGVudHJ5OiBlbnRyeVBhdGgsXG4gICAgICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgICAgICBmdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIHJvbGU6IHJvbGUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIC4uLihlbnZpcm9ubWVudCB8fCB7fSksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdGltZW91dDogdGltZW91dCB8fCBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIG1lbW9yeVNpemU6IGNvbmZpZ3VyZWRNZW1vcnksXG4gICAgICAgICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgICAgICAgICAgYXdzU2RrQ29ubmVjdGlvblJldXNlOiB0cnVlLFxuICAgICAgICAgICAgcHJvamVjdFJvb3Q6IHByb2plY3RSb290UGF0aCwgLy8gU2V0IHRvIG1haW4gcHJvamVjdCByb290XG4gICAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgICAgICAgICAnYXdzLXNkaycsIC8vIHYyIFNESyAoa2VwdCBmb3Igbm93LCBtYXliZSByZW1vdmUgbGF0ZXIgaWYgb25seSB2MyB1c2VkKVxuICAgICAgICAgICAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LWlhbScsIC8vIEFkZCB2MyBJQU0gY2xpZW50IHRvIGV4dGVybmFsc1xuICAgICAgICAgICAgICAgICAgICAnbW9tZW50JyxcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1zZGsnLFxuICAgICAgICAgICAgICAgICAgICAnbGVvLWNyb24nLFxuICAgICAgICAgICAgICAgICAgICAnbGVvLWxvZ2dlcicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuRklWRV9EQVlTLFxuICAgICAgICB9KTtcblxuICAgICAgICBjZGsuVGFncy5vZihsYW1iZGFGdW5jdGlvbikuYWRkKCdTdGFjaycsIGNkay5TdGFjay5vZihzY29wZSkuc3RhY2tOYW1lKTtcbiAgICAgICAgY2RrLlRhZ3Mub2YobGFtYmRhRnVuY3Rpb24pLmFkZCgnQ29uc3RydWN0JywgJ0xhbWJkYScpO1xuXG4gICAgICAgIHJldHVybiBsYW1iZGFGdW5jdGlvbjtcbiAgICB9XG5cbiAgICAvLyBLaW5lc2lzUHJvY2Vzc29yXG4gICAgY29uc3Qga2luZXNpc1Byb2Nlc3NvckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0tpbmVzaXNQcm9jZXNzb3InLFxuICAgICAgICAna2luZXNpcy1wcm9jZXNzb3InLFxuICAgICAgICB0aGlzLmxlb0tpbmVzaXNSb2xlLFxuICAgICAgICB7XG4gICAgICAgICAgICAvLyBFbnZpcm9ubWVudCB2YXJpYWJsZXMgc3BlY2lmaWMgdG8gS2luZXNpc1Byb2Nlc3NvclxuICAgICAgICAgICAgLy8gQWRkIGxlb1N0cmVhbSwga2luZXNpc1N0cmVhbSBpZiBuZWVkZWQgZnJvbSBwcm9wcyBvciBjb250ZXh0XG4gICAgICAgICAgICBsZW9fa2luZXNpc19zdHJlYW06IHRoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1OYW1lLFxuICAgICAgICAgICAgUkVHSU9OOiBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgICAgVFo6IHByb2Nlc3MuZW52LlRaIHx8ICdVVEMnLCAvLyBVc2UgVVRDIGlmIFRaIG5vdCBzZXRcbiAgICAgICAgfSxcbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICAxMDI0XG4gICAgKTtcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBpZiBuZWVkZWQgKGUuZy4sIHRvIHdyaXRlIHRvIG90aGVyIHJlc291cmNlcylcbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uZ3JhbnRSZWFkV3JpdGUoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9FdmVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShraW5lc2lzUHJvY2Vzc29yTGFtYmRhKTtcbiAgICAvLyBBZGQgb3RoZXIgZ3JhbnRzIGJhc2VkIG9uIENGTiBwb2xpY2llc1xuXG4gICAgLy8gQWRkIEtpbmVzaXMgZXZlbnQgc291cmNlIG1hcHBpbmdcbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uZ3JhbnRSZWFkV3JpdGUoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9FdmVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShraW5lc2lzUHJvY2Vzc29yTGFtYmRhKTtcblxuICAgIC8vIEZpcmVob3NlUHJvY2Vzc29yXG4gICAgY29uc3QgZmlyZWhvc2VQcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdGaXJlaG9zZVByb2Nlc3NvcicsXG4gICAgICAgICdmaXJlaG9zZS1wcm9jZXNzb3InLFxuICAgICAgICB0aGlzLmxlb0ZpcmVob3NlUm9sZSxcbiAgICAgICAge30sIC8vIE5vIHNwZWNpZmljIGVudiB2YXJzIGZyb20gQ0ZOXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeS9UaW1lb3V0IGZyb20gQ0ZOXG4gICAgKTtcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xuICAgIHRoaXMubGVvU3RyZWFtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGZpcmVob3NlUHJvY2Vzc29yTGFtYmRhKTtcbiAgICB0aGlzLmxlb1NldHRpbmdzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGZpcmVob3NlUHJvY2Vzc29yTGFtYmRhKTtcbiAgICB0aGlzLmxlb1N5c3RlbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmaXJlaG9zZVByb2Nlc3NvckxhbWJkYSk7XG4gICAgLy8gQWRkIG90aGVyIGdyYW50cyBiYXNlZCBvbiBDRk4gcG9saWNpZXNcblxuICAgIC8vIFMzTG9hZFRyaWdnZXJcbiAgICBjb25zdCBzM0xvYWRUcmlnZ2VyTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnUzNMb2FkVHJpZ2dlcicsXG4gICAgICAgICdzMy1sb2FkLXRyaWdnZXInLFxuICAgICAgICB0aGlzLmxlb0ZpcmVob3NlUm9sZSwgLy8gVXNlcyBMZW9GaXJlaG9zZVJvbGUgaW4gQ0ZOXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICB0aGlzLmxlb1MzQnVja2V0LmdyYW50UmVhZChzM0xvYWRUcmlnZ2VyTGFtYmRhKTtcbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uZ3JhbnRXcml0ZShzM0xvYWRUcmlnZ2VyTGFtYmRhKTtcbiAgICAvLyBBZGQgUzMgZXZlbnQgbm90aWZpY2F0aW9uXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxuICAgICAgICBuZXcgczNuLkxhbWJkYURlc3RpbmF0aW9uKHMzTG9hZFRyaWdnZXJMYW1iZGEpXG4gICAgKTtcblxuICAgIC8vIExlb01vbml0b3JcbiAgICBjb25zdCBsZW9Nb25pdG9yTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnTGVvTW9uaXRvcicsXG4gICAgICAgICdsZW8tbW9uaXRvcicsXG4gICAgICAgIHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIHtcbiAgICAgICAgICAgIC8vIEFkZCBNb25pdG9yU2hhcmRIYXNoS2V5IGlmIHByb3ZpZGVkXG4gICAgICAgICAgICAuLi4ocHJvcHMubW9uaXRvclNoYXJkSGFzaEtleSAhPT0gdW5kZWZpbmVkID8geyBTSEFSRF9IQVNIX0tFWTogcHJvcHMubW9uaXRvclNoYXJkSGFzaEtleS50b1N0cmluZygpIH0gOiB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5IGZyb20gQ0ZOIHBhcmFtLCBUaW1lb3V0IGZyb20gQ0ZOXG4gICAgKTtcbiAgICB0aGlzLmxlb0Nyb25UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEobGVvTW9uaXRvckxhbWJkYSk7XG5cbiAgICAvLyBDcm9uUHJvY2Vzc29yXG4gICAgY29uc3QgY3JvblByb2Nlc3NvckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0Nyb25Qcm9jZXNzb3InLFxuICAgICAgICAnY3JvbicsXG4gICAgICAgIHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNyb25Qcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY3JvblByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjcm9uUHJvY2Vzc29yTGFtYmRhKTtcbiAgICB0aGlzLmxlb1N5c3RlbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjcm9uUHJvY2Vzc29yTGFtYmRhKTtcbiAgICAvLyBBZGQgRHluYW1vREIgRXZlbnQgU291cmNlIE1hcHBpbmcgZm9yIENyb24gdGFibGUgc3RyZWFtIHRvIENyb25Qcm9jZXNzb3JcbiAgICBjcm9uUHJvY2Vzc29yTGFtYmRhLmFkZEV2ZW50U291cmNlTWFwcGluZygnQ3JvblN0cmVhbVNvdXJjZScsIHtcbiAgICAgICAgZXZlbnRTb3VyY2VBcm46IHRoaXMubGVvQ3JvblRhYmxlLnRhYmxlU3RyZWFtQXJuISxcbiAgICAgICAgc3RhcnRpbmdQb3NpdGlvbjogbGFtYmRhLlN0YXJ0aW5nUG9zaXRpb24uVFJJTV9IT1JJWk9OLFxuICAgICAgICBiYXRjaFNpemU6IDUwMCAvLyBNYXRjaCBDRk5cbiAgICB9KTtcblxuICAgIC8vIEFyY2hpdmVQcm9jZXNzb3JcbiAgICBjb25zdCBhcmNoaXZlTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnQXJjaGl2ZVByb2Nlc3NvcicsXG4gICAgICAgICdhcmNoaXZlJyxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlLCAvLyBVc2VzIGdlbmVyaWMgTGVvQm90Um9sZVxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIC8vIEdyYW50IG5lY2Vzc2FyeSBwZXJtaXNzaW9ucyAoZS5nLiwgUzMgd3JpdGUgdG8gYXJjaGl2ZSBidWNrZXQgaWYgc2VwYXJhdGUpXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5ncmFudFJlYWRXcml0ZShhcmNoaXZlTGFtYmRhKTtcblxuICAgIC8vIExlb0V2ZW50VHJpZ2dlciAtIERlZmluZWQgZGlyZWN0bHkgdG8gaXNvbGF0ZSBmcm9tIGhlbHBlciBpc3N1ZXNcbiAgICBjb25zdCBsZW9FdmVudFRyaWdnZXJMYW1iZGEgPSBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdMZW9FdmVudFRyaWdnZXInLCB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLCAvLyBVcGRhdGVkIHRvIE5vZGUuanMgMjIgcnVudGltZVxuICAgICAgICBlbnRyeTogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2xhbWJkYS9idXMvZXZlbnQtdHJpZ2dlci9pbmRleC5qcycpLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsICdldmVudC10cmlnZ2VyJywgJycsIHByb3BzLmVudmlyb25tZW50TmFtZSksXG4gICAgICAgIHJvbGU6IHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAuLi5idXNMYW1iZGFFbnZpcm9ubWVudCxcbiAgICAgICAgICAgIC8vIEFkZCBhbnkgc3BlY2lmaWMgZW52aXJvbm1lbnQgdmFyaWFibGVzIGlmIG5lZWRlZFxuICAgICAgICB9LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgICAgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgICAgYXdzU2RrQ29ubmVjdGlvblJldXNlOiB0cnVlLFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgICAgICAgJ2F3cy1zZGsnLFxuICAgICAgICAgICAgICAgICdtb21lbnQnLFxuICAgICAgICAgICAgICAgICdsZW8tc2RrJyxcbiAgICAgICAgICAgICAgICAnbGVvLWNyb24nLFxuICAgICAgICAgICAgICAgICdsZW8tbG9nZ2VyJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyxcbiAgICB9KTtcbiAgICBjZGsuVGFncy5vZihsZW9FdmVudFRyaWdnZXJMYW1iZGEpLmFkZCgnU3RhY2snLCBleHBvcnRQcmVmaXgpO1xuICAgIGNkay5UYWdzLm9mKGxlb0V2ZW50VHJpZ2dlckxhbWJkYSkuYWRkKCdDb25zdHJ1Y3QnLCAnTGFtYmRhJyk7XG5cbiAgICAvLyBBZGQgRHluYW1vREIgRXZlbnQgU291cmNlIE1hcHBpbmcgZm9yIExlb0V2ZW50IHRhYmxlXG4gICAgbGVvRXZlbnRUcmlnZ2VyTGFtYmRhLmFkZEV2ZW50U291cmNlTWFwcGluZygnRXZlbnRUYWJsZVNvdXJjZScsIHtcbiAgICAgICAgZXZlbnRTb3VyY2VBcm46IHRoaXMubGVvRXZlbnRUYWJsZS50YWJsZVN0cmVhbUFybiEsXG4gICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IGxhbWJkYS5TdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTixcbiAgICAgICAgYmF0Y2hTaXplOiA1MDAgLy8gTWF0Y2ggQ0ZOXG4gICAgfSk7XG5cbiAgICAvLyBEZWZpbmUgdGhlIHR5cGUgZm9yIGluc3RhbGxFbnYgZXhwbGljaXRseSAtIFJlLWFkZGVkXG4gICAgaW50ZXJmYWNlIEluc3RhbGxFbnZUeXBlIHtcbiAgICAgICAgQVBQX1RBQkxFOiBzdHJpbmc7XG4gICAgICAgIFNZU1RFTV9UQUJMRTogc3RyaW5nO1xuICAgICAgICBDUk9OX1RBQkxFOiBzdHJpbmc7XG4gICAgICAgIEVWRU5UX1RBQkxFOiBzdHJpbmc7XG4gICAgICAgIFNUUkVBTV9UQUJMRTogc3RyaW5nO1xuICAgICAgICBLSU5FU0lTX1RBQkxFOiBzdHJpbmc7XG4gICAgICAgIExFT19LSU5FU0lTX1NUUkVBTV9OQU1FOiBzdHJpbmc7XG4gICAgICAgIExFT19GSVJFSE9TRV9TVFJFQU1fTkFNRTogc3RyaW5nO1xuICAgICAgICBMRU9fQVJDSElWRV9QUk9DRVNTT1JfTE9HSUNBTF9JRDogc3RyaW5nO1xuICAgICAgICBMRU9fTU9OSVRPUl9MT0dJQ0FMX0lEOiBzdHJpbmc7XG4gICAgICAgIExFT19GSVJFSE9TRV9ST0xFX0FSTjogc3RyaW5nO1xuICAgICAgICBMRU9fRVZFTlRfVFJJR0dFUl9MT0dJQ0FMX0lEPzogc3RyaW5nO1xuICAgICAgICBMRU9fUzNfTE9BRF9UUklHR0VSX0FSTj86IHN0cmluZztcbiAgICAgICAgTEVPX0NST05fUFJPQ0VTU09SX0FSTj86IHN0cmluZztcbiAgICAgICAgTEVPX0tJTkVTSVNfUFJPQ0VTU09SX0FSTj86IHN0cmluZztcbiAgICB9XG5cbiAgICAvLyBJbnN0YWxsRnVuY3Rpb25cbiAgICBjb25zdCBpbnN0YWxsRW52OiBJbnN0YWxsRW52VHlwZSA9IHtcbiAgICAgICAgQVBQX1RBQkxFOiB0aGlzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBTWVNURU1fVEFCTEU6IHRoaXMubGVvU3lzdGVtVGFibGUudGFibGVOYW1lLFxuICAgICAgICBDUk9OX1RBQkxFOiB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEVWRU5UX1RBQkxFOiB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVOYW1lLFxuICAgICAgICBTVFJFQU1fVEFCTEU6IHRoaXMubGVvU3RyZWFtVGFibGUudGFibGVOYW1lLFxuICAgICAgICBLSU5FU0lTX1RBQkxFOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSwgLy8gQ29ycmVjdGVkIGZyb20gdGFibGUgbmFtZSAtIEtpbmVzaXMgaXMgYSBzdHJlYW1cbiAgICAgICAgTEVPX0tJTkVTSVNfU1RSRUFNX05BTUU6IHRoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1OYW1lLFxuICAgICAgICBMRU9fRklSRUhPU0VfU1RSRUFNX05BTUU6IHRoaXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lLFxuICAgICAgICBMRU9fQVJDSElWRV9QUk9DRVNTT1JfTE9HSUNBTF9JRDogYXJjaGl2ZUxhbWJkYS5ub2RlLmlkLFxuICAgICAgICBMRU9fTU9OSVRPUl9MT0dJQ0FMX0lEOiBsZW9Nb25pdG9yTGFtYmRhLm5vZGUuaWQsXG4gICAgICAgIExFT19GSVJFSE9TRV9ST0xFX0FSTjogdGhpcy5sZW9GaXJlaG9zZVJvbGUucm9sZUFybixcbiAgICB9O1xuICAgIC8vIERlcGVuZGVuY2llcyBmb3IgZW52aXJvbm1lbnQgdmFyaWFibGVzIC0gQXNzaWduIGFmdGVyIGxhbWJkYSBkZWZpbml0aW9uc1xuICAgIGluc3RhbGxFbnZbJ0xFT19FVkVOVF9UUklHR0VSX0xPR0lDQUxfSUQnXSA9IGxlb0V2ZW50VHJpZ2dlckxhbWJkYS5ub2RlLmlkOyAvLyBOb3cgbGVvRXZlbnRUcmlnZ2VyTGFtYmRhIGlzIGRlZmluZWRcbiAgICBpbnN0YWxsRW52WydMRU9fUzNfTE9BRF9UUklHR0VSX0FSTiddID0gczNMb2FkVHJpZ2dlckxhbWJkYS5mdW5jdGlvbkFybjtcbiAgICBpbnN0YWxsRW52WydMRU9fQ1JPTl9QUk9DRVNTT1JfQVJOJ10gPSBjcm9uUHJvY2Vzc29yTGFtYmRhLmZ1bmN0aW9uQXJuO1xuICAgIGluc3RhbGxFbnZbJ0xFT19LSU5FU0lTX1BST0NFU1NPUl9BUk4nXSA9IGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEuZnVuY3Rpb25Bcm47XG5cbiAgICBjb25zdCBpbnN0YWxsTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnSW5zdGFsbEZ1bmN0aW9uJyxcbiAgICAgICAgJ2luc3RhbGwnLFxuICAgICAgICB0aGlzLmxlb0luc3RhbGxSb2xlLFxuICAgICAgICBpbnN0YWxsRW52IGFzIHVua25vd24gYXMgeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSwgLy8gQ29udmVydCB0byB1bmtub3duIGZpcnN0IGZvciBhc3NlcnRpb25cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gQWRkIG1lbW9yeSBzaXplXG4gICAgKTtcbiAgICAvLyBBZGQgZ3JhbnRzIGJhc2VkIG9uIENGTiBwb2xpY2llcyAoZS5nLiwgZHluYW1vZGI6Q3JlYXRlVGFibGUsIGlhbTpQYXNzUm9sZSlcbiAgICB0aGlzLmxlb1NldHRpbmdzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvU3lzdGVtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvU3RyZWFtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5ncmFudFJlYWRXcml0ZShpbnN0YWxsTGFtYmRhKTtcbiAgICAvLyBBZGQgcG9saWNpZXMgZm9yIENyZWF0ZVRhYmxlLCBQYXNzUm9sZSBldGMuIGJhc2VkIG9uIExlb0luc3RhbGxSb2xlIGluIENGTlxuXG4gICAgLy8gQ3JvblNjaGVkdWxlciAoTGFtYmRhIGZvciB0cmlnZ2VyaW5nIHNjaGVkdWxlZCBjcm9ucylcbiAgICBjb25zdCBjcm9uU2NoZWR1bGVyTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnQ3JvblNjaGVkdWxlcicsXG4gICAgICAgICdjcm9uLXNjaGVkdWxlcicsXG4gICAgICAgIHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNyb25TY2hlZHVsZXJMYW1iZGEpOyAvLyBOZWVkcyB0byByZWFkL3dyaXRlIGNyb24gam9ic1xuICAgIC8vIE5lZWRzIEV2ZW50QnJpZGdlIHRyaWdnZXIgKHNlZSBMZW9Dcm9uU2NoZWR1bGUgcnVsZSBpbiBDRk4pXG5cbiAgICAvLyBCdXNBcGlQcm9jZXNzb3IgKExhbWJkYSBmb3IgQVBJIEdhdGV3YXkpXG4gICAgY29uc3QgYnVzQXBpTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnQnVzQXBpUHJvY2Vzc29yJyxcbiAgICAgICAgJ2J1cy1hcGknLFxuICAgICAgICB0aGlzLmxlb0JvdFJvbGUsIC8vIFVzZXMgZ2VuZXJpYyBMZW9Cb3RSb2xlXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgYmFzZWQgb24gQVBJIG5lZWRzIChlLmcuLCBEeW5hbW9EQiBhY2Nlc3MpXG5cbiAgICAvLyBDcmVhdGVSZXBsaWNhdGlvbkJvdHMgKExhbWJkYSBmb3IgQ3VzdG9tIFJlc291cmNlKVxuICAgIGNvbnN0IGNyZWF0ZVJlcGxpY2F0aW9uQm90c0xhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0NyZWF0ZVJlcGxpY2F0aW9uQm90cycsXG4gICAgICAgICdjcmVhdGUtcmVwbGljYXRpb24tYm90cycsXG4gICAgICAgIHRoaXMubGVvSW5zdGFsbFJvbGUsIC8vIFVzZXMgTGVvSW5zdGFsbFJvbGUgaW4gQ0ZOXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgKGUuZy4sIHRvIGNyZWF0ZSBvdGhlciByZXNvdXJjZXMgaWYgbmVlZGVkKVxuXG4gICAgLy8gQ3JlYXRlIHJlcGxpY2F0b3IgTGFtYmRhIHVzZWQgYnkgdGhlIHJlcGxpY2F0aW9uIGJvdHNcbiAgICBjb25zdCByZXBsaWNhdGVMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdSZXBsaWNhdGVMYW1iZGEnLFxuICAgICAgICAncmVwbGljYXRlJyxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlLFxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnNcbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5IHNpemVcbiAgICApO1xuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIGFjY2VzcyBvdGhlciBhY2NvdW50cyBpZiBuZWVkZWRcbiAgICBpZiAocHJvcHMudHJ1c3RlZEFybnMpIHtcbiAgICAgICAgcmVwbGljYXRlTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXG4gICAgICAgICAgICByZXNvdXJjZXM6IHByb3BzLnRydXN0ZWRBcm5zXG4gICAgICAgIH0pKTtcbiAgICB9XG4gICAgLy8gQWxsb3cgd3JpdGluZyB0byBraW5lc2lzIHN0cmVhbVxuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5ncmFudFdyaXRlKHJlcGxpY2F0ZUxhbWJkYSk7XG5cbiAgICAvLyBDdXN0b20gUmVzb3VyY2UgZm9yIFJlZ2lzdGVyaW5nIFJlcGxpY2F0aW9uIEJvdHNcbiAgICBjb25zdCByZWdpc3RlckJvdHNQcm92aWRlciA9IG5ldyBjci5Qcm92aWRlcih0aGlzLCAnUmVnaXN0ZXJCb3RzUHJvdmlkZXInLCB7XG4gICAgICAgIG9uRXZlbnRIYW5kbGVyOiBjcmVhdGVSZXBsaWNhdGlvbkJvdHNMYW1iZGEsXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9EQVksXG4gICAgfSk7XG5cbiAgICAvLyBFeHBvcnQgdGhlIHJlZ2lzdGVyIHNlcnZpY2UgdG9rZW4gZm9yIG90aGVyIHN0YWNrcyB0byB1c2VcbiAgICB0aGlzLmluc3RhbGxUcmlnZ2VyU2VydmljZVRva2VuID0gcmVnaXN0ZXJCb3RzUHJvdmlkZXIuc2VydmljZVRva2VuO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpc3RlclNlcnZpY2VUb2tlbk91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IHJlZ2lzdGVyQm90c1Byb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1SZWdpc3RlcmBcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ1JlZ2lzdGVyUmVwbGljYXRpb25Cb3RzJywge1xuICAgICAgICBzZXJ2aWNlVG9rZW46IHJlZ2lzdGVyQm90c1Byb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgLy8gUHJvcGVydGllcyByZXF1aXJlZCBieSB0aGUgY3JlYXRlUmVwbGljYXRpb25Cb3RzTGFtYmRhIGZ1bmN0aW9uIGJhc2VkIG9uIG9yaWdpbmFsIGltcGxlbWVudGF0aW9uXG4gICAgICAgICAgICBRdWV1ZVJlcGxpY2F0aW9uTWFwcGluZzogcHJvcHMucXVldWVSZXBsaWNhdGlvbk1hcHBpbmcgfHwgJ1tdJyxcbiAgICAgICAgICAgIFF1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbkxlb0JvdFJvbGVBUk5zOiBwcm9wcy5xdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zIFxuICAgICAgICAgICAgICA/IHByb3BzLnF1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbnMuam9pbignLCcpIFxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFJlcGxpY2F0b3JMYW1iZGFOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgJ3JlcGxpY2F0ZWxhbWJkYScsICcnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyA4LiBPdXRwdXRzXG4gICAgdGhpcy5idXNTdGFja05hbWVPdXRwdXQgPSBleHBvcnRQcmVmaXg7IC8vIFNldCB0aGUgb3V0cHV0IHZhbHVlXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZ2lvbk91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IHN0YWNrLnJlZ2lvbixcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1SZWdpb25gXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FjY291bnRPdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBzdGFjay5hY2NvdW50LFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUFjY291bnRgXG4gICAgfSk7XG5cbiAgICAvLyBQbGFjZWhvbGRlciBmb3IgQnVzIFN0YWNrIE5hbWUgZXhwb3J0IHVzZWQgaW4gQm90bW9uXG4gICAgLy8gVGhpcyBtaWdodCBuZWVkIHRvIGJlIGhhbmRsZWQgZGlmZmVyZW50bHksIG1heWJlIHBhc3NlZCBpbiBwcm9wcz9cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQnVzU3RhY2tOYW1lT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogZXhwb3J0UHJlZml4LCAvLyBVc2luZyB0aGUgZGVyaXZlZCBleHBvcnQgcHJlZml4XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgQnVzIHN0YWNrIGZvciByZWZlcmVuY2UgYnkgb3RoZXIgc3RhY2tzJyxcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1CdXNTdGFja05hbWVgXG4gICAgfSk7XG4gIH1cbn0gIl19