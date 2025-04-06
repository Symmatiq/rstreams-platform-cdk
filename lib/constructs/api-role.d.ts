import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
export interface ApiRoleProps {
    stackName: string;
}
/**
 * Creates the API Role used by the RStreams platform
 */
export declare class ApiRole extends Construct {
    readonly role: iam.Role;
    constructor(scope: Construct, id: string, props: ApiRoleProps);
}
