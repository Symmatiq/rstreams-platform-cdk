import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as s3 from 'aws-cdk-lib/aws-s3';
export interface BusProps {
    /**
     * The deployment environment name (e.g., dev, staging, prod)
     */
    environmentName: string;
    /**
     * ARNs of trusted IAM principles that can assume roles for cross-account access if needed.
     * (Corresponds to TrustedAWSPrinciples parameter)
     */
    trustedArns?: string[];
    /**
     * List of LeoBotRole ARNs this stack will assume for replication.
     * (Corresponds to QueueReplicationDestinationLeoBotRoleARNs parameter)
     */
    queueReplicationDestinations?: string[];
    /**
     * JSON string representing queue replication mapping configuration.
     * (Corresponds to QueueReplicationMapping parameter)
     */
    queueReplicationMapping?: string;
    /**
     * AWS policy ARN to add to LeoCronRole for cross-account lambda invocation.
     * (Corresponds to LambdaInvokePolicy parameter)
     */
    lambdaInvokePolicy?: string;
    /**
     * Number of shards for Kinesis stream.
     * (Corresponds to KinesisShards parameter)
     */
    kinesisShards?: number;
    /**
     * Memory configurations for Lambda functions.
     */
    lambdaMemory?: {
        kinesisStreamProcessor?: number;
        firehoseStreamProcessor?: number;
        cronProcessor?: number;
        eventTrigger?: number;
        monitor?: number;
    };
    /**
     * TTL seconds for stream records.
     * (Corresponds to StreamTTLSeconds parameter)
     */
    streamTTLSeconds?: number;
    /**
     * Hash key to use for the monitor data.
     * (Corresponds to MonitorShardHashKey parameter)
     */
    monitorShardHashKey?: number;
    /**
     * Optional stack name identifier, used for creating predictable export names.
     */
    exportNamePrefix?: string;
    /**
     * Flag to skip creation of specific resources for LocalStack compatibility.
     */
    skipForLocalStack?: {
        firehose?: boolean;
    };
    stack?: cdk.Stack;
    isTrustingAccount?: boolean;
}
export declare class Bus extends Construct {
    readonly leoStreamTable: dynamodb.ITable;
    readonly leoArchiveTable: dynamodb.ITable;
    readonly leoEventTable: dynamodb.ITable;
    readonly leoSettingsTable: dynamodb.ITable;
    readonly leoCronTable: dynamodb.ITable;
    readonly leoSystemTable: dynamodb.ITable;
    readonly leoKinesisStream: kinesis.IStream;
    readonly leoS3Bucket: s3.IBucket;
    readonly busStackNameOutput: string;
    readonly leoBotRole: iam.IRole;
    readonly leoInstallRole: iam.IRole;
    readonly leoKinesisRole: iam.IRole;
    readonly leoFirehoseRole: iam.IRole;
    readonly leoCronRole: iam.IRole;
    readonly leoBotPolicy: iam.IManagedPolicy;
    readonly installTriggerServiceToken: string;
    readonly leoFirehoseStreamName: string;
    constructor(scope: Construct, id: string, props: BusProps);
}
