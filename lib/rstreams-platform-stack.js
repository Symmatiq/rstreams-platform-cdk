"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RStreamsPlatformStack = void 0;
const cdk = require("aws-cdk-lib");
const ssm = require("aws-cdk-lib/aws-ssm");
const iam = require("aws-cdk-lib/aws-iam");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
// Removed old construct imports
// import { AuthStack } from './constructs/auth-stack';
// import { BusStack } from './constructs/bus-stack';
// import { CognitoStack } from './constructs/cognito-stack';
// import { BotmonStack } from './constructs/botmon-stack';
// import { ApiRole } from './constructs/api-role';
// import { RegionMap } from './helpers/mappings';
// import { createCognitoCondition } from './helpers/conditions';
// Import new constructs
const auth_stack_1 = require("./auth/auth-stack");
const bus_stack_1 = require("./bus/bus-stack");
const botmon_stack_1 = require("./botmon/botmon-stack");
class RStreamsPlatformStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Set up the environment context from CDK context or props
        const environmentName = this.node.tryGetContext('environment') || props?.environmentName || 'dev';
        // Remove Region Mapping
        // const cfnMapping = new cdk.CfnMapping(this, 'RStreamsPlatformMappingsRegionMapA6B22AAF', { ... });
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
        const botmon = new botmon_stack_1.Botmon(this, 'Botmon', {
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
        // Create a secret in Secrets Manager with table names and other references
        const secretValue = JSON.stringify({
            LeoStream: cdk.Fn.importValue(`${this.stackName}-LeoStream`),
            LeoCron: cdk.Fn.importValue(`${this.stackName}-LeoCron`),
            LeoEvent: cdk.Fn.importValue(`${this.stackName}-LeoEvent`),
            LeoSettings: cdk.Fn.importValue(`${this.stackName}-LeoSettings`),
            LeoSystem: cdk.Fn.importValue(`${this.stackName}-LeoSystem`),
            LeoKinesisStream: cdk.Fn.importValue(`${this.stackName}-LeoKinesisStream`),
            LeoFirehoseStream: cdk.Fn.importValue(`${this.stackName}-LeoFirehoseStream`),
            LeoS3: cdk.Fn.importValue(`${this.stackName}-LeoS3`),
            Region: cdk.Fn.importValue(`${this.stackName}-Region`)
        });
        const platformSecret = new secretsmanager.Secret(this, 'RStreamsPlatformSecret', {
            secretName: `rstreams-${this.stackName}`,
            description: 'RStreams Platform resource references',
            secretStringValue: cdk.SecretValue.unsafePlainText(secretValue)
        });
        // Remove old Leo Template output
        // new cdk.CfnOutput(this, 'RStreamsPlatformOutputsLeoTemplateD3E132CC', { ... });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN0cmVhbXMtcGxhdGZvcm0tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyc3RyZWFtcy1wbGF0Zm9ybS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxpRUFBaUU7QUFDakUsZ0NBQWdDO0FBQ2hDLHVEQUF1RDtBQUN2RCxxREFBcUQ7QUFDckQsNkRBQTZEO0FBQzdELDJEQUEyRDtBQUMzRCxtREFBbUQ7QUFDbkQsa0RBQWtEO0FBQ2xELGlFQUFpRTtBQUVqRSx3QkFBd0I7QUFDeEIsa0RBQXlDO0FBQ3pDLCtDQUFzQztBQUN0Qyx3REFBK0M7QUE4Qi9DLE1BQWEscUJBQXNCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDbEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QiwyREFBMkQ7UUFDM0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLElBQUksS0FBSyxFQUFFLGVBQWUsSUFBSSxLQUFLLENBQUM7UUFFbEcsd0JBQXdCO1FBQ3hCLHFHQUFxRztRQUVyRyxpQ0FBaUM7UUFDakMsTUFBTSxJQUFJLEdBQUcsSUFBSSxpQkFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUU7WUFDbEMsZUFBZSxFQUFFLGVBQWU7U0FDakMsQ0FBQyxDQUFDO1FBRUgsc0RBQXNEO1FBQ3RELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQztZQUNuRSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQzVELFNBQVMsQ0FBQztRQUVaLG1F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HBlcnMvbWFwcGluZ3MnO1xuLy8gaW1wb3J0IHsgY3JlYXRlQ29nbml0b0NvbmRpdGlvbiB9IGZyb20gJy4vaGVscGVycy9jb25kaXRpb25zJztcblxuLy8gSW1wb3J0IG5ldyBjb25zdHJ1Y3RzXG5pbXBvcnQgeyBBdXRoIH0gZnJvbSAnLi9hdXRoL2F1dGgtc3RhY2snO1xuaW1wb3J0IHsgQnVzIH0gZnJvbSAnLi9idXMvYnVzLXN0YWNrJztcbmltcG9ydCB7IEJvdG1vbiB9IGZyb20gJy4vYm90bW9uL2JvdG1vbi1zdGFjayc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUlN0cmVhbXNQbGF0Zm9ybVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZW52aXJvbm1lbnQgZm9yIHRoZSBkZXBsb3ltZW50IChkZXYsIHN0YWdpbmcsIHByb2QsIGV0Yy4pXG4gICAqIFNob3VsZCBiZSBwYXNzZWQgdmlhIGNvbnRleHQgYC1jIGVudmlyb25tZW50PWRldmAgb3IgZGVmaW5lZCBpbiBjZGsuanNvblxuICAgKiBAZGVmYXVsdCAnZGV2J1xuICAgKi9cbiAgZW52aXJvbm1lbnROYW1lPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJ1c1Byb3BzIHtcbiAgZW52aXJvbm1lbnROYW1lOiBzdHJpbmc7XG4gIHRydXN0ZWRBcm5zPzogc3RyaW5nW107XG4gIHF1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbnM/OiBzdHJpbmdbXTtcbiAgcXVldWVSZXBsaWNhdGlvbk1hcHBpbmc/OiBzdHJpbmc7XG4gIGxhbWJkYUludm9rZVBvbGljeT86IHN0cmluZztcbiAga2luZXNpc1NoYXJkcz86IG51bWJlcjtcbiAgbGFtYmRhTWVtb3J5Pzoge1xuICAgIGtpbmVzaXNTdHJlYW1Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgZmlyZWhvc2VTdHJlYW1Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgY3JvblByb2Nlc3Nvcj86IG51bWJlcjtcbiAgICBldmVudFRyaWdnZXI/OiBudW1iZXI7XG4gICAgbW9uaXRvcj86IG51bWJlcjtcbiAgfTtcbiAgc3RyZWFtVFRMU2Vjb25kcz86IG51bWJlcjtcbiAgbW9uaXRvclNoYXJkSGFzaEtleT86IG51bWJlcjtcbiAgZXhwb3J0TmFtZVByZWZpeD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFJTdHJlYW1zUGxhdGZvcm1TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUlN0cmVhbXNQbGF0Zm9ybVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIFNldCB1cCB0aGUgZW52aXJvbm1lbnQgY29udGV4dCBmcm9tIENESyBjb250ZXh0IG9yIHByb3BzXG4gICAgY29uc3QgZW52aXJvbm1lbnROYW1lID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2Vudmlyb25tZW50JykgfHwgcHJvcHM/LmVudmlyb25tZW50TmFtZSB8fCAnZGV2JztcblxuICAgIC8vIFJlbW92ZSBSZWdpb24gTWFwcGluZ1xuICAgIC8vIGNvbnN0IGNmbk1hcHBpbmcgPSBuZXcgY2RrLkNmbk1hcHBpbmcodGhpcywgJ1JTdHJlYW1zUGxhdGZvcm1NYXBwaW5nc1JlZ2lvbk1hcEE2QjIyQUFGJywgeyAuLi4gfSk7XG5cbiAgICAvLyBJbnN0YW50aWF0ZSBuZXcgQXV0aCBjb25zdHJ1Y3RcbiAgICBjb25zdCBhdXRoID0gbmV3IEF1dGgodGhpcywgJ0F1dGgnLCB7XG4gICAgICBlbnZpcm9ubWVudE5hbWU6IGVudmlyb25tZW50TmFtZSxcbiAgICB9KTtcblxuICAgIC8vIEdldCB0cnVzdGVkIEFXUyBwcmluY2lwYWxzIGZvciBjcm9zcy1hY2NvdW50IGFjY2Vzc1xuICAgIGNvbnN0IHRydXN0ZWRBcm5zID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3RydXN0ZWRBV1NQcmluY2lwbGVzJykgPyBcbiAgICAgIHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCd0cnVzdGVkQVdTUHJpbmNpcGxlcycpLnNwbGl0KCcsJykgOiBcbiAgICAgIHVuZGVmaW5lZDtcblxuICAgIC8vIEdldCBxdWV1ZSByZXBsaWNhdGlvbiBkZXN0aW5hdGlvbnMgZm9yIGNyb3NzLWFjY291bnQgcmVwbGljYXRpb25cbiAgICBjb25zdCBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3F1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbkxlb0JvdFJvbGVBUk5zJykgP1xuICAgICAgdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3F1ZXVlUmVwbGljYXRpb25EZXN0aW5hdGlvbkxlb0JvdFJvbGVBUk5zJykuc3BsaXQoJywnKSA6XG4gICAgICB1bmRlZmluZWQ7XG5cbiAgICAvLyBHZXQgcXVldWUgcmVwbGljYXRpb24gbWFwcGluZyBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgcXVldWVSZXBsaWNhdGlvbk1hcHBpbmcgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgncXVldWVSZXBsaWNhdGlvbk1hcHBpbmcnKSB8fCAnW10nO1xuXG4gICAgLy8gSW5zdGFudGlhdGUgbmV3IEJ1cyBjb25zdHJ1Y3Qgd2l0aCBhbGwgcGFyYW1ldGVycyBmcm9tIG9yaWdpbmFsIENsb3VkRm9ybWF0aW9uXG4gICAgY29uc3QgYnVzID0gbmV3IEJ1cyh0aGlzLCAnQnVzJywge1xuICAgICAgZW52aXJvbm1lbnROYW1lOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgICB0cnVzdGVkQXJuczogdHJ1c3RlZEFybnMsXG4gICAgICBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zOiBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zLFxuICAgICAgcXVldWVSZXBsaWNhdGlvbk1hcHBpbmc6IHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nLFxuICAgICAgbGFtYmRhTWVtb3J5OiB7XG4gICAgICAgIGtpbmVzaXNTdHJlYW1Qcm9jZXNzb3I6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdraW5lc2lzU3RyZWFtUHJvY2Vzc29yTWVtb3J5JykgfHwgNjQwLFxuICAgICAgICBmaXJlaG9zZVN0cmVhbVByb2Nlc3NvcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2ZpcmVob3NlU3RyZWFtUHJvY2Vzc29yTWVtb3J5JykgfHwgNjQwLFxuICAgICAgICBjcm9uUHJvY2Vzc29yOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnY3JvblByb2Nlc3Nvck1lbW9yeScpIHx8IDI1NixcbiAgICAgICAgZXZlbnRUcmlnZ2VyOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZXZlbnRUcmlnZ2VyTWVtb3J5JykgfHwgMTI4LFxuICAgICAgICBtb25pdG9yOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbGVvTW9uaXRvck1lbW9yeScpIHx8IDI1NlxuICAgICAgfSxcbiAgICAgIGV4cG9ydE5hbWVQcmVmaXg6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgbGFtYmRhSW52b2tlUG9saWN5OiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbGFtYmRhSW52b2tlUG9saWN5JyksXG4gICAgICBraW5lc2lzU2hhcmRzOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgna2luZXNpc1NoYXJkcycpIHx8IDEsXG4gICAgICBzdHJlYW1UVExTZWNvbmRzOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnc3RyZWFtVFRMU2Vjb25kcycpIHx8IDYwNDgwMCxcbiAgICAgIG1vbml0b3JTaGFyZEhhc2hLZXk6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdtb25pdG9yU2hhcmRIYXNoS2V5JykgfHwgMFxuICAgIH0pO1xuXG4gICAgLy8gUmVtb3ZlIG9sZCBDb2duaXRvIGNvbmRpdGlvbiBhbmQgc3RhY2tcbiAgICAvLyBjb25zdCBjb25kaXRpb25SZXNvdXJjZSA9IG5ldyBjZGsuQ2ZuQ29uZGl0aW9uKHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtQ29uZGl0aW9uc2NyZWF0ZUNvZ25pdG8zMjJENkM2RScsIHsgLi4uIH0pO1xuICAgIC8vIGNvbnN0IGNvZ25pdG9TdGFjayA9IG5ldyBDb2duaXRvU3RhY2sodGhpcywgJ1JTdHJlYW1zUGxhdGZvcm1Db2duaXRvNzgwNzI5RUMnKTtcblxuICAgIC8vIEdldCBjdXN0b20gSlMgYW5kIGxvZ2lucyBmb3IgQm90bW9uIFVJIGN1c3RvbWl6YXRpb25cbiAgICBjb25zdCBjdXN0b21KcyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdjdXN0b21KcycpO1xuICAgIGNvbnN0IGxvZ2lucyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdsb2dpbnMnKTtcblxuICAgIC8vIEdldCBleGlzdGluZyBDb2duaXRvIElEIGlmIHByb3ZpZGVkXG4gICAgY29uc3QgaW5wdXRDb2duaXRvSWQgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnaW5wdXRDb2duaXRvSWQnKTtcbiAgICBjb25zdCBjcmVhdGVDb2duaXRvID0gIWlucHV0Q29nbml0b0lkO1xuXG4gICAgLy8gSW5zdGFudGlhdGUgbmV3IEJvdG1vbiBjb25zdHJ1Y3Qgd2l0aCBDb2duaXRvIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBib3Rtb24gPSBuZXcgQm90bW9uKHRoaXMsICdCb3Rtb24nLCB7XG4gICAgICBlbnZpcm9ubWVudE5hbWU6IGVudmlyb25tZW50TmFtZSxcbiAgICAgIGJ1czogYnVzLFxuICAgICAgYXV0aDogYXV0aCxcbiAgICAgIGN1c3RvbUpzOiBjdXN0b21KcyxcbiAgICAgIGxvZ2luczogbG9naW5zLFxuICAgICAgY3JlYXRlQ29nbml0bzogY3JlYXRlQ29nbml0byxcbiAgICAgIGV4aXN0aW5nQ29nbml0b0lkOiBpbnB1dENvZ25pdG9JZFxuICAgIH0pO1xuXG4gICAgLy8gUmVtb3ZlIGRlcGVuZGVuY2llcyBvbiBvbGQgbmVzdGVkIHN0YWNrc1xuICAgIC8vIGJvdG1vblN0YWNrLm5lc3RlZFN0YWNrLmFkZERlcGVuZGVuY3koYXV0aFN0YWNrLm5lc3RlZFN0YWNrKTtcbiAgICAvLyBib3Rtb25TdGFjay5uZXN0ZWRTdGFjay5hZGREZXBlbmRlbmN5KGJ1c1N0YWNrLm5lc3RlZFN0YWNrKTtcbiAgICAvLyBib3Rtb25TdGFjay5uZXN0ZWRTdGFjay5hZGREZXBlbmRlbmN5KGNvZ25pdG9TdGFjay5uZXN0ZWRTdGFjayk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIFNTTSBwYXJhbWV0ZXIgdXNpbmcgb3V0cHV0IGZyb20gQnVzIGNvbnN0cnVjdFxuICAgIGNvbnN0IHJzZlBhcmFtZXRlciA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtUlNGUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogdGhpcy5zdGFja05hbWUsXG4gICAgICBzdHJpbmdWYWx1ZTogYnVzLmJ1c1N0YWNrTmFtZU91dHB1dCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUlN0cmVhbXMgQnVzIFN0YWNrIFJlZmVyZW5jZSBOYW1lJ1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VjcmV0IGluIFNlY3JldHMgTWFuYWdlciB3aXRoIHRhYmxlIG5hbWVzIGFuZCBvdGhlciByZWZlcmVuY2VzXG4gICAgY29uc3Qgc2VjcmV0VmFsdWUgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBMZW9TdHJlYW06IGNkay5Gbi5pbXBvcnRWYWx1ZShgJHt0aGlzLnN0YWNrTmFtZX0tTGVvU3RyZWFtYCksXG4gICAgICBMZW9Dcm9uOiBjZGsuRm4uaW1wb3J0VmFsdWUoYCR7dGhpcy5zdGFja05hbWV9LUxlb0Nyb25gKSxcbiAgICAgIExlb0V2ZW50OiBjZGsuRm4uaW1wb3J0VmFsdWUoYCR7dGhpcy5zdGFja05hbWV9LUxlb0V2ZW50YCksXG4gICAgICBMZW9TZXR0aW5nczogY2RrLkZuLmltcG9ydFZhbHVlKGAke3RoaXMuc3RhY2tOYW1lfS1MZW9TZXR0aW5nc2ApLFxuICAgICAgTGVvU3lzdGVtOiBjZGsuRm4uaW1wb3J0VmFsdWUoYCR7dGhpcy5zdGFja05hbWV9LUxlb1N5c3RlbWApLFxuICAgICAgTGVvS2luZXNpc1N0cmVhbTogY2RrLkZuLmltcG9ydFZhbHVlKGAke3RoaXMuc3RhY2tOYW1lfS1MZW9LaW5lc2lzU3RyZWFtYCksXG4gICAgICBMZW9GaXJlaG9zZVN0cmVhbTogY2RrLkZuLmltcG9ydFZhbHVlKGAke3RoaXMuc3RhY2tOYW1lfS1MZW9GaXJlaG9zZVN0cmVhbWApLFxuICAgICAgTGVvUzM6IGNkay5Gbi5pbXBvcnRWYWx1ZShgJHt0aGlzLnN0YWNrTmFtZX0tTGVvUzNgKSxcbiAgICAgIFJlZ2lvbjogY2RrLkZuLmltcG9ydFZhbHVlKGAke3RoaXMuc3RhY2tOYW1lfS1SZWdpb25gKVxuICAgIH0pO1xuXG4gICAgY29uc3QgcGxhdGZvcm1TZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogYHJzdHJlYW1zLSR7dGhpcy5zdGFja05hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUlN0cmVhbXMgUGxhdGZvcm0gcmVzb3VyY2UgcmVmZXJlbmNlcycsXG4gICAgICBzZWNyZXRTdHJpbmdWYWx1ZTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChzZWNyZXRWYWx1ZSlcbiAgICB9KTtcblxuICAgIC8vIFJlbW92ZSBvbGQgTGVvIFRlbXBsYXRlIG91dHB1dFxuICAgIC8vIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtT3V0cHV0c0xlb1RlbXBsYXRlRDNFMTMyQ0MnLCB7IC4uLiB9KTtcblxuICAgIC8vIENsb3VkRnJvbnQgVVJMIGZvciBCb3Rtb24gVUkgYWNjZXNzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JvdG1vblVSTCcsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQm90bW9uIFVJIFVSTCcsXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtib3Rtb24uY2xvdWRmcm9udERpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWBcbiAgICB9KTtcblxuICAgIC8vIEFkZCBvdXRwdXQgZm9yIHRoZSBTZWNyZXQgQVJOXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1BsYXRmb3JtU2VjcmV0QVJOJywge1xuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIFJTdHJlYW1zIFBsYXRmb3JtIFNlY3JldCcsXG4gICAgICB2YWx1ZTogcGxhdGZvcm1TZWNyZXQuc2VjcmV0QXJuXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQXBpUm9sZSBmb3IgTGFtYmRhIGZ1bmN0aW9uIGludm9jYXRpb25cbiAgICBjb25zdCBhcGlSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBcGlSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBuZXcgaWFtLkFjY291bnRQcmluY2lwYWwodGhpcy5hY2NvdW50KVxuICAgICAgKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxuICAgICAgXVxuICAgIH0pO1xuXG4gICAgYXBpUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgfSkpO1xuXG4gICAgYXBpUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbY2RrLkZuLnN1YignYXJuOmF3czpsYW1iZGE6JHtBV1M6OlJlZ2lvbn06JHtBV1M6OkFjY291bnRJZH06ZnVuY3Rpb246JHtBV1M6OlN0YWNrTmFtZX0tKicpXVxuICAgIH0pKTtcbiAgfVxufVxuIl19