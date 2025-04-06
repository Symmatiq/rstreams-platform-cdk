import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getTemplateUrl } from '../helpers/mappings';

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
export class BotmonStack extends Construct {
  public readonly nestedStack: cdk.CfnStack;

  constructor(scope: Construct, id: string, props: BotmonStackProps) {
    super(scope, id);

    // Create the nested stack using the CloudFormation template URL
    this.nestedStack = new cdk.CfnStack(this, 'BotmonNestedStack', {
      templateUrl: cdk.Fn.findInMap(
        'RStreamsPlatformMappingsRegionMapA6B22AAF',
        cdk.Aws.REGION,
        'BotmonTemplateUrl'
      ),
      parameters: {
        // Handle the ICfnRuleConditionExpression by forcing a string type
        CognitoId: '' + (props.cognitoIdExpression as any), // Force string conversion
        Logins: props.logins,
        CustomJS: props.customJs,
        leoauth: props.authStackName,
        leosdk: props.busStackName
      },
      timeoutInMinutes: 60
    });
  }
}
