"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRole = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const iam = require("aws-cdk-lib/aws-iam");
/**
 * Creates the API Role used by the RStreams platform
 */
class ApiRole extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        this.role = new iam.Role(this, 'Role', {
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('lambda.amazonaws.com'), new iam.AccountRootPrincipal()),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        // Add custom policy for lambda permissions
        this.role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['lambda:AddPermission'],
            resources: ['*']
        }));
        // Add custom policy for lambda invocation
        this.role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['lambda:InvokeFunction'],
            resources: [
                cdk.Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-*', {
                    'AWS::StackName': props.stackName
                })
            ]
        }));
    }
}
exports.ApiRole = ApiRole;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcGktcm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsMkNBQXVDO0FBQ3ZDLDJDQUEyQztBQU0zQzs7R0FFRztBQUNILE1BQWEsT0FBUSxTQUFRLHNCQUFTO0lBR3BDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUI7UUFDM0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFO1lBQ3JDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxrQkFBa0IsQ0FDbkMsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUMsRUFDaEQsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUUsQ0FDL0I7WUFDRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQywwQ0FBMEMsQ0FBQzthQUN2RjtTQUNGLENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDNUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUUsQ0FBQyxzQkFBc0IsQ0FBQztZQUNqQyxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSiwwQ0FBMEM7UUFDMUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzVDLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFLENBQUMsdUJBQXVCLENBQUM7WUFDbEMsU0FBUyxFQUFFO2dCQUNULEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLDhFQUE4RSxFQUFFO29CQUN6RixnQkFBZ0IsRUFBRSxLQUFLLENBQUMsU0FBUztpQkFDbEMsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDLENBQUM7SUFDTixDQUFDO0NBQ0Y7QUFsQ0QsMEJBa0NDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFwaVJvbGVQcm9wcyB7XG4gIHN0YWNrTmFtZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIEFQSSBSb2xlIHVzZWQgYnkgdGhlIFJTdHJlYW1zIHBsYXRmb3JtXG4gKi9cbmV4cG9ydCBjbGFzcyBBcGlSb2xlIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBcGlSb2xlUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5yb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKClcbiAgICAgICksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcbiAgICAgIF1cbiAgICB9KTtcblxuICAgIC8vIEFkZCBjdXN0b20gcG9saWN5IGZvciBsYW1iZGEgcGVybWlzc2lvbnNcbiAgICB0aGlzLnJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydsYW1iZGE6QWRkUGVybWlzc2lvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBjdXN0b20gcG9saWN5IGZvciBsYW1iZGEgaW52b2NhdGlvblxuICAgIHRoaXMucm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGNkay5Gbi5zdWIoJ2Fybjphd3M6bGFtYmRhOiR7QVdTOjpSZWdpb259OiR7QVdTOjpBY2NvdW50SWR9OmZ1bmN0aW9uOiR7QVdTOjpTdGFja05hbWV9LSonLCB7XG4gICAgICAgICAgJ0FXUzo6U3RhY2tOYW1lJzogcHJvcHMuc3RhY2tOYW1lXG4gICAgICAgIH0pXG4gICAgICBdXG4gICAgfSkpO1xuICB9XG59XG4iXX0=