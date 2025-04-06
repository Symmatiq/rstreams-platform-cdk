/**
 * Region mappings for RStreams platform resources
 */
export declare const RegionMap: {
    'us-west-2': {
        S3Bucket: string;
        AuthTemplateUrl: string;
        BusTemplateUrl: string;
        BotmonTemplateUrl: string;
        CognitoTemplateUrl: string;
    };
    'us-east-1': {
        S3Bucket: string;
        AuthTemplateUrl: string;
        BusTemplateUrl: string;
        BotmonTemplateUrl: string;
        CognitoTemplateUrl: string;
    };
};
/**
 * Get template URL based on region and template type
 */
export declare function getTemplateUrl(region: string, templateType: 'Auth' | 'Bus' | 'Botmon' | 'Cognito'): string;
