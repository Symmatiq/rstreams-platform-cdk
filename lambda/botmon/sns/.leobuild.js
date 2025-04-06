(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handler = void 0;
var _clientSns = require("@aws-sdk/client-sns");
var _clientDynamodb = require("@aws-sdk/client-dynamodb");
var _leoAuth = _interopRequireDefault(require("leo-auth"));
var _leoSdk = _interopRequireDefault(require("leo-sdk"));
var _async = _interopRequireDefault(require("async"));
var _configuration = _interopRequireDefault(require("leo-sdk/lib/configuration"));
var _leoLogger = _interopRequireDefault(require("leo-logger"));
const dynamodb = new _clientDynamodb.DynamoDBClient({
  region: _configuration.default.aws.region
});
const sns = new _clientSns.SNSClient({
  region: _configuration.default.aws.region
});
const SETTINGS_TABLE = _configuration.default.resources.LeoSettings;
let handlers = {
  "GET": doGet,
  "POST": doPost,
  default: (e, c, callback) => callback("Unsupported")
};
const handler = exports.handler = _leoSdk.default.wrap(async (event, context, callback) => {
  (handlers[event.requestContext.httpMethod] || handlers.default)(event, context, callback);
});
async function doGet(event, context, callback) {
  await _leoAuth.default.authorize(event, {
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
    const data = await sns.send(new _clientSns.ListTopicsCommand(params));
    let topics = data.Topics;
    if (topics.length !== 0) {
      for (let topic of topics) {
        tasks.push(async done => {
          try {
            const params2 = {
              NextToken: null,
              TopicArn: topic.TopicArn
            };
            const data = await sns.send(new _clientSns.ListSubscriptionsByTopicCommand(params2));
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
            const data = await sns.send(new _clientSns.GetTopicAttributesCommand(params2));
            topicAttributes[topic.TopicArn] = {
              displayName: data.Attributes.DisplayName,
              owner: data.Attributes.Owner
            };
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
          Key: {
            id: {
              S: id
            }
          }
        };
        const data = await dynamodb.send(new _clientDynamodb.GetItemCommand(params));
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
    await _leoAuth.default.authorize(event, {
      lrn: `lrn:leo:botmon:::sns_topic/{id}`,
      action: `create`,
      botmon: {
        "id": createId
      }
    });
    try {
      const data = await sns.send(new _clientSns.CreateTopicCommand({
        Name: createId
      }));
      callback(null, data);
    } catch (err) {
      callback(err);
    }
  } else if (event.params.path.type === 'subscription') {
    let subscribe = event.body && event.body.subscribe;
    if (subscribe === true) {
      let protocol = event.body && event.body.protocol;
      let endpoint = event.body && event.body.endpoint;
      await _leoAuth.default.authorize(event, {
        lrn: `lrn:leo:botmon:::sns_subscription/{topic}`,
        action: `subscribe`,
        botmon: {
          "topic": id,
          "protocol": protocol,
          "endpoint": endpoint
        }
      });
      try {
        const data = await sns.send(new _clientSns.SubscribeCommand({
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
      await _leoAuth.default.authorize(event, {
        lrn: `lrn:leo:botmon:::sns_subscription/{subscription}`,
        action: `unsubscribe`,
        botmon: {
          "subscription": unSub
        }
      });
      try {
        const data = await sns.send(new _clientSns.UnsubscribeCommand({
          SubscriptionArn: unSub
        }));
        callback(null, data);
      } catch (err) {
        callback(err);
      }
    }
  } else if (event.params.path.type === 'tags') {
    let body = event.body;
    await _leoAuth.default.authorize(event, {
      lrn: `lrn:leo:botmon:::sns_subscription/{tags}`,
      action: `update`,
      botmon: {
        "tags": body
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
      _leoSdk.default.aws.dynamodb.saveSetting("healthSNS_data", {
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
      _leoSdk.default.aws.dynamodb.saveSetting("healthSNS_data", {
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

},{"@aws-sdk/client-dynamodb":undefined,"@aws-sdk/client-sns":undefined,"@babel/runtime/helpers/interopRequireDefault":undefined,"async":undefined,"leo-auth":undefined,"leo-logger":undefined,"leo-sdk":undefined,"leo-sdk/lib/configuration":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4ndXNlIHN0cmljdCc7XG5cbnZhciBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0ID0gcmVxdWlyZShcIkBiYWJlbC9ydW50aW1lL2hlbHBlcnMvaW50ZXJvcFJlcXVpcmVEZWZhdWx0XCIpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7XG4gIHZhbHVlOiB0cnVlXG59KTtcbmV4cG9ydHMuaGFuZGxlciA9IHZvaWQgMDtcbnZhciBfY2xpZW50U25zID0gcmVxdWlyZShcIkBhd3Mtc2RrL2NsaWVudC1zbnNcIik7XG52YXIgX2NsaWVudER5bmFtb2RiID0gcmVxdWlyZShcIkBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYlwiKTtcbnZhciBfbGVvQXV0aCA9IF9pbnRlcm9wUmVxdWlyZURlZmF1bHQocmVxdWlyZShcImxlby1hdXRoXCIpKTtcbnZhciBfbGVvU2RrID0gX2ludGVyb3BSZXF1aXJlRGVmYXVsdChyZXF1aXJlKFwibGVvLXNka1wiKSk7XG52YXIgX2FzeW5jID0gX2ludGVyb3BSZXF1aXJlRGVmYXVsdChyZXF1aXJlKFwiYXN5bmNcIikpO1xudmFyIF9jb25maWd1cmF0aW9uID0gX2ludGVyb3BSZXF1aXJlRGVmYXVsdChyZXF1aXJlKFwibGVvLXNkay9saWIvY29uZmlndXJhdGlvblwiKSk7XG52YXIgX2xlb0xvZ2dlciA9IF9pbnRlcm9wUmVxdWlyZURlZmF1bHQocmVxdWlyZShcImxlby1sb2dnZXJcIikpO1xuY29uc3QgZHluYW1vZGIgPSBuZXcgX2NsaWVudER5bmFtb2RiLkR5bmFtb0RCQ2xpZW50KHtcbiAgcmVnaW9uOiBfY29uZmlndXJhdGlvbi5kZWZhdWx0LmF3cy5yZWdpb25cbn0pO1xuY29uc3Qgc25zID0gbmV3IF9jbGllbnRTbnMuU05TQ2xpZW50KHtcbiAgcmVnaW9uOiBfY29uZmlndXJhdGlvbi5kZWZhdWx0LmF3cy5yZWdpb25cbn0pO1xuY29uc3QgU0VUVElOR1NfVEFCTEUgPSBfY29uZmlndXJhdGlvbi5kZWZhdWx0LnJlc291cmNlcy5MZW9TZXR0aW5ncztcbmxldCBoYW5kbGVycyA9IHtcbiAgXCJHRVRcIjogZG9HZXQsXG4gIFwiUE9TVFwiOiBkb1Bvc3QsXG4gIGRlZmF1bHQ6IChlLCBjLCBjYWxsYmFjaykgPT4gY2FsbGJhY2soXCJVbnN1cHBvcnRlZFwiKVxufTtcbmNvbnN0IGhhbmRsZXIgPSBleHBvcnRzLmhhbmRsZXIgPSBfbGVvU2RrLmRlZmF1bHQud3JhcChhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIChoYW5kbGVyc1tldmVudC5yZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kXSB8fCBoYW5kbGVycy5kZWZhdWx0KShldmVudCwgY29udGV4dCwgY2FsbGJhY2spO1xufSk7XG5hc3luYyBmdW5jdGlvbiBkb0dldChldmVudCwgY29udGV4dCwgY2FsbGJhY2spIHtcbiAgYXdhaXQgX2xlb0F1dGguZGVmYXVsdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICBscm46IGBscm46bGVvOmJvdG1vbjo6OnNuc190b3BpY3NgLFxuICAgIGFjdGlvbjogYGdldGAsXG4gICAgYm90bW9uOiB7fVxuICB9KTtcbiAgbGV0IHBhcmFtcyA9IHtcbiAgICBOZXh0VG9rZW46IG51bGxcbiAgfTtcbiAgbGV0IGZpbmFsRGF0YSA9IHt9O1xuICBsZXQgc3VicyA9IHt9O1xuICBsZXQgdG9waWNBdHRyaWJ1dGVzID0ge307XG4gIGxldCB0YXNrcyA9IFtdO1xuICBsZXQgaGVhbHRoVGFibGUgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzbnMuc2VuZChuZXcgX2NsaWVudFNucy5MaXN0VG9waWNzQ29tbWFuZChwYXJhbXMpKTtcbiAgICBsZXQgdG9waWNzID0gZGF0YS5Ub3BpY3M7XG4gICAgaWYgKHRvcGljcy5sZW5ndGggIT09IDApIHtcbiAgICAgIGZvciAobGV0IHRvcGljIG9mIHRvcGljcykge1xuICAgICAgICB0YXNrcy5wdXNoKGFzeW5jIGRvbmUgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBwYXJhbXMyID0ge1xuICAgICAgICAgICAgICBOZXh0VG9rZW46IG51bGwsXG4gICAgICAgICAgICAgIFRvcGljQXJuOiB0b3BpYy5Ub3BpY0FyblxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzbnMuc2VuZChuZXcgX2NsaWVudFNucy5MaXN0U3Vic2NyaXB0aW9uc0J5VG9waWNDb21tYW5kKHBhcmFtczIpKTtcbiAgICAgICAgICAgIHN1YnNbdG9waWMuVG9waWNBcm5dID0gZGF0YS5TdWJzY3JpcHRpb25zO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgZG9uZShlcnIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHRhc2tzLnB1c2goYXN5bmMgZG9uZSA9PiB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHBhcmFtczIgPSB7XG4gICAgICAgICAgICAgIFRvcGljQXJuOiB0b3BpYy5Ub3BpY0FyblxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzbnMuc2VuZChuZXcgX2NsaWVudFNucy5HZXRUb3BpY0F0dHJpYnV0ZXNDb21tYW5kKHBhcmFtczIpKTtcbiAgICAgICAgICAgIHRvcGljQXR0cmlidXRlc1t0b3BpYy5Ub3BpY0Fybl0gPSB7XG4gICAgICAgICAgICAgIGRpc3BsYXlOYW1lOiBkYXRhLkF0dHJpYnV0ZXMuRGlzcGxheU5hbWUsXG4gICAgICAgICAgICAgIG93bmVyOiBkYXRhLkF0dHJpYnV0ZXMuT3duZXJcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBkb25lKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGFza3MucHVzaChhc3luYyBkb25lID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlkID0gJ2hlYWx0aFNOU19kYXRhJztcbiAgICAgICAgY29uc3QgcGFyYW1zID0ge1xuICAgICAgICAgIFRhYmxlTmFtZTogU0VUVElOR1NfVEFCTEUsXG4gICAgICAgICAgS2V5OiB7XG4gICAgICAgICAgICBpZDoge1xuICAgICAgICAgICAgICBTOiBpZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGR5bmFtb2RiLnNlbmQobmV3IF9jbGllbnREeW5hbW9kYi5HZXRJdGVtQ29tbWFuZChwYXJhbXMpKTtcbiAgICAgICAgaGVhbHRoVGFibGUgPSBkYXRhLkl0ZW0gPyBkYXRhLkl0ZW0udmFsdWUuUyA6IHt9O1xuICAgICAgICBkb25lKCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZG9uZShlcnIpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGF3YWl0IFByb21pc2UuYWxsKHRhc2tzKTtcbiAgICBmaW5hbERhdGFbXCJzdWJzXCJdID0gc3VicztcbiAgICBmaW5hbERhdGFbXCJ0b3BpY0F0dHJpYnV0ZXNcIl0gPSB0b3BpY0F0dHJpYnV0ZXM7XG4gICAgZmluYWxEYXRhW1widGFnc1wiXSA9IGhlYWx0aFRhYmxlO1xuICAgIGNhbGxiYWNrKG51bGwsIGZpbmFsRGF0YSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNhbGxiYWNrKGVycik7XG4gIH1cbn1cbmFzeW5jIGZ1bmN0aW9uIGRvUG9zdChldmVudCwgY29udGV4dCwgY2FsbGJhY2spIHtcbiAgbGV0IGNyZWF0ZUlkID0gcHJvY2Vzcy5lbnYuU3RhY2tOYW1lICsgJy0nICsgZXZlbnQucGFyYW1zLnBhdGguaWQ7XG4gIGxldCBpZCA9IGV2ZW50LnBhcmFtcy5wYXRoLmlkO1xuICBpZiAoZXZlbnQucGFyYW1zLnBhdGgudHlwZSA9PT0gJ3RvcGljJykge1xuICAgIGF3YWl0IF9sZW9BdXRoLmRlZmF1bHQuYXV0aG9yaXplKGV2ZW50LCB7XG4gICAgICBscm46IGBscm46bGVvOmJvdG1vbjo6OnNuc190b3BpYy97aWR9YCxcbiAgICAgIGFjdGlvbjogYGNyZWF0ZWAsXG4gICAgICBib3Rtb246IHtcbiAgICAgICAgXCJpZFwiOiBjcmVhdGVJZFxuICAgICAgfVxuICAgIH0pO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgc25zLnNlbmQobmV3IF9jbGllbnRTbnMuQ3JlYXRlVG9waWNDb21tYW5kKHtcbiAgICAgICAgTmFtZTogY3JlYXRlSWRcbiAgICAgIH0pKTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZXZlbnQucGFyYW1zLnBhdGgudHlwZSA9PT0gJ3N1YnNjcmlwdGlvbicpIHtcbiAgICBsZXQgc3Vic2NyaWJlID0gZXZlbnQuYm9keSAmJiBldmVudC5ib2R5LnN1YnNjcmliZTtcbiAgICBpZiAoc3Vic2NyaWJlID09PSB0cnVlKSB7XG4gICAgICBsZXQgcHJvdG9jb2wgPSBldmVudC5ib2R5ICYmIGV2ZW50LmJvZHkucHJvdG9jb2w7XG4gICAgICBsZXQgZW5kcG9pbnQgPSBldmVudC5ib2R5ICYmIGV2ZW50LmJvZHkuZW5kcG9pbnQ7XG4gICAgICBhd2FpdCBfbGVvQXV0aC5kZWZhdWx0LmF1dGhvcml6ZShldmVudCwge1xuICAgICAgICBscm46IGBscm46bGVvOmJvdG1vbjo6OnNuc19zdWJzY3JpcHRpb24ve3RvcGljfWAsXG4gICAgICAgIGFjdGlvbjogYHN1YnNjcmliZWAsXG4gICAgICAgIGJvdG1vbjoge1xuICAgICAgICAgIFwidG9waWNcIjogaWQsXG4gICAgICAgICAgXCJwcm90b2NvbFwiOiBwcm90b2NvbCxcbiAgICAgICAgICBcImVuZHBvaW50XCI6IGVuZHBvaW50XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNucy5zZW5kKG5ldyBfY2xpZW50U25zLlN1YnNjcmliZUNvbW1hbmQoe1xuICAgICAgICAgIEVuZHBvaW50OiBlbmRwb2ludCxcbiAgICAgICAgICBQcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICAgICAgVG9waWNBcm46IGlkXG4gICAgICAgIH0pKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IHVuU3ViID0gZXZlbnQuYm9keSAmJiBldmVudC5ib2R5LnVuU3ViO1xuICAgICAgYXdhaXQgX2xlb0F1dGguZGVmYXVsdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgICAgbHJuOiBgbHJuOmxlbzpib3Rtb246OjpzbnNfc3Vic2NyaXB0aW9uL3tzdWJzY3JpcHRpb259YCxcbiAgICAgICAgYWN0aW9uOiBgdW5zdWJzY3JpYmVgLFxuICAgICAgICBib3Rtb246IHtcbiAgICAgICAgICBcInN1YnNjcmlwdGlvblwiOiB1blN1YlxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzbnMuc2VuZChuZXcgX2NsaWVudFNucy5VbnN1YnNjcmliZUNvbW1hbmQoe1xuICAgICAgICAgIFN1YnNjcmlwdGlvbkFybjogdW5TdWJcbiAgICAgICAgfSkpO1xuICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChldmVudC5wYXJhbXMucGF0aC50eXBlID09PSAndGFncycpIHtcbiAgICBsZXQgYm9keSA9IGV2ZW50LmJvZHk7XG4gICAgYXdhaXQgX2xlb0F1dGguZGVmYXVsdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgIGxybjogYGxybjpsZW86Ym90bW9uOjo6c25zX3N1YnNjcmlwdGlvbi97dGFnc31gLFxuICAgICAgYWN0aW9uOiBgdXBkYXRlYCxcbiAgICAgIGJvdG1vbjoge1xuICAgICAgICBcInRhZ3NcIjogYm9keVxuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChib2R5LmRlbGV0ZSkge1xuICAgICAgT2JqZWN0LmtleXMoYm9keS50YWdzKS5mb3JFYWNoKHRhZyA9PiB7XG4gICAgICAgIGlmIChib2R5LnRhZ3NbdGFnXS5pbmNsdWRlcyhpZCkgJiYgIWJvZHkudGFnc1RvS2VlcC5pbmNsdWRlcyh0YWcpKSB7XG4gICAgICAgICAgYm9keS50YWdzW3RhZ10gPSBib2R5LnRhZ3NbdGFnXS5maWx0ZXIodCA9PiB0ICE9PSBpZCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZGVsZXRlIGJvZHkuZGVsZXRlO1xuICAgICAgZGVsZXRlIGJvZHkudGFnc1RvS2VlcDtcbiAgICAgIGlmICgnJyBpbiBib2R5LnRhZ3MpIHtcbiAgICAgICAgZGVsZXRlIGJvZHkudGFnc1snJ107XG4gICAgICB9XG4gICAgICBfbGVvU2RrLmRlZmF1bHQuYXdzLmR5bmFtb2RiLnNhdmVTZXR0aW5nKFwiaGVhbHRoU05TX2RhdGFcIiwge1xuICAgICAgICBsYXN0U05TOiBib2R5Lmxhc3RTTlMsXG4gICAgICAgIGJvdElkczogYm9keS5ib3RJZHMsXG4gICAgICAgIHRhZ3M6IGJvZHkudGFnc1xuICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnIsIGJvZHkudGFncyk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKCFib2R5LmRlbGV0ZSkge1xuICAgICAgaWYgKGJvZHkuYWRkZWRUYWcgaW4gYm9keS50YWdzKSB7XG4gICAgICAgIGJvZHkudGFnc1tib2R5LmFkZGVkVGFnXS5wdXNoKGlkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJvZHkudGFnc1tib2R5LmFkZGVkVGFnXSA9IFtpZF07XG4gICAgICB9XG4gICAgICBkZWxldGUgYm9keS5kZWxldGU7XG4gICAgICBkZWxldGUgYm9keS50YWdzVG9LZWVwO1xuICAgICAgaWYgKCcnIGluIGJvZHkudGFncykge1xuICAgICAgICBkZWxldGUgYm9keS50YWdzWycnXTtcbiAgICAgIH1cbiAgICAgIF9sZW9TZGsuZGVmYXVsdC5hd3MuZHluYW1vZGIuc2F2ZVNldHRpbmcoXCJoZWFsdGhTTlNfZGF0YVwiLCB7XG4gICAgICAgIGxhc3RTTlM6IGJvZHkubGFzdFNOUyxcbiAgICAgICAgYm90SWRzOiBib2R5LmJvdElkcyxcbiAgICAgICAgdGFnczogYm9keS50YWdzXG4gICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVyciwgYm9keS50YWdzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayhcIlVuc3VwcG9ydGVkXCIpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjYWxsYmFjayhcIlVuc3VwcG9ydGVkXCIpO1xuICB9XG59XG5cbn0se1wiQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiXCI6dW5kZWZpbmVkLFwiQGF3cy1zZGsvY2xpZW50LXNuc1wiOnVuZGVmaW5lZCxcIkBiYWJlbC9ydW50aW1lL2hlbHBlcnMvaW50ZXJvcFJlcXVpcmVEZWZhdWx0XCI6dW5kZWZpbmVkLFwiYXN5bmNcIjp1bmRlZmluZWQsXCJsZW8tYXV0aFwiOnVuZGVmaW5lZCxcImxlby1sb2dnZXJcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvY29uZmlndXJhdGlvblwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
