(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handler = void 0;
var _clientCloudformation = require("@aws-sdk/client-cloudformation");
var _request = _interopRequireDefault(require("leo-sdk/auth/request"));
var _leoConfigure = _interopRequireDefault(require("leo-sdk/leoConfigure"));
require("moment-round");
var _resource = require("leo-sdk/wrappers/resource");
const handler = exports.handler = (0, _resource.handler)(async (event, context, callback) => {
  await _request.default.authorize(event, {
    lrn: 'lrn:leo:botmon:::accessConfig',
    action: "get",
    botmon: {}
  });
  const cloudformation = new _clientCloudformation.CloudFormationClient({
    region: _leoConfigure.default._meta.region
  });
  try {
    const data = await cloudformation.send(new _clientCloudformation.ListStackResourcesCommand({
      StackName: _leoConfigure.default.stacks && _leoConfigure.default.stacks.Leo || "Leo"
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
      region: _leoConfigure.default.aws.region
    });
  } catch (err) {
    callback(err);
  }
});

},{"@aws-sdk/client-cloudformation":undefined,"@babel/runtime/helpers/interopRequireDefault":undefined,"leo-sdk/auth/request":undefined,"leo-sdk/leoConfigure":undefined,"leo-sdk/wrappers/resource":undefined,"moment-round":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4ndXNlIHN0cmljdCc7XG5cbnZhciBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0ID0gcmVxdWlyZShcIkBiYWJlbC9ydW50aW1lL2hlbHBlcnMvaW50ZXJvcFJlcXVpcmVEZWZhdWx0XCIpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7XG4gIHZhbHVlOiB0cnVlXG59KTtcbmV4cG9ydHMuaGFuZGxlciA9IHZvaWQgMDtcbnZhciBfY2xpZW50Q2xvdWRmb3JtYXRpb24gPSByZXF1aXJlKFwiQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uXCIpO1xudmFyIF9yZXF1ZXN0ID0gX2ludGVyb3BSZXF1aXJlRGVmYXVsdChyZXF1aXJlKFwibGVvLXNkay9hdXRoL3JlcXVlc3RcIikpO1xudmFyIF9sZW9Db25maWd1cmUgPSBfaW50ZXJvcFJlcXVpcmVEZWZhdWx0KHJlcXVpcmUoXCJsZW8tc2RrL2xlb0NvbmZpZ3VyZVwiKSk7XG5yZXF1aXJlKFwibW9tZW50LXJvdW5kXCIpO1xudmFyIF9yZXNvdXJjZSA9IHJlcXVpcmUoXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCIpO1xuY29uc3QgaGFuZGxlciA9IGV4cG9ydHMuaGFuZGxlciA9ICgwLCBfcmVzb3VyY2UuaGFuZGxlcikoYXN5bmMgKGV2ZW50LCBjb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICBhd2FpdCBfcmVxdWVzdC5kZWZhdWx0LmF1dGhvcml6ZShldmVudCwge1xuICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6YWNjZXNzQ29uZmlnJyxcbiAgICBhY3Rpb246IFwiZ2V0XCIsXG4gICAgYm90bW9uOiB7fVxuICB9KTtcbiAgY29uc3QgY2xvdWRmb3JtYXRpb24gPSBuZXcgX2NsaWVudENsb3VkZm9ybWF0aW9uLkNsb3VkRm9ybWF0aW9uQ2xpZW50KHtcbiAgICByZWdpb246IF9sZW9Db25maWd1cmUuZGVmYXVsdC5fbWV0YS5yZWdpb25cbiAgfSk7XG4gIHRyeSB7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IGNsb3VkZm9ybWF0aW9uLnNlbmQobmV3IF9jbGllbnRDbG91ZGZvcm1hdGlvbi5MaXN0U3RhY2tSZXNvdXJjZXNDb21tYW5kKHtcbiAgICAgIFN0YWNrTmFtZTogX2xlb0NvbmZpZ3VyZS5kZWZhdWx0LnN0YWNrcyAmJiBfbGVvQ29uZmlndXJlLmRlZmF1bHQuc3RhY2tzLkxlbyB8fCBcIkxlb1wiXG4gICAgfSkpO1xuICAgIGlmIChkYXRhLk5leHRUb2tlbikge1xuICAgICAgY29uc29sZS5sb2coXCJXZSBuZWVkIHRvIGRlYWwgd2l0aCBuZXh0IHRva2VuXCIpO1xuICAgIH1cbiAgICBjb25zdCByZXNvdXJjZXMgPSBkYXRhLlN0YWNrUmVzb3VyY2VTdW1tYXJpZXMucmVkdWNlKChhY2MsIHJlc291cmNlKSA9PiB7XG4gICAgICBhY2NbcmVzb3VyY2UuTG9naWNhbFJlc291cmNlSWRdID0ge1xuICAgICAgICB0eXBlOiByZXNvdXJjZS5SZXNvdXJjZVR5cGUsXG4gICAgICAgIGlkOiByZXNvdXJjZS5QaHlzaWNhbFJlc291cmNlSWQsXG4gICAgICAgIG5hbWU6IHJlc291cmNlLkxvZ2ljYWxSZXNvdXJjZUlkXG4gICAgICB9O1xuICAgICAgcmV0dXJuIGFjYztcbiAgICB9LCB7fSk7XG4gICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAga2luZXNpczogcmVzb3VyY2VzLktpbmVzaXNTdHJlYW0uaWQsXG4gICAgICBzMzogcmVzb3VyY2VzLlMzQnVzLmlkLFxuICAgICAgZmlyZWhvc2U6IHJlc291cmNlcy5GaXJlaG9zZVN0cmVhbS5pZCxcbiAgICAgIHJlZ2lvbjogX2xlb0NvbmZpZ3VyZS5kZWZhdWx0LmF3cy5yZWdpb25cbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY2FsbGJhY2soZXJyKTtcbiAgfVxufSk7XG5cbn0se1wiQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uXCI6dW5kZWZpbmVkLFwiQGJhYmVsL3J1bnRpbWUvaGVscGVycy9pbnRlcm9wUmVxdWlyZURlZmF1bHRcIjp1bmRlZmluZWQsXCJsZW8tc2RrL2F1dGgvcmVxdWVzdFwiOnVuZGVmaW5lZCxcImxlby1zZGsvbGVvQ29uZmlndXJlXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZCxcIm1vbWVudC1yb3VuZFwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
