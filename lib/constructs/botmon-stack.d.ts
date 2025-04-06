import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface BotmonStackProps {
    cognitoIdExpression: cdk.ICfnRuleConditionExpression;
    logins: string;
    customJs: string;
    authStackName: string;
    busStackName: string;
    createCognitoCondition: cdk.CfnCondition;
}
/**
 * Creates the Botmon nested stack for RStreams
 */
export declare class BotmonStack extends Construct {
    readonly nestedStack: cdk.CfnStack;
    constructor(scope: Construct, id: string, props: BotmonStackProps);
}
