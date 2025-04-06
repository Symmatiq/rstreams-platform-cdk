import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getTemplateUrl } from '../helpers/mappings';

/**
 * Creates the Cognito nested stack for RStreams
 */
export class CognitoStack extends Construct {
  public readonly nestedStack: cdk.CfnStack;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create the nested stack using the CloudFormation template URL
    this.nestedStack = new cdk.CfnStack(this, 'CognitoNestedStack', {
      templateUrl: cdk.Fn.findInMap(
        'RStreamsPlatformMappingsRegionMapA6B22AAF',
        cdk.Aws.REGION,
        'CognitoTemplateUrl'
      ),
      timeoutInMinutes: 60
    });
  }
  
  /**
   * Get the Cognito Identity Pool ID output
   */
  public getIdentityPoolId(): string {
    return cdk.Fn.getAtt(this.nestedStack.logicalId, 'Outputs.IdentityPoolId').toString();
  }
}
