import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getTemplateUrl } from '../helpers/mappings';

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
export class BusStack extends Construct {
  public readonly nestedStack: cdk.CfnStack;

  constructor(scope: Construct, id: string, props: BusStackProps) {
    super(scope, id);

    // Create the nested stack using the CloudFormation template URL
    this.nestedStack = new cdk.CfnStack(this, 'BusNestedStack', {
      templateUrl: cdk.Fn.findInMap(
        'RStreamsPlatformMappingsRegionMapA6B22AAF',
        cdk.Aws.REGION,
        'BusTemplateUrl'
      ),
      parameters: {
        // Environment parameter
        Environment: props.environment,
        
        // Trusted AWS Principals and Queue Replication
        TrustedAWSPrinciples: cdk.Fn.join(',', ['']),
        QueueReplicationDestinationLeoBotRoleARNs: cdk.Fn.join(',', ['']),
        QueueReplicationMapping: '[]',
        LambdaInvokePolicy: '',
        
        // Lambda and Kinesis configuration
        KinesisShards: '1',
        KinesisStreamProcessorMemory: '640',
        FirehoseStreamProcessorMemory: '640',
        CronProcessorMemory: '256',
        EventTriggerMemory: '128',
        LeoMonitorMemory: '256',
        
        // LeoStream configuration
        LeoStreamBillingMode: 'PAY_PER_REQUEST',
        LeoStreamMinReadCapacity: props.leoStreamMinReadCapacity.toString(),
        LeoStreamMaxReadCapacity: props.leoStreamMaxReadCapacity.toString(),
        LeoStreamMinWriteCapacity: props.leoStreamMinWriteCapacity.toString(),
        LeoStreamMaxWriteCapacity: props.leoStreamMaxWriteCapacity.toString(),
        
        // LeoArchive configuration
        LeoArchiveBillingMode: 'PAY_PER_REQUEST',
        LeoArchiveMinReadCapacity: props.leoArchiveMinReadCapacity.toString(),
        LeoArchiveMaxReadCapacity: props.leoArchiveMaxReadCapacity.toString(),
        LeoArchiveMinWriteCapacity: props.leoArchiveMinWriteCapacity.toString(),
        LeoArchiveMaxWriteCapacity: props.leoArchiveMaxWriteCapacity.toString(),
        
        // LeoEvent configuration
        LeoEventBillingMode: 'PAY_PER_REQUEST',
        LeoEventMinReadCapacity: props.leoEventMinReadCapacity.toString(),
        LeoEventMaxReadCapacity: props.leoEventMaxReadCapacity.toString(),
        LeoEventMinWriteCapacity: props.leoEventMinWriteCapacity.toString(),
        LeoEventMaxWriteCapacity: props.leoEventMaxWriteCapacity.toString(),
        
        // LeoSettings configuration
        LeoSettingsBillingMode: 'PAY_PER_REQUEST',
        LeoSettingsMinReadCapacity: props.leoSettingsMinReadCapacity.toString(),
        LeoSettingsMaxReadCapacity: props.leoSettingsMaxReadCapacity.toString(),
        LeoSettingsMinWriteCapacity: props.leoSettingsMinWriteCapacity.toString(),
        LeoSettingsMaxWriteCapacity: props.leoSettingsMaxWriteCapacity.toString(),
        
        // LeoCron configuration
        LeoCronBillingMode: 'PAY_PER_REQUEST',
        LeoCronMinReadCapacity: props.leoCronMinReadCapacity.toString(),
        LeoCronMaxReadCapacity: props.leoCronMaxReadCapacity.toString(),
        LeoCronMinWriteCapacity: props.leoCronMinWriteCapacity.toString(),
        LeoCronMaxWriteCapacity: props.leoCronMaxWriteCapacity.toString(),
        
        // LeoSystem configuration
        LeoSystemBillingMode: 'PAY_PER_REQUEST',
        LeoSystemMinReadCapacity: props.leoSystemMinReadCapacity.toString(),
        LeoSystemMaxReadCapacity: props.leoSystemMaxReadCapacity.toString(),
        LeoSystemMinWriteCapacity: props.leoSystemMinWriteCapacity.toString(),
        LeoSystemMaxWriteCapacity: props.leoSystemMaxWriteCapacity.toString(),
        
        // Stream TTL and monitor config
        StreamTTLSeconds: '604800',
        MonitorShardHashKey: '0'
      },
      timeoutInMinutes: 60
    });
  }

  /**
   * Get the Bus stack name for reference in other stacks
   */
  public getBusStackName(): string {
    return cdk.Fn.select(1, cdk.Fn.split('/', this.nestedStack.ref));
  }
}
