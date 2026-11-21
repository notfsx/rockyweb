// Optional Chrome sync of settings, per-site modes and saved page changes. Pure functions only;
// the service worker does the storage calls. Off by default.
//
// What syncs: the default mode, the global custom settings and cookie choices, the page change
// settings, site profiles and saved page changes. What never syncs: learned trackers, statistics,
// AI memory, tab records, Light mode and automatic optimisation (both depend on the computer), and
// any site changed from an Incognito window.
//
// Storage: one meta item and the JSON split into chunks, each under the 8 KB item limit, all under
// the 100 KB total. If it would not fit, the sites changed longest ago are left out and counted.
// Merging is three-way against the last copy this device uploaded, so a deletion is never mistaken
// for a missing item. When both sides changed the same item, the newer one wins.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const PREFIX = 'rw:';
  const META = `${PREFIX}meta`;
  const CHUNK = (i) => `${PREFIX}d${i}`;
  const ITEM_MAX = 8192;
  const TOTAL_MAX = 102400;
  const BUDGET = 96000; // headroom under the total for the meta item and rounding
  const PIECE = 7000; // characters of JSON per chunk before escaping
  const VERSION = 1;
  const PREF_KEYS = ['globalDefaultTier', 'globalCustomConfig', 'aiPageEdits', 'aiPageFixes'];

  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // Same value, same text: keys sorted, so two devices compare equal.
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return v === undefined ? 'undefined' : JSON.stringify(v);
  }

  // FNV-1a, enough to notice a half-arrived copy.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // Non-ASCII as \uXXXX, so characters and bytes are the same count.
  const ascii = (s) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  // ---- what this device would sync

  function syncView(state) {
    const prefs = {
      globalDefaultTier: state.globalDefaultTier,
      globalCustomConfig: JSON.parse(JSON.stringify(state.globalCustomConfig)),
      aiPageEdits: state.aiSettings ? state.aiSettings.pageEdits !== false : true,
      aiPageFixes: (state.aiSettings && state.aiSettings.pageFixes) || 'suggest'
    };
    const sites = {};
    const edits = {};
    const privateSites = new Set(Object.entries(state.siteProfiles || {}).filter(([, p]) => p && p.private).map(([k]) => k));
    for (const [k, p] of Object.entries(state.siteProfiles || {})) {
      if (privateSites.has(k)) continue;
      const copy = JSON.parse(JSON.stringify(p));
      delete copy.private;
      sites[k] = copy;
    }
    for (const [k, list] of Object.entries(state.pageEdits || {})) {
      if (!privateSites.has(k) && Array.isArray(list) && list.length) edits[k] = JSON.parse(JSON.stringify(list));
    }
    return { prefs, sites, edits };
  }

  // Everything that came from sync is checked like an imported file.
  function sanitizeView(raw) {
    if (!isObj(raw)) return null;
    const p = isObj(raw.prefs) ? raw.prefs : {};
    const base = RW.normalizeState({
      globalDefaultTier: p.globalDefaultTier,
      globalCustomConfig: p.globalCustomConfig,
      aiSettings: { pageEdits: p.aiPageEdits, pageFixes: p.aiPageFixes },
      siteProfiles: isObj(raw.sites) ? raw.sites : {},
      pageEdits: isObj(raw.edits) ? raw.edits : {}
    });
    for (const prof of Object.values(base.siteProfiles)) delete prof.private;
    return syncView(base);
  }

  // ---- storage items

  function siteTime(view, k) {
    const p = view.sites[k];
    const e = view.edits[k] || [];
    return Math.max(p ? p.updatedAt || 0 : 0, ...e.map((x) => x.updatedAt || x.createdAt || 0));
  }

  function chunksOf(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      let len = Math.min(PIECE, text.length - i);
      // Escaping can grow a piece; shrink until the stored item fits.
      while (len > 1 && CHUNK(out.length).length + JSON.stringify(text.slice(i, i + len)).length > ITEM_MAX - 64) len = Math.floor(len * 0.9);
      out.push(text.slice(i, i + len));
      i += len;
    }
    return out;
  }

  const itemBytes = (items) => Object.entries(items).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);

  // view + { device, at, prefsAt } -> { items, bytes, skipped, view (what was actually written), hash }
  function encodeSync(view, meta) {
    const v = { prefs: view.prefs, sites: Object.assign({}, view.sites), edits: Object.assign({}, view.edits) };
    // Oldest first, for leaving out when it does not fit.
    const order = [...new Set([...Object.keys(v.sites), ...Object.keys(v.edits)])].sort((a, b) => siteTime(view, a) - siteTime(view, b));
    let skipped = 0;
    for (;;) {
      const body = ascii(stable({ v: VERSION, prefsAt: meta.prefsAt || 0, prefs: v.prefs, sites: v.sites, edits: v.edits }));
      const pieces = chunksOf(body);
      const items = {};
      pieces.forEach((p, i) => { items[CHUNK(i)] = p; });
      const h = hash(body);
      items[META] = { v: VERSION, n: pieces.length, hash: h, device: String(meta.device || ''), at: meta.at || 0, skipped };
      const bytes = itemBytes(items);
      if (bytes <= BUDGET || !order.length) return { items, bytes, skipped, view: v, hash: h, fits: bytes <= TOTAL_MAX };
      // Leave out a few of the oldest at a time.
      for (let n = Math.max(1, Math.ceil(order.length / 20)); n > 0 && order.length; n--) {
        const k = order.shift();
        delete v.sites[k];
        delete v.edits[k];
        skipped++;
      }
    }
  }

  // Storage items -> { view, meta, prefsAt } or null when absent, or { partial: true } when the
  // chunks do not match the meta yet (Chrome sync can deliver them one at a time).
  function decodeSync(items) {
    const meta = items && items[META];
    if (!isObj(meta) || meta.v !== VERSION || !Number.isInteger(meta.n) || meta.n < 1 || meta.n > 40) return null;
    let body = '';
    for (let i = 0; i < meta.n; i++) {
      const p = items[CHUNK(i)];
      if (typeof p !== 'string') return { partial: true, meta };
      body += p;
    }
    if (hash(body) !== meta.hash) return { partial: true, meta };
    let raw;
    try { raw = JSON.parse(body); } catch (_) { return { partial: true, meta }; }
    const view = sanitizeView(raw);
    if (!view) return null;
    return { view, meta, prefsAt: typeof raw.prefsAt === 'number' ? raw.prefsAt : 0 };
  }

  // Keys this device wrote before that are no longer used.
  function staleKeys(existing, items) {
    return Object.keys(existing || {}).filter((k) => k.startsWith(PREFIX) && !(k in items));
  }

  // ---- merging

  // One item: b (last uploaded), l (here), r (synced). undefined means absent.
  function pick(b, l, r, tl, tr, preferRemote) {
    const sb = stable(b);
    const sl = stable(l);
    const sr = stable(r);
    if (sl === sr) return l;
    if (sl === sb) return r;
    if (sr === sb) return l;
    // Both changed. A change beats a deletion; otherwise the newer one wins.
    if (l === undefined) return r;
    if (r === undefined) return l;
    if (tr !== tl) return tr > tl ? r : l;
    return preferRemote ? r : l;
  }

  const editTime = (e) => (e ? e.updatedAt || e.createdAt || 0 : 0);
  const byId = (list) => { const m = {}; for (const e of list || []) m[e.id] = e; return m; };

  // base is null on the first merge: everything from both sides is kept, the newer item wins, and
  // the general settings come from sync if any are there.
  function mergeSync(base, local, remote, times) {
    const t = times || {};
    const b = base || { prefs: {}, sites: {}, edits: {} };
    const first = !base;
    const prefs = {};
    for (const k of PREF_KEYS) {
      const v = pick(b.prefs[k], local.prefs[k], remote.prefs[k], t.localPrefsAt || 0, t.remotePrefsAt || 0, first);
      prefs[k] = v === undefined ? local.prefs[k] : v;
    }
    const sites = {};
    for (const k of new Set([...Object.keys(local.sites), ...Object.keys(remote.sites), ...Object.keys(b.sites)])) {
      const l = local.sites[k];
      const r = remote.sites[k];
      const v = pick(b.sites[k], l, r, l ? l.updatedAt || 0 : 0, r ? r.updatedAt || 0 : 0, first);
      if (v !== undefined) sites[k] = v;
    }
    const edits = {};
    for (const k of new Set([...Object.keys(local.edits), ...Object.keys(remote.edits), ...Object.keys(b.edits)])) {
      const bl = byId(b.edits[k]);
      const ll = byId(local.edits[k]);
      const rl = byId(remote.edits[k]);
      const out = [];
      for (const id of new Set([...Object.keys(ll), ...Object.keys(rl), ...Object.keys(bl)])) {
        const v = pick(bl[id], ll[id], rl[id], editTime(ll[id]), editTime(rl[id]), first);
        if (v !== undefined) out.push(v);
      }
      out.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
      if (out.length) edits[k] = out.slice(-(RW.PAGE_EDITS_MAX_PER_SITE || 30));
    }
    return { prefs, sites, edits };
  }

  // A merged view back into this device's state. Private (Incognito) sites here are never replaced,
  // and nothing that does not sync is touched.
  function applySyncView(state, view) {
    const siteProfiles = {};
    for (const [k, p] of Object.entries(state.siteProfiles || {})) if (p && p.private) siteProfiles[k] = p;
    for (const [k, p] of Object.entries(view.sites)) if (!siteProfiles[k]) siteProfiles[k] = p;
    const pageEdits = {};
    for (const [k, list] of Object.entries(state.pageEdits || {})) if (siteProfiles[k] && siteProfiles[k].private) pageEdits[k] = list;
    for (const [k, list] of Object.entries(view.edits)) if (!pageEdits[k]) pageEdits[k] = list;
    const next = RW.normalizeState(Object.assign({}, state, {
      learnedTrackers: {},
      aiMemory: {},
      globalDefaultTier: view.prefs.globalDefaultTier,
      globalCustomConfig: view.prefs.globalCustomConfig,
      aiSettings: Object.assign({}, state.aiSettings, { pageEdits: view.prefs.aiPageEdits, pageFixes: view.prefs.aiPageFixes }),
      siteProfiles,
      pageEdits
    }));
    // Learned trackers and AI memory are not part of sync: keep the live objects.
    next.learnedTrackers = state.learnedTrackers;
    next.stats = state.stats;
    next.aiMemory = state.aiMemory;
    return next;
  }

  const sameView = (a, b) => stable(a) === stable(b);

  Object.assign(RW, {
    SYNC_PREFIX: PREFIX,
    SYNC_META_KEY: META,
    SYNC_ITEM_MAX: ITEM_MAX,
    SYNC_TOTAL_MAX: TOTAL_MAX,
    syncView,
    encodeSync,
    decodeSync,
    mergeSync,
    applySyncView,
    syncStaleKeys: staleKeys,
    sameSyncView: sameView,
    syncHash: hash
  });
  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
