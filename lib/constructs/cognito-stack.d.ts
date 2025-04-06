import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Creates the Cognito nested stack for RStreams
 */
export declare class CognitoStack extends Construct {
    readonly nestedStack: cdk.CfnStack;
    constructor(scope: Construct, id: string);
    /**
     * Get the Cognito Identity Pool ID output
     */
    getIdentityPoolId(): string;
}
