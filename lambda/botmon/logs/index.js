'use strict';

import request from "leo-auth";
import leo from "leo-sdk";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { ref } from "leo-sdk/lib/reference.js";
import moment from "moment";
import async from "async";
import { Resources } from "leo-config";

const leoConfigRegion = Resources.Region;

let cloudwatchlogs = new CloudWatchLogsClient({
  region: leoConfigRegion
});

const dynamodb = new DynamoDBClient({
  region: leoConfigRegion
});

exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  const limit = 50;
  let lambda = event.params.path.lambda;
  let logGroup = lambda;
  let id = event.params.path.id;

  let matchParts;
  if (lambda && (matchParts = lambda.match(/^arn:aws:lambda:(.*?):[0-9]+:function:(.*)$/))) {
    lambda = matchParts[2];
    const region = matchParts[1];
    if (region !== leoConfigRegion) {
      cloudwatchlogs = new CloudWatchLogsClient({
        region: region
      });
    }
  }
  let start = moment().subtract(10, "m").valueOf();
  if (event.params.querystring.start) {
    start = moment(parseInt(event.params.querystring.start)).valueOf();
  }

  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "logs",
    botmon: {}
  });

  let starts = [];
  let nextToken = null;
  let hasTime = true;

  const timeout = setTimeout(() => {
    hasTime = false;
  }, context.getRemainingTimeInMillis() * 0.8);

  if (event.params.querystring.stream) {
    requestLogs(lambda, event.params.querystring, (err, details) => {
      clearTimeout(timeout);
      callback(err, details);
    });
  } else {
    async.doWhilst(async (done) => {
      const pattern = id === "all" ? `"START"` : `"[LEOCRON]:start:${id}"`;
      const splitPattern = id === "all" ? new RegExp("RequestId: *(.*?) Version") : new RegExp("\t");

      try {
        const data = await cloudwatchlogs.send(new FilterLogEventsCommand({
          logGroupName: `/aws/lambda/${lambda}`,
          interleaved: false,
          limit: limit,
          startTime: start,
          filterPattern: pattern,
          nextToken: nextToken
        }));

        if (data.nextToken && starts.length < limit) {
          nextToken = data.nextToken;
        } else {
          nextToken = null;
        }

        data.events.map((e) => {
          starts.push({
            timestamp: e.timestamp,
            stream: e.logStreamName,
            requestId: e.message.split(splitPattern)[1],
            endtimestamp: moment().valueOf()
          });
        });
        done();
      } catch (err) {
        if (err.code === "ResourceNotFoundException") {
          done();
        } else {
          done(err);
        }
      }
    }, () => {
      return hasTime && nextToken !== null;
    }, (err) => {
      starts = starts.sort((a, b) => {
        return b.timestamp - a.timestamp;
      });
      if (starts.length) {
        requestLogs(lambda, starts[0], (err, details) => {
          starts[0].details = details;
          clearTimeout(timeout);
          callback(err, starts);
        });
      } else {
        clearTimeout(timeout);
        callback(err, starts);
      }
    });
  }
});

async function requestLogs(lambda, start, callback) {
  try {
    const data = await cloudwatchlogs.send(new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${lambda}`,
      interleaved: false,
      logStreamNames: [start.stream],
      limit: 1000,
      startTime: start.timestamp,
      filterPattern: `"${start.requestId}"`,
      nextToken: start.nextToken
    }));

    const logs = [];
    const stats = {
      dynamodb: {
        read: 0,
        write: 0,
        events: []
      }
    };

    const regex = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T.*?\\t${start.requestId}\\t`);
    data.events.forEach((e) => {
      if (e.message.match(/\[LEOLOG/)) {
        const stat = parseLeoLog(null, e);
        if (stat.event.match(/^dynamodb/)) {
          if (stat.event.match(/update|write/i)) {
            stats.dynamodb.write += stat.consumption;
          } else {
            stats.dynamodb.read += stat.consumption;
          }
          stats.dynamodb.events.push(stat);
        }
      } else if (e.message.match(/\[LEOCRON/)) {
        // handle LEOCRON logs if needed
      } else if (e.message.match(new RegExp(`\\s${start.requestId}`))) {
        let msg = e.message;
        if (e.message.match(regex)) {
          msg = e.message.split(/\t/).slice(2).join("\t");
        }
        logs.push({
          timestamp: e.timestamp,
          message: msg
        });
      }
    });

    callback(null, {
      logs,
      stats,
      nextToken: data.nextToken
    });

  } catch (err) {
    callback(err);
  }
}

function safeNumber(number) {
  return isNaN(number) || !number ? 0 : number;
}

function parseLeoLog(bot, e) {
  const data = e.message.trim().replace(/^.*\[LEOLOG\]:/, '').split(/:/);
  const version = safeNumber(parseInt(data[0].replace("v", "")));
  return (versionHandler[version] || versionHandler["1"])(bot, e, data);
}

const versionHandler = {
  "1": function (bot, e, data) {
    return {
      id: bot,
      version: safeNumber(parseInt(data[0].replace("v", ""))),
      runs: safeNumber(parseInt(data[1])),
      completions: 1,
      start: safeNumber(parseInt(data[2])),
      end: safeNumber(parseInt(data[3])),
      units: safeNumber(parseInt(data[4])),
      duration: safeNumber(parseInt(data[5])),
      min_duration: safeNumber(parseInt(data[6])),
      max_duration: safeNumber(parseInt(data[7])),
      consumption: safeNumber(parseFloat(data[8])),
      errors: safeNumber(parseInt(data[9])),
      event: data.slice(10).join(":"),
      timestamp: e.timestamp
    };
  },
  "2": function (bot, e) {
    const log = JSON.parse(e.message.trim().replace(/^.*\[LEOLOG\]:v2:/, ''));
    log.e = log.e || {};
    const data = log.p;

    const obj = {
      id: log.e.key || bot,
      version: 2,
      runs: safeNumber(parseInt(data[0])),
      start: safeNumber(parseInt(data[1])),
      end: safeNumber(parseInt(data[2])),
      units: safeNumber(parseInt(data[3])),
      duration: safeNumber(parseInt(data[4])),
      min_duration: safeNumber(parseInt(data[5])),
      max_duration: safeNumber(parseInt(data[6])),
      consumption: safeNumber(parseFloat(data[7])),
      errors: safeNumber(parseInt(data[8])),
      event: data[9],
      completions: safeNumber(parseInt(data[10])),
      timestamp: log.e.s || safeNumber(parseInt(data[1])) || e.timestamp
    };

    delete log.e.key;
    obj.extra = log.e;
    return obj;
  }
}
