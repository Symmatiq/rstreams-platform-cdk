(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var moment = require("moment");
var uuid = require("uuid");
var EVENT_TABLE = leo.configuration.resources.LeoEvent;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var body = event.body;
  var ref = util.ref(body.id || body.event || uuid.v4(), "queue");
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::eventsettings/{id}',
    action: "saveEventSettings",
    botmon: {
      id: ref.id
    }
  });
  var doc = Object.assign({}, body);
  save(ref, doc, callback);
});
function save(ref, doc, callback) {
  var sets = [];
  var names = {};
  var attributes = {};

  // Fields not allowed to update
  delete doc.event; // Part of the key
  delete doc.id; // this is an alias for event send from the frontend, doesn't need to be saved
  delete doc.kinesis_number;
  delete doc.initial_kinesis_number;
  delete doc.s3_kinesis_number;
  delete doc.s3_new_kinesis_number;
  delete doc.archive_kinesis_number;
  for (var k in doc) {
    if (doc[k] !== undefined && doc[k] !== "") {
      var fieldName = k.replace(/[^a-z]+/ig, "_");
      sets.push(`#${fieldName} = :${fieldName}`);
      names[`#${fieldName}`] = k;
      attributes[`:${fieldName}`] = doc[k];
    }
  }
  var params = {
    TableName: EVENT_TABLE,
    Key: {
      event: ref.id
    },
    UpdateExpression: 'set ' + sets.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: attributes,
    "ReturnConsumedCapacity": 'TOTAL',
    ReturnValues: 'ALL_NEW'
  };
  console.log(JSON.stringify(params, null, 2));
  dynamodb.update(params, function (err, result) {
    if (err) {
      callback(err);
    } else {
      callback(null, {
        refId: ref.toString()
      });
    }
  });
}

},{"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined,"moment":undefined,"uuid":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIG1vbWVudCA9IHJlcXVpcmUoXCJtb21lbnRcIik7XG52YXIgdXVpZCA9IHJlcXVpcmUoXCJ1dWlkXCIpO1xudmFyIEVWRU5UX1RBQkxFID0gbGVvLmNvbmZpZ3VyYXRpb24ucmVzb3VyY2VzLkxlb0V2ZW50O1xuZXhwb3J0cy5oYW5kbGVyID0gcmVxdWlyZShcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIikoYXN5bmMgKGV2ZW50LCBjb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICB2YXIgYm9keSA9IGV2ZW50LmJvZHk7XG4gIHZhciByZWYgPSB1dGlsLnJlZihib2R5LmlkIHx8IGJvZHkuZXZlbnQgfHwgdXVpZC52NCgpLCBcInF1ZXVlXCIpO1xuICBhd2FpdCByZXF1ZXN0LmF1dGhvcml6ZShldmVudCwge1xuICAgIGxybjogJ2xybjpsZW86Ym90bW9uOjo6ZXZlbnRzZXR0aW5ncy97aWR9JyxcbiAgICBhY3Rpb246IFwic2F2ZUV2ZW50U2V0dGluZ3NcIixcbiAgICBib3Rtb246IHtcbiAgICAgIGlkOiByZWYuaWRcbiAgICB9XG4gIH0pO1xuICB2YXIgZG9jID0gT2JqZWN0LmFzc2lnbih7fSwgYm9keSk7XG4gIHNhdmUocmVmLCBkb2MsIGNhbGxiYWNrKTtcbn0pO1xuZnVuY3Rpb24gc2F2ZShyZWYsIGRvYywgY2FsbGJhY2spIHtcbiAgdmFyIHNldHMgPSBbXTtcbiAgdmFyIG5hbWVzID0ge307XG4gIHZhciBhdHRyaWJ1dGVzID0ge307XG5cbiAgLy8gRmllbGRzIG5vdCBhbGxvd2VkIHRvIHVwZGF0ZVxuICBkZWxldGUgZG9jLmV2ZW50OyAvLyBQYXJ0IG9mIHRoZSBrZXlcbiAgZGVsZXRlIGRvYy5pZDsgLy8gdGhpcyBpcyBhbiBhbGlhcyBmb3IgZXZlbnQgc2VuZCBmcm9tIHRoZSBmcm9udGVuZCwgZG9lc24ndCBuZWVkIHRvIGJlIHNhdmVkXG4gIGRlbGV0ZSBkb2Mua2luZXNpc19udW1iZXI7XG4gIGRlbGV0ZSBkb2MuaW5pdGlhbF9raW5lc2lzX251bWJlcjtcbiAgZGVsZXRlIGRvYy5zM19raW5lc2lzX251bWJlcjtcbiAgZGVsZXRlIGRvYy5zM19uZXdfa2luZXNpc19udW1iZXI7XG4gIGRlbGV0ZSBkb2MuYXJjaGl2ZV9raW5lc2lzX251bWJlcjtcbiAgZm9yICh2YXIgayBpbiBkb2MpIHtcbiAgICBpZiAoZG9jW2tdICE9PSB1bmRlZmluZWQgJiYgZG9jW2tdICE9PSBcIlwiKSB7XG4gICAgICB2YXIgZmllbGROYW1lID0gay5yZXBsYWNlKC9bXmEtel0rL2lnLCBcIl9cIik7XG4gICAgICBzZXRzLnB1c2goYCMke2ZpZWxkTmFtZX0gPSA6JHtmaWVsZE5hbWV9YCk7XG4gICAgICBuYW1lc1tgIyR7ZmllbGROYW1lfWBdID0gaztcbiAgICAgIGF0dHJpYnV0ZXNbYDoke2ZpZWxkTmFtZX1gXSA9IGRvY1trXTtcbiAgICB9XG4gIH1cbiAgdmFyIHBhcmFtcyA9IHtcbiAgICBUYWJsZU5hbWU6IEVWRU5UX1RBQkxFLFxuICAgIEtleToge1xuICAgICAgZXZlbnQ6IHJlZi5pZFxuICAgIH0sXG4gICAgVXBkYXRlRXhwcmVzc2lvbjogJ3NldCAnICsgc2V0cy5qb2luKFwiLCBcIiksXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiBuYW1lcyxcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBhdHRyaWJ1dGVzLFxuICAgIFwiUmV0dXJuQ29uc3VtZWRDYXBhY2l0eVwiOiAnVE9UQUwnLFxuICAgIFJldHVyblZhbHVlczogJ0FMTF9ORVcnXG4gIH07XG4gIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHBhcmFtcywgbnVsbCwgMikpO1xuICBkeW5hbW9kYi51cGRhdGUocGFyYW1zLCBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBjYWxsYmFjayhlcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgIHJlZklkOiByZWYudG9TdHJpbmcoKVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbn1cblxufSx7XCJsZW8tYXV0aFwiOnVuZGVmaW5lZCxcImxlby1zZGtcIjp1bmRlZmluZWQsXCJsZW8tc2RrL2xpYi9yZWZlcmVuY2UuanNcIjp1bmRlZmluZWQsXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCI6dW5kZWZpbmVkLFwibW9tZW50XCI6dW5kZWZpbmVkLFwidXVpZFwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
