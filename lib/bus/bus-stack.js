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
        const leoS3 = new s3.Bucket(this, 'leos3', {
            bucketName: cdk.Fn.join('-', [stack.stackName.toLowerCase(), id.toLowerCase(), 's3', props.environmentName.toLowerCase()]),
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
                tableName: cdk.Fn.join('-', [stack.stackName, id.toLowerCase(), tableName, props.environmentName]),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVzLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVzLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFDdkMscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsd0RBQXdEO0FBR3hELG1EQUFtRDtBQUNuRCw0REFBNEQsQ0FBQyxxREFBcUQ7QUFDbEgseUNBQXlDO0FBQ3pDLDZDQUE2QztBQUM3Qyw2QkFBNkI7QUFDN0Isd0RBQXdEO0FBQ3hELG1EQUFtRDtBQUluRCxnRUFBaUU7QUFzRWpFLE1BQWEsR0FBSSxTQUFRLHNCQUFTO0lBbUJoQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWU7UUFDdkQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsZ0JBQWdCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUMvRCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxXQUFXLElBQUksS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBRTVFLGdFQUFnRTtRQUVoRSx1QkFBdUI7UUFDdkIsTUFBTSxLQUFLLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDekMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDOUYsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxpRUFB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QUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztvQkFDOUMsQ0FBQyxDQUFDLFNBQVM7Z0JBQ2Isb0JBQW9CLEVBQUUsSUFBQSxxQ0FBbUIsRUFBQyxLQUFLLENBQUMsU0FBUyxFQUFFLGlCQUFpQixFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDO2FBQzNHO1NBQ0osQ0FBQyxDQUFDO1FBRUgsYUFBYTtRQUNiLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxZQUFZLENBQUMsQ0FBQyx1QkFBdUI7UUFDL0QsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDcEMsS0FBSyxFQUFFLEtBQUssQ0FBQyxNQUFNO1lBQ25CLFVBQVUsRUFBRSxHQUFHLFlBQVksU0FBUztTQUN2QyxDQUFDLENBQUM7UUFDSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUNyQyxLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDcEIsVUFBVSxFQUFFLEdBQUcsWUFBWSxVQUFVO1NBQ3hDLENBQUMsQ0FBQztRQUVILHVEQUF1RDtRQUN2RCxvRUFBb0U7UUFDcEUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsWUFBWTtZQUNuQixXQUFXLEVBQUUscURBQXFEO1lBQ2xFLFVBQVUsRUFBRSxHQUFHLFlBQVksZUFBZTtTQUM3QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUEzckJELGtCQTJyQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGtpbmVzaXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXMnO1xuaW1wb3J0ICogYXMgZmlyZWhvc2UgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXNmaXJlaG9zZSc7IC8vIFVzZSBMMSBjb25zdHJ1Y3QgaWYgTDIgaXMgdW5hdmFpbGFibGUvaW5zdWZmaWNpZW50XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgczNuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xuaW1wb3J0IHsgY3JlYXRlVHJ1bmNhdGVkTmFtZSB9IGZyb20gJy4uL2hlbHBlcnMvbmFtZS10cnVuY2F0aW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBCdXNQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZGVwbG95bWVudCBlbnZpcm9ubWVudCBuYW1lIChlLmcuLCBkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogQVJOcyBvZiB0cnVzdGVkIElBTSBwcmluY2lwbGVzIHRoYXQgY2FuIGFzc3VtZSByb2xlcyBmb3IgY3Jvc3MtYWNjb3VudCBhY2Nlc3MgaWYgbmVlZGVkLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gVHJ1c3RlZEFXU1ByaW5jaXBsZXMgcGFyYW1ldGVyKVxuICAgKi9cbiAgdHJ1c3RlZEFybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogTGlzdCBvZiBMZW9Cb3RSb2xlIEFSTnMgdGhpcyBzdGFjayB3aWxsIGFzc3VtZSBmb3IgcmVwbGljYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEpTT04gc3RyaW5nIHJlcHJlc2VudGluZyBxdWV1ZSByZXBsaWNhdGlvbiBtYXBwaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uTWFwcGluZyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZz86IHN0cmluZztcblxuICAvKipcbiAgICogQVdTIHBvbGljeSBBUk4gdG8gYWRkIHRvIExlb0Nyb25Sb2xlIGZvciBjcm9zcy1hY2NvdW50IGxhbWJkYSBpbnZvY2F0aW9uLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTGFtYmRhSW52b2tlUG9saWN5IHBhcmFtZXRlcilcbiAgICovXG4gIGxhbWJkYUludm9rZVBvbGljeT86IHN0cmluZztcblxuICAvKipcbiAgICogTnVtYmVyIG9mIHNoYXJkcyBmb3IgS2luZXNpcyBzdHJlYW0uXG4gICAqIChDb3JyZXNwb25kcyB0byBLaW5lc2lzU2hhcmRzIHBhcmFtZXRlcilcbiAgICovXG4gIGtpbmVzaXNTaGFyZHM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIE1lbW9yeSBjb25maWd1cmF0aW9ucyBmb3IgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICovXG4gIGxhbWJkYU1lbW9yeT86IHtcbiAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGZpcmVob3NlU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGNyb25Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgZXZlbnRUcmlnZ2VyPzogbnVtYmVyO1xuICAgIG1vbml0b3I/OiBudW1iZXI7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRUTCBzZWNvbmRzIGZvciBzdHJlYW0gcmVjb3Jkcy5cbiAgICogKENvcnJlc3BvbmRzIHRvIFN0cmVhbVRUTFNlY29uZHMgcGFyYW1ldGVyKVxuICAgKi9cbiAgc3RyZWFtVFRMU2Vjb25kcz86IG51bWJlcjtcblxuICAvKipcbiAgICogSGFzaCBrZXkgdG8gdXNlIGZvciB0aGUgbW9uaXRvciBkYXRhLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTW9uaXRvclNoYXJkSGFzaEtleSBwYXJhbWV0ZXIpXG4gICAqL1xuICBtb25pdG9yU2hhcmRIYXNoS2V5PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBzdGFjayBuYW1lIGlkZW50aWZpZXIsIHVzZWQgZm9yIGNyZWF0aW5nIHByZWRpY3RhYmxlIGV4cG9ydCBuYW1lcy5cbiAgICovXG4gIGV4cG9ydE5hbWVQcmVmaXg/OiBzdHJpbmc7XG5cbiAgc3RhY2s/OiBjZGsuU3RhY2s7XG4gIGlzVHJ1c3RpbmdBY2NvdW50PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIEJ1cyBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBsZW9TdHJlYW1UYWJsZTogZHluYW1vZGIuSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQXJjaGl2ZVRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9FdmVudFRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9TZXR0aW5nc1RhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Dcm9uVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb1N5c3RlbVRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9LaW5lc2lzU3RyZWFtOiBraW5lc2lzLklTdHJlYW07XG4gIHB1YmxpYyByZWFkb25seSBsZW9TM0J1Y2tldDogczMuSUJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGJ1c1N0YWNrTmFtZU91dHB1dDogc3RyaW5nOyAvLyBUbyByZXBsYWNlIHRoZSBTU00gcGFyYW0gdmFsdWVcbiAgcHVibGljIHJlYWRvbmx5IGxlb0JvdFJvbGU6IGlhbS5JUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0luc3RhbGxSb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9LaW5lc2lzUm9sZTogaWFtLklSb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvRmlyZWhvc2VSb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Dcm9uUm9sZTogaWFtLklSb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvQm90UG9saWN5OiBpYW0uSU1hbmFnZWRQb2xpY3k7XG4gIHB1YmxpYyByZWFkb25seSBpbnN0YWxsVHJpZ2dlclNlcnZpY2VUb2tlbjogc3RyaW5nOyAvLyBTZXJ2aWNlIHRva2VuIGZvciBSZWdpc3RlclJlcGxpY2F0aW9uQm90c1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvRmlyZWhvc2VTdHJlYW1OYW1lOiBzdHJpbmc7IC8vIEFkZCBvdXRwdXQgZm9yIEZpcmVob3NlIHN0cmVhbSBuYW1lXG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEJ1c1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgIGNvbnN0IGV4cG9ydFByZWZpeCA9IHByb3BzLmV4cG9ydE5hbWVQcmVmaXggPz8gc3RhY2suc3RhY2tOYW1lO1xuICAgIGNvbnN0IGlzVHJ1c3RpbmdBY2NvdW50ID0gcHJvcHMudHJ1c3RlZEFybnMgJiYgcHJvcHMudHJ1c3RlZEFybnMubGVuZ3RoID4gMDtcblxuICAgIC8vIERlZmluZSByZXNvdXJjZXMgYmFzZWQgb24gYnVzL2Nsb3VkZm9ybWF0aW9uLmpzb24gdHJhbnNsYXRpb25cblxuICAgIC8vIDEuIFMzIEJ1Y2tldCAoTGVvUzMpXG4gICAgY29uc3QgbGVvUzMgPSBuZXcgczMuQnVja2V0KHRoaXMsICdMZW9TMycsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGNkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ3MzJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksIC8vIEVuc3VyZSB1bmlxdWUgbmFtZVxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBPciBERVNUUk9ZIGRlcGVuZGluZyBvbiByZXF1aXJlbWVudHNcbiAgICAgIC8vIEFkZCB2ZXJzaW9uaW5nLCBlbmNyeXB0aW9uLCBsaWZlY3ljbGUgcnVsZXMgYXMgbmVlZGVkIGZyb20gQ0ZOXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgIH0pO1xuICAgIHRoaXMubGVvUzNCdWNrZXQgPSBsZW9TMztcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVvUzNPdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBsZW9TMy5idWNrZXROYW1lLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb1MzYFxuICAgIH0pO1xuXG4gICAgLy8gMi4gRHluYW1vREIgVGFibGVzIChMZW9TdHJlYW0sIExlb0FyY2hpdmUsIExlb0V2ZW50LCBMZW9TZXR0aW5ncywgTGVvQ3JvbiwgTGVvU3lzdGVtKVxuICAgIGNvbnN0IGNyZWF0ZUxlb1RhYmxlID0gKHRhYmxlTmFtZTogc3RyaW5nLCBwYXJ0aXRpb25LZXk6IGR5bmFtb2RiLkF0dHJpYnV0ZSwgc29ydEtleT86IGR5bmFtb2RiLkF0dHJpYnV0ZSwgc3RyZWFtPzogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUpOiBkeW5hbW9kYi5UYWJsZSA9PiB7XG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCB0YWJsZU5hbWUsIHtcbiAgICAgICAgdGFibGVOYW1lOiBjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksIHRhYmxlTmFtZSwgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksXG4gICAgICAgIHBhcnRpdGlvbktleTogcGFydGl0aW9uS2V5LFxuICAgICAgICBzb3J0S2V5OiBzb3J0S2V5LFxuICAgICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBNYWtlIGNvbmZpZ3VyYWJsZSBpZiBuZWVkZWRcbiAgICAgICAgc3RyZWFtOiBzdHJlYW0sXG4gICAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsIC8vIEVuYWJsZSBQSVRSIGJ5IGRlZmF1bHRcbiAgICAgIH0pO1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgYCR7dGFibGVOYW1lfU91dHB1dGAsIHtcbiAgICAgICAgICB2YWx1ZTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tJHt0YWJsZU5hbWV9YFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdGFibGU7XG4gICAgfTtcblxuICAgIHRoaXMubGVvU3RyZWFtVGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvU3RyZWFtJywgeyBuYW1lOiAnZXZlbnQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCB7IG5hbWU6ICdlaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfSU1BR0UpO1xuICAgIC8vIEFkZCBUVEwgdG8gTGVvU3RyZWFtIHRhYmxlIGlmIHN0cmVhbVRUTFNlY29uZHMgaXMgcHJvdmlkZWRcbiAgICBpZiAocHJvcHMuc3RyZWFtVFRMU2Vjb25kcykge1xuICAgICAgY29uc3QgY2ZuTGVvU3RyZWFtVGFibGUgPSB0aGlzLmxlb1N0cmVhbVRhYmxlLm5vZGUuZGVmYXVsdENoaWxkIGFzIGR5bmFtb2RiLkNmblRhYmxlO1xuICAgICAgY2ZuTGVvU3RyZWFtVGFibGUudGltZVRvTGl2ZVNwZWNpZmljYXRpb24gPSB7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6ICd0dGwnLFxuICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICB9O1xuICAgIH1cbiAgICB0aGlzLmxlb0FyY2hpdmVUYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9BcmNoaXZlJywgeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9KTtcbiAgICB0aGlzLmxlb0V2ZW50VGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvRXZlbnQnLCB7IG5hbWU6ICdldmVudCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTKTtcbiAgICB0aGlzLmxlb1NldHRpbmdzVGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvU2V0dGluZ3MnLCB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0pO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb0Nyb24nLCB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHVuZGVmaW5lZCwgZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTKTtcbiAgICB0aGlzLmxlb1N5c3RlbVRhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb1N5c3RlbScsIHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSk7XG5cbiAgICAvLyAzLiBLaW5lc2lzIFN0cmVhbSAoTGVvS2luZXNpc1N0cmVhbSlcbiAgICBjb25zdCBsZW9LaW5lc2lzID0gbmV3IGtpbmVzaXMuU3RyZWFtKHRoaXMsICdMZW9LaW5lc2lzU3RyZWFtJywge1xuICAgICAgc3RyZWFtTmFtZTogY2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZC50b0xvd2VyQ2FzZSgpLCAna2luZXNpcycsIHByb3BzLmVudmlyb25tZW50TmFtZV0pLFxuICAgICAgc2hhcmRDb3VudDogcHJvcHMua2luZXNpc1NoYXJkcyA/PyAxLCAvLyBVc2Uga2luZXNpc1NoYXJkcyBwYXJhbWV0ZXIgaWYgcHJvdmlkZWQsIGRlZmF1bHQgdG8gMVxuICAgICAgLy8gcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMjQpLCAvLyBEZWZhdWx0IGlzIDI0aFxuICAgICAgc3RyZWFtTW9kZTogcHJvcHMua2luZXNpc1NoYXJkcyA/IGtpbmVzaXMuU3RyZWFtTW9kZS5QUk9WSVNJT05FRCA6IGtpbmVzaXMuU3RyZWFtTW9kZS5PTl9ERU1BTkQsIC8vIFVzZSBwcm92aXNpb25lZCBpZiBzaGFyZHMgc3BlY2lmaWVkXG4gICAgfSk7XG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtID0gbGVvS2luZXNpcztcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVvS2luZXNpc1N0cmVhbU91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IGxlb0tpbmVzaXMuc3RyZWFtTmFtZSxcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9LaW5lc2lzU3RyZWFtYFxuICAgIH0pO1xuXG4gICAgLy8gNC4gSUFNIFJvbGVzICYgUG9saWNpZXNcblxuICAgIC8vIExlb0JvdFBvbGljeSAoTWFuYWdlZCBQb2xpY3kgYmFzZWQgb24gQ0ZOKVxuICAgIGNvbnN0IGJvdFBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnTGVvQm90UG9saWN5Jywge1xuICAgICAgICBtYW5hZ2VkUG9saWN5TmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsIGlkLCAnTGVvQm90UG9saWN5JywgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdDb21tb24gcG9saWN5IGZvciBMZW8gQnVzIExhbWJkYXMnLFxuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IHdyaXRpbmcgdG8gTGVvQ3JvblxuICAgICAgICAgICAgICAgIHNpZDogJ0xlb0Nyb25BY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZHluYW1vZGI6UHV0SXRlbScsICdkeW5hbW9kYjpCYXRjaFdyaXRlSXRlbScsICdkeW5hbW9kYjpVcGRhdGVJdGVtJywgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLCAnZHluYW1vZGI6U2NhbiddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMubGVvQ3JvblRhYmxlLnRhYmxlQXJuXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IG1hbmFnaW5nIEV2ZW50QnJpZGdlIHJ1bGVzIGZvciBjcm9uXG4gICAgICAgICAgICAgICAgc2lkOiAnRXZlbnRCcmlkZ2VDcm9uTWFuYWdlbWVudCcsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydldmVudHM6UHV0UnVsZScsICdldmVudHM6UHV0VGFyZ2V0cycsICdldmVudHM6RGVsZXRlUnVsZScsICdldmVudHM6UmVtb3ZlVGFyZ2V0cycsICdldmVudHM6RGVzY3JpYmVSdWxlJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXZlbnRzOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OnJ1bGUvJHtzdGFjay5zdGFja05hbWV9LSR7aWQudG9Mb3dlckNhc2UoKX0tKmBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgLy8gQWxsb3cgYWRkaW5nIExhbWJkYSBwZXJtaXNzaW9ucyBmb3IgRXZlbnRCcmlkZ2UgdHJpZ2dlcnNcbiAgICAgICAgICAgICAgICBzaWQ6ICdMYW1iZGFFdmVudEJyaWRnZVBlcm1pc3Npb25zJyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJywgJ2xhbWJkYTpSZW1vdmVQZXJtaXNzaW9uJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bGFtYmRhOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmZ1bmN0aW9uOiR7c3RhY2suc3RhY2tOYW1lfS0ke2lkLnRvTG93ZXJDYXNlKCl9LSpgXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IHJlYWRpbmcgU3lzdGVtL1NldHRpbmdzIHRhYmxlc1xuICAgICAgICAgICAgICAgIHNpZDogJ1JlYWRTeXN0ZW1TZXR0aW5ncycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOlF1ZXJ5JywgJ2R5bmFtb2RiOlNjYW4nXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlQXJuLCB0aGlzLmxlb1NldHRpbmdzVGFibGUudGFibGVBcm5dXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIC8vIEFkZCBLaW5lc2lzL1MzL0ZpcmVob3NlIHdyaXRlIHBlcm1pc3Npb25zP1xuICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgICAgICAgICAgc2lkOiAnQnVzV3JpdGVBY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsna2luZXNpczpQdXRSZWNvcmQnLCAna2luZXNpczpQdXRSZWNvcmRzJywgJ2ZpcmVob3NlOlB1dFJlY29yZCcsICdmaXJlaG9zZTpQdXRSZWNvcmRCYXRjaCcsICdzMzpQdXRPYmplY3QnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgICAgICAgICAgICAgICAgYGFybjphd3M6ZmlyZWhvc2U6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZGVsaXZlcnlzdHJlYW0vJHtjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksICdmaXJlaG9zZScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pfWAsIC8vIEZpcmVob3NlIEFSTlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybiwgLy8gR3JhbnRpbmcgUHV0T2JqZWN0IG9uIGJ1Y2tldCBBUk4gaXRzZWxmIGlzIHVzdWFsbHkgbm90IG5lZWRlZFxuICAgICAgICAgICAgICAgICAgICBgJHt0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybn0vKmAgLy8gR3JhbnQgUHV0T2JqZWN0IG9uIG9iamVjdHMgd2l0aGluIHRoZSBidWNrZXRcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAvLyBBZGQgcmVhZCBhY2Nlc3MgdG8gY29tbW9uIHRhYmxlcyBuZWVkZWQgYnkgbWFueSBib3RzXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgc2lkOiAnQnVzUmVhZEFjY2VzcycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsICdkeW5hbW9kYjpRdWVyeScsICdkeW5hbW9kYjpTY2FuJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU3RyZWFtVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvQXJjaGl2ZVRhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU2V0dGluZ3NUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9Dcm9uVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU3lzdGVtVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAvLyBBZGQgc3RyZWFtIHJlYWQgYWNjZXNzP1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIHNpZDogJ0J1c1N0cmVhbVJlYWRBY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldFJlY29yZHMnLCAnZHluYW1vZGI6R2V0U2hhcmRJdGVyYXRvcicsICdkeW5hbW9kYjpEZXNjcmliZVN0cmVhbScsICdkeW5hbW9kYjpMaXN0U3RyZWFtcycsXG4gICAgICAgICAgICAgICAgICAgICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtJywgJ2tpbmVzaXM6R2V0UmVjb3JkcycsICdraW5lc2lzOkdldFNoYXJkSXRlcmF0b3InLCAna2luZXNpczpMaXN0U3RyZWFtcydcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlU3RyZWFtQXJuISxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9Dcm9uVGFibGUudGFibGVTdHJlYW1Bcm4hLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVTdHJlYW1Bcm4hLCAvLyBBZGRlZCBldmVudCBzdHJlYW1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgXVxuICAgIH0pO1xuICAgIHRoaXMubGVvQm90UG9saWN5ID0gYm90UG9saWN5O1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMZW9Cb3RQb2xpY3lPdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBib3RQb2xpY3kubWFuYWdlZFBvbGljeUFybixcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9Cb3RQb2xpY3lgXG4gICAgfSk7XG5cbiAgICAvLyBSb2xlIENyZWF0aW9uIEhlbHBlclxuICAgIGNvbnN0IGNyZWF0ZUJ1c1JvbGUgPSAocm9sZUlkOiBzdHJpbmcsIHByaW5jaXBhbDogaWFtLklQcmluY2lwYWwsIGFkZGl0aW9uYWxQb2xpY2llcz86IGlhbS5Qb2xpY3lTdGF0ZW1lbnRbXSwgbWFuYWdlZFBvbGljaWVzVG9BZGQ/OiBpYW0uSU1hbmFnZWRQb2xpY3lbXSk6IGlhbS5Sb2xlID0+IHtcbiAgICAgICAgY29uc3Qgcm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCByb2xlSWQsIHtcbiAgICAgICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsIHJvbGVJZCwgcHJvcHMuZW52aXJvbm1lbnROYW1lKSxcbiAgICAgICAgICAgIGFzc3VtZWRCeTogcHJpbmNpcGFsLFxuICAgICAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICAgICAgYm90UG9saWN5LCAvLyBBdHRhY2ggY29tbW9uIExlb0JvdFBvbGljeVxuICAgICAgICAgICAgICAgIC4uLihtYW5hZ2VkUG9saWNpZXNUb0FkZCA/PyBbXSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoYWRkaXRpb25hbFBvbGljaWVzICYmIGFkZGl0aW9uYWxQb2xpY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBvbGljeSBvZiBhZGRpdGlvbmFsUG9saWNpZXMpIHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KHBvbGljeSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfTtcblxuICAgIC8vIExlb0JvdFJvbGVcbiAgICBjb25zdCBib3RSb2xlUHJpbmNpcGFsID0gbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpO1xuICAgIGlmIChpc1RydXN0aW5nQWNjb3VudCkge1xuICAgICAgICBjb25zdCB0cnVzdGVkUHJpbmNpcGFscyA9IHByb3BzLnRydXN0ZWRBcm5zIS5tYXAoYXJuID0+IG5ldyBpYW0uQXJuUHJpbmNpcGFsKGFybikpO1xuICAgICAgICAvLyBIb3cgdG8gY29tYmluZSBTZXJ2aWNlUHJpbmNpcGFsIGFuZCBBcm5QcmluY2lwYWxzP1xuICAgICAgICAvLyBVc2luZyBDb21wb3NpdGVQcmluY2lwYWxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvQm90Um9sZScsIG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKGJvdFJvbGVQcmluY2lwYWwsIC4uLnRydXN0ZWRQcmluY2lwYWxzKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvQm90Um9sZScsIGJvdFJvbGVQcmluY2lwYWwpO1xuICAgIH1cblxuICAgIC8vIExlb0luc3RhbGxSb2xlXG4gICAgdGhpcy5sZW9JbnN0YWxsUm9sZSA9IGNyZWF0ZUJ1c1JvbGUoJ0xlb0luc3RhbGxSb2xlJywgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLCBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIHNpZDogJ0xlb0luc3RhbGxQZXJtaXNzaW9ucycsXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJywgJ2xhbWJkYTpSZW1vdmVQZXJtaXNzaW9uJywgLy8gQWRkZWQgcmVtb3ZlIHBlcm1pc3Npb25cbiAgICAgICAgICAgICAgICAnczM6UHV0QnVja2V0Tm90aWZpY2F0aW9uJywgJ3MzOkdldEJ1Y2tldE5vdGlmaWNhdGlvbicsXG4gICAgICAgICAgICAgICAgJ2lhbTpMaXN0QXR0YWNoZWRSb2xlUG9saWNpZXMnLCAnaWFtOkF0dGFjaFJvbGVQb2xpY3knLCAnaWFtOlBhc3NSb2xlJywgLy8gQWRkZWQgUGFzc1JvbGVcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScgLy8gS2VlcCB0aGlzPyBTZWVtcyBjb3ZlcmVkIGJ5IEJvdFBvbGljeVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFNjb3BlIGRvd24gdGhlc2UgcmVzb3VyY2VzIHNpZ25pZmljYW50bHlcbiAgICAgICAgICAgIC8vIEV4YW1wbGUgc2NvcGluZzpcbiAgICAgICAgICAgIC8vIGxhbWJkYSBwZXJtaXNzaW9uczogbGFtYmRhIEFSTnMgaW4gdGhpcyBzdGFja1xuICAgICAgICAgICAgLy8gczMgbm90aWZpY2F0aW9uOiBMZW9TMyBidWNrZXQgQVJOXG4gICAgICAgICAgICAvLyBpYW06IExlb0ZpcmVob3NlUm9sZSBBUk5cbiAgICAgICAgICAgIC8vIGR5bmFtb2RiOiBMZW9Dcm9uIHRhYmxlIEFSTlxuICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gTGVvS2luZXNpc1JvbGVcbiAgICB0aGlzLmxlb0tpbmVzaXNSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvS2luZXNpc1JvbGUnLCBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksIFtcbiAgICAgICAgLy8gSW5saW5lIHBvbGljeSBmcm9tIENGTiBzZWVtcyBjb3ZlcmVkIGJ5IEJvdFBvbGljeSdzIEJ1c1JlYWRBY2Nlc3MvQnVzU3RyZWFtUmVhZEFjY2Vzcy9CdXNXcml0ZUFjY2VzcywgdmVyaWZ5XG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIHNpZDogJ0tpbmVzaXNQcm9jZXNzb3JQZXJtaXNzaW9ucycsXG4gICAgICAgICAgICBhY3Rpb25zOiBbJ2tpbmVzaXM6R2V0UmVjb3JkcycsICdraW5lc2lzOkdldFNoYXJkSXRlcmF0b3InLCAna2luZXNpczpEZXNjcmliZVN0cmVhbScsICdraW5lc2lzOkxpc3RTdHJlYW1zJ10sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuXVxuICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gTGVvRmlyZWhvc2VSb2xlIChmb3IgTGFtYmRhLCBkaXN0aW5jdCBmcm9tIEZpcmVob3NlICpEZWxpdmVyeSogUm9sZSlcbiAgICB0aGlzLmxlb0ZpcmVob3NlUm9sZSA9IGNyZWF0ZUJ1c1JvbGUoJ0xlb0ZpcmVob3NlUm9sZScsIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSwgW1xuICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgIHNpZDogJ0ZpcmVob3NlTGFtYmRhU3BlY2lmaWMnLFxuICAgICAgICAgICAgYWN0aW9uczogWydmaXJlaG9zZTpQdXRSZWNvcmQnLCAnZmlyZWhvc2U6UHV0UmVjb3JkQmF0Y2gnXSwgLy8gRW5zdXJlIEZpcmVob3NlIHdyaXRlIGlzIGNvdmVyZWRcbiAgICAgICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmZpcmVob3NlOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmRlbGl2ZXJ5c3RyZWFtLyR7Y2RrLkZuLmpvaW4oJy0nLCBbc3RhY2suc3RhY2tOYW1lLCBpZC50b0xvd2VyQ2FzZSgpLCAnZmlyZWhvc2UnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWVdKX1gXSxcbiAgICAgICAgIH0pXG4gICAgXSk7XG5cbiAgICAvLyBMZW9Dcm9uUm9sZVxuICAgIHRoaXMubGVvQ3JvblJvbGUgPSBjcmVhdGVCdXNSb2xlKCdMZW9Dcm9uUm9sZScsIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSwgW1xuICAgICAgICAvLyBTcGVjaWZpYyBwb2xpY2llcyBmb3IgY3JvbiBzY2hlZHVsaW5nL3RyaWdnZXJpbmc/XG4gICAgICAgIC8vIENGTiBwb2xpY3kgc2VlbXMgY292ZXJlZCBieSBCb3RQb2xpY3ksIHZlcmlmeVxuICAgICAgICAvLyBOZWVkIGxhbWJkYTpJbnZva2VGdW5jdGlvbiBmb3IgdHJpZ2dlcmluZyBvdGhlciBib3RzP1xuICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgIHNpZDogJ0ludm9rZUJvdHMnLFxuICAgICAgICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJywgJ2xhbWJkYTpJbnZva2VBc3luYyddLFxuICAgICAgICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxhbWJkYToke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpmdW5jdGlvbjoke3N0YWNrLnN0YWNrTmFtZX0tJHtpZC50b0xvd2VyQ2FzZSgpfS0qYF1cbiAgICAgICAgIH0pXG4gICAgXSk7XG5cbiAgICAvLyBBZGQgbGFtYmRhSW52b2tlUG9saWN5IHRvIExlb0Nyb25Sb2xlIGlmIHByb3ZpZGVkXG4gICAgaWYgKHByb3BzLmxhbWJkYUludm9rZVBvbGljeSkge1xuICAgICAgY29uc3QgaW52b2tlUG9saWN5ID0gaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4oXG4gICAgICAgIHRoaXMsIFxuICAgICAgICAnTGFtYmRhSW52b2tlUG9saWN5JywgXG4gICAgICAgIHByb3BzLmxhbWJkYUludm9rZVBvbGljeVxuICAgICAgKTtcbiAgICAgIHRoaXMubGVvQ3JvblJvbGUuYWRkTWFuYWdlZFBvbGljeShpbnZva2VQb2xpY3kpO1xuICAgIH1cblxuICAgIC8vIDUuIEZpcmVob3NlIERlbGl2ZXJ5IFN0cmVhbSAodXNpbmcgaXRzIG93biByb2xlIGBmaXJlaG9zZURlbGl2ZXJ5Um9sZWAgZGVmaW5lZCBiZWxvdylcbiAgICBjb25zdCBmaXJlaG9zZURlbGl2ZXJ5Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmlyZWhvc2VEZWxpdmVyeVJvbGUnLCB7XG4gICAgICAgIHJvbGVOYW1lOiBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICdGaXJlaG9zZVJvbGUnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZmlyZWhvc2UuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgZmlyZWhvc2VEZWxpdmVyeVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnbG9nczpDcmVhdGVMb2dHcm91cCcsXG4gICAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJ1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2tpbmVzaXNmaXJlaG9zZS8ke2Nkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ2ZpcmVob3NlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSl9OipgXVxuICAgIH0pKTtcblxuICAgIHRoaXMubGVvUzNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoZmlyZWhvc2VEZWxpdmVyeVJvbGUpO1xuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5ncmFudFJlYWQoZmlyZWhvc2VEZWxpdmVyeVJvbGUpO1xuXG4gICAgY29uc3QgbGVvRmlyZWhvc2UgPSBuZXcgZmlyZWhvc2UuQ2ZuRGVsaXZlcnlTdHJlYW0odGhpcywgJ0xlb0ZpcmVob3NlU3RyZWFtJywge1xuICAgICAgICBkZWxpdmVyeVN0cmVhbU5hbWU6IGNkay5Gbi5qb2luKCctJywgW3N0YWNrLnN0YWNrTmFtZSwgaWQudG9Mb3dlckNhc2UoKSwgJ2ZpcmVob3NlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lXSksXG4gICAgICAgIGRlbGl2ZXJ5U3RyZWFtVHlwZTogJ0tpbmVzaXNTdHJlYW1Bc1NvdXJjZScsXG4gICAgICAgIGtpbmVzaXNTdHJlYW1Tb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBraW5lc2lzU3RyZWFtQXJuOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuLFxuICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFybiAvLyBVc2UgdGhlIGRlZGljYXRlZCBGaXJlaG9zZSByb2xlXG4gICAgICAgIH0sXG4gICAgICAgIHMzRGVzdGluYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBidWNrZXRBcm46IHRoaXMubGVvUzNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFybiwgLy8gVXNlIHRoZSBkZWRpY2F0ZWQgRmlyZWhvc2Ugcm9sZVxuICAgICAgICAgICAgcHJlZml4OiAnZmlyZWhvc2UvJywgLy8gQWRkZWQgcHJlZml4IGV4YW1wbGUsIGN1c3RvbWl6ZSBhcyBuZWVkZWRcbiAgICAgICAgICAgIGVycm9yT3V0cHV0UHJlZml4OiAnZmlyZWhvc2UtZXJyb3JzLycsIC8vIEFkZGVkIGVycm9yIHByZWZpeCBleGFtcGxlXG4gICAgICAgICAgICBidWZmZXJpbmdIaW50czoge1xuICAgICAgICAgICAgICAgIGludGVydmFsSW5TZWNvbmRzOiAzMDAsXG4gICAgICAgICAgICAgICAgc2l6ZUluTUJzOiA1XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tcHJlc3Npb25Gb3JtYXQ6ICdHWklQJywgLy8gQ2hhbmdlZCB0byBHWklQIGV4YW1wbGVcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hMb2dnaW5nT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9raW5lc2lzZmlyZWhvc2UvJHtjZGsuRm4uam9pbignLScsIFtzdGFjay5zdGFja05hbWUsIGlkLnRvTG93ZXJDYXNlKCksICdmaXJlaG9zZScsIHByb3BzLmVudmlyb25tZW50TmFtZV0pfWAsXG4gICAgICAgICAgICAgICAgbG9nU3RyZWFtTmFtZTogJ1MzRGVsaXZlcnknXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lID0gbGVvRmlyZWhvc2UucmVmOyAvLyBBc3NpZ24gRmlyZWhvc2UgbmFtZSB0byBwcm9wZXJ0eVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0ZpcmVob3NlU3RyZWFtT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogbGVvRmlyZWhvc2UucmVmLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0ZpcmVob3NlU3RyZWFtYFxuICAgIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMZW9GaXJlaG9zZVN0cmVhbU5hbWVPdXRwdXQnLCB7IC8vIE9wdGlvbmFsbHkgZXhwb3J0IG5hbWUgdG9vXG4gICAgICAgIHZhbHVlOiB0aGlzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9GaXJlaG9zZVN0cmVhbU5hbWVgXG4gICAgfSk7XG5cbiAgICAvLyA2LiBMYW1iZGEgRnVuY3Rpb25zIChVcGRhdGUgcm9sZXMpXG4gICAgY29uc3QgYnVzTGFtYmRhRW52aXJvbm1lbnQgPSB7XG4gICAgICAgIExFT19FTlZJUk9OTUVOVDogcHJvcHMuZW52aXJvbm1lbnROYW1lLFxuICAgICAgICBMRU9fU1RSRUFNX1RBQkxFOiB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX0FSQ0hJVkVfVEFCTEU6IHRoaXMubGVvQXJjaGl2ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX0VWRU5UX1RBQkxFOiB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fU0VUVElOR1NfVEFCTEU6IHRoaXMubGVvU2V0dGluZ3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19DUk9OX1RBQkxFOiB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19TWVNURU1fVEFCTEU6IHRoaXMubGVvU3lzdGVtVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fS0lORVNJU19TVFJFQU06IHRoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1OYW1lLFxuICAgICAgICBMRU9fUzNfQlVDS0VUOiB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIEZJUkVIT1NFX1NUUkVBTTogbGVvRmlyZWhvc2UucmVmLCAvLyBQYXNzIEZpcmVob3NlIG5hbWVcbiAgICAgICAgLy8gQlVTX1NUQUNLX05BTUUgbmVlZHMgdG8gYmUgZGV0ZXJtaW5lZCAtIHVzaW5nIGV4cG9ydFByZWZpeCBmb3Igbm93XG4gICAgICAgIEJVU19TVEFDS19OQU1FOiBleHBvcnRQcmVmaXgsXG4gICAgICAgIE5PREVfT1BUSU9OUzogJy0tZW5hYmxlLXNvdXJjZS1tYXBzJywgLy8gRW5hYmxlIHNvdXJjZSBtYXBzXG4gICAgICAgIEFXU19OT0RFSlNfQ09OTkVDVElPTl9SRVVTRV9FTkFCTEVEOiAnMScsXG4gICAgfTtcblxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgQnVzIExhbWJkYSBmdW5jdGlvbnMgd2l0aCBjb25zaXN0ZW50IHNldHRpbmdzXG4gICAgZnVuY3Rpb24gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICBzY29wZTogQ29uc3RydWN0LFxuICAgICAgICBpZDogc3RyaW5nLFxuICAgICAgICBjb2RlRGlyOiBzdHJpbmcsIC8vIERpcmVjdG9yeSBuYW1lIHVuZGVyIGxhbWJkYS9idXMvXG4gICAgICAgIHJvbGU6IGlhbS5JUm9sZSxcbiAgICAgICAgZW52aXJvbm1lbnQ/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9LFxuICAgICAgICB0aW1lb3V0PzogY2RrLkR1cmF0aW9uLFxuICAgICAgICBtZW1vcnlTaXplPzogbnVtYmVyXG4gICAgKTogbm9kZWpzLk5vZGVqc0Z1bmN0aW9uIHtcbiAgICAgICAgLy8gVXNlIGEgdHJ1bmNhdGVkIGZ1bmN0aW9uIG5hbWUgZm9ybWF0IHdpdGggc3RhY2sgbmFtZSBpbmNsdWRlZFxuICAgICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICcnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpO1xuICAgICAgICAvLyBSZXNvbHZlIGVudHJ5IHBhdGggcmVsYXRpdmUgdG8gdGhlIGluZGl2aWR1YWwgbGFtYmRhJ3MgZGlyZWN0b3J5IHdpdGhpbiB0aGUgcHJvamVjdCByb290XG4gICAgICAgIGNvbnN0IGVudHJ5UGF0aCA9IHBhdGgucmVzb2x2ZShgLi9sYW1iZGEvYnVzLyR7Y29kZURpcn0vaW5kZXguanNgKTsgXG4gICAgICAgIC8vIFNldCBwcm9qZWN0Um9vdCB0byB0aGUgbWFpbiBDREsgcHJvamVjdCBkaXJlY3RvcnksIHdoZXJlIHBhY2thZ2UtbG9jay5qc29uIGlzXG4gICAgICAgIGNvbnN0IHByb2plY3RSb290UGF0aCA9IHBhdGgucmVzb2x2ZShgLi9gKTsgXG5cbiAgICAgICAgLy8gVXNlIG1lbW9yeSBzaXplIGZyb20gcHJvcHMubGFtYmRhTWVtb3J5IGlmIGF2YWlsYWJsZSBhbmQgc3BlY2lmaWMgdG8gdGhpcyBmdW5jdGlvblxuICAgICAgICBjb25zdCBkZWZhdWx0TWVtb3J5ID0gMTAyNDsgLy8gRGVmYXVsdCBtZW1vcnkgaWYgbm90IHNwZWNpZmllZFxuICAgICAgICBsZXQgY29uZmlndXJlZE1lbW9yeSA9IG1lbW9yeVNpemUgfHwgZGVmYXVsdE1lbW9yeTtcbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgbWVtb3J5IGNvbmZpZyBpbiBwcm9wcyBmb3IgdGhpcyBzcGVjaWZpYyBsYW1iZGFcbiAgICAgICAgaWYgKHByb3BzLmxhbWJkYU1lbW9yeSkge1xuICAgICAgICAgICAgaWYgKGlkID09PSAnS2luZXNpc1Byb2Nlc3NvcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmtpbmVzaXNTdHJlYW1Qcm9jZXNzb3IpIHtcbiAgICAgICAgICAgICAgICBjb25maWd1cmVkTWVtb3J5ID0gcHJvcHMubGFtYmRhTWVtb3J5LmtpbmVzaXNTdHJlYW1Qcm9jZXNzb3I7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGlkID09PSAnRmlyZWhvc2VQcm9jZXNzb3InICYmIHByb3BzLmxhbWJkYU1lbW9yeS5maXJlaG9zZVN0cmVhbVByb2Nlc3Nvcikge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWRNZW1vcnkgPSBwcm9wcy5sYW1iZGFNZW1vcnkuZmlyZWhvc2VTdHJlYW1Qcm9jZXNzb3I7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKChpZCA9PT0gJ0Nyb25Qcm9jZXNzb3InIHx8IGlkID09PSAnQ3JvblNjaGVkdWxlcicpICYmIHByb3BzLmxhbWJkYU1lbW9yeS5jcm9uUHJvY2Vzc29yKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5jcm9uUHJvY2Vzc29yO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpZCA9PT0gJ0xlb0V2ZW50VHJpZ2dlcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmV2ZW50VHJpZ2dlcikge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWRNZW1vcnkgPSBwcm9wcy5sYW1iZGFNZW1vcnkuZXZlbnRUcmlnZ2VyO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpZCA9PT0gJ0xlb01vbml0b3InICYmIHByb3BzLmxhbWJkYU1lbW9yeS5tb25pdG9yKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5tb25pdG9yO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHNjb3BlLCBpZCwge1xuICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsIC8vIFVwZGF0ZWQgdG8gTm9kZS5qcyAyMiBydW50aW1lXG4gICAgICAgICAgICBlbnRyeTogZW50cnlQYXRoLFxuICAgICAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICAgICAgZnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUsXG4gICAgICAgICAgICByb2xlOiByb2xlLFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICAuLi4oZW52aXJvbm1lbnQgfHwge30pLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXQgfHwgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBtZW1vcnlTaXplOiBjb25maWd1cmVkTWVtb3J5LFxuICAgICAgICAgICAgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgICAgICAgIGF3c1Nka0Nvbm5lY3Rpb25SZXVzZTogdHJ1ZSxcbiAgICAgICAgICAgIHByb2plY3RSb290OiBwcm9qZWN0Um9vdFBhdGgsIC8vIFNldCB0byBtYWluIHByb2plY3Qgcm9vdFxuICAgICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2F3cy1zZGsnLCAvLyB2MiBTREsgKGtlcHQgZm9yIG5vdywgbWF5YmUgcmVtb3ZlIGxhdGVyIGlmIG9ubHkgdjMgdXNlZClcbiAgICAgICAgICAgICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1pYW0nLCAvLyBBZGQgdjMgSUFNIGNsaWVudCB0byBleHRlcm5hbHNcbiAgICAgICAgICAgICAgICAgICAgJ21vbWVudCcsXG4gICAgICAgICAgICAgICAgICAgICdsZW8tc2RrJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1jcm9uJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1sb2dnZXInLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY2RrLlRhZ3Mub2YobGFtYmRhRnVuY3Rpb24pLmFkZCgnU3RhY2snLCBjZGsuU3RhY2sub2Yoc2NvcGUpLnN0YWNrTmFtZSk7XG4gICAgICAgIGNkay5UYWdzLm9mKGxhbWJkYUZ1bmN0aW9uKS5hZGQoJ0NvbnN0cnVjdCcsICdMYW1iZGEnKTtcblxuICAgICAgICByZXR1cm4gbGFtYmRhRnVuY3Rpb247XG4gICAgfVxuXG4gICAgLy8gS2luZXNpc1Byb2Nlc3NvclxuICAgIGNvbnN0IGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdLaW5lc2lzUHJvY2Vzc29yJyxcbiAgICAgICAgJ2tpbmVzaXMtcHJvY2Vzc29yJyxcbiAgICAgICAgdGhpcy5sZW9LaW5lc2lzUm9sZSxcbiAgICAgICAge1xuICAgICAgICAgICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzIHNwZWNpZmljIHRvIEtpbmVzaXNQcm9jZXNzb3JcbiAgICAgICAgICAgIC8vIEFkZCBsZW9TdHJlYW0sIGtpbmVzaXNTdHJlYW0gaWYgbmVlZGVkIGZyb20gcHJvcHMgb3IgY29udGV4dFxuICAgICAgICAgICAgbGVvX2tpbmVzaXNfc3RyZWFtOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgICAgIFJFR0lPTjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICAgIFRaOiBwcm9jZXNzLmVudi5UWiB8fCAnVVRDJywgLy8gVXNlIFVUQyBpZiBUWiBub3Qgc2V0XG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgMTAyNFxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgaWYgbmVlZGVkIChlLmcuLCB0byB3cml0ZSB0byBvdGhlciByZXNvdXJjZXMpXG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG4gICAgLy8gQWRkIG90aGVyIGdyYW50cyBiYXNlZCBvbiBDRk4gcG9saWNpZXNcblxuICAgIC8vIEFkZCBLaW5lc2lzIGV2ZW50IHNvdXJjZSBtYXBwaW5nXG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG5cbiAgICAvLyBGaXJlaG9zZVByb2Nlc3NvclxuICAgIGNvbnN0IGZpcmVob3NlUHJvY2Vzc29yTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnRmlyZWhvc2VQcm9jZXNzb3InLFxuICAgICAgICAnZmlyZWhvc2UtcHJvY2Vzc29yJyxcbiAgICAgICAgdGhpcy5sZW9GaXJlaG9zZVJvbGUsXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICB0aGlzLmxlb1N0cmVhbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmaXJlaG9zZVByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmaXJlaG9zZVByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TeXN0ZW1UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZmlyZWhvc2VQcm9jZXNzb3JMYW1iZGEpO1xuICAgIC8vIEFkZCBvdGhlciBncmFudHMgYmFzZWQgb24gQ0ZOIHBvbGljaWVzXG5cbiAgICAvLyBTM0xvYWRUcmlnZ2VyXG4gICAgY29uc3QgczNMb2FkVHJpZ2dlckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ1MzTG9hZFRyaWdnZXInLFxuICAgICAgICAnczMtbG9hZC10cmlnZ2VyJyxcbiAgICAgICAgdGhpcy5sZW9GaXJlaG9zZVJvbGUsIC8vIFVzZXMgTGVvRmlyZWhvc2VSb2xlIGluIENGTlxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5ncmFudFJlYWQoczNMb2FkVHJpZ2dlckxhbWJkYSk7XG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50V3JpdGUoczNMb2FkVHJpZ2dlckxhbWJkYSk7XG4gICAgLy8gQWRkIFMzIGV2ZW50IG5vdGlmaWNhdGlvblxuICAgIHRoaXMubGVvUzNCdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXG4gICAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbihzM0xvYWRUcmlnZ2VyTGFtYmRhKVxuICAgICk7XG5cbiAgICAvLyBMZW9Nb25pdG9yXG4gICAgY29uc3QgbGVvTW9uaXRvckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0xlb01vbml0b3InLFxuICAgICAgICAnbGVvLW1vbml0b3InLFxuICAgICAgICB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICB7XG4gICAgICAgICAgICAvLyBBZGQgTW9uaXRvclNoYXJkSGFzaEtleSBpZiBwcm92aWRlZFxuICAgICAgICAgICAgLi4uKHByb3BzLm1vbml0b3JTaGFyZEhhc2hLZXkgIT09IHVuZGVmaW5lZCA/IHsgU0hBUkRfSEFTSF9LRVk6IHByb3BzLm1vbml0b3JTaGFyZEhhc2hLZXkudG9TdHJpbmcoKSB9IDoge30pXG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeSBmcm9tIENGTiBwYXJhbSwgVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxlb01vbml0b3JMYW1iZGEpO1xuXG4gICAgLy8gQ3JvblByb2Nlc3NvclxuICAgIGNvbnN0IGNyb25Qcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdDcm9uUHJvY2Vzc29yJyxcbiAgICAgICAgJ2Nyb24nLFxuICAgICAgICB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjcm9uUHJvY2Vzc29yTGFtYmRhKTtcbiAgICB0aGlzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNyb25Qcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvU2V0dGluZ3NUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY3JvblByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TeXN0ZW1UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY3JvblByb2Nlc3NvckxhbWJkYSk7XG4gICAgLy8gQWRkIER5bmFtb0RCIEV2ZW50IFNvdXJjZSBNYXBwaW5nIGZvciBDcm9uIHRhYmxlIHN0cmVhbSB0byBDcm9uUHJvY2Vzc29yXG4gICAgY3JvblByb2Nlc3NvckxhbWJkYS5hZGRFdmVudFNvdXJjZU1hcHBpbmcoJ0Nyb25TdHJlYW1Tb3VyY2UnLCB7XG4gICAgICAgIGV2ZW50U291cmNlQXJuOiB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZVN0cmVhbUFybiEsXG4gICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IGxhbWJkYS5TdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTixcbiAgICAgICAgYmF0Y2hTaXplOiA1MDAgLy8gTWF0Y2ggQ0ZOXG4gICAgfSk7XG5cbiAgICAvLyBBcmNoaXZlUHJvY2Vzc29yXG4gICAgY29uc3QgYXJjaGl2ZUxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0FyY2hpdmVQcm9jZXNzb3InLFxuICAgICAgICAnYXJjaGl2ZScsXG4gICAgICAgIHRoaXMubGVvQm90Um9sZSwgLy8gVXNlcyBnZW5lcmljIExlb0JvdFJvbGVcbiAgICAgICAge30sIC8vIE5vIHNwZWNpZmljIGVudiB2YXJzIGZyb20gQ0ZOXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeS9UaW1lb3V0IGZyb20gQ0ZOXG4gICAgKTtcbiAgICAvLyBHcmFudCBuZWNlc3NhcnkgcGVybWlzc2lvbnMgKGUuZy4sIFMzIHdyaXRlIHRvIGFyY2hpdmUgYnVja2V0IGlmIHNlcGFyYXRlKVxuICAgIHRoaXMubGVvUzNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXJjaGl2ZUxhbWJkYSk7XG5cbiAgICAvLyBMZW9FdmVudFRyaWdnZXIgLSBEZWZpbmVkIGRpcmVjdGx5IHRvIGlzb2xhdGUgZnJvbSBoZWxwZXIgaXNzdWVzXG4gICAgY29uc3QgbGVvRXZlbnRUcmlnZ2VyTGFtYmRhID0gbmV3IG5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnTGVvRXZlbnRUcmlnZ2VyJywge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCwgLy8gVXBkYXRlZCB0byBOb2RlLmpzIDIyIHJ1bnRpbWVcbiAgICAgICAgZW50cnk6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9sYW1iZGEvYnVzL2V2ZW50LXRyaWdnZXIvaW5kZXguanMnKSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICBmdW5jdGlvbk5hbWU6IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCAnZXZlbnQtdHJpZ2dlcicsICcnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpLFxuICAgICAgICByb2xlOiB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgLi4uYnVzTGFtYmRhRW52aXJvbm1lbnQsXG4gICAgICAgICAgICAvLyBBZGQgYW55IHNwZWNpZmljIGVudmlyb25tZW50IHZhcmlhYmxlcyBpZiBuZWVkZWRcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICAgIGF3c1Nka0Nvbm5lY3Rpb25SZXVzZTogdHJ1ZSxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgICAgICdhd3Mtc2RrJyxcbiAgICAgICAgICAgICAgICAnbW9tZW50JyxcbiAgICAgICAgICAgICAgICAnbGVvLXNkaycsXG4gICAgICAgICAgICAgICAgJ2xlby1jcm9uJyxcbiAgICAgICAgICAgICAgICAnbGVvLWxvZ2dlcicsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5GSVZFX0RBWVMsXG4gICAgfSk7XG4gICAgY2RrLlRhZ3Mub2YobGVvRXZlbnRUcmlnZ2VyTGFtYmRhKS5hZGQoJ1N0YWNrJywgZXhwb3J0UHJlZml4KTtcbiAgICBjZGsuVGFncy5vZihsZW9FdmVudFRyaWdnZXJMYW1iZGEpLmFkZCgnQ29uc3RydWN0JywgJ0xhbWJkYScpO1xuXG4gICAgLy8gQWRkIER5bmFtb0RCIEV2ZW50IFNvdXJjZSBNYXBwaW5nIGZvciBMZW9FdmVudCB0YWJsZVxuICAgIGxlb0V2ZW50VHJpZ2dlckxhbWJkYS5hZGRFdmVudFNvdXJjZU1hcHBpbmcoJ0V2ZW50VGFibGVTb3VyY2UnLCB7XG4gICAgICAgIGV2ZW50U291cmNlQXJuOiB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVTdHJlYW1Bcm4hLFxuICAgICAgICBzdGFydGluZ1Bvc2l0aW9uOiBsYW1iZGEuU3RhcnRpbmdQb3NpdGlvbi5UUklNX0hPUklaT04sXG4gICAgICAgIGJhdGNoU2l6ZTogNTAwIC8vIE1hdGNoIENGTlxuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIHRoZSB0eXBlIGZvciBpbnN0YWxsRW52IGV4cGxpY2l0bHkgLSBSZS1hZGRlZFxuICAgIGludGVyZmFjZSBJbnN0YWxsRW52VHlwZSB7XG4gICAgICAgIEFQUF9UQUJMRTogc3RyaW5nO1xuICAgICAgICBTWVNURU1fVEFCTEU6IHN0cmluZztcbiAgICAgICAgQ1JPTl9UQUJMRTogc3RyaW5nO1xuICAgICAgICBFVkVOVF9UQUJMRTogc3RyaW5nO1xuICAgICAgICBTVFJFQU1fVEFCTEU6IHN0cmluZztcbiAgICAgICAgS0lORVNJU19UQUJMRTogc3RyaW5nO1xuICAgICAgICBMRU9fS0lORVNJU19TVFJFQU1fTkFNRTogc3RyaW5nO1xuICAgICAgICBMRU9fRklSRUhPU0VfU1RSRUFNX05BTUU6IHN0cmluZztcbiAgICAgICAgTEVPX0FSQ0hJVkVfUFJPQ0VTU09SX0xPR0lDQUxfSUQ6IHN0cmluZztcbiAgICAgICAgTEVPX01PTklUT1JfTE9HSUNBTF9JRDogc3RyaW5nO1xuICAgICAgICBMRU9fRklSRUhPU0VfUk9MRV9BUk46IHN0cmluZztcbiAgICAgICAgTEVPX0VWRU5UX1RSSUdHRVJfTE9HSUNBTF9JRD86IHN0cmluZztcbiAgICAgICAgTEVPX1MzX0xPQURfVFJJR0dFUl9BUk4/OiBzdHJpbmc7XG4gICAgICAgIExFT19DUk9OX1BST0NFU1NPUl9BUk4/OiBzdHJpbmc7XG4gICAgICAgIExFT19LSU5FU0lTX1BST0NFU1NPUl9BUk4/OiBzdHJpbmc7XG4gICAgfVxuXG4gICAgLy8gSW5zdGFsbEZ1bmN0aW9uXG4gICAgY29uc3QgaW5zdGFsbEVudjogSW5zdGFsbEVudlR5cGUgPSB7XG4gICAgICAgIEFQUF9UQUJMRTogdGhpcy5sZW9TZXR0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1lTVEVNX1RBQkxFOiB0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgQ1JPTl9UQUJMRTogdGhpcy5sZW9Dcm9uVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9UQUJMRTogdGhpcy5sZW9FdmVudFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1RSRUFNX1RBQkxFOiB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgS0lORVNJU19UQUJMRTogdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbU5hbWUsIC8vIENvcnJlY3RlZCBmcm9tIHRhYmxlIG5hbWUgLSBLaW5lc2lzIGlzIGEgc3RyZWFtXG4gICAgICAgIExFT19LSU5FU0lTX1NUUkVBTV9OQU1FOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgTEVPX0ZJUkVIT1NFX1NUUkVBTV9OQU1FOiB0aGlzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgTEVPX0FSQ0hJVkVfUFJPQ0VTU09SX0xPR0lDQUxfSUQ6IGFyY2hpdmVMYW1iZGEubm9kZS5pZCxcbiAgICAgICAgTEVPX01PTklUT1JfTE9HSUNBTF9JRDogbGVvTW9uaXRvckxhbWJkYS5ub2RlLmlkLFxuICAgICAgICBMRU9fRklSRUhPU0VfUk9MRV9BUk46IHRoaXMubGVvRmlyZWhvc2VSb2xlLnJvbGVBcm4sXG4gICAgfTtcbiAgICAvLyBEZXBlbmRlbmNpZXMgZm9yIGVudmlyb25tZW50IHZhcmlhYmxlcyAtIEFzc2lnbiBhZnRlciBsYW1iZGEgZGVmaW5pdGlvbnNcbiAgICBpbnN0YWxsRW52WydMRU9fRVZFTlRfVFJJR0dFUl9MT0dJQ0FMX0lEJ10gPSBsZW9FdmVudFRyaWdnZXJMYW1iZGEubm9kZS5pZDsgLy8gTm93IGxlb0V2ZW50VHJpZ2dlckxhbWJkYSBpcyBkZWZpbmVkXG4gICAgaW5zdGFsbEVudlsnTEVPX1MzX0xPQURfVFJJR0dFUl9BUk4nXSA9IHMzTG9hZFRyaWdnZXJMYW1iZGEuZnVuY3Rpb25Bcm47XG4gICAgaW5zdGFsbEVudlsnTEVPX0NST05fUFJPQ0VTU09SX0FSTiddID0gY3JvblByb2Nlc3NvckxhbWJkYS5mdW5jdGlvbkFybjtcbiAgICBpbnN0YWxsRW52WydMRU9fS0lORVNJU19QUk9DRVNTT1JfQVJOJ10gPSBraW5lc2lzUHJvY2Vzc29yTGFtYmRhLmZ1bmN0aW9uQXJuO1xuXG4gICAgY29uc3QgaW5zdGFsbExhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0luc3RhbGxGdW5jdGlvbicsXG4gICAgICAgICdpbnN0YWxsJyxcbiAgICAgICAgdGhpcy5sZW9JbnN0YWxsUm9sZSxcbiAgICAgICAgaW5zdGFsbEVudiBhcyB1bmtub3duIGFzIHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0sIC8vIENvbnZlcnQgdG8gdW5rbm93biBmaXJzdCBmb3IgYXNzZXJ0aW9uXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIEFkZCBtZW1vcnkgc2l6ZVxuICAgICk7XG4gICAgLy8gQWRkIGdyYW50cyBiYXNlZCBvbiBDRk4gcG9saWNpZXMgKGUuZy4sIGR5bmFtb2RiOkNyZWF0ZVRhYmxlLCBpYW06UGFzc1JvbGUpXG4gICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb1N5c3RlbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb0Nyb25UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaW5zdGFsbExhbWJkYSk7XG4gICAgdGhpcy5sZW9FdmVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb1N0cmVhbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uZ3JhbnRSZWFkV3JpdGUoaW5zdGFsbExhbWJkYSk7XG4gICAgLy8gQWRkIHBvbGljaWVzIGZvciBDcmVhdGVUYWJsZSwgUGFzc1JvbGUgZXRjLiBiYXNlZCBvbiBMZW9JbnN0YWxsUm9sZSBpbiBDRk5cblxuICAgIC8vIENyb25TY2hlZHVsZXIgKExhbWJkYSBmb3IgdHJpZ2dlcmluZyBzY2hlZHVsZWQgY3JvbnMpXG4gICAgY29uc3QgY3JvblNjaGVkdWxlckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0Nyb25TY2hlZHVsZXInLFxuICAgICAgICAnY3Jvbi1zY2hlZHVsZXInLFxuICAgICAgICB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjcm9uU2NoZWR1bGVyTGFtYmRhKTsgLy8gTmVlZHMgdG8gcmVhZC93cml0ZSBjcm9uIGpvYnNcbiAgICAvLyBOZWVkcyBFdmVudEJyaWRnZSB0cmlnZ2VyIChzZWUgTGVvQ3JvblNjaGVkdWxlIHJ1bGUgaW4gQ0ZOKVxuXG4gICAgLy8gQnVzQXBpUHJvY2Vzc29yIChMYW1iZGEgZm9yIEFQSSBHYXRld2F5KVxuICAgIGNvbnN0IGJ1c0FwaUxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0J1c0FwaVByb2Nlc3NvcicsXG4gICAgICAgICdidXMtYXBpJyxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlLCAvLyBVc2VzIGdlbmVyaWMgTGVvQm90Um9sZVxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGJhc2VkIG9uIEFQSSBuZWVkcyAoZS5nLiwgRHluYW1vREIgYWNjZXNzKVxuXG4gICAgLy8gQ3JlYXRlUmVwbGljYXRpb25Cb3RzIChMYW1iZGEgZm9yIEN1c3RvbSBSZXNvdXJjZSlcbiAgICBjb25zdCBjcmVhdGVSZXBsaWNhdGlvbkJvdHNMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdDcmVhdGVSZXBsaWNhdGlvbkJvdHMnLFxuICAgICAgICAnY3JlYXRlLXJlcGxpY2F0aW9uLWJvdHMnLFxuICAgICAgICB0aGlzLmxlb0luc3RhbGxSb2xlLCAvLyBVc2VzIExlb0luc3RhbGxSb2xlIGluIENGTlxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIChlLmcuLCB0byBjcmVhdGUgb3RoZXIgcmVzb3VyY2VzIGlmIG5lZWRlZClcblxuICAgIC8vIENyZWF0ZSByZXBsaWNhdG9yIExhbWJkYSB1c2VkIGJ5IHRoZSByZXBsaWNhdGlvbiBib3RzXG4gICAgY29uc3QgcmVwbGljYXRlTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnUmVwbGljYXRlTGFtYmRhJyxcbiAgICAgICAgJ3JlcGxpY2F0ZScsXG4gICAgICAgIHRoaXMubGVvQm90Um9sZSxcbiAgICAgICAge30sIC8vIE5vIHNwZWNpZmljIGVudiB2YXJzXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeSBzaXplXG4gICAgKTtcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBhY2Nlc3Mgb3RoZXIgYWNjb3VudHMgaWYgbmVlZGVkXG4gICAgaWYgKHByb3BzLnRydXN0ZWRBcm5zKSB7XG4gICAgICAgIHJlcGxpY2F0ZUxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBwcm9wcy50cnVzdGVkQXJuc1xuICAgICAgICB9KSk7XG4gICAgfVxuICAgIC8vIEFsbG93IHdyaXRpbmcgdG8ga2luZXNpcyBzdHJlYW1cbiAgICB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uZ3JhbnRXcml0ZShyZXBsaWNhdGVMYW1iZGEpO1xuXG4gICAgLy8gQ3VzdG9tIFJlc291cmNlIGZvciBSZWdpc3RlcmluZyBSZXBsaWNhdGlvbiBCb3RzXG4gICAgY29uc3QgcmVnaXN0ZXJCb3RzUHJvdmlkZXIgPSBuZXcgY3IuUHJvdmlkZXIodGhpcywgJ1JlZ2lzdGVyQm90c1Byb3ZpZGVyJywge1xuICAgICAgICBvbkV2ZW50SGFuZGxlcjogY3JlYXRlUmVwbGljYXRpb25Cb3RzTGFtYmRhLFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfREFZLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwb3J0IHRoZSByZWdpc3RlciBzZXJ2aWNlIHRva2VuIGZvciBvdGhlciBzdGFja3MgdG8gdXNlXG4gICAgdGhpcy5pbnN0YWxsVHJpZ2dlclNlcnZpY2VUb2tlbiA9IHJlZ2lzdGVyQm90c1Byb3ZpZGVyLnNlcnZpY2VUb2tlbjtcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVnaXN0ZXJTZXJ2aWNlVG9rZW5PdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiByZWdpc3RlckJvdHNQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tUmVnaXN0ZXJgXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdSZWdpc3RlclJlcGxpY2F0aW9uQm90cycsIHtcbiAgICAgICAgc2VydmljZVRva2VuOiByZWdpc3RlckJvdHNQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgIC8vIFByb3BlcnRpZXMgcmVxdWlyZWQgYnkgdGhlIGNyZWF0ZVJlcGxpY2F0aW9uQm90c0xhbWJkYSBmdW5jdGlvbiBiYXNlZCBvbiBvcmlnaW5hbCBpbXBsZW1lbnRhdGlvblxuICAgICAgICAgICAgUXVldWVSZXBsaWNhdGlvbk1hcHBpbmc6IHByb3BzLnF1ZXVlUmVwbGljYXRpb25NYXBwaW5nIHx8ICdbXScsXG4gICAgICAgICAgICBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOczogcHJvcHMucXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucyBcbiAgICAgICAgICAgICAgPyBwcm9wcy5xdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zLmpvaW4oJywnKSBcbiAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBSZXBsaWNhdG9yTGFtYmRhTmFtZTogY3JlYXRlVHJ1bmNhdGVkTmFtZShzdGFjay5zdGFja05hbWUsICdyZXBsaWNhdGVsYW1iZGEnLCAnJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKVxuICAgICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gOC4gT3V0cHV0c1xuICAgIHRoaXMuYnVzU3RhY2tOYW1lT3V0cHV0ID0gZXhwb3J0UHJlZml4OyAvLyBTZXQgdGhlIG91dHB1dCB2YWx1ZVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpb25PdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBzdGFjay5yZWdpb24sXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tUmVnaW9uYFxuICAgIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBY2NvdW50T3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogc3RhY2suYWNjb3VudCxcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1BY2NvdW50YFxuICAgIH0pO1xuXG4gICAgLy8gUGxhY2Vob2xkZXIgZm9yIEJ1cyBTdGFjayBOYW1lIGV4cG9ydCB1c2VkIGluIEJvdG1vblxuICAgIC8vIFRoaXMgbWlnaHQgbmVlZCB0byBiZSBoYW5kbGVkIGRpZmZlcmVudGx5LCBtYXliZSBwYXNzZWQgaW4gcHJvcHM/XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0J1c1N0YWNrTmFtZU91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IGV4cG9ydFByZWZpeCwgLy8gVXNpbmcgdGhlIGRlcml2ZWQgZXhwb3J0IHByZWZpeFxuICAgICAgICBkZXNjcmlwdGlvbjogJ05hbWUgb2YgdGhlIEJ1cyBzdGFjayBmb3IgcmVmZXJlbmNlIGJ5IG90aGVyIHN0YWNrcycsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tQnVzU3RhY2tOYW1lYFxuICAgIH0pO1xuICB9XG59ICJdfQ==