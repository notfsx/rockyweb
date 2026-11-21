// Settings resolution and pure state mutators. getEffectiveConfig() decides what runs on a site.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const TIERS = ['off', 'consent_only', 'balanced', 'strict', 'custom'];
  const CONSENT_MODES = ['off', 'custom_categories', 'strict_reject'];
  const HEURISTIC_MODES = ['off', 'cookie_strip', 'hard_block'];
  const SLIDER_STATES = ['allow', 'cookie_block', 'block'];
  const OPERATING_MODES = ['full', 'light'];
  const NEWSLETTER_CHOICES = ['auto', 'hide', 'keep'];
  const COOKIE_AI_CHOICES = ['auto', 'off']; // 'off': never answer this site's unknown cookie banners with AI
  const PAGE_FIX_SITE_CHOICES = ['auto', 'off']; // 'off': no proactive page fixes on this site
  const PAGE_FIX_MODES = ['off', 'suggest', 'auto'];
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
    showToastBadge: false // new installs are silent; a saved preference is kept
  });

  // Bounds for the automatic adjustment memory.
  const AI_DECISION_TTL = 7 * 86400e3;
  const AI_UNDO_TTL = 30 * 86400e3;
  const AI_MAX_SITES = 200;
  const AI_MAX_PER_SITE = 30;

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
      customCosmeticSelectors: sanitizeSelectors(src.customCosmeticSelectors),
      newsletterPrompts: NEWSLETTER_CHOICES.includes(src.newsletterPrompts) ? src.newsletterPrompts : 'auto',
      cookieBannerAi: COOKIE_AI_CHOICES.includes(src.cookieBannerAi) ? src.cookieBannerAi : 'auto',
      pageFixes: PAGE_FIX_SITE_CHOICES.includes(src.pageFixes) ? src.pageFixes : 'auto',
      // Changed from an Incognito window: kept on this device, never synced.
      private: src.private === true
    };
  }

  function isProfileEmpty(p) {
    return !p || (!p.tier && !p.private &&
      Object.keys(p.domainSliderOverrides || {}).length === 0 &&
      (p.customCosmeticSelectors || []).length === 0 &&
      (!p.newsletterPrompts || p.newsletterPrompts === 'auto') &&
      (!p.cookieBannerAi || p.cookieBannerAi === 'auto') &&
      (!p.pageFixes || p.pageFixes === 'auto'));
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

  const SIG_RE = /^[a-z0-9:|._-]{1,120}$/;

  function sanitizeAiMemory(raw, now) {
    const t = finiteOr(now, Date.now());
    const src = isObj(raw) ? raw : {};
    const out = { decisions: {}, undone: {} };
    const sites = (obj) => (isObj(obj) ? Object.entries(obj).filter(([k]) => RW.isValidDomain(k)).slice(0, AI_MAX_SITES) : []);
    for (const [site, entries] of sites(src.decisions)) {
      const keep = {};
      for (const [k, v] of Object.entries(isObj(entries) ? entries : {}).slice(0, AI_MAX_PER_SITE)) {
        if (!SIG_RE.test(k) || !isObj(v) || !['hide_overlay', 'leave_unchanged', 'refuse_non_essential'].includes(v.action)) continue;
        const at = finiteOr(v.at, 0);
        if (t - at > AI_DECISION_TTL || typeof v.epoch !== 'string') continue;
        keep[k] = { action: v.action, at, epoch: v.epoch.slice(0, 16) };
        // A verified cookie banner answer keeps the label it clicked, so a later visit clicks the same one.
        if (v.action === 'refuse_non_essential') {
          if (typeof v.label !== 'string' || !v.label.trim()) { delete keep[k]; continue; }
          keep[k].label = v.label.replace(/[\u0000-\u001f]/g, ' ').slice(0, 60);
        }
      }
      if (Object.keys(keep).length) out.decisions[site] = keep;
    }
    for (const [site, entries] of sites(src.undone)) {
      const keep = {};
      for (const [k, exp] of Object.entries(isObj(entries) ? entries : {}).slice(0, AI_MAX_PER_SITE)) {
        if (SIG_RE.test(k) && finiteOr(exp, 0) > t) keep[k] = exp;
      }
      if (Object.keys(keep).length) out.undone[site] = keep;
    }
    return out;
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
      stats: sanitizeStats(src.stats),
      operatingMode: OPERATING_MODES.includes(src.operatingMode) ? src.operatingMode : 'full',
      aiSettings: sanitizeAiSettings(src.aiSettings),
      aiMemory: sanitizeAiMemory(src.aiMemory),
      // Page edits are validated by shared/page-edits.js; without it (a bare unit test) they are kept as they are.
      pageEdits: RW.sanitizePageEdits ? RW.sanitizePageEdits(src.pageEdits) : (isObj(src.pageEdits) ? clone(src.pageEdits) : {})
    };
  }

  // autoOptimise: the AI may act by itself. pageEdits: "describe a change" may edit pages, not only
  // settings. pageFixes: proactive page fixes are off, suggested in the popup, or applied by themselves.
  function sanitizeAiSettings(raw) {
    const src = isObj(raw) ? raw : {};
    return {
      autoOptimise: src.autoOptimise === true,
      pageEdits: src.pageEdits !== false,
      pageFixes: PAGE_FIX_MODES.includes(src.pageFixes) ? src.pageFixes : 'suggest'
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
      customCosmeticSelectors: profile ? profile.customCosmeticSelectors.slice() : [],
      newsletterPrompts: profile && profile.newsletterPrompts ? profile.newsletterPrompts : 'auto',
      cookieBannerAi: profile && profile.cookieBannerAi ? profile.cookieBannerAi : 'auto',
      pageFixesSite: profile && profile.pageFixes ? profile.pageFixes : 'auto',
      operatingMode: s.operatingMode || 'full',
      aiPreference: !!(s.aiSettings && s.aiSettings.autoOptimise),
      aiPageEdits: !(s.aiSettings && s.aiSettings.pageEdits === false),
      pageFixMode: (s.aiSettings && PAGE_FIX_MODES.includes(s.aiSettings.pageFixes)) ? s.aiSettings.pageFixes : 'suggest'
    });
  }

  // The one place that decides what actually runs, in this order:
  //   1. explicit user choices (newsletter hide / leave alone, per-domain choices, saved categories)
  //   2. the site policy (off, consent, balanced, strict, custom)
  //   3. the global operating mode (Light trims work, never explicit choices or declarative blocking)
  //   4. the AI preference (only adds reversible, page-scoped adjustments)
  function runtimeCapabilities(cfg, ctx) {
    const c = ctx || {};
    const active = !!cfg && cfg.supported !== false && cfg.tier !== 'off';
    const light = cfg && cfg.operatingMode === 'light';
    const incognito = !!c.incognito;
    const consent = !active || cfg.consentMode === 'off' ? 'off' : light ? 'bounded' : 'full';
    const hidingAllowed = active && cfg.tier !== 'consent_only' && cfg.cosmeticFiltering;
    let newsletter = 'off';
    if (active && cfg.newsletterPrompts === 'hide') newsletter = 'hide';
    else if (hidingAllowed && cfg.newsletterPrompts === 'auto' && cfg.aiPreference && !light && !incognito) newsletter = 'ai';
    // Unknown cookie banners: full consent work only, never in Light or Incognito, only when your
    // categories refuse something, and never on a site where you said no.
    const intent = consentIntent(cfg);
    const refuses = !!intent && intent.decision !== 'accept';
    const consentAi = RW.AI_CONSENT_ENABLED === true && consent === 'full' && !!cfg.aiPreference && !incognito &&
      refuses && cfg.cookieBannerAi !== 'off';
    let aiPausedReason = null;
    if (cfg && cfg.aiPreference) aiPausedReason = light ? 'light' : incognito ? 'incognito' : null;
    // Proactive page fixes: rules find candidates; 'auto' applies the sure ones, and asks the model about
    // the rest only when automatic optimisation is on. Never in Light, Incognito, or where you said no.
    let pageFixes = 'off';
    if (active && !light && !incognito && cfg.pageFixesSite !== 'off' && PAGE_FIX_MODES.includes(cfg.pageFixMode)) pageFixes = cfg.pageFixMode;
    return {
      pageFixes,
      pageFixAi: pageFixes === 'auto' && !!cfg.aiPreference,
      consent,
      learning: active && !light && !incognito && cfg.trackerHeuristicMode !== 'off',
      headerObservation: !light,
      newsletter,
      ai: newsletter === 'ai',
      consentAi,
      aiPausedReason
    };
  }

  // Short hash of the settings an automatic decision depends on. A change invalidates remembered decisions.
  function settingsEpoch(cfg) {
    const basis = JSON.stringify([cfg.tier, cfg.cosmeticFiltering, cfg.aggressiveFiltering, cfg.newsletterPrompts,
      cfg.operatingMode, cfg.aiPreference, cfg.consentMode, cfg.consentCategories, cfg.cookieBannerAi || 'auto']);
    let h = 0x811c9dc5;
    for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
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
    if (!categories.functional && !categories.analytics && !categories.marketing) decision = 'reject';
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

  function setSiteCookieBannerAi(state, siteKey, value, now) {
    if (!COOKIE_AI_CHOICES.includes(value)) throw new Error('invalid_value');
    return withProfile(state, siteKey, (p) => { p.cookieBannerAi = value; return p; }, now);
  }

  function setSiteNewsletter(state, siteKey, value, now) {
    if (!NEWSLETTER_CHOICES.includes(value)) throw new Error('invalid_value');
    return withProfile(state, siteKey, (p) => { p.newsletterPrompts = value; return p; }, now);
  }

  // Puts a site's profile back exactly as it was (used to undo a described change). null removes it.
  function restoreSiteProfile(state, siteKey, profile, now) {
    const key = RW.siteKeyForHost(siteKey);
    if (!RW.isValidDomain(key)) throw new Error('invalid_site');
    const siteProfiles = Object.assign({}, state.siteProfiles);
    const prof = profile ? sanitizeProfile(profile) : null;
    if (!prof || isProfileEmpty(prof)) delete siteProfiles[key];
    else siteProfiles[key] = Object.assign(prof, { updatedAt: finiteOr(now, Date.now()) });
    return Object.assign({}, state, { siteProfiles });
  }

  function setOperatingMode(state, mode) {
    if (!OPERATING_MODES.includes(mode)) throw new Error('invalid_value');
    return Object.assign({}, state, { operatingMode: mode });
  }

  function setAiAutoOptimise(state, enabled) {
    return Object.assign({}, state, { aiSettings: Object.assign(sanitizeAiSettings(state.aiSettings), { autoOptimise: enabled === true }) });
  }

  function setAiPageSettings(state, patch) {
    const next = sanitizeAiSettings(state.aiSettings);
    if (patch && typeof patch.pageEdits === 'boolean') next.pageEdits = patch.pageEdits;
    if (patch && patch.pageFixes !== undefined) {
      if (!PAGE_FIX_MODES.includes(patch.pageFixes)) throw new Error('invalid_value');
      next.pageFixes = patch.pageFixes;
    }
    return Object.assign({}, state, { aiSettings: next });
  }

  // A site changed from an Incognito window stays on this device: it is never synced.
  function markSitePrivate(state, siteKey) {
    return withProfile(state, siteKey, (p) => { p.private = true; return p; }, (state.siteProfiles[RW.siteKeyForHost(siteKey)] || {}).updatedAt || Date.now());
  }

  function setSitePageFixes(state, siteKey, value, now) {
    if (!PAGE_FIX_SITE_CHOICES.includes(value)) throw new Error('invalid_value');
    return withProfile(state, siteKey, (p) => { p.pageFixes = value; return p; }, now);
  }

  // ---- page edits (validated by shared/page-edits.js)

  function withPageEdits(state, siteKey, fn) {
    const key = RW.siteKeyForHost(siteKey);
    if (!RW.isValidDomain(key)) throw new Error('invalid_site');
    const all = Object.assign({}, state.pageEdits || {});
    const next = fn((all[key] || []).map((e) => clone(e)));
    if (next.length) all[key] = next; else delete all[key];
    return Object.assign({}, state, { pageEdits: RW.sanitizePageEdits(all) });
  }

  // Adds or replaces an edit by id. At the limit, the oldest automatic fix makes room first, then the oldest edit.
  function savePageEdit(state, siteKey, edit) {
    const e = RW.sanitizePageEdit(edit);
    if (!e) throw new Error('invalid_edit');
    return withPageEdits(state, siteKey, (list) => {
      const i = list.findIndex((x) => x.id === e.id);
      if (i >= 0) { list[i] = e; return list; }
      if (list.length >= RW.PAGE_EDITS_MAX_PER_SITE) {
        const auto = list.findIndex((x) => x.source === 'automatic');
        list.splice(auto >= 0 ? auto : 0, 1);
      }
      list.push(e);
      return list;
    });
  }

  function setPageEditEnabled(state, siteKey, id, enabled) {
    return withPageEdits(state, siteKey, (list) => {
      const e = list.find((x) => x.id === id);
      if (!e) throw new Error('unknown_edit');
      e.enabled = enabled === true;
      return list;
    });
  }

  function deletePageEdit(state, siteKey, id) {
    return withPageEdits(state, siteKey, (list) => list.filter((x) => x.id !== id));
  }

  function pageEditsFor(state, siteKey) {
    const key = RW.siteKeyForHost(siteKey || '');
    return (state.pageEdits && state.pageEdits[key]) || [];
  }

  function aiSite(map, siteKey) {
    return (map && map[siteKey]) || {};
  }

  // The whole remembered entry (action and, for cookie banners, the label clicked).
  function recallAiEntry(state, siteKey, key, epoch, now) {
    const e = aiSite(state.aiMemory.decisions, siteKey)[key];
    if (!e || e.epoch !== epoch || finiteOr(now, Date.now()) - e.at > AI_DECISION_TTL) return null;
    return Object.assign({}, e);
  }

  function recallAiDecision(state, siteKey, key, epoch, now) {
    const e = aiSite(state.aiMemory.decisions, siteKey)[key];
    if (!e || e.epoch !== epoch || finiteOr(now, Date.now()) - e.at > AI_DECISION_TTL) return null;
    return e.action;
  }

  function isAiUndone(state, siteKey, signature, now) {
    const exp = aiSite(state.aiMemory.undone, siteKey)[signature];
    return !!exp && exp > finiteOr(now, Date.now());
  }

  function withAiMemory(state, part, siteKey, fn, now) {
    const mem = clone(state.aiMemory);
    const site = Object.assign({}, mem[part][siteKey] || {});
    fn(site);
    const keys = Object.keys(site);
    if (keys.length > AI_MAX_PER_SITE) for (const k of keys.slice(0, keys.length - AI_MAX_PER_SITE)) delete site[k];
    if (Object.keys(site).length) mem[part][siteKey] = site; else delete mem[part][siteKey];
    return Object.assign({}, state, { aiMemory: sanitizeAiMemory(mem, now) });
  }

  function rememberAiDecision(state, siteKey, key, action, epoch, now, label) {
    return withAiMemory(state, 'decisions', siteKey, (site) => {
      delete site[key];
      site[key] = Object.assign({ action, at: finiteOr(now, Date.now()), epoch }, label ? { label } : {});
    }, now);
  }

  function forgetAiDecision(state, siteKey, key, now) {
    return withAiMemory(state, 'decisions', siteKey, (site) => { delete site[key]; }, now);
  }

  function clearAiUndone(state, siteKey, signature, now) {
    return withAiMemory(state, 'undone', siteKey, (site) => { delete site[signature]; }, now);
  }

  function markAiUndone(state, siteKey, signature, now) {
    const t = finiteOr(now, Date.now());
    let next = withAiMemory(state, 'undone', siteKey, (site) => { site[signature] = t + AI_UNDO_TTL; }, t);
    next = withAiMemory(next, 'decisions', siteKey, (site) => {
      for (const k of Object.keys(site)) if (k.endsWith(`|${signature}`)) delete site[k];
    }, t);
    return next;
  }

  function clearAiMemory(state) {
    return Object.assign({}, state, { aiMemory: { decisions: {}, undone: {} } });
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
    OPERATING_MODES,
    NEWSLETTER_CHOICES,
    COOKIE_AI_CHOICES,
    AI_DECISION_TTL,
    AI_UNDO_TTL,
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
    runtimeCapabilities,
    settingsEpoch,
    sanitizeAiMemory,
    setSiteNewsletter,
    setSiteCookieBannerAi,
    restoreSiteProfile,
    setOperatingMode,
    setAiAutoOptimise,
    setAiPageSettings,
    setSitePageFixes,
    markSitePrivate,
    sanitizeAiSettings,
    savePageEdit,
    setPageEditEnabled,
    deletePageEdit,
    pageEditsFor,
    PAGE_FIX_MODES,
    recallAiDecision,
    recallAiEntry,
    forgetAiDecision,
    clearAiUndone,
    rememberAiDecision,
    isAiUndone,
    markAiUndone,
    clearAiMemory,
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
