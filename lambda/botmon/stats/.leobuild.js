(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

let request = require("leo-auth");
let leo = require('leo-sdk');
let stats = require("../../lib/stats.js");
require("moment-round");
var zlib = require("zlib");
let logger = require("leo-logger")("stats-api");
let moment = require('moment');
const {
  writeFileSync
} = require("fs");
let compressionThreshold = 100000; // 100k

const S3_BUCKET = leo.configuration.resources.LeoS3;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  logger.log("[event]", event);
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "stats",
    botmon: {}
  });
  // This function finds strings that are bigger than 1024 and logs them out
  function findBigStrings(obj, prefix = "") {
    if (!obj) return;
    let objType = typeof obj;
    if (objType === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((value, index) => {
          let localPrefix = prefix === '' ? `[${index}]` : prefix + `[${index}]`;
          findBigStrings(value, localPrefix);
        });
      } else {
        for (const key of Object.keys(obj)) {
          let localPrefix = prefix === '' ? key : prefix + "." + key;
          findBigStrings(obj[key], localPrefix);
        }
      }
    } else if (objType === 'string') {
      if (obj.length > 1024) {
        logger.log(`string stored at '${prefix}' is larger than 1024 bytes (length=${obj.length}): '${obj}'`);
      }
    }
  }

  // If event contains nextPart grab that from S3 and pass it back
  // console.log(`event=>${JSON.stringify(event)}`);
  if (event.queryStringParameters && event.queryStringParameters.nextPart) {
    console.log("GOT TO NEW PART");
    const responseHeaders = {
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Origin': '*'
    };
    responseHeaders['Content-Encoding'] = 'gzip';
    let isBase64Encoded = true;
    let data = leo.aws.s3.getObject({
      Bucket: S3_BUCKET,
      Key: event.queryStringParameters.nextPart
    }).promise().then(data => {
      console.log("s3_data => ", data);
      callback(undefined, {
        body: data.Body.toString(),
        isBase64Encoded,
        headers: responseHeaders,
        statusCode: 200
      });
    }).catch(callback);
  } else {
    // console.log("FETCHING STATS DATA");

    stats(event, (err, data) => {
      let stats = (data || {}).stats;
      if (stats) {
        let responseBody = JSON.stringify(stats);
        console.log(`response body length = ${responseBody.length}`);
        logger.log(`response body length = ${responseBody.length}`);
        let s3Prefix = 'files/botmon_stats_payload' + moment().format("/YYYY/MM/DD/HH/mm/") + context.awsRequestId + "_queues.json.gz";
        console.log(`s3Prefix => ${s3Prefix}`);
        let bots = {
          start: stats.start,
          end: stats.end,
          period: stats.period,
          nodes: {
            bot: stats.nodes.bot
          },
          nextPart: s3Prefix
        };
        let queues = {
          start: stats.start,
          end: stats.end,
          period: stats.period,
          nodes: {
            queue: stats.nodes.queue,
            system: stats.nodes.system
          }
        };
        let nextPart;
        if (responseBody.length > 6000000) {
          findBigStrings(stats);
        }
        let isBase64Encoded = false;
        let willAcceptGzip = false;
        const responseHeaders = {
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Origin': '*'
        };
        logger.log('event.headers', event.headers);
        for (const headerName of Object.keys(event.headers)) {
          if (headerName.toLowerCase() === 'accept-encoding') {
            if (event.headers[headerName].indexOf('gzip') !== -1) {
              willAcceptGzip = true;
            }
            break;
          }
        }
        let work = Promise.resolve();
        if (willAcceptGzip && responseBody.length > compressionThreshold) {
          responseHeaders['Content-Encoding'] = 'gzip';
          isBase64Encoded = true;
          // console.log(`compressing response,  size = ${responseBody.length}`);
          logger.log(`compressing response,  size = ${responseBody.length}`);
          responseBody = zlib.gzipSync(responseBody).toString('base64');
          // console.log(`after compression, response size = ${responseBody.length}`)
          logger.log(`after compression, response size = ${responseBody.length}`);
          if (responseBody.length > 5000000) {
            // Compress bots and see if it is still too big
            responseBody = zlib.gzipSync(JSON.stringify(bots)).toString('base64');
            if (responseBody.length < 5000000) {
              // console.log(`after compression for just bots, response size = ${responseBody.length}`)
              // respond with the bot data and send the queue data to S3
              let queuePayload = zlib.gzipSync(JSON.stringify(queues)).toString('base64');
              work = leo.aws.s3.upload({
                Bucket: S3_BUCKET,
                Key: s3Prefix,
                Body: queuePayload
              }, err => {
                console.log("done uploading to s3", err);
              }).promise();
            } else {
              console.log("EVEN JUST THE BOTS IS TOO BIG");
              work = Promise.reject("payload too big still");
            }
          }
        }
        work.then(() => {
          callback(undefined, {
            body: responseBody,
            headers: responseHeaders,
            isBase64Encoded,
            statusCode: 200
          });
        }).catch(callback);
      } else {
        callback(err, (data || {}).stats);
      }
    });
  }
});

},{"../../lib/stats.js":4,"fs":undefined,"leo-auth":undefined,"leo-logger":undefined,"leo-sdk":undefined,"leo-sdk/wrappers/resource":undefined,"moment":undefined,"moment-round":undefined,"zlib":undefined}],2:[function(require,module,exports){
"use strict";

module.exports = (milliseconds, showMilliseconds) => {
  if (showMilliseconds && milliseconds < 1000) {
    return Math.round(milliseconds) + 'ms';
  }
  var seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) {
    return seconds + 's';
  } else {
    var minutes = Math.floor(milliseconds / (1000 * 60));
    if (minutes < 60) {
      return minutes + 'm' + (seconds % 60 ? ', ' + seconds % 60 + 's' : '');
    } else {
      var hours = Math.floor(milliseconds / (1000 * 60 * 60));
      if (hours < 24) {
        return hours + 'h' + (minutes % 60 ? ', ' + minutes % 60 + 'm' : '');
      } else {
        var days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
        return days + 'd' + (hours % 24 ? ', ' + hours % 24 + 'h' : '');
      }
    }
  }
};

},{}],3:[function(require,module,exports){
'use strict';

var moment = require("moment");
var bucketsData = {
  "minute_1": {
    period: "minute",
    prefix: "minute_",
    transform: function (timestamp) {
      return "minute_" + timestamp.clone().utc().startOf("minute").format("YYYY-MM-DD HH:mm");
    },
    value: function (timestamp) {
      return timestamp.clone().utc().startOf("minute");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(amount || 1, "minutes");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(amount || 1, "minutes");
    },
    parent: "minute_5",
    duration: {
      m: 1
    },
    defaultContainer: "minute",
    defaultContainerInterval: 6 * 5
  },
  "minute_5": {
    period: "minute_5",
    prefix: "minute_5_",
    transform: function (timestamp) {
      var offset = (timestamp.utc().minute() + 5) % 5;
      return "minute_5_" + timestamp.clone().utc().subtract(offset, "minutes").startOf("minute").format("YYYY-MM-DD HH:mm");
    },
    value: function (timestamp) {
      var offset = (timestamp.utc().minute() + 5) % 5;
      return timestamp.clone().utc().subtract(offset, "minutes").startOf("minute");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(5 * (amount || 1), "minutes");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(5 * (amount || 1), "minutes");
    },
    parent: "minute_15",
    duration: {
      m: 5
    },
    defaultContainer: "minute",
    defaultContainerInterval: 6 * 15
  },
  "minute_15": {
    period: "minute_15",
    prefix: "minute_15_",
    transform: function (timestamp) {
      var offset = (timestamp.utc().minute() + 15) % 15;
      return "minute_15_" + timestamp.clone().utc().subtract(offset, "minutes").startOf("minute").format("YYYY-MM-DD HH:mm");
    },
    value: function (timestamp) {
      var offset = (timestamp.utc().minute() + 15) % 15;
      return timestamp.clone().utc().subtract(offset, "minutes").startOf("minute");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(15 * (amount || 1), "minutes");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(15 * (amount || 1), "minutes");
    },
    parent: "hour",
    duration: {
      m: 15
    },
    defaultContainer: "hour",
    defaultContainerInterval: 6
  },
  "hour": {
    period: "hour",
    prefix: "hour_",
    transform: function (timestamp) {
      return "hour_" + timestamp.clone().utc().startOf("hour").format("YYYY-MM-DD HH");
    },
    value: function (timestamp) {
      return timestamp.clone().utc().startOf("hour");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(amount || 1, "hour");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(amount || 1, "hour");
    },
    parent: "day",
    duration: {
      h: 1
    },
    defaultContainer: "hour",
    defaultContainerInterval: 30
  },
  "day": {
    period: "day",
    prefix: "day_",
    transform: function (timestamp) {
      return "day_" + timestamp.clone().utc().startOf("day").format("YYYY-MM-DD");
    },
    value: function (timestamp) {
      return timestamp.clone().utc().startOf("day");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(amount || 1, "day");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(amount || 1, "day");
    },
    parent: "week",
    duration: {
      d: 1
    },
    defaultContainer: "day",
    defaultContainerInterval: 30
  },
  "week": {
    period: "week",
    prefix: "week_",
    transform: function (timestamp) {
      return "week_" + timestamp.clone().utc().startOf("week").format("YYYY-MM-DD");
    },
    value: function (timestamp) {
      return timestamp.clone().utc().startOf("week");
    },
    prev: function (timestamp, amount) {
      return moment(timestamp).utc().subtract(amount || 1, "week");
    },
    next: function (timestamp, amount) {
      return moment(timestamp).utc().add(amount || 1, "week");
    },
    parent: null,
    duration: {
      w: 1
    },
    defaultContainer: "week",
    defaultContainerInterval: 30
  }
};
var ranges = {
  "minute": {
    period: "minute_1",
    count: 1,
    startOf: timestamp => timestamp.clone().startOf("minute")
  },
  "minute_1": {
    period: "minute_1",
    count: 1,
    startOf: timestamp => timestamp.clone().startOf("minute")
  },
  "minute_5": {
    period: "minute_1",
    count: 5,
    startOf: timestamp => {
      var offset = (timestamp.utc().minute() + 5) % 5;
      return timestamp.clone().subtract(offset, "minutes").startOf("minute");
    }
  },
  "minute_15": {
    period: "minute_1",
    count: 15,
    startOf: timestamp => {
      var offset = (timestamp.minute() + 15) % 15;
      return timestamp.clone().subtract(offset, "minutes").startOf("minute");
    }
  },
  "hour": {
    period: "hour",
    count: 1,
    startOf: timestamp => timestamp.clone().startOf("hour"),
    rolling: {
      period: "minute_15",
      count: 4
    }
  },
  "hour_6": {
    period: "hour",
    count: 6,
    startOf: timestamp => timestamp.clone().startOf("hour")
  },
  "day": {
    period: "hour",
    count: 24,
    startOf: timestamp => timestamp.clone().startOf("day")
  },
  "week": {
    period: "hour",
    count: 168,
    startOf: timestamp => timestamp.clone().startOf("week")
  }
};
module.exports = {
  data: bucketsData,
  ranges: ranges
  // getBucket: function (period) {
  // 	var range = period;
  // 	if (typeof period == "string") {
  // 		range = ranges[period]
  // 	}
  // 	if (!range || !bucketsData[range.period]) {
  // 		return null;
  // 	}

  // 	var bucket = bucketsData[range.period];

  // 	return {
  // 		prefix: bucket.prefix,
  // 		transform: function (timestamp) {
  // 			return bucket.transform(timestamp);
  // 		},
  // 		prev: function (timestamp, amount) {
  // 			return bucket.prev(timestamp, (amount || 1) * range.count);
  // 		},
  // 		next: function (timestamp, amount) {
  // 			return bucket.prev(timestamp, (amount || 1) * range.count);
  // 		},
  // 		duration: moment.duration(bucket.duration) * range.count,
  // 	}
  // }
};

},{"moment":undefined}],4:[function(require,module,exports){
"use strict";

var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var statsBuckets = require("./stats-buckets.js");
var zlib = require("zlib");
var refUtil = require("leo-sdk/lib/reference.js");
let logger = require("leo-logger")("stats-lib");
let moment = require("moment");
let later = require("later");
require("moment-round");
let async = require("async");
let _ = require('lodash');
const humanize = require("./humanize.js");
console.log(leo.configuration.resources);
var CRON_TABLE = leo.configuration.resources.LeoCron;
var EVENT_TABLE = leo.configuration.resources.LeoEvent;
var SYSTEM_TABLE = leo.configuration.resources.LeoSystem;
var STATS_TABLE = leo.configuration.resources.LeoStats;
let statsCache = {};
const systemSegments = parseInt(process.env.SYSTEM_SCAN_SEGMENTS) || 1;
const botSegments = parseInt(process.env.BOT_SCAN_SEGMENTS) || 1;
const queueSegments = parseInt(process.env.QUEUE_SCAN_SEGMENTS) || 1;
module.exports = function (event, callback) {
  var useLatestCheckpoints = event.params.querystring.useLatestCheckpoints == true;
  var request_timestamp = moment(event.params.querystring.timestamp);
  var period = event.params.querystring.range;
  var numberOfPeriods = event.params.querystring.count || 1;
  var rolling = event.params.querystring.rolling == undefined ? true : !!event.params.querystring.rolling;
  var includeRawBotData = event.includeRawBotData;
  var range = statsBuckets.ranges[period] || {
    period: period,
    count: 1,
    startOf: timestamp => timestamp.startOf(period.replace(/_[0-9]+$/))
  };
  var inclusiveStart = true;
  var inclusiveEnd = false;
  var endNextCount = 1;
  if (!rolling && range.startOf) {
    request_timestamp = range.startOf(request_timestamp);
    endNextCount = range.count;
  } else if (rolling && statsBuckets.ranges[period] && statsBuckets.ranges[period].rolling && numberOfPeriods == 1) {
    range = statsBuckets.ranges[period].rolling;
  }
  var bucketUtils = statsBuckets.data[range.period];
  period = bucketUtils.period;
  logger.log("Requested Timestamp:", request_timestamp.format(), range.count, numberOfPeriods);
  var endTime = bucketUtils.value(bucketUtils.next(request_timestamp.clone(), endNextCount));
  var startTime = bucketUtils.prev(endTime, range.count * numberOfPeriods);
  var out = {
    start: startTime.valueOf(),
    end: endTime.valueOf(),
    period: range.period,
    nodes: {
      system: {},
      bot: {},
      queue: {}
    }
  };
  var isCurrent = true;
  var compare_timestamp = request_timestamp.clone();
  if (out.end < moment.now()) {
    compare_timestamp = moment(out.end);
    isCurrent = false;
  }
  if (out.end >= moment.now()) {
    compare_timestamp = moment();
    isCurrent = true;
  }
  if (isCurrent) {
    useLatestCheckpoints = true;
  }
  async.parallel({
    systems: systemsProcessor,
    queues: queuesProcessor,
    bots: botsProcessor,
    stats: statsProcessorParallel
  }, (err, results) => {
    if (err) {
      logger.log(err);
      return callback(err);
    }
    merge(results, callback);
  });
  function merge(results, done) {
    let statsData = results.stats;
    out.nodes.system = results.systems;
    out.nodes.bot = results.bots;
    out.nodes.queue = results.queues;

    // Post Process Bots
    Object.keys(out.nodes.bot).map(key => {
      let bot = out.nodes.bot[key];
      Object.keys(bot.link_to.parent).map(key => {
        get(key).link_to.children[bot.id] = Object.assign({}, bot.link_to.parent[key], {
          id: bot.id
        });
      });
      Object.keys(bot.link_to.children).map(key => {
        let link = bot.link_to.children[key];
        let child = get(key);
        if (useLatestCheckpoints && child.latest_checkpoint <= link.checkpoint) {
          child.latest_checkpoint = link.checkpoint;
        }
        if (useLatestCheckpoints && child.latest_write <= link.last_write) {
          child.latest_write = link.last_write;
        }
        child.link_to.parent[bot.id] = Object.assign({}, link, {
          id: bot.id
        });
      });
    });

    // Merge In Stats
    Object.keys(statsData).map(botId => {
      let botStats = statsData[botId];
      let exec = botStats.execution;
      var bot = get(botId);
      bot.executions = exec.units;
      bot.errors = exec.errors; //Math.max(exec.errors, exec.units - exec.completions);
      if (bot.health && bot.health.error_limit && typeof bot.health.error_limit === 'number') {
        bot.expect.error_limit = bot.health.error_limit;
      }
      if (bot.errors >= 1 && bot.errors >= bot.executions * bot.expect.error_limit && !bot.archived) {
        bot.isAlarmed = true;
        bot.alarms.errors = {
          value: bot.errors,
          limit: `${bot.errors} > ${bot.executions * bot.expect.error_limit}`,
          msg: ` ${bot.errors} > ${bot.executions * bot.expect.error_limit}`
        };
      }
      bot.duration = {
        min: exec.min_duration,
        max: exec.max_duration,
        total: exec.duration,
        avg: exec.duration / exec.units
      };

      // Reads
      Object.keys(botStats.read).map(key => {
        let linkData = botStats.read[key];
        let other = get(key);
        let data = {
          type: "read",
          last_read: linkData.timestamp,
          last_event_source_timestamp: linkData.source_timestamp,
          checkpoint: linkData.checkpoint,
          units: linkData.units,
          test: true
        };
        if (isCurrent && other.link_to.children[bot.id]) {
          let currentStats = other.link_to.children[bot.id];
          data.checkpoint = currentStats.checkpoint;
          data.last_read = currentStats.last_read;
          data.last_event_source_timestamp = currentStats.last_event_source_timestamp;
        }
        bot.link_to.parent[other.id] = Object.assign({}, data, {
          id: other.id
        });
        other.link_to.children[bot.id] = Object.assign({}, data, {
          id: bot.id
        });
      });

      // Writes
      Object.keys(botStats.write).map(key => {
        let linkData = botStats.write[key];
        let other = get(key);
        let data = {
          type: "write",
          last_write: linkData.timestamp,
          last_event_source_timestamp: linkData.source_timestamp,
          checkpoint: linkData.checkpoint,
          units: linkData.units,
          test: true
        };
        if (isCurrent && other.link_to.parent[bot.id]) {
          let currentStats = other.link_to.parent[bot.id];
          data.checkpoint = currentStats.checkpoint;
          data.last_write = currentStats.last_write;
          data.last_event_source_timestamp = currentStats.last_event_source_timestamp;
        }
        bot.link_to.children[other.id] = Object.assign({}, data, {
          id: other.id
        });
        other.link_to.parent[bot.id] = Object.assign({}, data, {
          id: bot.id
        });
        other.latest_write = Math.max(linkData.timestamp, other.latest_write);
        if (!other.latest_checkpoint || other.latest_checkpoint.localeCompare(linkData.checkpoint) <= 0) {
          other.latest_checkpoint = linkData.checkpoint;
        }
        ;
      });
    });

    // Post Process Queues
    ["queue", "system"].map(type => {
      Object.keys(out.nodes[type]).map(key => {
        let queue = out.nodes[type][key];
        if (queue.owner) {
          queue.hidden = true;
          let ownerCheck = queue.id.replace(/^(system|bot)\./, '$1:');
          if (out.nodes.system[ownerCheck] || out.nodes.bot[ownerCheck]) {
            queue.owner = ownerCheck;
          }
          let owner = get(queue.owner);
          owner.subqueues.push(queue.id);
          let ref = refUtil.ref(queue.id);
          let q = ref.owner().queue;

          // Rename the label if there is a sub queue
          if (queue.label === ref.id && q) {
            queue.label = owner.label + " - " + q;
          }
        }

        // Post Processing on Write Links
        Object.keys(queue.link_to.parent).map(key => {
          let link = queue.link_to.parent[key];
          let bot = get(key);
          let link2 = bot.link_to.children[queue.id];
          link2.event_source_lag = link.event_source_lag = moment(link.last_write).diff(link.last_event_source_timestamp);
          link2.last_write_lag = link.last_write_lag = compare_timestamp.diff(link.last_write);
          bot.queues.write.count++;
          bot.queues.write.events += link.units;
          queue.bots.write.count++;
          queue.bots.write.events += link.units;
          if (bot.health && bot.health.write_lag && typeof bot.health.write_lag === 'number') {
            bot.expect.write_lag = bot.health.write_lag;
          }
          let notTriggeredOrTime = false;
          if ((typeof bot.triggers === 'undefined' || !bot.triggers.length > 0 || bot.triggers === null) && (typeof bot.frequency === 'undefined' || bot.frequency === '' || bot.frequency === null)) {
            notTriggeredOrTime = true;
          }
          if (link.last_write && link.last_write >= bot.queues.write.last_write) {
            bot.queues.write.last_write = link.last_write;
            bot.queues.write.last_write_lag = link.last_write_lag;
            if (link.last_write_lag >= bot.expect.write_lag && !notTriggeredOrTime && !bot.archived) {
              bot.isAlarmed = true;
              bot.alarms.write_lag = {
                value: humanize(link.last_write_lag),
                limit: humanize(bot.expect.write_lag),
                msg: `${humanize(link.last_write_lag)} > ${humanize(bot.expect.write_lag)}`
              };
            }
          }
          if (link.last_event_source_timestamp && link.last_event_source_timestamp >= bot.queues.write.last_source) {
            bot.queues.write.last_source = link.last_event_source_timestamp;
            bot.queues.write.last_source_lag = link.event_source_lag;
          }
          if (link.last_write && link.last_write >= queue.bots.write.last_write) {
            queue.bots.write.last_write = link.last_write;
            queue.bots.write.last_write_lag = link.last_write_lag;
          }
          if (link.last_event_source_timestamp && link.last_event_source_timestamp >= queue.bots.write.last_source) {
            queue.bots.write.last_source = link.last_event_source_timestamp;
            queue.bots.write.last_source_lag = link.event_source_lag;
          }

          // If this is a sub queue of a bot/system, link to the owner instead
          if (queue.owner) {
            var owner = get(queue.owner);
            if (owner.queue === queue.id) {
              var l = owner.link_to.parent[key];
              owner.link_to.parent[key] = Object.assign({}, l, link);
              delete queue.link_to.parent[key];
              delete bot.link_to.children[queue.id];
              bot.link_to.children[owner.id] = Object.assign(link2, {
                id: owner.id
              });
            }
          }
        });

        // Post Processing on Read Links
        Object.keys(queue.link_to.children).map(key => {
          var link = queue.link_to.children[key];
          var bot = get(key);
          var link2 = bot.link_to.parent[queue.id];
          if (link.checkpoint < queue.latest_checkpoint) {
            link.event_source_lag = compare_timestamp.diff(link.last_event_source_timestamp);
            link.last_read_lag = compare_timestamp.diff(link.last_read);
          } else if (link.checkpoint >= queue.latest_checkpoint) {
            link.event_source_lag = 0;
            link.last_read_lag = 0;
          } else {
            link.event_source_lag = null;
            link.last_read_lag = null;
          }
          link2.event_source_lag = link.event_source_lag;
          link2.last_read_lag = link.last_read_lag;
          bot.queues.read.count++;
          bot.queues.read.events += link.units;
          queue.bots.read.count++;
          queue.bots.read.events += link.units;
          if (bot.health && bot.health.source_lag && typeof bot.health.source_lag === 'number') {
            bot.expect.source_lag = bot.health.source_lag;
          }
          if (link.last_read && link.last_read >= bot.queues.read.last_read) {
            bot.queues.read.last_read = link.last_read;
            bot.queues.read.last_read_lag = link.last_read_lag;
          }
          let notTriggeredOrTime = false;
          if ((typeof bot.triggers === 'undefined' || !bot.triggers.length > 0 || bot.triggers === null) && (typeof bot.frequency === 'undefined' || bot.frequency === '' || bot.frequency === null)) {
            notTriggeredOrTime = true;
          }
          if (link.last_event_source_timestamp && link.last_event_source_timestamp >= bot.queues.read.last_source) {
            bot.queues.read.last_source = link.last_event_source_timestamp;
            bot.queues.read.last_source_lag = link.event_source_lag;
            if (link.event_source_lag > bot.expect.source_lag && !notTriggeredOrTime && !bot.archived) {
              bot.isAlarmed = true;
              bot.alarms.source_lag = {
                value: humanize(link.event_source_lag),
                limit: humanize(bot.expect.source_lag),
                msg: ` ${humanize(link.event_source_lag)} > ${humanize(bot.expect.source_lag)}`
              };
            }
          }
          if (link.last_read && link.last_read >= queue.bots.read.last_read) {
            queue.bots.read.last_read = link.last_read;
            queue.bots.read.last_read_lag = link.last_read_lag;
          }
          if (link.last_event_source_timestamp && link.last_event_source_timestamp >= queue.bots.read.last_source) {
            queue.bots.read.last_source = link.last_event_source_timestamp;
            queue.bots.read.last_source_lag = link.event_source_lag;
          }

          // If this is a sub queue of a bot/system, link to the owner instead
          if (queue.owner) {
            var owner = get(queue.owner);
            if (owner.queue === queue.id) {
              var l = owner.link_to.children[key];
              owner.link_to.children[key] = Object.assign({}, l, link);
              delete queue.link_to.children[key];
              delete bot.link_to.parent[queue.id];
              bot.link_to.parent[owner.id] = Object.assign(link2, {
                id: owner.id
              });
            }
          }
        });
      });
    });
    out.get = function (id) {
      var ref = refUtil.ref(id);
      return this.nodes[ref.type][ref.refId()];
    };
    done(null, {
      stats: out
    });
  }
  function statsProcessorParallel(done) {
    // console.time("STATS QUERY PARALLEL");
    // We know that by default end - start ~= 15 minutes (give or take a second)
    // We want to chunk this up into 2 minute chunks
    let start = out.start + (!inclusiveStart ? 1 : 0);
    let end = out.end - (!inclusiveEnd ? 1 : 0);
    let timeSpans = splitTime(start, end);
    let queries = [];
    for (const span of timeSpans) {
      let query = {
        TableName: STATS_TABLE,
        IndexName: "period-time-index",
        KeyConditionExpression: "#period = :period and #time between :start and :end",
        ExpressionAttributeNames: {
          "#time": "time",
          "#period": "period"
        },
        ExpressionAttributeValues: {
          ":start": span.start,
          ":end": span.end,
          ":period": period
        },
        "ReturnConsumedCapacity": 'TOTAL'
      };
      queries.push(query);
    }
    parallelQuery(queries, {
      mb: 100
    }, mergeStatsResults).then(data => {
      // console.timeEnd("STATS QUERY PARALLEL");
      done(null, data);
    }).catch(done);
  }
  function statsProcessor(done) {
    let start = out.start + (!inclusiveStart ? 1 : 0);
    let end = out.end - (!inclusiveEnd ? 1 : 0);
    // Query for all the records in the 'period-time-index' where 'period' = minute AND (time > start AND time < end)
    leo.aws.dynamodb.query({
      TableName: STATS_TABLE,
      IndexName: "period-time-index",
      KeyConditionExpression: "#period = :period and #time between :start and :end",
      ExpressionAttributeNames: {
        "#time": "time",
        "#period": "period"
      },
      ExpressionAttributeValues: {
        ":start": start,
        ":end": end,
        ":period": period
      },
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      mb: 100
    }).catch(err => done(err))
    // Take the response and merge it together
    .then(bucketsStats => {
      logger.log(period, bucketsStats.LastEvaluatedKey, bucketsStats.ConsumedCapacity, bucketsStats.Items.length);
      var out = {};
      var executionDefaults = {
        completions: 0,
        duration: 0,
        max_duration: 0,
        min_duration: 0,
        errors: 0,
        units: 0
      };
      var defaults = {
        checkpoint: 0,
        source_timestamp: 0,
        timestamp: 0,
        units: 0
      };

      // loop through each record and merge the stats for each record
      bucketsStats.Items.map(stat => {
        //if (stat.id.match(/^bot:/)) {
        if (!(stat.id in out)) {
          out[stat.id] = {
            execution: Object.assign({}, executionDefaults),
            read: {},
            write: {}
          };
        }
        var node = out[stat.id];
        if (stat.current.execution) {
          node.execution = mergeExecutionStats(node.execution, stat.current.execution);
        }
        ["read", "write"].map(type => {
          Object.keys(stat.current[type] || {}).map(key => {
            if (!(key in node[type])) {
              node[type][key] = Object.assign({}, defaults);
            }
            node[type][key] = mergeStats(node[type][key], stat.current[type][key]);
          });
        });
      });
      done(null, out);
    });
  }
  function get(id, type) {
    let ref = refUtil.ref(id, type);
    let ret = out.nodes[ref.type][ref.refId()];
    if (!ret) {
      out.nodes[ref.type][ref.refId()] = ret = create(ref);
    } else {
      ret.alarms = ret.alarms || {};
    }
    return ret;
  }
  function create(ref) {
    if (ref.type === "system") {
      return createSystem(ref);
    } else if (ref.type === "queue") {
      return createQueue(ref);
    } else if (ref.type === "bot") {
      return createBot(ref);
    }
  }
  function createSystem(systemId) {
    let ref = refUtil.ref(systemId, "system");
    return {
      id: ref.refId(),
      type: 'system',
      icon: "system.png",
      tags: '',
      label: ref.id,
      crons: [],
      checksums: false,
      heartbeat: {},
      queue: ref.asQueue().refId(),
      subqueues: [],
      bots: {
        read: {
          count: 0,
          events: 0,
          last_read: null,
          last_read_lag: null,
          last_source: null,
          last_source_lag: null
        },
        write: {
          count: 0,
          events: 0,
          last_write: null,
          last_write_lag: null,
          last_source: null,
          last_source_lag: null
        }
      },
      link_to: {
        parent: {},
        children: {}
      },
      logs: {
        errors: [],
        notices: []
      }
    };
  }
  function createQueue(queueId) {
    let ref = refUtil.ref(queueId, "queue");
    let owner = ref.owner();
    return {
      id: ref.refId(),
      type: 'queue',
      icon: ref.id.match(/^(commands|leo)\./) ? "icons/bus.png" : "queue.png",
      label: ref.id,
      latest_checkpoint: '',
      latest_write: 0,
      tags: '',
      queue: ref.asQueue().refId(),
      owner: owner && owner.refId(),
      bots: {
        read: {
          count: 0,
          events: 0,
          last_read: null,
          last_read_lag: null,
          last_source: null,
          last_source_lag: null
        },
        write: {
          count: 0,
          events: 0,
          last_write: null,
          last_write_lag: null,
          last_source: null,
          last_source_lag: null
        }
      },
      link_to: {
        parent: {},
        children: {}
      },
      logs: {
        errors: [],
        notices: []
      }
    };
  }
  function createBot(botId) {
    let ref = refUtil.ref(botId, "bot");
    return {
      id: ref.refId(),
      lambdaName: ref.lambdaName,
      type: 'bot',
      status: 'running',
      rogue: false,
      label: ref.id,
      executions: 0,
      errors: 0,
      system: null,
      isAlarmed: false,
      readCaughtUp: false,
      alarms: {},
      source: false,
      last_run: {
        start: null,
        end: null
      },
      expect: {
        write_lag: 1000 * 60 * 1438560,
        source_lag: 1000 * 60 * 2.5,
        error_limit: .5,
        consecutive_errors: 2
      },
      templateId: "Custom",
      subqueues: [],
      queue: ref.asQueue().refId(),
      queues: {
        read: {
          count: 0,
          events: 0,
          last_read: null,
          last_read_lag: null,
          last_source: null,
          last_source_lag: null
        },
        write: {
          count: 0,
          events: 0,
          last_write: null,
          last_write_lag: null,
          last_source: null,
          last_source_lag: null
        }
      },
      duration: {
        min: 0,
        max: 0,
        total: 0,
        avg: 0
      },
      link_to: {
        parent: {},
        children: {}
      },
      logs: {
        errors: [],
        notices: []
      }
    };
  }
  function systemsProcessor(done) {
    parallelScan({
      TableName: SYSTEM_TABLE,
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      method: "scan",
      mb: 1
    }, systemSegments).then(data => {
      var systems = {};
      data.Items.map(system => {
        let s = createSystem(system.id);
        s.label = system.label || system.id;
        s.icon = system.icon;
        s.crons = system.crons;
        systems[s.id] = Object.assign(system, s);
      });
      done(null, systems);
    }).catch(done);
  }
  function queuesProcessor(done) {
    // console.time("QUEUES QUERY");
    parallelScan({
      TableName: EVENT_TABLE,
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      method: "scan",
      mb: 100
    }, queueSegments).then(data => {
      // console.timeEnd("QUEUES QUERY");
      // console.log(`QUEUES QUERY ${JSON.stringify(data._stats)}`);
      var queues = {};
      data.Items.map(queue => {
        if (!queue.archived) {
          let q = createQueue(queue.event);
          if (!(q.id.match(/\/_archive$/g) || q.id.match(/\/_snapshot$/g))) {
            q.label = queue.name || q.label;
            q.tags = queue.other && queue.tags || '';
            q.archived = queue.archived;
            q.owner = queue.owner || q.owner;
            queues[q.id] = q;
          }
        } else {
          logger.debug(`${queue.id} is archived skipping for now`);
        }
      });
      done(null, queues);
    }).catch(done);
  }
  function botsProcessor(done) {
    parallelScan({
      TableName: CRON_TABLE,
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      method: "scan",
      mb: 100
    }, botSegments).then(data => {
      var bots = {};
      data.Items.map(bot => {
        if (!bot.archived) {
          let b = createBot(bot.id);
          let errorCount = bot.errorCount ? bot.errorCount : 0;

          //cronResults[cron.id] = cron;
          b.checksum = !!bot.checksum;
          b.label = bot.name || bot.description || bot.id;
          if (bot.invokeTime) {
            b.last_run = {
              start: bot.invokeTime
            };
          }
          if (bot.archived) {
            console.log(`${bot.id} | bot.archived => ${bot.archived}`);
            b.status = "archived";
          } else if (bot.paused) {
            b.status = "paused";
          }
          if (errorCount > 10) {
            b.rogue = true;
          }
          b.readCaughtUp = bot.readCaughtUp;
          if (bot.time) {
            let sched = later.parse.cron(bot.time, true);
            let prev = later.schedule(sched).prev(5);
            let diff = [];
            prev.map(a => a.valueOf()).reduce((a, b) => {
              diff.push(a - b);
              return b;
            });
            let total = diff.reduce((a, b) => a + b);
            b.expect.write_lag = moment.duration({
              milliseconds: b.expect.write_lag
            }).add({
              milliseconds: total / diff.length
            }).asMilliseconds();
          } else if (bot.triggers && bot.triggers[0] !== undefined) {
            let checkArr = [];
            _.forEach(bot.triggers, trigger => {
              let requested_kinesis = bot.requested_kinesis && bot.requested_kinesis[trigger] ? bot.requested_kinesis[trigger] : null;
              let read_checkpoint = bot.checkpoints && bot.checkpoints.read && bot.checkpoints.read[trigger] && bot.checkpoints.read[trigger].checkpoint ? bot.checkpoints.read[trigger].checkpoint : null;
              if (read_checkpoint !== undefined && requested_kinesis !== undefined && read_checkpoint >= requested_kinesis) {
                checkArr.push(true);
              } else {
                checkArr.push(false);
              }
            });
            // See if trigger bot is behind on any queue
            let temp = true;
            _.forEach(checkArr, bool => {
              if (bool === false) {
                temp = false;
              }
            });
            b.readCaughtUp = temp;
          }
          b.owner = bot.owner;
          b.lambdaName = bot.lambdaName;
          b.archived = bot.archived || false;
          b.tags = bot.tags || b.tags;
          b.frequency = bot.time;
          b.triggers = bot.triggers || [];
          b.health = bot.health || {};
          b.message = bot.message;
          b.name = bot.name || '';
          b.templateId = bot.templateId || b.templateId;
          b.isAlarmed = bot.isAlarmed;
          b.alarms = bot.alarms;
          b.expect = bot.expect || b.expect;
          b.description = bot.description;
          b.source = bot.lambda && bot.lambda.settings && bot.lambda.settings[0] && bot.lambda.settings[0].source || false;
          b.expect.consecutive_errors = bot.health && bot.health.consecutive_errors || b.expect.consecutive_errors;
          if (bot.checkpoints) {
            ["read", "write"].forEach(type => {
              if (!bot.checkpoints[type]) {
                return;
              }
              Object.keys(bot.checkpoints[type]).forEach(event => {
                if (event === 'undefined') {
                  return;
                }
                var queueRef = refUtil.ref(event);
                if (queueRef.refId().match(/^queue:commands\./) && type == "write") {
                  return;
                }
                var data = bot.checkpoints[type][event];
                var d = {
                  id: b.id,
                  type: type,
                  units: 0,
                  [`last_${type}`]: data.ended_timestamp,
                  last_event_source_timestamp: data.source_timestamp,
                  checkpoint: data.checkpoint
                };
                let relation = type === "write" ? "children" : "parent";
                if (!(queueRef.refId().match(/\/_archive$/g) || queueRef.refId().match(/\/_snapshot$/g))) {
                  b.link_to[relation][queueRef.refId()] = d;
                }
              });
            });
          }
          if (bot.instances) {
            for (var i in bot.instances) {
              var instance = bot.instances[i];
              if (instance.log) {
                if (instance.status == "error") {
                  b.logs.errors.push(JSON.parse(zlib.gunzipSync(instance.log)));
                } else {
                  b.logs.notices.push(JSON.parse(zlib.gunzipSync(instance.log)));
                }
              }
            }
          }
          if (includeRawBotData) {
            b.raw = bot;
          }
          bots[b.id] = b;
          try {
            let source = bot.lambda && bot.lambda.settings && bot.lambda.settings[0] && bot.lambda.settings[0].source;
            b.kinesis_number = bot.checkpoints && bot.checkpoints.read && bot.checkpoints.read[source] && bot.checkpoints.read[source].checkpoint;
            if (!b.kinesis_number) {
              b.kinesis_number = Object.keys(bot.checkpoints && bot.checkpoints.read || {}).map(x => bot.checkpoints.read[x].checkpoint).filter(c => !!c && c !== 'undefined' && c !== 'queue:undefined').sort()[0] || "";
            }
          } catch (err) {
            b.kinesis_number = "";
          }
          b.system = bot.system && bot.system.id ? bot.system.id : undefined;
        } else {
          // console.log(`${bot.id} is archived. skipping for now`)
        }
      });
      done(null, bots);
    }).catch(done);
  }
  function parallelScan(query, opts, segments) {
    let requests = [];
    for (let i = 0; i < segments; i++) {
      requests.push(dynamodb.query(Object.assign({}, query, {
        TotalSegments: segments,
        Segment: i
      }), opts));
    }
    return Promise.all(requests).then(data => {
      let response = data.reduce((all, one) => {
        all.Items = all.Items.concat(one.Items);
        all.ScannedCount += one.ScannedCount;
        all.Count += one.Count;
        all._stats.mb += one._stats.mb;
        all._stats.count += one._stats.count;
        return all;
      }, {
        Items: [],
        ScannedCount: 0,
        Count: 0,
        _stats: {
          mb: 0,
          count: 0
        }
      });
      return response;
    });
  }
  function parallelQuery(queries, opts, mergeFn) {
    // We need at least one query
    if (queries.length < 1) {
      return mergeFn({
        Items: [],
        ScannedCount: 0,
        Count: 0,
        _stats: {
          mb: 0,
          count: 0
        }
      });
    }
    ;
    let requests = [];
    for (const [index, query] of queries.entries()) {
      let key = JSON.stringify(query.ExpressionAttributeValues);
      let end = query.ExpressionAttributeValues[":end"];

      //
      let isBucketClosed = end < Date.now() - 1000 * 60 * 2;
      // console.log(`cache key => ${key} cache or request: ${statsCache[key] && isBucketClosed}, ${index}, ${queries.length}`);
      // Cache buckets that aren't expected to change and fetch buckets that will change (closer to now)
      if (statsCache[key] && isBucketClosed) {
        statsCache[key].lastFetched = Date.now();
        requests.push(Promise.resolve(statsCache[key]));
      } else {
        requests.push(dynamodb.query(query, opts).then(data => {
          // Cache anything that is available
          statsCache[key] = data;
          data.lastFetched = Date.now();
          return data;
        }));
      }
    }
    return Promise.all(requests).then(data => {
      let response = data.reduce((all, one) => {
        all.Items = all.Items.concat(one.Items);
        // all.ScannedCount += one.ScannedCount;
        // all.Count += one.Count;
        // all._stats.mb += one._stats.mb;
        // all._stats.count += one._stats.count;

        return all;
      }, {
        Items: [],
        ScannedCount: 0,
        Count: 0,
        _stats: {
          mb: 0,
          count: 0
        }
      });
      return mergeFn(response);
    }).finally(() => {
      // Purge old cache entries
      let count = 0;
      Object.entries(statsCache).forEach(([key, value]) => {
        // If the entry hasn't been fetched in 2 minutes, PURGE BABY
        if (value.lastFetched < Date.now() - 1000 * 60 * 2) {
          delete statsCache[key];
        } else {
          count++;
        }
      });
      if (count > 50) {
        // sort the cache ascending order by lastFetched
        let sortedCache = Object.entries(statsCache).sort(([, a], [, b]) => a.lastFetched - b.lastFetched);
        // slice off any entries > 50 in length and delete from the cache
        sortedCache.slice(0, sortedCache.length - 50).forEach(([key]) => delete statsCache[key]);
      }

      // console.log(Object.keys(statsCache));
    });
  }
  function splitTime(start, end) {
    if (!start || !end) {
      return [];
    }
    ;

    // console.log(`START: ${bucketUtils.value(moment(start)).format()}, END: ${bucketUtils.value(moment(end)).format()}`);

    let times = [];
    let current = start;

    // `minute_15` is going to do 15 one minute buckets, `hour` is going to do 4 `minute_15` buckets, 6 hour buckets for `hour_6` 
    // and for `day` we get 24 `hour` buckets. So the assumption is we will never need more than 30 buckets of data
    for (let index = 0; index < 30; index++) {
      let next = bucketUtils.next(current);
      times.push({
        start: current.valueOf(),
        end: next.valueOf()
      });
      current = next;
      // console.log(`CURRENT = ${current.valueOf()}, ${current.format()}`);
      // If current is past the end OR if current is past Now, bail we don't need future stuff
      if (current > end || current.valueOf() > Date.now()) {
        break;
      }
    }
    return times;
  }
  function mergeStatsResults(bucketsStats) {
    var out = {};
    var executionDefaults = {
      completions: 0,
      duration: 0,
      max_duration: 0,
      min_duration: 0,
      errors: 0,
      units: 0
    };
    var defaults = {
      checkpoint: 0,
      source_timestamp: 0,
      timestamp: 0,
      units: 0
    };
    bucketsStats.Items.map(stat => {
      // console.log(`stat.archived => ${stat.archived}`);
      // If we don't have the id in out create it and default it
      if (!(stat.id in out)) {
        out[stat.id] = {
          execution: Object.assign({}, executionDefaults),
          read: {},
          write: {}
        };
      }
      var node = out[stat.id];

      // If stat.current.execution is available merge that into node (which is a reference to out[stat.id])
      if (stat.current.execution) {
        node.execution = mergeExecutionStats(node.execution, stat.current.execution);
      }
      ["read", "write"].map(type => {
        Object.keys(stat.current[type] || {}).map(key => {
          // if stat.current.read or stat.current.write doesn't exist in node default it
          if (!(key in node[type])) {
            node[type][key] = Object.assign({}, defaults);
          }
          // merge 'read' and 'write' stats into node
          node[type][key] = mergeStats(node[type][key], stat.current[type][key]);
        });
      });
    });
    return out;
  }
  function max(a, b) {
    if (typeof a === "number") {
      return Math.max(a, b);
    } else if (typeof a === "string") {
      return a.localeCompare(b) >= 1 ? a : b;
    } else {
      return b;
    }
  }
  function min(a, b) {
    if (typeof a === "number") {
      return Math.min(a, b);
    } else if (typeof a === "string") {
      return a.localeCompare(b) >= 1 ? b : a;
    } else {
      return b;
    }
  }
  function sum(a, b, defaultValue) {
    return (a || defaultValue || 0) + (b || defaultValue || 0);
  }
  function safeNumber(number) {
    if (isNaN(number) || !number) {
      return 0;
    } else {
      return number;
    }
  }
  function mergeExecutionStats(s, r) {
    s.completions = sum(s.completions, r.completions);
    s.units = sum(s.units, r.units);
    s.duration = sum(safeNumber(parseInt(s.duration)), safeNumber(parseInt(r.duration)));
    s.max_duration = max(s.max_duration, r.max_duration);
    if (r.min_duration > 0) {
      s.min_duration = min(s.min_duration, r.min_duration);
    } else {
      s.min_duration = s.min_duration || 0;
    }
    s.errors = sum(s.errors, r.errors);
    return s;
  }
  function mergeStats(s, r) {
    s.source_timestamp = max(s.source_timestamp, r.source_timestamp);
    s.timestamp = max(s.timestamp, r.timestamp);
    s.units = sum(s.units, r.units);
    s.checkpoint = r.checkpoint || s.checkpoint;
    return s;
  }

  // Currently not used because it is surprisingly slow
  function promiseAllConcurrency(queue, concurrency) {
    if (concurrency == null) {
      concurrency = queue.length;
    }
    let startTime = Date.now();
    let index = 0;
    const results = [];
    let complete = 0;
    // Run a pseudo-thread
    const execThread = () => {
      if (index < queue.length) {
        const curIndex = index++;
        return queue[curIndex]().then(data => {
          results[curIndex] = data;
          complete++;
          return execThread();
        });
      }
      return Promise.resolve();
    };

    // Start threads
    const threads = [];
    for (let thread = 0; thread < concurrency; thread++) {
      threads.push(execThread());
    }
    return Promise.all(threads).then(() => results);
  }
};

},{"./humanize.js":2,"./stats-buckets.js":3,"async":undefined,"later":undefined,"leo-logger":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"lodash":undefined,"moment":undefined,"moment-round":undefined,"zlib":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxubGV0IHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG5sZXQgbGVvID0gcmVxdWlyZSgnbGVvLXNkaycpO1xubGV0IHN0YXRzID0gcmVxdWlyZShcIi4uLy4uL2xpYi9zdGF0cy5qc1wiKTtcbnJlcXVpcmUoXCJtb21lbnQtcm91bmRcIik7XG52YXIgemxpYiA9IHJlcXVpcmUoXCJ6bGliXCIpO1xubGV0IGxvZ2dlciA9IHJlcXVpcmUoXCJsZW8tbG9nZ2VyXCIpKFwic3RhdHMtYXBpXCIpO1xubGV0IG1vbWVudCA9IHJlcXVpcmUoJ21vbWVudCcpO1xuY29uc3Qge1xuICB3cml0ZUZpbGVTeW5jXG59ID0gcmVxdWlyZShcImZzXCIpO1xubGV0IGNvbXByZXNzaW9uVGhyZXNob2xkID0gMTAwMDAwOyAvLyAxMDBrXG5cbmNvbnN0IFMzX0JVQ0tFVCA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TMztcbmV4cG9ydHMuaGFuZGxlciA9IHJlcXVpcmUoXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCIpKGFzeW5jIChldmVudCwgY29udGV4dCwgY2FsbGJhY2spID0+IHtcbiAgbG9nZ2VyLmxvZyhcIltldmVudF1cIiwgZXZlbnQpO1xuICBhd2FpdCByZXF1ZXN0LmF1dGhvcml6ZShldmVudCwge1xuICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6JyxcbiAgICBhY3Rpb246IFwic3RhdHNcIixcbiAgICBib3Rtb246IHt9XG4gIH0pO1xuICAvLyBUaGlzIGZ1bmN0aW9uIGZpbmRzIHN0cmluZ3MgdGhhdCBhcmUgYmlnZ2VyIHRoYW4gMTAyNCBhbmQgbG9ncyB0aGVtIG91dFxuICBmdW5jdGlvbiBmaW5kQmlnU3RyaW5ncyhvYmosIHByZWZpeCA9IFwiXCIpIHtcbiAgICBpZiAoIW9iaikgcmV0dXJuO1xuICAgIGxldCBvYmpUeXBlID0gdHlwZW9mIG9iajtcbiAgICBpZiAob2JqVHlwZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICAgICAgb2JqLmZvckVhY2goKHZhbHVlLCBpbmRleCkgPT4ge1xuICAgICAgICAgIGxldCBsb2NhbFByZWZpeCA9IHByZWZpeCA9PT0gJycgPyBgWyR7aW5kZXh9XWAgOiBwcmVmaXggKyBgWyR7aW5kZXh9XWA7XG4gICAgICAgICAgZmluZEJpZ1N0cmluZ3ModmFsdWUsIGxvY2FsUHJlZml4KTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhvYmopKSB7XG4gICAgICAgICAgbGV0IGxvY2FsUHJlZml4ID0gcHJlZml4ID09PSAnJyA/IGtleSA6IHByZWZpeCArIFwiLlwiICsga2V5O1xuICAgICAgICAgIGZpbmRCaWdTdHJpbmdzKG9ialtrZXldLCBsb2NhbFByZWZpeCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKG9ialR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBpZiAob2JqLmxlbmd0aCA+IDEwMjQpIHtcbiAgICAgICAgbG9nZ2VyLmxvZyhgc3RyaW5nIHN0b3JlZCBhdCAnJHtwcmVmaXh9JyBpcyBsYXJnZXIgdGhhbiAxMDI0IGJ5dGVzIChsZW5ndGg9JHtvYmoubGVuZ3RofSk6ICcke29ian0nYCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gSWYgZXZlbnQgY29udGFpbnMgbmV4dFBhcnQgZ3JhYiB0aGF0IGZyb20gUzMgYW5kIHBhc3MgaXQgYmFja1xuICAvLyBjb25zb2xlLmxvZyhgZXZlbnQ9PiR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfWApO1xuICBpZiAoZXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzICYmIGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycy5uZXh0UGFydCkge1xuICAgIGNvbnNvbGUubG9nKFwiR09UIFRPIE5FVyBQQVJUXCIpO1xuICAgIGNvbnN0IHJlc3BvbnNlSGVhZGVycyA9IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IHRydWUsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgfTtcbiAgICByZXNwb25zZUhlYWRlcnNbJ0NvbnRlbnQtRW5jb2RpbmcnXSA9ICdnemlwJztcbiAgICBsZXQgaXNCYXNlNjRFbmNvZGVkID0gdHJ1ZTtcbiAgICBsZXQgZGF0YSA9IGxlby5hd3MuczMuZ2V0T2JqZWN0KHtcbiAgICAgIEJ1Y2tldDogUzNfQlVDS0VULFxuICAgICAgS2V5OiBldmVudC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMubmV4dFBhcnRcbiAgICB9KS5wcm9taXNlKCkudGhlbihkYXRhID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKFwiczNfZGF0YSA9PiBcIiwgZGF0YSk7XG4gICAgICBjYWxsYmFjayh1bmRlZmluZWQsIHtcbiAgICAgICAgYm9keTogZGF0YS5Cb2R5LnRvU3RyaW5nKCksXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZCxcbiAgICAgICAgaGVhZGVyczogcmVzcG9uc2VIZWFkZXJzLFxuICAgICAgICBzdGF0dXNDb2RlOiAyMDBcbiAgICAgIH0pO1xuICAgIH0pLmNhdGNoKGNhbGxiYWNrKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBjb25zb2xlLmxvZyhcIkZFVENISU5HIFNUQVRTIERBVEFcIik7XG5cbiAgICBzdGF0cyhldmVudCwgKGVyciwgZGF0YSkgPT4ge1xuICAgICAgbGV0IHN0YXRzID0gKGRhdGEgfHwge30pLnN0YXRzO1xuICAgICAgaWYgKHN0YXRzKSB7XG4gICAgICAgIGxldCByZXNwb25zZUJvZHkgPSBKU09OLnN0cmluZ2lmeShzdGF0cyk7XG4gICAgICAgIGNvbnNvbGUubG9nKGByZXNwb25zZSBib2R5IGxlbmd0aCA9ICR7cmVzcG9uc2VCb2R5Lmxlbmd0aH1gKTtcbiAgICAgICAgbG9nZ2VyLmxvZyhgcmVzcG9uc2UgYm9keSBsZW5ndGggPSAke3Jlc3BvbnNlQm9keS5sZW5ndGh9YCk7XG4gICAgICAgIGxldCBzM1ByZWZpeCA9ICdmaWxlcy9ib3Rtb25fc3RhdHNfcGF5bG9hZCcgKyBtb21lbnQoKS5mb3JtYXQoXCIvWVlZWS9NTS9ERC9ISC9tbS9cIikgKyBjb250ZXh0LmF3c1JlcXVlc3RJZCArIFwiX3F1ZXVlcy5qc29uLmd6XCI7XG4gICAgICAgIGNvbnNvbGUubG9nKGBzM1ByZWZpeCA9PiAke3MzUHJlZml4fWApO1xuICAgICAgICBsZXQgYm90cyA9IHtcbiAgICAgICAgICBzdGFydDogc3RhdHMuc3RhcnQsXG4gICAgICAgICAgZW5kOiBzdGF0cy5lbmQsXG4gICAgICAgICAgcGVyaW9kOiBzdGF0cy5wZXJpb2QsXG4gICAgICAgICAgbm9kZXM6IHtcbiAgICAgICAgICAgIGJvdDogc3RhdHMubm9kZXMuYm90XG4gICAgICAgICAgfSxcbiAgICAgICAgICBuZXh0UGFydDogczNQcmVmaXhcbiAgICAgICAgfTtcbiAgICAgICAgbGV0IHF1ZXVlcyA9IHtcbiAgICAgICAgICBzdGFydDogc3RhdHMuc3RhcnQsXG4gICAgICAgICAgZW5kOiBzdGF0cy5lbmQsXG4gICAgICAgICAgcGVyaW9kOiBzdGF0cy5wZXJpb2QsXG4gICAgICAgICAgbm9kZXM6IHtcbiAgICAgICAgICAgIHF1ZXVlOiBzdGF0cy5ub2Rlcy5xdWV1ZSxcbiAgICAgICAgICAgIHN5c3RlbTogc3RhdHMubm9kZXMuc3lzdGVtXG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBsZXQgbmV4dFBhcnQ7XG4gICAgICAgIGlmIChyZXNwb25zZUJvZHkubGVuZ3RoID4gNjAwMDAwMCkge1xuICAgICAgICAgIGZpbmRCaWdTdHJpbmdzKHN0YXRzKTtcbiAgICAgICAgfVxuICAgICAgICBsZXQgaXNCYXNlNjRFbmNvZGVkID0gZmFsc2U7XG4gICAgICAgIGxldCB3aWxsQWNjZXB0R3ppcCA9IGZhbHNlO1xuICAgICAgICBjb25zdCByZXNwb25zZUhlYWRlcnMgPSB7XG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogdHJ1ZSxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICAgIH07XG4gICAgICAgIGxvZ2dlci5sb2coJ2V2ZW50LmhlYWRlcnMnLCBldmVudC5oZWFkZXJzKTtcbiAgICAgICAgZm9yIChjb25zdCBoZWFkZXJOYW1lIG9mIE9iamVjdC5rZXlzKGV2ZW50LmhlYWRlcnMpKSB7XG4gICAgICAgICAgaWYgKGhlYWRlck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gJ2FjY2VwdC1lbmNvZGluZycpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5oZWFkZXJzW2hlYWRlck5hbWVdLmluZGV4T2YoJ2d6aXAnKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgd2lsbEFjY2VwdEd6aXAgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxldCB3b3JrID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIGlmICh3aWxsQWNjZXB0R3ppcCAmJiByZXNwb25zZUJvZHkubGVuZ3RoID4gY29tcHJlc3Npb25UaHJlc2hvbGQpIHtcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnNbJ0NvbnRlbnQtRW5jb2RpbmcnXSA9ICdnemlwJztcbiAgICAgICAgICBpc0Jhc2U2NEVuY29kZWQgPSB0cnVlO1xuICAgICAgICAgIC8vIGNvbnNvbGUubG9nKGBjb21wcmVzc2luZyByZXNwb25zZSwgIHNpemUgPSAke3Jlc3BvbnNlQm9keS5sZW5ndGh9YCk7XG4gICAgICAgICAgbG9nZ2VyLmxvZyhgY29tcHJlc3NpbmcgcmVzcG9uc2UsICBzaXplID0gJHtyZXNwb25zZUJvZHkubGVuZ3RofWApO1xuICAgICAgICAgIHJlc3BvbnNlQm9keSA9IHpsaWIuZ3ppcFN5bmMocmVzcG9uc2VCb2R5KS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coYGFmdGVyIGNvbXByZXNzaW9uLCByZXNwb25zZSBzaXplID0gJHtyZXNwb25zZUJvZHkubGVuZ3RofWApXG4gICAgICAgICAgbG9nZ2VyLmxvZyhgYWZ0ZXIgY29tcHJlc3Npb24sIHJlc3BvbnNlIHNpemUgPSAke3Jlc3BvbnNlQm9keS5sZW5ndGh9YCk7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlQm9keS5sZW5ndGggPiA1MDAwMDAwKSB7XG4gICAgICAgICAgICAvLyBDb21wcmVzcyBib3RzIGFuZCBzZWUgaWYgaXQgaXMgc3RpbGwgdG9vIGJpZ1xuICAgICAgICAgICAgcmVzcG9uc2VCb2R5ID0gemxpYi5nemlwU3luYyhKU09OLnN0cmluZ2lmeShib3RzKSkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlQm9keS5sZW5ndGggPCA1MDAwMDAwKSB7XG4gICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKGBhZnRlciBjb21wcmVzc2lvbiBmb3IganVzdCBib3RzLCByZXNwb25zZSBzaXplID0gJHtyZXNwb25zZUJvZHkubGVuZ3RofWApXG4gICAgICAgICAgICAgIC8vIHJlc3BvbmQgd2l0aCB0aGUgYm90IGRhdGEgYW5kIHNlbmQgdGhlIHF1ZXVlIGRhdGEgdG8gUzNcbiAgICAgICAgICAgICAgbGV0IHF1ZXVlUGF5bG9hZCA9IHpsaWIuZ3ppcFN5bmMoSlNPTi5zdHJpbmdpZnkocXVldWVzKSkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgICAgICAgICAgICB3b3JrID0gbGVvLmF3cy5zMy51cGxvYWQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogUzNfQlVDS0VULFxuICAgICAgICAgICAgICAgIEtleTogczNQcmVmaXgsXG4gICAgICAgICAgICAgICAgQm9keTogcXVldWVQYXlsb2FkXG4gICAgICAgICAgICAgIH0sIGVyciA9PiB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coXCJkb25lIHVwbG9hZGluZyB0byBzM1wiLCBlcnIpO1xuICAgICAgICAgICAgICB9KS5wcm9taXNlKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIkVWRU4gSlVTVCBUSEUgQk9UUyBJUyBUT08gQklHXCIpO1xuICAgICAgICAgICAgICB3b3JrID0gUHJvbWlzZS5yZWplY3QoXCJwYXlsb2FkIHRvbyBiaWcgc3RpbGxcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHdvcmsudGhlbigoKSA9PiB7XG4gICAgICAgICAgY2FsbGJhY2sodW5kZWZpbmVkLCB7XG4gICAgICAgICAgICBib2R5OiByZXNwb25zZUJvZHksXG4gICAgICAgICAgICBoZWFkZXJzOiByZXNwb25zZUhlYWRlcnMsXG4gICAgICAgICAgICBpc0Jhc2U2NEVuY29kZWQsXG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDBcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSkuY2F0Y2goY2FsbGJhY2spO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soZXJyLCAoZGF0YSB8fCB7fSkuc3RhdHMpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59KTtcblxufSx7XCIuLi8uLi9saWIvc3RhdHMuanNcIjo0LFwiZnNcIjp1bmRlZmluZWQsXCJsZW8tYXV0aFwiOnVuZGVmaW5lZCxcImxlby1sb2dnZXJcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZCxcIm1vbWVudFwiOnVuZGVmaW5lZCxcIm1vbWVudC1yb3VuZFwiOnVuZGVmaW5lZCxcInpsaWJcIjp1bmRlZmluZWR9XSwyOltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXtcblwidXNlIHN0cmljdFwiO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChtaWxsaXNlY29uZHMsIHNob3dNaWxsaXNlY29uZHMpID0+IHtcbiAgaWYgKHNob3dNaWxsaXNlY29uZHMgJiYgbWlsbGlzZWNvbmRzIDwgMTAwMCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1pbGxpc2Vjb25kcykgKyAnbXMnO1xuICB9XG4gIHZhciBzZWNvbmRzID0gTWF0aC5yb3VuZChtaWxsaXNlY29uZHMgLyAxMDAwKTtcbiAgaWYgKHNlY29uZHMgPCA2MCkge1xuICAgIHJldHVybiBzZWNvbmRzICsgJ3MnO1xuICB9IGVsc2Uge1xuICAgIHZhciBtaW51dGVzID0gTWF0aC5mbG9vcihtaWxsaXNlY29uZHMgLyAoMTAwMCAqIDYwKSk7XG4gICAgaWYgKG1pbnV0ZXMgPCA2MCkge1xuICAgICAgcmV0dXJuIG1pbnV0ZXMgKyAnbScgKyAoc2Vjb25kcyAlIDYwID8gJywgJyArIHNlY29uZHMgJSA2MCArICdzJyA6ICcnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGhvdXJzID0gTWF0aC5mbG9vcihtaWxsaXNlY29uZHMgLyAoMTAwMCAqIDYwICogNjApKTtcbiAgICAgIGlmIChob3VycyA8IDI0KSB7XG4gICAgICAgIHJldHVybiBob3VycyArICdoJyArIChtaW51dGVzICUgNjAgPyAnLCAnICsgbWludXRlcyAlIDYwICsgJ20nIDogJycpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGRheXMgPSBNYXRoLmZsb29yKG1pbGxpc2Vjb25kcyAvICgxMDAwICogNjAgKiA2MCAqIDI0KSk7XG4gICAgICAgIHJldHVybiBkYXlzICsgJ2QnICsgKGhvdXJzICUgMjQgPyAnLCAnICsgaG91cnMgJSAyNCArICdoJyA6ICcnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbn0se31dLDM6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgbW9tZW50ID0gcmVxdWlyZShcIm1vbWVudFwiKTtcbnZhciBidWNrZXRzRGF0YSA9IHtcbiAgXCJtaW51dGVfMVwiOiB7XG4gICAgcGVyaW9kOiBcIm1pbnV0ZVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJtaW51dGVfXCIgKyB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdGFydE9mKFwibWludXRlXCIpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIik7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgcmV0dXJuIHRpbWVzdGFtcC5jbG9uZSgpLnV0YygpLnN0YXJ0T2YoXCJtaW51dGVcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcIm1pbnV0ZXNcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IFwibWludXRlXzVcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogMVxuICAgIH0sXG4gICAgZGVmYXVsdENvbnRhaW5lcjogXCJtaW51dGVcIixcbiAgICBkZWZhdWx0Q29udGFpbmVySW50ZXJ2YWw6IDYgKiA1XG4gIH0sXG4gIFwibWludXRlXzVcIjoge1xuICAgIHBlcmlvZDogXCJtaW51dGVfNVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfNV9cIixcbiAgICB0cmFuc2Zvcm06IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLnV0YygpLm1pbnV0ZSgpICsgNSkgJSA1O1xuICAgICAgcmV0dXJuIFwibWludXRlXzVfXCIgKyB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdWJ0cmFjdChvZmZzZXQsIFwibWludXRlc1wiKS5zdGFydE9mKFwibWludXRlXCIpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIik7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgdmFyIG9mZnNldCA9ICh0aW1lc3RhbXAudXRjKCkubWludXRlKCkgKyA1KSAlIDU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9LFxuICAgIHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAgICAgcmV0dXJuIG1vbWVudCh0aW1lc3RhbXApLnV0YygpLnN1YnRyYWN0KDUgKiAoYW1vdW50IHx8IDEpLCBcIm1pbnV0ZXNcIik7XG4gICAgfSxcbiAgICBuZXh0OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5hZGQoNSAqIChhbW91bnQgfHwgMSksIFwibWludXRlc1wiKTtcbiAgICB9LFxuICAgIHBhcmVudDogXCJtaW51dGVfMTVcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogNVxuICAgIH0sXG4gICAgZGVmYXVsdENvbnRhaW5lcjogXCJtaW51dGVcIixcbiAgICBkZWZhdWx0Q29udGFpbmVySW50ZXJ2YWw6IDYgKiAxNVxuICB9LFxuICBcIm1pbnV0ZV8xNVwiOiB7XG4gICAgcGVyaW9kOiBcIm1pbnV0ZV8xNVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfMTVfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICB2YXIgb2Zmc2V0ID0gKHRpbWVzdGFtcC51dGMoKS5taW51dGUoKSArIDE1KSAlIDE1O1xuICAgICAgcmV0dXJuIFwibWludXRlXzE1X1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpO1xuICAgIH0sXG4gICAgdmFsdWU6IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLnV0YygpLm1pbnV0ZSgpICsgMTUpICUgMTU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9LFxuICAgIHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAgICAgcmV0dXJuIG1vbWVudCh0aW1lc3RhbXApLnV0YygpLnN1YnRyYWN0KDE1ICogKGFtb3VudCB8fCAxKSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKDE1ICogKGFtb3VudCB8fCAxKSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgcGFyZW50OiBcImhvdXJcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogMTVcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiaG91clwiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogNlxuICB9LFxuICBcImhvdXJcIjoge1xuICAgIHBlcmlvZDogXCJob3VyXCIsXG4gICAgcHJlZml4OiBcImhvdXJfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJob3VyX1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImhvdXJcIikuZm9ybWF0KFwiWVlZWS1NTS1ERCBISFwiKTtcbiAgICB9LFxuICAgIHZhbHVlOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImhvdXJcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJob3VyXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcImhvdXJcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IFwiZGF5XCIsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIGg6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiaG91clwiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogMzBcbiAgfSxcbiAgXCJkYXlcIjoge1xuICAgIHBlcmlvZDogXCJkYXlcIixcbiAgICBwcmVmaXg6IFwiZGF5X1wiLFxuICAgIHRyYW5zZm9ybTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgcmV0dXJuIFwiZGF5X1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImRheVwiKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpO1xuICAgIH0sXG4gICAgdmFsdWU6IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHJldHVybiB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdGFydE9mKFwiZGF5XCIpO1xuICAgIH0sXG4gICAgcHJldjogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuc3VidHJhY3QoYW1vdW50IHx8IDEsIFwiZGF5XCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcImRheVwiKTtcbiAgICB9LFxuICAgIHBhcmVudDogXCJ3ZWVrXCIsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIGQ6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiZGF5XCIsXG4gICAgZGVmYXVsdENvbnRhaW5lckludGVydmFsOiAzMFxuICB9LFxuICBcIndlZWtcIjoge1xuICAgIHBlcmlvZDogXCJ3ZWVrXCIsXG4gICAgcHJlZml4OiBcIndlZWtfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJ3ZWVrX1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcIndlZWtcIikuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKTtcbiAgICB9LFxuICAgIHZhbHVlOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcIndlZWtcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJ3ZWVrXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcIndlZWtcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IG51bGwsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIHc6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwid2Vla1wiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogMzBcbiAgfVxufTtcbnZhciByYW5nZXMgPSB7XG4gIFwibWludXRlXCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcIm1pbnV0ZVwiKVxuICB9LFxuICBcIm1pbnV0ZV8xXCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcIm1pbnV0ZVwiKVxuICB9LFxuICBcIm1pbnV0ZV81XCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogNSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4ge1xuICAgICAgdmFyIG9mZnNldCA9ICh0aW1lc3RhbXAudXRjKCkubWludXRlKCkgKyA1KSAlIDU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9XG4gIH0sXG4gIFwibWludXRlXzE1XCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMTUsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLm1pbnV0ZSgpICsgMTUpICUgMTU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9XG4gIH0sXG4gIFwiaG91clwiOiB7XG4gICAgcGVyaW9kOiBcImhvdXJcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcImhvdXJcIiksXG4gICAgcm9sbGluZzoge1xuICAgICAgcGVyaW9kOiBcIm1pbnV0ZV8xNVwiLFxuICAgICAgY291bnQ6IDRcbiAgICB9XG4gIH0sXG4gIFwiaG91cl82XCI6IHtcbiAgICBwZXJpb2Q6IFwiaG91clwiLFxuICAgIGNvdW50OiA2LFxuICAgIHN0YXJ0T2Y6IHRpbWVzdGFtcCA9PiB0aW1lc3RhbXAuY2xvbmUoKS5zdGFydE9mKFwiaG91clwiKVxuICB9LFxuICBcImRheVwiOiB7XG4gICAgcGVyaW9kOiBcImhvdXJcIixcbiAgICBjb3VudDogMjQsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHRpbWVzdGFtcC5jbG9uZSgpLnN0YXJ0T2YoXCJkYXlcIilcbiAgfSxcbiAgXCJ3ZWVrXCI6IHtcbiAgICBwZXJpb2Q6IFwiaG91clwiLFxuICAgIGNvdW50OiAxNjgsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHRpbWVzdGFtcC5jbG9uZSgpLnN0YXJ0T2YoXCJ3ZWVrXCIpXG4gIH1cbn07XG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZGF0YTogYnVja2V0c0RhdGEsXG4gIHJhbmdlczogcmFuZ2VzXG4gIC8vIGdldEJ1Y2tldDogZnVuY3Rpb24gKHBlcmlvZCkge1xuICAvLyBcdHZhciByYW5nZSA9IHBlcmlvZDtcbiAgLy8gXHRpZiAodHlwZW9mIHBlcmlvZCA9PSBcInN0cmluZ1wiKSB7XG4gIC8vIFx0XHRyYW5nZSA9IHJhbmdlc1twZXJpb2RdXG4gIC8vIFx0fVxuICAvLyBcdGlmICghcmFuZ2UgfHwgIWJ1Y2tldHNEYXRhW3JhbmdlLnBlcmlvZF0pIHtcbiAgLy8gXHRcdHJldHVybiBudWxsO1xuICAvLyBcdH1cblxuICAvLyBcdHZhciBidWNrZXQgPSBidWNrZXRzRGF0YVtyYW5nZS5wZXJpb2RdO1xuXG4gIC8vIFx0cmV0dXJuIHtcbiAgLy8gXHRcdHByZWZpeDogYnVja2V0LnByZWZpeCxcbiAgLy8gXHRcdHRyYW5zZm9ybTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnRyYW5zZm9ybSh0aW1lc3RhbXApO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnByZXYodGltZXN0YW1wLCAoYW1vdW50IHx8IDEpICogcmFuZ2UuY291bnQpO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdG5leHQ6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnByZXYodGltZXN0YW1wLCAoYW1vdW50IHx8IDEpICogcmFuZ2UuY291bnQpO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdGR1cmF0aW9uOiBtb21lbnQuZHVyYXRpb24oYnVja2V0LmR1cmF0aW9uKSAqIHJhbmdlLmNvdW50LFxuICAvLyBcdH1cbiAgLy8gfVxufTtcblxufSx7XCJtb21lbnRcIjp1bmRlZmluZWR9XSw0OltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXtcblwidXNlIHN0cmljdFwiO1xuXG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHN0YXRzQnVja2V0cyA9IHJlcXVpcmUoXCIuL3N0YXRzLWJ1Y2tldHMuanNcIik7XG52YXIgemxpYiA9IHJlcXVpcmUoXCJ6bGliXCIpO1xudmFyIHJlZlV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xubGV0IGxvZ2dlciA9IHJlcXVpcmUoXCJsZW8tbG9nZ2VyXCIpKFwic3RhdHMtbGliXCIpO1xubGV0IG1vbWVudCA9IHJlcXVpcmUoXCJtb21lbnRcIik7XG5sZXQgbGF0ZXIgPSByZXF1aXJlKFwibGF0ZXJcIik7XG5yZXF1aXJlKFwibW9tZW50LXJvdW5kXCIpO1xubGV0IGFzeW5jID0gcmVxdWlyZShcImFzeW5jXCIpO1xubGV0IF8gPSByZXF1aXJlKCdsb2Rhc2gnKTtcbmNvbnN0IGh1bWFuaXplID0gcmVxdWlyZShcIi4vaHVtYW5pemUuanNcIik7XG5jb25zb2xlLmxvZyhsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMpO1xudmFyIENST05fVEFCTEUgPSBsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMuTGVvQ3JvbjtcbnZhciBFVkVOVF9UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9FdmVudDtcbnZhciBTWVNURU1fVEFCTEUgPSBsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMuTGVvU3lzdGVtO1xudmFyIFNUQVRTX1RBQkxFID0gbGVvLmNvbmZpZ3VyYXRpb24ucmVzb3VyY2VzLkxlb1N0YXRzO1xubGV0IHN0YXRzQ2FjaGUgPSB7fTtcbmNvbnN0IHN5c3RlbVNlZ21lbnRzID0gcGFyc2VJbnQocHJvY2Vzcy5lbnYuU1lTVEVNX1NDQU5fU0VHTUVOVFMpIHx8IDE7XG5jb25zdCBib3RTZWdtZW50cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkJPVF9TQ0FOX1NFR01FTlRTKSB8fCAxO1xuY29uc3QgcXVldWVTZWdtZW50cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlFVRVVFX1NDQU5fU0VHTUVOVFMpIHx8IDE7XG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChldmVudCwgY2FsbGJhY2spIHtcbiAgdmFyIHVzZUxhdGVzdENoZWNrcG9pbnRzID0gZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLnVzZUxhdGVzdENoZWNrcG9pbnRzID09IHRydWU7XG4gIHZhciByZXF1ZXN0X3RpbWVzdGFtcCA9IG1vbWVudChldmVudC5wYXJhbXMucXVlcnlzdHJpbmcudGltZXN0YW1wKTtcbiAgdmFyIHBlcmlvZCA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5yYW5nZTtcbiAgdmFyIG51bWJlck9mUGVyaW9kcyA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5jb3VudCB8fCAxO1xuICB2YXIgcm9sbGluZyA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5yb2xsaW5nID09IHVuZGVmaW5lZCA/IHRydWUgOiAhIWV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5yb2xsaW5nO1xuICB2YXIgaW5jbHVkZVJhd0JvdERhdGEgPSBldmVudC5pbmNsdWRlUmF3Qm90RGF0YTtcbiAgdmFyIHJhbmdlID0gc3RhdHNCdWNrZXRzLnJhbmdlc1twZXJpb2RdIHx8IHtcbiAgICBwZXJpb2Q6IHBlcmlvZCxcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLnN0YXJ0T2YocGVyaW9kLnJlcGxhY2UoL19bMC05XSskLykpXG4gIH07XG4gIHZhciBpbmNsdXNpdmVTdGFydCA9IHRydWU7XG4gIHZhciBpbmNsdXNpdmVFbmQgPSBmYWxzZTtcbiAgdmFyIGVuZE5leHRDb3VudCA9IDE7XG4gIGlmICghcm9sbGluZyAmJiByYW5nZS5zdGFydE9mKSB7XG4gICAgcmVxdWVzdF90aW1lc3RhbXAgPSByYW5nZS5zdGFydE9mKHJlcXVlc3RfdGltZXN0YW1wKTtcbiAgICBlbmROZXh0Q291bnQgPSByYW5nZS5jb3VudDtcbiAgfSBlbHNlIGlmIChyb2xsaW5nICYmIHN0YXRzQnVja2V0cy5yYW5nZXNbcGVyaW9kXSAmJiBzdGF0c0J1Y2tldHMucmFuZ2VzW3BlcmlvZF0ucm9sbGluZyAmJiBudW1iZXJPZlBlcmlvZHMgPT0gMSkge1xuICAgIHJhbmdlID0gc3RhdHNCdWNrZXRzLnJhbmdlc1twZXJpb2RdLnJvbGxpbmc7XG4gIH1cbiAgdmFyIGJ1Y2tldFV0aWxzID0gc3RhdHNCdWNrZXRzLmRhdGFbcmFuZ2UucGVyaW9kXTtcbiAgcGVyaW9kID0gYnVja2V0VXRpbHMucGVyaW9kO1xuICBsb2dnZXIubG9nKFwiUmVxdWVzdGVkIFRpbWVzdGFtcDpcIiwgcmVxdWVzdF90aW1lc3RhbXAuZm9ybWF0KCksIHJhbmdlLmNvdW50LCBudW1iZXJPZlBlcmlvZHMpO1xuICB2YXIgZW5kVGltZSA9IGJ1Y2tldFV0aWxzLnZhbHVlKGJ1Y2tldFV0aWxzLm5leHQocmVxdWVzdF90aW1lc3RhbXAuY2xvbmUoKSwgZW5kTmV4dENvdW50KSk7XG4gIHZhciBzdGFydFRpbWUgPSBidWNrZXRVdGlscy5wcmV2KGVuZFRpbWUsIHJhbmdlLmNvdW50ICogbnVtYmVyT2ZQZXJpb2RzKTtcbiAgdmFyIG91dCA9IHtcbiAgICBzdGFydDogc3RhcnRUaW1lLnZhbHVlT2YoKSxcbiAgICBlbmQ6IGVuZFRpbWUudmFsdWVPZigpLFxuICAgIHBlcmlvZDogcmFuZ2UucGVyaW9kLFxuICAgIG5vZGVzOiB7XG4gICAgICBzeXN0ZW06IHt9LFxuICAgICAgYm90OiB7fSxcbiAgICAgIHF1ZXVlOiB7fVxuICAgIH1cbiAgfTtcbiAgdmFyIGlzQ3VycmVudCA9IHRydWU7XG4gIHZhciBjb21wYXJlX3RpbWVzdGFtcCA9IHJlcXVlc3RfdGltZXN0YW1wLmNsb25lKCk7XG4gIGlmIChvdXQuZW5kIDwgbW9tZW50Lm5vdygpKSB7XG4gICAgY29tcGFyZV90aW1lc3RhbXAgPSBtb21lbnQob3V0LmVuZCk7XG4gICAgaXNDdXJyZW50ID0gZmFsc2U7XG4gIH1cbiAgaWYgKG91dC5lbmQgPj0gbW9tZW50Lm5vdygpKSB7XG4gICAgY29tcGFyZV90aW1lc3RhbXAgPSBtb21lbnQoKTtcbiAgICBpc0N1cnJlbnQgPSB0cnVlO1xuICB9XG4gIGlmIChpc0N1cnJlbnQpIHtcbiAgICB1c2VMYXRlc3RDaGVja3BvaW50cyA9IHRydWU7XG4gIH1cbiAgYXN5bmMucGFyYWxsZWwoe1xuICAgIHN5c3RlbXM6IHN5c3RlbXNQcm9jZXNzb3IsXG4gICAgcXVldWVzOiBxdWV1ZXNQcm9jZXNzb3IsXG4gICAgYm90czogYm90c1Byb2Nlc3NvcixcbiAgICBzdGF0czogc3RhdHNQcm9jZXNzb3JQYXJhbGxlbFxuICB9LCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgbG9nZ2VyLmxvZyhlcnIpO1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIG1lcmdlKHJlc3VsdHMsIGNhbGxiYWNrKTtcbiAgfSk7XG4gIGZ1bmN0aW9uIG1lcmdlKHJlc3VsdHMsIGRvbmUpIHtcbiAgICBsZXQgc3RhdHNEYXRhID0gcmVzdWx0cy5zdGF0cztcbiAgICBvdXQubm9kZXMuc3lzdGVtID0gcmVzdWx0cy5zeXN0ZW1zO1xuICAgIG91dC5ub2Rlcy5ib3QgPSByZXN1bHRzLmJvdHM7XG4gICAgb3V0Lm5vZGVzLnF1ZXVlID0gcmVzdWx0cy5xdWV1ZXM7XG5cbiAgICAvLyBQb3N0IFByb2Nlc3MgQm90c1xuICAgIE9iamVjdC5rZXlzKG91dC5ub2Rlcy5ib3QpLm1hcChrZXkgPT4ge1xuICAgICAgbGV0IGJvdCA9IG91dC5ub2Rlcy5ib3Rba2V5XTtcbiAgICAgIE9iamVjdC5rZXlzKGJvdC5saW5rX3RvLnBhcmVudCkubWFwKGtleSA9PiB7XG4gICAgICAgIGdldChrZXkpLmxpbmtfdG8uY2hpbGRyZW5bYm90LmlkXSA9IE9iamVjdC5hc3NpZ24oe30sIGJvdC5saW5rX3RvLnBhcmVudFtrZXldLCB7XG4gICAgICAgICAgaWQ6IGJvdC5pZFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgT2JqZWN0LmtleXMoYm90LmxpbmtfdG8uY2hpbGRyZW4pLm1hcChrZXkgPT4ge1xuICAgICAgICBsZXQgbGluayA9IGJvdC5saW5rX3RvLmNoaWxkcmVuW2tleV07XG4gICAgICAgIGxldCBjaGlsZCA9IGdldChrZXkpO1xuICAgICAgICBpZiAodXNlTGF0ZXN0Q2hlY2twb2ludHMgJiYgY2hpbGQubGF0ZXN0X2NoZWNrcG9pbnQgPD0gbGluay5jaGVja3BvaW50KSB7XG4gICAgICAgICAgY2hpbGQubGF0ZXN0X2NoZWNrcG9pbnQgPSBsaW5rLmNoZWNrcG9pbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHVzZUxhdGVzdENoZWNrcG9pbnRzICYmIGNoaWxkLmxhdGVzdF93cml0ZSA8PSBsaW5rLmxhc3Rfd3JpdGUpIHtcbiAgICAgICAgICBjaGlsZC5sYXRlc3Rfd3JpdGUgPSBsaW5rLmxhc3Rfd3JpdGU7XG4gICAgICAgIH1cbiAgICAgICAgY2hpbGQubGlua190by5wYXJlbnRbYm90LmlkXSA9IE9iamVjdC5hc3NpZ24oe30sIGxpbmssIHtcbiAgICAgICAgICBpZDogYm90LmlkXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBNZXJnZSBJbiBTdGF0c1xuICAgIE9iamVjdC5rZXlzKHN0YXRzRGF0YSkubWFwKGJvdElkID0+IHtcbiAgICAgIGxldCBib3RTdGF0cyA9IHN0YXRzRGF0YVtib3RJZF07XG4gICAgICBsZXQgZXhlYyA9IGJvdFN0YXRzLmV4ZWN1dGlvbjtcbiAgICAgIHZhciBib3QgPSBnZXQoYm90SWQpO1xuICAgICAgYm90LmV4ZWN1dGlvbnMgPSBleGVjLnVuaXRzO1xuICAgICAgYm90LmVycm9ycyA9IGV4ZWMuZXJyb3JzOyAvL01hdGgubWF4KGV4ZWMuZXJyb3JzLCBleGVjLnVuaXRzIC0gZXhlYy5jb21wbGV0aW9ucyk7XG4gICAgICBpZiAoYm90LmhlYWx0aCAmJiBib3QuaGVhbHRoLmVycm9yX2xpbWl0ICYmIHR5cGVvZiBib3QuaGVhbHRoLmVycm9yX2xpbWl0ID09PSAnbnVtYmVyJykge1xuICAgICAgICBib3QuZXhwZWN0LmVycm9yX2xpbWl0ID0gYm90LmhlYWx0aC5lcnJvcl9saW1pdDtcbiAgICAgIH1cbiAgICAgIGlmIChib3QuZXJyb3JzID49IDEgJiYgYm90LmVycm9ycyA+PSBib3QuZXhlY3V0aW9ucyAqIGJvdC5leHBlY3QuZXJyb3JfbGltaXQgJiYgIWJvdC5hcmNoaXZlZCkge1xuICAgICAgICBib3QuaXNBbGFybWVkID0gdHJ1ZTtcbiAgICAgICAgYm90LmFsYXJtcy5lcnJvcnMgPSB7XG4gICAgICAgICAgdmFsdWU6IGJvdC5lcnJvcnMsXG4gICAgICAgICAgbGltaXQ6IGAke2JvdC5lcnJvcnN9ID4gJHtib3QuZXhlY3V0aW9ucyAqIGJvdC5leHBlY3QuZXJyb3JfbGltaXR9YCxcbiAgICAgICAgICBtc2c6IGAgJHtib3QuZXJyb3JzfSA+ICR7Ym90LmV4ZWN1dGlvbnMgKiBib3QuZXhwZWN0LmVycm9yX2xpbWl0fWBcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJvdC5kdXJhdGlvbiA9IHtcbiAgICAgICAgbWluOiBleGVjLm1pbl9kdXJhdGlvbixcbiAgICAgICAgbWF4OiBleGVjLm1heF9kdXJhdGlvbixcbiAgICAgICAgdG90YWw6IGV4ZWMuZHVyYXRpb24sXG4gICAgICAgIGF2ZzogZXhlYy5kdXJhdGlvbiAvIGV4ZWMudW5pdHNcbiAgICAgIH07XG5cbiAgICAgIC8vIFJlYWRzXG4gICAgICBPYmplY3Qua2V5cyhib3RTdGF0cy5yZWFkKS5tYXAoa2V5ID0+IHtcbiAgICAgICAgbGV0IGxpbmtEYXRhID0gYm90U3RhdHMucmVhZFtrZXldO1xuICAgICAgICBsZXQgb3RoZXIgPSBnZXQoa2V5KTtcbiAgICAgICAgbGV0IGRhdGEgPSB7XG4gICAgICAgICAgdHlwZTogXCJyZWFkXCIsXG4gICAgICAgICAgbGFzdF9yZWFkOiBsaW5rRGF0YS50aW1lc3RhbXAsXG4gICAgICAgICAgbGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wOiBsaW5rRGF0YS5zb3VyY2VfdGltZXN0YW1wLFxuICAgICAgICAgIGNoZWNrcG9pbnQ6IGxpbmtEYXRhLmNoZWNrcG9pbnQsXG4gICAgICAgICAgdW5pdHM6IGxpbmtEYXRhLnVuaXRzLFxuICAgICAgICAgIHRlc3Q6IHRydWVcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKGlzQ3VycmVudCAmJiBvdGhlci5saW5rX3RvLmNoaWxkcmVuW2JvdC5pZF0pIHtcbiAgICAgICAgICBsZXQgY3VycmVudFN0YXRzID0gb3RoZXIubGlua190by5jaGlsZHJlbltib3QuaWRdO1xuICAgICAgICAgIGRhdGEuY2hlY2twb2ludCA9IGN1cnJlbnRTdGF0cy5jaGVja3BvaW50O1xuICAgICAgICAgIGRhdGEubGFzdF9yZWFkID0gY3VycmVudFN0YXRzLmxhc3RfcmVhZDtcbiAgICAgICAgICBkYXRhLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA9IGN1cnJlbnRTdGF0cy5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXA7XG4gICAgICAgIH1cbiAgICAgICAgYm90LmxpbmtfdG8ucGFyZW50W290aGVyLmlkXSA9IE9iamVjdC5hc3NpZ24oe30sIGRhdGEsIHtcbiAgICAgICAgICBpZDogb3RoZXIuaWRcbiAgICAgICAgfSk7XG4gICAgICAgIG90aGVyLmxpbmtfdG8uY2hpbGRyZW5bYm90LmlkXSA9IE9iamVjdC5hc3NpZ24oe30sIGRhdGEsIHtcbiAgICAgICAgICBpZDogYm90LmlkXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFdyaXRlc1xuICAgICAgT2JqZWN0LmtleXMoYm90U3RhdHMud3JpdGUpLm1hcChrZXkgPT4ge1xuICAgICAgICBsZXQgbGlua0RhdGEgPSBib3RTdGF0cy53cml0ZVtrZXldO1xuICAgICAgICBsZXQgb3RoZXIgPSBnZXQoa2V5KTtcbiAgICAgICAgbGV0IGRhdGEgPSB7XG4gICAgICAgICAgdHlwZTogXCJ3cml0ZVwiLFxuICAgICAgICAgIGxhc3Rfd3JpdGU6IGxpbmtEYXRhLnRpbWVzdGFtcCxcbiAgICAgICAgICBsYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXA6IGxpbmtEYXRhLnNvdXJjZV90aW1lc3RhbXAsXG4gICAgICAgICAgY2hlY2twb2ludDogbGlua0RhdGEuY2hlY2twb2ludCxcbiAgICAgICAgICB1bml0czogbGlua0RhdGEudW5pdHMsXG4gICAgICAgICAgdGVzdDogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICBpZiAoaXNDdXJyZW50ICYmIG90aGVyLmxpbmtfdG8ucGFyZW50W2JvdC5pZF0pIHtcbiAgICAgICAgICBsZXQgY3VycmVudFN0YXRzID0gb3RoZXIubGlua190by5wYXJlbnRbYm90LmlkXTtcbiAgICAgICAgICBkYXRhLmNoZWNrcG9pbnQgPSBjdXJyZW50U3RhdHMuY2hlY2twb2ludDtcbiAgICAgICAgICBkYXRhLmxhc3Rfd3JpdGUgPSBjdXJyZW50U3RhdHMubGFzdF93cml0ZTtcbiAgICAgICAgICBkYXRhLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA9IGN1cnJlbnRTdGF0cy5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXA7XG4gICAgICAgIH1cbiAgICAgICAgYm90LmxpbmtfdG8uY2hpbGRyZW5bb3RoZXIuaWRdID0gT2JqZWN0LmFzc2lnbih7fSwgZGF0YSwge1xuICAgICAgICAgIGlkOiBvdGhlci5pZFxuICAgICAgICB9KTtcbiAgICAgICAgb3RoZXIubGlua190by5wYXJlbnRbYm90LmlkXSA9IE9iamVjdC5hc3NpZ24oe30sIGRhdGEsIHtcbiAgICAgICAgICBpZDogYm90LmlkXG4gICAgICAgIH0pO1xuICAgICAgICBvdGhlci5sYXRlc3Rfd3JpdGUgPSBNYXRoLm1heChsaW5rRGF0YS50aW1lc3RhbXAsIG90aGVyLmxhdGVzdF93cml0ZSk7XG4gICAgICAgIGlmICghb3RoZXIubGF0ZXN0X2NoZWNrcG9pbnQgfHwgb3RoZXIubGF0ZXN0X2NoZWNrcG9pbnQubG9jYWxlQ29tcGFyZShsaW5rRGF0YS5jaGVja3BvaW50KSA8PSAwKSB7XG4gICAgICAgICAgb3RoZXIubGF0ZXN0X2NoZWNrcG9pbnQgPSBsaW5rRGF0YS5jaGVja3BvaW50O1xuICAgICAgICB9XG4gICAgICAgIDtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gUG9zdCBQcm9jZXNzIFF1ZXVlc1xuICAgIFtcInF1ZXVlXCIsIFwic3lzdGVtXCJdLm1hcCh0eXBlID0+IHtcbiAgICAgIE9iamVjdC5rZXlzKG91dC5ub2Rlc1t0eXBlXSkubWFwKGtleSA9PiB7XG4gICAgICAgIGxldCBxdWV1ZSA9IG91dC5ub2Rlc1t0eXBlXVtrZXldO1xuICAgICAgICBpZiAocXVldWUub3duZXIpIHtcbiAgICAgICAgICBxdWV1ZS5oaWRkZW4gPSB0cnVlO1xuICAgICAgICAgIGxldCBvd25lckNoZWNrID0gcXVldWUuaWQucmVwbGFjZSgvXihzeXN0ZW18Ym90KVxcLi8sICckMTonKTtcbiAgICAgICAgICBpZiAob3V0Lm5vZGVzLnN5c3RlbVtvd25lckNoZWNrXSB8fCBvdXQubm9kZXMuYm90W293bmVyQ2hlY2tdKSB7XG4gICAgICAgICAgICBxdWV1ZS5vd25lciA9IG93bmVyQ2hlY2s7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldCBvd25lciA9IGdldChxdWV1ZS5vd25lcik7XG4gICAgICAgICAgb3duZXIuc3VicXVldWVzLnB1c2gocXVldWUuaWQpO1xuICAgICAgICAgIGxldCByZWYgPSByZWZVdGlsLnJlZihxdWV1ZS5pZCk7XG4gICAgICAgICAgbGV0IHEgPSByZWYub3duZXIoKS5xdWV1ZTtcblxuICAgICAgICAgIC8vIFJlbmFtZSB0aGUgbGFiZWwgaWYgdGhlcmUgaXMgYSBzdWIgcXVldWVcbiAgICAgICAgICBpZiAocXVldWUubGFiZWwgPT09IHJlZi5pZCAmJiBxKSB7XG4gICAgICAgICAgICBxdWV1ZS5sYWJlbCA9IG93bmVyLmxhYmVsICsgXCIgLSBcIiArIHE7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUG9zdCBQcm9jZXNzaW5nIG9uIFdyaXRlIExpbmtzXG4gICAgICAgIE9iamVjdC5rZXlzKHF1ZXVlLmxpbmtfdG8ucGFyZW50KS5tYXAoa2V5ID0+IHtcbiAgICAgICAgICBsZXQgbGluayA9IHF1ZXVlLmxpbmtfdG8ucGFyZW50W2tleV07XG4gICAgICAgICAgbGV0IGJvdCA9IGdldChrZXkpO1xuICAgICAgICAgIGxldCBsaW5rMiA9IGJvdC5saW5rX3RvLmNoaWxkcmVuW3F1ZXVlLmlkXTtcbiAgICAgICAgICBsaW5rMi5ldmVudF9zb3VyY2VfbGFnID0gbGluay5ldmVudF9zb3VyY2VfbGFnID0gbW9tZW50KGxpbmsubGFzdF93cml0ZSkuZGlmZihsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCk7XG4gICAgICAgICAgbGluazIubGFzdF93cml0ZV9sYWcgPSBsaW5rLmxhc3Rfd3JpdGVfbGFnID0gY29tcGFyZV90aW1lc3RhbXAuZGlmZihsaW5rLmxhc3Rfd3JpdGUpO1xuICAgICAgICAgIGJvdC5xdWV1ZXMud3JpdGUuY291bnQrKztcbiAgICAgICAgICBib3QucXVldWVzLndyaXRlLmV2ZW50cyArPSBsaW5rLnVuaXRzO1xuICAgICAgICAgIHF1ZXVlLmJvdHMud3JpdGUuY291bnQrKztcbiAgICAgICAgICBxdWV1ZS5ib3RzLndyaXRlLmV2ZW50cyArPSBsaW5rLnVuaXRzO1xuICAgICAgICAgIGlmIChib3QuaGVhbHRoICYmIGJvdC5oZWFsdGgud3JpdGVfbGFnICYmIHR5cGVvZiBib3QuaGVhbHRoLndyaXRlX2xhZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGJvdC5leHBlY3Qud3JpdGVfbGFnID0gYm90LmhlYWx0aC53cml0ZV9sYWc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldCBub3RUcmlnZ2VyZWRPclRpbWUgPSBmYWxzZTtcbiAgICAgICAgICBpZiAoKHR5cGVvZiBib3QudHJpZ2dlcnMgPT09ICd1bmRlZmluZWQnIHx8ICFib3QudHJpZ2dlcnMubGVuZ3RoID4gMCB8fCBib3QudHJpZ2dlcnMgPT09IG51bGwpICYmICh0eXBlb2YgYm90LmZyZXF1ZW5jeSA9PT0gJ3VuZGVmaW5lZCcgfHwgYm90LmZyZXF1ZW5jeSA9PT0gJycgfHwgYm90LmZyZXF1ZW5jeSA9PT0gbnVsbCkpIHtcbiAgICAgICAgICAgIG5vdFRyaWdnZXJlZE9yVGltZSA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsaW5rLmxhc3Rfd3JpdGUgJiYgbGluay5sYXN0X3dyaXRlID49IGJvdC5xdWV1ZXMud3JpdGUubGFzdF93cml0ZSkge1xuICAgICAgICAgICAgYm90LnF1ZXVlcy53cml0ZS5sYXN0X3dyaXRlID0gbGluay5sYXN0X3dyaXRlO1xuICAgICAgICAgICAgYm90LnF1ZXVlcy53cml0ZS5sYXN0X3dyaXRlX2xhZyA9IGxpbmsubGFzdF93cml0ZV9sYWc7XG4gICAgICAgICAgICBpZiAobGluay5sYXN0X3dyaXRlX2xhZyA+PSBib3QuZXhwZWN0LndyaXRlX2xhZyAmJiAhbm90VHJpZ2dlcmVkT3JUaW1lICYmICFib3QuYXJjaGl2ZWQpIHtcbiAgICAgICAgICAgICAgYm90LmlzQWxhcm1lZCA9IHRydWU7XG4gICAgICAgICAgICAgIGJvdC5hbGFybXMud3JpdGVfbGFnID0ge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBodW1hbml6ZShsaW5rLmxhc3Rfd3JpdGVfbGFnKSxcbiAgICAgICAgICAgICAgICBsaW1pdDogaHVtYW5pemUoYm90LmV4cGVjdC53cml0ZV9sYWcpLFxuICAgICAgICAgICAgICAgIG1zZzogYCR7aHVtYW5pemUobGluay5sYXN0X3dyaXRlX2xhZyl9ID4gJHtodW1hbml6ZShib3QuZXhwZWN0LndyaXRlX2xhZyl9YFxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGluay5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXAgJiYgbGluay5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXAgPj0gYm90LnF1ZXVlcy53cml0ZS5sYXN0X3NvdXJjZSkge1xuICAgICAgICAgICAgYm90LnF1ZXVlcy53cml0ZS5sYXN0X3NvdXJjZSA9IGxpbmsubGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wO1xuICAgICAgICAgICAgYm90LnF1ZXVlcy53cml0ZS5sYXN0X3NvdXJjZV9sYWcgPSBsaW5rLmV2ZW50X3NvdXJjZV9sYWc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsaW5rLmxhc3Rfd3JpdGUgJiYgbGluay5sYXN0X3dyaXRlID49IHF1ZXVlLmJvdHMud3JpdGUubGFzdF93cml0ZSkge1xuICAgICAgICAgICAgcXVldWUuYm90cy53cml0ZS5sYXN0X3dyaXRlID0gbGluay5sYXN0X3dyaXRlO1xuICAgICAgICAgICAgcXVldWUuYm90cy53cml0ZS5sYXN0X3dyaXRlX2xhZyA9IGxpbmsubGFzdF93cml0ZV9sYWc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCAmJiBsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA+PSBxdWV1ZS5ib3RzLndyaXRlLmxhc3Rfc291cmNlKSB7XG4gICAgICAgICAgICBxdWV1ZS5ib3RzLndyaXRlLmxhc3Rfc291cmNlID0gbGluay5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXA7XG4gICAgICAgICAgICBxdWV1ZS5ib3RzLndyaXRlLmxhc3Rfc291cmNlX2xhZyA9IGxpbmsuZXZlbnRfc291cmNlX2xhZztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBJZiB0aGlzIGlzIGEgc3ViIHF1ZXVlIG9mIGEgYm90L3N5c3RlbSwgbGluayB0byB0aGUgb3duZXIgaW5zdGVhZFxuICAgICAgICAgIGlmIChxdWV1ZS5vd25lcikge1xuICAgICAgICAgICAgdmFyIG93bmVyID0gZ2V0KHF1ZXVlLm93bmVyKTtcbiAgICAgICAgICAgIGlmIChvd25lci5xdWV1ZSA9PT0gcXVldWUuaWQpIHtcbiAgICAgICAgICAgICAgdmFyIGwgPSBvd25lci5saW5rX3RvLnBhcmVudFtrZXldO1xuICAgICAgICAgICAgICBvd25lci5saW5rX3RvLnBhcmVudFtrZXldID0gT2JqZWN0LmFzc2lnbih7fSwgbCwgbGluayk7XG4gICAgICAgICAgICAgIGRlbGV0ZSBxdWV1ZS5saW5rX3RvLnBhcmVudFtrZXldO1xuICAgICAgICAgICAgICBkZWxldGUgYm90LmxpbmtfdG8uY2hpbGRyZW5bcXVldWUuaWRdO1xuICAgICAgICAgICAgICBib3QubGlua190by5jaGlsZHJlbltvd25lci5pZF0gPSBPYmplY3QuYXNzaWduKGxpbmsyLCB7XG4gICAgICAgICAgICAgICAgaWQ6IG93bmVyLmlkXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUG9zdCBQcm9jZXNzaW5nIG9uIFJlYWQgTGlua3NcbiAgICAgICAgT2JqZWN0LmtleXMocXVldWUubGlua190by5jaGlsZHJlbikubWFwKGtleSA9PiB7XG4gICAgICAgICAgdmFyIGxpbmsgPSBxdWV1ZS5saW5rX3RvLmNoaWxkcmVuW2tleV07XG4gICAgICAgICAgdmFyIGJvdCA9IGdldChrZXkpO1xuICAgICAgICAgIHZhciBsaW5rMiA9IGJvdC5saW5rX3RvLnBhcmVudFtxdWV1ZS5pZF07XG4gICAgICAgICAgaWYgKGxpbmsuY2hlY2twb2ludCA8IHF1ZXVlLmxhdGVzdF9jaGVja3BvaW50KSB7XG4gICAgICAgICAgICBsaW5rLmV2ZW50X3NvdXJjZV9sYWcgPSBjb21wYXJlX3RpbWVzdGFtcC5kaWZmKGxpbmsubGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wKTtcbiAgICAgICAgICAgIGxpbmsubGFzdF9yZWFkX2xhZyA9IGNvbXBhcmVfdGltZXN0YW1wLmRpZmYobGluay5sYXN0X3JlYWQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAobGluay5jaGVja3BvaW50ID49IHF1ZXVlLmxhdGVzdF9jaGVja3BvaW50KSB7XG4gICAgICAgICAgICBsaW5rLmV2ZW50X3NvdXJjZV9sYWcgPSAwO1xuICAgICAgICAgICAgbGluay5sYXN0X3JlYWRfbGFnID0gMDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGluay5ldmVudF9zb3VyY2VfbGFnID0gbnVsbDtcbiAgICAgICAgICAgIGxpbmsubGFzdF9yZWFkX2xhZyA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxpbmsyLmV2ZW50X3NvdXJjZV9sYWcgPSBsaW5rLmV2ZW50X3NvdXJjZV9sYWc7XG4gICAgICAgICAgbGluazIubGFzdF9yZWFkX2xhZyA9IGxpbmsubGFzdF9yZWFkX2xhZztcbiAgICAgICAgICBib3QucXVldWVzLnJlYWQuY291bnQrKztcbiAgICAgICAgICBib3QucXVldWVzLnJlYWQuZXZlbnRzICs9IGxpbmsudW5pdHM7XG4gICAgICAgICAgcXVldWUuYm90cy5yZWFkLmNvdW50Kys7XG4gICAgICAgICAgcXVldWUuYm90cy5yZWFkLmV2ZW50cyArPSBsaW5rLnVuaXRzO1xuICAgICAgICAgIGlmIChib3QuaGVhbHRoICYmIGJvdC5oZWFsdGguc291cmNlX2xhZyAmJiB0eXBlb2YgYm90LmhlYWx0aC5zb3VyY2VfbGFnID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgYm90LmV4cGVjdC5zb3VyY2VfbGFnID0gYm90LmhlYWx0aC5zb3VyY2VfbGFnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGluay5sYXN0X3JlYWQgJiYgbGluay5sYXN0X3JlYWQgPj0gYm90LnF1ZXVlcy5yZWFkLmxhc3RfcmVhZCkge1xuICAgICAgICAgICAgYm90LnF1ZXVlcy5yZWFkLmxhc3RfcmVhZCA9IGxpbmsubGFzdF9yZWFkO1xuICAgICAgICAgICAgYm90LnF1ZXVlcy5yZWFkLmxhc3RfcmVhZF9sYWcgPSBsaW5rLmxhc3RfcmVhZF9sYWc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldCBub3RUcmlnZ2VyZWRPclRpbWUgPSBmYWxzZTtcbiAgICAgICAgICBpZiAoKHR5cGVvZiBib3QudHJpZ2dlcnMgPT09ICd1bmRlZmluZWQnIHx8ICFib3QudHJpZ2dlcnMubGVuZ3RoID4gMCB8fCBib3QudHJpZ2dlcnMgPT09IG51bGwpICYmICh0eXBlb2YgYm90LmZyZXF1ZW5jeSA9PT0gJ3VuZGVmaW5lZCcgfHwgYm90LmZyZXF1ZW5jeSA9PT0gJycgfHwgYm90LmZyZXF1ZW5jeSA9PT0gbnVsbCkpIHtcbiAgICAgICAgICAgIG5vdFRyaWdnZXJlZE9yVGltZSA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCAmJiBsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA+PSBib3QucXVldWVzLnJlYWQubGFzdF9zb3VyY2UpIHtcbiAgICAgICAgICAgIGJvdC5xdWV1ZXMucmVhZC5sYXN0X3NvdXJjZSA9IGxpbmsubGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wO1xuICAgICAgICAgICAgYm90LnF1ZXVlcy5yZWFkLmxhc3Rfc291cmNlX2xhZyA9IGxpbmsuZXZlbnRfc291cmNlX2xhZztcbiAgICAgICAgICAgIGlmIChsaW5rLmV2ZW50X3NvdXJjZV9sYWcgPiBib3QuZXhwZWN0LnNvdXJjZV9sYWcgJiYgIW5vdFRyaWdnZXJlZE9yVGltZSAmJiAhYm90LmFyY2hpdmVkKSB7XG4gICAgICAgICAgICAgIGJvdC5pc0FsYXJtZWQgPSB0cnVlO1xuICAgICAgICAgICAgICBib3QuYWxhcm1zLnNvdXJjZV9sYWcgPSB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGh1bWFuaXplKGxpbmsuZXZlbnRfc291cmNlX2xhZyksXG4gICAgICAgICAgICAgICAgbGltaXQ6IGh1bWFuaXplKGJvdC5leHBlY3Quc291cmNlX2xhZyksXG4gICAgICAgICAgICAgICAgbXNnOiBgICR7aHVtYW5pemUobGluay5ldmVudF9zb3VyY2VfbGFnKX0gPiAke2h1bWFuaXplKGJvdC5leHBlY3Quc291cmNlX2xhZyl9YFxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGluay5sYXN0X3JlYWQgJiYgbGluay5sYXN0X3JlYWQgPj0gcXVldWUuYm90cy5yZWFkLmxhc3RfcmVhZCkge1xuICAgICAgICAgICAgcXVldWUuYm90cy5yZWFkLmxhc3RfcmVhZCA9IGxpbmsubGFzdF9yZWFkO1xuICAgICAgICAgICAgcXVldWUuYm90cy5yZWFkLmxhc3RfcmVhZF9sYWcgPSBsaW5rLmxhc3RfcmVhZF9sYWc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCAmJiBsaW5rLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA+PSBxdWV1ZS5ib3RzLnJlYWQubGFzdF9zb3VyY2UpIHtcbiAgICAgICAgICAgIHF1ZXVlLmJvdHMucmVhZC5sYXN0X3NvdXJjZSA9IGxpbmsubGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wO1xuICAgICAgICAgICAgcXVldWUuYm90cy5yZWFkLmxhc3Rfc291cmNlX2xhZyA9IGxpbmsuZXZlbnRfc291cmNlX2xhZztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBJZiB0aGlzIGlzIGEgc3ViIHF1ZXVlIG9mIGEgYm90L3N5c3RlbSwgbGluayB0byB0aGUgb3duZXIgaW5zdGVhZFxuICAgICAgICAgIGlmIChxdWV1ZS5vd25lcikge1xuICAgICAgICAgICAgdmFyIG93bmVyID0gZ2V0KHF1ZXVlLm93bmVyKTtcbiAgICAgICAgICAgIGlmIChvd25lci5xdWV1ZSA9PT0gcXVldWUuaWQpIHtcbiAgICAgICAgICAgICAgdmFyIGwgPSBvd25lci5saW5rX3RvLmNoaWxkcmVuW2tleV07XG4gICAgICAgICAgICAgIG93bmVyLmxpbmtfdG8uY2hpbGRyZW5ba2V5XSA9IE9iamVjdC5hc3NpZ24oe30sIGwsIGxpbmspO1xuICAgICAgICAgICAgICBkZWxldGUgcXVldWUubGlua190by5jaGlsZHJlbltrZXldO1xuICAgICAgICAgICAgICBkZWxldGUgYm90LmxpbmtfdG8ucGFyZW50W3F1ZXVlLmlkXTtcbiAgICAgICAgICAgICAgYm90LmxpbmtfdG8ucGFyZW50W293bmVyLmlkXSA9IE9iamVjdC5hc3NpZ24obGluazIsIHtcbiAgICAgICAgICAgICAgICBpZDogb3duZXIuaWRcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIG91dC5nZXQgPSBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIHZhciByZWYgPSByZWZVdGlsLnJlZihpZCk7XG4gICAgICByZXR1cm4gdGhpcy5ub2Rlc1tyZWYudHlwZV1bcmVmLnJlZklkKCldO1xuICAgIH07XG4gICAgZG9uZShudWxsLCB7XG4gICAgICBzdGF0czogb3V0XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gc3RhdHNQcm9jZXNzb3JQYXJhbGxlbChkb25lKSB7XG4gICAgLy8gY29uc29sZS50aW1lKFwiU1RBVFMgUVVFUlkgUEFSQUxMRUxcIik7XG4gICAgLy8gV2Uga25vdyB0aGF0IGJ5IGRlZmF1bHQgZW5kIC0gc3RhcnQgfj0gMTUgbWludXRlcyAoZ2l2ZSBvciB0YWtlIGEgc2Vjb25kKVxuICAgIC8vIFdlIHdhbnQgdG8gY2h1bmsgdGhpcyB1cCBpbnRvIDIgbWludXRlIGNodW5rc1xuICAgIGxldCBzdGFydCA9IG91dC5zdGFydCArICghaW5jbHVzaXZlU3RhcnQgPyAxIDogMCk7XG4gICAgbGV0IGVuZCA9IG91dC5lbmQgLSAoIWluY2x1c2l2ZUVuZCA/IDEgOiAwKTtcbiAgICBsZXQgdGltZVNwYW5zID0gc3BsaXRUaW1lKHN0YXJ0LCBlbmQpO1xuICAgIGxldCBxdWVyaWVzID0gW107XG4gICAgZm9yIChjb25zdCBzcGFuIG9mIHRpbWVTcGFucykge1xuICAgICAgbGV0IHF1ZXJ5ID0ge1xuICAgICAgICBUYWJsZU5hbWU6IFNUQVRTX1RBQkxFLFxuICAgICAgICBJbmRleE5hbWU6IFwicGVyaW9kLXRpbWUtaW5kZXhcIixcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogXCIjcGVyaW9kID0gOnBlcmlvZCBhbmQgI3RpbWUgYmV0d2VlbiA6c3RhcnQgYW5kIDplbmRcIixcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgXCIjdGltZVwiOiBcInRpbWVcIixcbiAgICAgICAgICBcIiNwZXJpb2RcIjogXCJwZXJpb2RcIlxuICAgICAgICB9LFxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgXCI6c3RhcnRcIjogc3Bhbi5zdGFydCxcbiAgICAgICAgICBcIjplbmRcIjogc3Bhbi5lbmQsXG4gICAgICAgICAgXCI6cGVyaW9kXCI6IHBlcmlvZFxuICAgICAgICB9LFxuICAgICAgICBcIlJldHVybkNvbnN1bWVkQ2FwYWNpdHlcIjogJ1RPVEFMJ1xuICAgICAgfTtcbiAgICAgIHF1ZXJpZXMucHVzaChxdWVyeSk7XG4gICAgfVxuICAgIHBhcmFsbGVsUXVlcnkocXVlcmllcywge1xuICAgICAgbWI6IDEwMFxuICAgIH0sIG1lcmdlU3RhdHNSZXN1bHRzKS50aGVuKGRhdGEgPT4ge1xuICAgICAgLy8gY29uc29sZS50aW1lRW5kKFwiU1RBVFMgUVVFUlkgUEFSQUxMRUxcIik7XG4gICAgICBkb25lKG51bGwsIGRhdGEpO1xuICAgIH0pLmNhdGNoKGRvbmUpO1xuICB9XG4gIGZ1bmN0aW9uIHN0YXRzUHJvY2Vzc29yKGRvbmUpIHtcbiAgICBsZXQgc3RhcnQgPSBvdXQuc3RhcnQgKyAoIWluY2x1c2l2ZVN0YXJ0ID8gMSA6IDApO1xuICAgIGxldCBlbmQgPSBvdXQuZW5kIC0gKCFpbmNsdXNpdmVFbmQgPyAxIDogMCk7XG4gICAgLy8gUXVlcnkgZm9yIGFsbCB0aGUgcmVjb3JkcyBpbiB0aGUgJ3BlcmlvZC10aW1lLWluZGV4JyB3aGVyZSAncGVyaW9kJyA9IG1pbnV0ZSBBTkQgKHRpbWUgPiBzdGFydCBBTkQgdGltZSA8IGVuZClcbiAgICBsZW8uYXdzLmR5bmFtb2RiLnF1ZXJ5KHtcbiAgICAgIFRhYmxlTmFtZTogU1RBVFNfVEFCTEUsXG4gICAgICBJbmRleE5hbWU6IFwicGVyaW9kLXRpbWUtaW5kZXhcIixcbiAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246IFwiI3BlcmlvZCA9IDpwZXJpb2QgYW5kICN0aW1lIGJldHdlZW4gOnN0YXJ0IGFuZCA6ZW5kXCIsXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgXCIjdGltZVwiOiBcInRpbWVcIixcbiAgICAgICAgXCIjcGVyaW9kXCI6IFwicGVyaW9kXCJcbiAgICAgIH0sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgIFwiOnN0YXJ0XCI6IHN0YXJ0LFxuICAgICAgICBcIjplbmRcIjogZW5kLFxuICAgICAgICBcIjpwZXJpb2RcIjogcGVyaW9kXG4gICAgICB9LFxuICAgICAgXCJSZXR1cm5Db25zdW1lZENhcGFjaXR5XCI6ICdUT1RBTCdcbiAgICB9LCB7XG4gICAgICBtYjogMTAwXG4gICAgfSkuY2F0Y2goZXJyID0+IGRvbmUoZXJyKSlcbiAgICAvLyBUYWtlIHRoZSByZXNwb25zZSBhbmQgbWVyZ2UgaXQgdG9nZXRoZXJcbiAgICAudGhlbihidWNrZXRzU3RhdHMgPT4ge1xuICAgICAgbG9nZ2VyLmxvZyhwZXJpb2QsIGJ1Y2tldHNTdGF0cy5MYXN0RXZhbHVhdGVkS2V5LCBidWNrZXRzU3RhdHMuQ29uc3VtZWRDYXBhY2l0eSwgYnVja2V0c1N0YXRzLkl0ZW1zLmxlbmd0aCk7XG4gICAgICB2YXIgb3V0ID0ge307XG4gICAgICB2YXIgZXhlY3V0aW9uRGVmYXVsdHMgPSB7XG4gICAgICAgIGNvbXBsZXRpb25zOiAwLFxuICAgICAgICBkdXJhdGlvbjogMCxcbiAgICAgICAgbWF4X2R1cmF0aW9uOiAwLFxuICAgICAgICBtaW5fZHVyYXRpb246IDAsXG4gICAgICAgIGVycm9yczogMCxcbiAgICAgICAgdW5pdHM6IDBcbiAgICAgIH07XG4gICAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIGNoZWNrcG9pbnQ6IDAsXG4gICAgICAgIHNvdXJjZV90aW1lc3RhbXA6IDAsXG4gICAgICAgIHRpbWVzdGFtcDogMCxcbiAgICAgICAgdW5pdHM6IDBcbiAgICAgIH07XG5cbiAgICAgIC8vIGxvb3AgdGhyb3VnaCBlYWNoIHJlY29yZCBhbmQgbWVyZ2UgdGhlIHN0YXRzIGZvciBlYWNoIHJlY29yZFxuICAgICAgYnVja2V0c1N0YXRzLkl0ZW1zLm1hcChzdGF0ID0+IHtcbiAgICAgICAgLy9pZiAoc3RhdC5pZC5tYXRjaCgvXmJvdDovKSkge1xuICAgICAgICBpZiAoIShzdGF0LmlkIGluIG91dCkpIHtcbiAgICAgICAgICBvdXRbc3RhdC5pZF0gPSB7XG4gICAgICAgICAgICBleGVjdXRpb246IE9iamVjdC5hc3NpZ24oe30sIGV4ZWN1dGlvbkRlZmF1bHRzKSxcbiAgICAgICAgICAgIHJlYWQ6IHt9LFxuICAgICAgICAgICAgd3JpdGU6IHt9XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbm9kZSA9IG91dFtzdGF0LmlkXTtcbiAgICAgICAgaWYgKHN0YXQuY3VycmVudC5leGVjdXRpb24pIHtcbiAgICAgICAgICBub2RlLmV4ZWN1dGlvbiA9IG1lcmdlRXhlY3V0aW9uU3RhdHMobm9kZS5leGVjdXRpb24sIHN0YXQuY3VycmVudC5leGVjdXRpb24pO1xuICAgICAgICB9XG4gICAgICAgIFtcInJlYWRcIiwgXCJ3cml0ZVwiXS5tYXAodHlwZSA9PiB7XG4gICAgICAgICAgT2JqZWN0LmtleXMoc3RhdC5jdXJyZW50W3R5cGVdIHx8IHt9KS5tYXAoa2V5ID0+IHtcbiAgICAgICAgICAgIGlmICghKGtleSBpbiBub2RlW3R5cGVdKSkge1xuICAgICAgICAgICAgICBub2RlW3R5cGVdW2tleV0gPSBPYmplY3QuYXNzaWduKHt9LCBkZWZhdWx0cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlW3R5cGVdW2tleV0gPSBtZXJnZVN0YXRzKG5vZGVbdHlwZV1ba2V5XSwgc3RhdC5jdXJyZW50W3R5cGVdW2tleV0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgZG9uZShudWxsLCBvdXQpO1xuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIGdldChpZCwgdHlwZSkge1xuICAgIGxldCByZWYgPSByZWZVdGlsLnJlZihpZCwgdHlwZSk7XG4gICAgbGV0IHJldCA9IG91dC5ub2Rlc1tyZWYudHlwZV1bcmVmLnJlZklkKCldO1xuICAgIGlmICghcmV0KSB7XG4gICAgICBvdXQubm9kZXNbcmVmLnR5cGVdW3JlZi5yZWZJZCgpXSA9IHJldCA9IGNyZWF0ZShyZWYpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXQuYWxhcm1zID0gcmV0LmFsYXJtcyB8fCB7fTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuICBmdW5jdGlvbiBjcmVhdGUocmVmKSB7XG4gICAgaWYgKHJlZi50eXBlID09PSBcInN5c3RlbVwiKSB7XG4gICAgICByZXR1cm4gY3JlYXRlU3lzdGVtKHJlZik7XG4gICAgfSBlbHNlIGlmIChyZWYudHlwZSA9PT0gXCJxdWV1ZVwiKSB7XG4gICAgICByZXR1cm4gY3JlYXRlUXVldWUocmVmKTtcbiAgICB9IGVsc2UgaWYgKHJlZi50eXBlID09PSBcImJvdFwiKSB7XG4gICAgICByZXR1cm4gY3JlYXRlQm90KHJlZik7XG4gICAgfVxuICB9XG4gIGZ1bmN0aW9uIGNyZWF0ZVN5c3RlbShzeXN0ZW1JZCkge1xuICAgIGxldCByZWYgPSByZWZVdGlsLnJlZihzeXN0ZW1JZCwgXCJzeXN0ZW1cIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiByZWYucmVmSWQoKSxcbiAgICAgIHR5cGU6ICdzeXN0ZW0nLFxuICAgICAgaWNvbjogXCJzeXN0ZW0ucG5nXCIsXG4gICAgICB0YWdzOiAnJyxcbiAgICAgIGxhYmVsOiByZWYuaWQsXG4gICAgICBjcm9uczogW10sXG4gICAgICBjaGVja3N1bXM6IGZhbHNlLFxuICAgICAgaGVhcnRiZWF0OiB7fSxcbiAgICAgIHF1ZXVlOiByZWYuYXNRdWV1ZSgpLnJlZklkKCksXG4gICAgICBzdWJxdWV1ZXM6IFtdLFxuICAgICAgYm90czoge1xuICAgICAgICByZWFkOiB7XG4gICAgICAgICAgY291bnQ6IDAsXG4gICAgICAgICAgZXZlbnRzOiAwLFxuICAgICAgICAgIGxhc3RfcmVhZDogbnVsbCxcbiAgICAgICAgICBsYXN0X3JlYWRfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB3cml0ZToge1xuICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgIGV2ZW50czogMCxcbiAgICAgICAgICBsYXN0X3dyaXRlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfd3JpdGVfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgbGlua190bzoge1xuICAgICAgICBwYXJlbnQ6IHt9LFxuICAgICAgICBjaGlsZHJlbjoge31cbiAgICAgIH0sXG4gICAgICBsb2dzOiB7XG4gICAgICAgIGVycm9yczogW10sXG4gICAgICAgIG5vdGljZXM6IFtdXG4gICAgICB9XG4gICAgfTtcbiAgfVxuICBmdW5jdGlvbiBjcmVhdGVRdWV1ZShxdWV1ZUlkKSB7XG4gICAgbGV0IHJlZiA9IHJlZlV0aWwucmVmKHF1ZXVlSWQsIFwicXVldWVcIik7XG4gICAgbGV0IG93bmVyID0gcmVmLm93bmVyKCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiByZWYucmVmSWQoKSxcbiAgICAgIHR5cGU6ICdxdWV1ZScsXG4gICAgICBpY29uOiByZWYuaWQubWF0Y2goL14oY29tbWFuZHN8bGVvKVxcLi8pID8gXCJpY29ucy9idXMucG5nXCIgOiBcInF1ZXVlLnBuZ1wiLFxuICAgICAgbGFiZWw6IHJlZi5pZCxcbiAgICAgIGxhdGVzdF9jaGVja3BvaW50OiAnJyxcbiAgICAgIGxhdGVzdF93cml0ZTogMCxcbiAgICAgIHRhZ3M6ICcnLFxuICAgICAgcXVldWU6IHJlZi5hc1F1ZXVlKCkucmVmSWQoKSxcbiAgICAgIG93bmVyOiBvd25lciAmJiBvd25lci5yZWZJZCgpLFxuICAgICAgYm90czoge1xuICAgICAgICByZWFkOiB7XG4gICAgICAgICAgY291bnQ6IDAsXG4gICAgICAgICAgZXZlbnRzOiAwLFxuICAgICAgICAgIGxhc3RfcmVhZDogbnVsbCxcbiAgICAgICAgICBsYXN0X3JlYWRfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB3cml0ZToge1xuICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgIGV2ZW50czogMCxcbiAgICAgICAgICBsYXN0X3dyaXRlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfd3JpdGVfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgbGlua190bzoge1xuICAgICAgICBwYXJlbnQ6IHt9LFxuICAgICAgICBjaGlsZHJlbjoge31cbiAgICAgIH0sXG4gICAgICBsb2dzOiB7XG4gICAgICAgIGVycm9yczogW10sXG4gICAgICAgIG5vdGljZXM6IFtdXG4gICAgICB9XG4gICAgfTtcbiAgfVxuICBmdW5jdGlvbiBjcmVhdGVCb3QoYm90SWQpIHtcbiAgICBsZXQgcmVmID0gcmVmVXRpbC5yZWYoYm90SWQsIFwiYm90XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBpZDogcmVmLnJlZklkKCksXG4gICAgICBsYW1iZGFOYW1lOiByZWYubGFtYmRhTmFtZSxcbiAgICAgIHR5cGU6ICdib3QnLFxuICAgICAgc3RhdHVzOiAncnVubmluZycsXG4gICAgICByb2d1ZTogZmFsc2UsXG4gICAgICBsYWJlbDogcmVmLmlkLFxuICAgICAgZXhlY3V0aW9uczogMCxcbiAgICAgIGVycm9yczogMCxcbiAgICAgIHN5c3RlbTogbnVsbCxcbiAgICAgIGlzQWxhcm1lZDogZmFsc2UsXG4gICAgICByZWFkQ2F1Z2h0VXA6IGZhbHNlLFxuICAgICAgYWxhcm1zOiB7fSxcbiAgICAgIHNvdXJjZTogZmFsc2UsXG4gICAgICBsYXN0X3J1bjoge1xuICAgICAgICBzdGFydDogbnVsbCxcbiAgICAgICAgZW5kOiBudWxsXG4gICAgICB9LFxuICAgICAgZXhwZWN0OiB7XG4gICAgICAgIHdyaXRlX2xhZzogMTAwMCAqIDYwICogMTQzODU2MCxcbiAgICAgICAgc291cmNlX2xhZzogMTAwMCAqIDYwICogMi41LFxuICAgICAgICBlcnJvcl9saW1pdDogLjUsXG4gICAgICAgIGNvbnNlY3V0aXZlX2Vycm9yczogMlxuICAgICAgfSxcbiAgICAgIHRlbXBsYXRlSWQ6IFwiQ3VzdG9tXCIsXG4gICAgICBzdWJxdWV1ZXM6IFtdLFxuICAgICAgcXVldWU6IHJlZi5hc1F1ZXVlKCkucmVmSWQoKSxcbiAgICAgIHF1ZXVlczoge1xuICAgICAgICByZWFkOiB7XG4gICAgICAgICAgY291bnQ6IDAsXG4gICAgICAgICAgZXZlbnRzOiAwLFxuICAgICAgICAgIGxhc3RfcmVhZDogbnVsbCxcbiAgICAgICAgICBsYXN0X3JlYWRfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB3cml0ZToge1xuICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgIGV2ZW50czogMCxcbiAgICAgICAgICBsYXN0X3dyaXRlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfd3JpdGVfbGFnOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlOiBudWxsLFxuICAgICAgICAgIGxhc3Rfc291cmNlX2xhZzogbnVsbFxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgZHVyYXRpb246IHtcbiAgICAgICAgbWluOiAwLFxuICAgICAgICBtYXg6IDAsXG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBhdmc6IDBcbiAgICAgIH0sXG4gICAgICBsaW5rX3RvOiB7XG4gICAgICAgIHBhcmVudDoge30sXG4gICAgICAgIGNoaWxkcmVuOiB7fVxuICAgICAgfSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZXJyb3JzOiBbXSxcbiAgICAgICAgbm90aWNlczogW11cbiAgICAgIH1cbiAgICB9O1xuICB9XG4gIGZ1bmN0aW9uIHN5c3RlbXNQcm9jZXNzb3IoZG9uZSkge1xuICAgIHBhcmFsbGVsU2Nhbih7XG4gICAgICBUYWJsZU5hbWU6IFNZU1RFTV9UQUJMRSxcbiAgICAgIFwiUmV0dXJuQ29uc3VtZWRDYXBhY2l0eVwiOiAnVE9UQUwnXG4gICAgfSwge1xuICAgICAgbWV0aG9kOiBcInNjYW5cIixcbiAgICAgIG1iOiAxXG4gICAgfSwgc3lzdGVtU2VnbWVudHMpLnRoZW4oZGF0YSA9PiB7XG4gICAgICB2YXIgc3lzdGVtcyA9IHt9O1xuICAgICAgZGF0YS5JdGVtcy5tYXAoc3lzdGVtID0+IHtcbiAgICAgICAgbGV0IHMgPSBjcmVhdGVTeXN0ZW0oc3lzdGVtLmlkKTtcbiAgICAgICAgcy5sYWJlbCA9IHN5c3RlbS5sYWJlbCB8fCBzeXN0ZW0uaWQ7XG4gICAgICAgIHMuaWNvbiA9IHN5c3RlbS5pY29uO1xuICAgICAgICBzLmNyb25zID0gc3lzdGVtLmNyb25zO1xuICAgICAgICBzeXN0ZW1zW3MuaWRdID0gT2JqZWN0LmFzc2lnbihzeXN0ZW0sIHMpO1xuICAgICAgfSk7XG4gICAgICBkb25lKG51bGwsIHN5c3RlbXMpO1xuICAgIH0pLmNhdGNoKGRvbmUpO1xuICB9XG4gIGZ1bmN0aW9uIHF1ZXVlc1Byb2Nlc3Nvcihkb25lKSB7XG4gICAgLy8gY29uc29sZS50aW1lKFwiUVVFVUVTIFFVRVJZXCIpO1xuICAgIHBhcmFsbGVsU2Nhbih7XG4gICAgICBUYWJsZU5hbWU6IEVWRU5UX1RBQkxFLFxuICAgICAgXCJSZXR1cm5Db25zdW1lZENhcGFjaXR5XCI6ICdUT1RBTCdcbiAgICB9LCB7XG4gICAgICBtZXRob2Q6IFwic2NhblwiLFxuICAgICAgbWI6IDEwMFxuICAgIH0sIHF1ZXVlU2VnbWVudHMpLnRoZW4oZGF0YSA9PiB7XG4gICAgICAvLyBjb25zb2xlLnRpbWVFbmQoXCJRVUVVRVMgUVVFUllcIik7XG4gICAgICAvLyBjb25zb2xlLmxvZyhgUVVFVUVTIFFVRVJZICR7SlNPTi5zdHJpbmdpZnkoZGF0YS5fc3RhdHMpfWApO1xuICAgICAgdmFyIHF1ZXVlcyA9IHt9O1xuICAgICAgZGF0YS5JdGVtcy5tYXAocXVldWUgPT4ge1xuICAgICAgICBpZiAoIXF1ZXVlLmFyY2hpdmVkKSB7XG4gICAgICAgICAgbGV0IHEgPSBjcmVhdGVRdWV1ZShxdWV1ZS5ldmVudCk7XG4gICAgICAgICAgaWYgKCEocS5pZC5tYXRjaCgvXFwvX2FyY2hpdmUkL2cpIHx8IHEuaWQubWF0Y2goL1xcL19zbmFwc2hvdCQvZykpKSB7XG4gICAgICAgICAgICBxLmxhYmVsID0gcXVldWUubmFtZSB8fCBxLmxhYmVsO1xuICAgICAgICAgICAgcS50YWdzID0gcXVldWUub3RoZXIgJiYgcXVldWUudGFncyB8fCAnJztcbiAgICAgICAgICAgIHEuYXJjaGl2ZWQgPSBxdWV1ZS5hcmNoaXZlZDtcbiAgICAgICAgICAgIHEub3duZXIgPSBxdWV1ZS5vd25lciB8fCBxLm93bmVyO1xuICAgICAgICAgICAgcXVldWVzW3EuaWRdID0gcTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbG9nZ2VyLmRlYnVnKGAke3F1ZXVlLmlkfSBpcyBhcmNoaXZlZCBza2lwcGluZyBmb3Igbm93YCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZG9uZShudWxsLCBxdWV1ZXMpO1xuICAgIH0pLmNhdGNoKGRvbmUpO1xuICB9XG4gIGZ1bmN0aW9uIGJvdHNQcm9jZXNzb3IoZG9uZSkge1xuICAgIHBhcmFsbGVsU2Nhbih7XG4gICAgICBUYWJsZU5hbWU6IENST05fVEFCTEUsXG4gICAgICBcIlJldHVybkNvbnN1bWVkQ2FwYWNpdHlcIjogJ1RPVEFMJ1xuICAgIH0sIHtcbiAgICAgIG1ldGhvZDogXCJzY2FuXCIsXG4gICAgICBtYjogMTAwXG4gICAgfSwgYm90U2VnbWVudHMpLnRoZW4oZGF0YSA9PiB7XG4gICAgICB2YXIgYm90cyA9IHt9O1xuICAgICAgZGF0YS5JdGVtcy5tYXAoYm90ID0+IHtcbiAgICAgICAgaWYgKCFib3QuYXJjaGl2ZWQpIHtcbiAgICAgICAgICBsZXQgYiA9IGNyZWF0ZUJvdChib3QuaWQpO1xuICAgICAgICAgIGxldCBlcnJvckNvdW50ID0gYm90LmVycm9yQ291bnQgPyBib3QuZXJyb3JDb3VudCA6IDA7XG5cbiAgICAgICAgICAvL2Nyb25SZXN1bHRzW2Nyb24uaWRdID0gY3JvbjtcbiAgICAgICAgICBiLmNoZWNrc3VtID0gISFib3QuY2hlY2tzdW07XG4gICAgICAgICAgYi5sYWJlbCA9IGJvdC5uYW1lIHx8IGJvdC5kZXNjcmlwdGlvbiB8fCBib3QuaWQ7XG4gICAgICAgICAgaWYgKGJvdC5pbnZva2VUaW1lKSB7XG4gICAgICAgICAgICBiLmxhc3RfcnVuID0ge1xuICAgICAgICAgICAgICBzdGFydDogYm90Lmludm9rZVRpbWVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChib3QuYXJjaGl2ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAke2JvdC5pZH0gfCBib3QuYXJjaGl2ZWQgPT4gJHtib3QuYXJjaGl2ZWR9YCk7XG4gICAgICAgICAgICBiLnN0YXR1cyA9IFwiYXJjaGl2ZWRcIjtcbiAgICAgICAgICB9IGVsc2UgaWYgKGJvdC5wYXVzZWQpIHtcbiAgICAgICAgICAgIGIuc3RhdHVzID0gXCJwYXVzZWRcIjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGVycm9yQ291bnQgPiAxMCkge1xuICAgICAgICAgICAgYi5yb2d1ZSA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGIucmVhZENhdWdodFVwID0gYm90LnJlYWRDYXVnaHRVcDtcbiAgICAgICAgICBpZiAoYm90LnRpbWUpIHtcbiAgICAgICAgICAgIGxldCBzY2hlZCA9IGxhdGVyLnBhcnNlLmNyb24oYm90LnRpbWUsIHRydWUpO1xuICAgICAgICAgICAgbGV0IHByZXYgPSBsYXRlci5zY2hlZHVsZShzY2hlZCkucHJldig1KTtcbiAgICAgICAgICAgIGxldCBkaWZmID0gW107XG4gICAgICAgICAgICBwcmV2Lm1hcChhID0+IGEudmFsdWVPZigpKS5yZWR1Y2UoKGEsIGIpID0+IHtcbiAgICAgICAgICAgICAgZGlmZi5wdXNoKGEgLSBiKTtcbiAgICAgICAgICAgICAgcmV0dXJuIGI7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGxldCB0b3RhbCA9IGRpZmYucmVkdWNlKChhLCBiKSA9PiBhICsgYik7XG4gICAgICAgICAgICBiLmV4cGVjdC53cml0ZV9sYWcgPSBtb21lbnQuZHVyYXRpb24oe1xuICAgICAgICAgICAgICBtaWxsaXNlY29uZHM6IGIuZXhwZWN0LndyaXRlX2xhZ1xuICAgICAgICAgICAgfSkuYWRkKHtcbiAgICAgICAgICAgICAgbWlsbGlzZWNvbmRzOiB0b3RhbCAvIGRpZmYubGVuZ3RoXG4gICAgICAgICAgICB9KS5hc01pbGxpc2Vjb25kcygpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoYm90LnRyaWdnZXJzICYmIGJvdC50cmlnZ2Vyc1swXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBsZXQgY2hlY2tBcnIgPSBbXTtcbiAgICAgICAgICAgIF8uZm9yRWFjaChib3QudHJpZ2dlcnMsIHRyaWdnZXIgPT4ge1xuICAgICAgICAgICAgICBsZXQgcmVxdWVzdGVkX2tpbmVzaXMgPSBib3QucmVxdWVzdGVkX2tpbmVzaXMgJiYgYm90LnJlcXVlc3RlZF9raW5lc2lzW3RyaWdnZXJdID8gYm90LnJlcXVlc3RlZF9raW5lc2lzW3RyaWdnZXJdIDogbnVsbDtcbiAgICAgICAgICAgICAgbGV0IHJlYWRfY2hlY2twb2ludCA9IGJvdC5jaGVja3BvaW50cyAmJiBib3QuY2hlY2twb2ludHMucmVhZCAmJiBib3QuY2hlY2twb2ludHMucmVhZFt0cmlnZ2VyXSAmJiBib3QuY2hlY2twb2ludHMucmVhZFt0cmlnZ2VyXS5jaGVja3BvaW50ID8gYm90LmNoZWNrcG9pbnRzLnJlYWRbdHJpZ2dlcl0uY2hlY2twb2ludCA6IG51bGw7XG4gICAgICAgICAgICAgIGlmIChyZWFkX2NoZWNrcG9pbnQgIT09IHVuZGVmaW5lZCAmJiByZXF1ZXN0ZWRfa2luZXNpcyAhPT0gdW5kZWZpbmVkICYmIHJlYWRfY2hlY2twb2ludCA+PSByZXF1ZXN0ZWRfa2luZXNpcykge1xuICAgICAgICAgICAgICAgIGNoZWNrQXJyLnB1c2godHJ1ZSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY2hlY2tBcnIucHVzaChmYWxzZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgLy8gU2VlIGlmIHRyaWdnZXIgYm90IGlzIGJlaGluZCBvbiBhbnkgcXVldWVcbiAgICAgICAgICAgIGxldCB0ZW1wID0gdHJ1ZTtcbiAgICAgICAgICAgIF8uZm9yRWFjaChjaGVja0FyciwgYm9vbCA9PiB7XG4gICAgICAgICAgICAgIGlmIChib29sID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIHRlbXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBiLnJlYWRDYXVnaHRVcCA9IHRlbXA7XG4gICAgICAgICAgfVxuICAgICAgICAgIGIub3duZXIgPSBib3Qub3duZXI7XG4gICAgICAgICAgYi5sYW1iZGFOYW1lID0gYm90LmxhbWJkYU5hbWU7XG4gICAgICAgICAgYi5hcmNoaXZlZCA9IGJvdC5hcmNoaXZlZCB8fCBmYWxzZTtcbiAgICAgICAgICBiLnRhZ3MgPSBib3QudGFncyB8fCBiLnRhZ3M7XG4gICAgICAgICAgYi5mcmVxdWVuY3kgPSBib3QudGltZTtcbiAgICAgICAgICBiLnRyaWdnZXJzID0gYm90LnRyaWdnZXJzIHx8IFtdO1xuICAgICAgICAgIGIuaGVhbHRoID0gYm90LmhlYWx0aCB8fCB7fTtcbiAgICAgICAgICBiLm1lc3NhZ2UgPSBib3QubWVzc2FnZTtcbiAgICAgICAgICBiLm5hbWUgPSBib3QubmFtZSB8fCAnJztcbiAgICAgICAgICBiLnRlbXBsYXRlSWQgPSBib3QudGVtcGxhdGVJZCB8fCBiLnRlbXBsYXRlSWQ7XG4gICAgICAgICAgYi5pc0FsYXJtZWQgPSBib3QuaXNBbGFybWVkO1xuICAgICAgICAgIGIuYWxhcm1zID0gYm90LmFsYXJtcztcbiAgICAgICAgICBiLmV4cGVjdCA9IGJvdC5leHBlY3QgfHwgYi5leHBlY3Q7XG4gICAgICAgICAgYi5kZXNjcmlwdGlvbiA9IGJvdC5kZXNjcmlwdGlvbjtcbiAgICAgICAgICBiLnNvdXJjZSA9IGJvdC5sYW1iZGEgJiYgYm90LmxhbWJkYS5zZXR0aW5ncyAmJiBib3QubGFtYmRhLnNldHRpbmdzWzBdICYmIGJvdC5sYW1iZGEuc2V0dGluZ3NbMF0uc291cmNlIHx8IGZhbHNlO1xuICAgICAgICAgIGIuZXhwZWN0LmNvbnNlY3V0aXZlX2Vycm9ycyA9IGJvdC5oZWFsdGggJiYgYm90LmhlYWx0aC5jb25zZWN1dGl2ZV9lcnJvcnMgfHwgYi5leHBlY3QuY29uc2VjdXRpdmVfZXJyb3JzO1xuICAgICAgICAgIGlmIChib3QuY2hlY2twb2ludHMpIHtcbiAgICAgICAgICAgIFtcInJlYWRcIiwgXCJ3cml0ZVwiXS5mb3JFYWNoKHR5cGUgPT4ge1xuICAgICAgICAgICAgICBpZiAoIWJvdC5jaGVja3BvaW50c1t0eXBlXSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBPYmplY3Qua2V5cyhib3QuY2hlY2twb2ludHNbdHlwZV0pLmZvckVhY2goZXZlbnQgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChldmVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmFyIHF1ZXVlUmVmID0gcmVmVXRpbC5yZWYoZXZlbnQpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZVJlZi5yZWZJZCgpLm1hdGNoKC9ecXVldWU6Y29tbWFuZHNcXC4vKSAmJiB0eXBlID09IFwid3JpdGVcIikge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IGJvdC5jaGVja3BvaW50c1t0eXBlXVtldmVudF07XG4gICAgICAgICAgICAgICAgdmFyIGQgPSB7XG4gICAgICAgICAgICAgICAgICBpZDogYi5pZCxcbiAgICAgICAgICAgICAgICAgIHR5cGU6IHR5cGUsXG4gICAgICAgICAgICAgICAgICB1bml0czogMCxcbiAgICAgICAgICAgICAgICAgIFtgbGFzdF8ke3R5cGV9YF06IGRhdGEuZW5kZWRfdGltZXN0YW1wLFxuICAgICAgICAgICAgICAgICAgbGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wOiBkYXRhLnNvdXJjZV90aW1lc3RhbXAsXG4gICAgICAgICAgICAgICAgICBjaGVja3BvaW50OiBkYXRhLmNoZWNrcG9pbnRcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGxldCByZWxhdGlvbiA9IHR5cGUgPT09IFwid3JpdGVcIiA/IFwiY2hpbGRyZW5cIiA6IFwicGFyZW50XCI7XG4gICAgICAgICAgICAgICAgaWYgKCEocXVldWVSZWYucmVmSWQoKS5tYXRjaCgvXFwvX2FyY2hpdmUkL2cpIHx8IHF1ZXVlUmVmLnJlZklkKCkubWF0Y2goL1xcL19zbmFwc2hvdCQvZykpKSB7XG4gICAgICAgICAgICAgICAgICBiLmxpbmtfdG9bcmVsYXRpb25dW3F1ZXVlUmVmLnJlZklkKCldID0gZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChib3QuaW5zdGFuY2VzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpIGluIGJvdC5pbnN0YW5jZXMpIHtcbiAgICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gYm90Lmluc3RhbmNlc1tpXTtcbiAgICAgICAgICAgICAgaWYgKGluc3RhbmNlLmxvZykge1xuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZS5zdGF0dXMgPT0gXCJlcnJvclwiKSB7XG4gICAgICAgICAgICAgICAgICBiLmxvZ3MuZXJyb3JzLnB1c2goSlNPTi5wYXJzZSh6bGliLmd1bnppcFN5bmMoaW5zdGFuY2UubG9nKSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBiLmxvZ3Mubm90aWNlcy5wdXNoKEpTT04ucGFyc2UoemxpYi5ndW56aXBTeW5jKGluc3RhbmNlLmxvZykpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGluY2x1ZGVSYXdCb3REYXRhKSB7XG4gICAgICAgICAgICBiLnJhdyA9IGJvdDtcbiAgICAgICAgICB9XG4gICAgICAgICAgYm90c1tiLmlkXSA9IGI7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxldCBzb3VyY2UgPSBib3QubGFtYmRhICYmIGJvdC5sYW1iZGEuc2V0dGluZ3MgJiYgYm90LmxhbWJkYS5zZXR0aW5nc1swXSAmJiBib3QubGFtYmRhLnNldHRpbmdzWzBdLnNvdXJjZTtcbiAgICAgICAgICAgIGIua2luZXNpc19udW1iZXIgPSBib3QuY2hlY2twb2ludHMgJiYgYm90LmNoZWNrcG9pbnRzLnJlYWQgJiYgYm90LmNoZWNrcG9pbnRzLnJlYWRbc291cmNlXSAmJiBib3QuY2hlY2twb2ludHMucmVhZFtzb3VyY2VdLmNoZWNrcG9pbnQ7XG4gICAgICAgICAgICBpZiAoIWIua2luZXNpc19udW1iZXIpIHtcbiAgICAgICAgICAgICAgYi5raW5lc2lzX251bWJlciA9IE9iamVjdC5rZXlzKGJvdC5jaGVja3BvaW50cyAmJiBib3QuY2hlY2twb2ludHMucmVhZCB8fCB7fSkubWFwKHggPT4gYm90LmNoZWNrcG9pbnRzLnJlYWRbeF0uY2hlY2twb2ludCkuZmlsdGVyKGMgPT4gISFjICYmIGMgIT09ICd1bmRlZmluZWQnICYmIGMgIT09ICdxdWV1ZTp1bmRlZmluZWQnKS5zb3J0KClbMF0gfHwgXCJcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGIua2luZXNpc19udW1iZXIgPSBcIlwiO1xuICAgICAgICAgIH1cbiAgICAgICAgICBiLnN5c3RlbSA9IGJvdC5zeXN0ZW0gJiYgYm90LnN5c3RlbS5pZCA/IGJvdC5zeXN0ZW0uaWQgOiB1bmRlZmluZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coYCR7Ym90LmlkfSBpcyBhcmNoaXZlZC4gc2tpcHBpbmcgZm9yIG5vd2ApXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZG9uZShudWxsLCBib3RzKTtcbiAgICB9KS5jYXRjaChkb25lKTtcbiAgfVxuICBmdW5jdGlvbiBwYXJhbGxlbFNjYW4ocXVlcnksIG9wdHMsIHNlZ21lbnRzKSB7XG4gICAgbGV0IHJlcXVlc3RzID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50czsgaSsrKSB7XG4gICAgICByZXF1ZXN0cy5wdXNoKGR5bmFtb2RiLnF1ZXJ5KE9iamVjdC5hc3NpZ24oe30sIHF1ZXJ5LCB7XG4gICAgICAgIFRvdGFsU2VnbWVudHM6IHNlZ21lbnRzLFxuICAgICAgICBTZWdtZW50OiBpXG4gICAgICB9KSwgb3B0cykpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocmVxdWVzdHMpLnRoZW4oZGF0YSA9PiB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSBkYXRhLnJlZHVjZSgoYWxsLCBvbmUpID0+IHtcbiAgICAgICAgYWxsLkl0ZW1zID0gYWxsLkl0ZW1zLmNvbmNhdChvbmUuSXRlbXMpO1xuICAgICAgICBhbGwuU2Nhbm5lZENvdW50ICs9IG9uZS5TY2FubmVkQ291bnQ7XG4gICAgICAgIGFsbC5Db3VudCArPSBvbmUuQ291bnQ7XG4gICAgICAgIGFsbC5fc3RhdHMubWIgKz0gb25lLl9zdGF0cy5tYjtcbiAgICAgICAgYWxsLl9zdGF0cy5jb3VudCArPSBvbmUuX3N0YXRzLmNvdW50O1xuICAgICAgICByZXR1cm4gYWxsO1xuICAgICAgfSwge1xuICAgICAgICBJdGVtczogW10sXG4gICAgICAgIFNjYW5uZWRDb3VudDogMCxcbiAgICAgICAgQ291bnQ6IDAsXG4gICAgICAgIF9zdGF0czoge1xuICAgICAgICAgIG1iOiAwLFxuICAgICAgICAgIGNvdW50OiAwXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIHBhcmFsbGVsUXVlcnkocXVlcmllcywgb3B0cywgbWVyZ2VGbikge1xuICAgIC8vIFdlIG5lZWQgYXQgbGVhc3Qgb25lIHF1ZXJ5XG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIG1lcmdlRm4oe1xuICAgICAgICBJdGVtczogW10sXG4gICAgICAgIFNjYW5uZWRDb3VudDogMCxcbiAgICAgICAgQ291bnQ6IDAsXG4gICAgICAgIF9zdGF0czoge1xuICAgICAgICAgIG1iOiAwLFxuICAgICAgICAgIGNvdW50OiAwXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICA7XG4gICAgbGV0IHJlcXVlc3RzID0gW107XG4gICAgZm9yIChjb25zdCBbaW5kZXgsIHF1ZXJ5XSBvZiBxdWVyaWVzLmVudHJpZXMoKSkge1xuICAgICAgbGV0IGtleSA9IEpTT04uc3RyaW5naWZ5KHF1ZXJ5LkV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXMpO1xuICAgICAgbGV0IGVuZCA9IHF1ZXJ5LkV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXNbXCI6ZW5kXCJdO1xuXG4gICAgICAvL1xuICAgICAgbGV0IGlzQnVja2V0Q2xvc2VkID0gZW5kIDwgRGF0ZS5ub3coKSAtIDEwMDAgKiA2MCAqIDI7XG4gICAgICAvLyBjb25zb2xlLmxvZyhgY2FjaGUga2V5ID0+ICR7a2V5fSBjYWNoZSBvciByZXF1ZXN0OiAke3N0YXRzQ2FjaGVba2V5XSAmJiBpc0J1Y2tldENsb3NlZH0sICR7aW5kZXh9LCAke3F1ZXJpZXMubGVuZ3RofWApO1xuICAgICAgLy8gQ2FjaGUgYnVja2V0cyB0aGF0IGFyZW4ndCBleHBlY3RlZCB0byBjaGFuZ2UgYW5kIGZldGNoIGJ1Y2tldHMgdGhhdCB3aWxsIGNoYW5nZSAoY2xvc2VyIHRvIG5vdylcbiAgICAgIGlmIChzdGF0c0NhY2hlW2tleV0gJiYgaXNCdWNrZXRDbG9zZWQpIHtcbiAgICAgICAgc3RhdHNDYWNoZVtrZXldLmxhc3RGZXRjaGVkID0gRGF0ZS5ub3coKTtcbiAgICAgICAgcmVxdWVzdHMucHVzaChQcm9taXNlLnJlc29sdmUoc3RhdHNDYWNoZVtrZXldKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXF1ZXN0cy5wdXNoKGR5bmFtb2RiLnF1ZXJ5KHF1ZXJ5LCBvcHRzKS50aGVuKGRhdGEgPT4ge1xuICAgICAgICAgIC8vIENhY2hlIGFueXRoaW5nIHRoYXQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgc3RhdHNDYWNoZVtrZXldID0gZGF0YTtcbiAgICAgICAgICBkYXRhLmxhc3RGZXRjaGVkID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgfSkpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocmVxdWVzdHMpLnRoZW4oZGF0YSA9PiB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSBkYXRhLnJlZHVjZSgoYWxsLCBvbmUpID0+IHtcbiAgICAgICAgYWxsLkl0ZW1zID0gYWxsLkl0ZW1zLmNvbmNhdChvbmUuSXRlbXMpO1xuICAgICAgICAvLyBhbGwuU2Nhbm5lZENvdW50ICs9IG9uZS5TY2FubmVkQ291bnQ7XG4gICAgICAgIC8vIGFsbC5Db3VudCArPSBvbmUuQ291bnQ7XG4gICAgICAgIC8vIGFsbC5fc3RhdHMubWIgKz0gb25lLl9zdGF0cy5tYjtcbiAgICAgICAgLy8gYWxsLl9zdGF0cy5jb3VudCArPSBvbmUuX3N0YXRzLmNvdW50O1xuXG4gICAgICAgIHJldHVybiBhbGw7XG4gICAgICB9LCB7XG4gICAgICAgIEl0ZW1zOiBbXSxcbiAgICAgICAgU2Nhbm5lZENvdW50OiAwLFxuICAgICAgICBDb3VudDogMCxcbiAgICAgICAgX3N0YXRzOiB7XG4gICAgICAgICAgbWI6IDAsXG4gICAgICAgICAgY291bnQ6IDBcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gbWVyZ2VGbihyZXNwb25zZSk7XG4gICAgfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICAvLyBQdXJnZSBvbGQgY2FjaGUgZW50cmllc1xuICAgICAgbGV0IGNvdW50ID0gMDtcbiAgICAgIE9iamVjdC5lbnRyaWVzKHN0YXRzQ2FjaGUpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICAvLyBJZiB0aGUgZW50cnkgaGFzbid0IGJlZW4gZmV0Y2hlZCBpbiAyIG1pbnV0ZXMsIFBVUkdFIEJBQllcbiAgICAgICAgaWYgKHZhbHVlLmxhc3RGZXRjaGVkIDwgRGF0ZS5ub3coKSAtIDEwMDAgKiA2MCAqIDIpIHtcbiAgICAgICAgICBkZWxldGUgc3RhdHNDYWNoZVtrZXldO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKGNvdW50ID4gNTApIHtcbiAgICAgICAgLy8gc29ydCB0aGUgY2FjaGUgYXNjZW5kaW5nIG9yZGVyIGJ5IGxhc3RGZXRjaGVkXG4gICAgICAgIGxldCBzb3J0ZWRDYWNoZSA9IE9iamVjdC5lbnRyaWVzKHN0YXRzQ2FjaGUpLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gYS5sYXN0RmV0Y2hlZCAtIGIubGFzdEZldGNoZWQpO1xuICAgICAgICAvLyBzbGljZSBvZmYgYW55IGVudHJpZXMgPiA1MCBpbiBsZW5ndGggYW5kIGRlbGV0ZSBmcm9tIHRoZSBjYWNoZVxuICAgICAgICBzb3J0ZWRDYWNoZS5zbGljZSgwLCBzb3J0ZWRDYWNoZS5sZW5ndGggLSA1MCkuZm9yRWFjaCgoW2tleV0pID0+IGRlbGV0ZSBzdGF0c0NhY2hlW2tleV0pO1xuICAgICAgfVxuXG4gICAgICAvLyBjb25zb2xlLmxvZyhPYmplY3Qua2V5cyhzdGF0c0NhY2hlKSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gc3BsaXRUaW1lKHN0YXJ0LCBlbmQpIHtcbiAgICBpZiAoIXN0YXJ0IHx8ICFlbmQpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gICAgO1xuXG4gICAgLy8gY29uc29sZS5sb2coYFNUQVJUOiAke2J1Y2tldFV0aWxzLnZhbHVlKG1vbWVudChzdGFydCkpLmZvcm1hdCgpfSwgRU5EOiAke2J1Y2tldFV0aWxzLnZhbHVlKG1vbWVudChlbmQpKS5mb3JtYXQoKX1gKTtcblxuICAgIGxldCB0aW1lcyA9IFtdO1xuICAgIGxldCBjdXJyZW50ID0gc3RhcnQ7XG5cbiAgICAvLyBgbWludXRlXzE1YCBpcyBnb2luZyB0byBkbyAxNSBvbmUgbWludXRlIGJ1Y2tldHMsIGBob3VyYCBpcyBnb2luZyB0byBkbyA0IGBtaW51dGVfMTVgIGJ1Y2tldHMsIDYgaG91ciBidWNrZXRzIGZvciBgaG91cl82YCBcbiAgICAvLyBhbmQgZm9yIGBkYXlgIHdlIGdldCAyNCBgaG91cmAgYnVja2V0cy4gU28gdGhlIGFzc3VtcHRpb24gaXMgd2Ugd2lsbCBuZXZlciBuZWVkIG1vcmUgdGhhbiAzMCBidWNrZXRzIG9mIGRhdGFcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgMzA7IGluZGV4KyspIHtcbiAgICAgIGxldCBuZXh0ID0gYnVja2V0VXRpbHMubmV4dChjdXJyZW50KTtcbiAgICAgIHRpbWVzLnB1c2goe1xuICAgICAgICBzdGFydDogY3VycmVudC52YWx1ZU9mKCksXG4gICAgICAgIGVuZDogbmV4dC52YWx1ZU9mKClcbiAgICAgIH0pO1xuICAgICAgY3VycmVudCA9IG5leHQ7XG4gICAgICAvLyBjb25zb2xlLmxvZyhgQ1VSUkVOVCA9ICR7Y3VycmVudC52YWx1ZU9mKCl9LCAke2N1cnJlbnQuZm9ybWF0KCl9YCk7XG4gICAgICAvLyBJZiBjdXJyZW50IGlzIHBhc3QgdGhlIGVuZCBPUiBpZiBjdXJyZW50IGlzIHBhc3QgTm93LCBiYWlsIHdlIGRvbid0IG5lZWQgZnV0dXJlIHN0dWZmXG4gICAgICBpZiAoY3VycmVudCA+IGVuZCB8fCBjdXJyZW50LnZhbHVlT2YoKSA+IERhdGUubm93KCkpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aW1lcztcbiAgfVxuICBmdW5jdGlvbiBtZXJnZVN0YXRzUmVzdWx0cyhidWNrZXRzU3RhdHMpIHtcbiAgICB2YXIgb3V0ID0ge307XG4gICAgdmFyIGV4ZWN1dGlvbkRlZmF1bHRzID0ge1xuICAgICAgY29tcGxldGlvbnM6IDAsXG4gICAgICBkdXJhdGlvbjogMCxcbiAgICAgIG1heF9kdXJhdGlvbjogMCxcbiAgICAgIG1pbl9kdXJhdGlvbjogMCxcbiAgICAgIGVycm9yczogMCxcbiAgICAgIHVuaXRzOiAwXG4gICAgfTtcbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICBjaGVja3BvaW50OiAwLFxuICAgICAgc291cmNlX3RpbWVzdGFtcDogMCxcbiAgICAgIHRpbWVzdGFtcDogMCxcbiAgICAgIHVuaXRzOiAwXG4gICAgfTtcbiAgICBidWNrZXRzU3RhdHMuSXRlbXMubWFwKHN0YXQgPT4ge1xuICAgICAgLy8gY29uc29sZS5sb2coYHN0YXQuYXJjaGl2ZWQgPT4gJHtzdGF0LmFyY2hpdmVkfWApO1xuICAgICAgLy8gSWYgd2UgZG9uJ3QgaGF2ZSB0aGUgaWQgaW4gb3V0IGNyZWF0ZSBpdCBhbmQgZGVmYXVsdCBpdFxuICAgICAgaWYgKCEoc3RhdC5pZCBpbiBvdXQpKSB7XG4gICAgICAgIG91dFtzdGF0LmlkXSA9IHtcbiAgICAgICAgICBleGVjdXRpb246IE9iamVjdC5hc3NpZ24oe30sIGV4ZWN1dGlvbkRlZmF1bHRzKSxcbiAgICAgICAgICByZWFkOiB7fSxcbiAgICAgICAgICB3cml0ZToge31cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHZhciBub2RlID0gb3V0W3N0YXQuaWRdO1xuXG4gICAgICAvLyBJZiBzdGF0LmN1cnJlbnQuZXhlY3V0aW9uIGlzIGF2YWlsYWJsZSBtZXJnZSB0aGF0IGludG8gbm9kZSAod2hpY2ggaXMgYSByZWZlcmVuY2UgdG8gb3V0W3N0YXQuaWRdKVxuICAgICAgaWYgKHN0YXQuY3VycmVudC5leGVjdXRpb24pIHtcbiAgICAgICAgbm9kZS5leGVjdXRpb24gPSBtZXJnZUV4ZWN1dGlvblN0YXRzKG5vZGUuZXhlY3V0aW9uLCBzdGF0LmN1cnJlbnQuZXhlY3V0aW9uKTtcbiAgICAgIH1cbiAgICAgIFtcInJlYWRcIiwgXCJ3cml0ZVwiXS5tYXAodHlwZSA9PiB7XG4gICAgICAgIE9iamVjdC5rZXlzKHN0YXQuY3VycmVudFt0eXBlXSB8fCB7fSkubWFwKGtleSA9PiB7XG4gICAgICAgICAgLy8gaWYgc3RhdC5jdXJyZW50LnJlYWQgb3Igc3RhdC5jdXJyZW50LndyaXRlIGRvZXNuJ3QgZXhpc3QgaW4gbm9kZSBkZWZhdWx0IGl0XG4gICAgICAgICAgaWYgKCEoa2V5IGluIG5vZGVbdHlwZV0pKSB7XG4gICAgICAgICAgICBub2RlW3R5cGVdW2tleV0gPSBPYmplY3QuYXNzaWduKHt9LCBkZWZhdWx0cyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIG1lcmdlICdyZWFkJyBhbmQgJ3dyaXRlJyBzdGF0cyBpbnRvIG5vZGVcbiAgICAgICAgICBub2RlW3R5cGVdW2tleV0gPSBtZXJnZVN0YXRzKG5vZGVbdHlwZV1ba2V5XSwgc3RhdC5jdXJyZW50W3R5cGVdW2tleV0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cbiAgZnVuY3Rpb24gbWF4KGEsIGIpIHtcbiAgICBpZiAodHlwZW9mIGEgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiBNYXRoLm1heChhLCBiKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBhID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gYS5sb2NhbGVDb21wYXJlKGIpID49IDEgPyBhIDogYjtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGI7XG4gICAgfVxuICB9XG4gIGZ1bmN0aW9uIG1pbihhLCBiKSB7XG4gICAgaWYgKHR5cGVvZiBhID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gTWF0aC5taW4oYSwgYik7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIGEubG9jYWxlQ29tcGFyZShiKSA+PSAxID8gYiA6IGE7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBiO1xuICAgIH1cbiAgfVxuICBmdW5jdGlvbiBzdW0oYSwgYiwgZGVmYXVsdFZhbHVlKSB7XG4gICAgcmV0dXJuIChhIHx8IGRlZmF1bHRWYWx1ZSB8fCAwKSArIChiIHx8IGRlZmF1bHRWYWx1ZSB8fCAwKTtcbiAgfVxuICBmdW5jdGlvbiBzYWZlTnVtYmVyKG51bWJlcikge1xuICAgIGlmIChpc05hTihudW1iZXIpIHx8ICFudW1iZXIpIHtcbiAgICAgIHJldHVybiAwO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbnVtYmVyO1xuICAgIH1cbiAgfVxuICBmdW5jdGlvbiBtZXJnZUV4ZWN1dGlvblN0YXRzKHMsIHIpIHtcbiAgICBzLmNvbXBsZXRpb25zID0gc3VtKHMuY29tcGxldGlvbnMsIHIuY29tcGxldGlvbnMpO1xuICAgIHMudW5pdHMgPSBzdW0ocy51bml0cywgci51bml0cyk7XG4gICAgcy5kdXJhdGlvbiA9IHN1bShzYWZlTnVtYmVyKHBhcnNlSW50KHMuZHVyYXRpb24pKSwgc2FmZU51bWJlcihwYXJzZUludChyLmR1cmF0aW9uKSkpO1xuICAgIHMubWF4X2R1cmF0aW9uID0gbWF4KHMubWF4X2R1cmF0aW9uLCByLm1heF9kdXJhdGlvbik7XG4gICAgaWYgKHIubWluX2R1cmF0aW9uID4gMCkge1xuICAgICAgcy5taW5fZHVyYXRpb24gPSBtaW4ocy5taW5fZHVyYXRpb24sIHIubWluX2R1cmF0aW9uKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcy5taW5fZHVyYXRpb24gPSBzLm1pbl9kdXJhdGlvbiB8fCAwO1xuICAgIH1cbiAgICBzLmVycm9ycyA9IHN1bShzLmVycm9ycywgci5lcnJvcnMpO1xuICAgIHJldHVybiBzO1xuICB9XG4gIGZ1bmN0aW9uIG1lcmdlU3RhdHMocywgcikge1xuICAgIHMuc291cmNlX3RpbWVzdGFtcCA9IG1heChzLnNvdXJjZV90aW1lc3RhbXAsIHIuc291cmNlX3RpbWVzdGFtcCk7XG4gICAgcy50aW1lc3RhbXAgPSBtYXgocy50aW1lc3RhbXAsIHIudGltZXN0YW1wKTtcbiAgICBzLnVuaXRzID0gc3VtKHMudW5pdHMsIHIudW5pdHMpO1xuICAgIHMuY2hlY2twb2ludCA9IHIuY2hlY2twb2ludCB8fCBzLmNoZWNrcG9pbnQ7XG4gICAgcmV0dXJuIHM7XG4gIH1cblxuICAvLyBDdXJyZW50bHkgbm90IHVzZWQgYmVjYXVzZSBpdCBpcyBzdXJwcmlzaW5nbHkgc2xvd1xuICBmdW5jdGlvbiBwcm9taXNlQWxsQ29uY3VycmVuY3kocXVldWUsIGNvbmN1cnJlbmN5KSB7XG4gICAgaWYgKGNvbmN1cnJlbmN5ID09IG51bGwpIHtcbiAgICAgIGNvbmN1cnJlbmN5ID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBsZXQgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgICBsZXQgY29tcGxldGUgPSAwO1xuICAgIC8vIFJ1biBhIHBzZXVkby10aHJlYWRcbiAgICBjb25zdCBleGVjVGhyZWFkID0gKCkgPT4ge1xuICAgICAgaWYgKGluZGV4IDwgcXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IGN1ckluZGV4ID0gaW5kZXgrKztcbiAgICAgICAgcmV0dXJuIHF1ZXVlW2N1ckluZGV4XSgpLnRoZW4oZGF0YSA9PiB7XG4gICAgICAgICAgcmVzdWx0c1tjdXJJbmRleF0gPSBkYXRhO1xuICAgICAgICAgIGNvbXBsZXRlKys7XG4gICAgICAgICAgcmV0dXJuIGV4ZWNUaHJlYWQoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcblxuICAgIC8vIFN0YXJ0IHRocmVhZHNcbiAgICBjb25zdCB0aHJlYWRzID0gW107XG4gICAgZm9yIChsZXQgdGhyZWFkID0gMDsgdGhyZWFkIDwgY29uY3VycmVuY3k7IHRocmVhZCsrKSB7XG4gICAgICB0aHJlYWRzLnB1c2goZXhlY1RocmVhZCgpKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHRocmVhZHMpLnRoZW4oKCkgPT4gcmVzdWx0cyk7XG4gIH1cbn07XG5cbn0se1wiLi9odW1hbml6ZS5qc1wiOjIsXCIuL3N0YXRzLWJ1Y2tldHMuanNcIjozLFwiYXN5bmNcIjp1bmRlZmluZWQsXCJsYXRlclwiOnVuZGVmaW5lZCxcImxlby1sb2dnZXJcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibG9kYXNoXCI6dW5kZWZpbmVkLFwibW9tZW50XCI6dW5kZWZpbmVkLFwibW9tZW50LXJvdW5kXCI6dW5kZWZpbmVkLFwiemxpYlwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
