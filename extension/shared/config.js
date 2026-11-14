// Settings resolution and pure state mutators. getEffectiveConfig() decides what runs on a site.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const TIERS = ['off', 'consent_only', 'balanced', 'strict', 'custom'];
  const CONSENT_MODES = ['off', 'custom_categories', 'strict_reject'];
  const HEURISTIC_MODES = ['off', 'cookie_strip', 'hard_block'];
  const SLIDER_STATES = ['allow', 'cookie_block', 'block'];
  const LEARNED_STATUSES = ['allow', 'cookie_block', 'block'];
  const CATEGORY_KEYS = ['functional', 'analytics', 'marketing'];
  const BOOLEAN_KEYS = ['adBlockNetwork', 'cosmeticFiltering', 'aggressiveFiltering', 'stripUrlParams'];

  // Engine switches a site (or the global custom profile) can set.
  const CUSTOM_KEYS = [
    'consentMode', 'consentCategories', 'adBlockNetwork', 'trackerHeuristicMode',
    'cosmeticFiltering', 'aggressiveFiltering', 'stripUrlParams'
  ];
  const GLOBAL_ONLY_KEYS = ['showToastBadge'];

  const LEARN_THRESHOLD = 3;
  const MAX_FIRST_PARTY_HOSTS = 12;
  const MAX_LEARNED_TRACKERS = 6000;
  const MAX_CUSTOM_SELECTORS = 200;
  const MAX_SLIDER_OVERRIDES = 500;
  const MAX_SELECTOR_LENGTH = 500;

  const DEFAULT_CATEGORIES = Object.freeze({ necessary: true, functional: true, analytics: false, marketing: false });

  const DEFAULT_GLOBAL_CUSTOM = Object.freeze({
    consentMode: 'custom_categories',
    consentCategories: DEFAULT_CATEGORIES,
    adBlockNetwork: true,
    trackerHeuristicMode: 'cookie_strip',
    cosmeticFiltering: true,
    aggressiveFiltering: false,
    stripUrlParams: true,
    showToastBadge: true
  });

  // Consent categories for presets come from the user's saved choices.
  const TIER_PRESETS = Object.freeze({
    off: {
      consentMode: 'off', adBlockNetwork: false, trackerHeuristicMode: 'off',
      cosmeticFiltering: false, aggressiveFiltering: false, stripUrlParams: false
    },
    consent_only: {
      consentMode: 'custom_categories', adBlockNetwork: false, trackerHeuristicMode: 'off',
      cosmeticFiltering: false, aggressiveFiltering: false, stripUrlParams: false
    },
    balanced: {
      consentMode: 'custom_categories', adBlockNetwork: true, trackerHeuristicMode: 'cookie_strip',
      cosmeticFiltering: true, aggressiveFiltering: false, stripUrlParams: true
    },
    strict: {
      consentMode: 'strict_reject', adBlockNetwork: true, trackerHeuristicMode: 'hard_block',
      cosmeticFiltering: true, aggressiveFiltering: true, stripUrlParams: true
    }
  });

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const finiteOr = (n, fallback) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

  // ---- validation

  function sanitizeCategories(raw, fallback) {
    const fb = fallback || DEFAULT_CATEGORIES;
    const src = isObj(raw) ? raw : {};
    const out = { necessary: true };
    for (const k of CATEGORY_KEYS) out[k] = typeof src[k] === 'boolean' ? src[k] : !!fb[k];
    return out;
  }

  function sanitizeOption(key, value) {
    switch (key) {
      case 'consentMode':
        return CONSENT_MODES.includes(value) ? { ok: true, value } : { ok: false };
      case 'trackerHeuristicMode':
        return HEURISTIC_MODES.includes(value) ? { ok: true, value } : { ok: false };
      case 'consentCategories':
        return isObj(value) ? { ok: true, value: sanitizeCategories(value) } : { ok: false };
      case 'adBlockNetwork':
      case 'cosmeticFiltering':
      case 'aggressiveFiltering':
      case 'stripUrlParams':
      case 'showToastBadge':
        return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
      default:
        return { ok: false };
    }
  }

  function isValidSelector(sel) {
    if (typeof sel !== 'string') return false;
    const s = sel.trim();
    if (!s || s.length > MAX_SELECTOR_LENGTH) return false;
    if (/[{}<;@]|\/\*|\*\/|[\u0000-\u001f\u007f]|\\$/.test(s)) return false;
    let paren = 0;
    let bracket = 0;
    let quote = '';
    for (const ch of s) {
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') paren++;
      else if (ch === ')') { if (--paren < 0) return false; }
      else if (ch === '[') bracket++;
      else if (ch === ']') { if (--bracket < 0) return false; }
    }
    return !quote && paren === 0 && bracket === 0;
  }

  function sanitizeCustomConfig(raw, base) {
    const b = base || DEFAULT_GLOBAL_CUSTOM;
    const src = isObj(raw) ? raw : {};
    const out = {};
    for (const key of [...CUSTOM_KEYS, ...GLOBAL_ONLY_KEYS]) {
      const r = key in src ? sanitizeOption(key, src[key]) : { ok: false };
      out[key] = r.ok ? r.value : clone(b[key]);
    }
    out.consentCategories = sanitizeCategories(out.consentCategories);
    return out;
  }

  function sanitizeOverrides(raw) {
    const out = {};
    if (!isObj(raw)) return out;
    for (const key of CUSTOM_KEYS) {
      if (!(key in raw)) continue;
      const r = sanitizeOption(key, raw[key]);
      if (r.ok) out[key] = r.value;
    }
    return out;
  }

  function sanitizeSliders(raw) {
    const out = {};
    if (!isObj(raw)) return out;
    let n = 0;
    for (const [domain, st] of Object.entries(raw)) {
      const d = String(domain).toLowerCase();
      if (!RW.isValidDomain(d) || !SLIDER_STATES.includes(st)) continue;
      out[d] = st;
      if (++n >= MAX_SLIDER_OVERRIDES) break;
    }
    return out;
  }

  function sanitizeSelectors(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    for (const s of raw) {
      if (!isValidSelector(s)) continue;
      seen.add(s.trim());
      if (seen.size >= MAX_CUSTOM_SELECTORS) break;
    }
    return [...seen];
  }

  function sanitizeProfile(raw) {
    const src = isObj(raw) ? raw : {};
    return {
      tier: TIERS.includes(src.tier) ? src.tier : null,
      updatedAt: finiteOr(src.updatedAt, 0),
      customOverrides: sanitizeOverrides(src.customOverrides),
      domainSliderOverrides: sanitizeSliders(src.domainSliderOverrides),
      customCosmeticSelectors: sanitizeSelectors(src.customCosmeticSelectors)
    };
  }

  function isProfileEmpty(p) {
    return !p || (!p.tier &&
      Object.keys(p.domainSliderOverrides || {}).length === 0 &&
      (p.customCosmeticSelectors || []).length === 0);
  }

  function sanitizeTracker(raw) {
    const src = isObj(raw) ? raw : {};
    const hosts = Array.isArray(src.firstPartyHosts)
      ? [...new Set(src.firstPartyHosts.filter((h) => RW.isValidDomain(h)).map((h) => h.toLowerCase()))].slice(0, MAX_FIRST_PARTY_HOSTS)
      : [];
    let status = LEARNED_STATUSES.includes(src.learnedStatus) ? src.learnedStatus : 'allow';
    if (status === 'allow' && hosts.length >= LEARN_THRESHOLD) status = 'cookie_block';
    return {
      firstPartyHosts: hosts,
      learnedStatus: status,
      globalManualOverride: SLIDER_STATES.includes(src.globalManualOverride) ? src.globalManualOverride : null,
      firstSeen: finiteOr(src.firstSeen, 0),
      lastSeen: finiteOr(src.lastSeen, 0)
    };
  }

  function sanitizeStats(raw) {
    const src = isObj(raw) ? raw : {};
    const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return {
      totalPopupsHandled: n(src.totalPopupsHandled),
      totalAdsBlocked: n(src.totalAdsBlocked),
      totalTrackersRestricted: n(src.totalTrackersRestricted)
    };
  }

  // Turns anything (fresh install, old schema, imported file) into a complete, valid state.
  function normalizeState(raw) {
    const src = isObj(raw) ? raw : {};
    const siteProfiles = {};
    if (isObj(src.siteProfiles)) {
      for (const [key, p] of Object.entries(src.siteProfiles)) {
        const siteKey = RW.siteKeyForHost(key);
        if (!RW.isValidDomain(siteKey)) continue;
        const prof = sanitizeProfile(p);
        if (!isProfileEmpty(prof)) siteProfiles[siteKey] = prof;
      }
    }
    const learnedTrackers = {};
    if (isObj(src.learnedTrackers)) {
      for (const [domain, rec] of Object.entries(src.learnedTrackers)) {
        const d = String(domain).toLowerCase();
        if (RW.isValidDomain(d)) learnedTrackers[d] = sanitizeTracker(rec);
      }
    }
    return {
      schemaVersion: RW.SCHEMA_VERSION || 1,
      globalDefaultTier: TIERS.includes(src.globalDefaultTier) ? src.globalDefaultTier : 'balanced',
      globalCustomConfig: sanitizeCustomConfig(src.globalCustomConfig),
      siteProfiles,
      learnedTrackers,
      stats: sanitizeStats(src.stats)
    };
  }

  function createDefaultState() {
    return normalizeState({});
  }

  // ---- resolution

  function resolveTierConfig(tier, globalCustom, overrides) {
    const g = sanitizeCustomConfig(globalCustom);
    if (tier === 'custom') {
      const o = sanitizeOverrides(overrides);
      const out = {};
      for (const key of CUSTOM_KEYS) out[key] = key in o ? o[key] : clone(g[key]);
      out.consentCategories = sanitizeCategories(out.consentCategories);
      return out;
    }
    const preset = TIER_PRESETS[tier] || TIER_PRESETS.balanced;
    return Object.assign(clone(preset), {
      consentCategories: preset.consentMode === 'strict_reject'
        ? { necessary: true, functional: false, analytics: false, marketing: false }
        : sanitizeCategories(g.consentCategories)
    });
  }

  function getEffectiveConfig(state, hostname) {
    const s = state || createDefaultState();
    const host = RW.normalizeHost(hostname || '');
    const siteKey = host ? RW.siteKeyForHost(host) : '';
    const profile = siteKey ? s.siteProfiles[siteKey] : null;
    const siteTier = profile && profile.tier ? profile.tier : null;
    const tier = siteTier || s.globalDefaultTier;
    const engines = resolveTierConfig(
      tier,
      s.globalCustomConfig,
      siteTier === 'custom' ? profile.customOverrides : {}
    );
    return Object.assign(engines, {
      hostname: host,
      siteKey,
      supported: !!siteKey,
      tier,
      source: siteTier ? 'site' : 'global',
      globalDefaultTier: s.globalDefaultTier,
      showToastBadge: s.globalCustomConfig.showToastBadge !== false,
      domainSliderOverrides: profile ? clone(profile.domainSliderOverrides) : {},
      customCosmeticSelectors: profile ? profile.customCosmeticSelectors.slice() : []
    });
  }

  function anyNetwork(cfg) {
    return !!cfg && (cfg.adBlockNetwork || cfg.trackerHeuristicMode !== 'off' || cfg.stripUrlParams);
  }

  function consentIntent(cfg) {
    if (!cfg || cfg.consentMode === 'off' || cfg.tier === 'off') return null;
    const strict = cfg.consentMode === 'strict_reject';
    const categories = strict
      ? { necessary: true, functional: false, analytics: false, marketing: false }
      : sanitizeCategories(cfg.consentCategories);
    let decision = 'custom';
    if (!categories.analytics && !categories.marketing) decision = 'reject';
    else if (categories.functional && categories.analytics && categories.marketing) decision = 'accept';
    return { decision, categories, strict };
  }

  // ---- mutators (pure: they return a new state)

  function withProfile(state, siteKey, fn, now) {
    const key = RW.siteKeyForHost(siteKey);
    if (!RW.isValidDomain(key)) throw new Error('invalid_site');
    const prev = state.siteProfiles[key] ? clone(state.siteProfiles[key]) : sanitizeProfile({});
    const next = fn(prev, key) || prev;
    next.updatedAt = finiteOr(now, Date.now());
    const siteProfiles = Object.assign({}, state.siteProfiles);
    if (isProfileEmpty(next)) delete siteProfiles[key];
    else siteProfiles[key] = next;
    return Object.assign({}, state, { siteProfiles });
  }

  // Copies the site's current engines into customOverrides and switches it to custom.
  function ensureCustom(state, profile, key) {
    if (profile.tier === 'custom') return profile;
    const eff = getEffectiveConfig(state, key);
    const snap = {};
    for (const k of CUSTOM_KEYS) snap[k] = clone(eff[k]);
    profile.customOverrides = snap;
    profile.tier = 'custom';
    return profile;
  }

  function setSiteTier(state, siteKey, tier, now) {
    if (!TIERS.includes(tier)) throw new Error('invalid_tier');
    return withProfile(state, siteKey, (p, key) => {
      if (tier === 'custom') {
        if (p.tier !== 'custom' && Object.keys(p.customOverrides).length) { p.tier = 'custom'; return p; }
        return ensureCustom(state, p, key);
      }
      p.tier = tier;
      return p;
    }, now);
  }

  function setSiteCustomOption(state, siteKey, optKey, value, now) {
    if (!CUSTOM_KEYS.includes(optKey)) throw new Error('invalid_option');
    const r = sanitizeOption(optKey, value);
    if (!r.ok) throw new Error('invalid_value');
    return withProfile(state, siteKey, (p, key) => {
      ensureCustom(state, p, key);
      p.customOverrides[optKey] = r.value;
      return p;
    }, now);
  }

  function resetSiteProfile(state, siteKey, now, opts) {
    const keepRules = !!(opts && opts.keepRules);
    return withProfile(state, siteKey, (p) => {
      p.tier = null;
      if (!keepRules) {
        p.customOverrides = {};
        p.domainSliderOverrides = {};
      }
      return p;
    }, now);
  }

  function deleteSiteProfile(state, siteKey) {
    const key = RW.siteKeyForHost(siteKey);
    if (!state.siteProfiles[key]) return state;
    const siteProfiles = Object.assign({}, state.siteProfiles);
    delete siteProfiles[key];
    return Object.assign({}, state, { siteProfiles });
  }

  // A domain choice switches the site to custom. null removes it.
  function setDomainSlider(state, siteKey, domain, value, now) {
    const d = RW.baseDomain(String(domain || ''));
    if (!RW.isValidDomain(d)) throw new Error('invalid_domain');
    if (value !== null && !SLIDER_STATES.includes(value)) throw new Error('invalid_value');
    return withProfile(state, siteKey, (p, key) => {
      if (d === key) throw new Error('first_party');
      if (value === null) {
        delete p.domainSliderOverrides[d];
        return p;
      }
      ensureCustom(state, p, key);
      if (Object.keys(p.domainSliderOverrides).length >= MAX_SLIDER_OVERRIDES && !(d in p.domainSliderOverrides)) {
        throw new Error('too_many_overrides');
      }
      p.domainSliderOverrides[d] = value;
      return p;
    }, now);
  }

  function setGlobalTier(state, tier) {
    if (!TIERS.includes(tier)) throw new Error('invalid_tier');
    if (tier === 'custom' && state.globalDefaultTier !== 'custom') {
      const eff = getEffectiveConfig(state, null);
      const gc = clone(state.globalCustomConfig);
      for (const k of CUSTOM_KEYS) if (k !== 'consentCategories') gc[k] = clone(eff[k]);
      return Object.assign({}, state, { globalDefaultTier: 'custom', globalCustomConfig: gc });
    }
    return Object.assign({}, state, { globalDefaultTier: tier });
  }

  function setGlobalCustomOption(state, optKey, value) {
    if (!CUSTOM_KEYS.includes(optKey) && !GLOBAL_ONLY_KEYS.includes(optKey)) throw new Error('invalid_option');
    const r = sanitizeOption(optKey, value);
    if (!r.ok) throw new Error('invalid_value');
    let next = state;
    if (optKey !== 'consentCategories' && !GLOBAL_ONLY_KEYS.includes(optKey) && state.globalDefaultTier !== 'custom') {
      next = setGlobalTier(state, 'custom');
    }
    const gc = clone(next.globalCustomConfig);
    gc[optKey] = r.value;
    return Object.assign({}, next, { globalCustomConfig: sanitizeCustomConfig(gc) });
  }

  function setTrackerGlobalOverride(state, domain, value, now) {
    const d = RW.baseDomain(String(domain || ''));
    if (!RW.isValidDomain(d)) throw new Error('invalid_domain');
    if (value !== null && !SLIDER_STATES.includes(value)) throw new Error('invalid_value');
    const learnedTrackers = Object.assign({}, state.learnedTrackers);
    const rec = learnedTrackers[d] ? clone(learnedTrackers[d]) : sanitizeTracker({ firstSeen: now, lastSeen: now });
    rec.globalManualOverride = value;
    if (value === null && rec.firstPartyHosts.length === 0 && rec.learnedStatus === 'allow') delete learnedTrackers[d];
    else learnedTrackers[d] = rec;
    return Object.assign({}, state, { learnedTrackers });
  }

  function forgetTracker(state, domain) {
    const d = String(domain || '').toLowerCase();
    if (!state.learnedTrackers[d]) return state;
    const learnedTrackers = Object.assign({}, state.learnedTrackers);
    delete learnedTrackers[d];
    return Object.assign({}, state, { learnedTrackers });
  }

  // Keeps the user's own choices, forgets everything learned.
  function resetLearnedTrackers(state) {
    const learnedTrackers = {};
    for (const [d, rec] of Object.entries(state.learnedTrackers)) {
      if (rec.globalManualOverride) {
        learnedTrackers[d] = sanitizeTracker({ globalManualOverride: rec.globalManualOverride, firstSeen: rec.firstSeen, lastSeen: rec.lastSeen });
      }
    }
    return Object.assign({}, state, { learnedTrackers });
  }

  function addCosmeticSelector(state, siteKey, selector, now) {
    if (!isValidSelector(selector)) throw new Error('invalid_selector');
    const sel = selector.trim();
    return withProfile(state, siteKey, (p) => {
      if (!p.customCosmeticSelectors.includes(sel)) {
        if (p.customCosmeticSelectors.length >= MAX_CUSTOM_SELECTORS) throw new Error('too_many_selectors');
        p.customCosmeticSelectors.push(sel);
      }
      return p;
    }, now);
  }

  function removeCosmeticSelector(state, siteKey, selector, now) {
    return withProfile(state, siteKey, (p) => {
      p.customCosmeticSelectors = p.customCosmeticSelectors.filter((s) => s !== selector);
      return p;
    }, now);
  }

  function learnTracker(state, trackerDomain, firstPartySite, now) {
    const d = String(trackerDomain || '').toLowerCase();
    const site = String(firstPartySite || '').toLowerCase();
    if (!RW.isValidDomain(d) || !RW.isValidDomain(site) || d === site) return { changed: false, promoted: false };
    let rec = state.learnedTrackers[d];
    if (!rec) {
      if (Object.keys(state.learnedTrackers).length >= MAX_LEARNED_TRACKERS) pruneLearned(state);
      rec = state.learnedTrackers[d] = sanitizeTracker({ firstSeen: now, lastSeen: now });
    }
    rec.lastSeen = finiteOr(now, Date.now());
    if (rec.firstPartyHosts.includes(site)) return { changed: false, promoted: false, touched: true };
    let changed = false;
    if (rec.firstPartyHosts.length < MAX_FIRST_PARTY_HOSTS) {
      rec.firstPartyHosts.push(site);
      changed = true;
    }
    let promoted = false;
    if (rec.learnedStatus === 'allow' && rec.firstPartyHosts.length >= LEARN_THRESHOLD) {
      rec.learnedStatus = 'cookie_block';
      promoted = true;
    }
    return { changed, promoted };
  }

  function pruneLearned(state) {
    const entries = Object.entries(state.learnedTrackers)
      .filter(([, r]) => r.learnedStatus === 'allow' && !r.globalManualOverride)
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const drop = Math.max(1, Math.floor(entries.length / 4));
    for (let i = 0; i < drop && i < entries.length; i++) delete state.learnedTrackers[entries[i][0]];
  }

  Object.assign(RW, {
    TIERS,
    CONSENT_MODES,
    HEURISTIC_MODES,
    SLIDER_STATES,
    CUSTOM_KEYS,
    GLOBAL_ONLY_KEYS,
    CATEGORY_KEYS,
    BOOLEAN_KEYS,
    LEARN_THRESHOLD,
    DEFAULT_CATEGORIES,
    DEFAULT_GLOBAL_CUSTOM,
    TIER_PRESETS,
    sanitizeCategories,
    sanitizeOption,
    sanitizeCustomConfig,
    sanitizeProfile,
    sanitizeTracker,
    isValidSelector,
    isProfileEmpty,
    normalizeState,
    createDefaultState,
    resolveTierConfig,
    getEffectiveConfig,
    anyNetwork,
    consentIntent,
    setSiteTier,
    setSiteCustomOption,
    resetSiteProfile,
    deleteSiteProfile,
    setDomainSlider,
    setGlobalTier,
    setGlobalCustomOption,
    setTrackerGlobalOverride,
    forgetTracker,
    resetLearnedTrackers,
    addCosmeticSelector,
    removeCosmeticSelector,
    learnTracker
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
