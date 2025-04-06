import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getTemplateUrl } from '../helpers/mappings';

/**
 * Creates the Auth nested stack for RStreams
 */
export class AuthStack extends Construct {
  public readonly nestedStack: cdk.CfnStack;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create the nested stack using the CloudFormation template URL
    this.nestedStack = new cdk.CfnStack(this, 'AuthNestedStack', {
      templateUrl: cdk.Fn.findInMap(
        'RStreamsPlatformMappingsRegionMapA6B22AAF',
        cdk.Aws.REGION,
        'AuthTemplateUrl'
      ),
      timeoutInMinutes: 60
    });
  }

  /**
   * Get the Auth stack name for reference in other stacks
   */
  public getAuthStackName(): string {
    return cdk.Fn.select(1, cdk.Fn.split('/', this.nestedStack.ref));
  }
}
