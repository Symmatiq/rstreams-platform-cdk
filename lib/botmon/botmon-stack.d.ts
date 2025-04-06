import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Bus } from '../bus/bus-stack';
import { Auth } from '../auth/auth-stack';
export interface BotmonProps {
    /**
     * The deployment environment name (e.g., dev, staging, prod)
     */
    environmentName: string;
    /**
     * Reference to the deployed Bus construct
     */
    bus: Bus;
    /**
     * Reference to the deployed Auth construct
     */
    auth: Auth;
    /**
     * Custom JavaScript file path/URL for UI customization (from context/params)
     */
    customJs?: string;
    /**
     * Custom Logins string (from context/params)
     */
    logins?: string;
    /**
     * Whether to create a new Cognito identity pool (true) or use an existing one (false)
     */
    createCognito?: boolean;
    /**
     * ID of existing Cognito identity pool to use if createCognito is false
     */
    existingCognitoId?: string;
}
export declare class Botmon extends Construct {
    readonly identityPool: cognito.CfnIdentityPool;
    readonly cloudfrontDistribution: cloudfront.Distribution;
    readonly restApi: apigateway.RestApi;
    readonly uiBucket: s3.Bucket;
    private readonly leoStatsTable;
    readonly healthCheckTopic: sns.ITopic;
    readonly leoBotmonSnsRole: iam.IRole;
    private readonly props;
    constructor(scope: Construct, id: string, props: BotmonProps);
}
