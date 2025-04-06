import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface RStreamsPlatformStackProps extends cdk.StackProps {
    /**
     * The environment for the deployment (dev, staging, prod, etc.)
     * Should be passed via context `-c environment=dev` or defined in cdk.json
     * @default 'dev'
     */
    environmentName?: string;
}
export interface BusProps {
    environmentName: string;
    trustedArns?: string[];
    queueReplicationDestinations?: string[];
    queueReplicationMapping?: string;
    lambdaInvokePolicy?: string;
    kinesisShards?: number;
    lambdaMemory?: {
        kinesisStreamProcessor?: number;
        firehoseStreamProcessor?: number;
        cronProcessor?: number;
        eventTrigger?: number;
        monitor?: number;
    };
    streamTTLSeconds?: number;
    monitorShardHashKey?: number;
    exportNamePrefix?: string;
}
export declare class RStreamsPlatformStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: RStreamsPlatformStackProps);
}
