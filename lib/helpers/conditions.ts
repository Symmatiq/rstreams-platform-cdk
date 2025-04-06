import * as cdk from 'aws-cdk-lib';
import { Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Create condition for whether to create Cognito resources
 * In the original template this was: {"Fn::Equals": ["", ""]}
 * which always evaluates to true, meaning Cognito is always created
 * 
 * @param scope The construct scope
 * @returns A CfnCondition that always evaluates to true
 */
export function createCognitoCondition(scope: Construct): cdk.CfnCondition {
  return new cdk.CfnCondition(scope, 'CreateCognitoCondition', {
    expression: Fn.conditionEquals('', '')
  });
}
