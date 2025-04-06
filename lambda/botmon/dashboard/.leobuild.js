(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var statsBuckets = require("../../lib/stats-buckets.js");
var util = require("leo-sdk/lib/reference.js");
let logger = require("leo-logger")("dashboard-api");
var moment = require("moment");
require("moment-round");
var async = require("async");
var CRON_TABLE = leo.configuration.resources.LeoCron;
var STATS_TABLE = require("leo-config").Resources.LeoStats;
function calcChange(current, prev) {
  if (current) {
    if (prev) {
      return Math.round((current - prev) / prev * 100) + '%';
    } else {
      return "100%";
    }
  } else if (prev) {
    return "-100%";
  } else {
    return "0%";
  }
}
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  if (!event.params.path.id) {
    let ref = util.ref(event.params.path.type);
    event.params.path.id = ref.id;
    event.params.path.type = ref.type;
  }
  var refObject = util.ref(event.params.path.id, event.params.path.type);
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "dashboard",
    botmon: {}
  });
  var overrides = {
    "minute": "minute_1"
  };
  var r = event.params.querystring.range || event.params.querystring.period;
  event.params.querystring.range = overrides[r] || r;
  var numberOfPeriods = event.params.querystring.count || 1;
  var request_timestamp = moment(event.params.querystring.timestamp);
  var compareBucket = statsBuckets.data[event.params.querystring.range];
  var currentCompareTimestamp = compareBucket.prev(request_timestamp.clone(), 1 * numberOfPeriods).valueOf();
  var prevCompareTimestamp = compareBucket.prev(request_timestamp.clone(), 2 * numberOfPeriods).valueOf();
  var startTimestamp = compareBucket.prev(request_timestamp.clone(), 3 * numberOfPeriods).valueOf();
  var period = event.params.querystring.range;
  var range = statsBuckets.ranges[period] || {
    period: period,
    count: 1,
    startOf: timestamp => timestamp.startOf(period.replace(/_[0-9]+$/))
  };
  if (statsBuckets.ranges[period] && statsBuckets.ranges[period].rolling && numberOfPeriods == 1) {
    range = statsBuckets.ranges[period].rolling;
  }
  var bucket = statsBuckets.data[range.period];
  var endTime = bucket.value(request_timestamp.clone());
  var startTime = bucket.value(moment(startTimestamp));
  if (endTime > moment()) {
    endTime = moment();
  }
  var startBucket = bucket.transform(startTime);
  var endBucket = bucket.transform(endTime);
  logger.log("RAW", moment(startTime).format(), moment(endTime).format(), request_timestamp.format());
  logger.log("NEW", startBucket, endBucket);
  var buckets = [];
  var bucketArrayIndex = {};
  var c = startTime;
  var e = endTime.valueOf();
  var count = 0;
  while (c <= e) {
    var t = bucket.value(c.clone()).valueOf();
    buckets.push(t);
    bucketArrayIndex[t] = count++;
    c.add(bucket.duration);
  }
  var inputs = {
    request_timestamp: request_timestamp,
    prevCompareTimestamp: prevCompareTimestamp,
    currentCompareTimestamp: currentCompareTimestamp,
    startBucket: startBucket,
    endBucket: endBucket,
    buckets: buckets,
    period: period,
    bucketArrayIndex: bucketArrayIndex
  };
  if (refObject.type == "bot") {
    // Leo_cron_stats start-end bucket exec stats
    // Leo_cron Query by id
    // Queues from Checkpoints
    // Leo_cron_stats start-end queue stats

    botDashboard(refObject, inputs, (err, data) => {
      if (!err && data) {
        data.start = startTime.valueOf();
        data.end = endTime.valueOf();
        data.buckets = buckets;
      }
      callback(err, data);
    });
  } else if (refObject.type == "queue" || refObject.type == "system") {
    // Leo_cron Scan
    // Get bots that reference this queue
    // Leo_cron_stats start-end writes
    // Leo_cron_Stats start-end reads
    queueDashboard(refObject, inputs, (err, data) => {
      if (!err && data) {
        data.start = startTime.valueOf();
        data.end = endTime.valueOf();
        data.buckets = buckets;
      }
      callback(err, data);
    });
  } else {
    callback(`Unknown type: ${refObject.type}`);
  }
});
function queueData(key, type, queue, request_timestamp, buckets) {
  var ref = util.ref(key);
  return {
    type: type,
    id: ref.refId(),
    event: ref.id,
    label: ref.id,
    [`last_${type}`]: queue.timestamp,
    [`last_${type}_event_timestamp`]: parseInt(queue.checkpoint && queue.checkpoint.split && queue.checkpoint.split(/\//).pop().split(/\-/)[0] || 0),
    last_event_source_timestamp: queue.source_timestamp,
    [`last_${type}_lag`]: request_timestamp.diff(moment(queue.timestamp)),
    last_event_source_timestamp_lag: request_timestamp.diff(moment(queue.source_timestamp)),
    values: buckets.map(time => {
      return {
        value: 0,
        time: time
      };
    }),
    lags: buckets.map(time => {
      return {
        value: null,
        time: time
      };
    }),
    [`${type}s`]: type === "read" && buckets.map(time => {
      return {
        value: 0,
        time: time
      };
    }) || undefined,
    compare: {
      [`${type}s`]: {
        prev: 0,
        current: 0,
        change: 0
      },
      [`${type}_lag`]: {
        prev: 0,
        current: 0,
        prevCount: 0,
        currentCount: 0
      }
    },
    lagEvents: 0,
    checkpoint: queue.checkpoint,
    timestamp: parseInt(queue.checkpoint && queue.checkpoint.split && queue.checkpoint.split(/\//).pop().split(/\-/)[0] || 0)
  };
}
function botDashboard(refObject, data, callback) {
  var startBucket = data.startBucket;
  var endBucket = data.endBucket;
  var buckets = data.buckets;
  var period = data.period;
  var bucketArrayIndex = data.bucketArrayIndex;
  var request_timestamp = data.request_timestamp;
  var prevCompareTimestamp = data.prevCompareTimestamp;
  var currentCompareTimestamp = data.currentCompareTimestamp;
  var selfProcessor = function (ref, done) {
    leo.aws.dynamodb.query({
      TableName: STATS_TABLE,
      KeyConditionExpression: "#id = :id and #bucket between :bucket and :endBucket",
      ExpressionAttributeNames: {
        "#bucket": "bucket",
        "#id": "id"
      },
      ExpressionAttributeValues: {
        ":bucket": startBucket,
        ":endBucket": endBucket,
        ":id": ref.refId()
      },
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      mb: 100
    }).catch(callback).then(bucketStats => {
      logger.log(period, bucketStats.LastEvaluatedKey, bucketStats.ConsumedCapacity, bucketStats.Items.length);
      var node = {
        executions: buckets.map(time => {
          return {
            value: 0,
            time: time
          };
        }),
        errors: buckets.map(time => {
          return {
            value: 0,
            time: time
          };
        }),
        duration: buckets.map(time => {
          return {
            value: 0,
            total: 0,
            min: 0,
            max: 0,
            time: time
          };
        }),
        queues: {
          read: {},
          write: {}
        },
        compare: {
          executions: {
            prev: 0,
            current: 0,
            change: 0
          },
          errors: {
            prev: 0,
            current: 0,
            change: 0
          },
          duration: {
            prev: 0,
            current: 0,
            change: 0
          }
        }
      };
      bucketStats.Items.map(stat => {
        var index = bucketArrayIndex[stat.time];
        //logger.log(stat.id, stat.bucket);
        if (stat.current.execution) {
          let exec = stat.current.execution;
          node.executions[index].value = exec.units;
          node.errors[index].value = exec.errors; //Math.max(exec.errors, exec.units - exec.completions);
          node.duration[index] = {
            value: exec.duration / exec.units,
            total: exec.duration,
            max: exec.max_duration,
            min: exec.min_duration,
            time: stat.time
          };
          if (stat.time >= prevCompareTimestamp && stat.time < currentCompareTimestamp) {
            node.compare.executions.prev += node.executions[index].value;
            node.compare.errors.prev += node.errors[index].value;
            node.compare.duration.prev += node.duration[index].total;
          } else if (stat.time >= currentCompareTimestamp) {
            node.compare.executions.current += node.executions[index].value;
            node.compare.errors.current += node.errors[index].value;
            node.compare.duration.current += node.duration[index].total;
          }
        }
        ["read", "write"].map(type => {
          var typeS = `${type}s`;
          if (stat.current[type] != undefined) {
            Object.keys(stat.current[type]).forEach((key, k) => {
              var link = stat.current[type][key];
              if (!(key in node.queues[type])) {
                node.queues[type][key] = queueData(key, type, link, request_timestamp, buckets);
              }
              var queue = node.queues[type][key];
              queue.lags[index].value += link.timestamp - link.source_timestamp || 0;
              if (type === "write") {
                queue.values[index].value += parseInt(link.units);
              } else {
                queue[`${typeS}`][index].value += parseInt(link.units);
              }
              if (stat.time >= prevCompareTimestamp && stat.time < currentCompareTimestamp) {
                queue.compare[`${typeS}`].prev += parseInt(link.units);
                queue.compare[`${type}_lag`].prev += link.timestamp - link.source_timestamp || 0;
                queue.compare[`${type}_lag`].prevCount++;
              } else if (stat.time >= currentCompareTimestamp) {
                queue.compare[`${typeS}`].current += parseInt(link.units);
                queue.compare[`${type}_lag`].current += link.timestamp - link.source_timestamp || 0;
                queue.compare[`${type}_lag`].currentCount++;
              }
              queue[`last_${type}`] = link.timestamp;
              queue[`last_${type}_event_timestamp`] = parseInt(link.checkpoint && link.checkpoint.split && link.checkpoint.split(/\//).pop().split(/\-/)[0] || 0);
              queue.last_event_source_timestamp = link.source_timestamp;
              queue[`last_${type}_lag`] = request_timestamp.diff(moment(link.timestamp));
              queue.last_event_source_timestamp_lag = request_timestamp.diff(moment(link.source_timestamp));
              queue.checkpoint = link.checkpoint;
              queue.timestamp = parseInt(link.checkpoint && link.checkpoint.split && link.checkpoint.split(/\//).pop().split(/\-/)[0] || 0);
            });
          }
        });
      });
      if (node.compare.executions.current) {
        node.compare.duration.current /= node.compare.executions.current;
      }
      if (node.compare.executions.prev) {
        node.compare.duration.prev /= node.compare.executions.prev;
      }
      node.compare.executions.change = calcChange(node.compare.executions.current, node.compare.executions.prev);
      node.compare.errors.change = calcChange(node.compare.errors.current, node.compare.errors.prev);
      node.compare.duration.change = calcChange(node.compare.duration.current, node.compare.duration.prev);
      ["read", "write"].map(type => {
        var typeS = `${type}s`;
        Object.keys(node.queues[type]).map(key => {
          let link = node.queues[type][key];
          if (link.compare[`${type}_lag`].currentCount) {
            link.compare[`${type}_lag`].current /= link.compare[`${type}_lag`].currentCount;
          }
          if (link.compare[`${type}_lag`].prevCount) {
            link.compare[`${type}_lag`].prev /= link.compare[`${type}_lag`].prevCount;
          }
          link.compare[`${type}_lag`].change = calcChange(link.compare[`${type}_lag`].current, link.compare[`${type}_lag`].prev);
          link.compare[`${typeS}`].change = calcChange(link.compare[`${typeS}`].current, link.compare[`${typeS}`].prev);
        });
      });
      done(null, node);
    });
  };
  var botProcessor = function (ref, done) {
    dynamodb.get(CRON_TABLE, ref.id, (err, bot) => {
      done(err, bot);
    });
  };
  async.parallel({
    bot: done => botProcessor(refObject, done),
    self: done => selfProcessor(refObject, done)
  }, (err, results) => {
    var self = results.self;
    var bot = results.bot || {};
    var tasks = [];
    Object.keys(self.queues && self.queues.read || {}).map(key => {
      tasks.push(done => {
        leo.aws.dynamodb.query({
          TableName: STATS_TABLE,
          KeyConditionExpression: "#id = :id and #bucket between :bucket and :endBucket",
          ExpressionAttributeNames: {
            "#bucket": "bucket",
            "#id": "id"
          },
          ExpressionAttributeValues: {
            ":bucket": startBucket,
            ":endBucket": endBucket,
            ":id": util.ref(key).queue().refId()
          },
          "ReturnConsumedCapacity": 'TOTAL'
        }, {
          mb: 100
        }).catch(done).then(bucketStats => {
          var isBehind = false;
          var isBehindOnLast = false;
          var isBehindOnFirst = false;
          bucketStats.Items.map(stat => {
            var time = stat.time || moment.utc(stat.bucket.replace(/^.*_/, ""), "").valueOf();
            var index = bucketArrayIndex[time];
            var queue = self.queues.read[stat.id];
            Object.keys(stat.current.write || {}).map(key => {
              let link = stat.current.write[key];
              queue.values[index].value += parseInt(link.units);
              queue.latestWriteCheckpoint = maxString(queue.latestWriteCheckpoint, link.checkpoint);
              if (link.timestamp > queue.last_read_event_timestamp || link.checkpoint && queue.checkpoint < link.checkpoint) {
                queue.lagEvents += parseInt(link.units);
                if (!isBehind) {
                  //Then we found our first one that is behind
                  queue.values[index].marked = true;
                }
                isBehind = true;
                if (index == 0) {
                  isBehindOnFirst = true;
                } else if (index == buckets.length) {
                  isBehindOnLast = true;
                }
              }
              if (!queue.compare.writes) {
                queue.compare.writes = {
                  prev: 0,
                  current: 0,
                  change: 0
                };
              }
              if (stat.time >= prevCompareTimestamp && stat.time < currentCompareTimestamp) {
                queue.compare[`writes`].prev += parseInt(link.units);
              } else if (stat.time >= currentCompareTimestamp) {
                queue.compare[`writes`].current += parseInt(link.units);
              }
            });
          });
          done();
        });
      });
    });
    let source = bot.lambda && bot.lambda.settings && bot.lambda.settings[0] && bot.lambda.settings[0].source;
    self.kinesis_number = bot.checkpoints && bot.checkpoints.read && bot.checkpoints.read[source] && bot.checkpoints.read[source].checkpoint;
    if (!self.kinesis_number) {
      self.kinesis_number = Object.keys(bot.checkpoints && bot.checkpoints.read || {}).map(b => bot.checkpoints.read[b].checkpoint).filter(c => !!c).sort().pop(0) || "";
    }

    // Add missing Queues from checkpoints
    tasks.push(done => {
      var cp = bot.checkpoints || {};
      ["read", "write"].map(type => {
        Object.keys(cp[type]).map(key => {
          var id = util.refId(key);
          var queue = self.queues[type][id];
          if (!queue) {
            var data = cp[type][key];
            self.queues[type][id] = queueData(id, type, {
              timestamp: data.ended_timestamp,
              checkpoint: data.checkpoint,
              source_timestamp: data.source_timestamp
            }, request_timestamp, buckets);
          }
        });
      });
      done();
    });
    async.parallel(tasks, (err, results) => {
      //logger.log(JSON.stringify(bot, null, 2));

      // Make reads lags grow over time if not reading
      Object.keys(self.queues.read).map(key => {
        var link = self.queues.read[key];
        if (link.compare.writes) {
          link.compare.writes.change = calcChange(link.compare.writes.current, link.compare.writes.prev);
        }
        var last = {
          value: null
        };
        var latestWriteCheckpoint = link.latestWriteCheckpoint;
        link.lags.map(function (v) {
          if (last.value !== null && v.value === null && link.checkpoint < latestWriteCheckpoint) {
            v.value = last.value + (v.time - last.time);
          }
          last = v;
        });
      });
      callback(err, self);
    });
  });
}
function botData(key, type, bot, request_timestamp, buckets) {
  var ref = util.ref(key);
  return {
    id: ref.refId(),
    type: type,
    event: ref.id,
    label: ref.id,
    last_write: bot.timestamp,
    last_event_source_timestamp: bot.source_timestamp,
    last_write_lag: request_timestamp.diff(moment(bot.timestamp)),
    values: buckets.map(time => {
      return {
        value: 0,
        time: time
      };
    }),
    lags: buckets.map(time => {
      return {
        value: null,
        time: time
      };
    }),
    lagEvents: 0,
    compare: {
      reads: {
        prev: 0,
        current: 0,
        change: 0
      },
      writes: {
        prev: 0,
        current: 0,
        change: 0
      },
      read_lag: {
        prev: 0,
        current: 0,
        prevCount: 0,
        currentCount: 0
      },
      write_lag: {
        prev: 0,
        current: 0,
        prevCount: 0,
        currentCount: 0
      }
    },
    last_event_source_timestamp_lag: request_timestamp.diff(moment(bot.source_timestamp)),
    checkpoint: bot.checkpoint,
    timestamp: parseInt(bot.checkpoint && bot.checkpoint.split(/\//).pop().split(/\-/)[0] || 0)
  };
}
function queueDashboard(refObject, data, callback) {
  var startBucket = data.startBucket;
  var endBucket = data.endBucket;
  var buckets = data.buckets;
  var period = data.period;
  var bucketArrayIndex = data.bucketArrayIndex;
  var request_timestamp = data.request_timestamp;
  var prevCompareTimestamp = data.prevCompareTimestamp;
  var currentCompareTimestamp = data.currentCompareTimestamp;
  var selfProcessor = function (done) {
    leo.aws.dynamodb.query({
      TableName: STATS_TABLE,
      KeyConditionExpression: "#id = :id and #bucket between :bucket and :endBucket",
      ExpressionAttributeNames: {
        "#bucket": "bucket",
        "#id": "id"
      },
      ExpressionAttributeValues: {
        ":bucket": startBucket,
        ":endBucket": endBucket,
        ":id": refObject.queue().refId()
      },
      "ReturnConsumedCapacity": 'TOTAL'
    }, {
      mb: 100
    }).catch(done).then(bucketStats => {
      logger.log(period, bucketStats.LastEvaluatedKey, bucketStats.ConsumedCapacity, bucketStats.Items.length);
      var node = {
        reads: buckets.map(time => {
          return {
            value: 0,
            time: time
          };
        }),
        writes: buckets.map(time => {
          return {
            value: 0,
            time: time
          };
        }),
        read_lag: buckets.map(time => {
          return {
            value: 0,
            total: 0,
            min: null,
            max: 0,
            time: time
          };
        }),
        write_lag: buckets.map(time => {
          return {
            value: 0,
            total: 0,
            min: null,
            max: 0,
            time: time
          };
        }),
        bots: {
          read: {},
          write: {}
        },
        compare: {
          reads: {
            prev: 0,
            current: 0,
            change: 0
          },
          writes: {
            prev: 0,
            current: 0,
            change: 0
          },
          read_lag: {
            prev: 0,
            current: 0,
            prevCount: 0,
            currentCount: 0
          },
          write_lag: {
            prev: 0,
            current: 0,
            prevCount: 0,
            currentCount: 0
          }
        }
      };
      bucketStats.Items.map(stat => {
        var index = bucketArrayIndex[stat.time];
        //logger.log(stat.id, stat.bucket, stat.time);

        //logger.log(stat);
        ["read", "write"].map(type => {
          var typeS = `${type}s`;
          if (stat.current[type] != undefined) {
            Object.keys(stat.current[type]).forEach((key, k) => {
              var link = stat.current[type][key];
              if (!(key in node.bots[type])) {
                node.bots[type][key] = botData(key, type, link, request_timestamp, buckets);
                node.bots[type][key].event = refObject.refId();
              }
              node[`${typeS}`][index].value += parseInt(link.units);
              node[`max_${type}_checkpoint`] = maxString(node[`${typeS}_checkpoint`], link.checkpoint);
              var bot = node.bots[type][key];
              bot.values[index].value = parseInt(link.units);
              var linkLag = link.timestamp - link.source_timestamp || 0;
              bot.lags[index].value += linkLag;
              var lag = node[`${type}_lag`][index];
              //node[`${typeS}_lag`][index].value += parseInt(link.units);
              lag.count++;
              lag.total += linkLag;
              //lag.value += parseInt(link.units);
              lag.min = lag.min != null ? Math.min(lag.min, linkLag) : linkLag;
              lag.max = Math.max(lag.max, linkLag);
              if (stat.time >= prevCompareTimestamp && stat.time < currentCompareTimestamp) {
                bot.compare[`${typeS}`].prev += parseInt(link.units);
                bot.compare[`${type}_lag`].prev += link.timestamp - link.source_timestamp || 0;
                bot.compare[`${type}_lag`].prevCount++;
              } else if (stat.time >= currentCompareTimestamp) {
                bot.compare[`${typeS}`].current += parseInt(link.units);
                bot.compare[`${type}_lag`].current += link.timestamp - link.source_timestamp || 0;
                bot.compare[`${type}_lag`].currentCount++;
              }
              bot[`last_${type}`] = link.timestamp;
              bot[`last_${type}_event_timestamp`] = parseInt(link.checkpoint && link.checkpoint.split && link.checkpoint.split(/\//).pop().split(/\-/)[0] || 0);
              bot.last_event_source_timestamp = link.source_timestamp;
              bot[`last_${type}_lag`] = request_timestamp.diff(moment(link.timestamp));
              bot.last_event_source_timestamp_lag = request_timestamp.diff(moment(link.source_timestamp));
              bot.checkpoint = link.checkpoint;
              bot.timestamp = parseInt(link.checkpoint && link.checkpoint.split && link.checkpoint.split(/\//).pop().split(/\-/)[0] || 0);
            });
          }
        });
      });
      ["read", "write"].map(type => {
        var typeS = `${type}s`;
        Object.keys(node.bots[type]).map(key => {
          let link = node.bots[type][key];
          if (link.compare[`${type}_lag`].currentCount) {
            link.compare[`${type}_lag`].current /= link.compare[`${type}_lag`].currentCount;
          }
          if (link.compare[`${type}_lag`].prevCount) {
            link.compare[`${type}_lag`].prev /= link.compare[`${type}_lag`].prevCount;
          }
          link.compare[`${type}_lag`].change = calcChange(link.compare[`${type}_lag`].current, link.compare[`${type}_lag`].prev);
          link.compare[`${typeS}`].change = calcChange(link.compare[`${typeS}`].current, link.compare[`${typeS}`].prev);
        });
      });
      node.reads.forEach(e => {
        if (e.time >= prevCompareTimestamp && e.time < currentCompareTimestamp) {
          node.compare.reads.prev += e.value;
        } else if (e.time >= currentCompareTimestamp) {
          node.compare.reads.current += e.value;
        }
      });
      node.writes.forEach(e => {
        if (e.time >= prevCompareTimestamp && e.time < currentCompareTimestamp) {
          node.compare.writes.prev += e.value;
        } else if (e.time >= currentCompareTimestamp) {
          node.compare.writes.current += e.value;
        }
      });
      node.read_lag.forEach(e => {
        if (e.total && e.time >= prevCompareTimestamp && e.time < currentCompareTimestamp) {
          node.compare.read_lag.prev += e.total;
          node.compare.read_lag.prevCount++;
        } else if (e.total && e.time >= currentCompareTimestamp) {
          node.compare.read_lag.current += e.total;
          node.compare.read_lag.currentCount++;
        }
      });
      if (node.compare.read_lag.current) {
        node.compare.read_lag.current /= node.compare.read_lag.currentCount;
      }
      if (node.compare.read_lag.prev) {
        node.compare.read_lag.prev /= node.compare.read_lag.prevcount;
      }
      node.write_lag.forEach(e => {
        if (e.total && e.time >= prevCompareTimestamp && e.time < currentCompareTimestamp) {
          node.compare.write_lag.prev += e.total;
          node.compare.write_lag.prevCount++;
        } else if (e.total && e.time >= currentCompareTimestamp) {
          node.compare.write_lag.current += e.total;
          node.compare.write_lag.currentCount++;
        }
      });
      if (node.compare.write_lag.current) {
        node.compare.write_lag.current /= node.compare.write_lag.currentCount;
      }
      if (node.compare.write_lag.prev) {
        node.compare.write_lag.prev /= node.compare.write_lag.prevCount;
      }
      node.compare.reads.change = calcChange(node.compare.reads.current, node.compare.reads.prev);
      node.compare.writes.change = calcChange(node.compare.writes.current, node.compare.writes.prev);
      node.compare.read_lag.change = calcChange(node.compare.read_lag.current, node.compare.read_lag.prev);
      node.compare.write_lag.change = calcChange(node.compare.write_lag.current, node.compare.write_lag.prev);
      done(null, node);
    });
  };
  var botsProcessor = function (done) {
    dynamodb.scan(CRON_TABLE, null, (err, bots) => {
      if (err) {
        done(err);
      } else {
        var id = refObject.refId();
        var rawId = refObject.id;
        done(null, bots.filter(bot => {
          let read = bot.checkpoints && bot.checkpoints.read || {};
          let write = bot.checkpoints && bot.checkpoints.write || {};
          return !bot.archived && (read[id] || read[rawId] || write[id] || write[rawId]);
        }).map(bot => {
          let read = bot.checkpoints && bot.checkpoints.read || {};
          let write = bot.checkpoints && bot.checkpoints.write || {};
          return {
            id: util.refId(bot.id, "bot"),
            read: read[id] || read[rawId],
            write: write[id] || write[rawId]
          };
        }));
      }
    });
  };
  async.parallel({
    bots: botsProcessor,
    self: selfProcessor
  }, (err, results) => {
    if (err) {
      logger.log(err);
      return callback(err);
    }
    var self = results.self;
    var bots = results.bots;
    var latestWriteCheckpoint = self["max_write_checkpoint"];
    // Make reads lags grow over time if not reading
    Object.keys(self.bots.read).map(key => {
      var link = self.bots.read[key];
      var last = {
        value: null
      };
      link.lags.map(function (v) {
        if (last.value !== null && v.value === null && link.checkpoint < latestWriteCheckpoint) {
          v.value = last.value + (v.time - last.time);
        }
        last = v;
      });
    });
    bots.map(bot => {
      if (!!bot.read && !self.bots.read[bot.id]) {
        self.bots.read[bot.id] = botData(bot.id, "read", {
          timestamp: bot.timestamp,
          source_timestamp: bot.source_timestamp,
          checkpoint: bot.checkpoint
        }, request_timestamp, buckets);
        self.bots.read[bot.id].event = refObject.refId();
      }
      if (!!bot.write && !self.bots.write[bot.id]) {
        self.bots.write[bot.id] = botData(bot.id, "write", {
          timestamp: bot.timestamp,
          source_timestamp: bot.source_timestamp,
          checkpoint: bot.checkpoint
        }, request_timestamp, buckets);
        self.bots.write[bot.id].event = refObject.refId();
      }
    });
    callback(err, self);
  });
}
function systemDashboard() {}
function smartMergeStats(s, r) {
  if (r.source_timestamp !== undefined) {
    return mergeStats(s, r);
  } else {
    return mergeExecutionStats(s, r);
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
function maxString() {
  var max = arguments[0];
  for (var i = 1; i < arguments.length; ++i) {
    if (arguments[i] != null && arguments[i] != undefined) {
      max = max > arguments[i] ? max : arguments[i];
    }
  }
  return max;
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

},{"../../lib/stats-buckets.js":2,"async":undefined,"leo-auth":undefined,"leo-config":undefined,"leo-logger":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined,"moment":undefined,"moment-round":undefined}],2:[function(require,module,exports){
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

},{"moment":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHN0YXRzQnVja2V0cyA9IHJlcXVpcmUoXCIuLi8uLi9saWIvc3RhdHMtYnVja2V0cy5qc1wiKTtcbnZhciB1dGlsID0gcmVxdWlyZShcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiKTtcbmxldCBsb2dnZXIgPSByZXF1aXJlKFwibGVvLWxvZ2dlclwiKShcImRhc2hib2FyZC1hcGlcIik7XG52YXIgbW9tZW50ID0gcmVxdWlyZShcIm1vbWVudFwiKTtcbnJlcXVpcmUoXCJtb21lbnQtcm91bmRcIik7XG52YXIgYXN5bmMgPSByZXF1aXJlKFwiYXN5bmNcIik7XG52YXIgQ1JPTl9UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9Dcm9uO1xudmFyIFNUQVRTX1RBQkxFID0gcmVxdWlyZShcImxlby1jb25maWdcIikuUmVzb3VyY2VzLkxlb1N0YXRzO1xuZnVuY3Rpb24gY2FsY0NoYW5nZShjdXJyZW50LCBwcmV2KSB7XG4gIGlmIChjdXJyZW50KSB7XG4gICAgaWYgKHByZXYpIHtcbiAgICAgIHJldHVybiBNYXRoLnJvdW5kKChjdXJyZW50IC0gcHJldikgLyBwcmV2ICogMTAwKSArICclJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFwiMTAwJVwiO1xuICAgIH1cbiAgfSBlbHNlIGlmIChwcmV2KSB7XG4gICAgcmV0dXJuIFwiLTEwMCVcIjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gXCIwJVwiO1xuICB9XG59XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIGlmICghZXZlbnQucGFyYW1zLnBhdGguaWQpIHtcbiAgICBsZXQgcmVmID0gdXRpbC5yZWYoZXZlbnQucGFyYW1zLnBhdGgudHlwZSk7XG4gICAgZXZlbnQucGFyYW1zLnBhdGguaWQgPSByZWYuaWQ7XG4gICAgZXZlbnQucGFyYW1zLnBhdGgudHlwZSA9IHJlZi50eXBlO1xuICB9XG4gIHZhciByZWZPYmplY3QgPSB1dGlsLnJlZihldmVudC5wYXJhbXMucGF0aC5pZCwgZXZlbnQucGFyYW1zLnBhdGgudHlwZSk7XG4gIGF3YWl0IHJlcXVlc3QuYXV0aG9yaXplKGV2ZW50LCB7XG4gICAgbHJuOiAnbHJuOmxlbzpib3Rtb246OjonLFxuICAgIGFjdGlvbjogXCJkYXNoYm9hcmRcIixcbiAgICBib3Rtb246IHt9XG4gIH0pO1xuICB2YXIgb3ZlcnJpZGVzID0ge1xuICAgIFwibWludXRlXCI6IFwibWludXRlXzFcIlxuICB9O1xuICB2YXIgciA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5yYW5nZSB8fCBldmVudC5wYXJhbXMucXVlcnlzdHJpbmcucGVyaW9kO1xuICBldmVudC5wYXJhbXMucXVlcnlzdHJpbmcucmFuZ2UgPSBvdmVycmlkZXNbcl0gfHwgcjtcbiAgdmFyIG51bWJlck9mUGVyaW9kcyA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5jb3VudCB8fCAxO1xuICB2YXIgcmVxdWVzdF90aW1lc3RhbXAgPSBtb21lbnQoZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLnRpbWVzdGFtcCk7XG4gIHZhciBjb21wYXJlQnVja2V0ID0gc3RhdHNCdWNrZXRzLmRhdGFbZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLnJhbmdlXTtcbiAgdmFyIGN1cnJlbnRDb21wYXJlVGltZXN0YW1wID0gY29tcGFyZUJ1Y2tldC5wcmV2KHJlcXVlc3RfdGltZXN0YW1wLmNsb25lKCksIDEgKiBudW1iZXJPZlBlcmlvZHMpLnZhbHVlT2YoKTtcbiAgdmFyIHByZXZDb21wYXJlVGltZXN0YW1wID0gY29tcGFyZUJ1Y2tldC5wcmV2KHJlcXVlc3RfdGltZXN0YW1wLmNsb25lKCksIDIgKiBudW1iZXJPZlBlcmlvZHMpLnZhbHVlT2YoKTtcbiAgdmFyIHN0YXJ0VGltZXN0YW1wID0gY29tcGFyZUJ1Y2tldC5wcmV2KHJlcXVlc3RfdGltZXN0YW1wLmNsb25lKCksIDMgKiBudW1iZXJPZlBlcmlvZHMpLnZhbHVlT2YoKTtcbiAgdmFyIHBlcmlvZCA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5yYW5nZTtcbiAgdmFyIHJhbmdlID0gc3RhdHNCdWNrZXRzLnJhbmdlc1twZXJpb2RdIHx8IHtcbiAgICBwZXJpb2Q6IHBlcmlvZCxcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLnN0YXJ0T2YocGVyaW9kLnJlcGxhY2UoL19bMC05XSskLykpXG4gIH07XG4gIGlmIChzdGF0c0J1Y2tldHMucmFuZ2VzW3BlcmlvZF0gJiYgc3RhdHNCdWNrZXRzLnJhbmdlc1twZXJpb2RdLnJvbGxpbmcgJiYgbnVtYmVyT2ZQZXJpb2RzID09IDEpIHtcbiAgICByYW5nZSA9IHN0YXRzQnVja2V0cy5yYW5nZXNbcGVyaW9kXS5yb2xsaW5nO1xuICB9XG4gIHZhciBidWNrZXQgPSBzdGF0c0J1Y2tldHMuZGF0YVtyYW5nZS5wZXJpb2RdO1xuICB2YXIgZW5kVGltZSA9IGJ1Y2tldC52YWx1ZShyZXF1ZXN0X3RpbWVzdGFtcC5jbG9uZSgpKTtcbiAgdmFyIHN0YXJ0VGltZSA9IGJ1Y2tldC52YWx1ZShtb21lbnQoc3RhcnRUaW1lc3RhbXApKTtcbiAgaWYgKGVuZFRpbWUgPiBtb21lbnQoKSkge1xuICAgIGVuZFRpbWUgPSBtb21lbnQoKTtcbiAgfVxuICB2YXIgc3RhcnRCdWNrZXQgPSBidWNrZXQudHJhbnNmb3JtKHN0YXJ0VGltZSk7XG4gIHZhciBlbmRCdWNrZXQgPSBidWNrZXQudHJhbnNmb3JtKGVuZFRpbWUpO1xuICBsb2dnZXIubG9nKFwiUkFXXCIsIG1vbWVudChzdGFydFRpbWUpLmZvcm1hdCgpLCBtb21lbnQoZW5kVGltZSkuZm9ybWF0KCksIHJlcXVlc3RfdGltZXN0YW1wLmZvcm1hdCgpKTtcbiAgbG9nZ2VyLmxvZyhcIk5FV1wiLCBzdGFydEJ1Y2tldCwgZW5kQnVja2V0KTtcbiAgdmFyIGJ1Y2tldHMgPSBbXTtcbiAgdmFyIGJ1Y2tldEFycmF5SW5kZXggPSB7fTtcbiAgdmFyIGMgPSBzdGFydFRpbWU7XG4gIHZhciBlID0gZW5kVGltZS52YWx1ZU9mKCk7XG4gIHZhciBjb3VudCA9IDA7XG4gIHdoaWxlIChjIDw9IGUpIHtcbiAgICB2YXIgdCA9IGJ1Y2tldC52YWx1ZShjLmNsb25lKCkpLnZhbHVlT2YoKTtcbiAgICBidWNrZXRzLnB1c2godCk7XG4gICAgYnVja2V0QXJyYXlJbmRleFt0XSA9IGNvdW50Kys7XG4gICAgYy5hZGQoYnVja2V0LmR1cmF0aW9uKTtcbiAgfVxuICB2YXIgaW5wdXRzID0ge1xuICAgIHJlcXVlc3RfdGltZXN0YW1wOiByZXF1ZXN0X3RpbWVzdGFtcCxcbiAgICBwcmV2Q29tcGFyZVRpbWVzdGFtcDogcHJldkNvbXBhcmVUaW1lc3RhbXAsXG4gICAgY3VycmVudENvbXBhcmVUaW1lc3RhbXA6IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wLFxuICAgIHN0YXJ0QnVja2V0OiBzdGFydEJ1Y2tldCxcbiAgICBlbmRCdWNrZXQ6IGVuZEJ1Y2tldCxcbiAgICBidWNrZXRzOiBidWNrZXRzLFxuICAgIHBlcmlvZDogcGVyaW9kLFxuICAgIGJ1Y2tldEFycmF5SW5kZXg6IGJ1Y2tldEFycmF5SW5kZXhcbiAgfTtcbiAgaWYgKHJlZk9iamVjdC50eXBlID09IFwiYm90XCIpIHtcbiAgICAvLyBMZW9fY3Jvbl9zdGF0cyBzdGFydC1lbmQgYnVja2V0IGV4ZWMgc3RhdHNcbiAgICAvLyBMZW9fY3JvbiBRdWVyeSBieSBpZFxuICAgIC8vIFF1ZXVlcyBmcm9tIENoZWNrcG9pbnRzXG4gICAgLy8gTGVvX2Nyb25fc3RhdHMgc3RhcnQtZW5kIHF1ZXVlIHN0YXRzXG5cbiAgICBib3REYXNoYm9hcmQocmVmT2JqZWN0LCBpbnB1dHMsIChlcnIsIGRhdGEpID0+IHtcbiAgICAgIGlmICghZXJyICYmIGRhdGEpIHtcbiAgICAgICAgZGF0YS5zdGFydCA9IHN0YXJ0VGltZS52YWx1ZU9mKCk7XG4gICAgICAgIGRhdGEuZW5kID0gZW5kVGltZS52YWx1ZU9mKCk7XG4gICAgICAgIGRhdGEuYnVja2V0cyA9IGJ1Y2tldHM7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhlcnIsIGRhdGEpO1xuICAgIH0pO1xuICB9IGVsc2UgaWYgKHJlZk9iamVjdC50eXBlID09IFwicXVldWVcIiB8fCByZWZPYmplY3QudHlwZSA9PSBcInN5c3RlbVwiKSB7XG4gICAgLy8gTGVvX2Nyb24gU2NhblxuICAgIC8vIEdldCBib3RzIHRoYXQgcmVmZXJlbmNlIHRoaXMgcXVldWVcbiAgICAvLyBMZW9fY3Jvbl9zdGF0cyBzdGFydC1lbmQgd3JpdGVzXG4gICAgLy8gTGVvX2Nyb25fU3RhdHMgc3RhcnQtZW5kIHJlYWRzXG4gICAgcXVldWVEYXNoYm9hcmQocmVmT2JqZWN0LCBpbnB1dHMsIChlcnIsIGRhdGEpID0+IHtcbiAgICAgIGlmICghZXJyICYmIGRhdGEpIHtcbiAgICAgICAgZGF0YS5zdGFydCA9IHN0YXJ0VGltZS52YWx1ZU9mKCk7XG4gICAgICAgIGRhdGEuZW5kID0gZW5kVGltZS52YWx1ZU9mKCk7XG4gICAgICAgIGRhdGEuYnVja2V0cyA9IGJ1Y2tldHM7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhlcnIsIGRhdGEpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGNhbGxiYWNrKGBVbmtub3duIHR5cGU6ICR7cmVmT2JqZWN0LnR5cGV9YCk7XG4gIH1cbn0pO1xuZnVuY3Rpb24gcXVldWVEYXRhKGtleSwgdHlwZSwgcXVldWUsIHJlcXVlc3RfdGltZXN0YW1wLCBidWNrZXRzKSB7XG4gIHZhciByZWYgPSB1dGlsLnJlZihrZXkpO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IHR5cGUsXG4gICAgaWQ6IHJlZi5yZWZJZCgpLFxuICAgIGV2ZW50OiByZWYuaWQsXG4gICAgbGFiZWw6IHJlZi5pZCxcbiAgICBbYGxhc3RfJHt0eXBlfWBdOiBxdWV1ZS50aW1lc3RhbXAsXG4gICAgW2BsYXN0XyR7dHlwZX1fZXZlbnRfdGltZXN0YW1wYF06IHBhcnNlSW50KHF1ZXVlLmNoZWNrcG9pbnQgJiYgcXVldWUuY2hlY2twb2ludC5zcGxpdCAmJiBxdWV1ZS5jaGVja3BvaW50LnNwbGl0KC9cXC8vKS5wb3AoKS5zcGxpdCgvXFwtLylbMF0gfHwgMCksXG4gICAgbGFzdF9ldmVudF9zb3VyY2VfdGltZXN0YW1wOiBxdWV1ZS5zb3VyY2VfdGltZXN0YW1wLFxuICAgIFtgbGFzdF8ke3R5cGV9X2xhZ2BdOiByZXF1ZXN0X3RpbWVzdGFtcC5kaWZmKG1vbWVudChxdWV1ZS50aW1lc3RhbXApKSxcbiAgICBsYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXBfbGFnOiByZXF1ZXN0X3RpbWVzdGFtcC5kaWZmKG1vbWVudChxdWV1ZS5zb3VyY2VfdGltZXN0YW1wKSksXG4gICAgdmFsdWVzOiBidWNrZXRzLm1hcCh0aW1lID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHZhbHVlOiAwLFxuICAgICAgICB0aW1lOiB0aW1lXG4gICAgICB9O1xuICAgIH0pLFxuICAgIGxhZ3M6IGJ1Y2tldHMubWFwKHRpbWUgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdmFsdWU6IG51bGwsXG4gICAgICAgIHRpbWU6IHRpbWVcbiAgICAgIH07XG4gICAgfSksXG4gICAgW2Ake3R5cGV9c2BdOiB0eXBlID09PSBcInJlYWRcIiAmJiBidWNrZXRzLm1hcCh0aW1lID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHZhbHVlOiAwLFxuICAgICAgICB0aW1lOiB0aW1lXG4gICAgICB9O1xuICAgIH0pIHx8IHVuZGVmaW5lZCxcbiAgICBjb21wYXJlOiB7XG4gICAgICBbYCR7dHlwZX1zYF06IHtcbiAgICAgICAgcHJldjogMCxcbiAgICAgICAgY3VycmVudDogMCxcbiAgICAgICAgY2hhbmdlOiAwXG4gICAgICB9LFxuICAgICAgW2Ake3R5cGV9X2xhZ2BdOiB7XG4gICAgICAgIHByZXY6IDAsXG4gICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgIHByZXZDb3VudDogMCxcbiAgICAgICAgY3VycmVudENvdW50OiAwXG4gICAgICB9XG4gICAgfSxcbiAgICBsYWdFdmVudHM6IDAsXG4gICAgY2hlY2twb2ludDogcXVldWUuY2hlY2twb2ludCxcbiAgICB0aW1lc3RhbXA6IHBhcnNlSW50KHF1ZXVlLmNoZWNrcG9pbnQgJiYgcXVldWUuY2hlY2twb2ludC5zcGxpdCAmJiBxdWV1ZS5jaGVja3BvaW50LnNwbGl0KC9cXC8vKS5wb3AoKS5zcGxpdCgvXFwtLylbMF0gfHwgMClcbiAgfTtcbn1cbmZ1bmN0aW9uIGJvdERhc2hib2FyZChyZWZPYmplY3QsIGRhdGEsIGNhbGxiYWNrKSB7XG4gIHZhciBzdGFydEJ1Y2tldCA9IGRhdGEuc3RhcnRCdWNrZXQ7XG4gIHZhciBlbmRCdWNrZXQgPSBkYXRhLmVuZEJ1Y2tldDtcbiAgdmFyIGJ1Y2tldHMgPSBkYXRhLmJ1Y2tldHM7XG4gIHZhciBwZXJpb2QgPSBkYXRhLnBlcmlvZDtcbiAgdmFyIGJ1Y2tldEFycmF5SW5kZXggPSBkYXRhLmJ1Y2tldEFycmF5SW5kZXg7XG4gIHZhciByZXF1ZXN0X3RpbWVzdGFtcCA9IGRhdGEucmVxdWVzdF90aW1lc3RhbXA7XG4gIHZhciBwcmV2Q29tcGFyZVRpbWVzdGFtcCA9IGRhdGEucHJldkNvbXBhcmVUaW1lc3RhbXA7XG4gIHZhciBjdXJyZW50Q29tcGFyZVRpbWVzdGFtcCA9IGRhdGEuY3VycmVudENvbXBhcmVUaW1lc3RhbXA7XG4gIHZhciBzZWxmUHJvY2Vzc29yID0gZnVuY3Rpb24gKHJlZiwgZG9uZSkge1xuICAgIGxlby5hd3MuZHluYW1vZGIucXVlcnkoe1xuICAgICAgVGFibGVOYW1lOiBTVEFUU19UQUJMRSxcbiAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246IFwiI2lkID0gOmlkIGFuZCAjYnVja2V0IGJldHdlZW4gOmJ1Y2tldCBhbmQgOmVuZEJ1Y2tldFwiLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgIFwiI2J1Y2tldFwiOiBcImJ1Y2tldFwiLFxuICAgICAgICBcIiNpZFwiOiBcImlkXCJcbiAgICAgIH0sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgIFwiOmJ1Y2tldFwiOiBzdGFydEJ1Y2tldCxcbiAgICAgICAgXCI6ZW5kQnVja2V0XCI6IGVuZEJ1Y2tldCxcbiAgICAgICAgXCI6aWRcIjogcmVmLnJlZklkKClcbiAgICAgIH0sXG4gICAgICBcIlJldHVybkNvbnN1bWVkQ2FwYWNpdHlcIjogJ1RPVEFMJ1xuICAgIH0sIHtcbiAgICAgIG1iOiAxMDBcbiAgICB9KS5jYXRjaChjYWxsYmFjaykudGhlbihidWNrZXRTdGF0cyA9PiB7XG4gICAgICBsb2dnZXIubG9nKHBlcmlvZCwgYnVja2V0U3RhdHMuTGFzdEV2YWx1YXRlZEtleSwgYnVja2V0U3RhdHMuQ29uc3VtZWRDYXBhY2l0eSwgYnVja2V0U3RhdHMuSXRlbXMubGVuZ3RoKTtcbiAgICAgIHZhciBub2RlID0ge1xuICAgICAgICBleGVjdXRpb25zOiBidWNrZXRzLm1hcCh0aW1lID0+IHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsdWU6IDAsXG4gICAgICAgICAgICB0aW1lOiB0aW1lXG4gICAgICAgICAgfTtcbiAgICAgICAgfSksXG4gICAgICAgIGVycm9yczogYnVja2V0cy5tYXAodGltZSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlOiAwLFxuICAgICAgICAgICAgdGltZTogdGltZVxuICAgICAgICAgIH07XG4gICAgICAgIH0pLFxuICAgICAgICBkdXJhdGlvbjogYnVja2V0cy5tYXAodGltZSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlOiAwLFxuICAgICAgICAgICAgdG90YWw6IDAsXG4gICAgICAgICAgICBtaW46IDAsXG4gICAgICAgICAgICBtYXg6IDAsXG4gICAgICAgICAgICB0aW1lOiB0aW1lXG4gICAgICAgICAgfTtcbiAgICAgICAgfSksXG4gICAgICAgIHF1ZXVlczoge1xuICAgICAgICAgIHJlYWQ6IHt9LFxuICAgICAgICAgIHdyaXRlOiB7fVxuICAgICAgICB9LFxuICAgICAgICBjb21wYXJlOiB7XG4gICAgICAgICAgZXhlY3V0aW9uczoge1xuICAgICAgICAgICAgcHJldjogMCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgICAgICBjaGFuZ2U6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVycm9yczoge1xuICAgICAgICAgICAgcHJldjogMCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgICAgICBjaGFuZ2U6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIGR1cmF0aW9uOiB7XG4gICAgICAgICAgICBwcmV2OiAwLFxuICAgICAgICAgICAgY3VycmVudDogMCxcbiAgICAgICAgICAgIGNoYW5nZTogMFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGJ1Y2tldFN0YXRzLkl0ZW1zLm1hcChzdGF0ID0+IHtcbiAgICAgICAgdmFyIGluZGV4ID0gYnVja2V0QXJyYXlJbmRleFtzdGF0LnRpbWVdO1xuICAgICAgICAvL2xvZ2dlci5sb2coc3RhdC5pZCwgc3RhdC5idWNrZXQpO1xuICAgICAgICBpZiAoc3RhdC5jdXJyZW50LmV4ZWN1dGlvbikge1xuICAgICAgICAgIGxldCBleGVjID0gc3RhdC5jdXJyZW50LmV4ZWN1dGlvbjtcbiAgICAgICAgICBub2RlLmV4ZWN1dGlvbnNbaW5kZXhdLnZhbHVlID0gZXhlYy51bml0cztcbiAgICAgICAgICBub2RlLmVycm9yc1tpbmRleF0udmFsdWUgPSBleGVjLmVycm9yczsgLy9NYXRoLm1heChleGVjLmVycm9ycywgZXhlYy51bml0cyAtIGV4ZWMuY29tcGxldGlvbnMpO1xuICAgICAgICAgIG5vZGUuZHVyYXRpb25baW5kZXhdID0ge1xuICAgICAgICAgICAgdmFsdWU6IGV4ZWMuZHVyYXRpb24gLyBleGVjLnVuaXRzLFxuICAgICAgICAgICAgdG90YWw6IGV4ZWMuZHVyYXRpb24sXG4gICAgICAgICAgICBtYXg6IGV4ZWMubWF4X2R1cmF0aW9uLFxuICAgICAgICAgICAgbWluOiBleGVjLm1pbl9kdXJhdGlvbixcbiAgICAgICAgICAgIHRpbWU6IHN0YXQudGltZVxuICAgICAgICAgIH07XG4gICAgICAgICAgaWYgKHN0YXQudGltZSA+PSBwcmV2Q29tcGFyZVRpbWVzdGFtcCAmJiBzdGF0LnRpbWUgPCBjdXJyZW50Q29tcGFyZVRpbWVzdGFtcCkge1xuICAgICAgICAgICAgbm9kZS5jb21wYXJlLmV4ZWN1dGlvbnMucHJldiArPSBub2RlLmV4ZWN1dGlvbnNbaW5kZXhdLnZhbHVlO1xuICAgICAgICAgICAgbm9kZS5jb21wYXJlLmVycm9ycy5wcmV2ICs9IG5vZGUuZXJyb3JzW2luZGV4XS52YWx1ZTtcbiAgICAgICAgICAgIG5vZGUuY29tcGFyZS5kdXJhdGlvbi5wcmV2ICs9IG5vZGUuZHVyYXRpb25baW5kZXhdLnRvdGFsO1xuICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdC50aW1lID49IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgICBub2RlLmNvbXBhcmUuZXhlY3V0aW9ucy5jdXJyZW50ICs9IG5vZGUuZXhlY3V0aW9uc1tpbmRleF0udmFsdWU7XG4gICAgICAgICAgICBub2RlLmNvbXBhcmUuZXJyb3JzLmN1cnJlbnQgKz0gbm9kZS5lcnJvcnNbaW5kZXhdLnZhbHVlO1xuICAgICAgICAgICAgbm9kZS5jb21wYXJlLmR1cmF0aW9uLmN1cnJlbnQgKz0gbm9kZS5kdXJhdGlvbltpbmRleF0udG90YWw7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFtcInJlYWRcIiwgXCJ3cml0ZVwiXS5tYXAodHlwZSA9PiB7XG4gICAgICAgICAgdmFyIHR5cGVTID0gYCR7dHlwZX1zYDtcbiAgICAgICAgICBpZiAoc3RhdC5jdXJyZW50W3R5cGVdICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoc3RhdC5jdXJyZW50W3R5cGVdKS5mb3JFYWNoKChrZXksIGspID0+IHtcbiAgICAgICAgICAgICAgdmFyIGxpbmsgPSBzdGF0LmN1cnJlbnRbdHlwZV1ba2V5XTtcbiAgICAgICAgICAgICAgaWYgKCEoa2V5IGluIG5vZGUucXVldWVzW3R5cGVdKSkge1xuICAgICAgICAgICAgICAgIG5vZGUucXVldWVzW3R5cGVdW2tleV0gPSBxdWV1ZURhdGEoa2V5LCB0eXBlLCBsaW5rLCByZXF1ZXN0X3RpbWVzdGFtcCwgYnVja2V0cyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdmFyIHF1ZXVlID0gbm9kZS5xdWV1ZXNbdHlwZV1ba2V5XTtcbiAgICAgICAgICAgICAgcXVldWUubGFnc1tpbmRleF0udmFsdWUgKz0gbGluay50aW1lc3RhbXAgLSBsaW5rLnNvdXJjZV90aW1lc3RhbXAgfHwgMDtcbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT09IFwid3JpdGVcIikge1xuICAgICAgICAgICAgICAgIHF1ZXVlLnZhbHVlc1tpbmRleF0udmFsdWUgKz0gcGFyc2VJbnQobGluay51bml0cyk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcXVldWVbYCR7dHlwZVN9YF1baW5kZXhdLnZhbHVlICs9IHBhcnNlSW50KGxpbmsudW5pdHMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChzdGF0LnRpbWUgPj0gcHJldkNvbXBhcmVUaW1lc3RhbXAgJiYgc3RhdC50aW1lIDwgY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICAgICAgICBxdWV1ZS5jb21wYXJlW2Ake3R5cGVTfWBdLnByZXYgKz0gcGFyc2VJbnQobGluay51bml0cyk7XG4gICAgICAgICAgICAgICAgcXVldWUuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2ICs9IGxpbmsudGltZXN0YW1wIC0gbGluay5zb3VyY2VfdGltZXN0YW1wIHx8IDA7XG4gICAgICAgICAgICAgICAgcXVldWUuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2Q291bnQrKztcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0LnRpbWUgPj0gY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICAgICAgICBxdWV1ZS5jb21wYXJlW2Ake3R5cGVTfWBdLmN1cnJlbnQgKz0gcGFyc2VJbnQobGluay51bml0cyk7XG4gICAgICAgICAgICAgICAgcXVldWUuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5jdXJyZW50ICs9IGxpbmsudGltZXN0YW1wIC0gbGluay5zb3VyY2VfdGltZXN0YW1wIHx8IDA7XG4gICAgICAgICAgICAgICAgcXVldWUuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5jdXJyZW50Q291bnQrKztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBxdWV1ZVtgbGFzdF8ke3R5cGV9YF0gPSBsaW5rLnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgcXVldWVbYGxhc3RfJHt0eXBlfV9ldmVudF90aW1lc3RhbXBgXSA9IHBhcnNlSW50KGxpbmsuY2hlY2twb2ludCAmJiBsaW5rLmNoZWNrcG9pbnQuc3BsaXQgJiYgbGluay5jaGVja3BvaW50LnNwbGl0KC9cXC8vKS5wb3AoKS5zcGxpdCgvXFwtLylbMF0gfHwgMCk7XG4gICAgICAgICAgICAgIHF1ZXVlLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcCA9IGxpbmsuc291cmNlX3RpbWVzdGFtcDtcbiAgICAgICAgICAgICAgcXVldWVbYGxhc3RfJHt0eXBlfV9sYWdgXSA9IHJlcXVlc3RfdGltZXN0YW1wLmRpZmYobW9tZW50KGxpbmsudGltZXN0YW1wKSk7XG4gICAgICAgICAgICAgIHF1ZXVlLmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcF9sYWcgPSByZXF1ZXN0X3RpbWVzdGFtcC5kaWZmKG1vbWVudChsaW5rLnNvdXJjZV90aW1lc3RhbXApKTtcbiAgICAgICAgICAgICAgcXVldWUuY2hlY2twb2ludCA9IGxpbmsuY2hlY2twb2ludDtcbiAgICAgICAgICAgICAgcXVldWUudGltZXN0YW1wID0gcGFyc2VJbnQobGluay5jaGVja3BvaW50ICYmIGxpbmsuY2hlY2twb2ludC5zcGxpdCAmJiBsaW5rLmNoZWNrcG9pbnQuc3BsaXQoL1xcLy8pLnBvcCgpLnNwbGl0KC9cXC0vKVswXSB8fCAwKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGlmIChub2RlLmNvbXBhcmUuZXhlY3V0aW9ucy5jdXJyZW50KSB7XG4gICAgICAgIG5vZGUuY29tcGFyZS5kdXJhdGlvbi5jdXJyZW50IC89IG5vZGUuY29tcGFyZS5leGVjdXRpb25zLmN1cnJlbnQ7XG4gICAgICB9XG4gICAgICBpZiAobm9kZS5jb21wYXJlLmV4ZWN1dGlvbnMucHJldikge1xuICAgICAgICBub2RlLmNvbXBhcmUuZHVyYXRpb24ucHJldiAvPSBub2RlLmNvbXBhcmUuZXhlY3V0aW9ucy5wcmV2O1xuICAgICAgfVxuICAgICAgbm9kZS5jb21wYXJlLmV4ZWN1dGlvbnMuY2hhbmdlID0gY2FsY0NoYW5nZShub2RlLmNvbXBhcmUuZXhlY3V0aW9ucy5jdXJyZW50LCBub2RlLmNvbXBhcmUuZXhlY3V0aW9ucy5wcmV2KTtcbiAgICAgIG5vZGUuY29tcGFyZS5lcnJvcnMuY2hhbmdlID0gY2FsY0NoYW5nZShub2RlLmNvbXBhcmUuZXJyb3JzLmN1cnJlbnQsIG5vZGUuY29tcGFyZS5lcnJvcnMucHJldik7XG4gICAgICBub2RlLmNvbXBhcmUuZHVyYXRpb24uY2hhbmdlID0gY2FsY0NoYW5nZShub2RlLmNvbXBhcmUuZHVyYXRpb24uY3VycmVudCwgbm9kZS5jb21wYXJlLmR1cmF0aW9uLnByZXYpO1xuICAgICAgW1wicmVhZFwiLCBcIndyaXRlXCJdLm1hcCh0eXBlID0+IHtcbiAgICAgICAgdmFyIHR5cGVTID0gYCR7dHlwZX1zYDtcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZS5xdWV1ZXNbdHlwZV0pLm1hcChrZXkgPT4ge1xuICAgICAgICAgIGxldCBsaW5rID0gbm9kZS5xdWV1ZXNbdHlwZV1ba2V5XTtcbiAgICAgICAgICBpZiAobGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLmN1cnJlbnRDb3VudCkge1xuICAgICAgICAgICAgbGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLmN1cnJlbnQgLz0gbGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLmN1cnJlbnRDb3VudDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2Q291bnQpIHtcbiAgICAgICAgICAgIGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2IC89IGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2Q291bnQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5jaGFuZ2UgPSBjYWxjQ2hhbmdlKGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5jdXJyZW50LCBsaW5rLmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0ucHJldik7XG4gICAgICAgICAgbGluay5jb21wYXJlW2Ake3R5cGVTfWBdLmNoYW5nZSA9IGNhbGNDaGFuZ2UobGluay5jb21wYXJlW2Ake3R5cGVTfWBdLmN1cnJlbnQsIGxpbmsuY29tcGFyZVtgJHt0eXBlU31gXS5wcmV2KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGRvbmUobnVsbCwgbm9kZSk7XG4gICAgfSk7XG4gIH07XG4gIHZhciBib3RQcm9jZXNzb3IgPSBmdW5jdGlvbiAocmVmLCBkb25lKSB7XG4gICAgZHluYW1vZGIuZ2V0KENST05fVEFCTEUsIHJlZi5pZCwgKGVyciwgYm90KSA9PiB7XG4gICAgICBkb25lKGVyciwgYm90KTtcbiAgICB9KTtcbiAgfTtcbiAgYXN5bmMucGFyYWxsZWwoe1xuICAgIGJvdDogZG9uZSA9PiBib3RQcm9jZXNzb3IocmVmT2JqZWN0LCBkb25lKSxcbiAgICBzZWxmOiBkb25lID0+IHNlbGZQcm9jZXNzb3IocmVmT2JqZWN0LCBkb25lKVxuICB9LCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgdmFyIHNlbGYgPSByZXN1bHRzLnNlbGY7XG4gICAgdmFyIGJvdCA9IHJlc3VsdHMuYm90IHx8IHt9O1xuICAgIHZhciB0YXNrcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKHNlbGYucXVldWVzICYmIHNlbGYucXVldWVzLnJlYWQgfHwge30pLm1hcChrZXkgPT4ge1xuICAgICAgdGFza3MucHVzaChkb25lID0+IHtcbiAgICAgICAgbGVvLmF3cy5keW5hbW9kYi5xdWVyeSh7XG4gICAgICAgICAgVGFibGVOYW1lOiBTVEFUU19UQUJMRSxcbiAgICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiBcIiNpZCA9IDppZCBhbmQgI2J1Y2tldCBiZXR3ZWVuIDpidWNrZXQgYW5kIDplbmRCdWNrZXRcIixcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgICAgIFwiI2J1Y2tldFwiOiBcImJ1Y2tldFwiLFxuICAgICAgICAgICAgXCIjaWRcIjogXCJpZFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgICBcIjpidWNrZXRcIjogc3RhcnRCdWNrZXQsXG4gICAgICAgICAgICBcIjplbmRCdWNrZXRcIjogZW5kQnVja2V0LFxuICAgICAgICAgICAgXCI6aWRcIjogdXRpbC5yZWYoa2V5KS5xdWV1ZSgpLnJlZklkKClcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiUmV0dXJuQ29uc3VtZWRDYXBhY2l0eVwiOiAnVE9UQUwnXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBtYjogMTAwXG4gICAgICAgIH0pLmNhdGNoKGRvbmUpLnRoZW4oYnVja2V0U3RhdHMgPT4ge1xuICAgICAgICAgIHZhciBpc0JlaGluZCA9IGZhbHNlO1xuICAgICAgICAgIHZhciBpc0JlaGluZE9uTGFzdCA9IGZhbHNlO1xuICAgICAgICAgIHZhciBpc0JlaGluZE9uRmlyc3QgPSBmYWxzZTtcbiAgICAgICAgICBidWNrZXRTdGF0cy5JdGVtcy5tYXAoc3RhdCA9PiB7XG4gICAgICAgICAgICB2YXIgdGltZSA9IHN0YXQudGltZSB8fCBtb21lbnQudXRjKHN0YXQuYnVja2V0LnJlcGxhY2UoL14uKl8vLCBcIlwiKSwgXCJcIikudmFsdWVPZigpO1xuICAgICAgICAgICAgdmFyIGluZGV4ID0gYnVja2V0QXJyYXlJbmRleFt0aW1lXTtcbiAgICAgICAgICAgIHZhciBxdWV1ZSA9IHNlbGYucXVldWVzLnJlYWRbc3RhdC5pZF07XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhzdGF0LmN1cnJlbnQud3JpdGUgfHwge30pLm1hcChrZXkgPT4ge1xuICAgICAgICAgICAgICBsZXQgbGluayA9IHN0YXQuY3VycmVudC53cml0ZVtrZXldO1xuICAgICAgICAgICAgICBxdWV1ZS52YWx1ZXNbaW5kZXhdLnZhbHVlICs9IHBhcnNlSW50KGxpbmsudW5pdHMpO1xuICAgICAgICAgICAgICBxdWV1ZS5sYXRlc3RXcml0ZUNoZWNrcG9pbnQgPSBtYXhTdHJpbmcocXVldWUubGF0ZXN0V3JpdGVDaGVja3BvaW50LCBsaW5rLmNoZWNrcG9pbnQpO1xuICAgICAgICAgICAgICBpZiAobGluay50aW1lc3RhbXAgPiBxdWV1ZS5sYXN0X3JlYWRfZXZlbnRfdGltZXN0YW1wIHx8IGxpbmsuY2hlY2twb2ludCAmJiBxdWV1ZS5jaGVja3BvaW50IDwgbGluay5jaGVja3BvaW50KSB7XG4gICAgICAgICAgICAgICAgcXVldWUubGFnRXZlbnRzICs9IHBhcnNlSW50KGxpbmsudW5pdHMpO1xuICAgICAgICAgICAgICAgIGlmICghaXNCZWhpbmQpIHtcbiAgICAgICAgICAgICAgICAgIC8vVGhlbiB3ZSBmb3VuZCBvdXIgZmlyc3Qgb25lIHRoYXQgaXMgYmVoaW5kXG4gICAgICAgICAgICAgICAgICBxdWV1ZS52YWx1ZXNbaW5kZXhdLm1hcmtlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlzQmVoaW5kID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggPT0gMCkge1xuICAgICAgICAgICAgICAgICAgaXNCZWhpbmRPbkZpcnN0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGluZGV4ID09IGJ1Y2tldHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICBpc0JlaGluZE9uTGFzdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmICghcXVldWUuY29tcGFyZS53cml0ZXMpIHtcbiAgICAgICAgICAgICAgICBxdWV1ZS5jb21wYXJlLndyaXRlcyA9IHtcbiAgICAgICAgICAgICAgICAgIHByZXY6IDAsXG4gICAgICAgICAgICAgICAgICBjdXJyZW50OiAwLFxuICAgICAgICAgICAgICAgICAgY2hhbmdlOiAwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoc3RhdC50aW1lID49IHByZXZDb21wYXJlVGltZXN0YW1wICYmIHN0YXQudGltZSA8IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgICAgICAgcXVldWUuY29tcGFyZVtgd3JpdGVzYF0ucHJldiArPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0LnRpbWUgPj0gY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICAgICAgICBxdWV1ZS5jb21wYXJlW2B3cml0ZXNgXS5jdXJyZW50ICs9IHBhcnNlSW50KGxpbmsudW5pdHMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgbGV0IHNvdXJjZSA9IGJvdC5sYW1iZGEgJiYgYm90LmxhbWJkYS5zZXR0aW5ncyAmJiBib3QubGFtYmRhLnNldHRpbmdzWzBdICYmIGJvdC5sYW1iZGEuc2V0dGluZ3NbMF0uc291cmNlO1xuICAgIHNlbGYua2luZXNpc19udW1iZXIgPSBib3QuY2hlY2twb2ludHMgJiYgYm90LmNoZWNrcG9pbnRzLnJlYWQgJiYgYm90LmNoZWNrcG9pbnRzLnJlYWRbc291cmNlXSAmJiBib3QuY2hlY2twb2ludHMucmVhZFtzb3VyY2VdLmNoZWNrcG9pbnQ7XG4gICAgaWYgKCFzZWxmLmtpbmVzaXNfbnVtYmVyKSB7XG4gICAgICBzZWxmLmtpbmVzaXNfbnVtYmVyID0gT2JqZWN0LmtleXMoYm90LmNoZWNrcG9pbnRzICYmIGJvdC5jaGVja3BvaW50cy5yZWFkIHx8IHt9KS5tYXAoYiA9PiBib3QuY2hlY2twb2ludHMucmVhZFtiXS5jaGVja3BvaW50KS5maWx0ZXIoYyA9PiAhIWMpLnNvcnQoKS5wb3AoMCkgfHwgXCJcIjtcbiAgICB9XG5cbiAgICAvLyBBZGQgbWlzc2luZyBRdWV1ZXMgZnJvbSBjaGVja3BvaW50c1xuICAgIHRhc2tzLnB1c2goZG9uZSA9PiB7XG4gICAgICB2YXIgY3AgPSBib3QuY2hlY2twb2ludHMgfHwge307XG4gICAgICBbXCJyZWFkXCIsIFwid3JpdGVcIl0ubWFwKHR5cGUgPT4ge1xuICAgICAgICBPYmplY3Qua2V5cyhjcFt0eXBlXSkubWFwKGtleSA9PiB7XG4gICAgICAgICAgdmFyIGlkID0gdXRpbC5yZWZJZChrZXkpO1xuICAgICAgICAgIHZhciBxdWV1ZSA9IHNlbGYucXVldWVzW3R5cGVdW2lkXTtcbiAgICAgICAgICBpZiAoIXF1ZXVlKSB7XG4gICAgICAgICAgICB2YXIgZGF0YSA9IGNwW3R5cGVdW2tleV07XG4gICAgICAgICAgICBzZWxmLnF1ZXVlc1t0eXBlXVtpZF0gPSBxdWV1ZURhdGEoaWQsIHR5cGUsIHtcbiAgICAgICAgICAgICAgdGltZXN0YW1wOiBkYXRhLmVuZGVkX3RpbWVzdGFtcCxcbiAgICAgICAgICAgICAgY2hlY2twb2ludDogZGF0YS5jaGVja3BvaW50LFxuICAgICAgICAgICAgICBzb3VyY2VfdGltZXN0YW1wOiBkYXRhLnNvdXJjZV90aW1lc3RhbXBcbiAgICAgICAgICAgIH0sIHJlcXVlc3RfdGltZXN0YW1wLCBidWNrZXRzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBkb25lKCk7XG4gICAgfSk7XG4gICAgYXN5bmMucGFyYWxsZWwodGFza3MsIChlcnIsIHJlc3VsdHMpID0+IHtcbiAgICAgIC8vbG9nZ2VyLmxvZyhKU09OLnN0cmluZ2lmeShib3QsIG51bGwsIDIpKTtcblxuICAgICAgLy8gTWFrZSByZWFkcyBsYWdzIGdyb3cgb3ZlciB0aW1lIGlmIG5vdCByZWFkaW5nXG4gICAgICBPYmplY3Qua2V5cyhzZWxmLnF1ZXVlcy5yZWFkKS5tYXAoa2V5ID0+IHtcbiAgICAgICAgdmFyIGxpbmsgPSBzZWxmLnF1ZXVlcy5yZWFkW2tleV07XG4gICAgICAgIGlmIChsaW5rLmNvbXBhcmUud3JpdGVzKSB7XG4gICAgICAgICAgbGluay5jb21wYXJlLndyaXRlcy5jaGFuZ2UgPSBjYWxjQ2hhbmdlKGxpbmsuY29tcGFyZS53cml0ZXMuY3VycmVudCwgbGluay5jb21wYXJlLndyaXRlcy5wcmV2KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbGFzdCA9IHtcbiAgICAgICAgICB2YWx1ZTogbnVsbFxuICAgICAgICB9O1xuICAgICAgICB2YXIgbGF0ZXN0V3JpdGVDaGVja3BvaW50ID0gbGluay5sYXRlc3RXcml0ZUNoZWNrcG9pbnQ7XG4gICAgICAgIGxpbmsubGFncy5tYXAoZnVuY3Rpb24gKHYpIHtcbiAgICAgICAgICBpZiAobGFzdC52YWx1ZSAhPT0gbnVsbCAmJiB2LnZhbHVlID09PSBudWxsICYmIGxpbmsuY2hlY2twb2ludCA8IGxhdGVzdFdyaXRlQ2hlY2twb2ludCkge1xuICAgICAgICAgICAgdi52YWx1ZSA9IGxhc3QudmFsdWUgKyAodi50aW1lIC0gbGFzdC50aW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbGFzdCA9IHY7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhlcnIsIHNlbGYpO1xuICAgIH0pO1xuICB9KTtcbn1cbmZ1bmN0aW9uIGJvdERhdGEoa2V5LCB0eXBlLCBib3QsIHJlcXVlc3RfdGltZXN0YW1wLCBidWNrZXRzKSB7XG4gIHZhciByZWYgPSB1dGlsLnJlZihrZXkpO1xuICByZXR1cm4ge1xuICAgIGlkOiByZWYucmVmSWQoKSxcbiAgICB0eXBlOiB0eXBlLFxuICAgIGV2ZW50OiByZWYuaWQsXG4gICAgbGFiZWw6IHJlZi5pZCxcbiAgICBsYXN0X3dyaXRlOiBib3QudGltZXN0YW1wLFxuICAgIGxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcDogYm90LnNvdXJjZV90aW1lc3RhbXAsXG4gICAgbGFzdF93cml0ZV9sYWc6IHJlcXVlc3RfdGltZXN0YW1wLmRpZmYobW9tZW50KGJvdC50aW1lc3RhbXApKSxcbiAgICB2YWx1ZXM6IGJ1Y2tldHMubWFwKHRpbWUgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdmFsdWU6IDAsXG4gICAgICAgIHRpbWU6IHRpbWVcbiAgICAgIH07XG4gICAgfSksXG4gICAgbGFnczogYnVja2V0cy5tYXAodGltZSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB2YWx1ZTogbnVsbCxcbiAgICAgICAgdGltZTogdGltZVxuICAgICAgfTtcbiAgICB9KSxcbiAgICBsYWdFdmVudHM6IDAsXG4gICAgY29tcGFyZToge1xuICAgICAgcmVhZHM6IHtcbiAgICAgICAgcHJldjogMCxcbiAgICAgICAgY3VycmVudDogMCxcbiAgICAgICAgY2hhbmdlOiAwXG4gICAgICB9LFxuICAgICAgd3JpdGVzOiB7XG4gICAgICAgIHByZXY6IDAsXG4gICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgIGNoYW5nZTogMFxuICAgICAgfSxcbiAgICAgIHJlYWRfbGFnOiB7XG4gICAgICAgIHByZXY6IDAsXG4gICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgIHByZXZDb3VudDogMCxcbiAgICAgICAgY3VycmVudENvdW50OiAwXG4gICAgICB9LFxuICAgICAgd3JpdGVfbGFnOiB7XG4gICAgICAgIHByZXY6IDAsXG4gICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgIHByZXZDb3VudDogMCxcbiAgICAgICAgY3VycmVudENvdW50OiAwXG4gICAgICB9XG4gICAgfSxcbiAgICBsYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXBfbGFnOiByZXF1ZXN0X3RpbWVzdGFtcC5kaWZmKG1vbWVudChib3Quc291cmNlX3RpbWVzdGFtcCkpLFxuICAgIGNoZWNrcG9pbnQ6IGJvdC5jaGVja3BvaW50LFxuICAgIHRpbWVzdGFtcDogcGFyc2VJbnQoYm90LmNoZWNrcG9pbnQgJiYgYm90LmNoZWNrcG9pbnQuc3BsaXQoL1xcLy8pLnBvcCgpLnNwbGl0KC9cXC0vKVswXSB8fCAwKVxuICB9O1xufVxuZnVuY3Rpb24gcXVldWVEYXNoYm9hcmQocmVmT2JqZWN0LCBkYXRhLCBjYWxsYmFjaykge1xuICB2YXIgc3RhcnRCdWNrZXQgPSBkYXRhLnN0YXJ0QnVja2V0O1xuICB2YXIgZW5kQnVja2V0ID0gZGF0YS5lbmRCdWNrZXQ7XG4gIHZhciBidWNrZXRzID0gZGF0YS5idWNrZXRzO1xuICB2YXIgcGVyaW9kID0gZGF0YS5wZXJpb2Q7XG4gIHZhciBidWNrZXRBcnJheUluZGV4ID0gZGF0YS5idWNrZXRBcnJheUluZGV4O1xuICB2YXIgcmVxdWVzdF90aW1lc3RhbXAgPSBkYXRhLnJlcXVlc3RfdGltZXN0YW1wO1xuICB2YXIgcHJldkNvbXBhcmVUaW1lc3RhbXAgPSBkYXRhLnByZXZDb21wYXJlVGltZXN0YW1wO1xuICB2YXIgY3VycmVudENvbXBhcmVUaW1lc3RhbXAgPSBkYXRhLmN1cnJlbnRDb21wYXJlVGltZXN0YW1wO1xuICB2YXIgc2VsZlByb2Nlc3NvciA9IGZ1bmN0aW9uIChkb25lKSB7XG4gICAgbGVvLmF3cy5keW5hbW9kYi5xdWVyeSh7XG4gICAgICBUYWJsZU5hbWU6IFNUQVRTX1RBQkxFLFxuICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogXCIjaWQgPSA6aWQgYW5kICNidWNrZXQgYmV0d2VlbiA6YnVja2V0IGFuZCA6ZW5kQnVja2V0XCIsXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgXCIjYnVja2V0XCI6IFwiYnVja2V0XCIsXG4gICAgICAgIFwiI2lkXCI6IFwiaWRcIlxuICAgICAgfSxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgXCI6YnVja2V0XCI6IHN0YXJ0QnVja2V0LFxuICAgICAgICBcIjplbmRCdWNrZXRcIjogZW5kQnVja2V0LFxuICAgICAgICBcIjppZFwiOiByZWZPYmplY3QucXVldWUoKS5yZWZJZCgpXG4gICAgICB9LFxuICAgICAgXCJSZXR1cm5Db25zdW1lZENhcGFjaXR5XCI6ICdUT1RBTCdcbiAgICB9LCB7XG4gICAgICBtYjogMTAwXG4gICAgfSkuY2F0Y2goZG9uZSkudGhlbihidWNrZXRTdGF0cyA9PiB7XG4gICAgICBsb2dnZXIubG9nKHBlcmlvZCwgYnVja2V0U3RhdHMuTGFzdEV2YWx1YXRlZEtleSwgYnVja2V0U3RhdHMuQ29uc3VtZWRDYXBhY2l0eSwgYnVja2V0U3RhdHMuSXRlbXMubGVuZ3RoKTtcbiAgICAgIHZhciBub2RlID0ge1xuICAgICAgICByZWFkczogYnVja2V0cy5tYXAodGltZSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlOiAwLFxuICAgICAgICAgICAgdGltZTogdGltZVxuICAgICAgICAgIH07XG4gICAgICAgIH0pLFxuICAgICAgICB3cml0ZXM6IGJ1Y2tldHMubWFwKHRpbWUgPT4ge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWx1ZTogMCxcbiAgICAgICAgICAgIHRpbWU6IHRpbWVcbiAgICAgICAgICB9O1xuICAgICAgICB9KSxcbiAgICAgICAgcmVhZF9sYWc6IGJ1Y2tldHMubWFwKHRpbWUgPT4ge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWx1ZTogMCxcbiAgICAgICAgICAgIHRvdGFsOiAwLFxuICAgICAgICAgICAgbWluOiBudWxsLFxuICAgICAgICAgICAgbWF4OiAwLFxuICAgICAgICAgICAgdGltZTogdGltZVxuICAgICAgICAgIH07XG4gICAgICAgIH0pLFxuICAgICAgICB3cml0ZV9sYWc6IGJ1Y2tldHMubWFwKHRpbWUgPT4ge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWx1ZTogMCxcbiAgICAgICAgICAgIHRvdGFsOiAwLFxuICAgICAgICAgICAgbWluOiBudWxsLFxuICAgICAgICAgICAgbWF4OiAwLFxuICAgICAgICAgICAgdGltZTogdGltZVxuICAgICAgICAgIH07XG4gICAgICAgIH0pLFxuICAgICAgICBib3RzOiB7XG4gICAgICAgICAgcmVhZDoge30sXG4gICAgICAgICAgd3JpdGU6IHt9XG4gICAgICAgIH0sXG4gICAgICAgIGNvbXBhcmU6IHtcbiAgICAgICAgICByZWFkczoge1xuICAgICAgICAgICAgcHJldjogMCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgICAgICBjaGFuZ2U6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIHdyaXRlczoge1xuICAgICAgICAgICAgcHJldjogMCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IDAsXG4gICAgICAgICAgICBjaGFuZ2U6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJlYWRfbGFnOiB7XG4gICAgICAgICAgICBwcmV2OiAwLFxuICAgICAgICAgICAgY3VycmVudDogMCxcbiAgICAgICAgICAgIHByZXZDb3VudDogMCxcbiAgICAgICAgICAgIGN1cnJlbnRDb3VudDogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgd3JpdGVfbGFnOiB7XG4gICAgICAgICAgICBwcmV2OiAwLFxuICAgICAgICAgICAgY3VycmVudDogMCxcbiAgICAgICAgICAgIHByZXZDb3VudDogMCxcbiAgICAgICAgICAgIGN1cnJlbnRDb3VudDogMFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGJ1Y2tldFN0YXRzLkl0ZW1zLm1hcChzdGF0ID0+IHtcbiAgICAgICAgdmFyIGluZGV4ID0gYnVja2V0QXJyYXlJbmRleFtzdGF0LnRpbWVdO1xuICAgICAgICAvL2xvZ2dlci5sb2coc3RhdC5pZCwgc3RhdC5idWNrZXQsIHN0YXQudGltZSk7XG5cbiAgICAgICAgLy9sb2dnZXIubG9nKHN0YXQpO1xuICAgICAgICBbXCJyZWFkXCIsIFwid3JpdGVcIl0ubWFwKHR5cGUgPT4ge1xuICAgICAgICAgIHZhciB0eXBlUyA9IGAke3R5cGV9c2A7XG4gICAgICAgICAgaWYgKHN0YXQuY3VycmVudFt0eXBlXSAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKHN0YXQuY3VycmVudFt0eXBlXSkuZm9yRWFjaCgoa2V5LCBrKSA9PiB7XG4gICAgICAgICAgICAgIHZhciBsaW5rID0gc3RhdC5jdXJyZW50W3R5cGVdW2tleV07XG4gICAgICAgICAgICAgIGlmICghKGtleSBpbiBub2RlLmJvdHNbdHlwZV0pKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5ib3RzW3R5cGVdW2tleV0gPSBib3REYXRhKGtleSwgdHlwZSwgbGluaywgcmVxdWVzdF90aW1lc3RhbXAsIGJ1Y2tldHMpO1xuICAgICAgICAgICAgICAgIG5vZGUuYm90c1t0eXBlXVtrZXldLmV2ZW50ID0gcmVmT2JqZWN0LnJlZklkKCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgbm9kZVtgJHt0eXBlU31gXVtpbmRleF0udmFsdWUgKz0gcGFyc2VJbnQobGluay51bml0cyk7XG4gICAgICAgICAgICAgIG5vZGVbYG1heF8ke3R5cGV9X2NoZWNrcG9pbnRgXSA9IG1heFN0cmluZyhub2RlW2Ake3R5cGVTfV9jaGVja3BvaW50YF0sIGxpbmsuY2hlY2twb2ludCk7XG4gICAgICAgICAgICAgIHZhciBib3QgPSBub2RlLmJvdHNbdHlwZV1ba2V5XTtcbiAgICAgICAgICAgICAgYm90LnZhbHVlc1tpbmRleF0udmFsdWUgPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgdmFyIGxpbmtMYWcgPSBsaW5rLnRpbWVzdGFtcCAtIGxpbmsuc291cmNlX3RpbWVzdGFtcCB8fCAwO1xuICAgICAgICAgICAgICBib3QubGFnc1tpbmRleF0udmFsdWUgKz0gbGlua0xhZztcbiAgICAgICAgICAgICAgdmFyIGxhZyA9IG5vZGVbYCR7dHlwZX1fbGFnYF1baW5kZXhdO1xuICAgICAgICAgICAgICAvL25vZGVbYCR7dHlwZVN9X2xhZ2BdW2luZGV4XS52YWx1ZSArPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgbGFnLmNvdW50Kys7XG4gICAgICAgICAgICAgIGxhZy50b3RhbCArPSBsaW5rTGFnO1xuICAgICAgICAgICAgICAvL2xhZy52YWx1ZSArPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgbGFnLm1pbiA9IGxhZy5taW4gIT0gbnVsbCA/IE1hdGgubWluKGxhZy5taW4sIGxpbmtMYWcpIDogbGlua0xhZztcbiAgICAgICAgICAgICAgbGFnLm1heCA9IE1hdGgubWF4KGxhZy5tYXgsIGxpbmtMYWcpO1xuICAgICAgICAgICAgICBpZiAoc3RhdC50aW1lID49IHByZXZDb21wYXJlVGltZXN0YW1wICYmIHN0YXQudGltZSA8IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgICAgICAgYm90LmNvbXBhcmVbYCR7dHlwZVN9YF0ucHJldiArPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgICBib3QuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2ICs9IGxpbmsudGltZXN0YW1wIC0gbGluay5zb3VyY2VfdGltZXN0YW1wIHx8IDA7XG4gICAgICAgICAgICAgICAgYm90LmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0ucHJldkNvdW50Kys7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdC50aW1lID49IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgICAgICAgYm90LmNvbXBhcmVbYCR7dHlwZVN9YF0uY3VycmVudCArPSBwYXJzZUludChsaW5rLnVuaXRzKTtcbiAgICAgICAgICAgICAgICBib3QuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5jdXJyZW50ICs9IGxpbmsudGltZXN0YW1wIC0gbGluay5zb3VyY2VfdGltZXN0YW1wIHx8IDA7XG4gICAgICAgICAgICAgICAgYm90LmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0uY3VycmVudENvdW50Kys7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYm90W2BsYXN0XyR7dHlwZX1gXSA9IGxpbmsudGltZXN0YW1wO1xuICAgICAgICAgICAgICBib3RbYGxhc3RfJHt0eXBlfV9ldmVudF90aW1lc3RhbXBgXSA9IHBhcnNlSW50KGxpbmsuY2hlY2twb2ludCAmJiBsaW5rLmNoZWNrcG9pbnQuc3BsaXQgJiYgbGluay5jaGVja3BvaW50LnNwbGl0KC9cXC8vKS5wb3AoKS5zcGxpdCgvXFwtLylbMF0gfHwgMCk7XG4gICAgICAgICAgICAgIGJvdC5sYXN0X2V2ZW50X3NvdXJjZV90aW1lc3RhbXAgPSBsaW5rLnNvdXJjZV90aW1lc3RhbXA7XG4gICAgICAgICAgICAgIGJvdFtgbGFzdF8ke3R5cGV9X2xhZ2BdID0gcmVxdWVzdF90aW1lc3RhbXAuZGlmZihtb21lbnQobGluay50aW1lc3RhbXApKTtcbiAgICAgICAgICAgICAgYm90Lmxhc3RfZXZlbnRfc291cmNlX3RpbWVzdGFtcF9sYWcgPSByZXF1ZXN0X3RpbWVzdGFtcC5kaWZmKG1vbWVudChsaW5rLnNvdXJjZV90aW1lc3RhbXApKTtcbiAgICAgICAgICAgICAgYm90LmNoZWNrcG9pbnQgPSBsaW5rLmNoZWNrcG9pbnQ7XG4gICAgICAgICAgICAgIGJvdC50aW1lc3RhbXAgPSBwYXJzZUludChsaW5rLmNoZWNrcG9pbnQgJiYgbGluay5jaGVja3BvaW50LnNwbGl0ICYmIGxpbmsuY2hlY2twb2ludC5zcGxpdCgvXFwvLykucG9wKCkuc3BsaXQoL1xcLS8pWzBdIHx8IDApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgW1wicmVhZFwiLCBcIndyaXRlXCJdLm1hcCh0eXBlID0+IHtcbiAgICAgICAgdmFyIHR5cGVTID0gYCR7dHlwZX1zYDtcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZS5ib3RzW3R5cGVdKS5tYXAoa2V5ID0+IHtcbiAgICAgICAgICBsZXQgbGluayA9IG5vZGUuYm90c1t0eXBlXVtrZXldO1xuICAgICAgICAgIGlmIChsaW5rLmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0uY3VycmVudENvdW50KSB7XG4gICAgICAgICAgICBsaW5rLmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0uY3VycmVudCAvPSBsaW5rLmNvbXBhcmVbYCR7dHlwZX1fbGFnYF0uY3VycmVudENvdW50O1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLnByZXZDb3VudCkge1xuICAgICAgICAgICAgbGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLnByZXYgLz0gbGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLnByZXZDb3VudDtcbiAgICAgICAgICB9XG4gICAgICAgICAgbGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLmNoYW5nZSA9IGNhbGNDaGFuZ2UobGluay5jb21wYXJlW2Ake3R5cGV9X2xhZ2BdLmN1cnJlbnQsIGxpbmsuY29tcGFyZVtgJHt0eXBlfV9sYWdgXS5wcmV2KTtcbiAgICAgICAgICBsaW5rLmNvbXBhcmVbYCR7dHlwZVN9YF0uY2hhbmdlID0gY2FsY0NoYW5nZShsaW5rLmNvbXBhcmVbYCR7dHlwZVN9YF0uY3VycmVudCwgbGluay5jb21wYXJlW2Ake3R5cGVTfWBdLnByZXYpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgbm9kZS5yZWFkcy5mb3JFYWNoKGUgPT4ge1xuICAgICAgICBpZiAoZS50aW1lID49IHByZXZDb21wYXJlVGltZXN0YW1wICYmIGUudGltZSA8IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgbm9kZS5jb21wYXJlLnJlYWRzLnByZXYgKz0gZS52YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChlLnRpbWUgPj0gY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICBub2RlLmNvbXBhcmUucmVhZHMuY3VycmVudCArPSBlLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIG5vZGUud3JpdGVzLmZvckVhY2goZSA9PiB7XG4gICAgICAgIGlmIChlLnRpbWUgPj0gcHJldkNvbXBhcmVUaW1lc3RhbXAgJiYgZS50aW1lIDwgY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICBub2RlLmNvbXBhcmUud3JpdGVzLnByZXYgKz0gZS52YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChlLnRpbWUgPj0gY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICBub2RlLmNvbXBhcmUud3JpdGVzLmN1cnJlbnQgKz0gZS52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBub2RlLnJlYWRfbGFnLmZvckVhY2goZSA9PiB7XG4gICAgICAgIGlmIChlLnRvdGFsICYmIGUudGltZSA+PSBwcmV2Q29tcGFyZVRpbWVzdGFtcCAmJiBlLnRpbWUgPCBjdXJyZW50Q29tcGFyZVRpbWVzdGFtcCkge1xuICAgICAgICAgIG5vZGUuY29tcGFyZS5yZWFkX2xhZy5wcmV2ICs9IGUudG90YWw7XG4gICAgICAgICAgbm9kZS5jb21wYXJlLnJlYWRfbGFnLnByZXZDb3VudCsrO1xuICAgICAgICB9IGVsc2UgaWYgKGUudG90YWwgJiYgZS50aW1lID49IGN1cnJlbnRDb21wYXJlVGltZXN0YW1wKSB7XG4gICAgICAgICAgbm9kZS5jb21wYXJlLnJlYWRfbGFnLmN1cnJlbnQgKz0gZS50b3RhbDtcbiAgICAgICAgICBub2RlLmNvbXBhcmUucmVhZF9sYWcuY3VycmVudENvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKG5vZGUuY29tcGFyZS5yZWFkX2xhZy5jdXJyZW50KSB7XG4gICAgICAgIG5vZGUuY29tcGFyZS5yZWFkX2xhZy5jdXJyZW50IC89IG5vZGUuY29tcGFyZS5yZWFkX2xhZy5jdXJyZW50Q291bnQ7XG4gICAgICB9XG4gICAgICBpZiAobm9kZS5jb21wYXJlLnJlYWRfbGFnLnByZXYpIHtcbiAgICAgICAgbm9kZS5jb21wYXJlLnJlYWRfbGFnLnByZXYgLz0gbm9kZS5jb21wYXJlLnJlYWRfbGFnLnByZXZjb3VudDtcbiAgICAgIH1cbiAgICAgIG5vZGUud3JpdGVfbGFnLmZvckVhY2goZSA9PiB7XG4gICAgICAgIGlmIChlLnRvdGFsICYmIGUudGltZSA+PSBwcmV2Q29tcGFyZVRpbWVzdGFtcCAmJiBlLnRpbWUgPCBjdXJyZW50Q29tcGFyZVRpbWVzdGFtcCkge1xuICAgICAgICAgIG5vZGUuY29tcGFyZS53cml0ZV9sYWcucHJldiArPSBlLnRvdGFsO1xuICAgICAgICAgIG5vZGUuY29tcGFyZS53cml0ZV9sYWcucHJldkNvdW50Kys7XG4gICAgICAgIH0gZWxzZSBpZiAoZS50b3RhbCAmJiBlLnRpbWUgPj0gY3VycmVudENvbXBhcmVUaW1lc3RhbXApIHtcbiAgICAgICAgICBub2RlLmNvbXBhcmUud3JpdGVfbGFnLmN1cnJlbnQgKz0gZS50b3RhbDtcbiAgICAgICAgICBub2RlLmNvbXBhcmUud3JpdGVfbGFnLmN1cnJlbnRDb3VudCsrO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChub2RlLmNvbXBhcmUud3JpdGVfbGFnLmN1cnJlbnQpIHtcbiAgICAgICAgbm9kZS5jb21wYXJlLndyaXRlX2xhZy5jdXJyZW50IC89IG5vZGUuY29tcGFyZS53cml0ZV9sYWcuY3VycmVudENvdW50O1xuICAgICAgfVxuICAgICAgaWYgKG5vZGUuY29tcGFyZS53cml0ZV9sYWcucHJldikge1xuICAgICAgICBub2RlLmNvbXBhcmUud3JpdGVfbGFnLnByZXYgLz0gbm9kZS5jb21wYXJlLndyaXRlX2xhZy5wcmV2Q291bnQ7XG4gICAgICB9XG4gICAgICBub2RlLmNvbXBhcmUucmVhZHMuY2hhbmdlID0gY2FsY0NoYW5nZShub2RlLmNvbXBhcmUucmVhZHMuY3VycmVudCwgbm9kZS5jb21wYXJlLnJlYWRzLnByZXYpO1xuICAgICAgbm9kZS5jb21wYXJlLndyaXRlcy5jaGFuZ2UgPSBjYWxjQ2hhbmdlKG5vZGUuY29tcGFyZS53cml0ZXMuY3VycmVudCwgbm9kZS5jb21wYXJlLndyaXRlcy5wcmV2KTtcbiAgICAgIG5vZGUuY29tcGFyZS5yZWFkX2xhZy5jaGFuZ2UgPSBjYWxjQ2hhbmdlKG5vZGUuY29tcGFyZS5yZWFkX2xhZy5jdXJyZW50LCBub2RlLmNvbXBhcmUucmVhZF9sYWcucHJldik7XG4gICAgICBub2RlLmNvbXBhcmUud3JpdGVfbGFnLmNoYW5nZSA9IGNhbGNDaGFuZ2Uobm9kZS5jb21wYXJlLndyaXRlX2xhZy5jdXJyZW50LCBub2RlLmNvbXBhcmUud3JpdGVfbGFnLnByZXYpO1xuICAgICAgZG9uZShudWxsLCBub2RlKTtcbiAgICB9KTtcbiAgfTtcbiAgdmFyIGJvdHNQcm9jZXNzb3IgPSBmdW5jdGlvbiAoZG9uZSkge1xuICAgIGR5bmFtb2RiLnNjYW4oQ1JPTl9UQUJMRSwgbnVsbCwgKGVyciwgYm90cykgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBkb25lKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgaWQgPSByZWZPYmplY3QucmVmSWQoKTtcbiAgICAgICAgdmFyIHJhd0lkID0gcmVmT2JqZWN0LmlkO1xuICAgICAgICBkb25lKG51bGwsIGJvdHMuZmlsdGVyKGJvdCA9PiB7XG4gICAgICAgICAgbGV0IHJlYWQgPSBib3QuY2hlY2twb2ludHMgJiYgYm90LmNoZWNrcG9pbnRzLnJlYWQgfHwge307XG4gICAgICAgICAgbGV0IHdyaXRlID0gYm90LmNoZWNrcG9pbnRzICYmIGJvdC5jaGVja3BvaW50cy53cml0ZSB8fCB7fTtcbiAgICAgICAgICByZXR1cm4gIWJvdC5hcmNoaXZlZCAmJiAocmVhZFtpZF0gfHwgcmVhZFtyYXdJZF0gfHwgd3JpdGVbaWRdIHx8IHdyaXRlW3Jhd0lkXSk7XG4gICAgICAgIH0pLm1hcChib3QgPT4ge1xuICAgICAgICAgIGxldCByZWFkID0gYm90LmNoZWNrcG9pbnRzICYmIGJvdC5jaGVja3BvaW50cy5yZWFkIHx8IHt9O1xuICAgICAgICAgIGxldCB3cml0ZSA9IGJvdC5jaGVja3BvaW50cyAmJiBib3QuY2hlY2twb2ludHMud3JpdGUgfHwge307XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiB1dGlsLnJlZklkKGJvdC5pZCwgXCJib3RcIiksXG4gICAgICAgICAgICByZWFkOiByZWFkW2lkXSB8fCByZWFkW3Jhd0lkXSxcbiAgICAgICAgICAgIHdyaXRlOiB3cml0ZVtpZF0gfHwgd3JpdGVbcmF3SWRdXG4gICAgICAgICAgfTtcbiAgICAgICAgfSkpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuICBhc3luYy5wYXJhbGxlbCh7XG4gICAgYm90czogYm90c1Byb2Nlc3NvcixcbiAgICBzZWxmOiBzZWxmUHJvY2Vzc29yXG4gIH0sIChlcnIsIHJlc3VsdHMpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBsb2dnZXIubG9nKGVycik7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgdmFyIHNlbGYgPSByZXN1bHRzLnNlbGY7XG4gICAgdmFyIGJvdHMgPSByZXN1bHRzLmJvdHM7XG4gICAgdmFyIGxhdGVzdFdyaXRlQ2hlY2twb2ludCA9IHNlbGZbXCJtYXhfd3JpdGVfY2hlY2twb2ludFwiXTtcbiAgICAvLyBNYWtlIHJlYWRzIGxhZ3MgZ3JvdyBvdmVyIHRpbWUgaWYgbm90IHJlYWRpbmdcbiAgICBPYmplY3Qua2V5cyhzZWxmLmJvdHMucmVhZCkubWFwKGtleSA9PiB7XG4gICAgICB2YXIgbGluayA9IHNlbGYuYm90cy5yZWFkW2tleV07XG4gICAgICB2YXIgbGFzdCA9IHtcbiAgICAgICAgdmFsdWU6IG51bGxcbiAgICAgIH07XG4gICAgICBsaW5rLmxhZ3MubWFwKGZ1bmN0aW9uICh2KSB7XG4gICAgICAgIGlmIChsYXN0LnZhbHVlICE9PSBudWxsICYmIHYudmFsdWUgPT09IG51bGwgJiYgbGluay5jaGVja3BvaW50IDwgbGF0ZXN0V3JpdGVDaGVja3BvaW50KSB7XG4gICAgICAgICAgdi52YWx1ZSA9IGxhc3QudmFsdWUgKyAodi50aW1lIC0gbGFzdC50aW1lKTtcbiAgICAgICAgfVxuICAgICAgICBsYXN0ID0gdjtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIGJvdHMubWFwKGJvdCA9PiB7XG4gICAgICBpZiAoISFib3QucmVhZCAmJiAhc2VsZi5ib3RzLnJlYWRbYm90LmlkXSkge1xuICAgICAgICBzZWxmLmJvdHMucmVhZFtib3QuaWRdID0gYm90RGF0YShib3QuaWQsIFwicmVhZFwiLCB7XG4gICAgICAgICAgdGltZXN0YW1wOiBib3QudGltZXN0YW1wLFxuICAgICAgICAgIHNvdXJjZV90aW1lc3RhbXA6IGJvdC5zb3VyY2VfdGltZXN0YW1wLFxuICAgICAgICAgIGNoZWNrcG9pbnQ6IGJvdC5jaGVja3BvaW50XG4gICAgICAgIH0sIHJlcXVlc3RfdGltZXN0YW1wLCBidWNrZXRzKTtcbiAgICAgICAgc2VsZi5ib3RzLnJlYWRbYm90LmlkXS5ldmVudCA9IHJlZk9iamVjdC5yZWZJZCgpO1xuICAgICAgfVxuICAgICAgaWYgKCEhYm90LndyaXRlICYmICFzZWxmLmJvdHMud3JpdGVbYm90LmlkXSkge1xuICAgICAgICBzZWxmLmJvdHMud3JpdGVbYm90LmlkXSA9IGJvdERhdGEoYm90LmlkLCBcIndyaXRlXCIsIHtcbiAgICAgICAgICB0aW1lc3RhbXA6IGJvdC50aW1lc3RhbXAsXG4gICAgICAgICAgc291cmNlX3RpbWVzdGFtcDogYm90LnNvdXJjZV90aW1lc3RhbXAsXG4gICAgICAgICAgY2hlY2twb2ludDogYm90LmNoZWNrcG9pbnRcbiAgICAgICAgfSwgcmVxdWVzdF90aW1lc3RhbXAsIGJ1Y2tldHMpO1xuICAgICAgICBzZWxmLmJvdHMud3JpdGVbYm90LmlkXS5ldmVudCA9IHJlZk9iamVjdC5yZWZJZCgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNhbGxiYWNrKGVyciwgc2VsZik7XG4gIH0pO1xufVxuZnVuY3Rpb24gc3lzdGVtRGFzaGJvYXJkKCkge31cbmZ1bmN0aW9uIHNtYXJ0TWVyZ2VTdGF0cyhzLCByKSB7XG4gIGlmIChyLnNvdXJjZV90aW1lc3RhbXAgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBtZXJnZVN0YXRzKHMsIHIpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBtZXJnZUV4ZWN1dGlvblN0YXRzKHMsIHIpO1xuICB9XG59XG5mdW5jdGlvbiBtZXJnZUV4ZWN1dGlvblN0YXRzKHMsIHIpIHtcbiAgcy5jb21wbGV0aW9ucyA9IHN1bShzLmNvbXBsZXRpb25zLCByLmNvbXBsZXRpb25zKTtcbiAgcy51bml0cyA9IHN1bShzLnVuaXRzLCByLnVuaXRzKTtcbiAgcy5kdXJhdGlvbiA9IHN1bShzYWZlTnVtYmVyKHBhcnNlSW50KHMuZHVyYXRpb24pKSwgc2FmZU51bWJlcihwYXJzZUludChyLmR1cmF0aW9uKSkpO1xuICBzLm1heF9kdXJhdGlvbiA9IG1heChzLm1heF9kdXJhdGlvbiwgci5tYXhfZHVyYXRpb24pO1xuICBpZiAoci5taW5fZHVyYXRpb24gPiAwKSB7XG4gICAgcy5taW5fZHVyYXRpb24gPSBtaW4ocy5taW5fZHVyYXRpb24sIHIubWluX2R1cmF0aW9uKTtcbiAgfSBlbHNlIHtcbiAgICBzLm1pbl9kdXJhdGlvbiA9IHMubWluX2R1cmF0aW9uIHx8IDA7XG4gIH1cbiAgcy5lcnJvcnMgPSBzdW0ocy5lcnJvcnMsIHIuZXJyb3JzKTtcbiAgcmV0dXJuIHM7XG59XG5mdW5jdGlvbiBtZXJnZVN0YXRzKHMsIHIpIHtcbiAgcy5zb3VyY2VfdGltZXN0YW1wID0gbWF4KHMuc291cmNlX3RpbWVzdGFtcCwgci5zb3VyY2VfdGltZXN0YW1wKTtcbiAgcy50aW1lc3RhbXAgPSBtYXgocy50aW1lc3RhbXAsIHIudGltZXN0YW1wKTtcbiAgcy51bml0cyA9IHN1bShzLnVuaXRzLCByLnVuaXRzKTtcbiAgcy5jaGVja3BvaW50ID0gci5jaGVja3BvaW50IHx8IHMuY2hlY2twb2ludDtcbiAgcmV0dXJuIHM7XG59XG5mdW5jdGlvbiBtYXhTdHJpbmcoKSB7XG4gIHZhciBtYXggPSBhcmd1bWVudHNbMF07XG4gIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgKytpKSB7XG4gICAgaWYgKGFyZ3VtZW50c1tpXSAhPSBudWxsICYmIGFyZ3VtZW50c1tpXSAhPSB1bmRlZmluZWQpIHtcbiAgICAgIG1heCA9IG1heCA+IGFyZ3VtZW50c1tpXSA/IG1heCA6IGFyZ3VtZW50c1tpXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heDtcbn1cbmZ1bmN0aW9uIG1heChhLCBiKSB7XG4gIGlmICh0eXBlb2YgYSA9PT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiBNYXRoLm1heChhLCBiKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYSA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiBhLmxvY2FsZUNvbXBhcmUoYikgPj0gMSA/IGEgOiBiO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBiO1xuICB9XG59XG5mdW5jdGlvbiBtaW4oYSwgYikge1xuICBpZiAodHlwZW9mIGEgPT09IFwibnVtYmVyXCIpIHtcbiAgICByZXR1cm4gTWF0aC5taW4oYSwgYik7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGEgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gYS5sb2NhbGVDb21wYXJlKGIpID49IDEgPyBiIDogYTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYjtcbiAgfVxufVxuZnVuY3Rpb24gc3VtKGEsIGIsIGRlZmF1bHRWYWx1ZSkge1xuICByZXR1cm4gKGEgfHwgZGVmYXVsdFZhbHVlIHx8IDApICsgKGIgfHwgZGVmYXVsdFZhbHVlIHx8IDApO1xufVxuZnVuY3Rpb24gc2FmZU51bWJlcihudW1iZXIpIHtcbiAgaWYgKGlzTmFOKG51bWJlcikgfHwgIW51bWJlcikge1xuICAgIHJldHVybiAwO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBudW1iZXI7XG4gIH1cbn1cblxufSx7XCIuLi8uLi9saWIvc3RhdHMtYnVja2V0cy5qc1wiOjIsXCJhc3luY1wiOnVuZGVmaW5lZCxcImxlby1hdXRoXCI6dW5kZWZpbmVkLFwibGVvLWNvbmZpZ1wiOnVuZGVmaW5lZCxcImxlby1sb2dnZXJcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZCxcIm1vbWVudFwiOnVuZGVmaW5lZCxcIm1vbWVudC1yb3VuZFwiOnVuZGVmaW5lZH1dLDI6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgbW9tZW50ID0gcmVxdWlyZShcIm1vbWVudFwiKTtcbnZhciBidWNrZXRzRGF0YSA9IHtcbiAgXCJtaW51dGVfMVwiOiB7XG4gICAgcGVyaW9kOiBcIm1pbnV0ZVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJtaW51dGVfXCIgKyB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdGFydE9mKFwibWludXRlXCIpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIik7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgcmV0dXJuIHRpbWVzdGFtcC5jbG9uZSgpLnV0YygpLnN0YXJ0T2YoXCJtaW51dGVcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcIm1pbnV0ZXNcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IFwibWludXRlXzVcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogMVxuICAgIH0sXG4gICAgZGVmYXVsdENvbnRhaW5lcjogXCJtaW51dGVcIixcbiAgICBkZWZhdWx0Q29udGFpbmVySW50ZXJ2YWw6IDYgKiA1XG4gIH0sXG4gIFwibWludXRlXzVcIjoge1xuICAgIHBlcmlvZDogXCJtaW51dGVfNVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfNV9cIixcbiAgICB0cmFuc2Zvcm06IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLnV0YygpLm1pbnV0ZSgpICsgNSkgJSA1O1xuICAgICAgcmV0dXJuIFwibWludXRlXzVfXCIgKyB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdWJ0cmFjdChvZmZzZXQsIFwibWludXRlc1wiKS5zdGFydE9mKFwibWludXRlXCIpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIik7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgdmFyIG9mZnNldCA9ICh0aW1lc3RhbXAudXRjKCkubWludXRlKCkgKyA1KSAlIDU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9LFxuICAgIHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAgICAgcmV0dXJuIG1vbWVudCh0aW1lc3RhbXApLnV0YygpLnN1YnRyYWN0KDUgKiAoYW1vdW50IHx8IDEpLCBcIm1pbnV0ZXNcIik7XG4gICAgfSxcbiAgICBuZXh0OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5hZGQoNSAqIChhbW91bnQgfHwgMSksIFwibWludXRlc1wiKTtcbiAgICB9LFxuICAgIHBhcmVudDogXCJtaW51dGVfMTVcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogNVxuICAgIH0sXG4gICAgZGVmYXVsdENvbnRhaW5lcjogXCJtaW51dGVcIixcbiAgICBkZWZhdWx0Q29udGFpbmVySW50ZXJ2YWw6IDYgKiAxNVxuICB9LFxuICBcIm1pbnV0ZV8xNVwiOiB7XG4gICAgcGVyaW9kOiBcIm1pbnV0ZV8xNVwiLFxuICAgIHByZWZpeDogXCJtaW51dGVfMTVfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICB2YXIgb2Zmc2V0ID0gKHRpbWVzdGFtcC51dGMoKS5taW51dGUoKSArIDE1KSAlIDE1O1xuICAgICAgcmV0dXJuIFwibWludXRlXzE1X1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpO1xuICAgIH0sXG4gICAgdmFsdWU6IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLnV0YygpLm1pbnV0ZSgpICsgMTUpICUgMTU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9LFxuICAgIHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAgICAgcmV0dXJuIG1vbWVudCh0aW1lc3RhbXApLnV0YygpLnN1YnRyYWN0KDE1ICogKGFtb3VudCB8fCAxKSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKDE1ICogKGFtb3VudCB8fCAxKSwgXCJtaW51dGVzXCIpO1xuICAgIH0sXG4gICAgcGFyZW50OiBcImhvdXJcIixcbiAgICBkdXJhdGlvbjoge1xuICAgICAgbTogMTVcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiaG91clwiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogNlxuICB9LFxuICBcImhvdXJcIjoge1xuICAgIHBlcmlvZDogXCJob3VyXCIsXG4gICAgcHJlZml4OiBcImhvdXJfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJob3VyX1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImhvdXJcIikuZm9ybWF0KFwiWVlZWS1NTS1ERCBISFwiKTtcbiAgICB9LFxuICAgIHZhbHVlOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImhvdXJcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJob3VyXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcImhvdXJcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IFwiZGF5XCIsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIGg6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiaG91clwiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogMzBcbiAgfSxcbiAgXCJkYXlcIjoge1xuICAgIHBlcmlvZDogXCJkYXlcIixcbiAgICBwcmVmaXg6IFwiZGF5X1wiLFxuICAgIHRyYW5zZm9ybTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAgICAgcmV0dXJuIFwiZGF5X1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcImRheVwiKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpO1xuICAgIH0sXG4gICAgdmFsdWU6IGZ1bmN0aW9uICh0aW1lc3RhbXApIHtcbiAgICAgIHJldHVybiB0aW1lc3RhbXAuY2xvbmUoKS51dGMoKS5zdGFydE9mKFwiZGF5XCIpO1xuICAgIH0sXG4gICAgcHJldjogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuc3VidHJhY3QoYW1vdW50IHx8IDEsIFwiZGF5XCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcImRheVwiKTtcbiAgICB9LFxuICAgIHBhcmVudDogXCJ3ZWVrXCIsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIGQ6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwiZGF5XCIsXG4gICAgZGVmYXVsdENvbnRhaW5lckludGVydmFsOiAzMFxuICB9LFxuICBcIndlZWtcIjoge1xuICAgIHBlcmlvZDogXCJ3ZWVrXCIsXG4gICAgcHJlZml4OiBcIndlZWtfXCIsXG4gICAgdHJhbnNmb3JtOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gXCJ3ZWVrX1wiICsgdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcIndlZWtcIikuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKTtcbiAgICB9LFxuICAgIHZhbHVlOiBmdW5jdGlvbiAodGltZXN0YW1wKSB7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkudXRjKCkuc3RhcnRPZihcIndlZWtcIik7XG4gICAgfSxcbiAgICBwcmV2OiBmdW5jdGlvbiAodGltZXN0YW1wLCBhbW91bnQpIHtcbiAgICAgIHJldHVybiBtb21lbnQodGltZXN0YW1wKS51dGMoKS5zdWJ0cmFjdChhbW91bnQgfHwgMSwgXCJ3ZWVrXCIpO1xuICAgIH0sXG4gICAgbmV4dDogZnVuY3Rpb24gKHRpbWVzdGFtcCwgYW1vdW50KSB7XG4gICAgICByZXR1cm4gbW9tZW50KHRpbWVzdGFtcCkudXRjKCkuYWRkKGFtb3VudCB8fCAxLCBcIndlZWtcIik7XG4gICAgfSxcbiAgICBwYXJlbnQ6IG51bGwsXG4gICAgZHVyYXRpb246IHtcbiAgICAgIHc6IDFcbiAgICB9LFxuICAgIGRlZmF1bHRDb250YWluZXI6IFwid2Vla1wiLFxuICAgIGRlZmF1bHRDb250YWluZXJJbnRlcnZhbDogMzBcbiAgfVxufTtcbnZhciByYW5nZXMgPSB7XG4gIFwibWludXRlXCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcIm1pbnV0ZVwiKVxuICB9LFxuICBcIm1pbnV0ZV8xXCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcIm1pbnV0ZVwiKVxuICB9LFxuICBcIm1pbnV0ZV81XCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogNSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4ge1xuICAgICAgdmFyIG9mZnNldCA9ICh0aW1lc3RhbXAudXRjKCkubWludXRlKCkgKyA1KSAlIDU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9XG4gIH0sXG4gIFwibWludXRlXzE1XCI6IHtcbiAgICBwZXJpb2Q6IFwibWludXRlXzFcIixcbiAgICBjb3VudDogMTUsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHtcbiAgICAgIHZhciBvZmZzZXQgPSAodGltZXN0YW1wLm1pbnV0ZSgpICsgMTUpICUgMTU7XG4gICAgICByZXR1cm4gdGltZXN0YW1wLmNsb25lKCkuc3VidHJhY3Qob2Zmc2V0LCBcIm1pbnV0ZXNcIikuc3RhcnRPZihcIm1pbnV0ZVwiKTtcbiAgICB9XG4gIH0sXG4gIFwiaG91clwiOiB7XG4gICAgcGVyaW9kOiBcImhvdXJcIixcbiAgICBjb3VudDogMSxcbiAgICBzdGFydE9mOiB0aW1lc3RhbXAgPT4gdGltZXN0YW1wLmNsb25lKCkuc3RhcnRPZihcImhvdXJcIiksXG4gICAgcm9sbGluZzoge1xuICAgICAgcGVyaW9kOiBcIm1pbnV0ZV8xNVwiLFxuICAgICAgY291bnQ6IDRcbiAgICB9XG4gIH0sXG4gIFwiaG91cl82XCI6IHtcbiAgICBwZXJpb2Q6IFwiaG91clwiLFxuICAgIGNvdW50OiA2LFxuICAgIHN0YXJ0T2Y6IHRpbWVzdGFtcCA9PiB0aW1lc3RhbXAuY2xvbmUoKS5zdGFydE9mKFwiaG91clwiKVxuICB9LFxuICBcImRheVwiOiB7XG4gICAgcGVyaW9kOiBcImhvdXJcIixcbiAgICBjb3VudDogMjQsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHRpbWVzdGFtcC5jbG9uZSgpLnN0YXJ0T2YoXCJkYXlcIilcbiAgfSxcbiAgXCJ3ZWVrXCI6IHtcbiAgICBwZXJpb2Q6IFwiaG91clwiLFxuICAgIGNvdW50OiAxNjgsXG4gICAgc3RhcnRPZjogdGltZXN0YW1wID0+IHRpbWVzdGFtcC5jbG9uZSgpLnN0YXJ0T2YoXCJ3ZWVrXCIpXG4gIH1cbn07XG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZGF0YTogYnVja2V0c0RhdGEsXG4gIHJhbmdlczogcmFuZ2VzXG4gIC8vIGdldEJ1Y2tldDogZnVuY3Rpb24gKHBlcmlvZCkge1xuICAvLyBcdHZhciByYW5nZSA9IHBlcmlvZDtcbiAgLy8gXHRpZiAodHlwZW9mIHBlcmlvZCA9PSBcInN0cmluZ1wiKSB7XG4gIC8vIFx0XHRyYW5nZSA9IHJhbmdlc1twZXJpb2RdXG4gIC8vIFx0fVxuICAvLyBcdGlmICghcmFuZ2UgfHwgIWJ1Y2tldHNEYXRhW3JhbmdlLnBlcmlvZF0pIHtcbiAgLy8gXHRcdHJldHVybiBudWxsO1xuICAvLyBcdH1cblxuICAvLyBcdHZhciBidWNrZXQgPSBidWNrZXRzRGF0YVtyYW5nZS5wZXJpb2RdO1xuXG4gIC8vIFx0cmV0dXJuIHtcbiAgLy8gXHRcdHByZWZpeDogYnVja2V0LnByZWZpeCxcbiAgLy8gXHRcdHRyYW5zZm9ybTogZnVuY3Rpb24gKHRpbWVzdGFtcCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnRyYW5zZm9ybSh0aW1lc3RhbXApO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdHByZXY6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnByZXYodGltZXN0YW1wLCAoYW1vdW50IHx8IDEpICogcmFuZ2UuY291bnQpO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdG5leHQ6IGZ1bmN0aW9uICh0aW1lc3RhbXAsIGFtb3VudCkge1xuICAvLyBcdFx0XHRyZXR1cm4gYnVja2V0LnByZXYodGltZXN0YW1wLCAoYW1vdW50IHx8IDEpICogcmFuZ2UuY291bnQpO1xuICAvLyBcdFx0fSxcbiAgLy8gXHRcdGR1cmF0aW9uOiBtb21lbnQuZHVyYXRpb24oYnVja2V0LmR1cmF0aW9uKSAqIHJhbmdlLmNvdW50LFxuICAvLyBcdH1cbiAgLy8gfVxufTtcblxufSx7XCJtb21lbnRcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
