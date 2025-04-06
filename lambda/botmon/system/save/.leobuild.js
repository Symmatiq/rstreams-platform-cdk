(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var request = require("leo-auth");
var leo = require("leo-sdk");
var dynamodb = leo.aws.dynamodb;
var util = require("leo-sdk/lib/reference.js");
var uuid = require("uuid");
var extend = require("extend");
var SYSTEM_TABLE = leo.configuration.resources.LeoSystem;
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  var ref = util.ref(event.params.path.id || event.body.id, "system");
  var id = ref && ref.id;
  request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "saveSystem",
    botmon: {}
  });
  event.body.crons = event.body.crons || [];
  event.body.checksums = event.body.checksums || {};
  event.body.id = id;
  buildId(event.body, (err, id) => {
    update(SYSTEM_TABLE, id, event.body, function (err, data) {
      if (err) {
        callback(err);
      } else {
        callback(null, {
          id: util.refId(id, "system")
        });
      }
    });
  });
});
function update(table, id, obj, callback) {
  dynamodb.get(table, id, (err, data) => {
    if (err) {
      return callback(err);
    }
    var data = extend(true, data, obj);
    dynamodb.put(table, id, data, callback);
  });
}
function buildId(doc, done) {
  if (doc.id) {
    return done(null, doc.id);
  }
  var baseId = doc.label.replace(/[^A-z0-9]+/g, "_");
  var id = baseId;
  var tries = 1;
  var randomAt = 3;
  var uuidAt = 10;
  var get = () => {
    console.log("ID:", id);
    dynamodb.get(SYSTEM_TABLE, id, (err, data) => {
      if (!data) {
        return done(err, id);
      }
      tries++;
      id = baseId + `_${tries}`;
      if (tries > randomAt) {
        id = baseId + `_${("0000" + Math.round(Math.random() * 10000)).slice(-4)}`;
      }
      if (tries >= uuidAt) {
        done(null, uuid.v4());
      } else {
        get();
      }
    });
  };
  get();
}

},{"extend":undefined,"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined,"uuid":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKFwibGVvLWF1dGhcIik7XG52YXIgbGVvID0gcmVxdWlyZShcImxlby1zZGtcIik7XG52YXIgZHluYW1vZGIgPSBsZW8uYXdzLmR5bmFtb2RiO1xudmFyIHV0aWwgPSByZXF1aXJlKFwibGVvLXNkay9saWIvcmVmZXJlbmNlLmpzXCIpO1xudmFyIHV1aWQgPSByZXF1aXJlKFwidXVpZFwiKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKFwiZXh0ZW5kXCIpO1xudmFyIFNZU1RFTV9UQUJMRSA9IGxlby5jb25maWd1cmF0aW9uLnJlc291cmNlcy5MZW9TeXN0ZW07XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIHZhciByZWYgPSB1dGlsLnJlZihldmVudC5wYXJhbXMucGF0aC5pZCB8fCBldmVudC5ib2R5LmlkLCBcInN5c3RlbVwiKTtcbiAgdmFyIGlkID0gcmVmICYmIHJlZi5pZDtcbiAgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICBscm46ICdscm46bGVvOmJvdG1vbjo6OicsXG4gICAgYWN0aW9uOiBcInNhdmVTeXN0ZW1cIixcbiAgICBib3Rtb246IHt9XG4gIH0pO1xuICBldmVudC5ib2R5LmNyb25zID0gZXZlbnQuYm9keS5jcm9ucyB8fCBbXTtcbiAgZXZlbnQuYm9keS5jaGVja3N1bXMgPSBldmVudC5ib2R5LmNoZWNrc3VtcyB8fCB7fTtcbiAgZXZlbnQuYm9keS5pZCA9IGlkO1xuICBidWlsZElkKGV2ZW50LmJvZHksIChlcnIsIGlkKSA9PiB7XG4gICAgdXBkYXRlKFNZU1RFTV9UQUJMRSwgaWQsIGV2ZW50LmJvZHksIGZ1bmN0aW9uIChlcnIsIGRhdGEpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgICBpZDogdXRpbC5yZWZJZChpZCwgXCJzeXN0ZW1cIilcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufSk7XG5mdW5jdGlvbiB1cGRhdGUodGFibGUsIGlkLCBvYmosIGNhbGxiYWNrKSB7XG4gIGR5bmFtb2RiLmdldCh0YWJsZSwgaWQsIChlcnIsIGRhdGEpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgdmFyIGRhdGEgPSBleHRlbmQodHJ1ZSwgZGF0YSwgb2JqKTtcbiAgICBkeW5hbW9kYi5wdXQodGFibGUsIGlkLCBkYXRhLCBjYWxsYmFjayk7XG4gIH0pO1xufVxuZnVuY3Rpb24gYnVpbGRJZChkb2MsIGRvbmUpIHtcbiAgaWYgKGRvYy5pZCkge1xuICAgIHJldHVybiBkb25lKG51bGwsIGRvYy5pZCk7XG4gIH1cbiAgdmFyIGJhc2VJZCA9IGRvYy5sYWJlbC5yZXBsYWNlKC9bXkEtejAtOV0rL2csIFwiX1wiKTtcbiAgdmFyIGlkID0gYmFzZUlkO1xuICB2YXIgdHJpZXMgPSAxO1xuICB2YXIgcmFuZG9tQXQgPSAzO1xuICB2YXIgdXVpZEF0ID0gMTA7XG4gIHZhciBnZXQgPSAoKSA9PiB7XG4gICAgY29uc29sZS5sb2coXCJJRDpcIiwgaWQpO1xuICAgIGR5bmFtb2RiLmdldChTWVNURU1fVEFCTEUsIGlkLCAoZXJyLCBkYXRhKSA9PiB7XG4gICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGRvbmUoZXJyLCBpZCk7XG4gICAgICB9XG4gICAgICB0cmllcysrO1xuICAgICAgaWQgPSBiYXNlSWQgKyBgXyR7dHJpZXN9YDtcbiAgICAgIGlmICh0cmllcyA+IHJhbmRvbUF0KSB7XG4gICAgICAgIGlkID0gYmFzZUlkICsgYF8keyhcIjAwMDBcIiArIE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwMDAwKSkuc2xpY2UoLTQpfWA7XG4gICAgICB9XG4gICAgICBpZiAodHJpZXMgPj0gdXVpZEF0KSB7XG4gICAgICAgIGRvbmUobnVsbCwgdXVpZC52NCgpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGdldCgpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuICBnZXQoKTtcbn1cblxufSx7XCJleHRlbmRcIjp1bmRlZmluZWQsXCJsZW8tYXV0aFwiOnVuZGVmaW5lZCxcImxlby1zZGtcIjp1bmRlZmluZWQsXCJsZW8tc2RrL2xpYi9yZWZlcmVuY2UuanNcIjp1bmRlZmluZWQsXCJsZW8tc2RrL3dyYXBwZXJzL3Jlc291cmNlXCI6dW5kZWZpbmVkLFwidXVpZFwiOnVuZGVmaW5lZH1dfSx7fSxbMV0pKDEpXG59KTtcbiJdLCJmaWxlIjoiLmxlb2J1aWxkLmpzIn0=
