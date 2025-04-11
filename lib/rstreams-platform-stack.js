"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RStreamsPlatformStack = void 0;
const cdk = require("aws-cdk-lib");
const ssm = require("aws-cdk-lib/aws-ssm");
const iam = require("aws-cdk-lib/aws-iam");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
// Import new constructs
const auth_stack_1 = require("./auth/auth-stack");
const bus_stack_1 = require("./bus/bus-stack");
const botmon_stack_1 = require("./botmon/botmon-stack");
class RStreamsPlatformStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Set up the environment context from CDK context or props
        const environmentName = this.node.tryGetContext('environment') || props?.environmentName || 'dev';
        // Instantiate new Auth construct
        const auth = new auth_stack_1.Auth(this, 'Auth', {
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
        // Detect LocalStack environment
        const isLocalStack = this.account === '000000000000' ||
            this.region === 'local' ||
            process.env.LOCALSTACK_HOSTNAME !== undefined ||
            process.env.CDK_LOCAL === 'true';
        console.log(`STACK: Detected environment: account=${this.account}, region=${this.region}, isLocalStack=${isLocalStack}`);
        // Instantiate new Bus construct with all parameters from original CloudFormation
        const bus = new bus_stack_1.Bus(this, 'Bus', {
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
            monitorShardHashKey: this.node.tryGetContext('monitorShardHashKey') || 0,
            // Skip Firehose resource for LocalStack
            skipForLocalStack: isLocalStack ? { firehose: true } : undefined
        });
        // Get custom JS and logins for Botmon UI customization
        const customJs = this.node.tryGetContext('customJs');
        const logins = this.node.tryGetContext('logins');
        // Get existing Cognito ID if provided
        const inputCognitoId = this.node.tryGetContext('inputCognitoId');
        const createCognito = !inputCognitoId;
        // Instantiate new Botmon construct with Cognito configuration
        const botmon = new botmon_stack_1.Botmon(this, 'Botmon', {
            environmentName: environmentName,
            bus: bus,
            auth: auth,
            customJs: customJs,
            logins: logins,
            createCognito: createCognito,
            existingCognitoId: inputCognitoId
        });
        // Create the SSM parameter using output from Bus construct
        const rsfParameter = new ssm.StringParameter(this, 'RStreamsPlatformRSFParameter', {
            parameterName: this.stackName,
            stringValue: bus.busStackNameOutput,
            description: 'RStreams Bus Stack Reference Name'
        });
        // Create a secret in Secrets Manager with table names and other references
        const secretValue = cdk.Fn.join('', [
            '{',
            '"LeoStream":"', bus.leoStreamTable.tableName, '",',
            '"LeoCron":"', bus.leoCronTable.tableName, '",',
            '"LeoEvent":"', bus.leoEventTable.tableName, '",',
            '"LeoSettings":"', bus.leoSettingsTable.tableName, '",',
            '"LeoSystem":"', bus.leoSystemTable.tableName, '",',
            '"LeoKinesisStream":"', bus.leoKinesisStream.streamName, '",',
            '"LeoFirehoseStream":"', bus.leoFirehoseStreamName, '",',
            '"LeoS3":"', bus.leoS3Bucket.bucketName, '",',
            '"Region":"', this.region, '"',
            '}'
        ]);
        const platformSecret = new secretsmanager.Secret(this, 'RStreamsPlatformSecret', {
            secretName: `rstreams-${this.stackName}`,
            description: 'RStreams Platform resource references',
            secretStringValue: cdk.SecretValue.unsafePlainText(secretValue.toString())
        });
        // CloudFront URL for Botmon UI access
        new cdk.CfnOutput(this, 'BotmonURL', {
            description: 'Botmon UI URL',
            value: `https://${botmon.cloudfrontDistribution.distributionDomainName}`
        });
        // Add output for the Secret ARN
        new cdk.CfnOutput(this, 'PlatformSecretARN', {
            description: 'ARN of the RStreams Platform Secret',
            value: platformSecret.secretArn
        });
        // Create ApiRole for Lambda function invocation
        const apiRole = new iam.Role(this, 'ApiRole', {
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('lambda.amazonaws.com'), new iam.AccountPrincipal(this.account)),
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
exports.RStreamsPlatformStack = RStreamsPlatformStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN0cmVhbXMtcGxhdGZvcm0tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyc3RyZWFtcy1wbGF0Zm9ybS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxpRUFBaUU7QUFFakUsd0JBQXdCO0FBQ3hCLGtEQUF5QztBQUN6QywrQ0FBc0M7QUFDdEMsd0RBQStDO0FBOEIvQyxNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBa0M7UUFDMUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsMkRBQTJEO1FBQzNELE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEtBQUssRUFBRSxlQUFlLElBQUksS0FBSyxDQUFDO1FBRWxHLGlDQUFpQztRQUNqQyxNQUFNLElBQUksR0FBRyxJQUFJLGlCQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtZQUNsQyxlQUFlLEVBQUUsZUFBZTtTQUNqQyxDQUFDLENBQUM7UUFFSCxzREFBc0Q7UUFDdEQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO1lBQ25FLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDNUQsU0FBUyxDQUFDO1FBRVosbUVBQW1FO1FBQ25FLE1BQU0sNEJBQTRCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsMkNBQTJDLENBQUMsQ0FBQyxDQUFDO1lBQ3pHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLDJDQUEyQyxDQUFDLENB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QUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzFDLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFLENBQUMsdUJBQXVCLENBQUM7WUFDbEMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsOEVBQThFLENBQUMsQ0FBQztTQUN4RyxDQUFDLENBQUMsQ0FBQztJQUNOLENBQUM7Q0FDRjtBQXpJRCxzREF5SUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuXG4vLyBJbXBvcnQgbmV3IGNvbnN0cnVjdHNcbmltcG9ydCB7IEF1dGggfSBmcm9tICcuL2F1dGgvYXV0aC1zdGFjayc7XG5pbXBvcnQgeyBCdXMgfSBmcm9tICcuL2J1cy9idXMtc3RhY2snO1xuaW1wb3J0IHsgQm90bW9uIH0gZnJvbSAnLi9ib3Rtb24vYm90bW9uLXN0YWNrJztcblxuZXhwb3J0IGludGVyZmFjZSBSU3RyZWFtc1BsYXRmb3JtU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBlbnZpcm9ubWVudCBmb3IgdGhlIGRlcGxveW1lbnQgKGRldiwgc3RhZ2luZywgcHJvZCwgZXRjLilcbiAgICogU2hvdWxkIGJlIHBhc3NlZCB2aWEgY29udGV4dCBgLWMgZW52aXJvbm1lbnQ9ZGV2YCBvciBkZWZpbmVkIGluIGNkay5qc29uXG4gICAqIEBkZWZhdWx0ICdkZXYnXG4gICAqL1xuICBlbnZpcm9ubWVudE5hbWU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQnVzUHJvcHMge1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcbiAgdHJ1c3RlZEFybnM/OiBzdHJpbmdbXTtcbiAgcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucz86IHN0cmluZ1tdO1xuICBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZz86IHN0cmluZztcbiAgbGFtYmRhSW52b2tlUG9saWN5Pzogc3RyaW5nO1xuICBraW5lc2lzU2hhcmRzPzogbnVtYmVyO1xuICBsYW1iZGFNZW1vcnk/OiB7XG4gICAga2luZXNpc1N0cmVhbVByb2Nlc3Nvcj86IG51bWJlcjtcbiAgICBmaXJlaG9zZVN0cmVhbVByb2Nlc3Nvcj86IG51bWJlcjtcbiAgICBjcm9uUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGV2ZW50VHJpZ2dlcj86IG51bWJlcjtcbiAgICBtb25pdG9yPzogbnVtYmVyO1xuICB9O1xuICBzdHJlYW1UVExTZWNvbmRzPzogbnVtYmVyO1xuICBtb25pdG9yU2hhcmRIYXNoS2V5PzogbnVtYmVyO1xuICBleHBvcnROYW1lUHJlZml4Pzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgUlN0cmVhbXNQbGF0Zm9ybVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSU3RyZWFtc1BsYXRmb3JtU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gU2V0IHVwIHRoZSBlbnZpcm9ubWVudCBjb250ZXh0IGZyb20gQ0RLIGNvbnRleHQgb3IgcHJvcHNcbiAgICBjb25zdCBlbnZpcm9ubWVudE5hbWUgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52aXJvbm1lbnQnKSB8fCBwcm9wcz8uZW52aXJvbm1lbnROYW1lIHx8ICdkZXYnO1xuXG4gICAgLy8gSW5zdGFudGlhdGUgbmV3IEF1dGggY29uc3RydWN0XG4gICAgY29uc3QgYXV0aCA9IG5ldyBBdXRoKHRoaXMsICdBdXRoJywge1xuICAgICAgZW52aXJvbm1lbnROYW1lOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdHJ1c3RlZCBBV1MgcHJpbmNpcGFscyBmb3IgY3Jvc3MtYWNjb3VudCBhY2Nlc3NcbiAgICBjb25zdCB0cnVzdGVkQXJucyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCd0cnVzdGVkQVdTUHJpbmNpcGxlcycpID8gXG4gICAgICB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgndHJ1c3RlZEFXU1ByaW5jaXBsZXMnKS5zcGxpdCgnLCcpIDogXG4gICAgICB1bmRlZmluZWQ7XG5cbiAgICAvLyBHZXQgcXVldWUgcmVwbGljYXRpb24gZGVzdGluYXRpb25zIGZvciBjcm9zcy1hY2NvdW50IHJlcGxpY2F0aW9uXG4gICAgY29uc3QgcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcycpID9cbiAgICAgIHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcycpLnNwbGl0KCcsJykgOlxuICAgICAgdW5kZWZpbmVkO1xuXG4gICAgLy8gR2V0IHF1ZXVlIHJlcGxpY2F0aW9uIG1hcHBpbmcgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3F1ZXVlUmVwbGljYXRpb25NYXBwaW5nJykgfHwgJ1tdJztcblxuICAgIC8vIERldGVjdCBMb2NhbFN0YWNrIGVudmlyb25tZW50XG4gICAgY29uc3QgaXNMb2NhbFN0YWNrID0gdGhpcy5hY2NvdW50ID09PSAnMDAwMDAwMDAwMDAwJyB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lvbiA9PT0gJ2xvY2FsJyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkxPQ0FMU1RBQ0tfSE9TVE5BTUUgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkNES19MT0NBTCA9PT0gJ3RydWUnO1xuICAgIFxuICAgIGNvbnNvbGUubG9nKGBTVEFDSzogRGV0ZWN0ZWQgZW52aXJvbm1lbnQ6IGFjY291bnQ9JHt0aGlzLmFjY291bnR9LCByZWdpb249JHt0aGlzLnJlZ2lvbn0sIGlzTG9jYWxTdGFjaz0ke2lzTG9jYWxTdGFja31gKTtcblxuICAgIC8vIEluc3RhbnRpYXRlIG5ldyBCdXMgY29uc3RydWN0IHdpdGggYWxsIHBhcmFtZXRlcnMgZnJvbSBvcmlnaW5hbCBDbG91ZEZvcm1hdGlvblxuICAgIGNvbnN0IGJ1cyA9IG5ldyBCdXModGhpcywgJ0J1cycsIHtcbiAgICAgIGVudmlyb25tZW50TmFtZTogZW52aXJvbm1lbnROYW1lLFxuICAgICAgdHJ1c3RlZEFybnM6IHRydXN0ZWRBcm5zLFxuICAgICAgcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9uczogcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucyxcbiAgICAgIHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nOiBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZyxcbiAgICAgIGxhbWJkYU1lbW9yeToge1xuICAgICAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgna2luZXNpc1N0cmVhbVByb2Nlc3Nvck1lbW9yeScpIHx8IDY0MCxcbiAgICAgICAgZmlyZWhvc2VTdHJlYW1Qcm9jZXNzb3I6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdmaXJlaG9zZVN0cmVhbVByb2Nlc3Nvck1lbW9yeScpIHx8IDY0MCxcbiAgICAgICAgY3JvblByb2Nlc3NvcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2Nyb25Qcm9jZXNzb3JNZW1vcnknKSB8fCAyNTYsXG4gICAgICAgIGV2ZW50VHJpZ2dlcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2V2ZW50VHJpZ2dlck1lbW9yeScpIHx8IDEyOCxcbiAgICAgICAgbW9uaXRvcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2xlb01vbml0b3JNZW1vcnknKSB8fCAyNTZcbiAgICAgIH0sXG4gICAgICBleHBvcnROYW1lUHJlZml4OiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIGxhbWJkYUludm9rZVBvbGljeTogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2xhbWJkYUludm9rZVBvbGljeScpLFxuICAgICAga2luZXNpc1NoYXJkczogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2tpbmVzaXNTaGFyZHMnKSB8fCAxLFxuICAgICAgc3RyZWFtVFRMU2Vjb25kczogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3N0cmVhbVRUTFNlY29uZHMnKSB8fCA2MDQ4MDAsXG4gICAgICBtb25pdG9yU2hhcmRIYXNoS2V5OiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbW9uaXRvclNoYXJkSGFzaEtleScpIHx8IDAsXG4gICAgICAvLyBTa2lwIEZpcmVob3NlIHJlc291cmNlIGZvciBMb2NhbFN0YWNrXG4gICAgICBza2lwRm9yTG9jYWxTdGFjazogaXNMb2NhbFN0YWNrID8geyBmaXJlaG9zZTogdHJ1ZSB9IDogdW5kZWZpbmVkXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgY3VzdG9tIEpTIGFuZCBsb2dpbnMgZm9yIEJvdG1vbiBVSSBjdXN0b21pemF0aW9uXG4gICAgY29uc3QgY3VzdG9tSnMgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnY3VzdG9tSnMnKTtcbiAgICBjb25zdCBsb2dpbnMgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbG9naW5zJyk7XG5cbiAgICAvLyBHZXQgZXhpc3RpbmcgQ29nbml0byBJRCBpZiBwcm92aWRlZFxuICAgIGNvbnN0IGlucHV0Q29nbml0b0lkID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2lucHV0Q29nbml0b0lkJyk7XG4gICAgY29uc3QgY3JlYXRlQ29nbml0byA9ICFpbnB1dENvZ25pdG9JZDtcblxuICAgIC8vIEluc3RhbnRpYXRlIG5ldyBCb3Rtb24gY29uc3RydWN0IHdpdGggQ29nbml0byBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgYm90bW9uID0gbmV3IEJvdG1vbih0aGlzLCAnQm90bW9uJywge1xuICAgICAgZW52aXJvbm1lbnROYW1lOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgICBidXM6IGJ1cyxcbiAgICAgIGF1dGg6IGF1dGgsXG4gICAgICBjdXN0b21KczogY3VzdG9tSnMsXG4gICAgICBsb2dpbnM6IGxvZ2lucyxcbiAgICAgIGNyZWF0ZUNvZ25pdG86IGNyZWF0ZUNvZ25pdG8sXG4gICAgICBleGlzdGluZ0NvZ25pdG9JZDogaW5wdXRDb2duaXRvSWRcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSB0aGUgU1NNIHBhcmFtZXRlciB1c2luZyBvdXRwdXQgZnJvbSBCdXMgY29uc3RydWN0XG4gICAgY29uc3QgcnNmUGFyYW1ldGVyID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ1JTdHJlYW1zUGxhdGZvcm1SU0ZQYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIHN0cmluZ1ZhbHVlOiBidXMuYnVzU3RhY2tOYW1lT3V0cHV0LFxuICAgICAgZGVzY3JpcHRpb246ICdSU3RyZWFtcyBCdXMgU3RhY2sgUmVmZXJlbmNlIE5hbWUnXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYSBzZWNyZXQgaW4gU2VjcmV0cyBNYW5hZ2VyIHdpdGggdGFibGUgbmFtZXMgYW5kIG90aGVyIHJlZmVyZW5jZXNcbiAgICBjb25zdCBzZWNyZXRWYWx1ZSA9IGNkay5Gbi5qb2luKCcnLCBbXG4gICAgICAneycsXG4gICAgICAnXCJMZW9TdHJlYW1cIjpcIicsIGJ1cy5sZW9TdHJlYW1UYWJsZS50YWJsZU5hbWUsICdcIiwnLFxuICAgICAgJ1wiTGVvQ3JvblwiOlwiJywgYnVzLmxlb0Nyb25UYWJsZS50YWJsZU5hbWUsICdcIiwnLFxuICAgICAgJ1wiTGVvRXZlbnRcIjpcIicsIGJ1cy5sZW9FdmVudFRhYmxlLnRhYmxlTmFtZSwgJ1wiLCcsXG4gICAgICAnXCJMZW9TZXR0aW5nc1wiOlwiJywgYnVzLmxlb1NldHRpbmdzVGFibGUudGFibGVOYW1lLCAnXCIsJyxcbiAgICAgICdcIkxlb1N5c3RlbVwiOlwiJywgYnVzLmxlb1N5c3RlbVRhYmxlLnRhYmxlTmFtZSwgJ1wiLCcsXG4gICAgICAnXCJMZW9LaW5lc2lzU3RyZWFtXCI6XCInLCBidXMubGVvS2luZXNpc1N0cmVhbS5zdHJlYW1OYW1lLCAnXCIsJyxcbiAgICAgICdcIkxlb0ZpcmVob3NlU3RyZWFtXCI6XCInLCBidXMubGVvRmlyZWhvc2VTdHJlYW1OYW1lLCAnXCIsJyxcbiAgICAgICdcIkxlb1MzXCI6XCInLCBidXMubGVvUzNCdWNrZXQuYnVja2V0TmFtZSwgJ1wiLCcsXG4gICAgICAnXCJSZWdpb25cIjpcIicsIHRoaXMucmVnaW9uLCAnXCInLFxuICAgICAgJ30nXG4gICAgXSk7XG5cbiAgICBjb25zdCBwbGF0Zm9ybVNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1JTdHJlYW1zUGxhdGZvcm1TZWNyZXQnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgcnN0cmVhbXMtJHt0aGlzLnN0YWNrTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdSU3RyZWFtcyBQbGF0Zm9ybSByZXNvdXJjZSByZWZlcmVuY2VzJyxcbiAgICAgIHNlY3JldFN0cmluZ1ZhbHVlOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHNlY3JldFZhbHVlLnRvU3RyaW5nKCkpXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZEZyb250IFVSTCBmb3IgQm90bW9uIFVJIGFjY2Vzc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCb3Rtb25VUkwnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0JvdG1vbiBVSSBVUkwnLFxuICAgICAgdmFsdWU6IGBodHRwczovLyR7Ym90bW9uLmNsb3VkZnJvbnREaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX1gXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgb3V0cHV0IGZvciB0aGUgU2VjcmV0IEFSTlxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQbGF0Zm9ybVNlY3JldEFSTicsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBSU3RyZWFtcyBQbGF0Zm9ybSBTZWNyZXQnLFxuICAgICAgdmFsdWU6IHBsYXRmb3JtU2VjcmV0LnNlY3JldEFyblxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEFwaVJvbGUgZm9yIExhbWJkYSBmdW5jdGlvbiBpbnZvY2F0aW9uXG4gICAgY29uc3QgYXBpUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQXBpUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5Db21wb3NpdGVQcmluY2lwYWwoXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbmV3IGlhbS5BY2NvdW50UHJpbmNpcGFsKHRoaXMuYWNjb3VudClcbiAgICAgICksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcbiAgICAgIF1cbiAgICB9KTtcblxuICAgIGFwaVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydsYW1iZGE6QWRkUGVybWlzc2lvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIGFwaVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydsYW1iZGE6SW52b2tlRnVuY3Rpb24nXSxcbiAgICAgIHJlc291cmNlczogW2Nkay5Gbi5zdWIoJ2Fybjphd3M6bGFtYmRhOiR7QVdTOjpSZWdpb259OiR7QVdTOjpBY2NvdW50SWR9OmZ1bmN0aW9uOiR7QVdTOjpTdGFja05hbWV9LSonKV1cbiAgICB9KSk7XG4gIH1cbn1cbiJdfQ==