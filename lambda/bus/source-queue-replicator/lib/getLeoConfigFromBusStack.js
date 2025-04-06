'use strict';

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import leoLogger from 'leo-logger';
const logger = leoLogger.sub("getLeoConfigFromBusStack");

export default async function (leoBusStackName, credentials) {
  const cloudformation = new CloudFormationClient({ credentials });

  const params = { StackName: leoBusStackName };
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
}; 