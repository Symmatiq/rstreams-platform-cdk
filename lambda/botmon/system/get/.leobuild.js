(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var SYSTEM_TABLE = leo.configuration.resources.LeoSystem;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var id = util.ref(event.params.path.id, "system").id;
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "getSystem",
    botmon: {}
  });
  dynamodb.get(SYSTEM_TABLE, id, function (err, data) {
    console.log(err, data);
    if (err) {
      callback(err);
    } else {
      if (!data) {
        data = {
          id: id
        };
      }
      if (!data.settings) {
        data.settings = {};
      }
      data.label = data.label || data.id;
      if (!('crons' in data)) {
        data.crons = [];
      }
      if (!('checksums' in data)) {
        data.checksums = [];
      }
      callback(null, util.fixSystemReferences(data));
    }
  });
});

},{"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIFNZU1RFTV9UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TeXN0ZW07XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIHZhciBpZCA9IHV0aWwucmVmKGV2ZW50LnBhcmFtcy5wYXRoLmlkLCBcInN5c3RlbVwiKS5pZDtcbiAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICBscm46ICdscm46bGVvOmJvdG1vbjo6OicsXG4gICAgYWN0aW9uOiBcImdldFN5c3RlbVwiLFxuICAgIGJvdG1vbjoge31cbiAgfSk7XG4gIGR5bmFtb2RiLmdldChTWVNURU1fVEFCTEUsIGlkLCBmdW5jdGlvbiAoZXJyLCBkYXRhKSB7XG4gICAgY29uc29sZS5sb2coZXJyLCBkYXRhKTtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBjYWxsYmFjayhlcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgZGF0YSA9IHtcbiAgICAgICAgICBpZDogaWRcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmICghZGF0YS5zZXR0aW5ncykge1xuICAgICAgICBkYXRhLnNldHRpbmdzID0ge307XG4gICAgICB9XG4gICAgICBkYXRhLmxhYmVsID0gZGF0YS5sYWJlbCB8fCBkYXRhLmlkO1xuICAgICAgaWYgKCEoJ2Nyb25zJyBpbiBkYXRhKSkge1xuICAgICAgICBkYXRhLmNyb25zID0gW107XG4gICAgICB9XG4gICAgICBpZiAoISgnY2hlY2tzdW1zJyBpbiBkYXRhKSkge1xuICAgICAgICBkYXRhLmNoZWNrc3VtcyA9IFtdO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2sobnVsbCwgdXRpbC5maXhTeXN0ZW1SZWZlcmVuY2VzKGRhdGEpKTtcbiAgICB9XG4gIH0pO1xufSk7XG5cbn0se1wibGVvLWF1dGhcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
