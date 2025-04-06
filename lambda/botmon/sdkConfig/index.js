'use strict';

import { CloudFormationClient, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import request from "leo-sdk/auth/request";
import config from "leo-sdk/leoConfigure";
import "moment-round";
import { handler as resourceHandler } from "leo-sdk/wrappers/resource";

export const handler = resourceHandler(async (event, context, callback) => {
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::accessConfig',
    action: "get",
    botmon: {}
  });

  const cloudformation = new CloudFormationClient({
    region: config._meta.region
  });

  try {
    const data = await cloudformation.send(new ListStackResourcesCommand({
      StackName: config.stacks && config.stacks.Leo || "Leo"
    }));

    if (data.NextToken) {
      console.log("We need to deal with next token");
    }

    const resources = data.StackResourceSummaries.reduce((acc, resource) => {
      acc[resource.LogicalResourceId] = {
        type: resource.ResourceType,
        id: resource.PhysicalResourceId,
        name: resource.LogicalResourceId
      };
      return acc;
    }, {});

    callback(null, {
      kinesis: resources.KinesisStream.id,
      s3: resources.S3Bus.id,
      firehose: resources.FirehoseStream.id,
      region: config.aws.region
    });
  } catch (err) {
    callback(err);
  }
});
