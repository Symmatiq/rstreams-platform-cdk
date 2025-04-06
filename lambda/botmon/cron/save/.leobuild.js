(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var diff = require("deep-diff");
var CRON_TABLE = leo.configuration.resources.LeoCron;
var SETTINGS_TABLE = leo.configuration.resources.LeoSettings;
var SYSTEM_TABLE = leo.configuration.resources.LeoSystem;
var BOT_ID = "BOTSAVEAPI";
var LOG_DESTINATION = "queue:BotChangeLog";
var moment = require("moment");
var uuid = require("uuid");
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var body = event.body;
  var ref = util.ref(body.id, "bot");
  var id = ref && ref.id;
  let user = await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::cron/{id}',
    action: "saveCron",
    core: {
      id: id
    }
  });
  var doc = Object.assign({}, body, {
    "description": body.description,
    "lambda": body.lambda,
    "lambdaName": body.lambdaName,
    "paused": body.paused,
    "time": body.time,
    "delay": body.delay,
    "timeout": body.timeout
  });
  if (body.payload) {
    resubmit(body, callback);
  } else {
    if (!id) {
      buildId(doc, (err, id) => {
        if (err) {
          return callback(err);
        }
        save(id, doc, callback);
      });
    } else {
      save(id, doc, callback);
    }
  }
});
function buildId(doc, done) {
  if (doc.id) {
    return done(null, doc.id);
  }
  var baseId = doc.name.replace(/[^A-z0-9]+/g, "_");
  var id = baseId;
  var tries = 1;
  var randomAt = 3;
  var uuidAt = 10;
  var get = () => {
    console.log("ID:", id);
    dynamodb.get(CRON_TABLE, id, (err, data) => {
      if (!data) {
        return done(err, id);
      }
      tries++;
      id = baseId + `_${tries}`;
      if (tries > randomAt) {
        id = baseId + `_${("0000" + Math.round(Math.random() * 10000)).slice(-4)}`;
      }
      if (tries >= uuidAt) {
        done(null, uuid.v4());
      } else {
        get();
      }
    });
  };
  get();
}
function resubmit(body, callback) {
  var refId = util.refId(body.botId, "bot");
  let stream = leo.load(body.botId, body.queue, {
    partitionKey: body.queue,
    useS3: true
  });
  stream.write(body.payload);
  stream.end(() => {
    callback(null, {
      refId: refId
    });
  });
}
function save(id, doc, callback) {
  var refId = util.refId(id, "bot");
  var sets = [];
  let deletes = [];
  var names = {};
  var attributes = {};

  // A bot is either time based or trigger based
  if (doc.triggers) {
    if (!Array.isArray) {
      doc.triggers = [doc.triggers];
    }
    doc.triggers = doc.triggers.map(t => util.refId(t));
    doc.time = null;
  } else if (doc.time) {
    doc.triggers = null;
  }
  doc.system = util.ref(doc.system, {
    type: "system"
  });
  delete doc.instances; // Instances shouldn't be updated
  delete doc.checkpoints; // Checkpoints should be updated
  delete doc.requested_kinesis; // requested_kinesis should be updated
  delete doc.id; // Part of the key
  delete doc.trigger; // don't update because it coudld undo a different trigger
  delete doc.invokeTime; // Only set by cron execution lambda
  if (doc.executeNow === true) {
    doc.trigger = moment.now();
    doc.ignorePaused = true;
    doc.errorCount = 0;
    doc.scheduledTrigger = null;
  }
  let clearInstances = doc.executeNowClear === true;
  delete doc.executeNow;
  delete doc.executeNowClear;
  let newCheckpoint = doc.checkpoint;
  delete doc.checkpoint; // New version of checkpoint is an object not legacy string

  let skip = ["checksumReset"];
  for (let k in doc) {
    if (skip.indexOf(k) < 0 && doc[k] !== undefined && doc[k] !== "") {
      let fieldName = k.replace(/[^a-z]+/ig, "_");
      sets.push(`#${fieldName} = :${fieldName}`);
      names[`#${fieldName}`] = k;
      attributes[`:${fieldName}`] = doc[k];
    }
  }
  names[`#instances`] = "instances";
  attributes[`:instances`] = {};
  names["#requested_kinesis"] = "requested_kinesis";
  attributes[`:requested_kinesis`] = {};
  names["#checkpoints"] = "checkpoints";
  attributes[`:checkpoints`] = {
    read: {},
    write: {}
  };
  if (clearInstances) {
    names[`#invokeTime`] = "invokeTime";
    names[`#instanceId`] = "0";
    delete attributes[`:instances`];
    deletes.push("#instances.#instanceId");
    deletes.push("#invokeTime");
  } else {
    sets.push(`#instances = if_not_exists(#instances, :instances)`);
  }
  sets.push(`#checkpoints = if_not_exists(#checkpoints, :checkpoints)`);
  sets.push(`#requested_kinesis = if_not_exists(#requested_kinesis, :requested_kinesis)`);
  let params = {
    TableName: CRON_TABLE,
    Key: {
      id: id
    },
    UpdateExpression: 'set ' + sets.join(", ") + (deletes.length ? " remove " + deletes.join(", ") : ""),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: attributes,
    "ReturnConsumedCapacity": 'TOTAL',
    ReturnValues: 'ALL_NEW'
  };
  dynamodb.get(CRON_TABLE, id, (err, oldData) => {
    if (oldData) {
      delete oldData.instances;
    }
    dynamodb.update(params, function (err, result) {
      if (err) {
        callback(err);
      } else {
        console.log("[result]", JSON.stringify(result, null, 2));
        var done = callback;
        var data = result.Attributes;
        var stream = leo.load(BOT_ID, LOG_DESTINATION);
        var newData = data;
        delete newData.instances;
        callback = (err, d) => {
          var diffArray = diff(oldData, newData) || [];
          var diffs = diffArray.map(e => ({
            [`${e.path.join(".")}`]: {
              old: e.lhs || e.item && e.item.lhs || '',
              new: e.rhs || e.item && e.item.rhs || ''
            }
          }));
          if (diffs.length !== 0) {
            stream.write({
              old: oldData,
              new: newData,
              diff: diffs
            });
          }
          if (!err) {
            stream.end(() => {
              if (!err && data.system) {
                saveSystemEntry(id, data, doc).then(d => done(null, d)).catch(done);
              } else {
                done(err, d);
              }
            });
          } else {
            done(err, d);
          }
        };
        var sets = [];
        var names = {
          "#checkpoints": "checkpoints"
        };
        var attributes = {};
        var index = 0;
        if (data.lambda && data.lambda.settings) {
          data.lambda.settings.forEach(setting => {
            index++;
            var destination = util.ref(setting.destination);
            if (destination && !data.checkpoints.write[destination]) {
              data.checkpoints.write[destination] = {};
              // Set blank Checkpoint
              sets.push(`#checkpoints.#write.#w_${index} = if_not_exists(#checkpoints.#write.#w_${index}, :w_${index})`);
              names[`#w_${index}`] = destination.toString();
              names["#write"] = "write";
              attributes[`:w_${index}`] = {};
            }
          });
        }
        if (newCheckpoint) {
          Object.keys(newCheckpoint).map(key => {
            index++;
            sets.push(`#checkpoints.#read.#r_${index} = :r_${index}`);
            names[`#r_${index}`] = key.toString();
            names["#read"] = "read";
            attributes[`:r_${index}`] = Object.assign({}, data.checkpoints.read[key], {
              checkpoint: newCheckpoint[key]
            });
          });
        }
        if (sets.length) {
          var params = {
            TableName: CRON_TABLE,
            Key: {
              id: id
            },
            UpdateExpression: 'set ' + sets.join(", "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: attributes,
            "ReturnConsumedCapacity": 'TOTAL'
          };
          dynamodb.update(params, function (err, data) {
            console.log(err, data);
            callback(null, {
              refId: refId
            });
          });
        } else {
          callback(null, {
            refId: refId
          });
        }
      }
    });
  });
}
function saveSystemEntry(botId, cron, doc) {
  var system = cron.system;
  var systemId = !system.id ? system : system.id.replace(/^s_/, "");
  return new Promise((resolve, reject) => {
    if (system.type == "checksum") {
      var settings = cron.lambda.settings[0] || {};
      var otherSystem = (!settings.master || settings.master.id == systemId ? settings.slave : settings.master) || {};
      console.log(JSON.stringify(cron.lambda, null, 2));
      dynamodb.merge(SYSTEM_TABLE, systemId, {
        checksums: {
          [botId]: {
            bot_id: `b_${botId}`,
            label: cron.name,
            system: `s_${otherSystem.id}`,
            reset: doc.checksumReset
          }
        }
      }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    } else {
      resolve({});
    }
  });
}

},{"deep-diff":undefined,"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined,"moment":undefined,"uuid":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIGRpZmYgPSByZXF1aXJlKFwiZGVlcC1kaWZmXCIpO1xudmFyIENST05fVEFCTEUgPSBsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMuTGVvQ3JvbjtcbnZhciBTRVRUSU5HU19UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TZXR0aW5ncztcbnZhciBTWVNURU1fVEFCTEUgPSBsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMuTGVvU3lzdGVtO1xudmFyIEJPVF9JRCA9IFwiQk9UU0FWRUFQSVwiO1xudmFyIExPR19ERVNUSU5BVElPTiA9IFwicXVldWU6Qm90Q2hhbmdlTG9nXCI7XG52YXIgbW9tZW50ID0gcmVxdWlyZShcIm1vbWVudFwiKTtcbnZhciB1dWlkID0gcmVxdWlyZShcInV1aWRcIik7XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIHZhciBib2R5ID0gZXZlbnQuYm9keTtcbiAgdmFyIHJlZiA9IHV0aWwucmVmKGJvZHkuaWQsIFwiYm90XCIpO1xuICB2YXIgaWQgPSByZWYgJiYgcmVmLmlkO1xuICBsZXQgdXNlciA9IGF3YWl0IHJlcXVlc3QuYXV0aG9yaXplKGV2ZW50LCB7XG4gICAgbHJuOiAnbHJuOmxlbzpib3Rtb246Ojpjcm9uL3tpZH0nLFxuICAgIGFjdGlvbjogXCJzYXZlQ3JvblwiLFxuICAgIGNvcmU6IHtcbiAgICAgIGlkOiBpZFxuICAgIH1cbiAgfSk7XG4gIHZhciBkb2MgPSBPYmplY3QuYXNzaWduKHt9LCBib2R5LCB7XG4gICAgXCJkZXNjcmlwdGlvblwiOiBib2R5LmRlc2NyaXB0aW9uLFxuICAgIFwibGFtYmRhXCI6IGJvZHkubGFtYmRhLFxuICAgIFwibGFtYmRhTmFtZVwiOiBib2R5LmxhbWJkYU5hbWUsXG4gICAgXCJwYXVzZWRcIjogYm9keS5wYXVzZWQsXG4gICAgXCJ0aW1lXCI6IGJvZHkudGltZSxcbiAgICBcImRlbGF5XCI6IGJvZHkuZGVsYXksXG4gICAgXCJ0aW1lb3V0XCI6IGJvZHkudGltZW91dFxuICB9KTtcbiAgaWYgKGJvZHkucGF5bG9hZCkge1xuICAgIHJlc3VibWl0KGJvZHksIGNhbGxiYWNrKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWlkKSB7XG4gICAgICBidWlsZElkKGRvYywgKGVyciwgaWQpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICAgIHNhdmUoaWQsIGRvYywgY2FsbGJhY2spO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNhdmUoaWQsIGRvYywgY2FsbGJhY2spO1xuICAgIH1cbiAgfVxufSk7XG5mdW5jdGlvbiBidWlsZElkKGRvYywgZG9uZSkge1xuICBpZiAoZG9jLmlkKSB7XG4gICAgcmV0dXJuIGRvbmUobnVsbCwgZG9jLmlkKTtcbiAgfVxuICB2YXIgYmFzZUlkID0gZG9jLm5hbWUucmVwbGFjZSgvW15BLXowLTldKy9nLCBcIl9cIik7XG4gIHZhciBpZCA9IGJhc2VJZDtcbiAgdmFyIHRyaWVzID0gMTtcbiAgdmFyIHJhbmRvbUF0ID0gMztcbiAgdmFyIHV1aWRBdCA9IDEwO1xuICB2YXIgZ2V0ID0gKCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKFwiSUQ6XCIsIGlkKTtcbiAgICBkeW5hbW9kYi5nZXQoQ1JPTl9UQUJMRSwgaWQsIChlcnIsIGRhdGEpID0+IHtcbiAgICAgIGlmICghZGF0YSkge1xuICAgICAgICByZXR1cm4gZG9uZShlcnIsIGlkKTtcbiAgICAgIH1cbiAgICAgIHRyaWVzKys7XG4gICAgICBpZCA9IGJhc2VJZCArIGBfJHt0cmllc31gO1xuICAgICAgaWYgKHRyaWVzID4gcmFuZG9tQXQpIHtcbiAgICAgICAgaWQgPSBiYXNlSWQgKyBgXyR7KFwiMDAwMFwiICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMDApKS5zbGljZSgtNCl9YDtcbiAgICAgIH1cbiAgICAgIGlmICh0cmllcyA+PSB1dWlkQXQpIHtcbiAgICAgICAgZG9uZShudWxsLCB1dWlkLnY0KCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZ2V0KCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG4gIGdldCgpO1xufVxuZnVuY3Rpb24gcmVzdWJtaXQoYm9keSwgY2FsbGJhY2spIHtcbiAgdmFyIHJlZklkID0gdXRpbC5yZWZJZChib2R5LmJvdElkLCBcImJvdFwiKTtcbiAgbGV0IHN0cmVhbSA9IGxlby5sb2FkKGJvZHkuYm90SWQsIGJvZHkucXVldWUsIHtcbiAgICBwYXJ0aXRpb25LZXk6IGJvZHkucXVldWUsXG4gICAgdXNlUzM6IHRydWVcbiAgfSk7XG4gIHN0cmVhbS53cml0ZShib2R5LnBheWxvYWQpO1xuICBzdHJlYW0uZW5kKCgpID0+IHtcbiAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICByZWZJZDogcmVmSWRcbiAgICB9KTtcbiAgfSk7XG59XG5mdW5jdGlvbiBzYXZlKGlkLCBkb2MsIGNhbGxiYWNrKSB7XG4gIHZhciByZWZJZCA9IHV0aWwucmVmSWQoaWQsIFwiYm90XCIpO1xuICB2YXIgc2V0cyA9IFtdO1xuICBsZXQgZGVsZXRlcyA9IFtdO1xuICB2YXIgbmFtZXMgPSB7fTtcbiAgdmFyIGF0dHJpYnV0ZXMgPSB7fTtcblxuICAvLyBBIGJvdCBpcyBlaXRoZXIgdGltZSBiYXNlZCBvciB0cmlnZ2VyIGJhc2VkXG4gIGlmIChkb2MudHJpZ2dlcnMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkpIHtcbiAgICAgIGRvYy50cmlnZ2VycyA9IFtkb2MudHJpZ2dlcnNdO1xuICAgIH1cbiAgICBkb2MudHJpZ2dlcnMgPSBkb2MudHJpZ2dlcnMubWFwKHQgPT4gdXRpbC5yZWZJZCh0KSk7XG4gICAgZG9jLnRpbWUgPSBudWxsO1xuICB9IGVsc2UgaWYgKGRvYy50aW1lKSB7XG4gICAgZG9jLnRyaWdnZXJzID0gbnVsbDtcbiAgfVxuICBkb2Muc3lzdGVtID0gdXRpbC5yZWYoZG9jLnN5c3RlbSwge1xuICAgIHR5cGU6IFwic3lzdGVtXCJcbiAgfSk7XG4gIGRlbGV0ZSBkb2MuaW5zdGFuY2VzOyAvLyBJbnN0YW5jZXMgc2hvdWxkbid0IGJlIHVwZGF0ZWRcbiAgZGVsZXRlIGRvYy5jaGVja3BvaW50czsgLy8gQ2hlY2twb2ludHMgc2hvdWxkIGJlIHVwZGF0ZWRcbiAgZGVsZXRlIGRvYy5yZXF1ZXN0ZWRfa2luZXNpczsgLy8gcmVxdWVzdGVkX2tpbmVzaXMgc2hvdWxkIGJlIHVwZGF0ZWRcbiAgZGVsZXRlIGRvYy5pZDsgLy8gUGFydCBvZiB0aGUga2V5XG4gIGRlbGV0ZSBkb2MudHJpZ2dlcjsgLy8gZG9uJ3QgdXBkYXRlIGJlY2F1c2UgaXQgY291ZGxkIHVuZG8gYSBkaWZmZXJlbnQgdHJpZ2dlclxuICBkZWxldGUgZG9jLmludm9rZVRpbWU7IC8vIE9ubHkgc2V0IGJ5IGNyb24gZXhlY3V0aW9uIGxhbWJkYVxuICBpZiAoZG9jLmV4ZWN1dGVOb3cgPT09IHRydWUpIHtcbiAgICBkb2MudHJpZ2dlciA9IG1vbWVudC5ub3coKTtcbiAgICBkb2MuaWdub3JlUGF1c2VkID0gdHJ1ZTtcbiAgICBkb2MuZXJyb3JDb3VudCA9IDA7XG4gICAgZG9jLnNjaGVkdWxlZFRyaWdnZXIgPSBudWxsO1xuICB9XG4gIGxldCBjbGVhckluc3RhbmNlcyA9IGRvYy5leGVjdXRlTm93Q2xlYXIgPT09IHRydWU7XG4gIGRlbGV0ZSBkb2MuZXhlY3V0ZU5vdztcbiAgZGVsZXRlIGRvYy5leGVjdXRlTm93Q2xlYXI7XG4gIGxldCBuZXdDaGVja3BvaW50ID0gZG9jLmNoZWNrcG9pbnQ7XG4gIGRlbGV0ZSBkb2MuY2hlY2twb2ludDsgLy8gTmV3IHZlcnNpb24gb2YgY2hlY2twb2ludCBpcyBhbiBvYmplY3Qgbm90IGxlZ2FjeSBzdHJpbmdcblxuICBsZXQgc2tpcCA9IFtcImNoZWNrc3VtUmVzZXRcIl07XG4gIGZvciAobGV0IGsgaW4gZG9jKSB7XG4gICAgaWYgKHNraXAuaW5kZXhPZihrKSA8IDAgJiYgZG9jW2tdICE9PSB1bmRlZmluZWQgJiYgZG9jW2tdICE9PSBcIlwiKSB7XG4gICAgICBsZXQgZmllbGROYW1lID0gay5yZXBsYWNlKC9bXmEtel0rL2lnLCBcIl9cIik7XG4gICAgICBzZXRzLnB1c2goYCMke2ZpZWxkTmFtZX0gPSA6JHtmaWVsZE5hbWV9YCk7XG4gICAgICBuYW1lc1tgIyR7ZmllbGROYW1lfWBdID0gaztcbiAgICAgIGF0dHJpYnV0ZXNbYDoke2ZpZWxkTmFtZX1gXSA9IGRvY1trXTtcbiAgICB9XG4gIH1cbiAgbmFtZXNbYCNpbnN0YW5jZXNgXSA9IFwiaW5zdGFuY2VzXCI7XG4gIGF0dHJpYnV0ZXNbYDppbnN0YW5jZXNgXSA9IHt9O1xuICBuYW1lc1tcIiNyZXF1ZXN0ZWRfa2luZXNpc1wiXSA9IFwicmVxdWVzdGVkX2tpbmVzaXNcIjtcbiAgYXR0cmlidXRlc1tgOnJlcXVlc3RlZF9raW5lc2lzYF0gPSB7fTtcbiAgbmFtZXNbXCIjY2hlY2twb2ludHNcIl0gPSBcImNoZWNrcG9pbnRzXCI7XG4gIGF0dHJpYnV0ZXNbYDpjaGVja3BvaW50c2BdID0ge1xuICAgIHJlYWQ6IHt9LFxuICAgIHdyaXRlOiB7fVxuICB9O1xuICBpZiAoY2xlYXJJbnN0YW5jZXMpIHtcbiAgICBuYW1lc1tgI2ludm9rZVRpbWVgXSA9IFwiaW52b2tlVGltZVwiO1xuICAgIG5hbWVzW2AjaW5zdGFuY2VJZGBdID0gXCIwXCI7XG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbYDppbnN0YW5jZXNgXTtcbiAgICBkZWxldGVzLnB1c2goXCIjaW5zdGFuY2VzLiNpbnN0YW5jZUlkXCIpO1xuICAgIGRlbGV0ZXMucHVzaChcIiNpbnZva2VUaW1lXCIpO1xuICB9IGVsc2Uge1xuICAgIHNldHMucHVzaChgI2luc3RhbmNlcyA9IGlmX25vdF9leGlzdHMoI2luc3RhbmNlcywgOmluc3RhbmNlcylgKTtcbiAgfVxuICBzZXRzLnB1c2goYCNjaGVja3BvaW50cyA9IGlmX25vdF9leGlzdHMoI2NoZWNrcG9pbnRzLCA6Y2hlY2twb2ludHMpYCk7XG4gIHNldHMucHVzaChgI3JlcXVlc3RlZF9raW5lc2lzID0gaWZfbm90X2V4aXN0cygjcmVxdWVzdGVkX2tpbmVzaXMsIDpyZXF1ZXN0ZWRfa2luZXNpcylgKTtcbiAgbGV0IHBhcmFtcyA9IHtcbiAgICBUYWJsZU5hbWU6IENST05fVEFCTEUsXG4gICAgS2V5OiB7XG4gICAgICBpZDogaWRcbiAgICB9LFxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdzZXQgJyArIHNldHMuam9pbihcIiwgXCIpICsgKGRlbGV0ZXMubGVuZ3RoID8gXCIgcmVtb3ZlIFwiICsgZGVsZXRlcy5qb2luKFwiLCBcIikgOiBcIlwiKSxcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IG5hbWVzLFxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IGF0dHJpYnV0ZXMsXG4gICAgXCJSZXR1cm5Db25zdW1lZENhcGFjaXR5XCI6ICdUT1RBTCcsXG4gICAgUmV0dXJuVmFsdWVzOiAnQUxMX05FVydcbiAgfTtcbiAgZHluYW1vZGIuZ2V0KENST05fVEFCTEUsIGlkLCAoZXJyLCBvbGREYXRhKSA9PiB7XG4gICAgaWYgKG9sZERhdGEpIHtcbiAgICAgIGRlbGV0ZSBvbGREYXRhLmluc3RhbmNlcztcbiAgICB9XG4gICAgZHluYW1vZGIudXBkYXRlKHBhcmFtcywgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhcIltyZXN1bHRdXCIsIEpTT04uc3RyaW5naWZ5KHJlc3VsdCwgbnVsbCwgMikpO1xuICAgICAgICB2YXIgZG9uZSA9IGNhbGxiYWNrO1xuICAgICAgICB2YXIgZGF0YSA9IHJlc3VsdC5BdHRyaWJ1dGVzO1xuICAgICAgICB2YXIgc3RyZWFtID0gbGVvLmxvYWQoQk9UX0lELCBMT0dfREVTVElOQVRJT04pO1xuICAgICAgICB2YXIgbmV3RGF0YSA9IGRhdGE7XG4gICAgICAgIGRlbGV0ZSBuZXdEYXRhLmluc3RhbmNlcztcbiAgICAgICAgY2FsbGJhY2sgPSAoZXJyLCBkKSA9PiB7XG4gICAgICAgICAgdmFyIGRpZmZBcnJheSA9IGRpZmYob2xkRGF0YSwgbmV3RGF0YSkgfHwgW107XG4gICAgICAgICAgdmFyIGRpZmZzID0gZGlmZkFycmF5Lm1hcChlID0+ICh7XG4gICAgICAgICAgICBbYCR7ZS5wYXRoLmpvaW4oXCIuXCIpfWBdOiB7XG4gICAgICAgICAgICAgIG9sZDogZS5saHMgfHwgZS5pdGVtICYmIGUuaXRlbS5saHMgfHwgJycsXG4gICAgICAgICAgICAgIG5ldzogZS5yaHMgfHwgZS5pdGVtICYmIGUuaXRlbS5yaHMgfHwgJydcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KSk7XG4gICAgICAgICAgaWYgKGRpZmZzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgc3RyZWFtLndyaXRlKHtcbiAgICAgICAgICAgICAgb2xkOiBvbGREYXRhLFxuICAgICAgICAgICAgICBuZXc6IG5ld0RhdGEsXG4gICAgICAgICAgICAgIGRpZmY6IGRpZmZzXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICAgIHN0cmVhbS5lbmQoKCkgPT4ge1xuICAgICAgICAgICAgICBpZiAoIWVyciAmJiBkYXRhLnN5c3RlbSkge1xuICAgICAgICAgICAgICAgIHNhdmVTeXN0ZW1FbnRyeShpZCwgZGF0YSwgZG9jKS50aGVuKGQgPT4gZG9uZShudWxsLCBkKSkuY2F0Y2goZG9uZSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZG9uZShlcnIsIGQpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZG9uZShlcnIsIGQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHNldHMgPSBbXTtcbiAgICAgICAgdmFyIG5hbWVzID0ge1xuICAgICAgICAgIFwiI2NoZWNrcG9pbnRzXCI6IFwiY2hlY2twb2ludHNcIlxuICAgICAgICB9O1xuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IHt9O1xuICAgICAgICB2YXIgaW5kZXggPSAwO1xuICAgICAgICBpZiAoZGF0YS5sYW1iZGEgJiYgZGF0YS5sYW1iZGEuc2V0dGluZ3MpIHtcbiAgICAgICAgICBkYXRhLmxhbWJkYS5zZXR0aW5ncy5mb3JFYWNoKHNldHRpbmcgPT4ge1xuICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgICAgIHZhciBkZXN0aW5hdGlvbiA9IHV0aWwucmVmKHNldHRpbmcuZGVzdGluYXRpb24pO1xuICAgICAgICAgICAgaWYgKGRlc3RpbmF0aW9uICYmICFkYXRhLmNoZWNrcG9pbnRzLndyaXRlW2Rlc3RpbmF0aW9uXSkge1xuICAgICAgICAgICAgICBkYXRhLmNoZWNrcG9pbnRzLndyaXRlW2Rlc3RpbmF0aW9uXSA9IHt9O1xuICAgICAgICAgICAgICAvLyBTZXQgYmxhbmsgQ2hlY2twb2ludFxuICAgICAgICAgICAgICBzZXRzLnB1c2goYCNjaGVja3BvaW50cy4jd3JpdGUuI3dfJHtpbmRleH0gPSBpZl9ub3RfZXhpc3RzKCNjaGVja3BvaW50cy4jd3JpdGUuI3dfJHtpbmRleH0sIDp3XyR7aW5kZXh9KWApO1xuICAgICAgICAgICAgICBuYW1lc1tgI3dfJHtpbmRleH1gXSA9IGRlc3RpbmF0aW9uLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgIG5hbWVzW1wiI3dyaXRlXCJdID0gXCJ3cml0ZVwiO1xuICAgICAgICAgICAgICBhdHRyaWJ1dGVzW2A6d18ke2luZGV4fWBdID0ge307XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG5ld0NoZWNrcG9pbnQpIHtcbiAgICAgICAgICBPYmplY3Qua2V5cyhuZXdDaGVja3BvaW50KS5tYXAoa2V5ID0+IHtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgICBzZXRzLnB1c2goYCNjaGVja3BvaW50cy4jcmVhZC4jcl8ke2luZGV4fSA9IDpyXyR7aW5kZXh9YCk7XG4gICAgICAgICAgICBuYW1lc1tgI3JfJHtpbmRleH1gXSA9IGtleS50b1N0cmluZygpO1xuICAgICAgICAgICAgbmFtZXNbXCIjcmVhZFwiXSA9IFwicmVhZFwiO1xuICAgICAgICAgICAgYXR0cmlidXRlc1tgOnJfJHtpbmRleH1gXSA9IE9iamVjdC5hc3NpZ24oe30sIGRhdGEuY2hlY2twb2ludHMucmVhZFtrZXldLCB7XG4gICAgICAgICAgICAgIGNoZWNrcG9pbnQ6IG5ld0NoZWNrcG9pbnRba2V5XVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHMubGVuZ3RoKSB7XG4gICAgICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgICAgIFRhYmxlTmFtZTogQ1JPTl9UQUJMRSxcbiAgICAgICAgICAgIEtleToge1xuICAgICAgICAgICAgICBpZDogaWRcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBVcGRhdGVFeHByZXNzaW9uOiAnc2V0ICcgKyBzZXRzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczogbmFtZXMsXG4gICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgXCJSZXR1cm5Db25zdW1lZENhcGFjaXR5XCI6ICdUT1RBTCdcbiAgICAgICAgICB9O1xuICAgICAgICAgIGR5bmFtb2RiLnVwZGF0ZShwYXJhbXMsIGZ1bmN0aW9uIChlcnIsIGRhdGEpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGVyciwgZGF0YSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgICAgICAgIHJlZklkOiByZWZJZFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICAgICAgcmVmSWQ6IHJlZklkXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59XG5mdW5jdGlvbiBzYXZlU3lzdGVtRW50cnkoYm90SWQsIGNyb24sIGRvYykge1xuICB2YXIgc3lzdGVtID0gY3Jvbi5zeXN0ZW07XG4gIHZhciBzeXN0ZW1JZCA9ICFzeXN0ZW0uaWQgPyBzeXN0ZW0gOiBzeXN0ZW0uaWQucmVwbGFjZSgvXnNfLywgXCJcIik7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKHN5c3RlbS50eXBlID09IFwiY2hlY2tzdW1cIikge1xuICAgICAgdmFyIHNldHRpbmdzID0gY3Jvbi5sYW1iZGEuc2V0dGluZ3NbMF0gfHwge307XG4gICAgICB2YXIgb3RoZXJTeXN0ZW0gPSAoIXNldHRpbmdzLm1hc3RlciB8fCBzZXR0aW5ncy5tYXN0ZXIuaWQgPT0gc3lzdGVtSWQgPyBzZXR0aW5ncy5zbGF2ZSA6IHNldHRpbmdzLm1hc3RlcikgfHwge307XG4gICAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShjcm9uLmxhbWJkYSwgbnVsbCwgMikpO1xuICAgICAgZHluYW1vZGIubWVyZ2UoU1lTVEVNX1RBQkxFLCBzeXN0ZW1JZCwge1xuICAgICAgICBjaGVja3N1bXM6IHtcbiAgICAgICAgICBbYm90SWRdOiB7XG4gICAgICAgICAgICBib3RfaWQ6IGBiXyR7Ym90SWR9YCxcbiAgICAgICAgICAgIGxhYmVsOiBjcm9uLm5hbWUsXG4gICAgICAgICAgICBzeXN0ZW06IGBzXyR7b3RoZXJTeXN0ZW0uaWR9YCxcbiAgICAgICAgICAgIHJlc2V0OiBkb2MuY2hlY2tzdW1SZXNldFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSwgKGVyciwgZGF0YSkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZShkYXRhKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmUoe30pO1xuICAgIH1cbiAgfSk7XG59XG5cbn0se1wiZGVlcC1kaWZmXCI6dW5kZWZpbmVkLFwibGVvLWF1dGhcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZCxcIm1vbWVudFwiOnVuZGVmaW5lZCxcInV1aWRcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
