(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lambda = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (Buffer){(function (){
"use strict";

let request = require("leo-auth");
let leo = require("leo-sdk");
let ls = leo.streams;
let util = require("leo-sdk/lib/reference.js");
exports.handler = require("leo-sdk/wrappers/resource")(async (event, context, callback) => {
  let customFilter = function ($, $$) {
    return true;
  };
  let index = event.params.path.query && event.params.path.query.match(/[(!]*\$\$?\./);
  if (index) {
    let filterEx = event.params.path.query.substring(index.index);
    try {
      let global = {};
      let g = global;
      let process;
      let require;
      let fs;
      let leo;
      let ls;
      let request;
      let util;
      let context;
      let callback;
      let event;
      customFilter = eval(`(function($,$$,$$$){
        		try{
        			return ${filterEx.replace(/=+/g, "==").replace(/==>/g, "=>").replace(/<==/g, "<=").replace(/>==/g, ">=").replace(/!==/g, "!=").replace(/\+==/g, "+=").replace(/-==/g, "-=").replace(/:==/g, "=")};	
        		}catch(e){
        			return false;
        		}
        	})`);
    } catch (e) {
      customFilter = function () {
        return false;
      };
      return callback('invalid filter expression');
    }
    event.params.path.query = event.params.path.query.substring(0, index.index).trim();
  }
  var queue = util.ref(event.params.path.queue).asQueue(event.params.path.subqueue).id;
  if (event.params.path.query) {
    var query = new RegExp(event.params.path.query, 'i');
  } else {
    var query = null;
  }
  var start = event.params.path.start;
  var requestedCount = event.params.querystring.count || 40;
  var debug = event.params.querystring.debug || false;
  await request.authorize(event, {
    lrn: 'lrn:leo:botmon:::',
    action: "searchQueue"
  });
  var response = {
    results: [],
    resumptionToken: null,
    last_time: null,
    count: 0,
    agg: event.params.querystring.agg ? JSON.parse(event.params.querystring.agg) : {}
  };
  let filter = function ($, $$, $$$) {
    return (query === null || JSON.stringify($$).match(query)) && customFilter($, $$, $$$);
  };
  var readable = ls.fromLeo("test", queue, {
    start: start,
    debug: debug,
    getEventsV1: leo.getEvents,
    stopTime: Date.now() + context.getRemainingTimeInMillis() * 0.8,
    fast_s3_read: true
  });
  let exiting = false;
  var fullTimeout = setTimeout(function () {
    readable.destroy();
    exiting = true;
  }, 10000);
  var timeout;
  let size = 0;
  readable.pipe(ls.write((obj, done) => {
    if (exiting) {
      return done();
    }
    response.resumptionToken = obj.eid;
    response.last_time = obj.timestamp;
    response.count++;
    if (filter(obj.payload, obj, response.agg)) {
      response.results.push(Object.assign({}, obj));
      size += obj.size || Buffer.byteLength(JSON.stringify(obj));
      if (!timeout) {
        timeout = setTimeout(function () {
          readable.destroy();
          exiting = true;
        }, 1000);
      }
      if (response.results.length >= requestedCount || size >= 1024 * 1024 * 4) {
        readable.destroy();
        exiting = true;
      }
    }
    done();
  })).on("finish", () => {
    clearTimeout(fullTimeout);
    clearTimeout(timeout);
    callback(null, response);
  });
});

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":undefined,"leo-auth":undefined,"leo-sdk":undefined,"leo-sdk/lib/reference.js":undefined,"leo-sdk/wrappers/resource":undefined}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyIubGVvYnVpbGQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcubGFtYmRhID0gZigpfX0pKGZ1bmN0aW9uKCl7dmFyIGRlZmluZSxtb2R1bGUsZXhwb3J0cztyZXR1cm4gKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSh7MTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4oZnVuY3Rpb24gKEJ1ZmZlcil7KGZ1bmN0aW9uICgpe1xuXCJ1c2Ugc3RyaWN0XCI7XG5cbmxldCByZXF1ZXN0ID0gcmVxdWlyZShcImxlby1hdXRoXCIpO1xubGV0IGxlbyA9IHJlcXVpcmUoXCJsZW8tc2RrXCIpO1xubGV0IGxzID0gbGVvLnN0cmVhbXM7XG5sZXQgdXRpbCA9IHJlcXVpcmUoXCJsZW8tc2RrL2xpYi9yZWZlcmVuY2UuanNcIik7XG5leHBvcnRzLmhhbmRsZXIgPSByZXF1aXJlKFwibGVvLXNkay93cmFwcGVycy9yZXNvdXJjZVwiKShhc3luYyAoZXZlbnQsIGNvbnRleHQsIGNhbGxiYWNrKSA9PiB7XG4gIGxldCBjdXN0b21GaWx0ZXIgPSBmdW5jdGlvbiAoJCwgJCQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcbiAgbGV0IGluZGV4ID0gZXZlbnQucGFyYW1zLnBhdGgucXVlcnkgJiYgZXZlbnQucGFyYW1zLnBhdGgucXVlcnkubWF0Y2goL1soIV0qXFwkXFwkP1xcLi8pO1xuICBpZiAoaW5kZXgpIHtcbiAgICBsZXQgZmlsdGVyRXggPSBldmVudC5wYXJhbXMucGF0aC5xdWVyeS5zdWJzdHJpbmcoaW5kZXguaW5kZXgpO1xuICAgIHRyeSB7XG4gICAgICBsZXQgZ2xvYmFsID0ge307XG4gICAgICBsZXQgZyA9IGdsb2JhbDtcbiAgICAgIGxldCBwcm9jZXNzO1xuICAgICAgbGV0IHJlcXVpcmU7XG4gICAgICBsZXQgZnM7XG4gICAgICBsZXQgbGVvO1xuICAgICAgbGV0IGxzO1xuICAgICAgbGV0IHJlcXVlc3Q7XG4gICAgICBsZXQgdXRpbDtcbiAgICAgIGxldCBjb250ZXh0O1xuICAgICAgbGV0IGNhbGxiYWNrO1xuICAgICAgbGV0IGV2ZW50O1xuICAgICAgY3VzdG9tRmlsdGVyID0gZXZhbChgKGZ1bmN0aW9uKCQsJCQsJCQkKXtcbiAgICAgICAgXHRcdHRyeXtcbiAgICAgICAgXHRcdFx0cmV0dXJuICR7ZmlsdGVyRXgucmVwbGFjZSgvPSsvZywgXCI9PVwiKS5yZXBsYWNlKC89PT4vZywgXCI9PlwiKS5yZXBsYWNlKC88PT0vZywgXCI8PVwiKS5yZXBsYWNlKC8+PT0vZywgXCI+PVwiKS5yZXBsYWNlKC8hPT0vZywgXCIhPVwiKS5yZXBsYWNlKC9cXCs9PS9nLCBcIis9XCIpLnJlcGxhY2UoLy09PS9nLCBcIi09XCIpLnJlcGxhY2UoLzo9PS9nLCBcIj1cIil9O1x0XG4gICAgICAgIFx0XHR9Y2F0Y2goZSl7XG4gICAgICAgIFx0XHRcdHJldHVybiBmYWxzZTtcbiAgICAgICAgXHRcdH1cbiAgICAgICAgXHR9KWApO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGN1c3RvbUZpbHRlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfTtcbiAgICAgIHJldHVybiBjYWxsYmFjaygnaW52YWxpZCBmaWx0ZXIgZXhwcmVzc2lvbicpO1xuICAgIH1cbiAgICBldmVudC5wYXJhbXMucGF0aC5xdWVyeSA9IGV2ZW50LnBhcmFtcy5wYXRoLnF1ZXJ5LnN1YnN0cmluZygwLCBpbmRleC5pbmRleCkudHJpbSgpO1xuICB9XG4gIHZhciBxdWV1ZSA9IHV0aWwucmVmKGV2ZW50LnBhcmFtcy5wYXRoLnF1ZXVlKS5hc1F1ZXVlKGV2ZW50LnBhcmFtcy5wYXRoLnN1YnF1ZXVlKS5pZDtcbiAgaWYgKGV2ZW50LnBhcmFtcy5wYXRoLnF1ZXJ5KSB7XG4gICAgdmFyIHF1ZXJ5ID0gbmV3IFJlZ0V4cChldmVudC5wYXJhbXMucGF0aC5xdWVyeSwgJ2knKTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgcXVlcnkgPSBudWxsO1xuICB9XG4gIHZhciBzdGFydCA9IGV2ZW50LnBhcmFtcy5wYXRoLnN0YXJ0O1xuICB2YXIgcmVxdWVzdGVkQ291bnQgPSBldmVudC5wYXJhbXMucXVlcnlzdHJpbmcuY291bnQgfHwgNDA7XG4gIHZhciBkZWJ1ZyA9IGV2ZW50LnBhcmFtcy5xdWVyeXN0cmluZy5kZWJ1ZyB8fCBmYWxzZTtcbiAgYXdhaXQgcmVxdWVzdC5hdXRob3JpemUoZXZlbnQsIHtcbiAgICBscm46ICdscm46bGVvOmJvdG1vbjo6OicsXG4gICAgYWN0aW9uOiBcInNlYXJjaFF1ZXVlXCJcbiAgfSk7XG4gIHZhciByZXNwb25zZSA9IHtcbiAgICByZXN1bHRzOiBbXSxcbiAgICByZXN1bXB0aW9uVG9rZW46IG51bGwsXG4gICAgbGFzdF90aW1lOiBudWxsLFxuICAgIGNvdW50OiAwLFxuICAgIGFnZzogZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLmFnZyA/IEpTT04ucGFyc2UoZXZlbnQucGFyYW1zLnF1ZXJ5c3RyaW5nLmFnZykgOiB7fVxuICB9O1xuICBsZXQgZmlsdGVyID0gZnVuY3Rpb24gKCQsICQkLCAkJCQpIHtcbiAgICByZXR1cm4gKHF1ZXJ5ID09PSBudWxsIHx8IEpTT04uc3RyaW5naWZ5KCQkKS5tYXRjaChxdWVyeSkpICYmIGN1c3RvbUZpbHRlcigkLCAkJCwgJCQkKTtcbiAgfTtcbiAgdmFyIHJlYWRhYmxlID0gbHMuZnJvbUxlbyhcInRlc3RcIiwgcXVldWUsIHtcbiAgICBzdGFydDogc3RhcnQsXG4gICAgZGVidWc6IGRlYnVnLFxuICAgIGdldEV2ZW50c1YxOiBsZW8uZ2V0RXZlbnRzLFxuICAgIHN0b3BUaW1lOiBEYXRlLm5vdygpICsgY29udGV4dC5nZXRSZW1haW5pbmdUaW1lSW5NaWxsaXMoKSAqIDAuOCxcbiAgICBmYXN0X3MzX3JlYWQ6IHRydWVcbiAgfSk7XG4gIGxldCBleGl0aW5nID0gZmFsc2U7XG4gIHZhciBmdWxsVGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgIHJlYWRhYmxlLmRlc3Ryb3koKTtcbiAgICBleGl0aW5nID0gdHJ1ZTtcbiAgfSwgMTAwMDApO1xuICB2YXIgdGltZW91dDtcbiAgbGV0IHNpemUgPSAwO1xuICByZWFkYWJsZS5waXBlKGxzLndyaXRlKChvYmosIGRvbmUpID0+IHtcbiAgICBpZiAoZXhpdGluZykge1xuICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICB9XG4gICAgcmVzcG9uc2UucmVzdW1wdGlvblRva2VuID0gb2JqLmVpZDtcbiAgICByZXNwb25zZS5sYXN0X3RpbWUgPSBvYmoudGltZXN0YW1wO1xuICAgIHJlc3BvbnNlLmNvdW50Kys7XG4gICAgaWYgKGZpbHRlcihvYmoucGF5bG9hZCwgb2JqLCByZXNwb25zZS5hZ2cpKSB7XG4gICAgICByZXNwb25zZS5yZXN1bHRzLnB1c2goT2JqZWN0LmFzc2lnbih7fSwgb2JqKSk7XG4gICAgICBzaXplICs9IG9iai5zaXplIHx8IEJ1ZmZlci5ieXRlTGVuZ3RoKEpTT04uc3RyaW5naWZ5KG9iaikpO1xuICAgICAgaWYgKCF0aW1lb3V0KSB7XG4gICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZWFkYWJsZS5kZXN0cm95KCk7XG4gICAgICAgICAgZXhpdGluZyA9IHRydWU7XG4gICAgICAgIH0sIDEwMDApO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoID49IHJlcXVlc3RlZENvdW50IHx8IHNpemUgPj0gMTAyNCAqIDEwMjQgKiA0KSB7XG4gICAgICAgIHJlYWRhYmxlLmRlc3Ryb3koKTtcbiAgICAgICAgZXhpdGluZyA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIGRvbmUoKTtcbiAgfSkpLm9uKFwiZmluaXNoXCIsICgpID0+IHtcbiAgICBjbGVhclRpbWVvdXQoZnVsbFRpbWVvdXQpO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICBjYWxsYmFjayhudWxsLCByZXNwb25zZSk7XG4gIH0pO1xufSk7XG5cbn0pLmNhbGwodGhpcyl9KS5jYWxsKHRoaXMscmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIpXG59LHtcImJ1ZmZlclwiOnVuZGVmaW5lZCxcImxlby1hdXRoXCI6dW5kZWZpbmVkLFwibGVvLXNka1wiOnVuZGVmaW5lZCxcImxlby1zZGsvbGliL3JlZmVyZW5jZS5qc1wiOnVuZGVmaW5lZCxcImxlby1zZGsvd3JhcHBlcnMvcmVzb3VyY2VcIjp1bmRlZmluZWR9XX0se30sWzFdKSgxKVxufSk7XG4iXSwiZmlsZSI6Ii5sZW9idWlsZC5qcyJ9
