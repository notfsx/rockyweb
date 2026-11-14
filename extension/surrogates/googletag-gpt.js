// Stand-in for Google Publisher Tag so pages that call googletag directly do not break.
(function () {
  'use strict';
  var w = window;
  var noop = function () {};
  var self = function () { return this; };
  var empty = function () { return []; };
  var nil = function () { return null; };

  function Slot(path, sizes, id) {
    this._path = path || '';
    this._id = id || '';
    this._sizes = sizes || [];
  }
  var slotMethods = ['addService', 'clearCategoryExclusions', 'clearTargeting', 'defineSizeMapping', 'set', 'setCategoryExclusion',
    'setClickUrl', 'setCollapseEmptyDiv', 'setConfig', 'setForceSafeFrame', 'setSafeFrameConfig', 'setTargeting', 'updateTargetingFromMap'];
  slotMethods.forEach(function (m) { Slot.prototype[m] = self; });
  Slot.prototype.get = nil;
  Slot.prototype.getAdUnitPath = function () { return this._path; };
  Slot.prototype.getAttributeKeys = empty;
  Slot.prototype.getCategoryExclusions = empty;
  Slot.prototype.getConfig = nil;
  Slot.prototype.getDomId = function () { return this._id; };
  Slot.prototype.getSlotElementId = function () { return this._id; };
  Slot.prototype.getSlotId = function () { var s = this; return { getId: function () { return s._path + '_0'; }, getDomId: function () { return s._id; } }; };
  Slot.prototype.getResponseInformation = nil;
  Slot.prototype.getSizes = function () { return this._sizes; };
  Slot.prototype.getTargeting = empty;
  Slot.prototype.getTargetingKeys = empty;
  Slot.prototype.getTargetingMap = function () { return {}; };

  var slots = [];
  var pubads = {
    addEventListener: self, removeEventListener: self, clear: noop, clearCategoryExclusions: self,
    clearTagForChildDirectedTreatment: self, clearTargeting: self, collapseEmptyDivs: noop,
    defineOutOfPagePassback: function () { return new Slot(); }, definePassback: function () { return new Slot(); },
    disableInitialLoad: noop, display: noop, enableAsyncRendering: noop, enableLazyLoad: noop,
    enableSingleRequest: noop, enableSyncRendering: noop, enableVideoAds: noop, get: nil,
    getAttributeKeys: empty, getTargeting: empty, getTargetingKeys: empty, getSlots: function () { return slots.slice(); },
    isInitialLoadDisabled: function () { return true; }, refresh: noop, set: self, setCategoryExclusion: self,
    setCentering: noop, setCookieOptions: self, setForceSafeFrame: self, setLocation: self, setPrivacySettings: self,
    setPublisherProvidedId: self, setRequestNonPersonalizedAds: self, setSafeFrameConfig: self,
    setTagForChildDirectedTreatment: self, setTargeting: self, setVideoContent: self, updateCorrelator: noop
  };
  var service = { addEventListener: self, removeEventListener: self, enableSyncLoading: noop, setRefreshUnfilledSlots: noop, setContent: noop, getSlots: empty };
  function SizeMapping() { this.addSize = self; this.build = empty; }

  var existing = w.googletag || {};
  var queued = Array.isArray(existing.cmd) ? existing.cmd : [];
  var gt = {
    apiReady: true,
    pubadsReady: true,
    cmd: { push: function () { for (var i = 0; i < arguments.length; i++) { try { if (typeof arguments[i] === 'function') arguments[i](); } catch (e) { /* ignore */ } } return 0; } },
    companionAds: function () { return service; },
    content: function () { return service; },
    defineSlot: function (path, sizes, id) { var s = new Slot(path, sizes, id); slots.push(s); return s; },
    defineOutOfPageSlot: function (path, id) { var s = new Slot(path, [], id); slots.push(s); return s; },
    destroySlots: function () { slots = []; return true; },
    disablePublisherConsole: noop,
    display: noop,
    enableServices: noop,
    enums: { OutOfPageFormat: {}, TrafficSource: {} },
    getConfig: nil,
    getEventLog: function () { return { getAllEvents: empty, getEventsBySeverity: empty, getEventsBySlot: empty }; },
    getVersion: function () { return '0'; },
    onPubAdsReady: noop,
    openConsole: noop,
    pubads: function () { return pubads; },
    secureSignalProviders: { push: noop },
    setAdIframeTitle: noop,
    setConfig: noop,
    sizeMapping: function () { return new SizeMapping(); }
  };
  w.googletag = gt;
  for (var i = 0; i < queued.length; i++) gt.cmd.push(queued[i]);
})();
