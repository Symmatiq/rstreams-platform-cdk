(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var TABLE = leo.configuration.resources.LeoEvent;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var ref = util.ref(event.params.path.event, "queue");
  if (ref) {
    var id = ref.id;
    await request.authorize(event, {
      lrn: 'lrn:leo:botmon:::eventsettings/{id}',
      action: "getEventSettings",
      botmon: {
        id: id
      }
    });
    get(id, callback);
  } else {
    await request.authorize(event, {
      lrn: 'lrn:leo:botmon:::eventsettings',
      action: "listEventSettings"
    });
    scan(callback);
  }
});
function scan(callback) {
  dynamodb.query({
    TableName: TABLE
  }, {
    method: "scan"
  }).then(function (data) {
    callback(null, data.Items.map(fixQueue));
  }).fail(callback).done();
}
function get(id, callback) {
  dynamodb.get(TABLE, id, {
    id: "event"
  }, (err, queue) => {
    if (err) {
      callback(err, queue);
    } else {
      callback(null, fixQueue(queue || {
        event: id
      }, id));
    }
  });
}
function fixQueue(queue) {
  var ref = util.ref(queue.event);
  queue.event = ref.refId();
  queue.name = queue.name || ref.id;
  return queue;
}

},{"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIFRBQkxFID0gbGVvLmNvbmZpZ3VyYXRpb24ucmVzb3VyY2VzLkxlb0V2ZW50O1xuZXhwb3J0cy5oYW5kbGVyID0gcmVxdWlyZShcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIikoYXN5bmMgKGV2ZW50LCBjb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICB2YXIgcmVmID0gdXRpbC5yZWYoZXZlbnQucGFyYW1zLnBhdGguZXZlbnQsIFwicXVldWVcIik7XG4gIGlmIChyZWYpIHtcbiAgICB2YXIgaWQgPSByZWYuaWQ7XG4gICAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6ZXZlbnRzZXR0aW5ncy97aWR9JyxcbiAgICAgIGFjdGlvbjogXCJnZXRFdmVudFNldHRpbmdzXCIsXG4gICAgICBib3Rtb246IHtcbiAgICAgICAgaWQ6IGlkXG4gICAgICB9XG4gICAgfSk7XG4gICAgZ2V0KGlkLCBjYWxsYmFjayk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6ZXZlbnRzZXR0aW5ncycsXG4gICAgICBhY3Rpb246IFwibGlzdEV2ZW50U2V0dGluZ3NcIlxuICAgIH0pO1xuICAgIHNjYW4oY2FsbGJhY2spO1xuICB9XG59KTtcbmZ1bmN0aW9uIHNjYW4oY2FsbGJhY2spIHtcbiAgZHluYW1vZGIucXVlcnkoe1xuICAgIFRhYmxlTmFtZTogVEFCTEVcbiAgfSwge1xuICAgIG1ldGhvZDogXCJzY2FuXCJcbiAgfSkudGhlbihmdW5jdGlvbiAoZGF0YSkge1xuICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuSXRlbXMubWFwKGZpeFF1ZXVlKSk7XG4gIH0pLmZhaWwoY2FsbGJhY2spLmRvbmUoKTtcbn1cbmZ1bmN0aW9uIGdldChpZCwgY2FsbGJhY2spIHtcbiAgZHluYW1vZGIuZ2V0KFRBQkxFLCBpZCwge1xuICAgIGlkOiBcImV2ZW50XCJcbiAgfSwgKGVyciwgcXVldWUpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGJhY2sobnVsbCwgZml4UXVldWUocXVldWUgfHwge1xuICAgICAgICBldmVudDogaWRcbiAgICAgIH0sIGlkKSk7XG4gICAgfVxuICB9KTtcbn1cbmZ1bmN0aW9uIGZpeFF1ZXVlKHF1ZXVlKSB7XG4gIHZhciByZWYgPSB1dGlsLnJlZihxdWV1ZS5ldmVudCk7XG4gIHF1ZXVlLmV2ZW50ID0gcmVmLnJlZklkKCk7XG4gIHF1ZXVlLm5hbWUgPSBxdWV1ZS5uYW1lIHx8IHJlZi5pZDtcbiAgcmV0dXJuIHF1ZXVlO1xufVxuXG59LHtcImxlby1hdXRoXCI6dW5kZWZpbmVkLFwibGVvLXNka1wiOnVuZGVmaW5lZCxcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiOnVuZGVmaW5lZCxcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
