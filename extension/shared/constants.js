// Shared constants. Classic script so the service worker, content scripts, pages and Node can all load it.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  RW.VERSION = '1.0.0';

  RW.ACTIONS = Object.freeze({
    // content script -> background
    GET_EFFECTIVE_CONFIG: 'getEffectiveConfig',
    APPLY_COSMETICS: 'applyCosmetics',
    RUN_CMP_API: 'runCmpApi',
    CONSENT_HANDLED: 'consentHandled',
    PICKER_ADD_SELECTOR: 'pickerAddSelector',
    PICKER_REMOVE_SELECTOR: 'pickerRemoveSelector',

    // background -> content script (top frame)
    CONSENT_FOLLOWUP: 'consentFollowup',

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
    RESET_ALL: 'resetAll'
  });

  RW.TIER_ORDER = Object.freeze(['off', 'consent_only', 'balanced', 'strict', 'custom']);

  RW.TIER_META = Object.freeze({
    off: {
      label: 'Off',
      name: 'No Protection',
      description: 'Every engine is disabled and static filter rules are bypassed. Use it for sites that misbehave.',
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
      description: 'Blocks known ads and trackers, strips cookies from learned trackers, hides ads and cleans URLs.',
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
    'schemaVersion', 'globalDefaultTier', 'globalCustomConfig', 'siteProfiles', 'learnedTrackers', 'stats'
  ]);

  RW.SCHEMA_VERSION = 1;

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
