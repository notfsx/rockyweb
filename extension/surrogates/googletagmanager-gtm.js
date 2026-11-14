// Stand-in for gtm.js / gtag.js: loads nothing but still runs eventCallback / event_callback.
(function () {
  'use strict';
  var w = window;
  var callLater = function (fn) { if (typeof fn === 'function') setTimeout(function () { try { fn(); } catch (e) { /* ignore */ } }, 1); };

  function handle(entry) {
    if (!entry || typeof entry !== 'object') return;
    callLater(entry.eventCallback);
    // gtag() pushes its `arguments` object: ['event', name, { event_callback }]
    if (typeof entry.length === 'number') {
      for (var i = 0; i < entry.length; i++) {
        var a = entry[i];
        if (a && typeof a === 'object') callLater(a.event_callback);
      }
    }
  }

  var names = ['dataLayer'];
  try {
    var src = document.currentScript && document.currentScript.src;
    var m = src && /[?&]l=([A-Za-z_$][\w$]*)/.exec(src);
    if (m && m[1] !== 'dataLayer') names.push(m[1]);
  } catch (e) { /* ignore */ }

  names.forEach(function (name) {
    var dl = Array.isArray(w[name]) ? w[name] : (w[name] = []);
    if (dl.__rockyweb) return;
    for (var i = 0; i < dl.length; i++) handle(dl[i]);
    var push = Array.prototype.push;
    Object.defineProperty(dl, '__rockyweb', { value: true });
    dl.push = function () {
      for (var j = 0; j < arguments.length; j++) handle(arguments[j]);
      return push.apply(dl, arguments);
    };
  });
  w.google_tag_manager = w.google_tag_manager || {};
})();
