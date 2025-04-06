(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
let async = require("async");
var CRON_TABLE = leo.configuration.resources.LeoCron;
var SETTINGS_TABLE = leo.configuration.resources.LeoSettings;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var ref = util.ref(event?.params?.path?.id, "bot");
  dynamodb.batchGetHashkey(SETTINGS_TABLE, "id", ["lambda_templates", "botmon_files"], async function (err, settings) {
    if (err) {
      callback(err);
      return;
    }
    if (ref) {
      var id = ref.id;
      await request.authorize(event, {
        lrn: 'lrn:leo:botmon:::cron/{id}',
        action: "getCron",
        core: {
          id: id
        }
      });
      get(id, (err, data) => {
        if (data && !data.templateId) {
          data.templateId = "Leo_core_custom_lambda_bot";
        }
        if (data && settings.lambda_templates && Object.keys(settings.lambda_templates.value).indexOf(data.lambdaName) !== -1) {
          data.isTemplated = true;
        } else if (!!data) {
          data.isTemplated = false;
        }
        callback(err, data);
      });
    } else {
      await request.authorize(event, {
        lrn: 'lrn:leo:botmon:::cron',
        action: "listCron"
      });
      if (event.body && event.body.ids) {
        async.parallelLimit(event.body.ids.map(id => {
          return done => {
            get(util.botRef(id).id, done);
          };
        }), 5, (err, results) => {
          callback(err, results);
        });
      } else {
        scan(callback);
      }
    }
  });
});
function scan(callback) {
  dynamodb.query({
    TableName: CRON_TABLE
  }, {
    method: "scan"
  }).then(function (data) {
    callback(null, data.Items.map(i => util.fixBotReferences(i)));
  }).catch(callback);
}
function get(id, callback) {
  dynamodb.get(CRON_TABLE, id, (err, item) => {
    if (err) {
      callback(err);
    } else {
      callback(null, util.fixBotReferences(item));
    }
  });
}

},{"async":undefined,"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xubGV0IGFzeW5jID0gcmVxdWlyZShcImFzeW5jXCIpO1xudmFyIENST05fVEFCTEUgPSBsZW8uY29uZmlndXJhdGlvbi5yZXNvdXJjZXMuTGVvQ3JvbjtcbnZhciBTRVRUSU5HU19UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TZXR0aW5ncztcbmV4cG9ydHMuaGFuZGxlciA9IHJlcXVpcmUoXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCIpKGFzeW5jIChldmVudCwgY29udGV4dCwgY2FsbGJhY2spID0+IHtcbiAgdmFyIHJlZiA9IHV0aWwucmVmKGV2ZW50Py5wYXJhbXM/LnBhdGg/LmlkLCBcImJvdFwiKTtcbiAgZHluYW1vZGIuYmF0Y2hHZXRIYXNoa2V5KFNFVFRJTkdTX1RBQkxFLCBcImlkXCIsIFtcImxhbWJkYV90ZW1wbGF0ZXNcIiwgXCJib3Rtb25fZmlsZXNcIl0sIGFzeW5jIGZ1bmN0aW9uIChlcnIsIHNldHRpbmdzKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHJlZikge1xuICAgICAgdmFyIGlkID0gcmVmLmlkO1xuICAgICAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgICAgbHJuOiAnbHJuOmxlbzpib3Rtb246Ojpjcm9uL3tpZH0nLFxuICAgICAgICBhY3Rpb246IFwiZ2V0Q3JvblwiLFxuICAgICAgICBjb3JlOiB7XG4gICAgICAgICAgaWQ6IGlkXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZ2V0KGlkLCAoZXJyLCBkYXRhKSA9PiB7XG4gICAgICAgIGlmIChkYXRhICYmICFkYXRhLnRlbXBsYXRlSWQpIHtcbiAgICAgICAgICBkYXRhLnRlbXBsYXRlSWQgPSBcIkxlb19jb3JlX2N1c3RvbV9sYW1iZGFfYm90XCI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRhdGEgJiYgc2V0dGluZ3MubGFtYmRhX3RlbXBsYXRlcyAmJiBPYmplY3Qua2V5cyhzZXR0aW5ncy5sYW1iZGFfdGVtcGxhdGVzLnZhbHVlKS5pbmRleE9mKGRhdGEubGFtYmRhTmFtZSkgIT09IC0xKSB7XG4gICAgICAgICAgZGF0YS5pc1RlbXBsYXRlZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAoISFkYXRhKSB7XG4gICAgICAgICAgZGF0YS5pc1RlbXBsYXRlZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKGVyciwgZGF0YSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICAgICAgbHJuOiAnbHJuOmxlbzpib3Rtb246Ojpjcm9uJyxcbiAgICAgICAgYWN0aW9uOiBcImxpc3RDcm9uXCJcbiAgICAgIH0pO1xuICAgICAgaWYgKGV2ZW50LmJvZHkgJiYgZXZlbnQuYm9keS5pZHMpIHtcbiAgICAgICAgYXN5bmMucGFyYWxsZWxMaW1pdChldmVudC5ib2R5Lmlkcy5tYXAoaWQgPT4ge1xuICAgICAgICAgIHJldHVybiBkb25lID0+IHtcbiAgICAgICAgICAgIGdldCh1dGlsLmJvdFJlZihpZCkuaWQsIGRvbmUpO1xuICAgICAgICAgIH07XG4gICAgICAgIH0pLCA1LCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyLCByZXN1bHRzKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzY2FuKGNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufSk7XG5mdW5jdGlvbiBzY2FuKGNhbGxiYWNrKSB7XG4gIGR5bmFtb2RiLnF1ZXJ5KHtcbiAgICBUYWJsZU5hbWU6IENST05fVEFCTEVcbiAgfSwge1xuICAgIG1ldGhvZDogXCJzY2FuXCJcbiAgfSkudGhlbihmdW5jdGlvbiAoZGF0YSkge1xuICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuSXRlbXMubWFwKGkgPT4gdXRpbC5maXhCb3RSZWZlcmVuY2VzKGkpKSk7XG4gIH0pLmNhdGNoKGNhbGxiYWNrKTtcbn1cbmZ1bmN0aW9uIGdldChpZCwgY2FsbGJhY2spIHtcbiAgZHluYW1vZGIuZ2V0KENST05fVEFCTEUsIGlkLCAoZXJyLCBpdGVtKSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGJhY2sobnVsbCwgdXRpbC5maXhCb3RSZWZlcmVuY2VzKGl0ZW0pKTtcbiAgICB9XG4gIH0pO1xufVxuXG59LHtcImFzeW5jXCI6dW5kZWZpbmVkLFwibGVvLWF1dGhcIjp1bmRlZmluZWQsXCJsZW8tc2RrXCI6dW5kZWZpbmVkLFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCI6dW5kZWZpbmVkLFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
