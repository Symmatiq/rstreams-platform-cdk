"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RStreamsPlatformStack = void 0;
const cdk = require("aws-cdk-lib");
const ssm = require("aws-cdk-lib/aws-ssm");
const iam = require("aws-cdk-lib/aws-iam");
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
        // Remove old Leo Template output
        // new cdk.CfnOutput(this, 'RStreamsPlatformOutputsLeoTemplateD3E132CC', { ... });
        // CloudFront URL for Botmon UI access
        new cdk.CfnOutput(this, 'BotmonURL', {
            description: 'Botmon UI URL',
            value: `https://${botmon.cloudfrontDistribution.distributionDomainName}`
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN0cmVhbXMtcGxhdGZvcm0tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyc3RyZWFtcy1wbGF0Zm9ybS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxnQ0FBZ0M7QUFDaEMsdURBQXVEO0FBQ3ZELHFEQUFxRDtBQUNyRCw2REFBNkQ7QUFDN0QsMkRBQTJEO0FBQzNELG1EQUFtRDtBQUNuRCxrREFBa0Q7QUFDbEQsaUVBQWlFO0FBRWpFLHdCQUF3QjtBQUN4QixrREFBeUM7QUFDekMsK0NBQXNDO0FBQ3RDLHdEQUErQztBQThCL0MsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNsRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtDO1FBQzFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJEQUEyRDtRQUMzRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxLQUFLLEVBQUUsZUFBZSxJQUFJLEtBQUssQ0FBQztRQUVsRyx3QkFBd0I7UUFDeEIscUdBQXFHO1FBRXJHLGlDQUFpQztRQUNqQyxNQUFNLElBQUksR0FBRyxJQUFJLGlCQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtZQUNsQyxlQUFlLEVBQUUsZUFBZTtTQUNqQyxDQUFDLENBQUM7UUFFSCxzREFBc0Q7UUFDdEQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO1lBQ25FLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDNUQsU0FBUyxDQUFDO1FBRVosbUVBQW1FO1FBQ25FLE1B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QUcsQ0FBQyw4RUFBOEUsQ0FBQyxDQUFDO1NBQ3hHLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztDQUNGO0FBbkhELHNEQW1IQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbi8vIFJlbW92ZWQgb2xkIGNvbnN0cnVjdCBpbXBvcnRzXG4vLyBpbXBvcnQgeyBBdXRoU3RhY2sgfSBmcm9tICcuL2NvbnN0cnVjdHMvYXV0aC1zdGFjayc7XG4vLyBpbXBvcnQgeyBCdXNTdGFjayB9IGZyb20gJy4vY29uc3RydWN0cy9idXMtc3RhY2snO1xuLy8gaW1wb3J0IHsgQ29nbml0b1N0YWNrIH0gZnJvbSAnLi9jb25zdHJ1Y3RzL2NvZ25pdG8tc3RhY2snO1xuLy8gaW1wb3J0IHsgQm90bW9uU3RhY2sgfSBmcm9tICcuL2NvbnN0cnVjdHMvYm90bW9uLXN0YWNrJztcbi8vIGltcG9ydCB7IEFwaVJvbGUgfSBmcm9tICcuL2NvbnN0cnVjdHMvYXBpLXJvbGUnO1xuLy8gaW1wb3J0IHsgUmVnaW9uTWFwIH0gZnJvbSAnLi9oZWxwZXJzL21hcHBpbmdzJztcbi8vIGltcG9ydCB7IGNyZWF0ZUNvZ25pdG9Db25kaXRpb24gfSBmcm9tICcuL2hlbHBlcnMvY29uZGl0aW9ucyc7XG5cbi8vIEltcG9ydCBuZXcgY29uc3RydWN0c1xuaW1wb3J0IHsgQXV0aCB9IGZyb20gJy4vYXV0aC9hdXRoLXN0YWNrJztcbmltcG9ydCB7IEJ1cyB9IGZyb20gJy4vYnVzL2J1cy1zdGFjayc7XG5pbXBvcnQgeyBCb3Rtb24gfSBmcm9tICcuL2JvdG1vbi9ib3Rtb24tc3RhY2snO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJTdHJlYW1zUGxhdGZvcm1TdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKipcbiAgICogVGhlIGVudmlyb25tZW50IGZvciB0aGUgZGVwbG95bWVudCAoZGV2LCBzdGFnaW5nLCBwcm9kLCBldGMuKVxuICAgKiBTaG91bGQgYmUgcGFzc2VkIHZpYSBjb250ZXh0IGAtYyBlbnZpcm9ubWVudD1kZXZgIG9yIGRlZmluZWQgaW4gY2RrLmpzb25cbiAgICogQGRlZmF1bHQgJ2RldidcbiAgICovXG4gIGVudmlyb25tZW50TmFtZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCdXNQcm9wcyB7XG4gIGVudmlyb25tZW50TmFtZTogc3RyaW5nO1xuICB0cnVzdGVkQXJucz86IHN0cmluZ1tdO1xuICBxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25zPzogc3RyaW5nW107XG4gIHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nPzogc3RyaW5nO1xuICBsYW1iZGFJbnZva2VQb2xpY3k/OiBzdHJpbmc7XG4gIGtpbmVzaXNTaGFyZHM/OiBudW1iZXI7XG4gIGxhbWJkYU1lbW9yeT86IHtcbiAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGZpcmVob3NlU3RyZWFtUHJvY2Vzc29yPzogbnVtYmVyO1xuICAgIGNyb25Qcm9jZXNzb3I/OiBudW1iZXI7XG4gICAgZXZlbnRUcmlnZ2VyPzogbnVtYmVyO1xuICAgIG1vbml0b3I/OiBudW1iZXI7XG4gIH07XG4gIHN0cmVhbVRUTFNlY29uZHM/OiBudW1iZXI7XG4gIG1vbml0b3JTaGFyZEhhc2hLZXk/OiBudW1iZXI7XG4gIGV4cG9ydE5hbWVQcmVmaXg/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBSU3RyZWFtc1BsYXRmb3JtU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJTdHJlYW1zUGxhdGZvcm1TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBTZXQgdXAgdGhlIGVudmlyb25tZW50IGNvbnRleHQgZnJvbSBDREsgY29udGV4dCBvciBwcm9wc1xuICAgIGNvbnN0IGVudmlyb25tZW50TmFtZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8IHByb3BzPy5lbnZpcm9ubWVudE5hbWUgfHwgJ2Rldic7XG5cbiAgICAvLyBSZW1vdmUgUmVnaW9uIE1hcHBpbmdcbiAgICAvLyBjb25zdCBjZm5NYXBwaW5nID0gbmV3IGNkay5DZm5NYXBwaW5nKHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtTWFwcGluZ3NSZWdpb25NYXBBNkIyMkFBRicsIHsgLi4uIH0pO1xuXG4gICAgLy8gSW5zdGFudGlhdGUgbmV3IEF1dGggY29uc3RydWN0XG4gICAgY29uc3QgYXV0aCA9IG5ldyBBdXRoKHRoaXMsICdBdXRoJywge1xuICAgICAgZW52aXJvbm1lbnROYW1lOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdHJ1c3RlZCBBV1MgcHJpbmNpcGFscyBmb3IgY3Jvc3MtYWNjb3VudCBhY2Nlc3NcbiAgICBjb25zdCB0cnVzdGVkQXJucyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCd0cnVzdGVkQVdTUHJpbmNpcGxlcycpID8gXG4gICAgICB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgndHJ1c3RlZEFXU1ByaW5jaXBsZXMnKS5zcGxpdCgnLCcpIDogXG4gICAgICB1bmRlZmluZWQ7XG5cbiAgICAvLyBHZXQgcXVldWUgcmVwbGljYXRpb24gZGVzdGluYXRpb25zIGZvciBjcm9zcy1hY2NvdW50IHJlcGxpY2F0aW9uXG4gICAgY29uc3QgcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcycpID9cbiAgICAgIHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdxdWV1ZVJlcGxpY2F0aW9uRGVzdGluYXRpb25MZW9Cb3RSb2xlQVJOcycpLnNwbGl0KCcsJykgOlxuICAgICAgdW5kZWZpbmVkO1xuXG4gICAgLy8gR2V0IHF1ZXVlIHJlcGxpY2F0aW9uIG1hcHBpbmcgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3F1ZXVlUmVwbGljYXRpb25NYXBwaW5nJykgfHwgJ1tdJztcblxuICAgIC8vIEluc3RhbnRpYXRlIG5ldyBCdXMgY29uc3RydWN0IHdpdGggYWxsIHBhcmFtZXRlcnMgZnJvbSBvcmlnaW5hbCBDbG91ZEZvcm1hdGlvblxuICAgIGNvbnN0IGJ1cyA9IG5ldyBCdXModGhpcywgJ0J1cycsIHtcbiAgICAgIGVudmlyb25tZW50TmFtZTogZW52aXJvbm1lbnROYW1lLFxuICAgICAgdHJ1c3RlZEFybnM6IHRydXN0ZWRBcm5zLFxuICAgICAgcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9uczogcXVldWVSZXBsaWNhdGlvbkRlc3RpbmF0aW9ucyxcbiAgICAgIHF1ZXVlUmVwbGljYXRpb25NYXBwaW5nOiBxdWV1ZVJlcGxpY2F0aW9uTWFwcGluZyxcbiAgICAgIGxhbWJkYU1lbW9yeToge1xuICAgICAgICBraW5lc2lzU3RyZWFtUHJvY2Vzc29yOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgna2luZXNpc1N0cmVhbVByb2Nlc3Nvck1lbW9yeScpIHx8IDY0MCxcbiAgICAgICAgZmlyZWhvc2VTdHJlYW1Qcm9jZXNzb3I6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdmaXJlaG9zZVN0cmVhbVByb2Nlc3Nvck1lbW9yeScpIHx8IDY0MCxcbiAgICAgICAgY3JvblByb2Nlc3NvcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2Nyb25Qcm9jZXNzb3JNZW1vcnknKSB8fCAyNTYsXG4gICAgICAgIGV2ZW50VHJpZ2dlcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2V2ZW50VHJpZ2dlck1lbW9yeScpIHx8IDEyOCxcbiAgICAgICAgbW9uaXRvcjogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2xlb01vbml0b3JNZW1vcnknKSB8fCAyNTZcbiAgICAgIH0sXG4gICAgICBleHBvcnROYW1lUHJlZml4OiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIGxhbWJkYUludm9rZVBvbGljeTogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2xhbWJkYUludm9rZVBvbGljeScpLFxuICAgICAga2luZXNpc1NoYXJkczogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2tpbmVzaXNTaGFyZHMnKSB8fCAxLFxuICAgICAgc3RyZWFtVFRMU2Vjb25kczogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3N0cmVhbVRUTFNlY29uZHMnKSB8fCA2MDQ4MDAsXG4gICAgICBtb25pdG9yU2hhcmRIYXNoS2V5OiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbW9uaXRvclNoYXJkSGFzaEtleScpIHx8IDBcbiAgICB9KTtcblxuICAgIC8vIFJlbW92ZSBvbGQgQ29nbml0byBjb25kaXRpb24gYW5kIHN0YWNrXG4gICAgLy8gY29uc3QgY29uZGl0aW9uUmVzb3VyY2UgPSBuZXcgY2RrLkNmbkNvbmRpdGlvbih0aGlzLCAnUlN0cmVhbXNQbGF0Zm9ybUNvbmRpdGlvbnNjcmVhdGVDb2duaXRvMzIyRDZDNkUnLCB7IC4uLiB9KTtcbiAgICAvLyBjb25zdCBjb2duaXRvU3RhY2sgPSBuZXcgQ29nbml0b1N0YWNrKHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtQ29nbml0bzc4MDcyOUVDJyk7XG5cbiAgICAvLyBHZXQgY3VzdG9tIEpTIGFuZCBsb2dpbnMgZm9yIEJvdG1vbiBVSSBjdXN0b21pemF0aW9uXG4gICAgY29uc3QgY3VzdG9tSnMgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnY3VzdG9tSnMnKTtcbiAgICBjb25zdCBsb2dpbnMgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbG9naW5zJyk7XG5cbiAgICAvLyBHZXQgZXhpc3RpbmcgQ29nbml0byBJRCBpZiBwcm92aWRlZFxuICAgIGNvbnN0IGlucHV0Q29nbml0b0lkID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2lucHV0Q29nbml0b0lkJyk7XG4gICAgY29uc3QgY3JlYXRlQ29nbml0byA9ICFpbnB1dENvZ25pdG9JZDtcblxuICAgIC8vIEluc3RhbnRpYXRlIG5ldyBCb3Rtb24gY29uc3RydWN0IHdpdGggQ29nbml0byBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgYm90bW9uID0gbmV3IEJvdG1vbih0aGlzLCAnQm90bW9uJywge1xuICAgICAgZW52aXJvbm1lbnROYW1lOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgICBidXM6IGJ1cyxcbiAgICAgIGF1dGg6IGF1dGgsXG4gICAgICBjdXN0b21KczogY3VzdG9tSnMsXG4gICAgICBsb2dpbnM6IGxvZ2lucyxcbiAgICAgIGNyZWF0ZUNvZ25pdG86IGNyZWF0ZUNvZ25pdG8sXG4gICAgICBleGlzdGluZ0NvZ25pdG9JZDogaW5wdXRDb2duaXRvSWRcbiAgICB9KTtcblxuICAgIC8vIFJlbW92ZSBkZXBlbmRlbmNpZXMgb24gb2xkIG5lc3RlZCBzdGFja3NcbiAgICAvLyBib3Rtb25TdGFjay5uZXN0ZWRTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjay5uZXN0ZWRTdGFjayk7XG4gICAgLy8gYm90bW9uU3RhY2submVzdGVkU3RhY2suYWRkRGVwZW5kZW5jeShidXNTdGFjay5uZXN0ZWRTdGFjayk7XG4gICAgLy8gYm90bW9uU3RhY2submVzdGVkU3RhY2suYWRkRGVwZW5kZW5jeShjb2duaXRvU3RhY2submVzdGVkU3RhY2spO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBTU00gcGFyYW1ldGVyIHVzaW5nIG91dHB1dCBmcm9tIEJ1cyBjb25zdHJ1Y3RcbiAgICBjb25zdCByc2ZQYXJhbWV0ZXIgPSBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnUlN0cmVhbXNQbGF0Zm9ybVJTRlBhcmFtZXRlcicsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgc3RyaW5nVmFsdWU6IGJ1cy5idXNTdGFja05hbWVPdXRwdXQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JTdHJlYW1zIEJ1cyBTdGFjayBSZWZlcmVuY2UgTmFtZSdcbiAgICB9KTtcblxuICAgIC8vIFJlbW92ZSBvbGQgTGVvIFRlbXBsYXRlIG91dHB1dFxuICAgIC8vIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSU3RyZWFtc1BsYXRmb3JtT3V0cHV0c0xlb1RlbXBsYXRlRDNFMTMyQ0MnLCB7IC4uLiB9KTtcblxuICAgIC8vIENsb3VkRnJvbnQgVVJMIGZvciBCb3Rtb24gVUkgYWNjZXNzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JvdG1vblVSTCcsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQm90bW9uIFVJIFVSTCcsXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtib3Rtb24uY2xvdWRmcm9udERpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWBcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBcGlSb2xlIGZvciBMYW1iZGEgZnVuY3Rpb24gaW52b2NhdGlvblxuICAgIGNvbnN0IGFwaVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0FwaVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG5ldyBpYW0uQWNjb3VudFByaW5jaXBhbCh0aGlzLmFjY291bnQpXG4gICAgICApLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICBdXG4gICAgfSk7XG5cbiAgICBhcGlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkFkZFBlcm1pc3Npb24nXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICBhcGlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJ10sXG4gICAgICByZXNvdXJjZXM6IFtjZGsuRm4uc3ViKCdhcm46YXdzOmxhbWJkYToke0FXUzo6UmVnaW9ufToke0FXUzo6QWNjb3VudElkfTpmdW5jdGlvbjoke0FXUzo6U3RhY2tOYW1lfS0qJyldXG4gICAgfSkpO1xuICB9XG59XG4iXX0=