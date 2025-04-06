'use strict';
import { S3Client, GetBucketNotificationConfigurationCommand, PutBucketNotificationConfigurationCommand } from "@aws-sdk/client-s3";
import { LambdaClient, AddPermissionCommand } from "@aws-sdk/client-lambda";
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand } from "@aws-sdk/client-iam";
import logger from "leo-logger";

export default async function() {
  const leo = {
    resources: JSON.parse(process.env.Resources),
    aws: JSON.parse(process.env.AWS)
  };

  const s3Client = new S3Client({ region: leo.aws.region });
  const lambdaClient = new LambdaClient({ region: leo.aws.region });
  const iamClient = new IAMClient({ region: leo.aws.region });

  const functionName = leo.resources.LeoS3LoadTrigger;
  const bucket = leo.resources.LeoS3;
  const accountId = leo.aws.AccountId;

  try {
    await lambdaClient.send(new AddPermissionCommand({
      Action: "lambda:InvokeFunction",
      FunctionName: functionName,
      Principal: "s3.amazonaws.com",
      SourceAccount: accountId,
      SourceArn: `arn:aws:s3:::${bucket}`,
      StatementId: "S3-bus-events-upload-trigger"
    }));
  } catch (err) {
    if (!err.message.startsWith("The statement id (S3-bus-events-upload-trigger) provided already exists")) {
      throw err;
    }
  }

  try {
    const data = await s3Client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }));
    logger.info(data);
    const exists = data?.LambdaFunctionConfigurations?.some(c => c.Id === "bus-events-upload");

    if (!exists) {
      if(!data.LambdaFunctionConfigurations) data.LambdaFunctionConfigurations = [];
      data.LambdaFunctionConfigurations.push({
        Id: "bus-events-upload",
        Events: ["s3:ObjectCreated:*"],
        LambdaFunctionArn: `arn:aws:lambda:${leo.aws.region}:${accountId}:function:${functionName}`,
        Filter: {
          Key: {
            FilterRules: [{
              Name: "prefix",
              Value: "firehose/"
            }]
          }
        }
      });
      logger.info(JSON.stringify(data, null, 2));
      await s3Client.send(new PutBucketNotificationConfigurationCommand({
        Bucket: bucket,
        NotificationConfiguration: data
      }));
    }
  } catch (err) {
    logger.error(err);
    throw err;
  }

  const roleName = leo.resources.LeoFirehoseRole.replace(/arn:aws:iam::.*?:role\//, "");

  try {
    const policies = await iamClient.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
    logger.info("Policies", policies);
    const arn = leo.resources.LeoBotPolicy;

    if (!policies.AttachedPolicies.some(p => p.PolicyArn === arn)) {
      await iamClient.send(new AttachRolePolicyCommand({
        PolicyArn: arn,
        RoleName: roleName
      }));
    }
  } catch (err) {
    logger.error(err);
    throw err;
  }
}
