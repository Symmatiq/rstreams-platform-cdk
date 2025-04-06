import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
// Removed old construct imports
// import { AuthStack } from './constructs/auth-stack';
// import { BusStack } from './constructs/bus-stack';
// import { CognitoStack } from './constructs/cognito-stack';
// import { BotmonStack } from './constructs/botmon-stack';
// import { ApiRole } from './constructs/api-role';
// import { RegionMap } from './helpers/mappings';
// import { createCognitoCondition } from './helpers/conditions';

// Import new constructs
import { Auth } from './auth/auth-stack';
import { Bus } from './bus/bus-stack';
import { Botmon } from './botmon/botmon-stack';

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

export class RStreamsPlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: RStreamsPlatformStackProps) {
    super(scope, id, props);

    // Set up the environment context from CDK context or props
    const environmentName = this.node.tryGetContext('environment') || props?.environmentName || 'dev';

    // Remove Region Mapping
    // const cfnMapping = new cdk.CfnMapping(this, 'RStreamsPlatformMappingsRegionMapA6B22AAF', { ... });

    // Instantiate new Auth construct
    const auth = new Auth(this, 'Auth', {
      environmentName: environmentName,
    });

    // Get trusted AWS principals for cross-account access
    const trustedArns = this.node.tryGetContext('trustedAWSPrinciples') ? 
      this.node.tryGetContext('trustedAWSPrinciples').split(',') : 
      undefined;

    // Get queue replication destinations for cross-account replication
    const queueReplicationDestinations = this.node.tryGetContext('queueReplicationDestinationLeoBotRoleARNs') ?
      this.node.tryGetContext('queueReplicationDestinationLeoBotRoleARNs').split(',') :
      undefined;

    // Get queue replication mapping configuration
    const queueReplicationMapping = this.node.tryGetContext('queueReplicationMapping') || '[]';

    // Instantiate new Bus construct with all parameters from original CloudFormation
    const bus = new Bus(this, 'Bus', {
      environmentName: environmentName,
      trustedArns: trustedArns,
      queueReplicationDestinations: queueReplicationDestinations,
      queueReplicationMapping: queueReplicationMapping,
      lambdaMemory: {
        kinesisStreamProcessor: this.node.tryGetContext('kinesisStreamProcessorMemory') || 640,
        firehoseStreamProcessor: this.node.tryGetContext('firehoseStreamProcessorMemory') || 640,
        cronProcessor: this.node.tryGetContext('cronProcessorMemory') || 256,
        eventTrigger: this.node.tryGetContext('eventTriggerMemory') || 128,
        monitor: this.node.tryGetContext('leoMonitorMemory') || 256
      },
      exportNamePrefix: this.stackName,
      lambdaInvokePolicy: this.node.tryGetContext('lambdaInvokePolicy'),
      kinesisShards: this.node.tryGetContext('kinesisShards') || 1,
      streamTTLSeconds: this.node.tryGetContext('streamTTLSeconds') || 604800,
      monitorShardHashKey: this.node.tryGetContext('monitorShardHashKey') || 0
    });

    // Remove old Cognito condition and stack
    // const conditionResource = new cdk.CfnCondition(this, 'RStreamsPlatformConditionscreateCognito322D6C6E', { ... });
    // const cognitoStack = new CognitoStack(this, 'RStreamsPlatformCognito780729EC');

    // Get custom JS and logins for Botmon UI customization
    const customJs = this.node.tryGetContext('customJs');
    const logins = this.node.tryGetContext('logins');

    // Get existing Cognito ID if provided
    const inputCognitoId = this.node.tryGetContext('inputCognitoId');
    const createCognito = !inputCognitoId;

    // Instantiate new Botmon construct with Cognito configuration
    const botmon = new Botmon(this, 'Botmon', {
      environmentName: environmentName,
      bus: bus,
      auth: auth,
      customJs: customJs,
      logins: logins,
      createCognito: createCognito,
      existingCognitoId: inputCognitoId
    });

    // Remove dependencies on old nested stacks
    // botmonStack.nestedStack.addDependency(authStack.nestedStack);
    // botmonStack.nestedStack.addDependency(busStack.nestedStack);
    // botmonStack.nestedStack.addDependency(cognitoStack.nestedStack);

    // Create the SSM parameter using output from Bus construct
    const rsfParameter = new ssm.StringParameter(this, 'RStreamsPlatformRSFParameter', {
      parameterName: this.stackName,
      stringValue: bus.busStackNameOutput,
      description: 'RStreams Bus Stack Reference Name'
    });

    // Remove old Leo Template output
    // new cdk.CfnOutput(this, 'RStreamsPlatformOutputsLeoTemplateD3E132CC', { ... });

    // CloudFront URL for Botmon UI access
    new cdk.CfnOutput(this, 'BotmonURL', {
      description: 'Botmon UI URL',
      value: `https://${botmon.cloudfrontDistribution.distributionDomainName}`
    });

    // Create ApiRole for Lambda function invocation
    const apiRole = new iam.Role(this, 'ApiRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.AccountPrincipal(this.account)
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:AddPermission'],
      resources: ['*']
    }));

    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [cdk.Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-*')]
    }));
  }
}
