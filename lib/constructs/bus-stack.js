"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusStack = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
/**
 * Creates the Bus nested stack for RStreams
 */
class BusStack extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        // Create the nested stack using the CloudFormation template URL
        this.nestedStack = new cdk.CfnStack(this, 'BusNestedStack', {
            templateUrl: cdk.Fn.findInMap('RStreamsPlatformMappingsRegionMapA6B22AAF', cdk.Aws.REGION, 'BusTemplateUrl'),
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
    getBusStackName() {
        return cdk.Fn.select(1, cdk.Fn.split('/', this.nestedStack.ref));
    }
}
exports.BusStack = BusStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVzLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVzLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUErQnZDOztHQUVHO0FBQ0gsTUFBYSxRQUFTLFNBQVEsc0JBQVM7SUFHckMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFvQjtRQUM1RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDMUQsV0FBVyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUMzQiwyQ0FBMkMsRUFDM0MsR0FBRyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQ2QsZ0JBQWdCLENBQ2pCO1lBQ0QsVUFBVSxFQUFFO2dCQUNWLHdCQUF3QjtnQkFDeEIsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO2dCQUU5QiwrQ0FBK0M7Z0JBQy9DLG9CQUFvQixFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUM1Qyx5Q0FBeUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDakUsdUJBQXVCLEVBQUUsSUFBSTtnQkFDN0Isa0JBQWtCLEVBQUUsRUFBRTtnQkFFdEIsbUNBQW1DO2dCQUNuQyxhQUFhLEVBQUUsR0FBRztnQkFDbEIsNEJBQTRCLEVBQUUsS0FBSztnQkFDbkMsNkJBQTZCLEVBQUUsS0FBSztnQkFDcEMsbUJBQW1CLEVBQUUsS0FBSztnQkFDMUIsa0JBQWtCLEVBQUUsS0FBSztnQkFDekIsZ0JBQWdCLEVBQUUsS0FBSztnQkFFdkIsMEJBQTBCO2dCQUMxQixvQkFBb0IsRUFBRSxpQkFBaUI7Z0JBQ3ZDLHdCQUF3QixFQUFFLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLEVBQUU7Z0JBQ25FLHdCQUF3QixFQUFFLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLEVBQUU7Z0JBQ25FLHlCQUF5QixFQUFFLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3JFLHlCQUF5QixFQUFFLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxRQUFRLEVBQUU7Z0JBRXJFLDJCQUEyQjtnQkFDM0IscUJBQXFCLEVBQUUsaUJBQWlCO2dCQUN4Qyx5QkFBeUIsRUFBRSxLQUFLLENBQUMseUJBQXlCLENBQUMsUUFBUSxFQUFFO2dCQUNyRSx5QkFBeUIsRUFBRSxLQUFLLENBQUMseUJBQXlCLENBQUMsUUFBUSxFQUFFO2dCQUNyRSwwQkFBMEIsRUFBRSxLQUFLLENBQUMsMEJBQTBCLENBQUMsUUFBUSxFQUFFO2dCQUN2RSwwQkFBMEIsRUFBRSxLQUFLLENBQUMsMEJBQTBCLENBQUMsUUFBUSxFQUFFO2dCQUV2RSx5QkFBeUI7Z0JBQ3pCLG1CQUFtQixFQUFFLGlCQUFpQjtnQkFDdEMsdUJBQXVCLEVBQUUsS0FBSyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsRUFBRTtnQkFDakUsdUJBQXVCLEVBQUUsS0FBSyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsRUFBRTtnQkFDakUsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsRUFBRTtnQkFDbkUsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsRUFBRTtnQkFFbkUsNEJBQTRCO2dCQUM1QixzQkFBc0IsRUFBRSxpQkFBaUI7Z0JBQ3pDLDBCQUEwQixFQUFFLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3ZFLDBCQUEwQixFQUFFLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3ZFLDJCQUEyQixFQUFFLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3pFLDJCQUEyQixFQUFFLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxRQUFRLEVBQUU7Z0JBRXpFLHdCQUF3QjtnQkFDeEIsa0JBQWtCLEVBQUUsaUJBQWlCO2dCQUNyQyxzQkFBc0IsRUFBRSxLQUFLLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFO2dCQUMvRCxzQkFBc0IsRUFBRSxLQUFLLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFO2dCQUMvRCx1QkFBdUIsRUFBRSxLQUFLLENBQUMsdUJBQXVCLENBQUMsUUFBUSxFQUFFO2dCQUNqRSx1QkFBdUIsRUFBRSxLQUFLLENBQUMsdUJBQXVCLENBQUMsUUFBUSxFQUFFO2dCQUVqRSwwQkFBMEI7Z0JBQzFCLG9CQUFvQixFQUFFLGlCQUFpQjtnQkFDdkMsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsRUFBRTtnQkFDbkUsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsRUFBRTtnQkFDbkUseUJBQXlCLEVBQUUsS0FBSyxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRTtnQkFDckUseUJBQXlCLEVBQUUsS0FBSyxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRTtnQkFFckUsZ0NBQWdDO2dCQUNoQyxnQkFBZ0IsRUFBRSxRQUFRO2dCQUMxQixtQkFBbUIsRUFBRSxHQUFHO2FBQ3pCO1lBQ0QsZ0JBQWdCLEVBQUUsRUFBRTtTQUNyQixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSSxlQUFlO1FBQ3BCLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDbkUsQ0FBQztDQUNGO0FBdkZELDRCQXVGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IGdldFRlbXBsYXRlVXJsIH0gZnJvbSAnLi4vaGVscGVycy9tYXBwaW5ncyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQnVzU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG4gIGxlb1N0cmVhbU1pblJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9TdHJlYW1NYXhSZWFkQ2FwYWNpdHk6IG51bWJlcjtcbiAgbGVvU3RyZWFtTWluV3JpdGVDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9TdHJlYW1NYXhXcml0ZUNhcGFjaXR5OiBudW1iZXI7XG4gIGxlb0FyY2hpdmVNaW5SZWFkQ2FwYWNpdHk6IG51bWJlcjtcbiAgbGVvQXJjaGl2ZU1heFJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9BcmNoaXZlTWluV3JpdGVDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9BcmNoaXZlTWF4V3JpdGVDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9FdmVudE1pblJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9FdmVudE1heFJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9FdmVudE1pbldyaXRlQ2FwYWNpdHk6IG51bWJlcjtcbiAgbGVvRXZlbnRNYXhXcml0ZUNhcGFjaXR5OiBudW1iZXI7XG4gIGxlb1NldHRpbmdzTWluUmVhZENhcGFjaXR5OiBudW1iZXI7XG4gIGxlb1NldHRpbmdzTWF4UmVhZENhcGFjaXR5OiBudW1iZXI7XG4gIGxlb1NldHRpbmdzTWluV3JpdGVDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9TZXR0aW5nc01heFdyaXRlQ2FwYWNpdHk6IG51bWJlcjtcbiAgbGVvQ3Jvbk1pblJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9Dcm9uTWF4UmVhZENhcGFjaXR5OiBudW1iZXI7XG4gIGxlb0Nyb25NaW5Xcml0ZUNhcGFjaXR5OiBudW1iZXI7XG4gIGxlb0Nyb25NYXhXcml0ZUNhcGFjaXR5OiBudW1iZXI7XG4gIGxlb1N5c3RlbU1pblJlYWRDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9TeXN0ZW1NYXhSZWFkQ2FwYWNpdHk6IG51bWJlcjtcbiAgbGVvU3lzdGVtTWluV3JpdGVDYXBhY2l0eTogbnVtYmVyO1xuICBsZW9TeXN0ZW1NYXhXcml0ZUNhcGFjaXR5OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgQnVzIG5lc3RlZCBzdGFjayBmb3IgUlN0cmVhbXNcbiAqL1xuZXhwb3J0IGNsYXNzIEJ1c1N0YWNrIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IG5lc3RlZFN0YWNrOiBjZGsuQ2ZuU3RhY2s7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEJ1c1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBuZXN0ZWQgc3RhY2sgdXNpbmcgdGhlIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIFVSTFxuICAgIHRoaXMubmVzdGVkU3RhY2sgPSBuZXcgY2RrLkNmblN0YWNrKHRoaXMsICdCdXNOZXN0ZWRTdGFjaycsIHtcbiAgICAgIHRlbXBsYXRlVXJsOiBjZGsuRm4uZmluZEluTWFwKFxuICAgICAgICAnUlN0cmVhbXNQbGF0Zm9ybU1hcHBpbmdzUmVnaW9uTWFwQTZCMjJBQUYnLFxuICAgICAgICBjZGsuQXdzLlJFR0lPTixcbiAgICAgICAgJ0J1c1RlbXBsYXRlVXJsJ1xuICAgICAgKSxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgLy8gRW52aXJvbm1lbnQgcGFyYW1ldGVyXG4gICAgICAgIEVudmlyb25tZW50OiBwcm9wcy5lbnZpcm9ubWVudCxcbiAgICAgICAgXG4gICAgICAgIC8vIFRydXN0ZWQgQVdTIFByaW5jaXBhbHMgYW5kIFF1ZXVlIFJlcGxpY2F0aW9uXG4gICAgICAgIFRydXN0ZWRBV1NQcmluY2lwbGVzOiBjZGsuRm4uam9pbignLCcsIFsnJ10pLFxuICAgICAgICBRdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOczogY2RrLkZuLmpvaW4oJywnLCBbJyddKSxcbiAgICAgICAgUXVldWVSZXBsaWNhdGlvbk1hcHBpbmc6ICdbXScsXG4gICAgICAgIExhbWJkYUludm9rZVBvbGljeTogJycsXG4gICAgICAgIFxuICAgICAgICAvLyBMYW1iZGEgYW5kIEtpbmVzaXMgY29uZmlndXJhdGlvblxuICAgICAgICBLaW5lc2lzU2hhcmRzOiAnMScsXG4gICAgICAgIEtpbmVzaXNTdHJlYW1Qcm9jZXNzb3JNZW1vcnk6ICc2NDAnLFxuICAgICAgICBGaXJlaG9zZVN0cmVhbVByb2Nlc3Nvck1lbW9yeTogJzY0MCcsXG4gICAgICAgIENyb25Qcm9jZXNzb3JNZW1vcnk6ICcyNTYnLFxuICAgICAgICBFdmVudFRyaWdnZXJNZW1vcnk6ICcxMjgnLFxuICAgICAgICBMZW9Nb25pdG9yTWVtb3J5OiAnMjU2JyxcbiAgICAgICAgXG4gICAgICAgIC8vIExlb1N0cmVhbSBjb25maWd1cmF0aW9uXG4gICAgICAgIExlb1N0cmVhbUJpbGxpbmdNb2RlOiAnUEFZX1BFUl9SRVFVRVNUJyxcbiAgICAgICAgTGVvU3RyZWFtTWluUmVhZENhcGFjaXR5OiBwcm9wcy5sZW9TdHJlYW1NaW5SZWFkQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvU3RyZWFtTWF4UmVhZENhcGFjaXR5OiBwcm9wcy5sZW9TdHJlYW1NYXhSZWFkQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvU3RyZWFtTWluV3JpdGVDYXBhY2l0eTogcHJvcHMubGVvU3RyZWFtTWluV3JpdGVDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9TdHJlYW1NYXhXcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9TdHJlYW1NYXhXcml0ZUNhcGFjaXR5LnRvU3RyaW5nKCksXG4gICAgICAgIFxuICAgICAgICAvLyBMZW9BcmNoaXZlIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgTGVvQXJjaGl2ZUJpbGxpbmdNb2RlOiAnUEFZX1BFUl9SRVFVRVNUJyxcbiAgICAgICAgTGVvQXJjaGl2ZU1pblJlYWRDYXBhY2l0eTogcHJvcHMubGVvQXJjaGl2ZU1pblJlYWRDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9BcmNoaXZlTWF4UmVhZENhcGFjaXR5OiBwcm9wcy5sZW9BcmNoaXZlTWF4UmVhZENhcGFjaXR5LnRvU3RyaW5nKCksXG4gICAgICAgIExlb0FyY2hpdmVNaW5Xcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9BcmNoaXZlTWluV3JpdGVDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9BcmNoaXZlTWF4V3JpdGVDYXBhY2l0eTogcHJvcHMubGVvQXJjaGl2ZU1heFdyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgXG4gICAgICAgIC8vIExlb0V2ZW50IGNvbmZpZ3VyYXRpb25cbiAgICAgICAgTGVvRXZlbnRCaWxsaW5nTW9kZTogJ1BBWV9QRVJfUkVRVUVTVCcsXG4gICAgICAgIExlb0V2ZW50TWluUmVhZENhcGFjaXR5OiBwcm9wcy5sZW9FdmVudE1pblJlYWRDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9FdmVudE1heFJlYWRDYXBhY2l0eTogcHJvcHMubGVvRXZlbnRNYXhSZWFkQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvRXZlbnRNaW5Xcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9FdmVudE1pbldyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvRXZlbnRNYXhXcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9FdmVudE1heFdyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgXG4gICAgICAgIC8vIExlb1NldHRpbmdzIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgTGVvU2V0dGluZ3NCaWxsaW5nTW9kZTogJ1BBWV9QRVJfUkVRVUVTVCcsXG4gICAgICAgIExlb1NldHRpbmdzTWluUmVhZENhcGFjaXR5OiBwcm9wcy5sZW9TZXR0aW5nc01pblJlYWRDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9TZXR0aW5nc01heFJlYWRDYXBhY2l0eTogcHJvcHMubGVvU2V0dGluZ3NNYXhSZWFkQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvU2V0dGluZ3NNaW5Xcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9TZXR0aW5nc01pbldyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvU2V0dGluZ3NNYXhXcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9TZXR0aW5nc01heFdyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgXG4gICAgICAgIC8vIExlb0Nyb24gY29uZmlndXJhdGlvblxuICAgICAgICBMZW9Dcm9uQmlsbGluZ01vZGU6ICdQQVlfUEVSX1JFUVVFU1QnLFxuICAgICAgICBMZW9Dcm9uTWluUmVhZENhcGFjaXR5OiBwcm9wcy5sZW9Dcm9uTWluUmVhZENhcGFjaXR5LnRvU3RyaW5nKCksXG4gICAgICAgIExlb0Nyb25NYXhSZWFkQ2FwYWNpdHk6IHByb3BzLmxlb0Nyb25NYXhSZWFkQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgTGVvQ3Jvbk1pbldyaXRlQ2FwYWNpdHk6IHByb3BzLmxlb0Nyb25NaW5Xcml0ZUNhcGFjaXR5LnRvU3RyaW5nKCksXG4gICAgICAgIExlb0Nyb25NYXhXcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9Dcm9uTWF4V3JpdGVDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBcbiAgICAgICAgLy8gTGVvU3lzdGVtIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgTGVvU3lzdGVtQmlsbGluZ01vZGU6ICdQQVlfUEVSX1JFUVVFU1QnLFxuICAgICAgICBMZW9TeXN0ZW1NaW5SZWFkQ2FwYWNpdHk6IHByb3BzLmxlb1N5c3RlbU1pblJlYWRDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9TeXN0ZW1NYXhSZWFkQ2FwYWNpdHk6IHByb3BzLmxlb1N5c3RlbU1heFJlYWRDYXBhY2l0eS50b1N0cmluZygpLFxuICAgICAgICBMZW9TeXN0ZW1NaW5Xcml0ZUNhcGFjaXR5OiBwcm9wcy5sZW9TeXN0ZW1NaW5Xcml0ZUNhcGFjaXR5LnRvU3RyaW5nKCksXG4gICAgICAgIExlb1N5c3RlbU1heFdyaXRlQ2FwYWNpdHk6IHByb3BzLmxlb1N5c3RlbU1heFdyaXRlQ2FwYWNpdHkudG9TdHJpbmcoKSxcbiAgICAgICAgXG4gICAgICAgIC8vIFN0cmVhbSBUVEwgYW5kIG1vbml0b3IgY29uZmlnXG4gICAgICAgIFN0cmVhbVRUTFNlY29uZHM6ICc2MDQ4MDAnLFxuICAgICAgICBNb25pdG9yU2hhcmRIYXNoS2V5OiAnMCdcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0SW5NaW51dGVzOiA2MFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgQnVzIHN0YWNrIG5hbWUgZm9yIHJlZmVyZW5jZSBpbiBvdGhlciBzdGFja3NcbiAgICovXG4gIHB1YmxpYyBnZXRCdXNTdGFja05hbWUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJy8nLCB0aGlzLm5lc3RlZFN0YWNrLnJlZikpO1xuICB9XG59XG4iXX0=