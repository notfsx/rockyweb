// Stand-in for analytics.js / ga.js: sends nothing but still runs hitCallback so links keep working.
(function () {
  'use strict';
  var w = window;
  var noop = function () {};
  var callLater = function (fn) { if (typeof fn === 'function') setTimeout(function () { try { fn(); } catch (e) { /* ignore */ } }, 1); };

  var tracker = {
    get: function () { return undefined; },
    set: noop,
    send: function () {
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (a && typeof a === 'object') callLater(a.hitCallback);
      }
    }
  };

  var gaName = w.GoogleAnalyticsObject || 'ga';
  var queued = w[gaName] && w[gaName].q;

  function ga() {
    var len = arguments.length;
    if (len === 0) return;
    var first = arguments[0];
    if (typeof first === 'function') { try { first(tracker); } catch (e) { /* ignore */ } return; }
    for (var i = 0; i < len; i++) {
      var a = arguments[i];
      if (a && typeof a === 'object') callLater(a.hitCallback);
    }
  }
  ga.create = function () { return tracker; };
  ga.getByName = function () { return tracker; };
  ga.getAll = function () { return [tracker]; };
  ga.remove = noop;
  ga.loaded = true;
  ga.l = Date.now();
  ga.q = [];
  w[gaName] = ga;
  if (Array.isArray(queued)) {
    for (var q = 0; q < queued.length; q++) { try { ga.apply(null, queued[q]); } catch (e) { /* ignore */ } }
  }

  // Legacy ga.js API
  var legacyTracker = new Proxy({}, { get: function () { return noop; } });
  w._gat = { _getTracker: function () { return legacyTracker; }, _getTrackerByName: function () { return legacyTracker; }, _createTracker: function () { return legacyTracker; }, _anonymizeIp: noop };
  var oldGaq = Array.isArray(w._gaq) ? w._gaq : [];
  w._gaq = {
    push: function () {
      for (var i = 0; i < arguments.length; i++) {
        var cmd = arguments[i];
        if (typeof cmd === 'function') { try { cmd(); } catch (e) { /* ignore */ } continue; }
        if (Array.isArray(cmd) && cmd[0] === '_set' && cmd[1] === 'hitCallback') callLater(cmd[2]);
      }
      return 0;
    }
  };
  for (var j = 0; j < oldGaq.length; j++) w._gaq.push(oldGaq[j]);
})();
