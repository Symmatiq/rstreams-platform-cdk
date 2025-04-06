/**
 * Region mappings for RStreams platform resources
 */
export const RegionMap = {
  'us-west-2': {
    S3Bucket: 'leo-cli-publishbucket-mzhr7agmqo7u',
    AuthTemplateUrl: 'https://leo-cli-publishbucket-mzhr7agmqo7u.s3-us-west-2.amazonaws.com/auth/2.0.0/cloudformation-auth-1652216325999.json',
    BusTemplateUrl: 'https://leo-cli-publishbucket-mzhr7agmqo7u.s3-us-west-2.amazonaws.com/leo-bus/3.2.0/cloudformation-1669137956326.json',
    BotmonTemplateUrl: 'https://leo-cli-publishbucket-mzhr7agmqo7u.s3-us-west-2.amazonaws.com/botmon/3.0.2/cloudformation-1667947716066.json',
    CognitoTemplateUrl: 'https://leo-cli-publishbucket-mzhr7agmqo7u.s3-us-west-2.amazonaws.com/leo-Cognito/cloudformation-latest.json'
  },
  'us-east-1': {
    S3Bucket: 'leo-cli-publishbucket-abb4i613j9y9',
    AuthTemplateUrl: 'https://leo-cli-publishbucket-abb4i613j9y9.s3.amazonaws.com/auth/2.0.0/cloudformation-auth-1652216325999.json',
    BusTemplateUrl: 'https://leo-cli-publishbucket-abb4i613j9y9.s3.amazonaws.com/leo-bus/3.2.0/cloudformation-1669137956326.json',
    BotmonTemplateUrl: 'https://leo-cli-publishbucket-abb4i613j9y9.s3.amazonaws.com/botmon/3.0.2/cloudformation-1667947716066.json',
    CognitoTemplateUrl: 'https://leo-cli-publishbucket-abb4i613j9y9.s3.amazonaws.com/leo-Cognito/cloudformation-latest.json'
  }
};

/**
 * Get template URL based on region and template type
 */
export function getTemplateUrl(region: string, templateType: 'Auth' | 'Bus' | 'Botmon' | 'Cognito'): string {
  const regionData = RegionMap[region as keyof typeof RegionMap];
  if (!regionData) {
    throw new Error(`Region ${region} not supported in mappings`);
  }
  
  const urlKey = `${templateType}TemplateUrl` as keyof typeof regionData;
  return regionData[urlKey];
}
