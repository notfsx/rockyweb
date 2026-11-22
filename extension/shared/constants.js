// Shared constants. Classic script so the service worker, content scripts, pages and Node can all load it.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  RW.ACTIONS = Object.freeze({
    // content script -> background
    GET_EFFECTIVE_CONFIG: 'getEffectiveConfig',
    APPLY_COSMETICS: 'applyCosmetics',
    RUN_CMP_API: 'runCmpApi',
    CONSENT_HANDLED: 'consentHandled',
    PICKER_ADD_SELECTOR: 'pickerAddSelector',
    PICKER_REMOVE_SELECTOR: 'pickerRemoveSelector',
    AI_EVALUATE_CANDIDATE: 'aiEvaluateCandidate',
    AI_ADJUSTMENT_APPLIED: 'aiAdjustmentApplied',
    AI_EVALUATE_CONSENT: 'aiEvaluateConsent',
    AI_CONSENT_ATTEMPT: 'aiConsentAttempt',
    AI_CONSENT_RESULT: 'aiConsentResult',

    // background -> content script
    CONSENT_FOLLOWUP: 'consentFollowup',
    MODE_CHANGED: 'modeChanged',
    AI_REVERT: 'aiRevert',

    // popup -> content script (top frame)
    START_ELEMENT_PICKER: 'startElementPicker',

    // popup / options -> background
    GET_POPUP_STATE: 'getPopupState',
    GET_OPTIONS_STATE: 'getOptionsState',
    SET_SITE_TIER: 'setSiteTier',
    SET_SITE_CUSTOM_OPTION: 'setSiteCustomOption',
    RESET_SITE_PROFILE: 'resetSiteProfile',
    DELETE_SITE_PROFILE: 'deleteSiteProfile',
    SET_DOMAIN_SLIDER: 'setDomainSlider',
    SET_GLOBAL_TIER: 'setGlobalTier',
    SET_GLOBAL_CUSTOM_OPTION: 'setGlobalCustomOption',
    SET_TRACKER_GLOBAL_OVERRIDE: 'setTrackerGlobalOverride',
    FORGET_TRACKER: 'forgetTracker',
    RESET_LEARNED_TRACKERS: 'resetLearnedTrackers',
    ADD_COSMETIC_SELECTOR: 'addCosmeticSelector',
    REMOVE_COSMETIC_SELECTOR: 'removeCosmeticSelector',
    EXPORT_SETTINGS: 'exportSettings',
    IMPORT_SETTINGS: 'importSettings',
    RESET_STATS: 'resetStats',
    RESET_ALL: 'resetAll',
    SET_OPERATING_MODE: 'setOperatingMode',
    SET_AI_AUTO_OPTIMISE: 'setAiAutoOptimise',
    GET_AI_STATUS: 'getAiStatus',
    AI_WARM: 'aiWarm',
    SET_AI_ENABLED: 'setAiEnabled',
    SET_SITE_NEWSLETTER: 'setSiteNewsletter',
    AI_UNDO_ADJUSTMENT: 'aiUndoAdjustment',
    AI_SITE_OPT_OUT: 'aiSiteOptOut',
    CLEAR_AI_MEMORY: 'clearAiMemory',
    GET_PAGE_OUTLINE: 'getPageOutline',
    RESOLVE_PAGE_EDITS: 'resolvePageEdits',
    PREVIEW_PAGE_EDITS: 'previewPageEdits',
    CLEAR_PAGE_PREVIEW: 'clearPagePreview',
    PAGE_EDITS_CHANGED: 'pageEditsChanged',
    APPLY_PAGE_EDITS: 'applyPageEdits',
    PAGE_FIX_CANDIDATES: 'pageFixCandidates',
    APPLY_PAGE_FIX: 'applyPageFix',
    DISMISS_PAGE_FIX: 'dismissPageFix',
    SAVE_PAGE_EDIT: 'savePageEdit',
    SET_PAGE_EDIT: 'setPageEdit',
    DELETE_PAGE_EDIT: 'deletePageEdit',
    SET_AI_PAGE_SETTINGS: 'setAiPageSettings',
    SET_SITE_PAGE_FIXES: 'setSitePageFixes',
    SET_SYNC: 'setSync',
    GET_SYNC_STATUS: 'getSyncStatus',
    CLEAR_SYNC_COPY: 'clearSyncCopy'
  });

  RW.TIER_ORDER = Object.freeze(['off', 'consent_only', 'balanced', 'strict', 'custom']);

  RW.TIER_META = Object.freeze({
    off: {
      label: 'Off',
      name: 'No Protection',
      description: 'Every engine is switched off and filter rules are bypassed. Use it for sites that misbehave.',
      color: '#8A8F98'
    },
    consent_only: {
      label: 'Consent',
      name: 'Cookie Consent Only',
      description: 'Only answers cookie popups with your saved choices. No blocking, so nothing can break.',
      color: '#4EA8FF'
    },
    balanced: {
      label: 'Balanced',
      name: 'Balanced Protection',
      description: 'Blocks known ads and trackers, strips cookies from learned trackers, hides ads and cleans links.',
      color: '#3DD68C'
    },
    strict: {
      label: 'Strict',
      name: 'Strict Protection',
      description: 'Rejects all cookies, hard-blocks learned trackers and hides annoyances. Some sites may need a step down.',
      color: '#B18CFF'
    },
    custom: {
      label: 'Custom',
      name: 'Custom Manual Control',
      description: 'Your own combination of engines, saved automatically.',
      color: '#F5B83D'
    }
  });

  RW.SLIDER_META = Object.freeze({
    allow: { label: 'Allow', color: '#3DD68C' },
    cookie_block: { label: 'Cookies blocked', color: '#F5B83D' },
    block: { label: 'Blocked', color: '#F2555A' }
  });

  // Allow-list for CMP names reported back from page context.
  RW.KNOWN_CMP_NAMES = Object.freeze([
    'OneTrust', 'Cookiebot', 'Didomi', 'Usercentrics', 'Usercentrics v3', 'Klaro', 'Complianz',
    'CookieFirst', 'CookieScript', 'Shopify', 'Quantcast Choice', 'TrustArc', 'Sourcepoint',
    'Google Funding Choices', 'CookieYes', 'Osano', 'Termly', 'iubenda', 'Axeptio', 'Borlabs',
    'consentmanager', 'Ketch', 'Cookie Notice', 'CookieLawInfo', 'Moove GDPR', 'Civic Cookie Control',
    'tarteaucitron', 'Evidon', 'TrustCommander', 'Wix', 'Squarespace', 'HubSpot', 'Amazon',
    'YouTube', 'Cookie Information', 'Generic'
  ]);

  RW.STORAGE_KEYS = Object.freeze([
    'schemaVersion', 'globalDefaultTier', 'globalCustomConfig', 'siteProfiles', 'learnedTrackers', 'stats',
    'operatingMode', 'aiSettings', 'aiMemory', 'pageEdits'
  ]);

  RW.SCHEMA_VERSION = 2;

  // Options for every LanguageModel call, so availability() and create() always agree.
  RW.AI_MODEL_OPTIONS = Object.freeze({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }]
  });

  // Sampling for every session. The answers are choices from fixed lists, so less randomness means
  // fewer odd answers. null keeps Chrome's defaults. Chrome 157 takes it in create() even without
  // LanguageModel.params(); a Chrome that refuses it gets a session with its defaults.
  RW.AI_SAMPLING = { temperature: 0.3, topK: 3 };
  RW.aiCreateOptions = (extra, base) => {
    const s = RW.AI_SAMPLING;
    const sampling = s ? { temperature: s.temperature, topK: s.topK } : {};
    return Object.assign({}, base || RW.AI_MODEL_OPTIONS, sampling, extra || {});
  };
  RW.aiCreate = (LM, extra, base) => {
    const opts = RW.aiCreateOptions(extra, base);
    if (opts.temperature === undefined) return LM.create(opts);
    return LM.create(opts).catch((err) => {
      if (err && err.name === 'AbortError') throw err;
      const plain = Object.assign({}, opts);
      delete plain.temperature;
      delete plain.topK;
      return LM.create(plain);
    });
  };

  // What this browser session knows about Chrome's model being loaded: when something first asked
  // for it (loadingSince) and when it last answered (answeredAt). chrome.storage.session empties
  // when Chrome quits, which is also when the model has to be loaded again. Extension pages and the
  // service worker only.
  RW.AI_LOAD_KEY = 'aiModelLoad';
  // How long the service worker keeps a session after "describe a change" was used.
  RW.AI_KEEP_WARM_MS = 10 * 60000;
  RW.aiLoadGet = async () => {
    try { return (await chrome.storage.session.get(RW.AI_LOAD_KEY))[RW.AI_LOAD_KEY] || {}; } catch (_) { return {}; }
  };
  // One write at a time, so two notes made together never overwrite each other.
  let loadNotes = Promise.resolve();
  RW.aiLoadNote = (patch) => (loadNotes = loadNotes.then(async () => {
    try {
      const cur = await RW.aiLoadGet();
      await chrome.storage.session.set({ [RW.AI_LOAD_KEY]: Object.assign({}, cur, patch) });
    } catch (_) { /* not important */ }
  }));

  // Code switch for answering unknown cookie banners with the on-device model. When false the
  // feature never runs, whatever the settings say.
  RW.AI_CONSENT_ENABLED = true;

  RW.OPERATING_META = Object.freeze({
    full: { label: 'Full', description: 'Everything Rockyweb offers, including tracker learning and automatic optimisation if you turn it on.' },
    light: { label: 'Light', description: 'Uses less of your computer. Blocking, link cleaning and your site settings stay; tracker learning, AI and deep page scanning pause. Cookie popups are answered only for the consent platforms Rockyweb recognises.' }
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
