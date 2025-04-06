'use strict';

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { read, streams as ls } from 'leo-sdk';
import getLeoConfigFromBusStack from './lib/getLeoConfigFromBusStack';
import leoLogger from 'leo-logger';
const logger = leoLogger.sub("source-queue-replicator");
import { handler as cronHandler } from "leo-sdk/wrappers/cron";

export const handler = cronHandler(async (event, context) => {
  logger.info("SourceRepEvent", JSON.stringify(event, null, 2));
  const stsClient = new STSClient({ region: "us-east-1" });

  const params = {
    DurationSeconds: 900,
    RoleArn: event.destinationLeoBotRoleArn,
    RoleSessionName: "SourceQueueReplicator"
  };

  try {
    const data = await stsClient.send(new AssumeRoleCommand(params));
    logger.info("Got AssumedRole data");
    const tempCredentials = STSClient.credentialsFrom(data); // Assuming you have a method to extract credentials

    const destinationConfig = await getLeoConfigFromBusStack(event.destinationBusStack, tempCredentials);
    logger.info("Got Stack Description");

    const { load } = require('leo-sdk')(destinationConfig);
    const stats = ls.stats(event.botId, event.sourceQueue);

    await new Promise((resolve, reject) => {
      ls.pipe(
        read(event.botId, event.sourceQueue),
        stats,
        load(event.botId, event.destinationQueue),
        (err) => {
          if (err) return reject(err);
          stats.checkpoint((err) => {
            if (err) return reject(err);
            resolve();
          });
        }
      );
    });

  } catch (err) {
    logger.error("Error occurred:", err);
    throw err;
  }
});
