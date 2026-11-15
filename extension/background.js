// Rockyweb service worker: storage, network rules, tracker learning, messaging.
importScripts(
  'shared/constants.js',
  'shared/domain.js',
  'shared/filter-lists.js',
  'shared/config.js',
  'shared/rules-compiler.js',
  'shared/cosmetic-lists.js',
  'shared/ai-policy.js',
  'engines/cmp-main-world.js',
  'engines/ai-broker.js'
);

const RW = self.RockyShared;
const A = RW.ACTIONS;
const EXT_ORIGIN = chrome.runtime.getURL('');
const STATIC_RULESETS = ['ads', 'trackers'];
const noop = () => {};
const log = (...args) => console.info('[Rockyweb]', ...args);
const warn = (...args) => console.warn('[Rockyweb]', ...args);

// ---- state store

let state = null;
let loadPromise = null;
let configCache = new Map();

function loadState() {
  if (state) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = chrome.storage.local.get(null).then((raw) => {
      if (!state) {
        state = RW.normalizeState(raw);
        if (raw.schemaVersion !== state.schemaVersion) persist(RW.STORAGE_KEYS);
      }
      return state;
    });
  }
  return loadPromise;
}

let writeChain = Promise.resolve();
function persist(keys) {
  const snapshot = {};
  for (const k of keys) snapshot[k] = state[k];
  writeChain = writeChain
    .then(() => chrome.storage.local.set(snapshot))
    .catch((err) => warn('storage write failed', err));
  return writeChain;
}

const dirtyKeys = new Set();
let flushTimer = 0;
function markDirty(key, delay) {
  dirtyKeys.add(key);
  if (!flushTimer) flushTimer = setTimeout(flushDirty, delay || 2000);
}
function flushDirty() {
  flushTimer = 0;
  const keys = [...dirtyKeys];
  dirtyKeys.clear();
  if (keys.length) persist(keys);
}

function configFor(hostOrSite) {
  const key = hostOrSite || '';
  let cfg = configCache.get(key);
  if (!cfg) {
    cfg = RW.getEffectiveConfig(state, key);
    configCache.set(key, cfg);
  }
  return cfg;
}

async function update(mutator, keys, opts) {
  await loadState();
  const next = mutator(state);
  state = next;
  configCache = new Map();
  await persist(keys);
  if (!opts || opts.rules !== false) await syncRules();
  if (!opts || !opts.quiet) {
    refreshOpenTabs();
    announceSettingsChange();
  }
  return state;
}

// ---- automatic optimisation (model broker, per-tab cancellation)

const broker = RW.createAiBroker();
const aiJobs = new Map(); // tabId -> Set<AbortController>

function trackAiJob(tabId) {
  const ctrl = new AbortController();
  if (!aiJobs.has(tabId)) aiJobs.set(tabId, new Set());
  aiJobs.get(tabId).add(ctrl);
  return ctrl;
}

function untrackAiJob(tabId, ctrl) {
  const set = aiJobs.get(tabId);
  if (set) { set.delete(ctrl); if (!set.size) aiJobs.delete(tabId); }
}

function cancelAiForTab(tabId) {
  const set = aiJobs.get(tabId);
  if (!set) return;
  for (const c of set) c.abort();
  aiJobs.delete(tabId);
}

function cancelAllAi() {
  for (const tabId of [...aiJobs.keys()]) cancelAiForTab(tabId);
  broker.cancelQueued();
  broker.release();
}

// Tell open tabs that settings changed so they drop stale work (debounced).
let announceTimer = 0;
function announceSettingsChange() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(async () => {
    const list = await chrome.tabs.query({}).catch(() => []);
    for (const t of list) {
      if (typeof t.id === 'number' && t.id >= 0) chrome.tabs.sendMessage(t.id, { action: A.MODE_CHANGED, payload: {} }).catch(noop);
    }
  }, 150);
}

// ---- declarativenetrequest synchronisation

let rulesChain = Promise.resolve();
let rulesTimer = 0;

function syncRules() {
  rulesChain = rulesChain.then(applyRules, applyRules);
  return rulesChain;
}

function scheduleRulesSync(delay) {
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(() => { syncRules().catch(noop); }, delay || 1500);
}

async function applyRules() {
  await loadState();
  const rules = RW.compileDynamicRules(state);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  } catch (err) {
    // Never leave the user without protection because one rule was rejected.
    warn('dynamic rule update rejected, retrying rule-by-rule', err);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] }).catch(noop);
    for (const rule of rules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
      } catch (e) {
        warn('rule skipped', rule, e);
      }
    }
  }
  const wantStatic = RW.needsStaticRulesets(state);
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const enableRulesetIds = wantStatic ? STATIC_RULESETS.filter((id) => !enabled.includes(id)) : [];
  const disableRulesetIds = wantStatic ? [] : STATIC_RULESETS.filter((id) => enabled.includes(id));
  if (enableRulesetIds.length || disableRulesetIds.length) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  }
}

// ---- per-tab activity

const tabs = new Map();
let tabsLoad = null;
let tabsTimer = 0;
const MAX_DOMAINS_PER_TAB = 250;

function loadTabs() {
  if (!tabsLoad) {
    tabsLoad = chrome.storage.session.get('tabActivity').then((r) => {
      for (const [id, rec] of Object.entries((r && r.tabActivity) || {})) {
        if (!tabs.has(Number(id))) tabs.set(Number(id), rec);
      }
    }).catch(noop);
  }
  return tabsLoad;
}

function saveTabsSoon() {
  if (tabsTimer) return;
  tabsTimer = setTimeout(() => {
    tabsTimer = 0;
    const obj = {};
    // Private tabs (and tabs not yet identified) are never written anywhere.
    for (const [id, rec] of tabs) if (rec.incognito === false) obj[id] = rec;
    chrome.storage.session.set({ tabActivity: obj }).catch(noop);
  }, 1000);
}

const ready = () => Promise.all([loadState(), loadTabs()]);

function newTabRecord(url) {
  const host = RW.hostFromUrl(url);
  const cfg = configFor(host);
  return {
    hostname: RW.normalizeHost(host),
    siteKey: cfg.siteKey,
    tier: cfg.tier,
    incognito: null,
    ads: 0,
    trackers: 0,
    popup: null,
    domains: {},
    adjustments: []
  };
}

function startTabRecord(tabId, url) {
  cancelAiForTab(tabId);
  const rec = newTabRecord(url);
  tabs.set(tabId, rec);
  chrome.tabs.get(tabId).then((t) => { rec.incognito = !!t.incognito; saveTabsSoon(); }, noop);
  updateBadge(tabId);
  saveTabsSoon();
}

function touchDomain(rec, base, host) {
  let dom = rec.domains[base];
  if (!dom) {
    if (Object.keys(rec.domains).length >= MAX_DOMAINS_PER_TAB) return null;
    dom = rec.domains[base] = { requests: 0, blocked: 0, cookies: false, restricted: false, hosts: [] };
  }
  if (host && dom.hosts.length < 5 && !dom.hosts.includes(host)) dom.hosts.push(host);
  return dom;
}

function refreshOpenTabs() {
  for (const [tabId, rec] of tabs) {
    if (!rec.siteKey) continue;
    rec.tier = configFor(rec.siteKey).tier;
    updateBadge(tabId);
  }
  saveTabsSoon();
}

const badgeTimers = new Map();
function updateBadge(tabId) {
  if (badgeTimers.has(tabId)) return;
  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    const rec = tabs.get(tabId);
    if (!rec) return;
    const n = rec.ads + rec.trackers;
    const meta = RW.TIER_META[rec.tier] || RW.TIER_META.balanced;
    chrome.action.setBadgeText({ tabId, text: n ? (n > 999 ? '999+' : String(n)) : '' }).catch(noop);
    chrome.action.setBadgeBackgroundColor({ tabId, color: meta.color }).catch(noop);
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId, color: '#0B0C0E' }).catch(noop);
    chrome.action.setTitle({ tabId, title: `Rockyweb · ${meta.name}${rec.hostname ? ` on ${rec.hostname}` : ''}` }).catch(noop);
  }, 300));
}

// ---- network observation

const WEB_FILTER = { urls: ['http://*/*', 'https://*/*'] };

function thirdPartyContext(d) {
  const rec = tabs.get(d.tabId);
  if (!rec || !rec.siteKey) return null;
  const host = RW.hostFromUrl(d.url);
  const base = RW.baseDomain(host);
  if (!base || base === rec.siteKey || RW.sameEntity(base, rec.siteKey)) return null;
  const dom = touchDomain(rec, base, host);
  if (!dom) return null;
  return { rec, host, base, dom };
}

function headerValues(headers, name) {
  if (!headers) return [];
  return headers.filter((h) => h.name && h.name.toLowerCase() === name).map((h) => h.value || '');
}

// An identifying cookie: not infrastructure noise, and long and varied enough to be an ID.
function isIdentifyingCookie(name, value) {
  if (!name || RW.isBenignCookieName(name)) return false;
  const v = String(value || '').trim();
  if (v.length < 8) return false;
  if (/^(true|false|null|undefined|yes|no|[01])$/i.test(v)) return false;
  return new Set(v).size >= 6;
}

function cookieHeaderHasId(value) {
  return value.split(';').some((pair) => {
    const i = pair.indexOf('=');
    return i > 0 && isIdentifyingCookie(pair.slice(0, i).trim(), pair.slice(i + 1));
  });
}

function setCookieHasId(value) {
  // Chrome may fold multiple Set-Cookie headers with newlines.
  return value.split('\n').some((line) => {
    const first = line.split(';')[0];
    const i = first.indexOf('=');
    return i > 0 && isIdentifyingCookie(first.slice(0, i).trim(), first.slice(i + 1));
  });
}

function learnFrom(ctx) {
  if (ctx.rec.incognito !== false) return; // never learn from private (or unidentified) tabs
  const cfg = configFor(ctx.rec.siteKey);
  if (!RW.runtimeCapabilities(cfg, { incognito: false }).learning) return;
  if (RW.isNeverRestrict(ctx.base)) return;
  const res = RW.learnTracker(state, ctx.base, ctx.rec.siteKey, Date.now());
  if (res.changed) markDirty('learnedTrackers', 3000);
  if (res.promoted) {
    log(`learned tracker: ${ctx.base} (seen on ${RW.LEARN_THRESHOLD}+ sites)`);
    configCache = new Map();
    scheduleRulesSync(1500);
  }
}

function countRestriction(ctx, tabId) {
  if (ctx.dom.restricted) return;
  const { action } = RW.domainActionFor(state, configFor(ctx.rec.siteKey), ctx.host);
  if (action !== 'cookie_block') return;
  ctx.dom.restricted = true;
  ctx.rec.trackers++;
  state.stats.totalTrackersRestricted++;
  markDirty('stats');
  updateBadge(tabId);
}

function onBeforeAny(d) {
  if (d.tabId < 0) return;
  ready().then(() => {
    if (d.type === 'main_frame') {
      if (d.documentLifecycle !== 'prerender') startTabRecord(d.tabId, d.url);
      return;
    }
    const ctx = thirdPartyContext(d);
    if (!ctx) return;
    ctx.dom.requests++;
    saveTabsSoon();
  }).catch(noop);
}

// Light mode keeps only this: one event per top-level navigation.
function onBeforeMainFrame(d) {
  if (d.tabId < 0 || d.documentLifecycle === 'prerender') return;
  ready().then(() => startTabRecord(d.tabId, d.url)).catch(noop);
}

function onSendHeaders(d) {
  if (d.tabId < 0 || d.type === 'main_frame') return;
  ready().then(() => {
    const ctx = thirdPartyContext(d);
    if (!ctx) return;
    const cookie = headerValues(d.requestHeaders, 'cookie').join('; ');
    if (cookie && cookieHeaderHasId(cookie)) {
      ctx.dom.cookies = true;
      learnFrom(ctx);
    }
    countRestriction(ctx, d.tabId);
  }).catch(noop);
}

function onHeadersReceived(d) {
  if (d.tabId < 0 || d.type === 'main_frame') return;
  ready().then(() => {
    const values = headerValues(d.responseHeaders, 'set-cookie');
    if (!values.length || !values.some(setCookieHasId)) return;
    const ctx = thirdPartyContext(d);
    if (!ctx) return;
    ctx.dom.cookies = true;
    learnFrom(ctx);
  }).catch(noop);
}

function onRequestError(d) {
  if (d.tabId < 0 || d.type === 'main_frame' || d.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
  ready().then(() => {
    const rec = tabs.get(d.tabId);
    if (!rec || !rec.siteKey) return;
    const host = RW.hostFromUrl(d.url);
    const { action, source } = RW.domainActionFor(state, configFor(rec.siteKey), host);
    if (action !== 'block') return; // blocked by another extension, not by us
    const ctx = thirdPartyContext(d);
    if (ctx) ctx.dom.blocked++;
    if (source === 'filter_list' && RW.isListedAd(host)) {
      rec.ads++;
      state.stats.totalAdsBlocked++;
    } else {
      rec.trackers++;
      state.stats.totalTrackersRestricted++;
    }
    markDirty('stats');
    updateBadge(d.tabId);
    saveTabsSoon();
  }).catch(noop);
}

const MAIN_FRAME_FILTER = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] };
let observing = 'full';

// Full mode watches every request and its headers (tracker learning); Light only watches navigations.
function applyObservationMode() {
  const want = state && state.operatingMode === 'light' ? 'light' : 'full';
  if (want === observing) return;
  const wr = chrome.webRequest;
  if (want === 'light') {
    wr.onBeforeRequest.removeListener(onBeforeAny);
    wr.onSendHeaders.removeListener(onSendHeaders);
    wr.onHeadersReceived.removeListener(onHeadersReceived);
    wr.onBeforeRequest.addListener(onBeforeMainFrame, MAIN_FRAME_FILTER);
    for (const rec of tabs.values()) rec.domains = {};
  } else {
    wr.onBeforeRequest.removeListener(onBeforeMainFrame);
    wr.onBeforeRequest.addListener(onBeforeAny, WEB_FILTER);
    wr.onSendHeaders.addListener(onSendHeaders, WEB_FILTER, ['requestHeaders', 'extraHeaders']);
    wr.onHeadersReceived.addListener(onHeadersReceived, WEB_FILTER, ['responseHeaders', 'extraHeaders']);
  }
  observing = want;
}

// Listeners must be registered synchronously at start-up; Light mode detaches them once state loads.
chrome.webRequest.onBeforeRequest.addListener(onBeforeAny, WEB_FILTER);
chrome.webRequest.onSendHeaders.addListener(onSendHeaders, WEB_FILTER, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, WEB_FILTER, ['responseHeaders', 'extraHeaders']);
chrome.webRequest.onErrorOccurred.addListener(onRequestError, WEB_FILTER);
loadState().then(applyObservationMode).catch(noop);

chrome.tabs.onRemoved.addListener((tabId) => {
  cancelAiForTab(tabId);
  tabs.delete(tabId);
  saveTabsSoon();
});

// ---- message handlers

const FROM_CONTENT = 'content';
const FROM_PAGE = 'page';

function senderKind(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return null;
  if (typeof sender.url === 'string' && sender.url.startsWith(EXT_ORIGIN)) return FROM_PAGE;
  if (sender.tab && typeof sender.tab.id === 'number' && typeof sender.frameId === 'number') return FROM_CONTENT;
  return null;
}

// Site profiles follow the top-level page, so frames use the tab URL.
function topUrlOf(sender) {
  if (sender.tab && sender.tab.url) return sender.tab.url;
  return sender.frameId === 0 ? sender.url : '';
}

function frameTarget(sender) {
  return sender.documentId
    ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
    : { tabId: sender.tab.id, frameIds: [sender.frameId] };
}

// Content scripts only get what they need.
function contentConfig(cfg, incognito) {
  const caps = RW.runtimeCapabilities(cfg, { incognito });
  return {
    supported: cfg.supported,
    hostname: cfg.hostname,
    siteKey: cfg.siteKey,
    tier: cfg.tier,
    consentMode: cfg.consentMode,
    showToastBadge: cfg.showToastBadge,
    light: cfg.operatingMode === 'light',
    consentDepth: caps.consent,
    newsletter: caps.newsletter,
    epoch: RW.settingsEpoch(cfg)
  };
}

const isIncognito = (sender) => !!(sender.tab && sender.tab.incognito);

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 200) : '');

const HANDLERS = {
  [A.GET_EFFECTIVE_CONFIG]: {
    from: [FROM_CONTENT, FROM_PAGE],
    fn: async (p, sender, kind) => {
      if (kind === FROM_PAGE) {
        return { config: RW.getEffectiveConfig(state, str(p.hostname, 253) || null) };
      }
      const host = RW.hostFromUrl(topUrlOf(sender));
      const cfg = configFor(host);
      return {
        config: contentConfig(cfg, isIncognito(sender)),
        intent: RW.consentIntent(cfg),
        hasCosmetics: RW.buildCosmeticSelectors(cfg, cfg.hostname).length > 0
      };
    }
  },

  [A.APPLY_COSMETICS]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
      const selectors = RW.buildCosmeticSelectors(cfg, cfg.hostname);
      if (!selectors.length) return { applied: 0 };
      await chrome.scripting.insertCSS({ target: frameTarget(sender), css: RW.buildCosmeticCss(selectors), origin: 'USER' });
      return { applied: selectors.length };
    }
  },

  [A.RUN_CMP_API]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) return { result: { handled: false, reason: 'subframe' } };
      const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
      const intent = RW.consentIntent(cfg);
      if (!intent) return { result: { handled: false, reason: 'disabled' } };
      // Poll with short injections; a single long-running one would delay the page's load event.
      // Light mode makes a single attempt.
      let raw = null;
      const light = cfg.operatingMode === 'light';
      const deadline = Date.now() + (light ? 0 : 8000);
      for (let first = true; first || Date.now() < deadline; first = false) {
        try {
          const [res] = await chrome.scripting.executeScript({
            target: frameTarget(sender),
            world: 'MAIN',
            injectImmediately: true,
            func: self.rockywebCmpMainWorld,
            args: [{ categories: intent.categories, decision: intent.decision }]
          });
          raw = res && res.result;
        } catch (err) {
          return { result: { handled: false, reason: 'inject_failed' } };
        }
        if (!raw || raw.reason !== 'not_found' || light) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      // The result comes from page-controlled JS: sanitise every field.
      const r = raw && typeof raw === 'object' ? raw : {};
      return {
        result: {
          handled: r.handled === true,
          cmp: RW.KNOWN_CMP_NAMES.includes(r.cmp) ? r.cmp : null,
          method: 'api',
          decision: ['reject', 'accept', 'custom'].includes(r.decision) ? r.decision : intent.decision,
          reason: str(r.reason, 40)
        }
      };
    }
  },

  [A.CONSENT_HANDLED]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      const info = {
        cmp: RW.KNOWN_CMP_NAMES.includes(p.cmp) ? p.cmp : 'Generic',
        method: ['api', 'dom', 'heuristic', 'hidden'].includes(p.method) ? p.method : 'dom',
        decision: ['reject', 'accept', 'custom'].includes(p.decision) ? p.decision : 'reject',
        at: Date.now()
      };
      const tabId = sender.tab.id;
      const rec = tabs.get(tabId);
      if (rec && rec.popup) return { counted: false };
      if (rec) rec.popup = info;
      state.stats.totalPopupsHandled++;
      markDirty('stats');
      saveTabsSoon();
      if (sender.frameId !== 0) {
        const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
        chrome.tabs.sendMessage(tabId, {
          action: A.CONSENT_FOLLOWUP,
          payload: Object.assign({ fromSubframe: true, showToast: cfg.showToastBadge }, info)
        }, { frameId: 0 }).catch(noop);
      }
      return { counted: true };
    }
  },

  [A.PICKER_ADD_SELECTOR]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) throw new Error('top_frame_only');
      const siteKey = RW.siteKeyForUrl(topUrlOf(sender));
      if (!RW.isValidDomain(siteKey)) throw new Error('unsupported_site');
      const selector = str(p.selector, 600).trim();
      await update((s) => RW.addCosmeticSelector(s, siteKey, selector, Date.now()), ['siteProfiles'], { rules: false });
      await chrome.scripting.insertCSS({ target: frameTarget(sender), css: RW.buildCosmeticCss([selector]), origin: 'USER' }).catch(noop);
      return { siteKey };
    }
  },

  [A.PICKER_REMOVE_SELECTOR]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) throw new Error('top_frame_only');
      const siteKey = RW.siteKeyForUrl(topUrlOf(sender));
      if (!RW.isValidDomain(siteKey)) throw new Error('unsupported_site');
      const selector = str(p.selector, 600).trim();
      await update((s) => RW.removeCosmeticSelector(s, siteKey, selector, Date.now()), ['siteProfiles'], { rules: false });
      await chrome.scripting.removeCSS({ target: frameTarget(sender), css: RW.buildCosmeticCss([selector]), origin: 'USER' }).catch(noop);
      return { siteKey };
    }
  },

  [A.AI_EVALUATE_CANDIDATE]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      const leave = (source, reason, epoch) => ({ outcome: 'leave_unchanged', source, reason, epoch });
      if (sender.frameId !== 0) return leave('rule', 'subframe');
      const sig = RW.sanitizeSignals(p.signals);
      if (!sig) throw new Error('invalid_candidate');
      const host = RW.hostFromUrl(topUrlOf(sender));
      const cfg = configFor(host);
      const caps = RW.runtimeCapabilities(cfg, { incognito: isIncognito(sender) });
      const epoch = RW.settingsEpoch(cfg);
      const verdict = RW.localVerdict(sig);
      if (verdict.outcome !== 'ask') return leave('rule', verdict.reason, epoch);
      if (caps.newsletter === 'hide') return { outcome: 'hide_overlay', source: 'your_choice', epoch };
      if (caps.newsletter !== 'ai') return leave('rule', 'not_enabled', epoch);
      if (!RW.modelMayDecide(sig)) return leave('rule', 'not_article', epoch);
      if (RW.isAiUndone(state, cfg.siteKey, sig.signature)) return leave('rule', 'undone_before', epoch);
      const key = RW.decisionKey(sig);
      const remembered = RW.recallAiDecision(state, cfg.siteKey, key, epoch);
      if (remembered) return { outcome: remembered, source: 'memory', epoch };
      const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
      if (!tab || !tab.active) return leave('rule', 'background_tab', epoch);

      const ctrl = trackAiJob(sender.tab.id);
      let res;
      try {
        res = await broker.prompt({
          key: `${sender.tab.id}|${sender.documentId || ''}|${key}`,
          prompt: RW.buildPrompt(sig),
          schema: RW.responseSchema(sig.id),
          signal: ctrl.signal
        });
      } finally {
        untrackAiJob(sender.tab.id, ctrl);
      }
      if (!res.ok) return leave('model_unavailable', res.reason, epoch);
      const decision = RW.parseDecision(res.text, sig.id);
      if (!decision) { broker.stats.invalid++; return leave('rule', 'invalid_output', epoch); }
      if (RW.settingsEpoch(configFor(host)) !== epoch) return leave('rule', 'settings_changed', epoch);
      await update((st) => RW.rememberAiDecision(st, cfg.siteKey, key, decision.action, epoch, Date.now()), ['aiMemory'], { rules: false, quiet: true });
      return { outcome: decision.action, source: 'model', epoch };
    }
  },

  [A.AI_ADJUSTMENT_APPLIED]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) throw new Error('top_frame_only');
      const rec = tabs.get(sender.tab.id);
      if (!rec) return {};
      const id = /^a[0-9a-z]{4,12}$/.test(p.id) ? p.id : null;
      const signature = /^[a-z0-9:|._-]{1,120}$/.test(p.signature) ? p.signature : null;
      if (!id || !signature) throw new Error('invalid_adjustment');
      rec.adjustments = (rec.adjustments || []).filter((a) => a.id !== id).slice(-9);
      rec.adjustments.push({
        id,
        signature,
        kind: RW.AI_KIND,
        source: ['model', 'memory', 'your_choice'].includes(p.source) ? p.source : 'model',
        at: Date.now()
      });
      saveTabsSoon();
      return {};
    }
  },

  [A.AI_UNDO_ADJUSTMENT]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const tabId = Number(p.tabId);
      const rec = tabs.get(tabId);
      const adj = rec && (rec.adjustments || []).find((a) => a.id === p.id);
      if (!adj) throw new Error('not_found');
      await chrome.tabs.sendMessage(tabId, { action: A.AI_REVERT, payload: { id: adj.id } }, { frameId: 0 }).catch(noop);
      rec.adjustments = rec.adjustments.filter((a) => a.id !== adj.id);
      saveTabsSoon();
      // Remember the undo so the same overlay is not hidden again on later visits.
      if (adj.source !== 'your_choice') {
        await update((st) => RW.markAiUndone(st, rec.siteKey, adj.signature, Date.now()), ['aiMemory'], { rules: false, quiet: true });
      }
      return {};
    }
  },

  [A.AI_SITE_OPT_OUT]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const tabId = Number(p.tabId);
      const rec = tabs.get(tabId);
      if (!rec || !rec.siteKey) throw new Error('not_found');
      for (const adj of rec.adjustments || []) {
        await chrome.tabs.sendMessage(tabId, { action: A.AI_REVERT, payload: { id: adj.id } }, { frameId: 0 }).catch(noop);
      }
      rec.adjustments = [];
      saveTabsSoon();
      await update((st) => RW.setSiteNewsletter(st, rec.siteKey, 'keep', Date.now()), ['siteProfiles'], { rules: false });
      return {};
    }
  },

  [A.GET_AI_STATUS]: {
    from: [FROM_PAGE],
    fn: async () => ({
      availability: await broker.availability(),
      preference: !!state.aiSettings.autoOptimise,
      operatingMode: state.operatingMode,
      stats: Object.assign({}, broker.stats),
      hasSession: broker.hasSession,
      pending: broker.pending
    })
  },

  [A.SET_AI_AUTO_OPTIMISE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const enabled = p.enabled === true;
      if (!enabled) cancelAllAi();
      await update((st) => RW.setAiAutoOptimise(st, enabled), ['aiSettings'], { rules: false });
      return {};
    }
  },

  [A.CLEAR_AI_MEMORY]: {
    from: [FROM_PAGE],
    fn: async () => {
      await update((st) => RW.clearAiMemory(st), ['aiMemory'], { rules: false });
      return {};
    }
  },

  [A.SET_OPERATING_MODE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      if (p.mode === 'light') cancelAllAi();
      await update((st) => RW.setOperatingMode(st, p.mode), ['operatingMode'], { rules: false });
      applyObservationMode();
      return {};
    }
  },

  [A.SET_SITE_NEWSLETTER]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((st) => RW.setSiteNewsletter(st, str(p.siteKey, 253), p.value, Date.now()), ['siteProfiles'], { rules: false });
      return {};
    }
  },

  [A.RESTORE_SITE_PROFILE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const profile = p.profile && typeof p.profile === 'object' ? p.profile : null;
      await update((st) => RW.restoreSiteProfile(st, str(p.siteKey, 253), profile, Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.GET_POPUP_STATE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const tab = await chrome.tabs.get(Number(p.tabId));
      const host = RW.hostFromUrl(tab.url || '');
      if (!host) return { supported: false, url: str(tab.url || '', 300), totals: state.stats, globalDefaultTier: state.globalDefaultTier, operatingMode: state.operatingMode };
      const cfg = RW.getEffectiveConfig(state, host);
      const profile = state.siteProfiles[cfg.siteKey] || null;
      const recRaw = tabs.get(tab.id);
      const rec = recRaw && recRaw.siteKey === cfg.siteKey ? recRaw : null;
      const trackers = rec ? Object.entries(rec.domains).map(([domain, dom]) => {
        const learned = state.learnedTrackers[domain];
        const act = RW.domainActionFor(state, cfg, dom.hosts[0] || domain);
        return {
          domain,
          hosts: dom.hosts,
          requests: dom.requests,
          blocked: dom.blocked,
          cookies: dom.cookies,
          action: act.action,
          source: act.source,
          override: cfg.domainSliderOverrides[domain] || null,
          seenOn: learned ? learned.firstPartyHosts.length : 0,
          learnedStatus: learned ? learned.learnedStatus : null,
          globalOverride: learned ? learned.globalManualOverride : null
        };
      }) : [];
      const rank = { block: 0, cookie_block: 1, allow: 2 };
      trackers.sort((a, b) => rank[a.action] - rank[b.action] || b.seenOn - a.seenOn || b.requests - a.requests || a.domain.localeCompare(b.domain));
      return {
        supported: true,
        tabId: tab.id,
        hostname: cfg.hostname,
        siteKey: cfg.siteKey,
        config: cfg,
        profile,
        globalDefaultTier: state.globalDefaultTier,
        globalConfig: RW.getEffectiveConfig(state, null),
        tabStats: rec ? { ads: rec.ads, trackers: rec.trackers, popup: rec.popup } : { ads: 0, trackers: 0, popup: null },
        trackers: trackers.slice(0, 150),
        totals: state.stats,
        operatingMode: state.operatingMode,
        capabilities: RW.runtimeCapabilities(cfg, { incognito: !!tab.incognito }),
        incognito: !!tab.incognito,
        adjustments: rec ? (rec.adjustments || []).map((a) => ({ id: a.id, kind: a.kind, source: a.source, at: a.at })) : []
      };
    }
  },

  [A.GET_OPTIONS_STATE]: {
    from: [FROM_PAGE],
    fn: async () => {
      const [dynamicRules, enabledRulesets] = await Promise.all([
        chrome.declarativeNetRequest.getDynamicRules(),
        chrome.declarativeNetRequest.getEnabledRulesets()
      ]);
      return {
        state: JSON.parse(JSON.stringify(state)),
        diagnostics: { dynamicRuleCount: dynamicRules.length, enabledRulesets, version: chrome.runtime.getManifest().version }
      };
    }
  },

  [A.SET_SITE_TIER]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.setSiteTier(s, str(p.siteKey, 253), p.tier, Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.SET_SITE_CUSTOM_OPTION]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.setSiteCustomOption(s, str(p.siteKey, 253), p.key, p.value, Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.RESET_SITE_PROFILE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.resetSiteProfile(s, str(p.siteKey, 253), Date.now(), { keepRules: p.keepRules === true }), ['siteProfiles']);
      return {};
    }
  },

  [A.DELETE_SITE_PROFILE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.deleteSiteProfile(s, str(p.siteKey, 253)), ['siteProfiles']);
      return {};
    }
  },

  [A.SET_DOMAIN_SLIDER]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const value = p.value === null ? null : p.value;
      await update((s) => RW.setDomainSlider(s, str(p.siteKey, 253), str(p.domain, 253), value, Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.SET_GLOBAL_TIER]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.setGlobalTier(s, p.tier), ['globalDefaultTier', 'globalCustomConfig']);
      return {};
    }
  },

  [A.SET_GLOBAL_CUSTOM_OPTION]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.setGlobalCustomOption(s, p.key, p.value), ['globalDefaultTier', 'globalCustomConfig']);
      return {};
    }
  },

  [A.SET_TRACKER_GLOBAL_OVERRIDE]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const value = p.value === null ? null : p.value;
      await update((s) => RW.setTrackerGlobalOverride(s, str(p.domain, 253), value, Date.now()), ['learnedTrackers']);
      return {};
    }
  },

  [A.FORGET_TRACKER]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.forgetTracker(s, str(p.domain, 253)), ['learnedTrackers']);
      return {};
    }
  },

  [A.RESET_LEARNED_TRACKERS]: {
    from: [FROM_PAGE],
    fn: async () => {
      await update((s) => RW.resetLearnedTrackers(s), ['learnedTrackers']);
      return {};
    }
  },

  [A.ADD_COSMETIC_SELECTOR]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.addCosmeticSelector(s, str(p.siteKey, 253), str(p.selector, 600), Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.REMOVE_COSMETIC_SELECTOR]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((s) => RW.removeCosmeticSelector(s, str(p.siteKey, 253), str(p.selector, 600), Date.now()), ['siteProfiles']);
      return {};
    }
  },

  [A.EXPORT_SETTINGS]: {
    from: [FROM_PAGE],
    fn: async () => ({
      data: Object.assign({ exportedBy: 'Rockyweb', exportedAt: new Date().toISOString() }, JSON.parse(JSON.stringify(state)))
    })
  },

  [A.IMPORT_SETTINGS]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      let data = p.data;
      if (typeof data === 'string') {
        if (data.length > 8 * 1024 * 1024) throw new Error('file_too_large');
        data = JSON.parse(data);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_file');
      await update((s) => {
        const next = RW.normalizeState(data);
        if (!data.stats) next.stats = s.stats;
        return next;
      }, RW.STORAGE_KEYS);
      return { sites: Object.keys(state.siteProfiles).length, trackers: Object.keys(state.learnedTrackers).length };
    }
  },

  [A.RESET_STATS]: {
    from: [FROM_PAGE],
    fn: async () => {
      await update((s) => Object.assign({}, s, { stats: RW.normalizeState({}).stats }), ['stats'], { rules: false });
      return {};
    }
  },

  [A.RESET_ALL]: {
    from: [FROM_PAGE],
    fn: async () => {
      cancelAllAi();
      tabs.clear();
      clearTimeout(tabsTimer);
      tabsTimer = 0;
      await chrome.storage.session.clear().catch(noop);
      await chrome.storage.local.clear();
      await update(() => RW.createDefaultState(), RW.STORAGE_KEYS);
      applyObservationMode();
      await chrome.action.setBadgeText({ text: '' }).catch(noop);
      const open = await chrome.tabs.query({}).catch(() => []);
      for (const t of open) if (typeof t.id === 'number' && t.id >= 0) chrome.action.setBadgeText({ tabId: t.id, text: '' }).catch(noop);
      return {};
    }
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const kind = senderKind(sender);
  const handler = msg && typeof msg.action === 'string' ? HANDLERS[msg.action] : null;
  if (!kind || !handler) {
    sendResponse({ ok: false, error: kind ? 'unknown_action' : 'forbidden' });
    return false;
  }
  if (!handler.from.includes(kind)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
  ready()
    .then(() => handler.fn(payload, sender, kind))
    .then((res) => sendResponse(Object.assign({ ok: true }, res)))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // async response
});

// ---- lifecycle

chrome.runtime.onInstalled.addListener((details) => {
  loadState()
    .then(() => persist(RW.STORAGE_KEYS))
    .then(applyObservationMode)
    .then(syncRules)
    .then(() => log(`ready (${details.reason})`))
    .catch((err) => warn('install init failed', err));
});

chrome.runtime.onStartup.addListener(() => {
  loadState().then(syncRules).catch((err) => warn('startup sync failed', err));
});
