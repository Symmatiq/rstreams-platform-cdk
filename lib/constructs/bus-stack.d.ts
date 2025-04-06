import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface BusStackProps {
    environment: string;
    leoStreamMinReadCapacity: number;
    leoStreamMaxReadCapacity: number;
    leoStreamMinWriteCapacity: number;
    leoStreamMaxWriteCapacity: number;
    leoArchiveMinReadCapacity: number;
    leoArchiveMaxReadCapacity: number;
    leoArchiveMinWriteCapacity: number;
    leoArchiveMaxWriteCapacity: number;
    leoEventMinReadCapacity: number;
    leoEventMaxReadCapacity: number;
    leoEventMinWriteCapacity: number;
    leoEventMaxWriteCapacity: number;
    leoSettingsMinReadCapacity: number;
    leoSettingsMaxReadCapacity: number;
    leoSettingsMinWriteCapacity: number;
    leoSettingsMaxWriteCapacity: number;
    leoCronMinReadCapacity: number;
    leoCronMaxReadCapacity: number;
    leoCronMinWriteCapacity: number;
    leoCronMaxWriteCapacity: number;
    leoSystemMinReadCapacity: number;
    leoSystemMaxReadCapacity: number;
    leoSystemMinWriteCapacity: number;
    leoSystemMaxWriteCapacity: number;
}
/**
 * Creates the Bus nested stack for RStreams
 */
export declare class BusStack extends Construct {
    readonly nestedStack: cdk.CfnStack;
    constructor(scope: Construct, id: string, props: BusStackProps);
    /**
     * Get the Bus stack name for reference in other stacks
     */
    getBusStackName(): string;
}
