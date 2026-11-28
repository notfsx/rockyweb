#!/usr/bin/env node
// End-to-end tests: loads ./extension into Chromium and drives it against a local fixture server.
// Fake hostnames are mapped to 127.0.0.1. Set E2E_SCREENSHOTS=<dir> to save UI screenshots.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EXT_DIR as DEFAULT_EXT } from '../../scripts/load-shared.mjs';

// ROCKYWEB_EXT runs another build (before and after comparisons); ROCKYWEB_CHROME another browser.
const EXT_DIR = process.env.ROCKYWEB_EXT || DEFAULT_EXT;

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
  // Paired with real sites from the 2026-11-15 corpus run. Every click is recorded.
  if (p === '/nhs-like') {
    // NHS: inline banner, the real reject button has the id ...link_accept, settings is a link to another page.
    return ['text/html', page('nhs', `<script>window.__clicks = [];</script><div id="x-cookie-banner"><div class="x-cookie-banner"><h2>Cookies on the Example website</h2>
      <p>We use some cookies to make this website work.</p><p>Help improve online services by also accepting analytics cookies.</p>
      <button id="x-cookie-banner__link_accept_analytics" onclick="window.__clicks.push('accept')">Accept analytics cookies</button>
      <button id="x-cookie-banner__link_accept" onclick="window.__clicks.push('reject');document.getElementById('x-cookie-banner').hidden=true">Reject analytics cookies</button>
      <a id="x-cookie-banner__link" href="/our-policies/choose-your-cookie-settings/" onclick="window.__clicks.push('settings-link')">Choose your cookie settings</a></div></div>
      <main><h1>Health A to Z</h1>${'<p>Text.</p>'.repeat(60)}</main>`)];
  }
  if (p === '/ryanair-like') {
    // Ryanair: a full-screen dialogue whose three buttons share a "button-settings" class.
    const b = (ref, label, kind) => `<button class="cookie-popup-with-overlay__button-settings" data-ref="cookie.${ref}" onclick="window.__clicks.push('${kind}')${kind === 'reject' ? ";this.closest('#cookie-popup-with-overlay').remove()" : ''}">${label}</button>`;
    return ['text/html', page('ryanair', `<script>window.__clicks = [];</script><main><h1>Flights</h1>${'<p>Text.</p>'.repeat(60)}</main>
      <div id="cookie-popup-with-overlay" role="dialog" aria-modal="true" style="background:rgba(0,0,0,.4);position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;display:flex">
      <div style="background:#fff;margin:auto;width:740px;padding:32px"><h2>We value your privacy</h2><p>By clicking "Yes, I agree", you agree to us using cookies to personalise content and analyse our traffic.</p>
      ${b('view-settings', 'View cookie settings', 'settings')}${b('no-thanks', 'No, thanks', 'reject')}${b('accept-all', 'Yes, I agree', 'accept')}</div></div>`)];
  }
  if (p === '/appconsent-like') {
    // Le Figaro (AppConsent): the banner is drawn into an iframe with no address of its own.
    const inner = '<body style="margin:0;font-family:sans-serif"><div style="background:#fff;margin:10% auto;width:60%;padding:20px">' +
      '<button onclick="parent.__clicks.push(\'reject\');parent.document.getElementById(\'cmp\').remove()">Continue without accepting</button>' +
      '<h2>Make a choice for your data</h2><p>We and our partners use cookies to store and access information on your device.</p>' +
      '<button onclick="parent.__clicks.push(\'setup\')">SET UP</button><button onclick="parent.__clicks.push(\'accept\')">ACCEPT ALL</button></div></body>';
    return ['text/html', page('appconsent', `<script>window.__clicks = [];</script><main><h1>Le journal</h1>${'<p>Text.</p>'.repeat(60)}</main>
      <script>setTimeout(function () { var f = document.createElement('iframe'); f.id = 'cmp'; f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999';
        document.body.appendChild(f); f.contentDocument.open(); f.contentDocument.write(${JSON.stringify(inner)}); f.contentDocument.close();
        document.body.classList.add('appconsent_noscroll'); }, 300);</script>`)];
  }
  if (p === '/settings-dead-end') {
    // Ryanair in the 2026-11-15 run: "View cookie settings" replaces the banner with a layer Rockyweb cannot
    // finish. The way back is its close button; the refusal is on the first layer.
    return ['text/html', page('deadend', `<script>window.__clicks = [];</script><main><h1>Flights</h1>${'<p>Text.</p>'.repeat(60)}</main>
      <div id="first" role="dialog" aria-modal="true" style="position:fixed;inset:20% 20% auto;background:#fff;padding:20px;z-index:9">
        <h2>We value your privacy</h2><p>We use cookies to personalise content and analyse our traffic.</p>
        <button onclick="window.__clicks.push('settings');first.hidden=true;second.hidden=false">View cookie settings</button>
        <button onclick="window.__clicks.push('reject');first.remove();second.remove();document.documentElement.style.overflow=''">No, thanks</button>
        <button onclick="window.__clicks.push('accept')">Yes, I agree</button></div>
      <div id="second" role="dialog" aria-modal="true" hidden style="position:fixed;inset:10%;background:#fff;padding:20px;z-index:10">
        <h2>Cookie settings</h2><p>Strictly necessary cookies are always on. Read about each cookie category below.</p>
        <button aria-label="Close" onclick="window.__clicks.push('close');second.hidden=true;first.hidden=false">×</button></div>
      <script>document.documentElement.style.overflow='hidden';</script>`)];
  }
  if (p === '/fake-no-thanks') {
    // A "No thanks" whose accessible name is accept: a trap, never pressed.
    return ['text/html', page('fake', `<script>window.__clicks = [];</script><main><h1>News</h1></main>
      <div class="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff">We use cookies for ads and analytics.
      <button onclick="window.__clicks.push('accept')">Agree</button><button aria-label="Accept all cookies" onclick="window.__clicks.push('accept-disguised')">No thanks</button></div>`)];
  }
  if (p === '/inline-banner' || p === '/inline-low') {
    // Like GOV.UK: an ordinary block at the top of the page, not an overlay.
    const banner = `<div class="site-cookie-banner" role="region" aria-label="Cookies on Example"><h2>Cookies on Example</h2>
      <p>We use some essential cookies to make this service work. We would also like to use analytics cookies.</p>
      <button onclick="window.__choice='accept'">Accept additional cookies</button>
      <button onclick="window.__choice='reject';this.parentNode.hidden=true">Reject additional cookies</button></div>`;
    const filler = '<p>Policy text.</p>'.repeat(120);
    return ['text/html', page('inline', p === '/inline-banner' ? `${banner}<main><h1>Service</h1>${filler}</main>` : `<main><h1>Cookie policy</h1>${filler}${banner}</main>`)];
  }
  if (p === '/onetrust-groups') {
    // Real OneTrust descriptions often say "essential" or "necessary" in non-necessary groups.
    return ['text/html', page('otg', `<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#eee">
        We use cookies. <button id="onetrust-reject-all-handler">Reject All</button></div></div>
      <script>
        window.__granted = [];
        setTimeout(function () {
          window.OneTrust = {
            IsAlertBoxClosed: function () { return false; },
            RejectAll: function () { window.__ot = 'api-reject'; document.getElementById('onetrust-banner-sdk').style.display = 'none'; },
            AllowAll: function () { window.__ot = 'api-accept'; },
            UpdateConsent: function (kind, v) { window.__granted.push(v); },
            GetDomainData: function () { return { Groups: [
              { OptanonGroupId: 'C0001', GroupName: 'Strictly Necessary Cookies', GroupDescription: 'Essential for the site to work.' },
              { OptanonGroupId: 'C0002', GroupName: 'Performance Cookies', GroupDescription: 'Count visits. Not strictly necessary.' },
              { OptanonGroupId: 'C0003', GroupName: 'Functional Cookies', GroupDescription: 'Enhanced functionality. Without them some services may not work as necessary.' },
              { OptanonGroupId: 'C0004', GroupName: 'Targeting Cookies', GroupDescription: 'Advertising partners. Not essential.' }
            ] }; }
          };
        }, 300);
      </script>`)];
  }
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
  if (process.env.E2E_ONLY && !name.includes(process.env.E2E_ONLY)) return; // run a subset while debugging
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
  // Full Chromium (new headless); the headless shell cannot load extensions.
  ...(process.env.ROCKYWEB_CHROME ? { executablePath: process.env.ROCKYWEB_CHROME, headless: false, ignoreDefaultArgs: ['--headless'] } : { channel: 'chromium' }),
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--host-resolver-rules=MAP * 127.0.0.1',
    '--no-proxy-server',
    ...(process.env.ROCKYWEB_CHROME ? ['--headless=new'] : []) // older Chrome: name the mode that loads extensions
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

  // The general settings first-run setup can change, read back from the background.
  const general = async () => {
    const s = (await msg(ACTIONS.GET_OPTIONS_STATE, {})).state;
    return { tier: s.globalDefaultTier, mode: s.operatingMode, cats: s.globalCustomConfig.consentCategories, ai: s.aiSettings.enabled };
  };
  const openSetup = async () => {
    const w = await context.newPage();
    await w.goto(`chrome-extension://${extId}/options.html#welcome`);
    await w.waitForSelector('#setupNext');
    return w;
  };
  const toStep2 = async (w) => {
    await w.click('#setupNext');
    await w.waitForSelector('#setupTier [role=radio]');
  };
  const checked = (w, sel) => w.evaluate((s) => [...document.querySelectorAll(`${s} [role=radio][aria-checked=true]`)].map((b) => b.textContent), sel);

  await check('first-run setup: opens once; step 1 is a short intro with only next to press; protection already runs', async () => {
    const opened = await poll(() => {
      const n = context.pages().filter((p) => p.url().includes('#welcome')).length;
      return n || null;
    });
    assert.equal(opened, 1, 'one welcome tab opens on a fresh install');
    for (const p of context.pages()) if (p.url().includes('#welcome')) await p.close();
    const before = await general();
    assert.equal(before.tier, 'balanced', 'protection runs with the defaults before setup is finished');
    assert.equal(before.ai, false);
    const w = await openSetup();
    const v = await w.evaluate(() => ({
      intro: !document.getElementById('setupIntro').hidden,
      general: document.getElementById('setupGeneral').hidden,
      others: document.getElementById('protection').hidden,
      nav: document.getElementById('nav').checkVisibility(),
      text: document.getElementById('setupIntro').innerText,
      buttons: [...document.querySelectorAll('#setupIntro button')].map((b) => b.textContent),
      controls: document.querySelectorAll('#setupIntro [role=radio], #setupIntro [role=switch], #setupIntro input, #setupIntro select, #setupIntro dl').length
    }));
    assert.ok(v.intro && v.general && v.others);
    assert.equal(v.nav, false, 'the settings nav is hidden during setup');
    for (const re of [/cookie popups/, /ads and trackers/, /links/, /toolbar icon/]) assert.match(v.text, re);
    assert.deepEqual(v.buttons, ['next'], 'nothing on the intro looks adjustable');
    assert.equal(v.controls, 0);
    await w.close();
  });

  await check('first-run setup: step 2 starts from today\'s settings; done with nothing changed changes nothing', async () => {
    const before = await general();
    const w = await openSetup();
    await toStep2(w);
    assert.equal(await w.evaluate(() => document.activeElement.id), 'generalTitle', 'focus moves to step 2');
    assert.deepEqual(await checked(w, '#setupTier'), ['balanced']);
    assert.deepEqual(await checked(w, '#setupOperating'), ['full']);
    assert.deepEqual(await checked(w, '#setupCookies'), ['on', 'off', 'off'], 'functional on, analytics and marketing off');
    const hasLM = await w.evaluate(() => typeof self.LanguageModel !== 'undefined');
    if (!hasLM) assert.equal(await w.evaluate(() => document.getElementById('setupAi').hidden), true, 'no on-device AI here, so no offer');
    await w.click('#setupBack');
    assert.equal(await w.evaluate(() => !document.getElementById('setupIntro').hidden), true, 'back returns to the intro');
    await toStep2(w);
    await w.click('#setupDone');
    await w.waitForFunction(() => location.hash === '#protection' && !document.getElementById('protection').hidden);
    assert.equal(await w.evaluate(() => document.getElementById('nav').checkVisibility()), true, 'the settings nav is back');
    assert.deepEqual(await general(), before);
    await w.close();
  });

  await check('first-run setup: closing half way changes nothing; done applies the choices', async () => {
    const before = await general();
    let w = await openSetup();
    await toStep2(w);
    await w.click('#setupTier [role=radio]:text-is("strict")');
    await w.click('#setupOperating [role=radio]:text-is("light")');
    await sleep(300);
    await w.close();
    assert.deepEqual(await general(), before, 'nothing is saved until done');

    w = await openSetup();
    await toStep2(w);
    await w.click('#setupCookies .setup-cat:has-text("analytics") [role=radio]:text-is("on")');
    await w.click('#setupTier [role=radio]:text-is("strict")');
    assert.equal(await w.evaluate(() => document.querySelectorAll('#setupCookies [aria-disabled=true]').length), 3, 'strict rejects everything optional');
    await w.click('#setupOperating [role=radio]:text-is("light")');
    await w.click('#setupDone');
    const after = await poll(async () => { const g = await general(); return g.mode === 'light' ? g : null; });
    assert.equal(after.tier, 'strict');
    assert.equal(after.cats.analytics, true);
    assert.equal(after.cats.marketing, false);
    assert.equal(after.ai, false, 'AI stays off');
    await w.close();
    await msg(ACTIONS.SET_GLOBAL_TIER, { tier: 'balanced' });
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'full' });
    await msg(ACTIONS.SET_GLOBAL_CUSTOM_OPTION, { key: 'consentCategories', value: before.cats });
    assert.deepEqual(await general(), before);
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
    await sleep(1500);
    assert.equal(await web.evaluate(() => !!document.querySelector('rockyweb-toast')), false, 'on-page confirmations are silent by default');
  });

  await check('unknown banner rejected by multilingual text heuristics', async () => {
    await web.goto(at('generic.test', '/generic'));
    // Functional cookies are allowed by default, so the settings route is tried first; this
    // banner has no granular controls, so Rockyweb falls back to "Reject all".
    const choice = await poll(() => web.evaluate(() => (window.__choice === 'reject' ? 'reject' : null)), 12000);
    assert.equal(choice, 'reject');
  });

  await check('zero breakage: a site header with privacy links and settings buttons is never clicked', async () => {
    await web.goto(at('header.test', '/sticky-header'));
    await sleep(5000);
    assert.equal(await web.evaluate(() => window.__clicked), undefined);
    assert.notEqual(await web.evaluate(() => getComputedStyle(document.querySelector('header')).display), 'none');
  });

  await check('inline cookie banner at the top of the page is rejected; the same block lower down is left alone', async () => {
    await web.goto(at('inline.test', '/inline-banner'));
    assert.equal(await poll(() => web.evaluate(() => window.__choice), 8000), 'reject');
    await web.goto(at('inline2.test', '/inline-low'));
    await sleep(4000);
    assert.equal(await web.evaluate(() => window.__choice || null), null);
  });

  await check('NHS-like banner: "Reject analytics cookies" pressed despite its accept-looking id; the settings link is never followed', async () => {
    const url = at('nhslike.test', '/nhs-like');
    await web.goto(url);
    assert.ok(await poll(() => web.evaluate(() => window.__clicks.includes('reject')), 10000), 'rejected');
    await sleep(1500);
    assert.deepEqual(await web.evaluate(() => window.__clicks), ['reject']);
    assert.equal(web.url(), url, 'no navigation');
  });

  await check('Ryanair-like dialogue: "No, thanks" pressed, never "Yes, I agree"', async () => {
    const url = at('ryanlike.test', '/ryanair-like');
    await web.goto(url);
    assert.ok(await poll(() => web.evaluate(() => window.__clicks.includes('reject')), 10000), 'rejected');
    await sleep(1500);
    const clicks = await web.evaluate(() => window.__clicks);
    assert.ok(!clicks.includes('accept'), clicks.join(','));
    assert.equal(web.url(), url, 'no navigation');
  });

  await check('AppConsent-like banner inside an address-less iframe: "Continue without accepting", never accept', async () => {
    const url = at('framecmp.test', '/appconsent-like');
    await web.goto(url);
    assert.ok(await poll(() => web.evaluate(() => window.__clicks.includes('reject')), 10000), 'rejected');
    await sleep(1500);
    const clicks = await web.evaluate(() => window.__clicks);
    assert.ok(!clicks.includes('accept'), clicks.join(','));
    assert.equal(web.url(), url, 'no navigation');
  });

  await check('a settings layer that cannot be finished is closed and the banner refused, never left open', async () => {
    const url = at('deadend.test', '/settings-dead-end');
    await web.goto(url);
    assert.ok(await poll(() => web.evaluate(() => window.__clicks.includes('reject')), 12000), JSON.stringify(await web.evaluate(() => window.__clicks)));
    const clicks = await web.evaluate(() => window.__clicks);
    assert.ok(!clicks.includes('accept'), clicks.join(','));
    assert.equal(await web.evaluate(() => !!document.querySelector('[role="dialog"]:not([hidden])')), false, 'no dialogue left open');
    assert.equal(web.url(), url);
  });

  await check('a "No thanks" whose accessible name says accept is never pressed', async () => {
    await web.goto(at('fakeno.test', '/fake-no-thanks'));
    await sleep(6000);
    assert.deepEqual(await web.evaluate(() => window.__clicks), []);
  });

  await check('OneTrust API grants exactly the functional group when its description says "necessary"', async () => {
    await web.goto(at('cmpgroups.test', '/onetrust-groups'));
    await poll(() => web.evaluate(() => window.__ot), 10000);
    await sleep(300);
    assert.equal(await web.evaluate(() => window.__ot), 'api-reject');
    assert.deepEqual(await web.evaluate(() => window.__granted), ['C0003:1']);
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

  await check('popup renders the page without stray "null" or "undefined" text', async () => {
    const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), at('cmp.test', '/'));
    const pop = await context.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    const text = await poll(() => pop.evaluate(() => (document.querySelector('.stats') ? document.body.innerText : null)), 5000);
    await pop.close();
    assert.ok(!/\b(null|undefined)\b/.test(text), `popup text: ${text}`);
  });

  await check('popup on a browser page: the gear button opens settings', async () => {
    const tabId = await ext.evaluate(() => chrome.tabs.create({ url: 'chrome://version/', active: false }).then((t) => t.id));
    await sleep(500);
    const pop = await context.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await poll(() => pop.evaluate(() => !!document.querySelector('.unsupported')), 5000);
    const gear = await pop.evaluate(() => { const g = document.getElementById('gear'); return { hidden: g.hidden, label: g.getAttribute('aria-label'), pressed: g.getAttribute('aria-pressed') }; });
    assert.equal(gear.hidden, false);
    assert.equal(gear.label, 'Advanced settings');
    assert.equal(gear.pressed, null, 'not a toggle here');
    await pop.focus('#gear');
    // The popup closes itself; Chrome opens the options page or focuses the one already open.
    await pop.keyboard.press('Enter').catch(() => {});
    // Ask the settings pages themselves: older Chrome hides extension URLs from tabs.query.
    const active = await poll(async () => {
      for (const pg of context.pages()) {
        if (pg.isClosed() || !pg.url().includes('/options.html')) continue;
        if (await pg.evaluate(() => document.visibilityState === 'visible').catch(() => false)) return true;
      }
      return null;
    }, 5000);
    assert.ok(active, 'options page shown');
    if (!pop.isClosed()) await pop.close();
    await ext.evaluate((id) => chrome.tabs.remove(id), tabId);
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
    assert.equal(await poll(() => web.evaluate(() => (window.__choice === 'reject' ? 'reject' : null)), 12000), 'reject');
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
    // Inherited names are not actions.
    for (const action of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      const r3 = await msg(action, {});
      assert.deepEqual(r3, { ok: false, error: 'unknown_action' }, action);
    }
  });

  // ---- settings page: mode facts, information buttons, links, hints
  const settingsPage = async (hash) => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/options.html#${hash}`);
    await p.waitForFunction(() => document.querySelectorAll('#tierFacts .fact-btn').length === 6);
    return p;
  };

  await check('mode facts: clicking "shown" hides annoyances and makes the default mode custom, by mouse and keyboard', async () => {
    await msg(ACTIONS.SET_GLOBAL_TIER, { tier: 'balanced' });
    const p = await settingsPage('protection');
    const btn = () => p.locator('#tierFacts .fact-btn', { hasText: /^(shown|hidden)$/ }).nth(1);
    assert.equal(await btn().textContent(), 'shown');
    assert.match(await btn().getAttribute('aria-label'), /^annoyances: shown\. Change to hidden$/);
    await btn().click();
    await p.waitForFunction(() => [...document.querySelectorAll('#tierFacts dt')].find((d) => d.textContent === 'annoyances').nextElementSibling.textContent === 'hidden');
    let st = await ext.evaluate(() => chrome.storage.local.get(['globalDefaultTier', 'globalCustomConfig']));
    assert.equal(st.globalDefaultTier, 'custom');
    assert.equal(st.globalCustomConfig.aggressiveFiltering, true);
    assert.equal(st.globalCustomConfig.adBlockNetwork, true, 'starts from what balanced had on');
    // Keyboard: Tab reaches it, Enter switches it back.
    await p.locator('#tierFacts dt', { hasText: 'annoyances' }).locator('xpath=..').locator('button').focus();
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('#tierFacts dt')].find((d) => d.textContent === 'annoyances').nextElementSibling.textContent === 'shown');
    st = await ext.evaluate(() => chrome.storage.local.get('globalCustomConfig'));
    assert.equal(st.globalCustomConfig.aggressiveFiltering, false);
    // Three-way values go round: my choices, reject all, left alone.
    const cookie = p.locator('#tierFacts dt', { hasText: 'cookie popups' }).locator('xpath=..').locator('button');
    assert.equal(await cookie.textContent(), 'your choices');
    await cookie.click();
    await p.waitForFunction(() => [...document.querySelectorAll('#tierFacts dt')].find((d) => d.textContent === 'cookie popups').nextElementSibling.textContent === 'reject all');
    await msg(ACTIONS.SET_GLOBAL_TIER, { tier: 'balanced' });
    await p.close();
  });

  await check('long descriptions: a short line, the rest behind "i" by hover, focus, click and Escape, described for screen readers', async () => {
    const p = await settingsPage('ai');
    const tip = p.locator('#aiMasterDescription .has-tip');
    const btn = tip.locator('.tip-btn');
    const panel = tip.locator('.tip-panel');
    assert.equal(await panel.isVisible(), false);
    assert.match(await btn.getAttribute('aria-label'), /^More about /);
    const described = await btn.evaluate((b) => document.getElementById(b.getAttribute('aria-describedby')).textContent);
    assert.match(described, /Nothing is sent to any server/);
    await btn.hover();
    assert.equal(await panel.isVisible(), true, 'hover');
    await p.mouse.move(0, 0);
    assert.equal(await panel.isVisible(), false);
    await btn.focus();
    await p.keyboard.press('Tab');
    await p.keyboard.press('Shift+Tab');
    assert.equal(await panel.isVisible(), true, 'keyboard focus');
    await p.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false, 'Escape hides it');
    await btn.click();
    await p.mouse.move(0, 0);
    assert.equal(await btn.getAttribute('aria-expanded'), 'true');
    assert.equal(await panel.isVisible(), true, 'a click or tap keeps it open');
    await p.locator('h1:visible, h2:visible').first().click();
    assert.equal(await panel.isVisible(), false, 'a click elsewhere closes it');
    await p.goto(`chrome-extension://${extId}/options.html#protection`);
    await p.waitForSelector('#operatingDescription .tip-btn');
    assert.ok(await p.locator('#pageFixesDescription .tip-btn').count() === 1 && await p.locator('#operatingDescription .tip-btn').count() === 1);
    await p.close();
  });

  await check('every AI feature carries a quiet "experimental" label; settings and welcome link to the repository', async () => {
    const p = await settingsPage('ai');
    const tags = await p.evaluate(() => [...document.querySelectorAll('.exp-tag')].map((t) => t.closest('h1, h2').textContent.replace('experimental', '').trim()));
    for (const want of ['on-device AI', 'page fixes', 'use Chrome\'s on-device AI']) assert.ok(tags.includes(want), want);
    // The AI features sit on the AI page, under its label.
    const onAiPage = await p.evaluate(() => ['aiMasterToggle', 'aiKeepToggle', 'aiStartToggle', 'aiToggle', 'pageEditsToggle'].every((id) => !!document.querySelector('#ai #' + id)));
    assert.equal(onAiPage, true);
    await p.goto(`chrome-extension://${extId}/options.html#data`);
    await p.waitForSelector('#aboutPanel a');
    assert.equal(await p.locator('#aboutPanel a').getAttribute('href'), 'https://github.com/notfsx/rockyweb');
    assert.equal(await p.locator('#welcome a[href="https://github.com/notfsx/rockyweb"]').count(), 1);
    await p.close();
  });

  await check('placeholder hints get shorter after a use, then go', async () => {
    const p = await settingsPage('websites');
    const ph = () => p.locator('#addSiteInput').getAttribute('placeholder');
    await p.waitForFunction(() => document.getElementById('addSiteInput').placeholder.includes('e.g.'));
    for (const [site, want] of [['hint-one.test', 'add a website'], ['hint-two.test', '']]) {
      await p.fill('#addSiteInput', site);
      await p.locator('#addSiteForm button[type=submit]').click();
      await poll(async () => (await ph()) === want);
      assert.equal(await ph(), want);
    }
    for (const s of ['hint-one.test', 'hint-two.test']) await msg(ACTIONS.DELETE_SITE_PROFILE, { siteKey: s });
    await p.close();
  });

  // ---- Chrome sync (opt-in). Without a signed-in profile chrome.storage.sync keeps a local copy,
  // which is enough to check what is written and how changes from "another device" merge.
  const syncItems = () => ext.evaluate(() => chrome.storage.sync.get(null));
  // The sync code lives in the service worker only; a message first wakes it if Chrome stopped it.
  const inWorker = async (fn, arg) => { await msg(ACTIONS.GET_SYNC_STATUS, {}); return context.serviceWorkers().slice(-1)[0].evaluate(fn, arg); };
  const decodeSynced = (items) => inWorker((it) => globalThis.RockyShared.decodeSync(it), items);

  await check('sync is off by default and writes nothing to Chrome sync', async () => {
    const st = await msg(ACTIONS.GET_SYNC_STATUS, {});
    assert.equal(st.sync.enabled, false);
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'sync-before.test', tier: 'strict' });
    await sleep(6000);
    assert.deepEqual(Object.keys(await syncItems()).filter((k) => k.startsWith('rw:')), []);
  });

  await check('sync on: settings, sites and page changes go to Chrome sync; trackers, stats and Incognito sites never do', async () => {
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'incognito-only.test', tier: 'off', private: true });
    const p = await settingsPage('data');
    await p.locator('#syncToggle .switch').click();
    await p.waitForFunction(() => /^On\. Synced/.test(document.getElementById('syncStatus').textContent));
    assert.match(await p.locator('#syncStatus').textContent(), /1 website changed in Incognito stays on this device/);
    const items = await syncItems();
    for (const [k, v] of Object.entries(items)) assert.ok(k.length + JSON.stringify(v).length <= 8192, `${k} under 8 KB`);
    const text = JSON.stringify(items);
    const d = await decodeSynced(items);
    assert.equal(d.view.sites['sync-before.test'].tier, 'strict', 'existing sites are uploaded on the first merge');
    assert.ok(!d.view.sites['incognito-only.test'], 'an Incognito site is not synced');
    const local = await ext.evaluate(() => chrome.storage.local.get(['learnedTrackers', 'stats']));
    for (const tracker of Object.keys(local.learnedTrackers)) assert.ok(!text.includes(`"${tracker}"`), `tracker ${tracker} not synced`);
    for (const w of ['learnedTrackers', 'totalAdsBlocked', 'operatingMode', 'autoOptimise']) assert.ok(!text.includes(w), w);
    // A local change is uploaded a few seconds later.
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'sync-later.test', tier: 'consent_only' });
    const later = await poll(async () => { const x = await decodeSynced(await syncItems()); return x && x.view && x.view.sites['sync-later.test'] ? x : null; }, 12000);
    assert.ok(later, 'uploaded after a change');
    await p.close();
  });

  await check('sync: a change from another device is merged in, and a deletion there reaches here', async () => {
    const items = await syncItems();
    const d = await decodeSynced(items);
    const view = JSON.parse(JSON.stringify(d.view));
    view.sites['other-device.test'] = Object.assign({}, view.sites['sync-before.test'], { tier: 'consent_only', updatedAt: Date.now() });
    delete view.sites['sync-later.test'];
    view.prefs.globalDefaultTier = 'strict';
    const enc = await inWorker((v) => globalThis.RockyShared.encodeSync(v, { device: 'other-device', at: Date.now(), prefsAt: Date.now() + 1000 }).items, view);
    await ext.evaluate((it) => chrome.storage.sync.set(it), enc);
    const got = await poll(async () => {
      const s = await ext.evaluate(() => chrome.storage.local.get(['siteProfiles', 'globalDefaultTier']));
      return s.siteProfiles['other-device.test'] && !s.siteProfiles['sync-later.test'] ? s : null;
    }, 12000);
    assert.ok(got, 'merged from sync');
    assert.equal(got.siteProfiles['other-device.test'].tier, 'consent_only');
    assert.equal(got.globalDefaultTier, 'strict', 'the newer general setting wins');
    assert.equal(got.siteProfiles['incognito-only.test'].tier, 'off', 'the Incognito site here is untouched');
    await msg(ACTIONS.SET_GLOBAL_TIER, { tier: 'balanced' });
  });

  await check('sync: turning it off stops uploads; "remove the synced copy" clears Rockyweb\'s items only', async () => {
    await ext.evaluate(() => chrome.storage.sync.set({ 'someone-else': 1 }));
    await msg(ACTIONS.SET_SYNC, { enabled: false });
    const before = JSON.stringify(await syncItems());
    await msg(ACTIONS.SET_SITE_TIER, { siteKey: 'after-off.test', tier: 'strict' });
    await sleep(6500);
    assert.equal(JSON.stringify(await syncItems()), before, 'nothing written while off');
    await msg(ACTIONS.CLEAR_SYNC_COPY, {});
    assert.deepEqual(Object.keys(await syncItems()), ['someone-else']);
    await ext.evaluate(() => chrome.storage.sync.remove('someone-else'));
    for (const s of ['sync-before.test', 'sync-later.test', 'other-device.test', 'incognito-only.test', 'after-off.test']) await msg(ACTIONS.DELETE_SITE_PROFILE, { siteKey: s });
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
