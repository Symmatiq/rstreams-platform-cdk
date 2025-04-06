(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

let request = require("leo-auth");
let leo = require("leo-sdk");
let ls = leo.streams;
let util = require("leo-sdk/lib/reference.js");
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  let queue = util.ref(event.params.path.queue).asQueue(event.params.path.subqueue).id;
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "getSchema"
  });
  let response = {};
  let error;
  try {
    let data = await leo.aws.s3.getObject({
      Bucket: leo.configuration.resources.LeoS3,
      Key: `files/bus_internal/queue_schemas/${queue}.json`
    });
    response = JSON.parse(data.Body.toString());
  } catch (err) {
    // if (err.code !== "NoSuchKey") {
    // 	error = new Error(`Unable to get schema for: ${queue}`);
    // }
    error = null;
  }
  callback(error, response);
});

},{"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxubGV0IHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG5sZXQgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG5sZXQgbHMgPSBsZW8uc3RyZWFtcztcbmxldCB1dGlsID0gcmVxdWlyZShcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiKTtcbmV4cG9ydHMuaGFuZGxlciA9IHJlcXVpcmUoXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCIpKGFzeW5jIChldmVudCwgY29udGV4dCwgY2FsbGJhY2spID0+IHtcbiAgbGV0IHF1ZXVlID0gdXRpbC5yZWYoZXZlbnQucGFyYW1zLnBhdGgucXVldWUpLmFzUXVldWUoZXZlbnQucGFyYW1zLnBhdGguc3VicXVldWUpLmlkO1xuICBhd2FpdCByZXF1ZXN0LmF1dGhvcml6ZShldmVudCwge1xuICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6JyxcbiAgICBhY3Rpb246IFwiZ2V0U2NoZW1hXCJcbiAgfSk7XG4gIGxldCByZXNwb25zZSA9IHt9O1xuICBsZXQgZXJyb3I7XG4gIHRyeSB7XG4gICAgbGV0IGRhdGEgPSBhd2FpdCBsZW8uYXdzLnMzLmdldE9iamVjdCh7XG4gICAgICBCdWNrZXQ6IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TMyxcbiAgICAgIEtleTogYGZpbGVzL2J1c19pbnRlcm5hbC9xdWV1ZV9zY2hlbWFzLyR7cXVldWV9Lmpzb25gXG4gICAgfSk7XG4gICAgcmVzcG9uc2UgPSBKU09OLnBhcnNlKGRhdGEuQm9keS50b1N0cmluZygpKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gaWYgKGVyci5jb2RlICE9PSBcIk5vU3VjaEtleVwiKSB7XG4gICAgLy8gXHRlcnJvciA9IG5ldyBFcnJvcihgVW5hYmxlIHRvIGdldCBzY2hlbWEgZm9yOiAke3F1ZXVlfWApO1xuICAgIC8vIH1cbiAgICBlcnJvciA9IG51bGw7XG4gIH1cbiAgY2FsbGJhY2soZXJyb3IsIHJlc3BvbnNlKTtcbn0pO1xuXG59LHtcImxlby1hdXRoXCI6dW5kZWZpbmVkLFwibGVvLXNka1wiOnVuZGVmaW5lZCxcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiOnVuZGVmaW5lZCxcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
