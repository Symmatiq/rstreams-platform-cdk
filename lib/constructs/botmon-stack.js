"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotmonStack = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
/**
 * Creates the Botmon nested stack for RStreams
 */
class BotmonStack extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        // Create the nested stack using the CloudFormation template URL
        this.nestedStack = new cdk.CfnStack(this, 'BotmonNestedStack', {
            templateUrl: cdk.Fn.findInMap('RStreamsPlatformMappingsRegionMapA6B22AAF', cdk.Aws.REGION, 'BotmonTemplateUrl'),
            parameters: {
                // Handle the ICfnRuleConditionExpression by forcing a string type
                CognitoId: '' + props.cognitoIdExpression,
                Logins: props.logins,
                CustomJS: props.customJs,
                leoauth: props.authStackName,
                leosdk: props.busStackName
            },
            timeoutInMinutes: 60
        });
    }
}
exports.BotmonStack = BotmonStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm90bW9uLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm90bW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFZdkM7O0dBRUc7QUFDSCxNQUFhLFdBQVksU0FBUSxzQkFBUztJQUd4QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXVCO1FBQy9ELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsZ0VBQWdFO1FBQ2hFLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUM3RCxXQUFXLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQzNCLDJDQUEyQyxFQUMzQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFDZCxtQkFBbUIsQ0FDcEI7WUFDRCxVQUFVLEVBQUU7Z0JBQ1Ysa0VBQWtFO2dCQUNsRSxTQUFTLEVBQUUsRUFBRSxHQUFJLEtBQUssQ0FBQyxtQkFBMkI7Z0JBQ2xELE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtnQkFDcEIsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO2dCQUN4QixPQUFPLEVBQUUsS0FBSyxDQUFDLGFBQWE7Z0JBQzVCLE1BQU0sRUFBRSxLQUFLLENBQUMsWUFBWTthQUMzQjtZQUNELGdCQUFnQixFQUFFLEVBQUU7U0FDckIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBeEJELGtDQXdCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IGdldFRlbXBsYXRlVXJsIH0gZnJvbSAnLi4vaGVscGVycy9tYXBwaW5ncyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQm90bW9uU3RhY2tQcm9wcyB7XG4gIGNvZ25pdG9JZEV4cHJlc3Npb246IGNkay5JQ2ZuUnVsZUNvbmRpdGlvbkV4cHJlc3Npb247XG4gIGxvZ2luczogc3RyaW5nO1xuICBjdXN0b21Kczogc3RyaW5nO1xuICBhdXRoU3RhY2tOYW1lOiBzdHJpbmc7XG4gIGJ1c1N0YWNrTmFtZTogc3RyaW5nO1xuICBjcmVhdGVDb2duaXRvQ29uZGl0aW9uOiBjZGsuQ2ZuQ29uZGl0aW9uO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIEJvdG1vbiBuZXN0ZWQgc3RhY2sgZm9yIFJTdHJlYW1zXG4gKi9cbmV4cG9ydCBjbGFzcyBCb3Rtb25TdGFjayBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBuZXN0ZWRTdGFjazogY2RrLkNmblN0YWNrO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBCb3Rtb25TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIC8vIENyZWF0ZSB0aGUgbmVzdGVkIHN0YWNrIHVzaW5nIHRoZSBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSBVUkxcbiAgICB0aGlzLm5lc3RlZFN0YWNrID0gbmV3IGNkay5DZm5TdGFjayh0aGlzLCAnQm90bW9uTmVzdGVkU3RhY2snLCB7XG4gICAgICB0ZW1wbGF0ZVVybDogY2RrLkZuLmZpbmRJbk1hcChcbiAgICAgICAgJ1JTdHJlYW1zUGxhdGZvcm1NYXBwaW5nc1JlZ2lvbk1hcEE2QjIyQUFGJyxcbiAgICAgICAgY2RrLkF3cy5SRUdJT04sXG4gICAgICAgICdCb3Rtb25UZW1wbGF0ZVVybCdcbiAgICAgICksXG4gICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgIC8vIEhhbmRsZSB0aGUgSUNmblJ1bGVDb25kaXRpb25FeHByZXNzaW9uIGJ5IGZvcmNpbmcgYSBzdHJpbmcgdHlwZVxuICAgICAgICBDb2duaXRvSWQ6ICcnICsgKHByb3BzLmNvZ25pdG9JZEV4cHJlc3Npb24gYXMgYW55KSwgLy8gRm9yY2Ugc3RyaW5nIGNvbnZlcnNpb25cbiAgICAgICAgTG9naW5zOiBwcm9wcy5sb2dpbnMsXG4gICAgICAgIEN1c3RvbUpTOiBwcm9wcy5jdXN0b21KcyxcbiAgICAgICAgbGVvYXV0aDogcHJvcHMuYXV0aFN0YWNrTmFtZSxcbiAgICAgICAgbGVvc2RrOiBwcm9wcy5idXNTdGFja05hbWVcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0SW5NaW51dGVzOiA2MFxuICAgIH0pO1xuICB9XG59XG4iXX0=