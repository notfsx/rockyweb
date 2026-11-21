// Rockyweb service worker: storage, network rules, tracker learning, messaging.
importScripts(
  'shared/constants.js',
  'shared/domain.js',
  'shared/filter-lists.js',
  'shared/config.js',
  'shared/rules-compiler.js',
  'shared/cosmetic-lists.js',
  'shared/ai-policy.js',
  'shared/page-edits.js',
  'shared/sync.js',
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
  if (!(opts && opts.fromSync) && keys.some((k) => SYNC_STATE_KEYS.includes(k))) scheduleSync();
  if (!opts || opts.rules !== false) await syncRules();
  if (!opts || !opts.quiet) {
    refreshOpenTabs();
    announceSettingsChange();
  }
  return state;
}

// ---- optional Chrome sync (off by default, shared/sync.js). Never trackers, stats or Incognito sites.

const SYNC_LOCAL_KEY = 'syncState';
const SYNC_STATE_KEYS = ['globalDefaultTier', 'globalCustomConfig', 'siteProfiles', 'aiSettings', 'pageEdits'];
const SYNC_DELAY = 5000; // at most one write every few seconds, well inside 120 a minute and 1800 an hour
let syncState = null;
let syncChain = Promise.resolve();
let syncTimer = 0;

async function loadSyncState() {
  if (syncState) return syncState;
  const raw = (await chrome.storage.local.get(SYNC_LOCAL_KEY).catch(() => ({})))[SYNC_LOCAL_KEY];
  syncState = Object.assign({ enabled: false, device: '', base: null, prefsAt: 0, lastPrefs: '', lastSyncAt: 0, lastError: '', bytes: 0, skipped: 0, backoffUntil: 0 },
    raw && typeof raw === 'object' ? raw : {});
  return syncState;
}

const saveSyncState = () => chrome.storage.local.set({ [SYNC_LOCAL_KEY]: syncState }).catch(noop);

function scheduleSync(delay) {
  if (syncState && !syncState.enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { runSync('change'); }, delay === undefined ? SYNC_DELAY : delay);
}

function runSync(reason) {
  syncChain = syncChain.then(() => syncOnce(reason)).catch((err) => {
    warn('sync failed', err);
    if (syncState) {
      syncState.lastError = String((err && err.message) || err).slice(0, 200);
      syncState.backoffUntil = Date.now() + 60000;
      saveSyncState();
      scheduleSync(60000);
    }
  });
  return syncChain;
}

async function syncOnce(reason) {
  await loadState();
  const ss = await loadSyncState();
  if (!ss.enabled) return;
  if (reason !== 'enable' && Date.now() < ss.backoffUntil) { scheduleSync(ss.backoffUntil - Date.now()); return; }
  const local = RW.syncView(state);
  const prefsText = JSON.stringify(local.prefs);
  if (prefsText !== ss.lastPrefs) ss.prefsAt = Date.now();
  const items = await chrome.storage.sync.get(null);
  const remote = RW.decodeSync(items);
  // Chrome sync can bring the pieces one at a time: wait for the rest.
  if (remote && remote.partial) { scheduleSync(10000); return; }
  const merged = remote ? RW.mergeSync(ss.base, local, remote.view, { localPrefsAt: ss.prefsAt, remotePrefsAt: remote.prefsAt }) : local;
  if (!RW.sameSyncView(merged, local)) {
    await update((st) => RW.applySyncView(st, merged), SYNC_STATE_KEYS, { fromSync: true });
  }
  const prefsAt = JSON.stringify(merged.prefs) === prefsText ? ss.prefsAt : (remote ? remote.prefsAt : ss.prefsAt);
  const enc = RW.encodeSync(merged, { device: ss.device, at: Date.now(), prefsAt });
  if (!enc.fits) throw new Error('sync_quota');
  if (!remote || enc.hash !== remote.meta.hash) {
    await chrome.storage.sync.set(enc.items);
    const stale = RW.syncStaleKeys(items, enc.items);
    if (stale.length) await chrome.storage.sync.remove(stale);
  }
  Object.assign(ss, { base: enc.view, prefsAt, lastPrefs: JSON.stringify(merged.prefs), lastSyncAt: Date.now(), lastError: '', bytes: enc.bytes, skipped: enc.skipped, backoffUntil: 0 });
  await saveSyncState();
}

function syncStatus() {
  const ss = syncState || {};
  const privateSites = Object.values((state && state.siteProfiles) || {}).filter((p) => p.private).length;
  return { enabled: !!ss.enabled, lastSyncAt: ss.lastSyncAt || 0, lastError: ss.lastError || '', bytes: ss.bytes || 0, quota: RW.SYNC_TOTAL_MAX, skipped: ss.skipped || 0, privateSites };
}

// Another device changed the synced copy.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !Object.keys(changes).some((k) => k.startsWith(RW.SYNC_PREFIX))) return;
  loadSyncState().then((ss) => {
    const meta = changes[RW.SYNC_META_KEY] && changes[RW.SYNC_META_KEY].newValue;
    if (!ss.enabled || (meta && meta.device === ss.device)) return;
    scheduleSync(1500);
  });
});
loadSyncState().then((ss) => { if (ss.enabled) scheduleSync(3000); }).catch(noop);

// A site changed from an Incognito window is marked, so it is never synced.
async function markPrivateChanges(beforeProfiles, beforeEdits) {
  const changed = new Set();
  for (const [k, p] of Object.entries(state.siteProfiles)) if (beforeProfiles[k] !== p && !p.private) changed.add(k);
  for (const k of Object.keys(state.pageEdits || {})) if ((beforeEdits || {})[k] !== state.pageEdits[k]) changed.add(k);
  for (const k of changed) {
    if (state.siteProfiles[k] && state.siteProfiles[k].private) continue;
    await update((st) => RW.markSitePrivate(st, k), ['siteProfiles'], { rules: false, quiet: true });
  }
}

// ---- automatic optimisation (model broker, per-tab cancellation)

// Chrome's first model load after it starts can take many minutes. While one is going, an extension
// call every 20 s keeps this worker from being stopped, so the load is not thrown away; at most 30
// minutes, and never while nothing is loading.
let holding = 0;
let holdTimer = 0;
function holdWorker(promise) {
  holding++;
  if (!holdTimer) holdTimer = setInterval(() => { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); }, 20000);
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    if (--holding <= 0) { holding = 0; clearInterval(holdTimer); holdTimer = 0; }
  };
  const cap = setTimeout(stop, 30 * 60000);
  promise.then(() => {}, () => {}).finally(() => { clearTimeout(cap); stop(); });
}
// For the popup's loading line: when the model became ready and first answered in this Chrome session.
const noteModelLoad = (e) => { RW.aiLoadNote(e.answered ? { answeredAt: Date.now() } : { readyAt: Date.now() }); };
const brokerOptions = (extra) => Object.assign({ hold: holdWorker, onLoad: noteModelLoad }, extra);

const broker = RW.createAiBroker(brokerOptions());

// Unknown cookie banners: one broker per page language, each asking the model with that language as
// an expected input, so availability() says whether the language is supported.
const CONSENT_FAILED = 'consent-failed';
const consentBrokers = new Map();
const consentStats = { attempts: 0, verified: 0, failed: 0 };
function consentBrokerFor(lang) {
  if (!consentBrokers.has(lang)) {
    if (consentBrokers.size >= 16) return null;
    consentBrokers.set(lang, RW.createAiBroker(brokerOptions({
      systemPrompt: RW.AI_CONSENT_SYSTEM_PROMPT,
      modelOptions: {
        expectedInputs: [{ type: 'text', languages: lang === 'en' ? ['en'] : ['en', lang] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      }
    })));
  }
  return consentBrokers.get(lang);
}
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
  for (const b of [broker, ...consentBrokers.values()]) { b.cancelQueued(); b.release(); }
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

function saveTabsNow() {
  clearTimeout(tabsTimer);
  tabsTimer = 0;
  const obj = {};
  // Private tabs (and tabs not yet identified) are never written anywhere.
  for (const [id, rec] of tabs) if (rec.incognito === false) obj[id] = rec;
  return chrome.storage.session.set({ tabActivity: obj }).catch(noop);
}

function saveTabsSoon() {
  if (!tabsTimer) tabsTimer = setTimeout(saveTabsNow, 1000);
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

function startTabRecord(tabId, url, at) {
  // After a worker restart a queued navigation event can arrive after the page has already reported
  // (and so rebuilt its record). A request older than the record belongs to that same page.
  const old = tabs.get(tabId);
  if (old && at && old.navAt && at <= old.navAt && old.hostname === RW.normalizeHost(RW.hostFromUrl(url))) return;
  cancelAiForTab(tabId);
  const rec = newTabRecord(url);
  rec.navAt = at || Date.now();
  tabs.set(tabId, rec);
  chrome.tabs.get(tabId).then((t) => { rec.incognito = !!t.incognito; saveTabsSoon(); }, noop);
  updateBadge(tabId);
  saveTabsSoon();
}

// The tab's record, rebuilt from the sender when a stopped worker lost it before it was saved.
function recordForSender(sender) {
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return null;
  let rec = tabs.get(tabId);
  if (rec && rec.incognito === null) rec.incognito = !!sender.tab.incognito;
  const url = topUrlOf(sender);
  // A record from the previous site means its navigation event was lost while the worker was stopped.
  if (rec && /^https?:/.test(url) && rec.siteKey !== RW.siteKeyForUrl(url)) rec = null;
  if (!rec && /^https?:/.test(url)) {
    rec = newTabRecord(url);
    rec.navAt = Date.now(); // the page exists now, so its navigation started earlier
    rec.incognito = !!sender.tab.incognito;
    tabs.set(tabId, rec);
    saveTabsSoon();
  }
  return rec || null;
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
      if (d.documentLifecycle !== 'prerender') startTabRecord(d.tabId, d.url, d.timeStamp);
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
  ready().then(() => startTabRecord(d.tabId, d.url, d.timeStamp)).catch(noop);
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
    consentAi: caps.consentAi,
    pageFixes: caps.pageFixes,
    epoch: RW.settingsEpoch(cfg)
  };
}

const isIncognito = (sender) => !!(sender.tab && sender.tab.incognito);

// ---- page edits: saved per site, applied at user origin, every one listed and reversible

// Proactive fixes ask a model with their own instructions; the broker is made on first use.
let fixBroker = null;
const fixBrokerFor = () => fixBroker || (fixBroker = RW.createAiBroker(brokerOptions({ systemPrompt: RW.PAGE_FIX_SYSTEM_PROMPT })));

const editsFor = (siteKey) => RW.pageEditsFor(state, siteKey);
const editCss = (edit) => RW.buildPageEditCss(edit);

// The CSS of one edit into, or out of, one tab's top frame.
function setEditCss(tabId, edit, on) {
  const css = editCss(edit);
  if (!css) return Promise.resolve();
  const call = on ? chrome.scripting.insertCSS : chrome.scripting.removeCSS;
  return call({ target: { tabId, frameIds: [0] }, css, origin: 'USER' }).catch(noop);
}

// Every open tab on the site gets the change at once, and its content script rechecks.
async function pushEdit(siteKey, edit, on) {
  for (const [tabId, rec] of tabs) {
    if (rec.siteKey !== siteKey) continue;
    await setEditCss(tabId, edit, on);
    chrome.tabs.sendMessage(tabId, { action: A.PAGE_EDITS_CHANGED, payload: {} }, { frameId: 0 }).catch(noop);
  }
}

// Settings carried by a described change. Each keeps the value it replaced, so switching the change
// off puts back exactly what it changed, and nothing you have changed since.
function applySettingChanges(st, siteKey, changes) {
  let next = st;
  const now = Date.now();
  for (const c of changes) {
    if (c.op === 'site_mode') next = RW.setSiteTier(next, siteKey, c.value, now);
    else if (c.op === 'newsletter_prompts') next = RW.setSiteNewsletter(next, siteKey, c.value, now);
    else if (c.op === 'setting') next = RW.setSiteCustomOption(next, siteKey, c.key, c.value, now);
  }
  return next;
}

function currentValue(st, siteKey, c) {
  const cfg = RW.getEffectiveConfig(st, siteKey);
  if (c.op === 'site_mode') return cfg.tier;
  if (c.op === 'newsletter_prompts') return cfg.newsletterPrompts;
  return cfg[c.key];
}

function revertSettingChanges(st, siteKey, changes) {
  const back = [];
  for (const c of changes.slice().reverse()) {
    if (c.prev === undefined || currentValue(st, siteKey, c) !== c.value) continue;
    back.push(Object.assign({}, c, { value: c.prev }));
  }
  return applySettingChanges(st, siteKey, back);
}

function withPrev(st, siteKey, changes) {
  return changes.map((c) => Object.assign({}, c, { prev: currentValue(st, siteKey, c) }));
}

function siteKeyOf(p) {
  const key = RW.siteKeyForHost(str(p.siteKey, 253));
  if (!RW.isValidDomain(key)) throw new Error('invalid_site');
  return key;
}

const FIX_SIG = (kind, selector) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < selector.length; i++) { h ^= selector.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fix-${kind.replace(/_/g, '-')}-${h.toString(16)}`;
};

// An edit already saved for this selector and op (switched on or off) means the question is settled.
function alreadyDecided(siteKey, op, selector) {
  return editsFor(siteKey).some((e) => e.ops.some((o) => o.op === op && o.selector === selector));
}

async function saveFix(tabId, rec, cand, source) {
  const kind = RW.PAGE_FIX_KINDS[cand.kind];
  const edit = RW.sanitizePageEdit({
    id: RW.newPageEditId(Date.now()), label: kind.label, source, fix: cand.kind,
    ops: [{ op: kind.op, selector: cand.selector, what: cand.text }], createdAt: Date.now()
  });
  if (!edit) return null;
  await update((st) => RW.savePageEdit(st, rec.siteKey, edit), ['pageEdits'], { rules: false, quiet: true });
  await pushEdit(rec.siteKey, edit, true);
  rec.fixes = (rec.fixes || []).filter((f) => f.id !== cand.id);
  saveTabsSoon();
  return edit;
}


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
      // Saved page edits go to the top frame only, and not on a site switched off.
      const edits = sender.frameId === 0 && cfg.tier !== 'off'
        ? editsFor(cfg.siteKey).filter((e) => e.enabled && e.ops.length).map((e) => ({ id: e.id, ops: e.ops }))
        : [];
      return {
        config: contentConfig(cfg, isIncognito(sender)),
        intent: RW.consentIntent(cfg),
        hasCosmetics: RW.buildCosmeticSelectors(cfg, cfg.hostname).length > 0,
        edits
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
        method: ['api', 'dom', 'heuristic', 'hidden', 'ai'].includes(p.method) ? p.method : 'dom',
        decision: ['reject', 'accept', 'custom'].includes(p.decision) ? p.decision : 'reject',
        at: Date.now()
      };
      const tabId = sender.tab.id;
      const rec = recordForSender(sender);
      if (rec && rec.popup) return { counted: false };
      if (rec) rec.popup = info;
      state.stats.totalPopupsHandled++;
      markDirty('stats');
      await saveTabsNow(); // once per page, and worth keeping if the worker stops next
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
      const rec = recordForSender(sender);
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

  [A.AI_EVALUATE_CONSENT]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      const leave = (reason, epoch, source) => ({ outcome: 'leave_unchanged', source: source || 'rule', reason, epoch });
      if (sender.frameId !== 0) return leave('subframe');
      const sig = RW.sanitizeConsentSignals(p.signals);
      if (!sig) return leave('no_candidates');
      const host = RW.hostFromUrl(topUrlOf(sender));
      const cfg = configFor(host);
      const epoch = RW.settingsEpoch(cfg);
      if (!RW.runtimeCapabilities(cfg, { incognito: isIncognito(sender) }).consentAi) return leave('not_enabled', epoch);
      if (RW.isAiUndone(state, cfg.siteKey, CONSENT_FAILED)) return leave('failed_before', epoch);
      const key = RW.consentDecisionKey(sig);
      const remembered = RW.recallAiEntry(state, cfg.siteKey, key, epoch);
      if (remembered) {
        const b = remembered.action === 'refuse_non_essential' && sig.buttons.find((x) => x.label === remembered.label);
        return b ? { outcome: 'refuse_non_essential', candidate: b.id, label: b.label, source: 'memory', epoch } : leave('remembered', epoch, 'memory');
      }
      const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
      if (!tab || !tab.active) return leave('background_tab', epoch);
      const lb = consentBrokerFor(sig.lang);
      if (!lb) return leave('language_unsupported', epoch);
      // Asked with this language as an expected input, so an unsupported language is left alone.
      const avail = await lb.availability();
      if (avail !== 'available') return leave(sig.lang === 'en' ? `model_${avail}` : 'language_unsupported', epoch, 'model_unavailable');

      const ctrl = trackAiJob(sender.tab.id);
      let res;
      try {
        res = await lb.prompt({
          key: `${sender.tab.id}|${sender.documentId || ''}|${key}`,
          prompt: RW.buildConsentPrompt(sig, RW.consentIntent(cfg)),
          schema: RW.consentSchema(sig.buttons.map((b) => b.id)),
          signal: ctrl.signal
        });
      } finally {
        untrackAiJob(sender.tab.id, ctrl);
      }
      if (!res.ok) return leave(res.reason, epoch, 'model_unavailable');
      const decision = RW.parseConsentDecision(res.text, sig.buttons.map((b) => b.id));
      if (!decision) { lb.stats.invalid++; return leave('invalid_output', epoch); }
      if (RW.settingsEpoch(configFor(host)) !== epoch) return leave('settings_changed', epoch);
      if (decision.action !== 'refuse_non_essential') {
        await update((st) => RW.rememberAiDecision(st, cfg.siteKey, key, 'leave_unchanged', epoch, Date.now()), ['aiMemory'], { rules: false, quiet: true });
        return leave('model_left_it', epoch, 'model');
      }
      const b = sig.buttons.find((x) => x.id === decision.candidate);
      return { outcome: 'refuse_non_essential', candidate: b.id, label: b.label, source: 'model', epoch };
    }
  },

  // Sent just before the click. The site counts as failed until the page reports a verified result,
  // so a click that navigates away (and takes the page's script with it) is never retried.
  [A.AI_CONSENT_ATTEMPT]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) throw new Error('top_frame_only');
      const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
      if (!RW.isValidDomain(cfg.siteKey)) throw new Error('unsupported_site');
      if (!RW.runtimeCapabilities(cfg, { incognito: isIncognito(sender) }).consentAi) throw new Error('not_enabled');
      await update((st) => RW.markAiUndone(st, cfg.siteKey, CONSENT_FAILED, Date.now()), ['aiMemory'], { rules: false, quiet: true });
      consentStats.attempts++;
      return {};
    }
  },

  [A.AI_CONSENT_RESULT]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) throw new Error('top_frame_only');
      const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
      if (!RW.isValidDomain(cfg.siteKey)) throw new Error('unsupported_site');
      const sig = RW.sanitizeConsentSignals({ signature: p.signature, lang: 'en', buttons: [{ id: 'b1', label: p.label }] });
      const id = /^a[0-9a-z]{4,12}$/.test(p.id) ? p.id : null;
      if (!sig || !id) throw new Error('invalid_result');
      const key = RW.consentDecisionKey(sig);
      const label = sig.buttons[0].label;
      const now = Date.now();
      if (p.verified !== true) {
        consentStats.failed++;
        await update((st) => RW.forgetAiDecision(st, cfg.siteKey, key, now), ['aiMemory'], { rules: false, quiet: true });
        return {};
      }
      consentStats.verified++;
      const epoch = RW.settingsEpoch(cfg);
      await update((st) => RW.rememberAiDecision(RW.clearAiUndone(st, cfg.siteKey, CONSENT_FAILED, now), cfg.siteKey, key, 'refuse_non_essential', epoch, now, label),
        ['aiMemory'], { rules: false, quiet: true });
      const rec = recordForSender(sender);
      if (rec) {
        rec.adjustments = (rec.adjustments || []).filter((a) => a.id !== id).slice(-9);
        rec.adjustments.push({ id, signature: sig.signature, kind: RW.AI_CONSENT_KIND, label, source: p.source === 'memory' ? 'memory' : 'model', at: now });
        saveTabsSoon();
      }
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
      if (adj.kind === RW.AI_CONSENT_KIND) throw new Error('cannot_undo_click');
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
      // Cookie banner answers cannot be unclicked: stop doing it here, and the popup explains how to
      // change the answer with the site's own cookie settings.
      if (p.kind === RW.AI_CONSENT_KIND) {
        rec.adjustments = (rec.adjustments || []).filter((a) => a.kind !== RW.AI_CONSENT_KIND);
        saveTabsSoon();
        await update((st) => RW.setSiteCookieBannerAi(st, rec.siteKey, 'off', Date.now()), ['siteProfiles'], { rules: false });
        return {};
      }
      for (const adj of rec.adjustments || []) {
        if (adj.kind === RW.AI_CONSENT_KIND) continue;
        await chrome.tabs.sendMessage(tabId, { action: A.AI_REVERT, payload: { id: adj.id } }, { frameId: 0 }).catch(noop);
      }
      rec.adjustments = (rec.adjustments || []).filter((a) => a.kind === RW.AI_CONSENT_KIND);
      saveTabsSoon();
      await update((st) => RW.setSiteNewsletter(st, rec.siteKey, 'keep', Date.now()), ['siteProfiles'], { rules: false });
      return {};
    }
  },

  // The popup asks for the model before it reads its own long instructions. The load runs here, so
  // closing the popup does not stop it. The reply comes within a second; a longer load is reported
  // through chrome.storage.session (warmAt), since Chrome stops a worker whose message runs past 5 minutes.
  [A.AI_WARM]: {
    from: [FROM_PAGE],
    fn: async () => {
      if (!broker.hasSession) await RW.aiLoadNote({ loadingSince: Date.now() });
      // Kept for 10 minutes after each use, with the worker, so the next request is quick.
      const warming = broker.warm(RW.AI_KEEP_WARM_MS).then((r) => {
        if (r.ok) holdWorker(new Promise((done) => setTimeout(done, Math.max(0, broker.keptUntil - Date.now()))));
        RW.aiLoadNote({ warmAt: Date.now(), warm: r.ok ? 'ready' : r.reason });
        return r;
      });
      return (await Promise.race([warming, new Promise((done) => setTimeout(() => done(null), 1000))])) || { ok: false, reason: 'loading' };
    }
  },
  [A.GET_AI_STATUS]: {
    from: [FROM_PAGE],
    fn: async () => ({
      availability: await broker.availability(),
      preference: !!state.aiSettings.autoOptimise,
      operatingMode: state.operatingMode,
      stats: Object.assign({}, broker.stats),
      consent: Object.assign({ languages: [...consentBrokers.keys()] }, consentStats),
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


  [A.APPLY_PAGE_EDITS]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) return { applied: 0 };
      const rec = recordForSender(sender);
      const siteKey = RW.siteKeyForUrl(topUrlOf(sender));
      const ids = Array.isArray(p.ids) ? p.ids.filter((x) => typeof x === 'string').slice(0, RW.PAGE_EDITS_MAX_PER_SITE) : [];
      const list = editsFor(siteKey).filter((e) => e.enabled && ids.includes(e.id));
      for (const e of list) await setEditCss(sender.tab.id, e, p.remove !== true);
      // Edits the page check refused are listed in the popup with the reason.
      if (rec && p.remove === true) {
        const reasons = Array.isArray(p.reasons) ? p.reasons : [];
        rec.editSkipped = list.map((e, i) => ({ id: e.id, reason: str(reasons[ids.indexOf(e.id)] || reasons[i], 80) })).slice(0, 10);
        saveTabsSoon();
      }
      return { applied: list.length };
    }
  },

  [A.PAGE_FIX_CANDIDATES]: {
    from: [FROM_CONTENT],
    fn: async (p, sender) => {
      if (sender.frameId !== 0) return { applied: 0 };
      const rec = recordForSender(sender);
      if (!rec || !rec.siteKey) return { applied: 0 };
      const cfg = configFor(RW.hostFromUrl(topUrlOf(sender)));
      const caps = RW.runtimeCapabilities(cfg, { incognito: isIncognito(sender) });
      if (caps.pageFixes === 'off') return { applied: 0 };
      const now = Date.now();
      const cands = [];
      for (const raw of (Array.isArray(p.candidates) ? p.candidates : []).slice(0, 6)) {
        if (!raw || !Object.prototype.hasOwnProperty.call(RW.PAGE_FIX_KINDS, raw.kind)) continue;
        const kind = RW.PAGE_FIX_KINDS[raw.kind];
        const op = RW.sanitizePageEditOp({ op: kind.op, selector: raw.selector === 'page' ? 'page' : raw.selector });
        if (!op || !RW.pageFixAllowed(raw.kind, raw.text)) continue;
        if (alreadyDecided(rec.siteKey, op.op, op.selector)) continue;
        const sig = FIX_SIG(raw.kind, op.selector);
        if (RW.isAiUndone(state, rec.siteKey, sig, now)) continue; // you dismissed or undid this one
        rec.fixSeq = ((rec.fixSeq || 0) % 999) + 1;
        cands.push({ id: `f${rec.fixSeq}`, sig, kind: raw.kind, selector: op.selector, text: RW.cleanPageText(raw.text, 60),
          area: Math.max(0, Math.min(100, Math.round(Number(raw.area) || 0))), position: RW.cleanPageText(raw.position, 20) });
      }
      if (!cands.length) return { applied: 0 };
      const applied = [];
      let suggest = cands;
      if (caps.pageFixes === 'auto') {
        const sure = cands.filter((c) => RW.PAGE_FIX_KINDS[c.kind].sure);
        let unsure = cands.filter((c) => !RW.PAGE_FIX_KINDS[c.kind].sure);
        let yes = [];
        if (unsure.length && caps.pageFixAi) {
          const ids = unsure.map((c) => c.id);
          const res = await fixBrokerFor().prompt({ key: `fix:${sender.tab.id}:${ids.join(',')}:${rec.siteKey}`, prompt: RW.pageFixPrompt(unsure), schema: RW.pageFixSchema(ids) });
          const verdict = res.ok ? RW.parsePageFixDecisions(res.text, ids) : null;
          if (verdict) {
            yes = unsure.filter((c) => verdict[c.id] === 'apply');
            unsure = unsure.filter((c) => verdict[c.id] !== 'apply');
          }
        }
        for (const c of sure.concat(yes)) {
          const e = await saveFix(sender.tab.id, rec, c, 'automatic');
          if (e) applied.push(e.id);
        }
        suggest = unsure;
      }
      rec.fixes = (rec.fixes || []).filter((f) => !suggest.some((c) => c.selector === f.selector && c.kind === f.kind)).concat(suggest).slice(-5);
      saveTabsSoon();
      return { applied: applied.length, suggested: suggest.length };
    }
  },

  [A.APPLY_PAGE_FIX]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const tabId = Number(p.tabId);
      const rec = tabs.get(tabId);
      const cand = rec && (rec.fixes || []).find((f) => f.id === p.id);
      if (!cand) throw new Error('not_found');
      const edit = await saveFix(tabId, rec, cand, 'suggested');
      if (!edit) throw new Error('invalid_edit');
      announceSettingsChange();
      return { id: edit.id };
    }
  },

  [A.DISMISS_PAGE_FIX]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const tabId = Number(p.tabId);
      const rec = tabs.get(tabId);
      const cand = rec && (rec.fixes || []).find((f) => f.id === p.id);
      if (!cand) throw new Error('not_found');
      rec.fixes = rec.fixes.filter((f) => f !== cand);
      saveTabsSoon();
      await update((st) => RW.markAiUndone(st, rec.siteKey, cand.sig, Date.now()), ['aiMemory'], { rules: false, quiet: true });
      return {};
    }
  },

  [A.SAVE_PAGE_EDIT]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const siteKey = siteKeyOf(p);
      const settings = Array.isArray(p.settings) ? p.settings.slice(0, 6) : [];
      const draft = {
        id: RW.newPageEditId(Date.now()), label: p.label, request: p.request, source: 'described',
        ops: Array.isArray(p.ops) ? p.ops : [], settings: withPrev(state, siteKey, settings), createdAt: Date.now()
      };
      const edit = RW.sanitizePageEdit(draft);
      if (!edit) throw new Error('invalid_edit');
      const rulesChange = edit.settings.length > 0;
      await update((st) => applySettingChanges(RW.savePageEdit(st, siteKey, edit), siteKey, edit.settings),
        rulesChange ? ['pageEdits', 'siteProfiles'] : ['pageEdits'], { rules: rulesChange });
      await pushEdit(siteKey, edit, true);
      return { edit };
    }
  },

  [A.SET_PAGE_EDIT]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const siteKey = siteKeyOf(p);
      const edit = editsFor(siteKey).find((e) => e.id === p.id);
      if (!edit) throw new Error('not_found');
      const on = p.enabled === true;
      if (edit.enabled === on) return {};
      const rulesChange = edit.settings.length > 0;
      await update((st) => {
        const next = RW.setPageEditEnabled(st, siteKey, edit.id, on);
        return on ? applySettingChanges(next, siteKey, edit.settings) : revertSettingChanges(next, siteKey, edit.settings);
      }, rulesChange ? ['pageEdits', 'siteProfiles'] : ['pageEdits'], { rules: rulesChange });
      await pushEdit(siteKey, edit, on);
      // Undoing an automatic or suggested fix also means "do not suggest it again here".
      if (!on && edit.fix) {
        for (const o of edit.ops) {
          await update((st) => RW.markAiUndone(st, siteKey, FIX_SIG(edit.fix, o.selector), Date.now()), ['aiMemory'], { rules: false, quiet: true });
        }
      }
      return {};
    }
  },

  [A.DELETE_PAGE_EDIT]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const siteKey = siteKeyOf(p);
      const edit = editsFor(siteKey).find((e) => e.id === p.id);
      if (!edit) return {};
      const rulesChange = edit.enabled && edit.settings.length > 0;
      await update((st) => {
        const next = edit.enabled ? revertSettingChanges(st, siteKey, edit.settings) : st;
        return RW.deletePageEdit(next, siteKey, edit.id);
      }, rulesChange ? ['pageEdits', 'siteProfiles'] : ['pageEdits'], { rules: rulesChange });
      if (edit.enabled) await pushEdit(siteKey, edit, false);
      return {};
    }
  },

  [A.SET_AI_PAGE_SETTINGS]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((st) => RW.setAiPageSettings(st, { pageEdits: p.pageEdits, pageFixes: p.pageFixes }), ['aiSettings'], { rules: false });
      return {};
    }
  },

  [A.SET_SITE_PAGE_FIXES]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      await update((st) => RW.setSitePageFixes(st, siteKeyOf(p), p.value, Date.now()), ['siteProfiles'], { rules: false });
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
        adjustments: rec ? (rec.adjustments || []).map((a) => ({ id: a.id, kind: a.kind, source: a.source, at: a.at, label: a.label || '' })) : [],
        pageEdits: editsFor(cfg.siteKey),
        pageFixes: rec ? (rec.fixes || []).map((x) => ({ id: x.id, kind: x.kind, text: x.text })) : [],
        editSkipped: rec ? rec.editSkipped || [] : [],
        aiSettings: RW.sanitizeAiSettings(state.aiSettings)
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

  [A.SET_SYNC]: {
    from: [FROM_PAGE],
    fn: async (p) => {
      const ss = await loadSyncState();
      if (p.enabled === true) {
        // Turning it on is a first merge: both sides kept, the newer of each site wins.
        Object.assign(ss, { enabled: true, base: null, lastError: '', backoffUntil: 0 });
        if (!ss.device) ss.device = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
        await saveSyncState();
        await runSync('enable');
      } else {
        clearTimeout(syncTimer);
        Object.assign(ss, { enabled: false, base: null });
        await saveSyncState();
      }
      return { sync: syncStatus() };
    }
  },

  [A.GET_SYNC_STATUS]: {
    from: [FROM_PAGE],
    fn: async () => { await loadSyncState(); return { sync: syncStatus() }; }
  },

  // Removes Rockyweb's copy from Chrome sync and turns sync off on this device.
  [A.CLEAR_SYNC_COPY]: {
    from: [FROM_PAGE],
    fn: async () => {
      const ss = await loadSyncState();
      clearTimeout(syncTimer);
      Object.assign(ss, { enabled: false, base: null, bytes: 0, skipped: 0, lastSyncAt: 0 });
      await saveSyncState();
      const items = await chrome.storage.sync.get(null);
      const mine = Object.keys(items).filter((k) => k.startsWith(RW.SYNC_PREFIX));
      if (mine.length) await chrome.storage.sync.remove(mine);
      return { sync: syncStatus() };
    }
  },

  [A.RESET_ALL]: {
    from: [FROM_PAGE],
    fn: async () => {
      cancelAllAi();
      clearTimeout(syncTimer);
      syncState = null;
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
  // Own keys only, so "toString" or "__proto__" are unknown actions, not inherited functions.
  const handler = msg && typeof msg.action === 'string' && Object.prototype.hasOwnProperty.call(HANDLERS, msg.action) ? HANDLERS[msg.action] : null;
  if (!kind || !handler) {
    sendResponse({ ok: false, error: kind ? 'unknown_action' : 'forbidden' });
    return false;
  }
  if (!handler.from.includes(kind)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
  // The popup says when it belongs to an Incognito tab; content scripts are known from their tab.
  const privateContext = isIncognito(sender) || (kind === FROM_PAGE && payload.private === true);
  let before = null;
  ready()
    .then(() => { before = privateContext ? [state.siteProfiles, state.pageEdits] : null; return handler.fn(payload, sender, kind); })
    .then(async (res) => { if (before) await markPrivateChanges(before[0], before[1]); return res; })
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
  // A fresh install opens the welcome page once: what already works, and the optional on-device AI.
  // Never on updates.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  loadState().then(syncRules).catch((err) => warn('startup sync failed', err));
});
