'use strict';

import leo from "leo-sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import isSemver from 'is-semver';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const s3Client = new S3Client({ region: leo.configuration.resources.Region });
const dynamoDBClient = new DynamoDBClient({ region: leo.configuration.resources.Region });

export default async function(resource, data) {
  if (typeof data === "string") {
    data = JSON.parse(data);
  }
  data = fixTypes(data);

  const id = data.id ? data.id.replace(/^arn:aws:lambda:.*?:\d+:function:(.*)$/, "$1") : undefined;
  const type = !id && data.queue ? "queue" : (data.LeoRegisterType || "bot");
  delete data.LeoRegisterType;

  if (type === "bot") {
    data.paused = data.paused === undefined ? true : data.paused === true;
    return leo.bot.createBot(id, data, {
      fields: {
        paused: {
          once: true
        }
      }
    });
  } else if (type === "system") {
    const params = {
      TableName: leo.configuration.resources.LeoSystem,
      Key: { id: { S: id } },
      UpdateExpression: "SET #data = :data",
      ExpressionAttributeNames: { "#data": "data" },
      ExpressionAttributeValues: { ":data": { S: JSON.stringify(data) } }
    };

    try {
      await dynamoDBClient.send(new UpdateItemCommand(params));
    } catch (err) {
      throw new Error(err);
    }
  } else if (type === "queue" && data.queue) {
    const leo_ref = require('leo-sdk/lib/reference');
    const s3Bucket = leo.configuration.resources.LeoS3;
    const schemaName = leo_ref.ref(data.queue).id;

    if (!data.schemas) {
      throw new Error("Queue registered without a schema");
    }

    try {
      for (const [version, schema] of Object.entries(data.schemas)) {
        if (!isSemver(version)) {
          throw new Error(`Schema with version '${version}' is not valid semver`);
        }
        valid_schema(schema);
      }
    } catch (err) {
      throw new Error(err);
    }

    const prefix = `files/bus_internal/queue_schemas/${schemaName}.json`;
    const schemaString = JSON.stringify(data.schemas);
    const uploadParams = { Bucket: s3Bucket, Key: prefix, Body: schemaString };

    try {
      await s3Client.send(new PutObjectCommand(uploadParams));
      console.log(`Successfully uploaded schema to ${s3Bucket}/${prefix}`);
    } catch (err) {
      throw new Error(err);
    }
  } else {
    return Promise.resolve();
  }
}

const numberRegex = /^\d+(?:\.\d*)?$/;
const boolRegex = /^(?:false|true)$/i;
const nullRegex = /^null$/;
const undefinedRegex = /^undefined$/;

function fixTypes(node) {
  const type = typeof node;
  if (Array.isArray(node)) {
    return node.map(fixTypes);
  } else if (type === "object" && node !== null) {
    return Object.keys(node).reduce((acc, key) => {
      acc[key] = fixTypes(node[key]);
      return acc;
    }, {});
  } else if (type === "string") {
    if (numberRegex.test(node)) {
      return parseFloat(node);
    } else if (boolRegex.test(node)) {
      return node.toLowerCase() === "true";
    } else if (nullRegex.test(node)) {
      return null;
    } else if (undefinedRegex.test(node)) {
      return undefined;
    }
  }

  return node;
}

function valid_schema(schema) {
  const ajv = new Ajv();
  addFormats(ajv);

  const { versionSchema, definitionsSchema } = schema || {};
  ajv.addSchema(definitionsSchema || {});
  ajv.compile(versionSchema || {});
}
