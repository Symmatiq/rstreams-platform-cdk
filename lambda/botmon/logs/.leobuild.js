(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
var _leoAuth = _interopRequireDefault(require("leo-auth"));
var _leoSdk = _interopRequireDefault(require("leo-sdk"));
var _clientCloudwatchLogs = require("@aws-sdk/client-cloudwatch-logs");
var _clientDynamodb = require("@aws-sdk/client-dynamodb");
var _reference = require("leo-sdk/lib/reference.js");
var _moment = _interopRequireDefault(require("moment"));
var _async = _interopRequireDefault(require("async"));
var _leoConfig = require("leo-config");
const leoConfigRegion = _leoConfig.Resources.Region;
let cloudwatchlogs = new _clientCloudwatchLogs.CloudWatchLogsClient({
  region: leoConfigRegion
});
const dynamodb = new _clientDynamodb.DynamoDBClient({
  region: leoConfigRegion
});
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  const limit = 50;
  const lambda = event.params.path.lambda;
  const bot_id = (0, _reference.ref)(event.params.path.id, "bot").id;
  let matchParts;
  if (lambda && (matchParts = lambda.match(/^arn:aws:lambda:(.*?):[0-9]+:function:(.*)$/))) {
    lambda = matchParts[2];
    const region = matchParts[1];
    if (region !== leoConfigRegion) {
      cloudwatchlogs = new _clientCloudwatchLogs.CloudWatchLogsClient({
        region: region
      });
    }
  }
  let start = (0, _moment.default)().subtract(10, "m").valueOf();
  if (event.params.querystring.start) {
    start = (0, _moment.default)(parseInt(event.params.querystring.start)).valueOf();
  }
  await _leoAuth.default.authorize(event, {
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
    _async.default.doWhilst(async done => {
      const pattern = bot_id === "all" ? `"START"` : `"[LEOCRON]:start:${bot_id}"`;
      const splitPattern = bot_id === "all" ? new RegExp("RequestId: *(.*?) Version") : new RegExp("\t");
      try {
        const data = await cloudwatchlogs.send(new _clientCloudwatchLogs.FilterLogEventsCommand({
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
        data.events.map(e => {
          starts.push({
            timestamp: e.timestamp,
            stream: e.logStreamName,
            requestId: e.message.split(splitPattern)[1],
            endtimestamp: (0, _moment.default)().valueOf()
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
    }, err => {
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
    const data = await cloudwatchlogs.send(new _clientCloudwatchLogs.FilterLogEventsCommand({
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
    data.events.forEach(e => {
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
};

},{"@aws-sdk/client-cloudwatch-logs":undefined,"@aws-sdk/client-dynamodb":undefined,"@babel/runtime/helpers/interopRequireDefault":undefined,"async":undefined,"leo-auth":undefined,"leo-config":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined,"moment":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4ndXNlIHN0cmljdCc7XG5cbnZhciBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0ID0gcmVxdWlyZShcIkBiYWJlbC9ydW50aW1lL2hlbHBlcnMvaW50ZXJvcFJlcXVpcmVEZWZhdWx0XCIpO1xudmFyIF9sZW9BdXRoID0gX2ludGVyb3BSZXF1aXJlRGVmYXVsdChyZXF1aXJlKFwibGVvLWF1dGhcIikpO1xudmFyIF9sZW9TZGsgPSBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0KHJlcXVpcmUoXCJsZW8tc2RrXCIpKTtcbnZhciBfY2xpZW50Q2xvdWR3YXRjaExvZ3MgPSByZXF1aXJlKFwiQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2gtbG9nc1wiKTtcbnZhciBfY2xpZW50RHluYW1vZGIgPSByZXF1aXJlKFwiQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiXCIpO1xudmFyIF9yZWZlcmVuY2UgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIF9tb21lbnQgPSBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0KHJlcXVpcmUoXCJtb21lbnRcIikpO1xudmFyIF9hc3luYyA9IF9pbnRlcm9wUmVxdWlyZURlZmF1bHQocmVxdWlyZShcImFzeW5jXCIpKTtcbnZhciBfbGVvQ29uZmlnID0gcmVxdWlyZShcImxlby1jb25maWdcIik7XG5jb25zdCBsZW9Db25maWdSZWdpb24gPSBfbGVvQ29uZmlnLlJlc291cmNlcy5SZWdpb247XG5sZXQgY2xvdWR3YXRjaGxvZ3MgPSBuZXcgX2NsaWVudENsb3Vkd2F0Y2hMb2dzLkNsb3VkV2F0Y2hMb2dzQ2xpZW50KHtcbiAgcmVnaW9uOiBsZW9Db25maWdSZWdpb25cbn0pO1xuY29uc3QgZHluYW1vZGIgPSBuZXcgX2NsaWVudER5bmFtb2RiLkR5bmFtb0RCQ2xpZW50KHtcbiAgcmVnaW9uOiBsZW9Db25maWdSZWdpb25cbn0pO1xuZXhwb3J0cy5oYW5kbGVyID0gcmVxdWlyZShcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIikoYXN5bmMgKGV2ZW50LCBjb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICBjb25zdCBsaW1pdCA9IDUwO1xuICBjb25zdCBsYW1iZGEgPSBldmVudC5wYXJhbXMucGF0aC5sYW1iZGE7XG4gIGNvbnN0IGJvdF9pZCA9ICgwLCBfcmVmZXJlbmNlLnJlZikoZXZlbnQucGFyYW1zLnBhdGguaWQsIFwiYm90XCIpLmlkO1xuICBsZXQgbWF0Y2hQYXJ0cztcbiAgaWYgKGxhbWJkYSAmJiAobWF0Y2hQYXJ0cyA9IGxhbWJkYS5tYXRjaCgvXmFybjphd3M6bGFtYmRhOiguKj8pOlswLTldKzpmdW5jdGlvbjooLiopJC8pKSkge1xuICAgIGxhbWJkYSA9IG1hdGNoUGFydHNbMl07XG4gICAgY29uc3QgcmVnaW9uID0gbWF0Y2hQYXJ0c1sxXTtcbiAgICBpZiAocmVnaW9uICE9PSBsZW9Db25maWdSZWdpb24pIHtcbiAgICAgIGNsb3Vkd2F0Y2hsb2dzID0gbmV3IF9jbGllbnRDbG91ZHdhdGNoTG9ncy5DbG91ZFdhdGNoTG9nc0NsaWVudCh7XG4gICAgICAgIHJlZ2lvbjogcmVnaW9uXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgbGV0IHN0YXJ0ID0gKDAsIF9tb21lbnQuZGVmYXVsdCkoKS5zdWJ0cmFjdCgxMCwgXCJtXCIpLnZhbHVlT2YoKTtcbiAgaWYgKGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5zdGFydCkge1xuICAgIHN0YXJ0ID0gKDAsIF9tb21lbnQuZGVmYXVsdCkocGFyc2VJbnQoZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLnN0YXJ0KSkudmFsdWVPZigpO1xuICB9XG4gIGF3YWl0IF9sZW9BdXRoLmRlZmF1bHQuYXV0aG9yaXplKGV2ZW50LCB7XG4gICAgbHJuOiAnbHJuOmxlbzpib3Rtb246OjonLFxuICAgIGFjdGlvbjogXCJsb2dzXCIsXG4gICAgYm90bW9uOiB7fVxuICB9KTtcbiAgbGV0IHN0YXJ0cyA9IFtdO1xuICBsZXQgbmV4dFRva2VuID0gbnVsbDtcbiAgbGV0IGhhc1RpbWUgPSB0cnVlO1xuICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaGFzVGltZSA9IGZhbHNlO1xuICB9LCBjb250ZXh0LmdldFJlbWFpbmluZ1RpbWVJbk1pbGxpcygpICogMC44KTtcbiAgaWYgKGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5zdHJlYW0pIHtcbiAgICByZXF1ZXN0TG9ncyhsYW1iZGEsIGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZywgKGVyciwgZGV0YWlscykgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgY2FsbGJhY2soZXJyLCBkZXRhaWxzKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBfYXN5bmMuZGVmYXVsdC5kb1doaWxzdChhc3luYyBkb25lID0+IHtcbiAgICAgIGNvbnN0IHBhdHRlcm4gPSBib3RfaWQgPT09IFwiYWxsXCIgPyBgXCJTVEFSVFwiYCA6IGBcIltMRU9DUk9OXTpzdGFydDoke2JvdF9pZH1cImA7XG4gICAgICBjb25zdCBzcGxpdFBhdHRlcm4gPSBib3RfaWQgPT09IFwiYWxsXCIgPyBuZXcgUmVnRXhwKFwiUmVxdWVzdElkOiAqKC4qPykgVmVyc2lvblwiKSA6IG5ldyBSZWdFeHAoXCJcXHRcIik7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgY2xvdWR3YXRjaGxvZ3Muc2VuZChuZXcgX2NsaWVudENsb3Vkd2F0Y2hMb2dzLkZpbHRlckxvZ0V2ZW50c0NvbW1hbmQoe1xuICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhLyR7bGFtYmRhfWAsXG4gICAgICAgICAgaW50ZXJsZWF2ZWQ6IGZhbHNlLFxuICAgICAgICAgIGxpbWl0OiBsaW1pdCxcbiAgICAgICAgICBzdGFydFRpbWU6IHN0YXJ0LFxuICAgICAgICAgIGZpbHRlclBhdHRlcm46IHBhdHRlcm4sXG4gICAgICAgICAgbmV4dFRva2VuOiBuZXh0VG9rZW5cbiAgICAgICAgfSkpO1xuICAgICAgICBpZiAoZGF0YS5uZXh0VG9rZW4gJiYgc3RhcnRzLmxlbmd0aCA8IGxpbWl0KSB7XG4gICAgICAgICAgbmV4dFRva2VuID0gZGF0YS5uZXh0VG9rZW47XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV4dFRva2VuID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBkYXRhLmV2ZW50cy5tYXAoZSA9PiB7XG4gICAgICAgICAgc3RhcnRzLnB1c2goe1xuICAgICAgICAgICAgdGltZXN0YW1wOiBlLnRpbWVzdGFtcCxcbiAgICAgICAgICAgIHN0cmVhbTogZS5sb2dTdHJlYW1OYW1lLFxuICAgICAgICAgICAgcmVxdWVzdElkOiBlLm1lc3NhZ2Uuc3BsaXQoc3BsaXRQYXR0ZXJuKVsxXSxcbiAgICAgICAgICAgIGVuZHRpbWVzdGFtcDogKDAsIF9tb21lbnQuZGVmYXVsdCkoKS52YWx1ZU9mKClcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRvbmUoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyLmNvZGUgPT09IFwiUmVzb3VyY2VOb3RGb3VuZEV4Y2VwdGlvblwiKSB7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRvbmUoZXJyKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sICgpID0+IHtcbiAgICAgIHJldHVybiBoYXNUaW1lICYmIG5leHRUb2tlbiAhPT0gbnVsbDtcbiAgICB9LCBlcnIgPT4ge1xuICAgICAgc3RhcnRzID0gc3RhcnRzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgcmV0dXJuIGIudGltZXN0YW1wIC0gYS50aW1lc3RhbXA7XG4gICAgICB9KTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoKSB7XG4gICAgICAgIHJlcXVlc3RMb2dzKGxhbWJkYSwgc3RhcnRzWzBdLCAoZXJyLCBkZXRhaWxzKSA9PiB7XG4gICAgICAgICAgc3RhcnRzWzBdLmRldGFpbHMgPSBkZXRhaWxzO1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICBjYWxsYmFjayhlcnIsIHN0YXJ0cyk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICBjYWxsYmFjayhlcnIsIHN0YXJ0cyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn0pO1xuYXN5bmMgZnVuY3Rpb24gcmVxdWVzdExvZ3MobGFtYmRhLCBzdGFydCwgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgY2xvdWR3YXRjaGxvZ3Muc2VuZChuZXcgX2NsaWVudENsb3Vkd2F0Y2hMb2dzLkZpbHRlckxvZ0V2ZW50c0NvbW1hbmQoe1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9sYW1iZGEvJHtsYW1iZGF9YCxcbiAgICAgIGludGVybGVhdmVkOiBmYWxzZSxcbiAgICAgIGxvZ1N0cmVhbU5hbWVzOiBbc3RhcnQuc3RyZWFtXSxcbiAgICAgIGxpbWl0OiAxMDAwLFxuICAgICAgc3RhcnRUaW1lOiBzdGFydC50aW1lc3RhbXAsXG4gICAgICBmaWx0ZXJQYXR0ZXJuOiBgXCIke3N0YXJ0LnJlcXVlc3RJZH1cImAsXG4gICAgICBuZXh0VG9rZW46IHN0YXJ0Lm5leHRUb2tlblxuICAgIH0pKTtcbiAgICBjb25zdCBsb2dzID0gW107XG4gICAgY29uc3Qgc3RhdHMgPSB7XG4gICAgICBkeW5hbW9kYjoge1xuICAgICAgICByZWFkOiAwLFxuICAgICAgICB3cml0ZTogMCxcbiAgICAgICAgZXZlbnRzOiBbXVxuICAgICAgfVxuICAgIH07XG4gICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGBeXFxcXGR7NH0tXFxcXGR7Mn0tXFxcXGR7Mn1ULio/XFxcXHQke3N0YXJ0LnJlcXVlc3RJZH1cXFxcdGApO1xuICAgIGRhdGEuZXZlbnRzLmZvckVhY2goZSA9PiB7XG4gICAgICBpZiAoZS5tZXNzYWdlLm1hdGNoKC9cXFtMRU9MT0cvKSkge1xuICAgICAgICBjb25zdCBzdGF0ID0gcGFyc2VMZW9Mb2cobnVsbCwgZSk7XG4gICAgICAgIGlmIChzdGF0LmV2ZW50Lm1hdGNoKC9eZHluYW1vZGIvKSkge1xuICAgICAgICAgIGlmIChzdGF0LmV2ZW50Lm1hdGNoKC91cGRhdGV8d3JpdGUvaSkpIHtcbiAgICAgICAgICAgIHN0YXRzLmR5bmFtb2RiLndyaXRlICs9IHN0YXQuY29uc3VtcHRpb247XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXRzLmR5bmFtb2RiLnJlYWQgKz0gc3RhdC5jb25zdW1wdGlvbjtcbiAgICAgICAgICB9XG4gICAgICAgICAgc3RhdHMuZHluYW1vZGIuZXZlbnRzLnB1c2goc3RhdCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZS5tZXNzYWdlLm1hdGNoKC9cXFtMRU9DUk9OLykpIHtcbiAgICAgICAgLy8gaGFuZGxlIExFT0NST04gbG9ncyBpZiBuZWVkZWRcbiAgICAgIH0gZWxzZSBpZiAoZS5tZXNzYWdlLm1hdGNoKG5ldyBSZWdFeHAoYFxcXFxzJHtzdGFydC5yZXF1ZXN0SWR9YCkpKSB7XG4gICAgICAgIGxldCBtc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGlmIChlLm1lc3NhZ2UubWF0Y2gocmVnZXgpKSB7XG4gICAgICAgICAgbXNnID0gZS5tZXNzYWdlLnNwbGl0KC9cXHQvKS5zbGljZSgyKS5qb2luKFwiXFx0XCIpO1xuICAgICAgICB9XG4gICAgICAgIGxvZ3MucHVzaCh7XG4gICAgICAgICAgdGltZXN0YW1wOiBlLnRpbWVzdGFtcCxcbiAgICAgICAgICBtZXNzYWdlOiBtc2dcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgbG9ncyxcbiAgICAgIHN0YXRzLFxuICAgICAgbmV4dFRva2VuOiBkYXRhLm5leHRUb2tlblxuICAgIH0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjYWxsYmFjayhlcnIpO1xuICB9XG59XG5mdW5jdGlvbiBzYWZlTnVtYmVyKG51bWJlcikge1xuICByZXR1cm4gaXNOYU4obnVtYmVyKSB8fCAhbnVtYmVyID8gMCA6IG51bWJlcjtcbn1cbmZ1bmN0aW9uIHBhcnNlTGVvTG9nKGJvdCwgZSkge1xuICBjb25zdCBkYXRhID0gZS5tZXNzYWdlLnRyaW0oKS5yZXBsYWNlKC9eLipcXFtMRU9MT0dcXF06LywgJycpLnNwbGl0KC86Lyk7XG4gIGNvbnN0IHZlcnNpb24gPSBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbMF0ucmVwbGFjZShcInZcIiwgXCJcIikpKTtcbiAgcmV0dXJuICh2ZXJzaW9uSGFuZGxlclt2ZXJzaW9uXSB8fCB2ZXJzaW9uSGFuZGxlcltcIjFcIl0pKGJvdCwgZSwgZGF0YSk7XG59XG5jb25zdCB2ZXJzaW9uSGFuZGxlciA9IHtcbiAgXCIxXCI6IGZ1bmN0aW9uIChib3QsIGUsIGRhdGEpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGJvdCxcbiAgICAgIHZlcnNpb246IHNhZmVOdW1iZXIocGFyc2VJbnQoZGF0YVswXS5yZXBsYWNlKFwidlwiLCBcIlwiKSkpLFxuICAgICAgcnVuczogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzFdKSksXG4gICAgICBjb21wbGV0aW9uczogMSxcbiAgICAgIHN0YXJ0OiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbMl0pKSxcbiAgICAgIGVuZDogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzNdKSksXG4gICAgICB1bml0czogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzRdKSksXG4gICAgICBkdXJhdGlvbjogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzVdKSksXG4gICAgICBtaW5fZHVyYXRpb246IHNhZmVOdW1iZXIocGFyc2VJbnQoZGF0YVs2XSkpLFxuICAgICAgbWF4X2R1cmF0aW9uOiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbN10pKSxcbiAgICAgIGNvbnN1bXB0aW9uOiBzYWZlTnVtYmVyKHBhcnNlRmxvYXQoZGF0YVs4XSkpLFxuICAgICAgZXJyb3JzOiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbOV0pKSxcbiAgICAgIGV2ZW50OiBkYXRhLnNsaWNlKDEwKS5qb2luKFwiOlwiKSxcbiAgICAgIHRpbWVzdGFtcDogZS50aW1lc3RhbXBcbiAgICB9O1xuICB9LFxuICBcIjJcIjogZnVuY3Rpb24gKGJvdCwgZSkge1xuICAgIGNvbnN0IGxvZyA9IEpTT04ucGFyc2UoZS5tZXNzYWdlLnRyaW0oKS5yZXBsYWNlKC9eLipcXFtMRU9MT0dcXF06djI6LywgJycpKTtcbiAgICBsb2cuZSA9IGxvZy5lIHx8IHt9O1xuICAgIGNvbnN0IGRhdGEgPSBsb2cucDtcbiAgICBjb25zdCBvYmogPSB7XG4gICAgICBpZDogbG9nLmUua2V5IHx8IGJvdCxcbiAgICAgIHZlcnNpb246IDIsXG4gICAgICBydW5zOiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbMF0pKSxcbiAgICAgIHN0YXJ0OiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbMV0pKSxcbiAgICAgIGVuZDogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzJdKSksXG4gICAgICB1bml0czogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzNdKSksXG4gICAgICBkdXJhdGlvbjogc2FmZU51bWJlcihwYXJzZUludChkYXRhWzRdKSksXG4gICAgICBtaW5fZHVyYXRpb246IHNhZmVOdW1iZXIocGFyc2VJbnQoZGF0YVs1XSkpLFxuICAgICAgbWF4X2R1cmF0aW9uOiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbNl0pKSxcbiAgICAgIGNvbnN1bXB0aW9uOiBzYWZlTnVtYmVyKHBhcnNlRmxvYXQoZGF0YVs3XSkpLFxuICAgICAgZXJyb3JzOiBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbOF0pKSxcbiAgICAgIGV2ZW50OiBkYXRhWzldLFxuICAgICAgY29tcGxldGlvbnM6IHNhZmVOdW1iZXIocGFyc2VJbnQoZGF0YVsxMF0pKSxcbiAgICAgIHRpbWVzdGFtcDogbG9nLmUucyB8fCBzYWZlTnVtYmVyKHBhcnNlSW50KGRhdGFbMV0pKSB8fCBlLnRpbWVzdGFtcFxuICAgIH07XG4gICAgZGVsZXRlIGxvZy5lLmtleTtcbiAgICBvYmouZXh0cmEgPSBsb2cuZTtcbiAgICByZXR1cm4gb2JqO1xuICB9XG59O1xuXG59LHtcIkBhd3Mtc2RrL2NsaWVudC1jbG91ZHdhdGNoLWxvZ3NcIjp1bmRlZmluZWQsXCJAYXdzLXNkay9jbGllbnQtZHluYW1vZGJcIjp1bmRlZmluZWQsXCJAYmFiZWwvcnVudGltZS9oZWxwZXJzL2ludGVyb3BSZXF1aXJlRGVmYXVsdFwiOnVuZGVmaW5lZCxcImFzeW5jXCI6dW5kZWZpbmVkLFwibGVvLWF1dGhcIjp1bmRlZmluZWQsXCJsZW8tY29uZmlnXCI6dW5kZWZpbmVkLFwibGVvLXNka1wiOnVuZGVmaW5lZCxcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiOnVuZGVmaW5lZCxcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIjp1bmRlZmluZWQsXCJtb21lbnRcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
