// Privacy measurements for the real-site run: third-party requests, tracking cookies, scripts that
// read fingerprinting surfaces, and whether link tracking parameters survive.
// Ground truth is DuckDuckGo's tracker blocklist built from Tracker Radar (CC BY-NC-SA 4.0), fetched
// once into tests/sites/.data (git-ignored, never committed).
import fs from 'node:fs';
import path from 'node:path';

const TDS_URL = 'https://staticcdn.duckduckgo.com/trackerblocking/v6/current/extension-tds.json';

export async function loadTds(dir) {
  const file = path.join(dir, '.data', 'tds.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const res = await fetch(TDS_URL);
    if (!res.ok) throw new Error(`tracker data: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  const tds = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { trackers: tds.trackers, domains: tds.domains || {}, built: tds._builtWith, fetched: fs.statSync(file).mtime.toISOString().slice(0, 10) };
}

// Enough of the public suffix list for the corpus (two-part suffixes such as co.uk).
const TWO_PART = /\.(co|org|gov|ac|me|net|ltd|plc|com|nhs|police)\.(uk|jp|nz|za|au|br|in|kr|il|tr)$|\.com\.(au|br|mx|tr|cn|sg|ar)$/;
export function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || !h.includes('.')) return h;
  const parts = h.split('.');
  return parts.slice(TWO_PART.test(h) ? -3 : -2).join('.');
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ''; } };

// The tracker entry for a host, walking up its labels.
export function trackerFor(tds, host) {
  let h = String(host || '').toLowerCase().replace(/^\./, '');
  while (h.includes('.')) {
    if (tds.trackers[h]) return tds.trackers[h];
    h = h.slice(h.indexOf('.') + 1);
  }
  return null;
}

// Same company counts as first party (bbc.co.uk and bbci.co.uk, say).
function ownerOf(tds, host) {
  let h = String(host || '').toLowerCase().replace(/^\./, '');
  while (h.includes('.')) {
    if (tds.domains[h]) return tds.domains[h];
    h = h.slice(h.indexOf('.') + 1);
  }
  return null;
}
export function isThirdParty(tds, pageHost, host) {
  if (!host || siteOf(host) === siteOf(pageHost)) return false;
  const a = ownerOf(tds, pageHost);
  return !(a && a === ownerOf(tds, host));
}

// Analytics and ad cookies sites set as first party.
const FIRST_PARTY_TRACKING = /^(_ga|_ga_.*|_gid|_gat.*|_gcl_.*|_fbp|_fbc|_uet(sid|vid)|_hj.*|_clck|_clsk|_pin_unauth|_tt_.*|_ttp|_scid.*|_rdt_uuid|_parsely.*|_cb|_chartbeat.*|s_vi|s_ecid|AMCV_.*|_pk_id.*|_pk_ses.*|mp_.*_mixpanel|ajs_anonymous_id|_lr_.*|_dc_gtm_.*|__utm[abcz])$/;

export const TRACKING_PARAMS = { utm_source: 'rockyweb-test', utm_medium: 'test', fbclid: 'rockyweb-test', gclid: 'rockyweb-test' };
export function withTrackingParams(url) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(TRACKING_PARAMS)) u.searchParams.set(k, v);
  return u.toString();
}
export function paramsLeft(url) {
  try { const u = new URL(url); return Object.keys(TRACKING_PARAMS).filter((k) => u.searchParams.has(k)); } catch (_) { return []; }
}

// Main-world probe: which scripts read canvas pixels, the unmasked WebGL renderer, audio
// fingerprints or enumerate many fonts. Records the calling script from the stack.
export const FINGERPRINT_PROBE = `(() => {
  if (window.__rwFp) return;
  const seen = window.__rwFp = {};
  const caller = () => {
    const lines = String(new Error().stack || '').split('\\n').slice(2);
    for (const l of lines) { const m = l.match(/(https?:\\/\\/[^\\s)]+?):\\d+:\\d+/); if (m) return m[1].split('?')[0]; }
    return 'inline';
  };
  const note = (api) => { const c = caller(); (seen[c] = seen[c] || {})[api] = ((seen[c] || {})[api] || 0) + 1; };
  const wrap = (proto, name, api, test) => {
    if (!proto || typeof proto[name] !== 'function') return;
    const orig = proto[name];
    const f = { [name](...a) { try { if (!test || test.apply(this, a)) note(api); } catch (_) {} return orig.apply(this, a); } }[name];
    Object.defineProperty(proto, name, { value: f, writable: true, configurable: true });
  };
  wrap(HTMLCanvasElement.prototype, 'toDataURL', 'canvas');
  wrap(HTMLCanvasElement.prototype, 'toBlob', 'canvas');
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'getImageData', 'canvas', function () { return this.canvas && this.canvas.width * this.canvas.height < 1e6; });
  const gl = function (p) { return p === 37445 || p === 37446; };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, 'getParameter', 'webgl', gl);
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, 'getParameter', 'webgl', gl);
  if (window.OfflineAudioContext) {
    const O = window.OfflineAudioContext;
    window.OfflineAudioContext = new Proxy(O, { construct(t, a) { note('audio'); return Reflect.construct(t, a); } });
  }
  let fonts = 0;
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'measureText', 'fonts', function () { return ++fonts === 50; });
})();`;

// Starts recording a page's requests. Call before navigating.
export function recordRequests(page) {
  const list = [];
  page.on('request', (req) => {
    // A request the extension redirected to its own stand-in script never reached the tracker.
    const from = req.redirectedFrom();
    if (from && /^chrome-extension:/.test(req.url())) {
      const r = list.findLast((x) => x.url === from.url() && !x.failure);
      if (r) r.standIn = true;
      return;
    }
    list.push({ url: req.url(), type: req.resourceType(), frame: req.frame() === page.mainFrame() ? 'top' : 'sub' });
  });
  page.on('requestfailed', (req) => {
    const r = list.findLast((x) => x.url === req.url() && !x.failure);
    if (r) r.failure = (req.failure() || {}).errorText || 'failed';
  });
  return list;
}

const cookieKey = (c) => `${c.name}|${c.domain}|${c.path}`;

// Summary of one visit. before and after are context.cookies() snapshots.
export async function privacyFor(tds, page, siteUrl, requests, cookiesBefore, cookiesAfter) {
  const pageHost = hostOf(siteUrl);
  const third = requests.filter((r) => /^https?:/.test(r.url) && isThirdParty(tds, pageHost, hostOf(r.url)));
  const blocked = (r) => /BLOCKED_BY_CLIENT/.test(r.failure || '');
  const loaded = (r) => !r.failure && !r.standIn;
  const tracker = (r) => trackerFor(tds, hostOf(r.url));
  const trackerReqs = third.filter(tracker);
  const fpScripts = trackerReqs.filter((r) => r.type === 'script' && loaded(r) && (tracker(r).fingerprinting || 0) >= 2);
  const before = new Set(cookiesBefore.map(cookieKey));
  const fresh = cookiesAfter.filter((c) => !before.has(cookieKey(c)));
  const thirdCookies = fresh.filter((c) => isThirdParty(tds, pageHost, c.domain.replace(/^\./, '')));
  const trackerCookies = thirdCookies.filter((c) => trackerFor(tds, c.domain));
  const firstTracking = fresh.filter((c) => !isThirdParty(tds, pageHost, c.domain.replace(/^\./, '')) && FIRST_PARTY_TRACKING.test(c.name));
  // Fingerprinting reads seen in any frame.
  const probes = {};
  for (const f of page.frames()) {
    const seen = await f.evaluate(() => window.__rwFp || {}).catch(() => ({}));
    for (const [src, apis] of Object.entries(seen)) probes[src] = Object.assign(probes[src] || {}, apis);
  }
  const probeScripts = Object.entries(probes).map(([src, apis]) => ({ src: src.slice(0, 120), apis: Object.keys(apis).sort().join('+'), tracker: !!trackerFor(tds, hostOf(src)) }));
  const uniq = (a) => [...new Set(a)];
  return {
    thirdParty: {
      requests: third.length,
      loaded: third.filter(loaded).length,
      blocked: third.filter(blocked).length,
      standIn: third.filter((r) => r.standIn).length,
      domainsLoaded: uniq(third.filter(loaded).map((r) => siteOf(hostOf(r.url)))).length
    },
    trackers: {
      requests: trackerReqs.length,
      loaded: trackerReqs.filter(loaded).length,
      blocked: trackerReqs.filter(blocked).length,
      domainsLoaded: uniq(trackerReqs.filter(loaded).map((r) => tracker(r).domain)).sort()
    },
    cookies: {
      new: fresh.length,
      thirdParty: thirdCookies.length,
      trackerThirdParty: trackerCookies.length,
      firstPartyTracking: firstTracking.length,
      names: uniq(trackerCookies.map((c) => `${c.domain}:${c.name}`).concat(firstTracking.map((c) => c.name))).slice(0, 30)
    },
    fingerprinting: {
      trackerScriptsLoaded: uniq(fpScripts.map((r) => r.url.split('?')[0])).length,
      probeScripts: probeScripts.length,
      probeTrackerScripts: probeScripts.filter((p) => p.tracker).length,
      probes: probeScripts.slice(0, 12)
    },
    linkParams: { kept: paramsLeft(page.url()) }
  };
}
