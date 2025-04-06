(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var SETTINGS_TABLE = leo.configuration.resources.LeoSettings;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "settings",
    botmon: {}
  });
  dynamodb.batchGetHashkey(SETTINGS_TABLE, "id", ["lambda_templates", "botmon_files"], function (err, data) {
    if (err) {
      callback(err);
    } else {
      var ret = {};
      for (var key in data) {
        ret[key.replace(/^botmon_/, '')] = data[key].value;
      }
      if (ret.lambda_templates) {
        for (var key in ret.lambda_templates) {
          if (ret.lambda_templates[key].matches && !ret.lambda_templates[key].matches.group) {
            ret.lambda_templates[key].matches.group = 'bot';
          }
        }
      }
      callback(null, ret);
    }
  });
});

},{"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIFNFVFRJTkdTX1RBQkxFID0gbGVvLmNvbmZpZ3VyYXRpb24ucmVzb3VyY2VzLkxlb1NldHRpbmdzO1xuZXhwb3J0cy5oYW5kbGVyID0gcmVxdWlyZShcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIikoYXN5bmMgKGV2ZW50LCBjb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICBhd2FpdCByZXF1ZXN0LmF1dGhvcml6ZShldmVudCwge1xuICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6JyxcbiAgICBhY3Rpb246IFwic2V0dGluZ3NcIixcbiAgICBib3Rtb246IHt9XG4gIH0pO1xuICBkeW5hbW9kYi5iYXRjaEdldEhhc2hrZXkoU0VUVElOR1NfVEFCTEUsIFwiaWRcIiwgW1wibGFtYmRhX3RlbXBsYXRlc1wiLCBcImJvdG1vbl9maWxlc1wiXSwgZnVuY3Rpb24gKGVyciwgZGF0YSkge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciByZXQgPSB7fTtcbiAgICAgIGZvciAodmFyIGtleSBpbiBkYXRhKSB7XG4gICAgICAgIHJldFtrZXkucmVwbGFjZSgvXmJvdG1vbl8vLCAnJyldID0gZGF0YVtrZXldLnZhbHVlO1xuICAgICAgfVxuICAgICAgaWYgKHJldC5sYW1iZGFfdGVtcGxhdGVzKSB7XG4gICAgICAgIGZvciAodmFyIGtleSBpbiByZXQubGFtYmRhX3RlbXBsYXRlcykge1xuICAgICAgICAgIGlmIChyZXQubGFtYmRhX3RlbXBsYXRlc1trZXldLm1hdGNoZXMgJiYgIXJldC5sYW1iZGFfdGVtcGxhdGVzW2tleV0ubWF0Y2hlcy5ncm91cCkge1xuICAgICAgICAgICAgcmV0LmxhbWJkYV90ZW1wbGF0ZXNba2V5XS5tYXRjaGVzLmdyb3VwID0gJ2JvdCc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgIH1cbiAgfSk7XG59KTtcblxufSx7XCJsZW8tYXV0aFwiOnVuZGVmaW5lZCxcImxlby1zZGtcIjp1bmRlZmluZWQsXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCI6dW5kZWZpbmVkfV19LHt9LFsxXSkoMSlcbn0pO1xuIl0sImZpbGUiOiIubGVvYnVpbGQuanMifQ==
