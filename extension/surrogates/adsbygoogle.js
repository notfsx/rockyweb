// Stand-in for adsbygoogle.js: accepts and ignores ad requests.
(function () {
  'use strict';
  var w = window;
  var queued = Array.isArray(w.adsbygoogle) ? w.adsbygoogle.slice() : [];
  var stub = { loaded: true, push: function () { return 0; } };
  try {
    Object.defineProperty(w, 'adsbygoogle', { configurable: true, get: function () { return stub; }, set: function () { /* ignore */ } });
  } catch (e) {
    w.adsbygoogle = stub;
  }
  void queued;
})();
