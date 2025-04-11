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
        // Extract key references
        const stack = props.stack ?? cdk.Stack.of(this);
        const isTrustingAccount = props.isTrustingAccount ?? (props.trustedArns && props.trustedArns.length > 0);
        // Create a consistent unique suffix for resource names
        const uniqueSuffix = String(Math.floor(Date.now() / 1000) % 1000000);
        // Define resource names upfront to ensure consistency
        const kinesisStreamName = (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'kinesis', props.environmentName);
        const firehoseStreamName = (0, name_truncation_1.createTruncatedName)(stack.stackName, id, 'firehose', props.environmentName);
        // LocalStack detection - check account ID and region
        const isLocalStack = stack.account === '000000000000' ||
            stack.region === 'local' ||
            process.env.LOCALSTACK_HOSTNAME !== undefined ||
            process.env.CDK_LOCAL === 'true';
        console.log(`Detected environment: account=${stack.account}, region=${stack.region}, isLocalStack=${isLocalStack}`);
        // Determine if we should skip certain resources
        const skipFirehose = isLocalStack && (props.skipForLocalStack?.firehose !== false);
        // Important workaround: Use a hardcoded ARN to a known working Kinesis stream 
        // to avoid the permissions propagation issue with newly created streams
        const existingKinesisStreamArn = `arn:aws:kinesis:us-east-1:154812849895:stream/symmatiqbackend-bus-kinesis-prod-923383`;
        // Determine export prefix for naming outputs
        const exportPrefix = props.exportNamePrefix || stack.stackName;
        // Define resources based on bus/cloudformation.json translation
        // 1. S3 Bucket (LeoS3)
        const leoS3 = new s3.Bucket(this, 'leos3', {
            removalPolicy: cdk.RemovalPolicy.RETAIN,
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
                partitionKey: partitionKey,
                sortKey: sortKey,
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                removalPolicy: cdk.RemovalPolicy.DESTROY, // Make configurable if needed
                stream: stream,
                pointInTimeRecoverySpecification: {
                    pointInTimeRecoveryEnabled: true
                },
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
        const leoKinesis = new kinesis.Stream(this, 'leokinesisstream', {
            shardCount: props.kinesisShards ?? 1,
            streamMode: props.kinesisShards ? kinesis.StreamMode.PROVISIONED : kinesis.StreamMode.ON_DEMAND,
        });
        this.leoKinesisStream = leoKinesis;
        new cdk.CfnOutput(this, 'LeoKinesisStreamOutput', {
            value: leoKinesis.streamName,
            exportName: `${exportPrefix}-LeoKinesisStream`
        });
        // 4. IAM Roles & Policies
        // LeoBotPolicy (Managed Policy based on CFN)
        const botPolicy = new iam.ManagedPolicy(this, 'LeoBotPolicy', {
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
                        existingKinesisStreamArn, // Add the existing stream ARN here as well
                        `arn:aws:firehose:${stack.region}:${stack.account}:deliverystream/${firehoseStreamName}`, // Firehose ARN
                        this.leoS3Bucket.bucketArn, // Granting PutObject on bucket ARN itself is usually not needed
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
                        this.leoEventTable.tableStreamArn, // Added event stream
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
                assumedBy: principal,
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                    botPolicy, // Attach common LeoBotPolicy
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
                    'lambda:AddPermission', 'lambda:RemovePermission', // Added remove permission
                    's3:PutBucketNotification', 's3:GetBucketNotification',
                    'iam:ListAttachedRolePolicies', 'iam:AttachRolePolicy', 'iam:PassRole', // Added PassRole
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
                actions: ['kinesis:GetRecords',
                    'kinesis:GetShardIterator',
                    'kinesis:DescribeStream',
                    'kinesis:ListStreams',
                    'kinesis:GetShardIterator',
                    'kinesis:GetRecords',
                    'kinesis:ListShards'],
                resources: [this.leoKinesisStream.streamArn]
            })
        ]);
        // LeoFirehoseRole (for Lambda, distinct from Firehose *Delivery* Role)
        this.leoFirehoseRole = createBusRole('LeoFirehoseRole', new iam.ServicePrincipal('lambda.amazonaws.com'), [
            new iam.PolicyStatement({
                sid: 'FirehoseLambdaSpecific',
                actions: ['firehose:PutRecord',
                    'firehose:PutRecordBatch',
                    'kinesis:DescribeStream',
                    'kinesis:GetShardIterator',
                    'kinesis:GetRecords',
                    'kinesis:ListShards'], // Ensure Firehose write is covered
                resources: [`arn:aws:firehose:${stack.region}:${stack.account}:deliverystream/${firehoseStreamName}`],
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
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });
        // Add CloudWatch Logs permissions
        firehoseDeliveryRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [`arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/kinesisfirehose/${firehoseStreamName}:*`]
        }));
        // Add Kinesis permissions - using a simpler, more direct approach
        firehoseDeliveryRole.addToPolicy(new iam.PolicyStatement({
            sid: 'KinesisStreamReadAccess',
            effect: iam.Effect.ALLOW,
            actions: [
                'kinesis:DescribeStream',
                'kinesis:GetShardIterator',
                'kinesis:GetRecords',
                'kinesis:ListShards',
                'kinesis:DescribeStreamSummary',
                'kinesis:ListStreams'
            ],
            // Include both the dynamic stream and the hardcoded stream explicitly
            resources: [
                existingKinesisStreamArn,
                this.leoKinesisStream.streamArn
            ]
        }));
        // Add S3 permissions
        firehoseDeliveryRole.addToPolicy(new iam.PolicyStatement({
            sid: 'S3DeliveryAccess',
            effect: iam.Effect.ALLOW,
            actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject'
            ],
            resources: [
                this.leoS3Bucket.bucketArn,
                `${this.leoS3Bucket.bucketArn}/*`
            ]
        }));
        // Grant all needed permissions
        this.leoS3Bucket.grantReadWrite(firehoseDeliveryRole);
        this.leoKinesisStream.grantRead(firehoseDeliveryRole);
        // Setup Firehose stream differently based on environment
        let leoFirehose;
        if (skipFirehose) {
            console.log("Skipping Firehose creation for LocalStack compatibility");
            // Create a dummy reference instead of a real resource
            this.leoFirehoseStreamName = firehoseStreamName;
            // Define a dummy output for compatibility
            new cdk.CfnOutput(this, 'LeoFirehoseStreamOutput', {
                value: firehoseStreamName,
                exportName: `${exportPrefix}-LeoFirehoseStream`
            });
            new cdk.CfnOutput(this, 'LeoFirehoseStreamNameOutput', {
                value: firehoseStreamName,
                exportName: `${exportPrefix}-LeoFirehoseStreamName`
            });
        }
        else {
            // Setup the real Firehose stream based on environment
            if (isLocalStack) {
                // Simplified config for LocalStack with minimal required properties
                leoFirehose = new firehose.CfnDeliveryStream(this, 'leofirehosestream', {
                    deliveryStreamName: firehoseStreamName,
                    deliveryStreamType: 'KinesisStreamAsSource',
                    kinesisStreamSourceConfiguration: {
                        kinesisStreamArn: this.leoKinesisStream.streamArn, // Use actual stream ARN
                        roleArn: firehoseDeliveryRole.roleArn
                    },
                    s3DestinationConfiguration: {
                        bucketArn: this.leoS3Bucket.bucketArn,
                        roleArn: firehoseDeliveryRole.roleArn,
                        prefix: 'firehose/'
                    }
                });
            }
            else {
                // Full configuration for AWS
                leoFirehose = new firehose.CfnDeliveryStream(this, 'leofirehosestream', {
                    deliveryStreamType: 'KinesisStreamAsSource',
                    kinesisStreamSourceConfiguration: {
                        kinesisStreamArn: existingKinesisStreamArn,
                        roleArn: firehoseDeliveryRole.roleArn
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
                            logGroupName: `/aws/kinesisfirehose/${firehoseStreamName}`,
                            logStreamName: 'S3Delivery'
                        }
                    }
                });
            }
            this.leoFirehoseStreamName = leoFirehose.ref; // Assign Firehose name to property
            // Add explicit dependency to ensure the role is fully created before Firehose
            leoFirehose.node.addDependency(firehoseDeliveryRole);
            new cdk.CfnOutput(this, 'LeoFirehoseStreamOutput', {
                value: leoFirehose.ref,
                exportName: `${exportPrefix}-LeoFirehoseStream`
            });
            new cdk.CfnOutput(this, 'LeoFirehoseStreamNameOutput', {
                value: this.leoFirehoseStreamName,
                exportName: `${exportPrefix}-LeoFirehoseStreamName`
            });
        }
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
            FIREHOSE_STREAM: this.leoFirehoseStreamName, // Pass Firehose name
            // BUS_STACK_NAME needs to be determined - using exportPrefix for now
            BUS_STACK_NAME: exportPrefix,
            NODE_OPTIONS: '--enable-source-maps', // Enable source maps
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
                runtime: lambda.Runtime.NODEJS_22_X, // Updated to Node.js 22 runtime
                entry: entryPath,
                handler: 'handler',
                role: role,
                environment: {
                    ...(environment || {}),
                },
                timeout: timeout || cdk.Duration.minutes(5),
                memorySize: configuredMemory,
                architecture: lambda.Architecture.X86_64,
                awsSdkConnectionReuse: false,
                projectRoot: projectRootPath, // Set to main project root
                bundling: {
                    minify: true,
                    sourceMap: true,
                    target: 'node22',
                    // Install all dependencies in the Lambda
                    nodeModules: [
                        'leo-sdk',
                        'leo-cron',
                        'leo-logger',
                        '@aws-sdk/client-sts',
                        '@aws-sdk/client-iam',
                        'moment'
                    ],
                    // Don't exclude anything
                    externalModules: [],
                    // Environment variable definitions available during bundling
                    define: {
                        'process.env.NODE_ENV': '"production"',
                    },
                    // Force esbuild to include any dynamic imports
                    format: nodejs.OutputFormat.CJS
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
        // LeoEventTrigger
        const leoEventTriggerLambda = createBusLambda(this, 'LeoEventTrigger', 'event-trigger', this.leoCronRole, {
            // Add any specific environment variables if needed
            QueueReplicationMapping: props.queueReplicationMapping || '[]',
            QueueReplicationDestinationLeoBotRoleARNs: props.queueReplicationDestinations
                ? props.queueReplicationDestinations.join(',')
                : '' // Changed undefined to empty string to match string type
        }, cdk.Duration.minutes(5), 1024);
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
            KINESIS_TABLE: this.leoKinesisStream.streamName, // Corrected from table name - Kinesis is a stream
            LEO_KINESIS_STREAM_NAME: this.leoKinesisStream.streamName,
            LEO_FIREHOSE_STREAM_NAME: this.leoFirehoseStreamName,
            LEO_ARCHIVE_PROCESSOR_LOGICAL_ID: archiveLambda.node.id,
            LEO_MONITOR_LOGICAL_ID: leoMonitorLambda.node.id,
            LEO_FIREHOSE_ROLE_ARN: this.leoFirehoseRole.roleArn,
        };
        // Dependencies for environment variables - Assign after lambda definitions
        installEnv['LEO_EVENT_TRIGGER_LOGICAL_ID'] = leoEventTriggerLambda.node.id;
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
        const cronSchedulerLambda = createBusLambda(this, 'CronScheduler', 'cron-scheduler', this.leoCronRole, {}, cdk.Duration.minutes(5), 1536);
        this.leoCronTable.grantReadWriteData(cronSchedulerLambda);
        // BusApiProcessor (Lambda for API Gateway)
        const busApiLambda = createBusLambda(this, 'BusApiProcessor', 'bus-api', this.leoBotRole, {}, cdk.Duration.minutes(5), 1536);
        // Add SourceQueueReplicator Lambda instead of the ReplicateLambda
        const sourceQueueReplicatorLambda = createBusLambda(this, 'SourceQueueReplicator', 'source-queue-replicator', this.leoBotRole, {
            QueueReplicationMapping: props.queueReplicationMapping || '[]',
            QueueReplicationDestinationLeoBotRoleARNs: props.queueReplicationDestinations
                ? props.queueReplicationDestinations.join(',')
                : ''
        }, cdk.Duration.minutes(5), 256);
        // Add the STS AssumeRole permission if trusted ARNs are provided
        if (props.trustedArns) {
            sourceQueueReplicatorLambda.addToRolePolicy(new iam.PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: props.trustedArns
            }));
        }
        // Grant permissions to write to the Kinesis stream
        this.leoKinesisStream.grantWrite(sourceQueueReplicatorLambda);
        // CreateReplicationBots (Lambda for Custom Resource)
        const createReplicationBotsLambda = createBusLambda(this, 'CreateReplicationBots', 'create-replication-bots', this.leoInstallRole, {}, cdk.Duration.minutes(5), 1536);
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
        // Custom resource for registering replication bots
        const RegisterReplicationBots = new cdk.CustomResource(this, 'RegisterReplicationBots', {
            serviceToken: createReplicationBotsLambda.functionArn,
            properties: {
                lambdaArn: sourceQueueReplicatorLambda.functionArn,
                Events: JSON.stringify([
                    {
                        "event": "system.stats",
                        "botId": "Stats_Processor",
                        "source": "Leo_Stats"
                    }
                ]),
                GenericBots: JSON.stringify([]),
                LeoSdkConfig: JSON.stringify({
                    resources: {
                        LeoStream: this.leoStreamTable.tableName,
                        LeoCron: this.leoCronTable.tableName,
                        LeoEvent: this.leoEventTable.tableName,
                        LeoSettings: this.leoSettingsTable.tableName,
                        LeoSystem: this.leoSystemTable.tableName,
                        LeoS3: this.leoS3Bucket.bucketName,
                        LeoKinesisStream: this.leoKinesisStream.streamName,
                        LeoFirehoseStream: this.leoFirehoseStreamName,
                        LeoStats: this.leoStreamTable.tableName // Use leoStreamTable temporarily as placeholder
                    },
                    region: cdk.Stack.of(this).region,
                })
            }
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
        new cdk.CfnOutput(this, 'BusStackNameOutput', {
            value: exportPrefix,
            description: 'Name of the Bus stack for reference by other stacks',
            exportName: `${exportPrefix}-BusStackName`
        });
    }
}
exports.Bus = Bus;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVzLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVzLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFDdkMscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsd0RBQXdEO0FBR3hELG1EQUFtRDtBQUNuRCw0REFBNEQsQ0FBQyxxREFBcUQ7QUFDbEgseUNBQXlDO0FBQ3pDLDZDQUE2QztBQUM3Qyw2QkFBNkI7QUFDN0Isd0RBQXdEO0FBQ3hELG1EQUFtRDtBQUluRCxnRUFBaUU7QUE2RWpFLE1BQWEsR0FBSSxTQUFRLHNCQUFTO0lBbUJoQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWU7UUFDdkQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQix5QkFBeUI7UUFDekIsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNoRCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxpQkFBaUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLElBQUksS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFekcsdURBQXVEO1FBQ3ZELE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQztRQUVyRSxzREFBc0Q7UUFDdEQsTUFBTSxpQkFBaUIsR0FBRyxJQUFBLHFDQUFtQixFQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDckcsTUFBTSxrQkFBa0IsR0FBRyxJQUFBLHFDQUFtQixFQUFDLEtBQUss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QUMxQyxLQUFLLEVBQUUsWUFBWTtZQUNuQixXQUFXLEVBQUUscURBQXFEO1lBQ2xFLFVBQVUsRUFBRSxHQUFHLFlBQVksZUFBZTtTQUM3QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE1ekJELGtCQTR6QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGtpbmVzaXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXMnO1xuaW1wb3J0ICogYXMgZmlyZWhvc2UgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXNmaXJlaG9zZSc7IC8vIFVzZSBMMSBjb25zdHJ1Y3QgaWYgTDIgaXMgdW5hdmFpbGFibGUvaW5zdWZmaWNpZW50XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgczNuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xuaW1wb3J0IHsgY3JlYXRlVHJ1bmNhdGVkTmFtZSB9IGZyb20gJy4uL2hlbHBlcnMvbmFtZS10cnVuY2F0aW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBCdXNQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZGVwbG95bWVudCBlbnZpcm9ubWVudCBuYW1lIChlLmcuLCBkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogQVJOcyBvZiB0cnVzdGVkIElBTSBwcmluY2lwbGVzIHRoYXQgY2FuIGFzc3VtZSByb2xlcyBmb3IgY3Jvc3MtYWNjb3VudCBhY2Nlc3MgaWYgbmVlZGVkLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gVHJ1c3RlZEFXU1ByaW5jaXBsZXMgcGFyYW1ldGVyKVxuICAgKi9cbiAgdHJ1c3RlZEFybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogTGlzdCBvZiBMZW9Cb3RSb2xlIEFSTnMgdGhpcyBzdGFjayB3aWxsIGFzc3VtZSBmb3IgcmVwbGljYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEpTT04gc3RyaW5nIHJlcHJlc2VudGluZyBxdWV1ZSByZXBsaWNhdGlvbiBtYXBwaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIChDb3JyZXNwb25kcyB0byBRdWV1ZVJlcGxpY2F0aW9uTWFwcGluZyBwYXJhbWV0ZXIpXG4gICAqL1xuICBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZz86IHN0cmluZztcblxuICAvKipcbiAgICogQVdTIHBvbGljeSBBUk4gdG8gYWRkIHRvIExlb0Nyb25Sb2xlIGZvciBjcm9zcy1hY2NvdW50IGxhbWJkYSBpbnZvY2F0aW9uLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTGFtYmRhSW52b2tlUG9saWN5IHBhcmFtZXRlcilcbiAgICovXG4gIGxhbWJkYUludm9rZVBvbGljeT86IHN0cmluZztcblxuICAvKipcbiAgICogTnVtYmVyIG9mIHNoYXJkcyBmb3IgS2luZXNpcyBzdHJlYW0uXG4gICAqIChDb3JyZXNwb25kcyB0byBLaW5lc2lzU2hhcmRzIHBhcmFtZXRlcilcbiAgICovXG4gIGtpbmVzaXNTaGFyZHM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIE1lbW9yeSBjb25maWd1cmF0aW9ucyBmb3IgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICovXG4gIGxhbWJkYU1lbW9yeT86IHtcbiAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGZpcmVob3NlU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGNyb25Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgZXZlbnRUcmlnZ2VyPzogbnVtYmVyO1xuICAgIG1vbml0b3I/OiBudW1iZXI7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRUTCBzZWNvbmRzIGZvciBzdHJlYW0gcmVjb3Jkcy5cbiAgICogKENvcnJlc3BvbmRzIHRvIFN0cmVhbVRUTFNlY29uZHMgcGFyYW1ldGVyKVxuICAgKi9cbiAgc3RyZWFtVFRMU2Vjb25kcz86IG51bWJlcjtcblxuICAvKipcbiAgICogSGFzaCBrZXkgdG8gdXNlIGZvciB0aGUgbW9uaXRvciBkYXRhLlxuICAgKiAoQ29ycmVzcG9uZHMgdG8gTW9uaXRvclNoYXJkSGFzaEtleSBwYXJhbWV0ZXIpXG4gICAqL1xuICBtb25pdG9yU2hhcmRIYXNoS2V5PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBzdGFjayBuYW1lIGlkZW50aWZpZXIsIHVzZWQgZm9yIGNyZWF0aW5nIHByZWRpY3RhYmxlIGV4cG9ydCBuYW1lcy5cbiAgICovXG4gIGV4cG9ydE5hbWVQcmVmaXg/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEZsYWcgdG8gc2tpcCBjcmVhdGlvbiBvZiBzcGVjaWZpYyByZXNvdXJjZXMgZm9yIExvY2FsU3RhY2sgY29tcGF0aWJpbGl0eS5cbiAgICovXG4gIHNraXBGb3JMb2NhbFN0YWNrPzoge1xuICAgIGZpcmVob3NlPzogYm9vbGVhbjtcbiAgfTtcblxuICBzdGFjaz86IGNkay5TdGFjaztcbiAgaXNUcnVzdGluZ0FjY291bnQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgY2xhc3MgQnVzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGxlb1N0cmVhbVRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9BcmNoaXZlVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0V2ZW50VGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb1NldHRpbmdzVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0Nyb25UYWJsZTogZHluYW1vZGIuSVRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvU3lzdGVtVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0tpbmVzaXNTdHJlYW06IGtpbmVzaXMuSVN0cmVhbTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb1MzQnVja2V0OiBzMy5JQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgYnVzU3RhY2tOYW1lT3V0cHV0OiBzdHJpbmc7IC8vIFRvIHJlcGxhY2UgdGhlIFNTTSBwYXJhbSB2YWx1ZVxuICBwdWJsaWMgcmVhZG9ubHkgbGVvQm90Um9sZTogaWFtLklSb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVvSW5zdGFsbFJvbGU6IGlhbS5JUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0tpbmVzaXNSb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9GaXJlaG9zZVJvbGU6IGlhbS5JUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGxlb0Nyb25Sb2xlOiBpYW0uSVJvbGU7XG4gIHB1YmxpYyByZWFkb25seSBsZW9Cb3RQb2xpY3k6IGlhbS5JTWFuYWdlZFBvbGljeTtcbiAgcHVibGljIHJlYWRvbmx5IGluc3RhbGxUcmlnZ2VyU2VydmljZVRva2VuOiBzdHJpbmc7IC8vIFNlcnZpY2UgdG9rZW4gZm9yIFJlZ2lzdGVyUmVwbGljYXRpb25Cb3RzXG4gIHB1YmxpYyByZWFkb25seSBsZW9GaXJlaG9zZVN0cmVhbU5hbWU6IHN0cmluZzsgLy8gQWRkIG91dHB1dCBmb3IgRmlyZWhvc2Ugc3RyZWFtIG5hbWVcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQnVzUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgLy8gRXh0cmFjdCBrZXkgcmVmZXJlbmNlc1xuICAgIGNvbnN0IHN0YWNrID0gcHJvcHMuc3RhY2sgPz8gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgIGNvbnN0IGlzVHJ1c3RpbmdBY2NvdW50ID0gcHJvcHMuaXNUcnVzdGluZ0FjY291bnQgPz8gKHByb3BzLnRydXN0ZWRBcm5zICYmIHByb3BzLnRydXN0ZWRBcm5zLmxlbmd0aCA+IDApO1xuICAgIFxuICAgIC8vIENyZWF0ZSBhIGNvbnNpc3RlbnQgdW5pcXVlIHN1ZmZpeCBmb3IgcmVzb3VyY2UgbmFtZXNcbiAgICBjb25zdCB1bmlxdWVTdWZmaXggPSBTdHJpbmcoTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgJSAxMDAwMDAwKTtcbiAgICBcbiAgICAvLyBEZWZpbmUgcmVzb3VyY2UgbmFtZXMgdXBmcm9udCB0byBlbnN1cmUgY29uc2lzdGVuY3lcbiAgICBjb25zdCBraW5lc2lzU3RyZWFtTmFtZSA9IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ2tpbmVzaXMnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpO1xuICAgIGNvbnN0IGZpcmVob3NlU3RyZWFtTmFtZSA9IGNyZWF0ZVRydW5jYXRlZE5hbWUoc3RhY2suc3RhY2tOYW1lLCBpZCwgJ2ZpcmVob3NlJywgcHJvcHMuZW52aXJvbm1lbnROYW1lKTtcbiAgICBcbiAgICAvLyBMb2NhbFN0YWNrIGRldGVjdGlvbiAtIGNoZWNrIGFjY291bnQgSUQgYW5kIHJlZ2lvblxuICAgIGNvbnN0IGlzTG9jYWxTdGFjayA9IHN0YWNrLmFjY291bnQgPT09ICcwMDAwMDAwMDAwMDAnIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgIHN0YWNrLnJlZ2lvbiA9PT0gJ2xvY2FsJyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkxPQ0FMU1RBQ0tfSE9TVE5BTUUgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkNES19MT0NBTCA9PT0gJ3RydWUnO1xuICAgIFxuICAgIGNvbnNvbGUubG9nKGBEZXRlY3RlZCBlbnZpcm9ubWVudDogYWNjb3VudD0ke3N0YWNrLmFjY291bnR9LCByZWdpb249JHtzdGFjay5yZWdpb259LCBpc0xvY2FsU3RhY2s9JHtpc0xvY2FsU3RhY2t9YCk7XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHdlIHNob3VsZCBza2lwIGNlcnRhaW4gcmVzb3VyY2VzXG4gICAgY29uc3Qgc2tpcEZpcmVob3NlID0gaXNMb2NhbFN0YWNrICYmIChwcm9wcy5za2lwRm9yTG9jYWxTdGFjaz8uZmlyZWhvc2UgIT09IGZhbHNlKTtcbiAgICBcbiAgICAvLyBJbXBvcnRhbnQgd29ya2Fyb3VuZDogVXNlIGEgaGFyZGNvZGVkIEFSTiB0byBhIGtub3duIHdvcmtpbmcgS2luZXNpcyBzdHJlYW0gXG4gICAgLy8gdG8gYXZvaWQgdGhlIHBlcm1pc3Npb25zIHByb3BhZ2F0aW9uIGlzc3VlIHdpdGggbmV3bHkgY3JlYXRlZCBzdHJlYW1zXG4gICAgY29uc3QgZXhpc3RpbmdLaW5lc2lzU3RyZWFtQXJuID0gYGFybjphd3M6a2luZXNpczp1cy1lYXN0LTE6MTU0ODEyODQ5ODk1OnN0cmVhbS9zeW1tYXRpcWJhY2tlbmQtYnVzLWtpbmVzaXMtcHJvZC05MjMzODNgO1xuICAgIFxuICAgIC8vIERldGVybWluZSBleHBvcnQgcHJlZml4IGZvciBuYW1pbmcgb3V0cHV0c1xuICAgIGNvbnN0IGV4cG9ydFByZWZpeCA9IHByb3BzLmV4cG9ydE5hbWVQcmVmaXggfHwgc3RhY2suc3RhY2tOYW1lO1xuXG4gICAgLy8gRGVmaW5lIHJlc291cmNlcyBiYXNlZCBvbiBidXMvY2xvdWRmb3JtYXRpb24uanNvbiB0cmFuc2xhdGlvblxuXG4gICAgLy8gMS4gUzMgQnVja2V0IChMZW9TMylcbiAgICBjb25zdCBsZW9TMyA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ2xlb3MzJywge1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICB9KTtcbiAgICB0aGlzLmxlb1MzQnVja2V0ID0gbGVvUzM7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb1MzT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogbGVvUzMuYnVja2V0TmFtZSxcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9TM2BcbiAgICB9KTtcblxuICAgIC8vIDIuIER5bmFtb0RCIFRhYmxlcyAoTGVvU3RyZWFtLCBMZW9BcmNoaXZlLCBMZW9FdmVudCwgTGVvU2V0dGluZ3MsIExlb0Nyb24sIExlb1N5c3RlbSlcbiAgICBjb25zdCBjcmVhdGVMZW9UYWJsZSA9ICh0YWJsZU5hbWU6IHN0cmluZywgcGFydGl0aW9uS2V5OiBkeW5hbW9kYi5BdHRyaWJ1dGUsIHNvcnRLZXk/OiBkeW5hbW9kYi5BdHRyaWJ1dGUsIHN0cmVhbT86IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlKTogZHluYW1vZGIuVGFibGUgPT4ge1xuICAgICAgY29uc3QgdGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgdGFibGVOYW1lLCB7XG4gICAgICAgIHBhcnRpdGlvbktleTogcGFydGl0aW9uS2V5LFxuICAgICAgICBzb3J0S2V5OiBzb3J0S2V5LFxuICAgICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBNYWtlIGNvbmZpZ3VyYWJsZSBpZiBuZWVkZWRcbiAgICAgICAgc3RyZWFtOiBzdHJlYW0sXG4gICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7XG4gICAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IHRydWUgXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIGAke3RhYmxlTmFtZX1PdXRwdXRgLCB7XG4gICAgICAgICAgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LSR7dGFibGVOYW1lfWBcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRhYmxlO1xuICAgIH07XG5cbiAgICB0aGlzLmxlb1N0cmVhbVRhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb1N0cmVhbScsIHsgbmFtZTogJ2V2ZW50JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgeyBuYW1lOiAnZWlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0lNQUdFKTtcbiAgICAvLyBBZGQgVFRMIHRvIExlb1N0cmVhbSB0YWJsZSBpZiBzdHJlYW1UVExTZWNvbmRzIGlzIHByb3ZpZGVkXG4gICAgaWYgKHByb3BzLnN0cmVhbVRUTFNlY29uZHMpIHtcbiAgICAgIGNvbnN0IGNmbkxlb1N0cmVhbVRhYmxlID0gdGhpcy5sZW9TdHJlYW1UYWJsZS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBkeW5hbW9kYi5DZm5UYWJsZTtcbiAgICAgIGNmbkxlb1N0cmVhbVRhYmxlLnRpbWVUb0xpdmVTcGVjaWZpY2F0aW9uID0ge1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiAndHRsJyxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgfTtcbiAgICB9XG4gICAgdGhpcy5sZW9BcmNoaXZlVGFibGUgPSBjcmVhdGVMZW9UYWJsZSgnTGVvQXJjaGl2ZScsIHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSk7XG4gICAgdGhpcy5sZW9FdmVudFRhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb0V2ZW50JywgeyBuYW1lOiAnZXZlbnQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyk7XG4gICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlID0gY3JlYXRlTGVvVGFibGUoJ0xlb1NldHRpbmdzJywgeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9KTtcbiAgICB0aGlzLmxlb0Nyb25UYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9Dcm9uJywgeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCB1bmRlZmluZWQsIGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyk7XG4gICAgdGhpcy5sZW9TeXN0ZW1UYWJsZSA9IGNyZWF0ZUxlb1RhYmxlKCdMZW9TeXN0ZW0nLCB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0pO1xuXG4gICAgLy8gMy4gS2luZXNpcyBTdHJlYW0gKExlb0tpbmVzaXNTdHJlYW0pXG4gICAgY29uc3QgbGVvS2luZXNpcyA9IG5ldyBraW5lc2lzLlN0cmVhbSh0aGlzLCAnbGVva2luZXNpc3N0cmVhbScsIHtcbiAgICAgIHNoYXJkQ291bnQ6IHByb3BzLmtpbmVzaXNTaGFyZHMgPz8gMSxcbiAgICAgIHN0cmVhbU1vZGU6IHByb3BzLmtpbmVzaXNTaGFyZHMgPyBraW5lc2lzLlN0cmVhbU1vZGUuUFJPVklTSU9ORUQgOiBraW5lc2lzLlN0cmVhbU1vZGUuT05fREVNQU5ELFxuICAgIH0pO1xuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbSA9IGxlb0tpbmVzaXM7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0tpbmVzaXNTdHJlYW1PdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBsZW9LaW5lc2lzLnN0cmVhbU5hbWUsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tTGVvS2luZXNpc1N0cmVhbWBcbiAgICB9KTtcblxuICAgIC8vIDQuIElBTSBSb2xlcyAmIFBvbGljaWVzXG5cbiAgICAvLyBMZW9Cb3RQb2xpY3kgKE1hbmFnZWQgUG9saWN5IGJhc2VkIG9uIENGTilcbiAgICBjb25zdCBib3RQb2xpY3kgPSBuZXcgaWFtLk1hbmFnZWRQb2xpY3kodGhpcywgJ0xlb0JvdFBvbGljeScsIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdDb21tb24gcG9saWN5IGZvciBMZW8gQnVzIExhbWJkYXMnLFxuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IHdyaXRpbmcgdG8gTGVvQ3JvblxuICAgICAgICAgICAgICAgIHNpZDogJ0xlb0Nyb25BY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZHluYW1vZGI6UHV0SXRlbScsICdkeW5hbW9kYjpCYXRjaFdyaXRlSXRlbScsICdkeW5hbW9kYjpVcGRhdGVJdGVtJywgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLCAnZHluYW1vZGI6U2NhbiddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMubGVvQ3JvblRhYmxlLnRhYmxlQXJuXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IG1hbmFnaW5nIEV2ZW50QnJpZGdlIHJ1bGVzIGZvciBjcm9uXG4gICAgICAgICAgICAgICAgc2lkOiAnRXZlbnRCcmlkZ2VDcm9uTWFuYWdlbWVudCcsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydldmVudHM6UHV0UnVsZScsICdldmVudHM6UHV0VGFyZ2V0cycsICdldmVudHM6RGVsZXRlUnVsZScsICdldmVudHM6UmVtb3ZlVGFyZ2V0cycsICdldmVudHM6RGVzY3JpYmVSdWxlJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXZlbnRzOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OnJ1bGUvJHtzdGFjay5zdGFja05hbWV9LSR7aWQudG9Mb3dlckNhc2UoKX0tKmBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgLy8gQWxsb3cgYWRkaW5nIExhbWJkYSBwZXJtaXNzaW9ucyBmb3IgRXZlbnRCcmlkZ2UgdHJpZ2dlcnNcbiAgICAgICAgICAgICAgICBzaWQ6ICdMYW1iZGFFdmVudEJyaWRnZVBlcm1pc3Npb25zJyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJywgJ2xhbWJkYTpSZW1vdmVQZXJtaXNzaW9uJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bGFtYmRhOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmZ1bmN0aW9uOiR7c3RhY2suc3RhY2tOYW1lfS0ke2lkLnRvTG93ZXJDYXNlKCl9LSpgXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IC8vIEFsbG93IHJlYWRpbmcgU3lzdGVtL1NldHRpbmdzIHRhYmxlc1xuICAgICAgICAgICAgICAgIHNpZDogJ1JlYWRTeXN0ZW1TZXR0aW5ncycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOlF1ZXJ5JywgJ2R5bmFtb2RiOlNjYW4nXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlQXJuLCB0aGlzLmxlb1NldHRpbmdzVGFibGUudGFibGVBcm5dXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIC8vIEFkZCBLaW5lc2lzL1MzL0ZpcmVob3NlIHdyaXRlIHBlcm1pc3Npb25zP1xuICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgXG4gICAgICAgICAgICAgICAgc2lkOiAnQnVzV3JpdGVBY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsna2luZXNpczpQdXRSZWNvcmQnLCAna2luZXNpczpQdXRSZWNvcmRzJywgJ2ZpcmVob3NlOlB1dFJlY29yZCcsICdmaXJlaG9zZTpQdXRSZWNvcmRCYXRjaCcsICdzMzpQdXRPYmplY3QnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdLaW5lc2lzU3RyZWFtQXJuLCAvLyBBZGQgdGhlIGV4aXN0aW5nIHN0cmVhbSBBUk4gaGVyZSBhcyB3ZWxsXG4gICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmZpcmVob3NlOiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OmRlbGl2ZXJ5c3RyZWFtLyR7ZmlyZWhvc2VTdHJlYW1OYW1lfWAsIC8vIEZpcmVob3NlIEFSTlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybiwgLy8gR3JhbnRpbmcgUHV0T2JqZWN0IG9uIGJ1Y2tldCBBUk4gaXRzZWxmIGlzIHVzdWFsbHkgbm90IG5lZWRlZFxuICAgICAgICAgICAgICAgICAgICBgJHt0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybn0vKmAgLy8gR3JhbnQgUHV0T2JqZWN0IG9uIG9iamVjdHMgd2l0aGluIHRoZSBidWNrZXRcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAvLyBBZGQgcmVhZCBhY2Nlc3MgdG8gY29tbW9uIHRhYmxlcyBuZWVkZWQgYnkgbWFueSBib3RzXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgc2lkOiAnQnVzUmVhZEFjY2VzcycsXG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsICdkeW5hbW9kYjpRdWVyeScsICdkeW5hbW9kYjpTY2FuJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU3RyZWFtVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvQXJjaGl2ZVRhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU2V0dGluZ3NUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9Dcm9uVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubGVvU3lzdGVtVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAvLyBBZGQgc3RyZWFtIHJlYWQgYWNjZXNzP1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIHNpZDogJ0J1c1N0cmVhbVJlYWRBY2Nlc3MnLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldFJlY29yZHMnLCAnZHluYW1vZGI6R2V0U2hhcmRJdGVyYXRvcicsICdkeW5hbW9kYjpEZXNjcmliZVN0cmVhbScsICdkeW5hbW9kYjpMaXN0U3RyZWFtcycsXG4gICAgICAgICAgICAgICAgICAgICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtJywgJ2tpbmVzaXM6R2V0UmVjb3JkcycsICdraW5lc2lzOkdldFNoYXJkSXRlcmF0b3InLCAna2luZXNpczpMaXN0U3RyZWFtcydcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlU3RyZWFtQXJuISxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9Dcm9uVGFibGUudGFibGVTdHJlYW1Bcm4hLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxlb0V2ZW50VGFibGUudGFibGVTdHJlYW1Bcm4hLCAvLyBBZGRlZCBldmVudCBzdHJlYW1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgXVxuICAgIH0pO1xuICAgIHRoaXMubGVvQm90UG9saWN5ID0gYm90UG9saWN5O1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMZW9Cb3RQb2xpY3lPdXRwdXQnLCB7XG4gICAgICAgIHZhbHVlOiBib3RQb2xpY3kubWFuYWdlZFBvbGljeUFybixcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9Cb3RQb2xpY3lgXG4gICAgfSk7XG5cbiAgICAvLyBSb2xlIENyZWF0aW9uIEhlbHBlclxuICAgIGNvbnN0IGNyZWF0ZUJ1c1JvbGUgPSAocm9sZUlkOiBzdHJpbmcsIHByaW5jaXBhbDogaWFtLklQcmluY2lwYWwsIGFkZGl0aW9uYWxQb2xpY2llcz86IGlhbS5Qb2xpY3lTdGF0ZW1lbnRbXSwgbWFuYWdlZFBvbGljaWVzVG9BZGQ/OiBpYW0uSU1hbmFnZWRQb2xpY3lbXSk6IGlhbS5Sb2xlID0+IHtcbiAgICAgICAgY29uc3Qgcm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCByb2xlSWQsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogcHJpbmNpcGFsLFxuICAgICAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICAgICAgYm90UG9saWN5LCAvLyBBdHRhY2ggY29tbW9uIExlb0JvdFBvbGljeVxuICAgICAgICAgICAgICAgIC4uLihtYW5hZ2VkUG9saWNpZXNUb0FkZCA/PyBbXSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoYWRkaXRpb25hbFBvbGljaWVzICYmIGFkZGl0aW9uYWxQb2xpY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBvbGljeSBvZiBhZGRpdGlvbmFsUG9saWNpZXMpIHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KHBvbGljeSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfTtcblxuICAgIC8vIExlb0JvdFJvbGVcbiAgICBjb25zdCBib3RSb2xlUHJpbmNpcGFsID0gbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpO1xuICAgIGlmIChpc1RydXN0aW5nQWNjb3VudCkge1xuICAgICAgICBjb25zdCB0cnVzdGVkUHJpbmNpcGFscyA9IHByb3BzLnRydXN0ZWRBcm5zIS5tYXAoYXJuID0+IG5ldyBpYW0uQXJuUHJpbmNpcGFsKGFybikpO1xuICAgICAgICAvLyBIb3cgdG8gY29tYmluZSBTZXJ2aWNlUHJpbmNpcGFsIGFuZCBBcm5QcmluY2lwYWxzP1xuICAgICAgICAvLyBVc2luZyBDb21wb3NpdGVQcmluY2lwYWxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvQm90Um9sZScsIG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKGJvdFJvbGVQcmluY2lwYWwsIC4uLnRydXN0ZWRQcmluY2lwYWxzKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvQm90Um9sZScsIGJvdFJvbGVQcmluY2lwYWwpO1xuICAgIH1cblxuICAgIC8vIExlb0luc3RhbGxSb2xlXG4gICAgdGhpcy5sZW9JbnN0YWxsUm9sZSA9IGNyZWF0ZUJ1c1JvbGUoJ0xlb0luc3RhbGxSb2xlJywgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLCBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIHNpZDogJ0xlb0luc3RhbGxQZXJtaXNzaW9ucycsXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJywgJ2xhbWJkYTpSZW1vdmVQZXJtaXNzaW9uJywgLy8gQWRkZWQgcmVtb3ZlIHBlcm1pc3Npb25cbiAgICAgICAgICAgICAgICAnczM6UHV0QnVja2V0Tm90aWZpY2F0aW9uJywgJ3MzOkdldEJ1Y2tldE5vdGlmaWNhdGlvbicsXG4gICAgICAgICAgICAgICAgJ2lhbTpMaXN0QXR0YWNoZWRSb2xlUG9saWNpZXMnLCAnaWFtOkF0dGFjaFJvbGVQb2xpY3knLCAnaWFtOlBhc3NSb2xlJywgLy8gQWRkZWQgUGFzc1JvbGVcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScgLy8gS2VlcCB0aGlzPyBTZWVtcyBjb3ZlcmVkIGJ5IEJvdFBvbGljeVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFNjb3BlIGRvd24gdGhlc2UgcmVzb3VyY2VzIHNpZ25pZmljYW50bHlcbiAgICAgICAgICAgIC8vIEV4YW1wbGUgc2NvcGluZzpcbiAgICAgICAgICAgIC8vIGxhbWJkYSBwZXJtaXNzaW9uczogbGFtYmRhIEFSTnMgaW4gdGhpcyBzdGFja1xuICAgICAgICAgICAgLy8gczMgbm90aWZpY2F0aW9uOiBMZW9TMyBidWNrZXQgQVJOXG4gICAgICAgICAgICAvLyBpYW06IExlb0ZpcmVob3NlUm9sZSBBUk5cbiAgICAgICAgICAgIC8vIGR5bmFtb2RiOiBMZW9Dcm9uIHRhYmxlIEFSTlxuICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gTGVvS2luZXNpc1JvbGVcbiAgICB0aGlzLmxlb0tpbmVzaXNSb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvS2luZXNpc1JvbGUnLCBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksIFtcbiAgICAgICAgLy8gSW5saW5lIHBvbGljeSBmcm9tIENGTiBzZWVtcyBjb3ZlcmVkIGJ5IEJvdFBvbGljeSdzIEJ1c1JlYWRBY2Nlc3MvQnVzU3RyZWFtUmVhZEFjY2Vzcy9CdXNXcml0ZUFjY2VzcywgdmVyaWZ5XG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIHNpZDogJ0tpbmVzaXNQcm9jZXNzb3JQZXJtaXNzaW9ucycsXG4gICAgICAgICAgICBhY3Rpb25zOiBbJ2tpbmVzaXM6R2V0UmVjb3JkcycsIFxuICAgICAgICAgICAgICAgICdraW5lc2lzOkdldFNoYXJkSXRlcmF0b3InLCBcbiAgICAgICAgICAgICAgICAna2luZXNpczpEZXNjcmliZVN0cmVhbScsIFxuICAgICAgICAgICAgICAgICdraW5lc2lzOkxpc3RTdHJlYW1zJyxcbiAgICAgICAgICAgICAgICAna2luZXNpczpHZXRTaGFyZEl0ZXJhdG9yJyxcbiAgICAgICAgICAgICAgICAna2luZXNpczpHZXRSZWNvcmRzJyxcbiAgICAgICAgICAgICAgICAna2luZXNpczpMaXN0U2hhcmRzJ10sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuXVxuICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gTGVvRmlyZWhvc2VSb2xlIChmb3IgTGFtYmRhLCBkaXN0aW5jdCBmcm9tIEZpcmVob3NlICpEZWxpdmVyeSogUm9sZSlcbiAgICB0aGlzLmxlb0ZpcmVob3NlUm9sZSA9IGNyZWF0ZUJ1c1JvbGUoJ0xlb0ZpcmVob3NlUm9sZScsIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSwgW1xuICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgIHNpZDogJ0ZpcmVob3NlTGFtYmRhU3BlY2lmaWMnLFxuICAgICAgICAgICAgYWN0aW9uczogWydmaXJlaG9zZTpQdXRSZWNvcmQnLCBcbiAgICAgICAgICAgICAgICAnZmlyZWhvc2U6UHV0UmVjb3JkQmF0Y2gnLCAgICBcbiAgICAgICAgICAgICAgICAna2luZXNpczpEZXNjcmliZVN0cmVhbScsXG4gICAgICAgICAgICAgICAgJ2tpbmVzaXM6R2V0U2hhcmRJdGVyYXRvcicsXG4gICAgICAgICAgICAgICAgJ2tpbmVzaXM6R2V0UmVjb3JkcycsXG4gICAgICAgICAgICAgICAgJ2tpbmVzaXM6TGlzdFNoYXJkcyddLCAvLyBFbnN1cmUgRmlyZWhvc2Ugd3JpdGUgaXMgY292ZXJlZFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZmlyZWhvc2U6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZGVsaXZlcnlzdHJlYW0vJHtmaXJlaG9zZVN0cmVhbU5hbWV9YF0sXG4gICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gTGVvQ3JvblJvbGVcbiAgICB0aGlzLmxlb0Nyb25Sb2xlID0gY3JlYXRlQnVzUm9sZSgnTGVvQ3JvblJvbGUnLCBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksIFtcbiAgICAgICAgLy8gU3BlY2lmaWMgcG9saWNpZXMgZm9yIGNyb24gc2NoZWR1bGluZy90cmlnZ2VyaW5nP1xuICAgICAgICAvLyBDRk4gcG9saWN5IHNlZW1zIGNvdmVyZWQgYnkgQm90UG9saWN5LCB2ZXJpZnlcbiAgICAgICAgLy8gTmVlZCBsYW1iZGE6SW52b2tlRnVuY3Rpb24gZm9yIHRyaWdnZXJpbmcgb3RoZXIgYm90cz9cbiAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICBzaWQ6ICdJbnZva2VCb3RzJyxcbiAgICAgICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicsICdsYW1iZGE6SW52b2tlQXN5bmMnXSxcbiAgICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHtzdGFjay5zdGFja05hbWV9LSR7aWQudG9Mb3dlckNhc2UoKX0tKmBdXG4gICAgICAgICB9KVxuICAgIF0pO1xuXG4gICAgLy8gQWRkIGxhbWJkYUludm9rZVBvbGljeSB0byBMZW9Dcm9uUm9sZSBpZiBwcm92aWRlZFxuICAgIGlmIChwcm9wcy5sYW1iZGFJbnZva2VQb2xpY3kpIHtcbiAgICAgIGNvbnN0IGludm9rZVBvbGljeSA9IGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKFxuICAgICAgICB0aGlzLCBcbiAgICAgICAgJ0xhbWJkYUludm9rZVBvbGljeScsIFxuICAgICAgICBwcm9wcy5sYW1iZGFJbnZva2VQb2xpY3lcbiAgICAgICk7XG4gICAgICB0aGlzLmxlb0Nyb25Sb2xlLmFkZE1hbmFnZWRQb2xpY3koaW52b2tlUG9saWN5KTtcbiAgICB9XG5cbiAgICAvLyA1LiBGaXJlaG9zZSBEZWxpdmVyeSBTdHJlYW0gKHVzaW5nIGl0cyBvd24gcm9sZSBgZmlyZWhvc2VEZWxpdmVyeVJvbGVgIGRlZmluZWQgYmVsb3cpXG4gICAgY29uc3QgZmlyZWhvc2VEZWxpdmVyeVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0ZpcmVob3NlRGVsaXZlcnlSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZmlyZWhvc2UuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIENsb3VkV2F0Y2ggTG9ncyBwZXJtaXNzaW9uc1xuICAgIGZpcmVob3NlRGVsaXZlcnlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cydcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9raW5lc2lzZmlyZWhvc2UvJHtmaXJlaG9zZVN0cmVhbU5hbWV9OipgXVxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBLaW5lc2lzIHBlcm1pc3Npb25zIC0gdXNpbmcgYSBzaW1wbGVyLCBtb3JlIGRpcmVjdCBhcHByb2FjaFxuICAgIGZpcmVob3NlRGVsaXZlcnlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnS2luZXNpc1N0cmVhbVJlYWRBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtJyxcbiAgICAgICAgICAgICdraW5lc2lzOkdldFNoYXJkSXRlcmF0b3InLFxuICAgICAgICAgICAgJ2tpbmVzaXM6R2V0UmVjb3JkcycsXG4gICAgICAgICAgICAna2luZXNpczpMaXN0U2hhcmRzJyxcbiAgICAgICAgICAgICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtU3VtbWFyeScsXG4gICAgICAgICAgICAna2luZXNpczpMaXN0U3RyZWFtcydcbiAgICAgICAgXSxcbiAgICAgICAgLy8gSW5jbHVkZSBib3RoIHRoZSBkeW5hbWljIHN0cmVhbSBhbmQgdGhlIGhhcmRjb2RlZCBzdHJlYW0gZXhwbGljaXRseVxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIGV4aXN0aW5nS2luZXNpc1N0cmVhbUFybixcbiAgICAgICAgICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1Bcm5cbiAgICAgICAgXVxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBTMyBwZXJtaXNzaW9uc1xuICAgIGZpcmVob3NlRGVsaXZlcnlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnUzNEZWxpdmVyeUFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ3MzOkFib3J0TXVsdGlwYXJ0VXBsb2FkJyxcbiAgICAgICAgICAgICdzMzpHZXRCdWNrZXRMb2NhdGlvbicsXG4gICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICdzMzpMaXN0QnVja2V0JyxcbiAgICAgICAgICAgICdzMzpMaXN0QnVja2V0TXVsdGlwYXJ0VXBsb2FkcycsXG4gICAgICAgICAgICAnczM6UHV0T2JqZWN0J1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIHRoaXMubGVvUzNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICAgICAgYCR7dGhpcy5sZW9TM0J1Y2tldC5idWNrZXRBcm59LypgXG4gICAgICAgIF1cbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBhbGwgbmVlZGVkIHBlcm1pc3Npb25zXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5ncmFudFJlYWRXcml0ZShmaXJlaG9zZURlbGl2ZXJ5Um9sZSk7XG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZChmaXJlaG9zZURlbGl2ZXJ5Um9sZSk7XG5cbiAgICAvLyBTZXR1cCBGaXJlaG9zZSBzdHJlYW0gZGlmZmVyZW50bHkgYmFzZWQgb24gZW52aXJvbm1lbnRcbiAgICBsZXQgbGVvRmlyZWhvc2U6IGZpcmVob3NlLkNmbkRlbGl2ZXJ5U3RyZWFtO1xuICAgIFxuICAgIGlmIChza2lwRmlyZWhvc2UpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJTa2lwcGluZyBGaXJlaG9zZSBjcmVhdGlvbiBmb3IgTG9jYWxTdGFjayBjb21wYXRpYmlsaXR5XCIpO1xuICAgICAgICAvLyBDcmVhdGUgYSBkdW1teSByZWZlcmVuY2UgaW5zdGVhZCBvZiBhIHJlYWwgcmVzb3VyY2VcbiAgICAgICAgdGhpcy5sZW9GaXJlaG9zZVN0cmVhbU5hbWUgPSBmaXJlaG9zZVN0cmVhbU5hbWU7XG4gICAgICAgIFxuICAgICAgICAvLyBEZWZpbmUgYSBkdW1teSBvdXRwdXQgZm9yIGNvbXBhdGliaWxpdHlcbiAgICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0ZpcmVob3NlU3RyZWFtT3V0cHV0Jywge1xuICAgICAgICAgICAgdmFsdWU6IGZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tTGVvRmlyZWhvc2VTdHJlYW1gXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlb0ZpcmVob3NlU3RyZWFtTmFtZU91dHB1dCcsIHtcbiAgICAgICAgICAgIHZhbHVlOiBmaXJlaG9zZVN0cmVhbU5hbWUsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0ZpcmVob3NlU3RyZWFtTmFtZWBcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2V0dXAgdGhlIHJlYWwgRmlyZWhvc2Ugc3RyZWFtIGJhc2VkIG9uIGVudmlyb25tZW50XG4gICAgICAgIGlmIChpc0xvY2FsU3RhY2spIHtcbiAgICAgICAgICAgIC8vIFNpbXBsaWZpZWQgY29uZmlnIGZvciBMb2NhbFN0YWNrIHdpdGggbWluaW1hbCByZXF1aXJlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBsZW9GaXJlaG9zZSA9IG5ldyBmaXJlaG9zZS5DZm5EZWxpdmVyeVN0cmVhbSh0aGlzLCAnbGVvZmlyZWhvc2VzdHJlYW0nLCB7XG4gICAgICAgICAgICAgICAgZGVsaXZlcnlTdHJlYW1OYW1lOiBmaXJlaG9zZVN0cmVhbU5hbWUsXG4gICAgICAgICAgICAgICAgZGVsaXZlcnlTdHJlYW1UeXBlOiAnS2luZXNpc1N0cmVhbUFzU291cmNlJyxcbiAgICAgICAgICAgICAgICBraW5lc2lzU3RyZWFtU291cmNlQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICBraW5lc2lzU3RyZWFtQXJuOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtQXJuLCAvLyBVc2UgYWN0dWFsIHN0cmVhbSBBUk5cbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFyblxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgczNEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgYnVja2V0QXJuOiB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybixcbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgcHJlZml4OiAnZmlyZWhvc2UvJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRnVsbCBjb25maWd1cmF0aW9uIGZvciBBV1NcbiAgICAgICAgICAgIGxlb0ZpcmVob3NlID0gbmV3IGZpcmVob3NlLkNmbkRlbGl2ZXJ5U3RyZWFtKHRoaXMsICdsZW9maXJlaG9zZXN0cmVhbScsIHtcbiAgICAgICAgICAgICAgICBkZWxpdmVyeVN0cmVhbVR5cGU6ICdLaW5lc2lzU3RyZWFtQXNTb3VyY2UnLFxuICAgICAgICAgICAgICAgIGtpbmVzaXNTdHJlYW1Tb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGtpbmVzaXNTdHJlYW1Bcm46IGV4aXN0aW5nS2luZXNpc1N0cmVhbUFybixcbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFyblxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgczNEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgYnVja2V0QXJuOiB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldEFybixcbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VEZWxpdmVyeVJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgcHJlZml4OiAnZmlyZWhvc2UvJyxcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JPdXRwdXRQcmVmaXg6ICdmaXJlaG9zZS1lcnJvcnMvJyxcbiAgICAgICAgICAgICAgICAgICAgYnVmZmVyaW5nSGludHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludGVydmFsSW5TZWNvbmRzOiAzMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaXplSW5NQnM6IDVcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25Gb3JtYXQ6ICdHWklQJyxcbiAgICAgICAgICAgICAgICAgICAgY2xvdWRXYXRjaExvZ2dpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9raW5lc2lzZmlyZWhvc2UvJHtmaXJlaG9zZVN0cmVhbU5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ1N0cmVhbU5hbWU6ICdTM0RlbGl2ZXJ5J1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSA9IGxlb0ZpcmVob3NlLnJlZjsgLy8gQXNzaWduIEZpcmVob3NlIG5hbWUgdG8gcHJvcGVydHlcblxuICAgICAgICAvLyBBZGQgZXhwbGljaXQgZGVwZW5kZW5jeSB0byBlbnN1cmUgdGhlIHJvbGUgaXMgZnVsbHkgY3JlYXRlZCBiZWZvcmUgRmlyZWhvc2VcbiAgICAgICAgbGVvRmlyZWhvc2Uubm9kZS5hZGREZXBlbmRlbmN5KGZpcmVob3NlRGVsaXZlcnlSb2xlKTtcblxuICAgICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVvRmlyZWhvc2VTdHJlYW1PdXRwdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogbGVvRmlyZWhvc2UucmVmLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1MZW9GaXJlaG9zZVN0cmVhbWBcbiAgICAgICAgfSk7XG4gICAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMZW9GaXJlaG9zZVN0cmVhbU5hbWVPdXRwdXQnLCB7IC8vIE9wdGlvbmFsbHkgZXhwb3J0IG5hbWUgdG9vXG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5sZW9GaXJlaG9zZVN0cmVhbU5hbWUsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LUxlb0ZpcmVob3NlU3RyZWFtTmFtZWBcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gNi4gTGFtYmRhIEZ1bmN0aW9ucyAoVXBkYXRlIHJvbGVzKVxuICAgIGNvbnN0IGJ1c0xhbWJkYUVudmlyb25tZW50ID0ge1xuICAgICAgICBMRU9fRU5WSVJPTk1FTlQ6IHByb3BzLmVudmlyb25tZW50TmFtZSxcbiAgICAgICAgTEVPX1NUUkVBTV9UQUJMRTogdGhpcy5sZW9TdHJlYW1UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19BUkNISVZFX1RBQkxFOiB0aGlzLmxlb0FyY2hpdmVUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIExFT19FVkVOVF9UQUJMRTogdGhpcy5sZW9FdmVudFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX1NFVFRJTkdTX1RBQkxFOiB0aGlzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fQ1JPTl9UQUJMRTogdGhpcy5sZW9Dcm9uVGFibGUudGFibGVOYW1lLFxuICAgICAgICBMRU9fU1lTVEVNX1RBQkxFOiB0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgTEVPX0tJTkVTSVNfU1RSRUFNOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgTEVPX1MzX0JVQ0tFVDogdGhpcy5sZW9TM0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBGSVJFSE9TRV9TVFJFQU06IHRoaXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lLCAvLyBQYXNzIEZpcmVob3NlIG5hbWVcbiAgICAgICAgLy8gQlVTX1NUQUNLX05BTUUgbmVlZHMgdG8gYmUgZGV0ZXJtaW5lZCAtIHVzaW5nIGV4cG9ydFByZWZpeCBmb3Igbm93XG4gICAgICAgIEJVU19TVEFDS19OQU1FOiBleHBvcnRQcmVmaXgsXG4gICAgICAgIE5PREVfT1BUSU9OUzogJy0tZW5hYmxlLXNvdXJjZS1tYXBzJywgLy8gRW5hYmxlIHNvdXJjZSBtYXBzXG4gICAgICAgIEFXU19OT0RFSlNfQ09OTkVDVElPTl9SRVVTRV9FTkFCTEVEOiAnMScsXG4gICAgfTtcblxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgQnVzIExhbWJkYSBmdW5jdGlvbnMgd2l0aCBjb25zaXN0ZW50IHNldHRpbmdzXG4gICAgZnVuY3Rpb24gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICBzY29wZTogQ29uc3RydWN0LFxuICAgICAgICBpZDogc3RyaW5nLFxuICAgICAgICBjb2RlRGlyOiBzdHJpbmcsIC8vIERpcmVjdG9yeSBuYW1lIHVuZGVyIGxhbWJkYS9idXMvXG4gICAgICAgIHJvbGU6IGlhbS5JUm9sZSxcbiAgICAgICAgZW52aXJvbm1lbnQ/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9LFxuICAgICAgICB0aW1lb3V0PzogY2RrLkR1cmF0aW9uLFxuICAgICAgICBtZW1vcnlTaXplPzogbnVtYmVyXG4gICAgKTogbm9kZWpzLk5vZGVqc0Z1bmN0aW9uIHtcbiAgICAgICAgLy8gVXNlIGEgdHJ1bmNhdGVkIGZ1bmN0aW9uIG5hbWUgZm9ybWF0IHdpdGggc3RhY2sgbmFtZSBpbmNsdWRlZFxuICAgICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBjcmVhdGVUcnVuY2F0ZWROYW1lKHN0YWNrLnN0YWNrTmFtZSwgaWQsICcnLCBwcm9wcy5lbnZpcm9ubWVudE5hbWUpO1xuICAgICAgICAvLyBSZXNvbHZlIGVudHJ5IHBhdGggcmVsYXRpdmUgdG8gdGhlIGluZGl2aWR1YWwgbGFtYmRhJ3MgZGlyZWN0b3J5IHdpdGhpbiB0aGUgcHJvamVjdCByb290XG4gICAgICAgIGNvbnN0IGVudHJ5UGF0aCA9IHBhdGgucmVzb2x2ZShgLi9sYW1iZGEvYnVzLyR7Y29kZURpcn0vaW5kZXguanNgKTsgXG4gICAgICAgIC8vIFNldCBwcm9qZWN0Um9vdCB0byB0aGUgbWFpbiBDREsgcHJvamVjdCBkaXJlY3RvcnksIHdoZXJlIHBhY2thZ2UtbG9jay5qc29uIGlzXG4gICAgICAgIGNvbnN0IHByb2plY3RSb290UGF0aCA9IHBhdGgucmVzb2x2ZShgLi9gKTsgXG5cbiAgICAgICAgLy8gVXNlIG1lbW9yeSBzaXplIGZyb20gcHJvcHMubGFtYmRhTWVtb3J5IGlmIGF2YWlsYWJsZSBhbmQgc3BlY2lmaWMgdG8gdGhpcyBmdW5jdGlvblxuICAgICAgICBjb25zdCBkZWZhdWx0TWVtb3J5ID0gMTAyNDsgLy8gRGVmYXVsdCBtZW1vcnkgaWYgbm90IHNwZWNpZmllZFxuICAgICAgICBsZXQgY29uZmlndXJlZE1lbW9yeSA9IG1lbW9yeVNpemUgfHwgZGVmYXVsdE1lbW9yeTtcbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgbWVtb3J5IGNvbmZpZyBpbiBwcm9wcyBmb3IgdGhpcyBzcGVjaWZpYyBsYW1iZGFcbiAgICAgICAgaWYgKHByb3BzLmxhbWJkYU1lbW9yeSkge1xuICAgICAgICAgICAgaWYgKGlkID09PSAnS2luZXNpc1Byb2Nlc3NvcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmtpbmVzaXNTdHJlYW1Qcm9jZXNzb3IpIHtcbiAgICAgICAgICAgICAgICBjb25maWd1cmVkTWVtb3J5ID0gcHJvcHMubGFtYmRhTWVtb3J5LmtpbmVzaXNTdHJlYW1Qcm9jZXNzb3I7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGlkID09PSAnRmlyZWhvc2VQcm9jZXNzb3InICYmIHByb3BzLmxhbWJkYU1lbW9yeS5maXJlaG9zZVN0cmVhbVByb2Nlc3Nvcikge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWRNZW1vcnkgPSBwcm9wcy5sYW1iZGFNZW1vcnkuZmlyZWhvc2VTdHJlYW1Qcm9jZXNzb3I7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKChpZCA9PT0gJ0Nyb25Qcm9jZXNzb3InIHx8IGlkID09PSAnQ3JvblNjaGVkdWxlcicpICYmIHByb3BzLmxhbWJkYU1lbW9yeS5jcm9uUHJvY2Vzc29yKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5jcm9uUHJvY2Vzc29yO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpZCA9PT0gJ0xlb0V2ZW50VHJpZ2dlcicgJiYgcHJvcHMubGFtYmRhTWVtb3J5LmV2ZW50VHJpZ2dlcikge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWRNZW1vcnkgPSBwcm9wcy5sYW1iZGFNZW1vcnkuZXZlbnRUcmlnZ2VyO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpZCA9PT0gJ0xlb01vbml0b3InICYmIHByb3BzLmxhbWJkYU1lbW9yeS5tb25pdG9yKSB7XG4gICAgICAgICAgICAgICAgY29uZmlndXJlZE1lbW9yeSA9IHByb3BzLmxhbWJkYU1lbW9yeS5tb25pdG9yO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHNjb3BlLCBpZCwge1xuICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsIC8vIFVwZGF0ZWQgdG8gTm9kZS5qcyAyMiBydW50aW1lXG4gICAgICAgICAgICBlbnRyeTogZW50cnlQYXRoLFxuICAgICAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICAgICAgcm9sZTogcm9sZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgLi4uKGVudmlyb25tZW50IHx8IHt9KSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0IHx8IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogY29uZmlndXJlZE1lbW9yeSxcbiAgICAgICAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICAgICAgICBhd3NTZGtDb25uZWN0aW9uUmV1c2U6IGZhbHNlLFxuICAgICAgICAgICAgcHJvamVjdFJvb3Q6IHByb2plY3RSb290UGF0aCwgLy8gU2V0IHRvIG1haW4gcHJvamVjdCByb290XG4gICAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiAnbm9kZTIyJyxcbiAgICAgICAgICAgICAgICAvLyBJbnN0YWxsIGFsbCBkZXBlbmRlbmNpZXMgaW4gdGhlIExhbWJkYVxuICAgICAgICAgICAgICAgIG5vZGVNb2R1bGVzOiBbXG4gICAgICAgICAgICAgICAgICAgICdsZW8tc2RrJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1jcm9uJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xlby1sb2dnZXInLFxuICAgICAgICAgICAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LXN0cycsXG4gICAgICAgICAgICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtaWFtJyxcbiAgICAgICAgICAgICAgICAgICAgJ21vbWVudCdcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIC8vIERvbid0IGV4Y2x1ZGUgYW55dGhpbmdcbiAgICAgICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtdLFxuICAgICAgICAgICAgICAgIC8vIEVudmlyb25tZW50IHZhcmlhYmxlIGRlZmluaXRpb25zIGF2YWlsYWJsZSBkdXJpbmcgYnVuZGxpbmdcbiAgICAgICAgICAgICAgICBkZWZpbmU6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3Byb2Nlc3MuZW52Lk5PREVfRU5WJzogJ1wicHJvZHVjdGlvblwiJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIEZvcmNlIGVzYnVpbGQgdG8gaW5jbHVkZSBhbnkgZHluYW1pYyBpbXBvcnRzXG4gICAgICAgICAgICAgICAgZm9ybWF0OiBub2RlanMuT3V0cHV0Rm9ybWF0LkNKU1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY2RrLlRhZ3Mub2YobGFtYmRhRnVuY3Rpb24pLmFkZCgnU3RhY2snLCBjZGsuU3RhY2sub2Yoc2NvcGUpLnN0YWNrTmFtZSk7XG4gICAgICAgIGNkay5UYWdzLm9mKGxhbWJkYUZ1bmN0aW9uKS5hZGQoJ0NvbnN0cnVjdCcsICdMYW1iZGEnKTtcblxuICAgICAgICByZXR1cm4gbGFtYmRhRnVuY3Rpb247XG4gICAgfVxuXG4gICAgLy8gS2luZXNpc1Byb2Nlc3NvclxuICAgIGNvbnN0IGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdLaW5lc2lzUHJvY2Vzc29yJyxcbiAgICAgICAgJ2tpbmVzaXMtcHJvY2Vzc29yJyxcbiAgICAgICAgdGhpcy5sZW9LaW5lc2lzUm9sZSxcbiAgICAgICAge1xuICAgICAgICAgICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzIHNwZWNpZmljIHRvIEtpbmVzaXNQcm9jZXNzb3JcbiAgICAgICAgICAgIC8vIEFkZCBsZW9TdHJlYW0sIGtpbmVzaXNTdHJlYW0gaWYgbmVlZGVkIGZyb20gcHJvcHMgb3IgY29udGV4dFxuICAgICAgICAgICAgbGVvX2tpbmVzaXNfc3RyZWFtOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgICAgIFJFR0lPTjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICAgIFRaOiBwcm9jZXNzLmVudi5UWiB8fCAnVVRDJywgLy8gVXNlIFVUQyBpZiBUWiBub3Qgc2V0XG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgMTAyNFxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgaWYgbmVlZGVkIChlLmcuLCB0byB3cml0ZSB0byBvdGhlciByZXNvdXJjZXMpXG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG4gICAgLy8gQWRkIG90aGVyIGdyYW50cyBiYXNlZCBvbiBDRk4gcG9saWNpZXNcblxuICAgIC8vIEFkZCBLaW5lc2lzIGV2ZW50IHNvdXJjZSBtYXBwaW5nXG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50UmVhZFdyaXRlKGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvRXZlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoa2luZXNpc1Byb2Nlc3NvckxhbWJkYSk7XG5cbiAgICAvLyBGaXJlaG9zZVByb2Nlc3NvclxuICAgIGNvbnN0IGZpcmVob3NlUHJvY2Vzc29yTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnRmlyZWhvc2VQcm9jZXNzb3InLFxuICAgICAgICAnZmlyZWhvc2UtcHJvY2Vzc29yJyxcbiAgICAgICAgdGhpcy5sZW9GaXJlaG9zZVJvbGUsXG4gICAgICAgIHt9LCAvLyBObyBzcGVjaWZpYyBlbnYgdmFycyBmcm9tIENGTlxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNiAvLyBNZW1vcnkvVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICB0aGlzLmxlb1N0cmVhbVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmaXJlaG9zZVByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TZXR0aW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmaXJlaG9zZVByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TeXN0ZW1UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZmlyZWhvc2VQcm9jZXNzb3JMYW1iZGEpO1xuICAgIC8vIEFkZCBvdGhlciBncmFudHMgYmFzZWQgb24gQ0ZOIHBvbGljaWVzXG5cbiAgICAvLyBTM0xvYWRUcmlnZ2VyXG4gICAgY29uc3QgczNMb2FkVHJpZ2dlckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ1MzTG9hZFRyaWdnZXInLFxuICAgICAgICAnczMtbG9hZC10cmlnZ2VyJyxcbiAgICAgICAgdGhpcy5sZW9GaXJlaG9zZVJvbGUsIC8vIFVzZXMgTGVvRmlyZWhvc2VSb2xlIGluIENGTlxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXG4gICAgdGhpcy5sZW9TM0J1Y2tldC5ncmFudFJlYWQoczNMb2FkVHJpZ2dlckxhbWJkYSk7XG4gICAgdGhpcy5sZW9LaW5lc2lzU3RyZWFtLmdyYW50V3JpdGUoczNMb2FkVHJpZ2dlckxhbWJkYSk7XG4gICAgLy8gQWRkIFMzIGV2ZW50IG5vdGlmaWNhdGlvblxuICAgIHRoaXMubGVvUzNCdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXG4gICAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbihzM0xvYWRUcmlnZ2VyTGFtYmRhKVxuICAgICk7XG5cbiAgICAvLyBMZW9Nb25pdG9yXG4gICAgY29uc3QgbGVvTW9uaXRvckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0xlb01vbml0b3InLFxuICAgICAgICAnbGVvLW1vbml0b3InLFxuICAgICAgICB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICB7XG4gICAgICAgICAgICAvLyBBZGQgTW9uaXRvclNoYXJkSGFzaEtleSBpZiBwcm92aWRlZFxuICAgICAgICAgICAgLi4uKHByb3BzLm1vbml0b3JTaGFyZEhhc2hLZXkgIT09IHVuZGVmaW5lZCA/IHsgU0hBUkRfSEFTSF9LRVk6IHByb3BzLm1vbml0b3JTaGFyZEhhc2hLZXkudG9TdHJpbmcoKSB9IDoge30pXG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeSBmcm9tIENGTiBwYXJhbSwgVGltZW91dCBmcm9tIENGTlxuICAgICk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxlb01vbml0b3JMYW1iZGEpO1xuXG4gICAgLy8gQ3JvblByb2Nlc3NvclxuICAgIGNvbnN0IGNyb25Qcm9jZXNzb3JMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdDcm9uUHJvY2Vzc29yJyxcbiAgICAgICAgJ2Nyb24nLFxuICAgICAgICB0aGlzLmxlb0Nyb25Sb2xlLFxuICAgICAgICB7fSwgLy8gTm8gc3BlY2lmaWMgZW52IHZhcnMgZnJvbSBDRk5cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gTWVtb3J5L1RpbWVvdXQgZnJvbSBDRk5cbiAgICApO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjcm9uUHJvY2Vzc29yTGFtYmRhKTtcbiAgICB0aGlzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNyb25Qcm9jZXNzb3JMYW1iZGEpO1xuICAgIHRoaXMubGVvU2V0dGluZ3NUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY3JvblByb2Nlc3NvckxhbWJkYSk7XG4gICAgdGhpcy5sZW9TeXN0ZW1UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY3JvblByb2Nlc3NvckxhbWJkYSk7XG4gICAgLy8gQWRkIER5bmFtb0RCIEV2ZW50IFNvdXJjZSBNYXBwaW5nIGZvciBDcm9uIHRhYmxlIHN0cmVhbSB0byBDcm9uUHJvY2Vzc29yXG4gICAgY3JvblByb2Nlc3NvckxhbWJkYS5hZGRFdmVudFNvdXJjZU1hcHBpbmcoJ0Nyb25TdHJlYW1Tb3VyY2UnLCB7XG4gICAgICAgIGV2ZW50U291cmNlQXJuOiB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZVN0cmVhbUFybiEsXG4gICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IGxhbWJkYS5TdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTixcbiAgICAgICAgYmF0Y2hTaXplOiA1MDAgLy8gTWF0Y2ggQ0ZOXG4gICAgfSk7XG5cbiAgICAvLyBBcmNoaXZlUHJvY2Vzc29yXG4gICAgY29uc3QgYXJjaGl2ZUxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0FyY2hpdmVQcm9jZXNzb3InLFxuICAgICAgICAnYXJjaGl2ZScsXG4gICAgICAgIHRoaXMubGVvQm90Um9sZSwgLy8gVXNlcyBnZW5lcmljIExlb0JvdFJvbGVcbiAgICAgICAge30sIC8vIE5vIHNwZWNpZmljIGVudiB2YXJzIGZyb20gQ0ZOXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxNTM2IC8vIE1lbW9yeS9UaW1lb3V0IGZyb20gQ0ZOXG4gICAgKTtcbiAgICAvLyBHcmFudCBuZWNlc3NhcnkgcGVybWlzc2lvbnMgKGUuZy4sIFMzIHdyaXRlIHRvIGFyY2hpdmUgYnVja2V0IGlmIHNlcGFyYXRlKVxuICAgIHRoaXMubGVvUzNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXJjaGl2ZUxhbWJkYSk7XG5cbiAgICAvLyBMZW9FdmVudFRyaWdnZXJcbiAgICBjb25zdCBsZW9FdmVudFRyaWdnZXJMYW1iZGEgPSBjcmVhdGVCdXNMYW1iZGEoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdMZW9FdmVudFRyaWdnZXInLFxuICAgICAgICAnZXZlbnQtdHJpZ2dlcicsXG4gICAgICAgIHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIHtcbiAgICAgICAgICAgIC8vIEFkZCBhbnkgc3BlY2lmaWMgZW52aXJvbm1lbnQgdmFyaWFibGVzIGlmIG5lZWRlZFxuICAgICAgICAgICAgUXVldWVSZXBsaWNhdGlvbk1hcHBpbmc6IHByb3BzLnF1ZXVlUmVwbGljYXRpb25NYXBwaW5nIHx8ICdbXScsXG4gICAgICAgICAgICBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOczogcHJvcHMucXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9uc1xuICAgICAgICAgICAgICA/IHByb3BzLnF1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbnMuam9pbignLCcpXG4gICAgICAgICAgICAgIDogJycgLy8gQ2hhbmdlZCB1bmRlZmluZWQgdG8gZW1wdHkgc3RyaW5nIHRvIG1hdGNoIHN0cmluZyB0eXBlXG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAxMDI0XG4gICAgKTtcbiAgICBcbiAgICAvLyBBZGQgRHluYW1vREIgRXZlbnQgU291cmNlIE1hcHBpbmcgZm9yIExlb0V2ZW50IHRhYmxlXG4gICAgbGVvRXZlbnRUcmlnZ2VyTGFtYmRhLmFkZEV2ZW50U291cmNlTWFwcGluZygnRXZlbnRUYWJsZVNvdXJjZScsIHtcbiAgICAgICAgZXZlbnRTb3VyY2VBcm46IHRoaXMubGVvRXZlbnRUYWJsZS50YWJsZVN0cmVhbUFybiEsXG4gICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IGxhbWJkYS5TdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTixcbiAgICAgICAgYmF0Y2hTaXplOiA1MDAgLy8gTWF0Y2ggQ0ZOXG4gICAgfSk7XG5cbiAgICAvLyBEZWZpbmUgdGhlIHR5cGUgZm9yIGluc3RhbGxFbnYgZXhwbGljaXRseVxuICAgIGludGVyZmFjZSBJbnN0YWxsRW52VHlwZSB7XG4gICAgICAgIEFQUF9UQUJMRTogc3RyaW5nO1xuICAgICAgICBTWVNURU1fVEFCTEU6IHN0cmluZztcbiAgICAgICAgQ1JPTl9UQUJMRTogc3RyaW5nO1xuICAgICAgICBFVkVOVF9UQUJMRTogc3RyaW5nO1xuICAgICAgICBTVFJFQU1fVEFCTEU6IHN0cmluZztcbiAgICAgICAgS0lORVNJU19UQUJMRTogc3RyaW5nO1xuICAgICAgICBMRU9fS0lORVNJU19TVFJFQU1fTkFNRTogc3RyaW5nO1xuICAgICAgICBMRU9fRklSRUhPU0VfU1RSRUFNX05BTUU6IHN0cmluZztcbiAgICAgICAgTEVPX0FSQ0hJVkVfUFJPQ0VTU09SX0xPR0lDQUxfSUQ6IHN0cmluZztcbiAgICAgICAgTEVPX01PTklUT1JfTE9HSUNBTF9JRDogc3RyaW5nO1xuICAgICAgICBMRU9fRklSRUhPU0VfUk9MRV9BUk46IHN0cmluZztcbiAgICAgICAgTEVPX0VWRU5UX1RSSUdHRVJfTE9HSUNBTF9JRD86IHN0cmluZztcbiAgICAgICAgTEVPX1MzX0xPQURfVFJJR0dFUl9BUk4/OiBzdHJpbmc7XG4gICAgICAgIExFT19DUk9OX1BST0NFU1NPUl9BUk4/OiBzdHJpbmc7XG4gICAgICAgIExFT19LSU5FU0lTX1BST0NFU1NPUl9BUk4/OiBzdHJpbmc7XG4gICAgfVxuXG4gICAgLy8gSW5zdGFsbEZ1bmN0aW9uXG4gICAgY29uc3QgaW5zdGFsbEVudjogSW5zdGFsbEVudlR5cGUgPSB7XG4gICAgICAgIEFQUF9UQUJMRTogdGhpcy5sZW9TZXR0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1lTVEVNX1RBQkxFOiB0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgQ1JPTl9UQUJMRTogdGhpcy5sZW9Dcm9uVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9UQUJMRTogdGhpcy5sZW9FdmVudFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1RSRUFNX1RBQkxFOiB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgS0lORVNJU19UQUJMRTogdGhpcy5sZW9LaW5lc2lzU3RyZWFtLnN0cmVhbU5hbWUsIC8vIENvcnJlY3RlZCBmcm9tIHRhYmxlIG5hbWUgLSBLaW5lc2lzIGlzIGEgc3RyZWFtXG4gICAgICAgIExFT19LSU5FU0lTX1NUUkVBTV9OQU1FOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgTEVPX0ZJUkVIT1NFX1NUUkVBTV9OQU1FOiB0aGlzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgTEVPX0FSQ0hJVkVfUFJPQ0VTU09SX0xPR0lDQUxfSUQ6IGFyY2hpdmVMYW1iZGEubm9kZS5pZCxcbiAgICAgICAgTEVPX01PTklUT1JfTE9HSUNBTF9JRDogbGVvTW9uaXRvckxhbWJkYS5ub2RlLmlkLFxuICAgICAgICBMRU9fRklSRUhPU0VfUk9MRV9BUk46IHRoaXMubGVvRmlyZWhvc2VSb2xlLnJvbGVBcm4sXG4gICAgfTtcbiAgICAvLyBEZXBlbmRlbmNpZXMgZm9yIGVudmlyb25tZW50IHZhcmlhYmxlcyAtIEFzc2lnbiBhZnRlciBsYW1iZGEgZGVmaW5pdGlvbnNcbiAgICBpbnN0YWxsRW52WydMRU9fRVZFTlRfVFJJR0dFUl9MT0dJQ0FMX0lEJ10gPSBsZW9FdmVudFRyaWdnZXJMYW1iZGEubm9kZS5pZDtcbiAgICBpbnN0YWxsRW52WydMRU9fUzNfTE9BRF9UUklHR0VSX0FSTiddID0gczNMb2FkVHJpZ2dlckxhbWJkYS5mdW5jdGlvbkFybjtcbiAgICBpbnN0YWxsRW52WydMRU9fQ1JPTl9QUk9DRVNTT1JfQVJOJ10gPSBjcm9uUHJvY2Vzc29yTGFtYmRhLmZ1bmN0aW9uQXJuO1xuICAgIGluc3RhbGxFbnZbJ0xFT19LSU5FU0lTX1BST0NFU1NPUl9BUk4nXSA9IGtpbmVzaXNQcm9jZXNzb3JMYW1iZGEuZnVuY3Rpb25Bcm47XG5cbiAgICBjb25zdCBpbnN0YWxsTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnSW5zdGFsbEZ1bmN0aW9uJyxcbiAgICAgICAgJ2luc3RhbGwnLFxuICAgICAgICB0aGlzLmxlb0luc3RhbGxSb2xlLFxuICAgICAgICBpbnN0YWxsRW52IGFzIHVua25vd24gYXMgeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSwgLy8gQ29udmVydCB0byB1bmtub3duIGZpcnN0IGZvciBhc3NlcnRpb25cbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzYgLy8gQWRkIG1lbW9yeSBzaXplXG4gICAgKTtcbiAgICAvLyBBZGQgZ3JhbnRzIGJhc2VkIG9uIENGTiBwb2xpY2llcyAoZS5nLiwgZHluYW1vZGI6Q3JlYXRlVGFibGUsIGlhbTpQYXNzUm9sZSlcbiAgICB0aGlzLmxlb1NldHRpbmdzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvU3lzdGVtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvQ3JvblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnN0YWxsTGFtYmRhKTtcbiAgICB0aGlzLmxlb0V2ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvU3RyZWFtVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGluc3RhbGxMYW1iZGEpO1xuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5ncmFudFJlYWRXcml0ZShpbnN0YWxsTGFtYmRhKTtcbiAgICAvLyBBZGQgcG9saWNpZXMgZm9yIENyZWF0ZVRhYmxlLCBQYXNzUm9sZSBldGMuIGJhc2VkIG9uIExlb0luc3RhbGxSb2xlIGluIENGTlxuXG4gICAgLy8gQ3JvblNjaGVkdWxlciAoTGFtYmRhIGZvciB0cmlnZ2VyaW5nIHNjaGVkdWxlZCBjcm9ucylcbiAgICBjb25zdCBjcm9uU2NoZWR1bGVyTGFtYmRhID0gY3JlYXRlQnVzTGFtYmRhKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnQ3JvblNjaGVkdWxlcicsXG4gICAgICAgICdjcm9uLXNjaGVkdWxlcicsXG4gICAgICAgIHRoaXMubGVvQ3JvblJvbGUsXG4gICAgICAgIHt9LFxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNlxuICAgICk7XG4gICAgdGhpcy5sZW9Dcm9uVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNyb25TY2hlZHVsZXJMYW1iZGEpO1xuXG4gICAgLy8gQnVzQXBpUHJvY2Vzc29yIChMYW1iZGEgZm9yIEFQSSBHYXRld2F5KVxuICAgIGNvbnN0IGJ1c0FwaUxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0J1c0FwaVByb2Nlc3NvcicsXG4gICAgICAgICdidXMtYXBpJyxcbiAgICAgICAgdGhpcy5sZW9Cb3RSb2xlLFxuICAgICAgICB7fSxcbiAgICAgICAgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIDE1MzZcbiAgICApO1xuICAgIFxuICAgIC8vIEFkZCBTb3VyY2VRdWV1ZVJlcGxpY2F0b3IgTGFtYmRhIGluc3RlYWQgb2YgdGhlIFJlcGxpY2F0ZUxhbWJkYVxuICAgIGNvbnN0IHNvdXJjZVF1ZXVlUmVwbGljYXRvckxhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ1NvdXJjZVF1ZXVlUmVwbGljYXRvcicsXG4gICAgICAgICdzb3VyY2UtcXVldWUtcmVwbGljYXRvcicsXG4gICAgICAgIHRoaXMubGVvQm90Um9sZSxcbiAgICAgICAge1xuICAgICAgICAgICAgUXVldWVSZXBsaWNhdGlvbk1hcHBpbmc6IHByb3BzLnF1ZXVlUmVwbGljYXRpb25NYXBwaW5nIHx8ICdbXScsXG4gICAgICAgICAgICBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOczogcHJvcHMucXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9uc1xuICAgICAgICAgICAgICAgID8gcHJvcHMucXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucy5qb2luKCcsJylcbiAgICAgICAgICAgICAgICA6ICcnXG4gICAgICAgIH0sXG4gICAgICAgIGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAyNTZcbiAgICApO1xuICAgIFxuICAgIC8vIEFkZCB0aGUgU1RTIEFzc3VtZVJvbGUgcGVybWlzc2lvbiBpZiB0cnVzdGVkIEFSTnMgYXJlIHByb3ZpZGVkXG4gICAgaWYgKHByb3BzLnRydXN0ZWRBcm5zKSB7XG4gICAgICAgIHNvdXJjZVF1ZXVlUmVwbGljYXRvckxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBwcm9wcy50cnVzdGVkQXJuc1xuICAgICAgICB9KSk7XG4gICAgfVxuICAgIFxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHdyaXRlIHRvIHRoZSBLaW5lc2lzIHN0cmVhbVxuICAgIHRoaXMubGVvS2luZXNpc1N0cmVhbS5ncmFudFdyaXRlKHNvdXJjZVF1ZXVlUmVwbGljYXRvckxhbWJkYSk7XG5cbiAgICAvLyBDcmVhdGVSZXBsaWNhdGlvbkJvdHMgKExhbWJkYSBmb3IgQ3VzdG9tIFJlc291cmNlKVxuICAgIGNvbnN0IGNyZWF0ZVJlcGxpY2F0aW9uQm90c0xhbWJkYSA9IGNyZWF0ZUJ1c0xhbWJkYShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0NyZWF0ZVJlcGxpY2F0aW9uQm90cycsXG4gICAgICAgICdjcmVhdGUtcmVwbGljYXRpb24tYm90cycsXG4gICAgICAgIHRoaXMubGVvSW5zdGFsbFJvbGUsXG4gICAgICAgIHt9LFxuICAgICAgICBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgMTUzNlxuICAgICk7XG5cbiAgICAvLyBDdXN0b20gUmVzb3VyY2UgZm9yIFJlZ2lzdGVyaW5nIFJlcGxpY2F0aW9uIEJvdHNcbiAgICBjb25zdCByZWdpc3RlckJvdHNQcm92aWRlciA9IG5ldyBjci5Qcm92aWRlcih0aGlzLCAnUmVnaXN0ZXJCb3RzUHJvdmlkZXInLCB7XG4gICAgICAgIG9uRXZlbnRIYW5kbGVyOiBjcmVhdGVSZXBsaWNhdGlvbkJvdHNMYW1iZGEsXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9EQVksXG4gICAgfSk7XG5cbiAgICAvLyBFeHBvcnQgdGhlIHJlZ2lzdGVyIHNlcnZpY2UgdG9rZW4gZm9yIG90aGVyIHN0YWNrcyB0byB1c2VcbiAgICB0aGlzLmluc3RhbGxUcmlnZ2VyU2VydmljZVRva2VuID0gcmVnaXN0ZXJCb3RzUHJvdmlkZXIuc2VydmljZVRva2VuO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpc3RlclNlcnZpY2VUb2tlbk91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IHJlZ2lzdGVyQm90c1Byb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgICAgZXhwb3J0TmFtZTogYCR7ZXhwb3J0UHJlZml4fS1SZWdpc3RlcmBcbiAgICB9KTtcblxuICAgIC8vIEN1c3RvbSByZXNvdXJjZSBmb3IgcmVnaXN0ZXJpbmcgcmVwbGljYXRpb24gYm90c1xuICAgIGNvbnN0IFJlZ2lzdGVyUmVwbGljYXRpb25Cb3RzID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnUmVnaXN0ZXJSZXBsaWNhdGlvbkJvdHMnLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGNyZWF0ZVJlcGxpY2F0aW9uQm90c0xhbWJkYS5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgbGFtYmRhQXJuOiBzb3VyY2VRdWV1ZVJlcGxpY2F0b3JMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICAgIEV2ZW50czogSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiZXZlbnRcIjogXCJzeXN0ZW0uc3RhdHNcIixcbiAgICAgICAgICAgIFwiYm90SWRcIjogXCJTdGF0c19Qcm9jZXNzb3JcIixcbiAgICAgICAgICAgIFwic291cmNlXCI6IFwiTGVvX1N0YXRzXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0pLFxuICAgICAgICBHZW5lcmljQm90czogSlNPTi5zdHJpbmdpZnkoW10pLFxuICAgICAgICBMZW9TZGtDb25maWc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICByZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIExlb1N0cmVhbTogdGhpcy5sZW9TdHJlYW1UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICBMZW9Dcm9uOiB0aGlzLmxlb0Nyb25UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICBMZW9FdmVudDogdGhpcy5sZW9FdmVudFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgIExlb1NldHRpbmdzOiB0aGlzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgTGVvU3lzdGVtOiB0aGlzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgIExlb1MzOiB0aGlzLmxlb1MzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBMZW9LaW5lc2lzU3RyZWFtOiB0aGlzLmxlb0tpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgICAgIExlb0ZpcmVob3NlU3RyZWFtOiB0aGlzLmxlb0ZpcmVob3NlU3RyZWFtTmFtZSxcbiAgICAgICAgICAgIExlb1N0YXRzOiB0aGlzLmxlb1N0cmVhbVRhYmxlLnRhYmxlTmFtZSAvLyBVc2UgbGVvU3RyZWFtVGFibGUgdGVtcG9yYXJpbHkgYXMgcGxhY2Vob2xkZXJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJlZ2lvbjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIDguIE91dHB1dHNcbiAgICB0aGlzLmJ1c1N0YWNrTmFtZU91dHB1dCA9IGV4cG9ydFByZWZpeDsgLy8gU2V0IHRoZSBvdXRwdXQgdmFsdWVcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVnaW9uT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogc3RhY2sucmVnaW9uLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtleHBvcnRQcmVmaXh9LVJlZ2lvbmBcbiAgICB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWNjb3VudE91dHB1dCcsIHtcbiAgICAgICAgdmFsdWU6IHN0YWNrLmFjY291bnQsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tQWNjb3VudGBcbiAgICB9KTtcblxuICAgIC8vIFBsYWNlaG9sZGVyIGZvciBCdXMgU3RhY2sgTmFtZSBleHBvcnQgdXNlZCBpbiBCb3Rtb25cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQnVzU3RhY2tOYW1lT3V0cHV0Jywge1xuICAgICAgICB2YWx1ZTogZXhwb3J0UHJlZml4LFxuICAgICAgICBkZXNjcmlwdGlvbjogJ05hbWUgb2YgdGhlIEJ1cyBzdGFjayBmb3IgcmVmZXJlbmNlIGJ5IG90aGVyIHN0YWNrcycsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2V4cG9ydFByZWZpeH0tQnVzU3RhY2tOYW1lYFxuICAgIH0pO1xuICB9XG59ICJdfQ==