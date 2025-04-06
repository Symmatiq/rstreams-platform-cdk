'use strict';

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import leoLogger from 'leo-logger';
const logger = leoLogger.sub("getLeoConfigFromBusStack");

/**
 * Gets Leo SDK configuration from another Leo Bus stack
 * @param {string} stackName - Name of the stack to get resources from
 * @param {object} credentials - AWS credentials for cross-account access
 * @returns {object} Leo SDK configuration object
 */
export default async function getLeoConfigFromBusStack(stackName, credentials) {
  const cloudformation = new CloudFormationClient({ credentials });

  const params = { StackName: stackName };
  const descStackResult = await cloudformation.send(new DescribeStacksCommand(params));
  if (descStackResult.Stacks.length > 1) {
    logger.info(descStackResult.Stacks);
    throw new Error('Multiple stacks match criteria');
  }

  const stackOutputs = descStackResult.Stacks[0].Outputs.reduce((map, output) => {
    map[output.OutputKey] = output.OutputValue;
    return map;
  }, {});

  const leoStackConfiguration = {
    credentials,
    resources: {
      LeoCron: stackOutputs.LeoCron,
      LeoEvent: stackOutputs.LeoEvent,
      LeoFirehoseStream: stackOutputs.LeoFirehoseStream,
      LeoKinesisStream: stackOutputs.LeoKinesisStream,
      LeoS3: stackOutputs.LeoS3,
      LeoSettings: stackOutputs.LeoSettings,
      LeoStream: stackOutputs.LeoStream,
      LeoSystem: stackOutputs.LeoSystem
    },
    firehose: stackOutputs.LeoFirehoseStream,
    kinesis: stackOutputs.LeoKinesisStream,
    s3: stackOutputs.LeoS3
  };

  return leoStackConfiguration;
} 