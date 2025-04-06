'use strict';

import { SNSClient, ListTopicsCommand, ListSubscriptionsByTopicCommand, GetTopicAttributesCommand, CreateTopicCommand, SubscribeCommand, UnsubscribeCommand } from "@aws-sdk/client-sns";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import request from "leo-auth";
import leo from "leo-sdk";
import async from "async";
import configure from "leo-sdk/lib/configuration";
import logger from "leo-logger";

const dynamodb = new DynamoDBClient({ region: configure.aws.region });
const sns = new SNSClient({ region: configure.aws.region });
const SETTINGS_TABLE = configure.resources.LeoSettings;

let handlers = {
  "GET": doGet,
  "POST": doPost,
  default: (e, c, callback) => callback("Unsupported")
};

export const handler = leo.wrap(async (event, context, callback) => {
  (handlers[event.requestContext.httpMethod] || handlers.default)(event, context, callback);
});

async function doGet(event, context, callback) {
  await request.authorize(event, {
    lrn: `lrn:leo:botmon:::sns_topics`,
    action: `get`,
    botmon: {}
  });

  let params = {
    NextToken: null
  };

  let finalData = {};
  let subs = {};
  let topicAttributes = {};
  let tasks = [];
  let healthTable = null;

  try {
    const data = await sns.send(new ListTopicsCommand(params));
    let topics = data.Topics;
    if (topics.length !== 0) {
      for (let topic of topics) {
        tasks.push(async done => {
          try {
            const params2 = {
              NextToken: null,
              TopicArn: topic.TopicArn
            };
            const data = await sns.send(new ListSubscriptionsByTopicCommand(params2));
            subs[topic.TopicArn] = data.Subscriptions;
            done();
          } catch (err) {
            done(err);
          }
        });

        tasks.push(async done => {
          try {
            const params2 = {
              TopicArn: topic.TopicArn
            };
            const data = await sns.send(new GetTopicAttributesCommand(params2));
            topicAttributes[topic.TopicArn] = { displayName: data.Attributes.DisplayName, owner: data.Attributes.Owner };
            done();
          } catch (err) {
            done(err);
          }
        });
      }
    }

    tasks.push(async done => {
      try {
        const id = 'healthSNS_data';
        const params = {
          TableName: SETTINGS_TABLE,
          Key: { id: { S: id } }
        };
        const data = await dynamodb.send(new GetItemCommand(params));
        healthTable = data.Item ? data.Item.value.S : {};
        done();
      } catch (err) {
        done(err);
      }
    });

    await Promise.all(tasks);
    finalData["subs"] = subs;
    finalData["topicAttributes"] = topicAttributes;
    finalData["tags"] = healthTable;
    callback(null, finalData);

  } catch (err) {
    callback(err);
  }
}

async function doPost(event, context, callback) {
  let createId = process.env.StackName + '-' + event.params.path.id;
  let id = event.params.path.id;

  if (event.params.path.type === 'topic') {
    await request.authorize(event, {
      lrn: `lrn:leo:botmon:::sns_topic/{id}`,
      action: `create`,
      botmon: {
        "id": createId
      }
    });

    try {
      const data = await sns.send(new CreateTopicCommand({ Name: createId }));
      callback(null, data);
    } catch (err) {
      callback(err);
    }

  } else if (event.params.path.type === 'subscription') {
    let subscribe = event.body && event.body.subscribe;
    if (subscribe === true) {
      let protocol = event.body && event.body.protocol;
      let endpoint = event.body && event.body.endpoint;

      await request.authorize(event, {
        lrn: `lrn:leo:botmon:::sns_subscription/{topic}`,
        action: `subscribe`,
        botmon: {
          "topic": id,
          "protocol": protocol,
          "endpoint": endpoint
        }
      });

      try {
        const data = await sns.send(new SubscribeCommand({
          Endpoint: endpoint,
          Protocol: protocol,
          TopicArn: id
        }));
        callback(null, data);
      } catch (err) {
        callback(err);
      }

    } else {
      let unSub = event.body && event.body.unSub;

      await request.authorize(event, {
        lrn: `lrn:leo:botmon:::sns_subscription/{subscription}`,
        action: `unsubscribe`,
        botmon: {
          "subscription": unSub,
        }
      });

      try {
        const data = await sns.send(new UnsubscribeCommand({ SubscriptionArn: unSub }));
        callback(null, data);
      } catch (err) {
        callback(err);
      }
    }

  } else if (event.params.path.type === 'tags') {
    let body = event.body;

    await request.authorize(event, {
      lrn: `lrn:leo:botmon:::sns_subscription/{tags}`,
      action: `update`,
      botmon: {
        "tags": body,
      }
    });

    if (body.delete) {
      Object.keys(body.tags).forEach(tag => {
        if (body.tags[tag].includes(id) && !body.tagsToKeep.includes(tag)) {
          body.tags[tag] = body.tags[tag].filter(t => t !== id);
        }
      });

      delete body.delete;
      delete body.tagsToKeep;

      if ('' in body.tags) {
        delete body.tags[''];
      }

      leo.aws.dynamodb.saveSetting("healthSNS_data", {
        lastSNS: body.lastSNS,
        botIds: body.botIds,
        tags: body.tags
      }, function (err) {
        callback(err, body.tags);
      });

    } else if (!body.delete) {
      if (body.addedTag in body.tags) {
        body.tags[body.addedTag].push(id);
      } else {
        body.tags[body.addedTag] = [id];
      }

      delete body.delete;
      delete body.tagsToKeep;

      if ('' in body.tags) {
        delete body.tags[''];
      }

      leo.aws.dynamodb.saveSetting("healthSNS_data", {
        lastSNS: body.lastSNS,
        botIds: body.botIds,
        tags: body.tags
      }, function (err) {
        callback(err, body.tags);
      });

    } else {
      callback("Unsupported");
    }

  } else {
    callback("Unsupported");
  }
}
