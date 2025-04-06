import { Construct } from 'constructs';
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { IRole, ManagedPolicy } from "aws-cdk-lib/aws-iam";
export interface AuthProps {
    /**
     * The deployment environment name (e.g., dev, staging, prod)
     */
    environmentName: string;
    secretArn?: string;
}
export declare class Auth extends Construct {
    readonly leoAuthTable: ITable;
    readonly leoAuthUserTable: ITable;
    readonly leoAuthPolicyTable: ITable;
    readonly leoAuthIdentityTable: ITable;
    readonly leoAuthManagedPolicy: ManagedPolicy;
    readonly authorizeLambdaRole: IRole;
    constructor(scope: Construct, id: string, props: AuthProps);
}
