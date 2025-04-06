(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var CRON_TABLE = leo.configuration.resources.LeoCron;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  let botId = util.botRef(event.body && event.body.id).id;
  let set = {};
  if (Object.keys(event.body).length !== 0) {
    set = event.body.health;
  }
  dynamodb.merge(CRON_TABLE, botId, {
    health: set
  }, (err, data) => {
    if (err) {
      callback(err);
    } else {
      callback(null, data);
    }
  });
});

},{"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIGxlbyA9IHJlcXVpcmUoXCJsZW8tc2RrXCIpO1xudmFyIGR5bmFtb2RiID0gbGVvLmF3cy5keW5hbW9kYjtcbnZhciB1dGlsID0gcmVxdWlyZShcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiKTtcbnZhciBDUk9OX1RBQkxFID0gbGVvLmNvbmZpZ3VyYXRpb24ucmVzb3VyY2VzLkxlb0Nyb247XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIGxldCBib3RJZCA9IHV0aWwuYm90UmVmKGV2ZW50LmJvZHkgJiYgZXZlbnQuYm9keS5pZCkuaWQ7XG4gIGxldCBzZXQgPSB7fTtcbiAgaWYgKE9iamVjdC5rZXlzKGV2ZW50LmJvZHkpLmxlbmd0aCAhPT0gMCkge1xuICAgIHNldCA9IGV2ZW50LmJvZHkuaGVhbHRoO1xuICB9XG4gIGR5bmFtb2RiLm1lcmdlKENST05fVEFCTEUsIGJvdElkLCB7XG4gICAgaGVhbHRoOiBzZXRcbiAgfSwgKGVyciwgZGF0YSkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgIH1cbiAgfSk7XG59KTtcblxufSx7XCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
