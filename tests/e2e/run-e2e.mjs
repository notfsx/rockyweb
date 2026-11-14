#!/usr/bin/env node
// End-to-end tests: loads ./extension into Chromium and drives it against a local fixture server.
// Fake hostnames are mapped to 127.0.0.1. Set E2E_SCREENSHOTS=<dir> to save UI screenshots.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

// CommonJS resolution so a globally installed Playwright (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fixture server
const page = (title, body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body style="font-family:sans-serif;min-height:3000px">${body}</body></html>`;

function route(host, url) {
  const p = url.split('?')[0];
  const PORT = server.address().port;
  const at = (h) => `http://${h}${PORT === 80 ? '' : `:${PORT}`}`;
  if (host.endsWith('doubleclick.net') && p === '/ad.js') return ['text/javascript', 'window.adLoaded = true;'];
  if (host.endsWith('google-analytics.com') && p === '/analytics.js') return ['text/javascript', 'window.realGA = true;'];
  if (host === 'tracker.test' && p === '/pixel.gif') return ['image/gif', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'), { 'Set-Cookie': 'uid=a8F3kL9qZx72Pp1w; Path=/; Max-Age=86400' }];
  if (host === 'tracker.test' && p === '/t.js') return ['text/javascript', 'window.trackerLoaded = true;'];
  if (p === '/ads') {
    return ['text/html', page('ads', `
      <h1>${host}</h1>
      <ins class="adsbygoogle" id="ins" style="display:block;width:300px;height:250px;background:#fc0">AD</ins>
      <script src="${at('securepubads.g.doubleclick.net')}/ad.js"></script>
      <script>window.inlineRan = true;</script>`)];
  }
  if (p === '/ga') {
    return ['text/html', page('ga', `
      <script>(function(i,s,o,g,r){i.GoogleAnalyticsObject=r;i[r]=i[r]||function(){(i[r].q=i[r].q||[]).push(arguments)};})(window,document,'script','','ga');</script>
      <script src="${at('www.google-analytics.com')}/analytics.js"></script>
      <script>ga('send', 'event', { hitCallback: function () { window.hitDone = true; } });</script>`)];
  }
  if (p === '/landing') return ['text/html', page('landing', '<h1>landing</h1>')];
  if (p === '/learn') return ['text/html', page('learn', `<img src="${at('tracker.test')}/pixel.gif" alt="">`)];
  if (p === '/tracker-script') return ['text/html', page('ts', `<script src="${at('tracker.test')}/t.js"></script>`)];
  if (p === '/onetrust') {
    return ['text/html', `<!doctype html><html class="ot-overflow-hidden" style="overflow:hidden"><head><meta charset="utf-8"><title>ot</title></head>
      <body style="min-height:3000px">
      <div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#eee">
        We use cookies. <button id="onetrust-accept-btn-handler">Accept All Cookies</button>
        <button id="onetrust-reject-all-handler">Reject All</button></div></div>
      <script>
        setTimeout(function () {
          window.OneTrust = {
            IsAlertBoxClosed: function () { return false; },
            RejectAll: function () { window.__ot = 'api-reject'; document.getElementById('onetrust-banner-sdk').style.display = 'none'; },
            AllowAll: function () { window.__ot = 'api-accept'; },
            UpdateConsent: function () {},
            GetDomainData: function () { return { Groups: [] }; }
          };
        }, 300);
      </script></body></html>`];
  }
  if (p === '/generic') {
    return ['text/html', page('generic', `
      <div class="site-privacy-notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;z-index:9">
        We use cookies to personalise content and analyse traffic. See our privacy policy.
        <button onclick="window.__choice='accept';this.parentNode.remove()">Accept all</button>
        <button onclick="window.__choice='settings'">Cookie settings</button>
        <button onclick="window.__choice='reject';this.parentNode.remove()">Reject all</button>
      </div>`)];
  }
  if (p === '/picker') {
    return ['text/html', page('picker', `
      <nav class="flex md:flex top-nav" style="background:#ddd;padding:10px">nav</nav>
      <div class="promo-banner" style="background:#fc0;padding:30px;margin:20px">PROMO</div>
      <div class="sc-AxjAm hGHkfA" style="background:#9cf;padding:30px;margin:20px">box one</div>
      <div class="sc-AxjAm hGHkfA" style="background:#9cf;padding:30px;margin:20px">box two</div>`)];
  }
  if (p === '/sticky-header') {
    return ['text/html', page('header', `
      <header style="position:fixed;top:0;left:0;right:0;height:56px;background:#fff;z-index:9">
        <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms</a>
        <button onclick="window.__clicked='settings'">Settings</button>
        <button onclick="window.__clicked='manage'">Manage account</button>
        <button onclick="window.__clicked='decline'">Decline</button>
      </header>`)];
  }
  return null;
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  const r = route(host, req.url);
  if (!r) { res.writeHead(404); res.end('not found'); return; }
  const [type, body, extra] = r;
  res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
});

// ------------------------------------------------------------------ harness
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push([false, name, err]);
    console.log(`  ✗ ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`);
  }
}

async function poll(fn, timeout = 8000, interval = 200) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  return last;
}

// Port 80 when available: URL-pattern rules such as ||google-analytics.com/analytics.js
// cannot match a URL that carries an explicit port.
await new Promise((resolve) => {
  server.once('error', () => server.listen(0, '127.0.0.1', resolve));
  server.listen(80, '127.0.0.1', resolve);
});
const PORT = server.address().port;
const at = (h, p) => `http://${h}${PORT === 80 ? '' : `:${PORT}`}${p}`;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-e2e-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium', // full Chromium (new headless), the headless shell cannot load extensions
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--host-resolver-rules=MAP * 127.0.0.1',
    '--no-proxy-server'
  ],
  viewport: { width: 1280, height: 800 }
});

let exitCode = 0;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log(`extension ${extId} loaded, fixtures on :${PORT}`);

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const msg = (action, payload) => ext.evaluate(([a, p]) => chrome.runtime.sendMessage({ action: a, payload: p }), [action, payload]);
  const ACTIONS = await ext.evaluate(() => window.RockyShared.ACTIONS);

  await check('service worker compiles dynamic rules on install', async () => {
    const n = await poll(() => sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)));
    assert.ok(n >= 4, `expected URL-strip rules, got ${n}`);
  });

  const web = await context.newPage();
  if (process.env.E2E_DEBUG) web.on('requestfailed', (r) => console.log('      [requestfailed]', r.url(), r.failure() && r.failure().errorText));

  await check('Balanced: static rule blocks third-party ad script, inline scripts still run', async () => {
    await web.goto(at('news.test', '/ads'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.inlineRan), true);
    assert.equal(await web.evaluate(() => window.adLoaded), undefined);
  });

  await check('Balanced: cosmetic CSS hides ins.adsbygoogle', async () => {
    const hidden = await poll(() => web.evaluate(() => getComputedStyle(document.getElementById('ins')).display === 'none'));
    assert.equal(hidden, true);
  });

  await check('page load event is not delayed by the consent engine', async () => {
    const t = Date.now();
    await web.goto(at('speed.test', '/landing'), { waitUntil: 'load' });
    const ms = Date.now() - t;
    assert.ok(ms < 1500, `load took ${ms} ms`);
  });

  await check('surrogate keeps ga() hitCallback working while GA is blocked', async () => {
    if (PORT !== 80) { console.log('      (skipped: needs fixture server on port 80)'); return; }
    await web.goto(at('news.test', '/ga'));
    const done = await poll(() => web.evaluate(() => window.hitDone === true));
    assert.equal(done, true);
    assert.equal(await web.evaluate(() => window.realGA), undefined);
  });

  await check('tracking parameters are stripped from top-level navigations', async () => {
    await web.goto(at('news.test', '/landing?utm_source=newsletter&id=7&fbclid=abc'));
    assert.equal(web.url(), at('news.test', '/landing?id=7'));
  });

  await check('OneTrust handled through its MAIN-world API and scroll lock healed', async () => {
    await web.goto(at('cmp.test', '/onetrust'));
    const v = await poll(() => web.evaluate(() => window.__ot), 10000);
    assert.equal(v, 'api-reject');
    const healed = await poll(() => web.evaluate(() => !document.documentElement.classList.contains('ot-overflow-hidden') && getComputedStyle(document.documentElement).overflowY !== 'hidden'), 6000);
    assert.equal(healed, true);
    const toast = await poll(() => web.evaluate(() => !!document.querySelector('rockyweb-toast')), 3000);
    assert.equal(toast, true, 'toast element present');
  });

  await check('unknown banner rejected by multilingual text heuristics', async () => {
    await web.goto(at('generic.test', '/generic'));
    const choice = await poll(() => web.evaluate(() => window.__choice), 12000);
    assert.equal(choice, 'reject');
  });

  await check('zero breakage: a site header with privacy links and settings buttons is never clicked', async () => {
    await web.goto(at('header.test', '/sticky-header'));
    await sleep(5000);
    assert.equal(await web.evaluate(() => window.__clicked), undefined);
    assert.notEqual(await web.evaluate(() => getComputedStyle(document.querySelector('header')).display), 'none');
  });

  await check('popup state reports the handled popup for the tab', async () => {
    await web.goto(at('cmp.test', '/onetrust'));
    await poll(() => web.evaluate(() => window.__ot), 10000);
    const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), at('cmp.test', '/'));
    const st = await poll(async () => { const r = await msg(ACTIONS.GET_POPUP_STATE, { tabId }); return r.tabStats && r.tabStats.popup ? r : null; }, 5000);
    assert.equal(st.tabStats.popup.cmp, 'OneTrust');
    assert.equal(st.tabStats.popup.method, 'api');
    assert.equal(st.config.tier, 'balanced');
  });

  await check('Off tier: dynamic allowAllRequests bypass lets the ad load, nothing hidden', async () => {
    const r = await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'off.test', tier: 'off' });
    assert.equal(r.ok, true);
    await web.goto(at('www.off.test', '/ads'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.adLoaded), true);
    await sleep(800);
    assert.notEqual(await web.evaluate(() => getComputedStyle(document.getElementById('ins')).display), 'none');
    await web.goto(at('off.test', '/landing?utm_source=x'));
    assert.ok(web.url().includes('utm_source=x'), 'params kept on Off sites');
  });

  await check('Consent-only tier: no blocking, but cookie popups are still answered', async () => {
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'consent.test', tier: 'consent_only' });
    await web.goto(at('consent.test', '/ads'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.adLoaded), true);
    await web.goto(at('consent.test', '/generic'));
    assert.equal(await poll(() => web.evaluate(() => window.__choice), 12000), 'reject');
  });

  await check('Custom: per-site switch persists in chrome.storage.local', async () => {
    await msg(ACTIONS.SET_SITE_CUSTOM_OPTION, { siteKey: 'custom.test', key: 'adBlockNetwork', value: false });
    const stored = await ext.evaluate(() => chrome.storage.local.get('siteProfiles').then((r) => r.siteProfiles['custom.test']));
    assert.equal(stored.tier, 'custom');
    assert.equal(stored.customOverrides.adBlockNetwork, false);
    assert.equal(stored.customOverrides.trackerHeuristicMode, 'cookie_strip');
    await web.goto(at('custom.test', '/ads'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.adLoaded), true);
    await web.goto(at('custom.test', '/landing?gclid=1&q=2'));
    assert.equal(web.url(), at('custom.test', '/landing?q=2'), 'URL stripping still on');
  });

  await check('heuristic learner promotes a cross-site tracker after 3 sites', async () => {
    for (const site of ['site1.test', 'site2.test', 'site3.test']) {
      await web.goto(at(site, '/learn'));
      await web.waitForLoadState('load');
      await sleep(300);
    }
    const rec = await poll(async () => {
      const r = await msg(ACTIONS.GET_OPTIONS_STATE, {});
      const t = r.state.learnedTrackers['tracker.test'];
      return t && t.learnedStatus === 'cookie_block' ? t : null;
    }, 6000);
    assert.ok(rec, 'tracker.test learned');
    assert.equal(rec.firstPartyHosts.length, 3);
    const rule = await poll(() => sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((rs) =>
      rs.find((x) => x.action.type === 'modifyHeaders' && (x.condition.requestDomains || []).includes('tracker.test')))), 6000);
    assert.ok(rule, 'cookie-strip rule compiled');
  });

  await check('Strict: learned tracker hard-blocked; Balanced only strips cookies', async () => {
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'strict.test', tier: 'strict' });
    await web.goto(at('strict.test', '/tracker-script'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.trackerLoaded), undefined);
    await web.goto(at('site4.test', '/tracker-script'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.trackerLoaded), true);
  });

  await check('per-site slider "allow" overrides the static ad list', async () => {
    await msg(ACTIONS.SET_DOMAIN_SLIDER, { siteKey: 'news.test', domain: 'doubleclick.net', value: 'allow' });
    await web.goto(at('news.test', '/ads'));
    await web.waitForLoadState('load');
    assert.equal(await web.evaluate(() => window.adLoaded), true);
    const p = await ext.evaluate(() => chrome.storage.local.get('siteProfiles').then((r) => r.siteProfiles['news.test']));
    assert.equal(p.tier, 'custom');
    assert.deepEqual(p.domainSliderOverrides, { 'doubleclick.net': 'allow' });
  });

  await check('element picker: click hides and saves, ctrl+z undoes, survives reload', async () => {
    await web.goto(at('picker.test', '/picker'));
    await web.waitForLoadState('load');
    const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), at('picker.test', '/'));
    const startPicker = () => ext.evaluate((t) => chrome.tabs.sendMessage(t, { action: 'startElementPicker', payload: {} }, { frameId: 0 }), tabId);
    const shown = (sel) => web.evaluate((q) => [...document.querySelectorAll(q)].map((e) => getComputedStyle(e).display !== 'none'), sel);
    const stored = () => ext.evaluate(() => chrome.storage.local.get('siteProfiles').then((r) => (r.siteProfiles['picker.test'] || { customCosmeticSelectors: [] }).customCosmeticSelectors));
    const clickOn = async (loc) => { const b = await loc.boundingBox(); await web.mouse.move(b.x + 8, b.y + b.height / 2, { steps: 3 }); await web.mouse.click(b.x + 8, b.y + b.height / 2); await sleep(400); };

    await startPicker();
    await web.bringToFront();
    await clickOn(web.locator('.promo-banner'));
    assert.deepEqual(await shown('.promo-banner'), [false], 'promo hidden after click');
    await clickOn(web.locator('.hGHkfA').nth(1));
    assert.deepEqual(await shown('.hGHkfA'), [true, false], 'second box hidden after click');
    let sels = await poll(async () => { const v = await stored(); return v.length === 2 ? v : null; }, 4000);
    assert.equal(sels[0], 'div.promo-banner');
    assert.ok(!sels[1].includes('sc-AxjAm') && !sels[1].includes('hGHkfA'), `hashed classes avoided: ${sels[1]}`);
    // Hide and undo straight away, before the save round-trip can finish.
    const first = await web.locator('.hGHkfA').first().boundingBox();
    await web.mouse.move(first.x + 8, first.y + first.height / 2);
    await web.mouse.click(first.x + 8, first.y + first.height / 2);
    await web.keyboard.press('Control+z');
    await web.keyboard.press('Control+z');
    assert.deepEqual(await poll(async () => { const v = await shown('.hGHkfA'); return v[0] && v[1] ? v : null; }, 3000), [true, true], 'undo shows both boxes again');
    sels = await poll(async () => { const v = await stored(); return v.length === 1 ? v : null; }, 4000);
    assert.deepEqual(sels, ['div.promo-banner'], 'undo removed the saved selector');
    await web.keyboard.press('Escape');
    assert.equal(await web.evaluate(() => !!document.querySelector('rockyweb-picker')), false);
    await web.reload();
    await web.waitForLoadState('load');
    assert.equal(await poll(() => web.evaluate(() => getComputedStyle(document.querySelector('.promo-banner')).display === 'none')), true);
    assert.deepEqual(await shown('.hGHkfA'), [true, true], 'after reload only the promo stays hidden');
  });

  await check('content scripts and pages cannot use each other\'s privileged actions', async () => {
    const r = await msg('notARealAction', {});
    assert.equal(r.ok, false);
    const r2 = await msg(ACTIONS.CONSENT_HANDLED, { cmp: 'OneTrust' });
    assert.equal(r2.error, 'forbidden');
  });

  await check('stats were persisted', async () => {
    const st = await poll(async () => {
      const s = await ext.evaluate(() => chrome.storage.local.get('stats').then((r) => r.stats));
      return s.totalPopupsHandled > 0 && s.totalAdsBlocked > 0 ? s : null;
    }, 6000);
    assert.ok(st);
  });

  const shots = process.env.E2E_SCREENSHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await web.goto(at('site4.test', '/learn'));
    await web.waitForLoadState('load');
    await sleep(500);
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'site4.test', tier: 'balanced' });
    const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), at('site4.test', '/'));
    const shot = async (name, query, height) => {
      const pop = await context.newPage();
      await pop.setViewportSize({ width: 340, height: height || 400 });
      await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}${query}`);
      await sleep(700);
      await pop.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
      await pop.close();
    };
    await shot('popup-main', '');
    await shot('popup-advanced', '&view=advanced', 700);
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'site4.test', tier: 'off' });
    await shot('popup-paused', '');
    await ext.reload();
    await sleep(700);
    await ext.screenshot({ path: path.join(shots, 'options.png') });
    await ext.evaluate(() => document.getElementById('trackers').scrollIntoView());
    await sleep(400);
    await ext.screenshot({ path: path.join(shots, 'options-trackers.png') });
    console.log(`  screenshots written to ${shots}`);
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
process.exit(failed.length || exitCode ? 1 : 0);
