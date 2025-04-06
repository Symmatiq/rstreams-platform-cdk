"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStack = void 0;
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
/**
 * Creates the Auth nested stack for RStreams
 */
class AuthStack extends constructs_1.Construct {
    constructor(scope, id) {
        super(scope, id);
        // Create the nested stack using the CloudFormation template URL
        this.nestedStack = new cdk.CfnStack(this, 'AuthNestedStack', {
            templateUrl: cdk.Fn.findInMap('RStreamsPlatformMappingsRegionMapA6B22AAF', cdk.Aws.REGION, 'AuthTemplateUrl'),
            timeoutInMinutes: 60
        });
    }
    /**
     * Get the Auth stack name for reference in other stacks
     */
    getAuthStackName() {
        return cdk.Fn.select(1, cdk.Fn.split('/', this.nestedStack.ref));
    }
}
exports.AuthStack = AuthStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUF1QztBQUd2Qzs7R0FFRztBQUNILE1BQWEsU0FBVSxTQUFRLHNCQUFTO0lBR3RDLFlBQVksS0FBZ0IsRUFBRSxFQUFVO1FBQ3RDLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsZ0VBQWdFO1FBQ2hFLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUMzRCxXQUFXLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQzNCLDJDQUEyQyxFQUMzQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFDZCxpQkFBaUIsQ0FDbEI7WUFDRCxnQkFBZ0IsRUFBRSxFQUFFO1NBQ3JCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNJLGdCQUFnQjtRQUNyQixPQUFPLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQ25FLENBQUM7Q0FDRjtBQXZCRCw4QkF1QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBnZXRUZW1wbGF0ZVVybCB9IGZyb20gJy4uL2hlbHBlcnMvbWFwcGluZ3MnO1xuXG4vKipcbiAqIENyZWF0ZXMgdGhlIEF1dGggbmVzdGVkIHN0YWNrIGZvciBSU3RyZWFtc1xuICovXG5leHBvcnQgY2xhc3MgQXV0aFN0YWNrIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IG5lc3RlZFN0YWNrOiBjZGsuQ2ZuU3RhY2s7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIG5lc3RlZCBzdGFjayB1c2luZyB0aGUgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgVVJMXG4gICAgdGhpcy5uZXN0ZWRTdGFjayA9IG5ldyBjZGsuQ2ZuU3RhY2sodGhpcywgJ0F1dGhOZXN0ZWRTdGFjaycsIHtcbiAgICAgIHRlbXBsYXRlVXJsOiBjZGsuRm4uZmluZEluTWFwKFxuICAgICAgICAnUlN0cmVhbXNQbGF0Zm9ybU1hcHBpbmdzUmVnaW9uTWFwQTZCMjJBQUYnLFxuICAgICAgICBjZGsuQXdzLlJFR0lPTixcbiAgICAgICAgJ0F1dGhUZW1wbGF0ZVVybCdcbiAgICAgICksXG4gICAgICB0aW1lb3V0SW5NaW51dGVzOiA2MFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgQXV0aCBzdGFjayBuYW1lIGZvciByZWZlcmVuY2UgaW4gb3RoZXIgc3RhY2tzXG4gICAqL1xuICBwdWJsaWMgZ2V0QXV0aFN0YWNrTmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBjZGsuRm4uc2VsZWN0KDEsIGNkay5Gbi5zcGxpdCgnLycsIHRoaXMubmVzdGVkU3RhY2sucmVmKSk7XG4gIH1cbn1cbiJdfQ==