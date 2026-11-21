#!/usr/bin/env node
// Real-website check (npm run test:sites). Browse only: one visit per site per config plus one
// reload, one site at a time, no logins, forms or clicks of our own. Writes JSON and screenshots to
// tests/sites/.out (not committed); tests/sites/report.mjs turns the JSON into results.md.
// usage: node tests/sites/run-sites.mjs [--configs=baseline,full-granular,full-reject,light-granular] [--only=id,id] [--tag=name]
// Privacy comparison: --configs=baseline,balanced,strict (each visit also records third-party requests,
// tracking cookies, fingerprinting reads and whether link tracking parameters survive).
// With and without AI for unknown cookie banners (needs Chrome with Gemini Nano; local only):
//   ROCKYWEB_NANO_PROFILE=<dir> node tests/sites/run-sites.mjs --configs=nano-ai-off,nano-ai-on [--reverse]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { EXT_DIR as DEFAULT_EXT, loadShared } from '../../scripts/load-shared.mjs';
import { loadTds, FINGERPRINT_PROBE, recordRequests, privacyFor, withTrackingParams } from './privacy-metrics.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const RW = loadShared();
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const CONFIGS = arg('configs', 'baseline,full-granular,full-reject,light-granular').split(',');
const ONLY = arg('only', '') ? arg('only').split(',') : null;
const TAG = arg('tag', new Date().toISOString().slice(0, 10));
// --ext=<folder> runs another build of the extension, for before and after comparisons.
const EXT_DIR = arg('ext', DEFAULT_EXT);
const OUT = path.join(HERE, '.out', TAG);
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8')).sites.filter((s) => !ONLY || ONLY.includes(s.id));
// Reverse order, so a run started beside another never visits the same site at the same time.
if (process.argv.includes('--reverse')) corpus.reverse();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36';

const SETUP = {
  baseline: null,
  'full-granular': { mode: 'full', categories: { necessary: true, functional: true, analytics: false, marketing: false } },
  'full-reject': { mode: 'full', categories: { necessary: true, functional: false, analytics: false, marketing: false } },
  'light-granular': { mode: 'light', categories: { necessary: true, functional: true, analytics: false, marketing: false } },
  // The Balanced and Strict presets as a new user picks them.
  balanced: { mode: 'full', tier: 'balanced', categories: { necessary: true, functional: true, analytics: false, marketing: false } },
  strict: { mode: 'full', tier: 'strict', categories: { necessary: true, functional: false, analytics: false, marketing: false } },
  // Official Chrome with Gemini Nano, Full and granular, AI for unknown cookie banners off or on.
  'nano-ai-off': { mode: 'full', categories: { necessary: true, functional: true, analytics: false, marketing: false }, nano: true, ai: false },
  'nano-ai-on': { mode: 'full', categories: { necessary: true, functional: true, analytics: false, marketing: false }, nano: true, ai: true }
};

// Every element a consent rule says marks a showing banner, plus consent iframes.
const BANNER_SELECTORS = [...new Set(RW.CONSENT_RULES.flatMap((r) => r.detect || []))]
  .concat(['iframe[id^="sp_message_iframe"]', 'iframe[src*="privacy-mgmt.com"]', 'iframe[src*="consent"]', '#truste-consent-track', '.truste_box_overlay']);

// ---- page-side helpers (run in the page's main world)

function bannerVisible(selectors) {
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width * r.height > 2000;
  };
  for (const s of selectors) { try { for (const el of document.querySelectorAll(s)) if (vis(el)) return s; } catch (_) { /* bad selector */ } }
  // Inline named banner in the first screen (GOV.UK style).
  for (const el of document.querySelectorAll('[class*="cookie-banner" i], [id*="cookie-banner" i], [role="region"][aria-label*="cookie" i]')) {
    if (vis(el) && el.getBoundingClientRect().top + scrollY < innerHeight && el.querySelector('button, a[role="button"]')) return 'inline';
  }
  // Generic: a fixed or sticky box with cookie wording covering a real part of the screen.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (!vis(el)) continue;
    const t = (el.innerText || '').slice(0, 2000);
    if (/cookie|consent|datenschutz|einwilligung|consentement|privacidad|toestemming|samtykke/i.test(t) && t.length > 40) return 'generic';
  }
  return null;
}

function pageMetrics() {
  const main = document.querySelector('main, [role=main], article, #main, #content') || document.body;
  const text = ((main && main.innerText) || '').replace(/\s+/g, ' ').trim();
  const vw = innerWidth;
  const vh = innerHeight;
  let covered = 0;
  for (const [x, y] of [[vw / 2, vh / 2], [vw / 4, vh / 3], [(3 * vw) / 4, (2 * vh) / 3]]) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const r = el.getBoundingClientRect();
        if (r.width * r.height > 0.3 * vw * vh) { covered++; break; }
      }
      el = el.parentElement;
    }
  }
  const se = document.scrollingElement || document.documentElement;
  return {
    mainTextLength: text.length,
    overflow: `${getComputedStyle(document.documentElement).overflowY}/${document.body ? getComputedStyle(document.body).overflowY : ''}`,
    scrollHeight: se.scrollHeight,
    viewportHeight: vh,
    coveredPoints: covered
  };
}

async function readConsent() {
  const cookies = {};
  for (const c of document.cookie.split(/;\s*/)) {
    const i = c.indexOf('=');
    if (i > 0) { try { cookies[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1)); } catch (_) { cookies[c.slice(0, i)] = c.slice(i + 1); } }
  }
  const out = { platform: null, decided: null, functional: null, analytics: null, marketing: null, detail: '', tcf: null };
  const w = window;
  const tcf = await new Promise((resolve) => {
    if (typeof w.__tcfapi !== 'function') return resolve(null);
    const t = setTimeout(() => resolve(null), 3000);
    try {
      w.__tcfapi('getTCData', 2, (d, ok) => {
        clearTimeout(t);
        if (!ok || !d) return resolve(null);
        const pc = (d.purpose && d.purpose.consents) || {};
        resolve({ cmpId: d.cmpId, gdprApplies: d.gdprApplies, eventStatus: d.eventStatus, hasString: !!d.tcString,
          consents: Object.keys(pc).filter((k) => pc[k]).map(Number) });
      });
    } catch (_) { clearTimeout(t); resolve(null); }
  });
  out.tcf = tcf;
  try {
    if (w.Cookiebot && w.Cookiebot.consent) {
      const c = w.Cookiebot.consent;
      Object.assign(out, { platform: 'Cookiebot', decided: !!w.Cookiebot.hasResponse, functional: !!c.preferences, analytics: !!c.statistics, marketing: !!c.marketing });
    } else if (w.OneTrust || w.Optanon || cookies.OptanonConsent) {
      const m = /(?:^|&)groups=([^&]*)/.exec(cookies.OptanonConsent || '');
      out.platform = 'OneTrust';
      out.decided = !!cookies.OptanonAlertBoxClosed;
      if (m) {
        const g = Object.fromEntries(decodeURIComponent(m[1]).split(',').map((x) => x.split(':')));
        // Group ids differ per site, so use the site's own group names where available.
        let named = [];
        try { named = (w.OneTrust.GetDomainData().Groups || []).map((x) => [x.CustomGroupId || x.OptanonGroupId, /always/i.test(x.Status || '') ? 'necessary' : x.GroupName || '']); } catch (_) { named = []; }
        const kind = (name) => (/necessary|essential|required/i.test(name) ? 'n' : /target|advert|marketing|social/i.test(name) ? 'm' : /performance|analytic|statistic/i.test(name) ? 'a' : /function|preference/i.test(name) ? 'f' : '');
        // C0001 is OneTrust's strictly necessary group, which cannot be refused whatever the site calls it.
        const map = named.length ? Object.fromEntries(named.map(([id, name]) => [id, id === 'C0001' ? 'n' : kind(name)])) : { C0002: 'a', C0003: 'f', C0004: 'm', C0005: 'm' };
        const on = (k) => Object.keys(g).some((id) => map[id] === k && g[id] === '1');
        // detail shows each group as id(kind):state; kind '?' means the site's names were not loaded yet.
        const detail = Object.entries(g).map(([id, v]) => `${id}(${named.length ? map[id] || '-' : '?'}):${v}`).join(',');
        Object.assign(out, { functional: on('f'), analytics: on('a'), marketing: on('m'), detail: detail.slice(0, 140), namesLoaded: named.length > 0 });
      }
    } else if (w.Didomi && typeof w.Didomi.getUserStatus === 'function') {
      const s = w.Didomi.getUserStatus();
      const en = (s.purposes && s.purposes.consent && s.purposes.consent.enabled) || [];
      Object.assign(out, { platform: 'Didomi', decided: typeof w.Didomi.shouldConsentBeCollected === 'function' ? !w.Didomi.shouldConsentBeCollected() : null,
        marketing: en.some((p) => /ads|advert|profile|personali|marketing|select_basic/i.test(p)),
        analytics: en.some((p) => /measure|market_research|improve|audience|analytic|statistic/i.test(p)), detail: en.join(',').slice(0, 100) });
    } else if (w.UC_UI && typeof w.UC_UI.getServicesBaseInfo === 'function') {
      const sv = w.UC_UI.getServicesBaseInfo().filter((x) => !x.isEssential);
      const on = sv.filter((x) => x.consent && x.consent.status);
      let interacted = null;
      try { interacted = localStorage.getItem('uc_user_interaction') === 'true'; } catch (_) { /* blocked */ }
      Object.assign(out, { platform: 'Usercentrics', decided: interacted, functional: on.some((x) => /functional|preference/i.test(x.categorySlug)),
        analytics: on.some((x) => /stat|analytic|performance/i.test(x.categorySlug)), marketing: on.some((x) => /market|advert/i.test(x.categorySlug)),
        detail: `${on.length} of ${sv.length} non-essential services on` });
    } else if (cookies.cmplz_marketing || cookies.cmplz_statistics || cookies['cmplz_banner-status']) {
      Object.assign(out, { platform: 'Complianz', decided: !!(cookies.cmplz_marketing || cookies['cmplz_banner-status'] === 'dismissed'),
        functional: cookies.cmplz_preferences === 'allow', analytics: cookies.cmplz_statistics === 'allow', marketing: cookies.cmplz_marketing === 'allow' });
    } else if (cookies.notice_preferences || cookies.notice_gdpr_prefs || w.truste) {
      const level = parseInt(cookies.notice_preferences, 10);
      Object.assign(out, { platform: 'TrustArc', decided: !!(cookies.notice_preferences || cookies.notice_gdpr_prefs),
        functional: level >= 1, analytics: level >= 1, marketing: level >= 2, detail: `notice_preferences=${cookies.notice_preferences || ''}` });
    } else if (cookies.cookies_policy) {
      const p = JSON.parse(cookies.cookies_policy);
      Object.assign(out, { platform: 'GOV.UK', decided: cookies.cookies_preferences_set === 'true', functional: !!p.settings, analytics: !!p.usage, marketing: !!p.campaigns });
    } else if (cookies['nhsuk-cookie-consent']) {
      const p = JSON.parse(cookies['nhsuk-cookie-consent']);
      Object.assign(out, { platform: 'NHS', decided: !!p.consented, functional: !!p.preferences, analytics: !!p.statistics, marketing: !!p.marketing });
    }
  } catch (e) { out.detail = `read error: ${String(e).slice(0, 80)}`; }
  if (!out.platform && tcf) {
    const ids = { 5: 'Usercentrics', 6: 'Sourcepoint', 7: 'Didomi', 10: 'Quantcast', 21: 'TrustArc', 28: 'OneTrust', 134: 'Cookiebot', 300: 'Google' };
    Object.assign(out, { platform: `TCF (${ids[tcf.cmpId] || `cmp ${tcf.cmpId}`})`, decided: tcf.eventStatus === 'useractioncomplete' || (tcf.hasString && tcf.eventStatus !== 'cmpuishown'),
      marketing: [2, 3, 4].some((p) => tcf.consents.includes(p)), analytics: [7, 8, 9].some((p) => tcf.consents.includes(p)), detail: `purposes ${tcf.consents.join(',') || 'none'}` });
  }
  if (!out.platform && Object.keys(cookies).some((k) => /consent|cookie_?pref|cookies_?accepted|gdpr/i.test(k))) {
    out.platform = 'cookie only';
    out.detail = Object.keys(cookies).filter((k) => /consent|pref|accepted|gdpr/i.test(k)).join(',').slice(0, 100);
  }
  return out;
}

// Click log in every frame, so we can prove no accept button was clicked.
const CLICK_LOG = `(() => {
  window.__rwClicks = [];
  document.addEventListener('click', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    const el = t && t.nodeType === 1 ? t : t && t.parentElement;
    const label = el ? (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : '';
    window.__rwClicks.push({ label, trusted: e.isTrusted, tag: el ? el.tagName : '', id: el ? el.id : '' });
  }, true);
})();`;

const norm = (s) => String(s || '').toLowerCase().replace(/[.!…]+$/, '').trim();
const isAccept = (label) => RW.CONSENT_ACCEPT_PATTERNS.some((re) => re.test(norm(label)));

function verdict(consent, intent) {
  if (!consent || !consent.platform) return 'unreadable';
  if (consent.platform === 'cookie only') return 'unreadable';
  if (consent.decided === false) return 'not decided';
  if (consent.namesLoaded === false) return 'unreadable'; // group ids alone do not say what a group is
  if (consent.analytics === true || consent.marketing === true) return 'MISMATCH: allows tracking';
  if (consent.analytics === null && consent.marketing === null) return 'unreadable';
  if (!intent.functional && consent.functional === true) return 'mismatch: functional on';
  if (intent.functional && consent.functional === false) return 'stricter than asked';
  return 'matches';
}

async function runConfig(name) {
  const setup = SETUP[name];
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-sites-'));
  const shots = path.join(OUT, 'shots', name);
  fs.mkdirSync(shots, { recursive: true });
  const args = setup ? [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`] : [];
  const nano = setup && setup.nano ? await launchNano() : null;
  const context = nano ? nano.context : await chromium.launchPersistentContext(userDir, {
    headless: true, channel: 'chromium', userAgent: UA, locale: 'en-GB', viewport: { width: 1366, height: 860 }, args
  });
  const results = [];
  let ext = null;
  try {
    if (setup) {
      let sw = nano ? nano.sw : context.serviceWorkers()[0];
      if (!sw) sw = await context.waitForEvent('serviceworker');
      const extId = new URL(sw.url()).host;
      ext = await context.newPage();
      await ext.goto(`chrome-extension://${extId}/options.html`);
      const msg = (action, payload) => ext.evaluate(([a, p]) => chrome.runtime.sendMessage({ action: a, payload: p }), [action, payload]);
      await msg(RW.ACTIONS.SET_GLOBAL_CUSTOM_OPTION, { key: 'consentCategories', value: setup.categories });
      await msg(RW.ACTIONS.SET_OPERATING_MODE, { mode: setup.mode });
      if (setup.tier) await msg(RW.ACTIONS.SET_GLOBAL_TIER, { tier: setup.tier });
      if (nano) {
        await msg(RW.ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: setup.ai });
        await ext.evaluate(() => chrome.storage.local.set({ aiMemory: {} }));
        if (setup.ai) {
          // Warm the model first: a cold first inference can take minutes, and until then banners are left alone.
          const t = Date.now();
          await sw.evaluate(async () => { const m = await LanguageModel.create({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }); await m.prompt('Reply with OK.'); m.destroy(); });
          console.log(`[${name}] model warm after ${Math.round((Date.now() - t) / 1000)} s`);
        }
      }
      ext.__msg = msg;
    }
    await context.addInitScript(CLICK_LOG);
    await context.addInitScript(FINGERPRINT_PROBE);
    for (const site of corpus) {
      const r = await visit(context, ext, site, setup, shots).catch((e) => ({ id: site.id, error: String(e && e.message || e).slice(0, 200) }));
      r.config = name;
      results.push(r);
      console.log(`[${name}] ${site.id}: ${r.error ? `error ${r.error}` : `${r.rockyweb ? `${r.rockyweb.cmp}/${r.rockyweb.method}/${r.rockyweb.decision} ${r.handledMs}ms` : 'not handled'} | ${r.consent ? `${r.consent.platform || '-'} ${r.verdict}` : ''} | banner after: ${r.bannerAfter || 'no'} | scroll ${r.scrolls} | errors ${(r.errors || []).length}`}`);
      const pv = r.privacy && !r.privacy.error ? r.privacy : null;
      if (pv) console.log(`[${name}] ${site.id} privacy: 3p ${pv.thirdParty.loaded}/${pv.thirdParty.requests} loaded, trackers ${pv.trackers.loaded} loaded ${pv.trackers.blocked} blocked, tracker cookies ${pv.cookies.trackerThirdParty}+${pv.cookies.firstPartyTracking}, fp scripts ${pv.fingerprinting.probeScripts}, params kept ${pv.linkParams.kept.length}`);
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(results, null, 2));
      await sleep(2500);
    }
    if (nano && ext) {
      const st = await ext.__msg(RW.ACTIONS.GET_AI_STATUS, {});
      fs.writeFileSync(path.join(OUT, `${name}.ai-status.json`), JSON.stringify(st.consent, null, 2));
      console.log(`[${name}] cookie banner AI: ${JSON.stringify(st.consent)}`);
    }
  } finally {
    if (nano) await nano.close(); else await context.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  return results;
}

async function visit(context, ext, site, setup, shots) {
  const page = await context.newPage();
  const errors = [];
  const geo = [];
  page.on('console', (m) => {
    const url = (m.location() && m.location().url) || '';
    if ((m.type() === 'error' || m.type() === 'warning') && (url.startsWith('chrome-extension://') || m.text().includes('[Rockyweb]'))) errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => { if (String(e.stack || '').includes('chrome-extension://')) errors.push(String(e.message).slice(0, 200)); });
  page.on('response', async (res) => {
    if (/geolocation\.onetrust\.com/.test(res.url())) { try { geo.push((await res.text()).slice(0, 200)); } catch (_) { /* gone */ } }
  });
  const r = { id: site.id, url: site.url, expectedCmp: site.expectedCmp };
  const requests = recordRequests(page);
  const cookiesBefore = await context.cookies();
  const t0 = Date.now();
  let status = null;
  try {
    const res = await page.goto(withTrackingParams(site.url), { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = res ? res.status() : null;
  } catch (e) { r.loadError = String(e.message).slice(0, 120); }
  r.status = status;
  r.finalUrl = page.url().split('?')[0].slice(0, 120);

  const popupState = async () => {
    if (!ext) return null;
    const host = new URL(page.url()).hostname;
    return ext.evaluate(async ([h, a]) => {
      const ts = await chrome.tabs.query({});
      const t = ts.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
      if (!t) return null;
      const s = await chrome.runtime.sendMessage({ action: a, payload: { tabId: t.id } });
      return s && s.tabStats ? { popup: s.tabStats.popup, ads: s.tabStats.ads, trackers: s.tabStats.trackers } : null;
    }, [host, RW.ACTIONS.GET_POPUP_STATE]).catch(() => null);
  };

  let st = null;
  for (const end = Date.now() + (setup ? 15000 : 8000); Date.now() < end;) {
    const b = await page.evaluate(bannerVisible, BANNER_SELECTORS).catch(() => null);
    if (b && !r.bannerSeenMs) { r.bannerSeenMs = Date.now() - t0; r.bannerSeen = b; }
    st = await popupState();
    if (st && st.popup) { r.handledMs = Date.now() - t0; break; }
    await sleep(250);
  }
  await sleep(2500);
  st = (await popupState()) || st;
  r.rockyweb = st && st.popup ? { cmp: st.popup.cmp, method: st.popup.method, decision: st.popup.decision } : null;
  r.counts = st ? { ads: st.ads, trackers: st.trackers } : null;
  r.bannerAfter = await page.evaluate(bannerVisible, BANNER_SELECTORS).catch(() => 'eval failed');
  r.consent = await page.evaluate(readConsent).catch((e) => ({ platform: null, detail: String(e).slice(0, 80) }));
  r.verdict = setup ? verdict(r.consent, setup.categories) : null;
  r.metrics = await page.evaluate(pageMetrics).catch(() => null);
  // Scroll the way a user would.
  const y0 = await page.evaluate(() => scrollY).catch(() => 0);
  await page.mouse.move(683, 500);
  await page.mouse.wheel(0, 600);
  await sleep(700);
  const y1 = await page.evaluate(() => scrollY).catch(() => 0);
  r.scrolls = y1 > y0 || (r.metrics && r.metrics.scrollHeight <= r.metrics.viewportHeight + 20) ? (y1 > y0 ? 'yes' : 'short page') : 'NO';
  await page.evaluate(() => scrollTo(0, 0)).catch(() => {});
  await page.screenshot({ path: path.join(shots, `${site.id}.png`) }).catch(() => {});
  // Before the reload, so each number is one page load.
  r.privacy = await privacyFor(TDS, page, site.url, requests.slice(), cookiesBefore, await context.cookies()).catch((e) => ({ error: String(e).slice(0, 120) }));

  if (setup) {
    // Follow-up: reload. A stuck decision means no banner and nothing for Rockyweb to answer.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    let again = null;
    for (const end = Date.now() + 7000; Date.now() < end;) {
      const s2 = await popupState();
      if (s2 && s2.popup) { again = s2.popup; break; }
      await sleep(300);
    }
    await sleep(1000);
    // OneTrust group names load after the cookie is readable; read the groups by their real names.
    await page.waitForFunction(() => !/OptanonConsent=/.test(document.cookie) || !!(window.OneTrust && window.OneTrust.GetDomainData && (window.OneTrust.GetDomainData() || {}).Groups),
      null, { timeout: 6000 }).catch(() => {});
    r.afterReload = {
      answeredAgain: again ? `${again.cmp}/${again.method}` : null,
      banner: await page.evaluate(bannerVisible, BANNER_SELECTORS).catch(() => 'eval failed'),
      consent: await page.evaluate(readConsent).catch(() => null)
    };
    r.afterReload.verdict = verdict(r.afterReload.consent, setup.categories);
  }
  // Every click seen in any frame (Rockyweb's clicks are script clicks, isTrusted false).
  const clicks = [];
  for (const f of page.frames()) {
    const c = await f.evaluate(() => window.__rwClicks || []).catch(() => []);
    for (const x of c) clicks.push(Object.assign({ frame: f === page.mainFrame() ? 'top' : new URL(f.url() || 'about:blank').hostname }, x));
  }
  r.clicks = clicks.filter((c) => !c.trusted).slice(0, 10);
  r.acceptClicks = r.clicks.filter((c) => isAccept(c.label));
  r.errors = errors;
  r.geo = geo.slice(0, 1);
  await page.close().catch(() => {});
  return r;
}

// Official Chrome (branded builds ignore --load-extension): load Rockyweb over the CDP pipe, and clear
// the corpus sites' cookies and storage first so every banner is seen fresh.
async function launchNano() {
  const CHROME = process.env.ROCKYWEB_NANO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const profile = process.env.ROCKYWEB_NANO_PROFILE;
  if (!profile) throw new Error('set ROCKYWEB_NANO_PROFILE to a Chrome profile that has Gemini Nano');
  const port = 9336;
  const chrome = spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--lang=en-GB', '--window-size=1366,960'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let buf = ''; let n = 0; const wait = new Map();
  chrome.stdio[4].on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\0')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } } });
  const pipe = (method, params) => new Promise((r) => { const k = ++n; wait.set(k, r); chrome.stdio[3].write(`${JSON.stringify({ id: k, method, params })}\0`); });
  let browser;
  for (let i = 0; i < 40 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch (_) { await sleep(500); } }
  const first = await pipe('Extensions.loadUnpacked', { path: EXT_DIR });
  await pipe('Extensions.uninstall', { id: first.result.id });
  await sleep(1000);
  const extId = (await pipe('Extensions.loadUnpacked', { path: EXT_DIR })).result.id;
  const context = browser.contexts()[0];
  let sw;
  for (let i = 0; i < 30 && !sw; i++) { sw = context.serviceWorkers().filter((w) => w.url() === `chrome-extension://${extId}/background.js`).pop(); if (!sw) await sleep(500); }
  const cdp = await browser.newBrowserCDPSession();
  for (const site of corpus) {
    const origin = new URL(site.url).origin;
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
  }
  await context.clearCookies();
  console.log(`official Chrome ${browser.version()}, Rockyweb ${extId}, corpus cookies and storage cleared`);
  return { context, sw, close: async () => { await browser.close().catch(() => {}); chrome.kill(); } };
}

const TDS = await loadTds(HERE);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tracker-data.json'), JSON.stringify({ source: 'DuckDuckGo tracker blocklist (Tracker Radar)', built: TDS.built, fetched: TDS.fetched }, null, 2));
console.log(`${corpus.length} sites, configs: ${CONFIGS.join(', ')}, output ${OUT}`);
for (const c of CONFIGS) {
  if (!(c in SETUP)) throw new Error(`unknown config ${c}`);
  await runConfig(c);
}
console.log('done');
