import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Creates the Auth nested stack for RStreams
 */
export declare class AuthStack extends Construct {
    readonly nestedStack: cdk.CfnStack;
    constructor(scope: Construct, id: string);
    /**
     * Get the Auth stack name for reference in other stacks
     */
    getAuthStackName(): string;
}
