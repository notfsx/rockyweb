#!/usr/bin/env node
// Browser tests for automatic optimisation, Light mode and the consent trust fixes.
// Chrome's LanguageModel is replaced by a deterministic double inside the test browser only;
// the shipped extension code is unchanged. Set E2E_SCREENSHOTS=<dir> to save UI screenshots.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

// ---- fixtures

const doc = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body style="font-family:sans-serif;margin:0">${body}</body></html>`;
const ARTICLE = '<article style="max-width:640px;margin:40px auto"><h1>Spaniel catches ball</h1>' + '<p>Witnesses described the moment as graceful. The ball was returned, slightly damp.</p>'.repeat(12) + '</article>';
const OVERLAY = (extra = '') => `<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;border:1px solid #ccc;z-index:9">
  <h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p>${extra}
  <input type="email" name="email" placeholder="Email address"><button>Subscribe</button><button aria-label="Close">×</button></div>`;
const append = (html, ms) => `<script>setTimeout(function () { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); document.documentElement.style.overflow = 'hidden'; }, ${ms});</script>`;
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');

function route(p) {
  if (p === '/plain') return doc('plain', ARTICLE.replace('<article', '<main').replace('</article>', '</main>'));
  if (p === '/shop/home') return doc('shop', '<main><h1>Autumn collection</h1><p>Wax jackets and wellies.</p></main>' + append(OVERLAY('<p>Get 10% off: subscribe</p>'), 600));
  if (p.startsWith('/article/newsletter') || p.startsWith('/article/slow')) return doc('article', ARTICLE + append(OVERLAY(), 600));
  if (p === '/article/deliberate') {
    return doc('article', ARTICLE + `<button id="open" style="position:fixed;top:10px;right:10px">Subscribe to the newsletter</button>
      <script>document.getElementById('open').addEventListener('click', function () { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(OVERLAY())}); });</script>`);
  }
  if (p === '/account/login') {
    return doc('sign in', '<main><h1>Your account</h1></main>' + append(OVERLAY('<h3>Sign in</h3><input type="password" name="password">'), 600));
  }
  if (p === '/checkout/') return doc('checkout', '<main><h1>Basket</h1></main>' + append(OVERLAY('<p>Subscribe for 10% off your order</p>'), 600));
  if (p === '/learn') return doc('learn', '<img src="/pixel.gif" alt="">'.replace('/pixel.gif', `http://tracker.test:${PORT}/pixel.gif`));
  if (p === '/ads') return doc('ads', `<script src="http://securepubads.g.doubleclick.net:${PORT}/ad.js"></script><p>ads</p>`);
  if (p === '/consent/decided') {
    return doc('decided', `<p>article</p><a href="#" id="prefs">Cookie settings</a>
      <div id="onetrust-consent-sdk"><div id="onetrust-pc-sdk" style="display:none;position:fixed;inset:20%;background:#eee">
        <p>Your cookie preferences</p><button id="onetrust-reject-all-handler" onclick="window.__rejected=true">Reject All</button></div></div>
      <script>
        window.OneTrust = { IsAlertBoxClosed: function () { return true; }, RejectAll: function () { window.__apiRejected = true; }, AllowAll: function () {} };
        document.getElementById('prefs').addEventListener('click', function (e) { e.preventDefault(); document.getElementById('onetrust-pc-sdk').style.display = 'block'; });
      </script>`);
  }
  if (p === '/consent/complianz-partial') {
    return doc('complianz', `<p>article</p>
      <div class="cmplz-cookiebanner" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#eee">
        <p>We use cookies to improve this site.</p>
        <button class="cmplz-btn cmplz-deny" onclick="window.__denied=true">Deny</button>
        <button class="cmplz-btn cmplz-accept" onclick="window.__accepted=true">Accept</button>
        <button class="cmplz-btn cmplz-view-preferences" onclick="document.getElementById('cats').style.display='block'">View preferences</button>
        <div id="cats" style="display:none">
          <label><input type="checkbox" id="f"> Functional</label>
          <label><input type="checkbox" id="s" checked> Statistics</label>
          <label><input type="checkbox" id="m"> Marketing</label>
          <button class="cmplz-btn cmplz-save-preferences" onclick="window.__saved={functional:f.checked,analytics:s.checked,marketing:m.checked};this.closest('.cmplz-cookiebanner').remove()">Save preferences</button>
        </div></div>
      <script>window.__setCalls=[]; window.cmplz_set_category = function (c) { window.__setCalls.push(c); };</script>`);
  }
  if (p === '/consent/granular') {
    return doc('granular', `<p>article</p>
      <div class="site-privacy" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;z-index:9">
        We use cookies to personalise content and analyse traffic.
        <button onclick="window.__choice='reject';this.parentNode.remove()">Reject all</button>
        <button onclick="window.__choice='accept';this.parentNode.remove()">Accept all</button>
        <button onclick="document.getElementById('panel').hidden=false">Manage preferences</button>
      </div>
      <div id="panel" role="dialog" aria-modal="true" hidden style="position:fixed;inset:15%;background:#fff;padding:20px;z-index:10">
        <h2>Cookie preferences</h2>
        <label><input type="checkbox" id="fn"> Functional cookies</label><br>
        <label><input type="checkbox" id="an" checked> Analytics cookies</label><br>
        <label><input type="checkbox" id="mk"> Marketing cookies</label><br>
        <button onclick="window.__saved={functional:fn.checked,analytics:an.checked,marketing:mk.checked};window.__choice='saved';document.getElementById('panel').remove();document.querySelector('.site-privacy').remove()">Save preferences</button>
      </div>`);
  }
  if (p === '/consent/late-generic') {
    return doc('late', `<p>article</p>` + append(`<div class="late-notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;z-index:9">We use cookies. <button onclick="window.__late='reject';this.parentNode.remove()">Reject all</button><button onclick="window.__late='accept';this.parentNode.remove()">Accept all</button></div>`, 4500));
  }
  if (p === '/consent/onetrust') {
    return doc('ot', `<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#eee">
      We use cookies. <button id="onetrust-accept-btn-handler">Accept All</button>
      <button id="onetrust-reject-all-handler" onclick="window.__ot='dom-reject';document.getElementById('onetrust-banner-sdk').style.display='none'">Reject All</button></div></div>
      <script>setTimeout(function () { window.OneTrust = { IsAlertBoxClosed: function () { return false; }, RejectAll: function () { window.__ot = 'api-reject'; document.getElementById('onetrust-banner-sdk').style.display = 'none'; }, AllowAll: function () {}, UpdateConsent: function () {}, GetDomainData: function () { return { Groups: [] }; } }; }, 300);</script>`);
  }
  return null;
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/pixel.gif') { res.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': 'uid=a8F3kL9qZx72Pp1w; Path=/; Max-Age=86400' }); res.end(GIF); return; }
  if (p === '/ad.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('window.adLoaded = true;'); return; }
  const body = route(p);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const at = (host, p) => `http://${host}:${PORT}${p}`;

// ---- harness

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
    try { last = await fn(); if (last) return last; } catch (e) { last = null; }
    await sleep(interval);
  }
  return last;
}

// Deterministic model double installed where the extension looks for LanguageModel.
function installModelDouble(cfg) {
  const F = (self.__fakeLM = { calls: 0, created: 0, destroyed: 0, prompts: [], mode: cfg.mode, delay: cfg.delay || 10, availability: cfg.availability || 'available' });
  const answer = (text) => {
    const id = (/"candidate":"(c\d+)"/.exec(text) || [])[1] || 'c0';
    if (F.mode === 'invalid') return JSON.stringify({ candidate: id, action: 'hide_overlay', confidence: 'high', selector: 'body' });
    if (F.mode === 'leave') return JSON.stringify({ candidate: id, action: 'leave_unchanged', confidence: 'high' });
    const article = /"page":"article"/.test(text);
    return JSON.stringify({ candidate: id, action: article ? 'hide_overlay' : 'leave_unchanged', confidence: 'high' });
  };
  const session = () => ({
    async clone() { return session(); },
    destroy() { F.destroyed++; },
    prompt(text, opts) {
      F.calls++;
      F.prompts.push(text);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(answer(text)), F.delay);
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    }
  });
  Object.defineProperty(self, 'LanguageModel', {
    configurable: true,
    writable: true,
    value: { async availability() { return F.availability; }, async create() { F.created++; return session(); } }
  });
  return true;
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-ai-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server'],
  viewport: { width: 1280, height: 800 }
});

let exitCode = 0;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  // The newest worker instance: Chrome may restart the service worker between tests.
  const getSw = async () => {
    const live = context.serviceWorkers().filter((w) => w.url().startsWith(`chrome-extension://${extId}/`));
    return live.length ? live[live.length - 1] : context.waitForEvent('serviceworker');
  };
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const ACTIONS = await ext.evaluate(() => window.RockyShared.ACTIONS);
  // Keep the worker awake so the injected model double is not lost to an idle restart.
  await ext.evaluate((a) => { setInterval(() => chrome.runtime.sendMessage({ action: a, payload: {} }), 8000); }, ACTIONS.GET_AI_STATUS);
  const msg = (action, payload) => ext.evaluate(([a, p]) => chrome.runtime.sendMessage({ action: a, payload: p }), [action, payload]);
  const model = async (cfg) => {
    sw = await getSw();
    await sw.evaluate(installModelDouble, cfg);
    await sw.evaluate(() => broker.release()); // a session from the previous double must not be reused
    assert.equal(await sw.evaluate(() => !!self.__fakeLM && typeof self.LanguageModel.create === 'function'), true, 'model double installed');
  };
  const modelStats = async () => (await getSw()).evaluate(() => Object.assign({}, self.__fakeLM, { prompts: self.__fakeLM.prompts.length }));
  const web = await context.newPage();
  const tabIdOf = (prefix) => ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), prefix);
  const shown = (sel) => web.evaluate((q) => { const el = document.querySelector(q); return !!el && getComputedStyle(el).display !== 'none'; }, sel);
  // 'absent' until the page adds the overlay, so a test never mistakes "not there yet" for "hidden".
  const overlayState = (sel) => web.evaluate((q) => { const el = document.querySelector(q); return !el ? 'absent' : getComputedStyle(el).display === 'none' ? 'hidden' : 'shown'; }, sel);
  const becomesHidden = (sel, ms) => poll(async () => (await overlayState(sel)) === 'hidden', ms || 10000);
  const visit = async (url) => { await web.bringToFront(); await web.goto(url); await web.waitForLoadState('load'); };

  console.log(`extension ${extId}, fixtures on :${PORT}`);

  // ---- settings: availability states

  async function optionsWith(state, extraInit) {
    const p = await context.newPage();
    await p.addInitScript(([st, extra]) => {
      if (st === 'absent') { Object.defineProperty(window, 'LanguageModel', { configurable: true, writable: true, value: undefined }); return; }
      window.__created = 0;
      window.__availabilityCalls = 0;
      Object.defineProperty(window, 'LanguageModel', {
        configurable: true,
        writable: true,
        value: {
          async availability() { window.__availabilityCalls++; return window.__forceAvailability || st; },
          create(opts) {
            window.__created++;
            return new Promise((resolve, reject) => {
              const target = new EventTarget();
              if (opts.monitor) opts.monitor(target);
              let step = 0;
              const timer = setInterval(() => {
                step++;
                const e = new Event('downloadprogress');
                e.loaded = Math.min(1, step / 5);
                e.total = 1;
                target.dispatchEvent(e);
                if (step >= 5 && extra !== 'hang') { clearInterval(timer); window.__forceAvailability = 'available'; resolve({ destroy() { window.__destroyed = true; } }); }
              }, 250);
              if (opts.signal) opts.signal.addEventListener('abort', () => { clearInterval(timer); reject(new DOMException('aborted', 'AbortError')); });
            });
          }
        }
      });
    }, [state, extraInit || null]);
    await p.goto(`chrome-extension://${extId}/options.html#protection`);
    await sleep(700);
    return p;
  }
  const aiUi = (p) => p.evaluate(() => ({
    disabled: document.querySelector('#aiToggle .switch').disabled,
    checked: document.querySelector('#aiToggle .switch').getAttribute('aria-checked') === 'true',
    status: document.getElementById('aiStatus').textContent,
    setup: document.getElementById('aiSetup').hidden ? '' : document.getElementById('aiSetup').textContent,
    created: window.__created || 0
  }));

  await check('settings: absent LanguageModel greys out the AI toggle with an explanation', async () => {
    const p = await optionsWith('absent');
    const ui = await aiUi(p);
    assert.equal(ui.disabled, true);
    assert.match(ui.status, /unavailable in this browser or on this device/);
    await p.close();
  });

  await check('settings: an unavailable device greys out the toggle', async () => {
    const p = await optionsWith('unavailable');
    const ui = await aiUi(p);
    assert.equal(ui.disabled, true);
    assert.match(ui.status, /unavailable in this browser or on this device/);
    assert.equal(ui.created, 0);
    await p.close();
  });

  await check('settings: a downloadable model explains the download and never starts it on open', async () => {
    const p = await optionsWith('downloadable');
    let ui = await aiUi(p);
    assert.equal(ui.disabled, false);
    assert.match(ui.status, /needs to download its on-device model/);
    assert.equal(ui.created, 0, 'opening settings must not create a session');
    await p.click('#aiToggle .switch');
    ui = await aiUi(p);
    assert.match(ui.setup, /large download/);
    assert.equal(ui.created, 0, 'turning on only shows the explanation');
    await p.close();
  });

  await check('settings: download in progress shows status, blocks duplicate setup, then turns on', async () => {
    const p = await optionsWith('downloadable');
    await p.click('#aiToggle .switch');
    await p.click('text=download and turn on');
    await sleep(400);
    let ui = await aiUi(p);
    assert.equal(ui.disabled, true);
    assert.match(ui.status, /downloading the on-device model/);
    assert.ok(!/download and turn on/.test(ui.setup), 'no second download button while downloading');
    const other = await optionsWith('downloading');
    const ui2 = await aiUi(other);
    assert.equal(ui2.disabled, true);
    assert.match(ui2.status, /downloading/);
    await other.close();
    ui = await poll(async () => { const u = await aiUi(p); return /On\./.test(u.status) ? u : null; }, 6000);
    assert.ok(ui, 'ready after the download');
    assert.equal(ui.created, 1);
    assert.equal(await p.evaluate(() => window.__destroyed === true), true, 'setup session released');
    const st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.equal(st.state.aiSettings.autoOptimise, true);
    await p.close();
  });

  await check('settings: cancelling the download leaves AI off', async () => {
    await msg(ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: false });
    const p = await optionsWith('downloadable', 'hang');
    await p.click('#aiToggle .switch');
    await p.click('text=download and turn on');
    await sleep(500);
    await p.click('text=cancel download');
    const ui = await poll(async () => { const u = await aiUi(p); return /cancelled/.test(u.status) ? u : null; }, 4000);
    assert.ok(ui);
    assert.equal((await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.aiSettings.autoOptimise, false);
    await p.close();
  });

  await check('settings: a ready model enables the toggle; Light mode pauses it and keeps the choice', async () => {
    const p = await optionsWith('available');
    let ui = await aiUi(p);
    assert.equal(ui.disabled, false);
    await p.click('#aiToggle .switch');
    await poll(async () => (await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.aiSettings.autoOptimise === true);
    assert.equal(ui.created, 0, 'a ready model needs no setup session');
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'light' });
    await p.reload();
    await sleep(700);
    ui = await aiUi(p);
    assert.equal(ui.disabled, true);
    assert.equal(ui.checked, true, 'saved preference still shown');
    assert.match(ui.status, /AI is paused in Light mode/);
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'full' });
    assert.equal((await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.aiSettings.autoOptimise, true);
    await p.close();
  });

  // ---- automatic optimisation with the model double in the service worker

  await msg(ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: true });

  await check('article overlay: hidden automatically, one model call, listed in the toolbar', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('news.test', '/article/newsletter'));
    assert.equal(await becomesHidden('.newsletter-popup'), true, 'overlay hidden');
    assert.equal(await web.evaluate(() => getComputedStyle(document.documentElement).overflowY !== 'hidden'), true, 'scrolling restored');
    const st = await modelStats();
    assert.equal(st.calls, 1);
    assert.ok(!/http|\?|password/.test((await (await getSw()).evaluate(() => self.__fakeLM.prompts[0]))), 'no URLs or form data in the prompt');
    const popup = await msg(ACTIONS.GET_POPUP_STATE, { tabId: await tabIdOf(at('news.test', '/')) });
    assert.equal(popup.adjustments.length, 1);
    assert.equal(popup.adjustments[0].source, 'model');
    assert.equal(await web.evaluate(() => !!document.querySelector('rockyweb-toast')), false, 'no on-page notification');
  });

  await check('same site, next article: remembered decision, no new model call', async () => {
    const before = (await modelStats()).calls;
    await visit(at('news.test', '/article/newsletter-two'));
    assert.equal(await becomesHidden('.newsletter-popup'), true);
    assert.equal((await modelStats()).calls, before);
  });

  await check('deliberately opened sign-up form is left alone with no model call', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('blog.test', '/article/deliberate'));
    await sleep(3000);
    await web.click('#open');
    await sleep(3500);
    assert.equal(await shown('.newsletter-popup'), true);
    assert.equal((await modelStats()).calls, 0);
  });

  await check('login dialogue and checkout overlay that look similar are left alone, no model call', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('shop.test', '/account/login'));
    await sleep(4000);
    assert.equal(await shown('.newsletter-popup'), true, 'login dialogue kept');
    await visit(at('shop.test', '/checkout/'));
    await sleep(4000);
    assert.equal(await shown('.newsletter-popup'), true, 'checkout overlay kept');
    assert.equal((await modelStats()).calls, 0);
  });

  await check('ordinary page with no candidate: zero model calls', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('quiet.test', '/plain'));
    await sleep(4000);
    assert.equal((await modelStats()).calls, 0);
    assert.equal((await modelStats()).created, 0);
  });

  await check('sign-up overlay on a page that is not an article: left alone, no model call', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('store.test', '/shop/home'));
    await sleep(4000);
    assert.equal(await shown('.newsletter-popup'), true);
    assert.equal((await modelStats()).calls, 0);
  });

  await check('invalid model output is discarded', async () => {
    await model({ mode: 'invalid' });
    await visit(at('odd.test', '/article/newsletter'));
    await sleep(5000);
    assert.equal((await modelStats()).calls, 1);
    assert.equal(await shown('.newsletter-popup'), true);
  });

  await check('undo restores the overlay and is honoured on the next visit', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('undo.test', '/article/newsletter'));
    assert.equal(await becomesHidden('.newsletter-popup'), true);
    const tabId = await tabIdOf(at('undo.test', '/'));
    const popup = await msg(ACTIONS.GET_POPUP_STATE, { tabId });
    await msg(ACTIONS.AI_UNDO_ADJUSTMENT, { tabId, id: popup.adjustments[0].id });
    assert.equal(await poll(() => shown('.newsletter-popup'), 3000), true, 'shown again');
    const calls = (await modelStats()).calls;
    await visit(at('undo.test', '/article/newsletter-again'));
    await sleep(4500);
    assert.equal(await shown('.newsletter-popup'), true, 'not hidden again after undo');
    assert.equal((await modelStats()).calls, calls, 'no new model call');
  });

  await check('"Don\'t do this on this site" reverts and sets newsletter prompts to leave alone', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('optout.test', '/article/newsletter'));
    assert.equal(await becomesHidden('.newsletter-popup'), true);
    await msg(ACTIONS.AI_SITE_OPT_OUT, { tabId: await tabIdOf(at('optout.test', '/')) });
    assert.equal(await poll(() => shown('.newsletter-popup'), 3000), true);
    const st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.equal(st.state.siteProfiles['optout.test'].newsletterPrompts, 'keep');
    await visit(at('optout.test', '/article/newsletter-again'));
    await sleep(4000);
    assert.equal(await shown('.newsletter-popup'), true);
  });

  await check('explicit choices win: "hide" works without AI, "leave alone" stops AI', async () => {
    await msg(ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: false });
    await model({ mode: 'article-hide' });
    await msg(ACTIONS.SET_SITE_NEWSLETTER, { siteKey: 'manual.test', value: 'hide' });
    await visit(at('manual.test', '/article/newsletter'));
    assert.equal(await becomesHidden('.newsletter-popup'), true);
    assert.equal((await modelStats()).calls, 0, 'your choice needs no model');
    await msg(ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: true });
    await msg(ACTIONS.SET_SITE_NEWSLETTER, { siteKey: 'kept.test', value: 'keep' });
    await visit(at('kept.test', '/article/newsletter'));
    await sleep(4000);
    assert.equal(await shown('.newsletter-popup'), true);
    assert.equal((await modelStats()).calls, 0);
  });

  await check('navigating away while inference is pending cancels it', async () => {
    await model({ mode: 'article-hide', delay: 6000 });
    await visit(at('pending.test', '/article/slow'));
    await poll(async () => (await modelStats()).calls === 1, 8000);
    await visit(at('pending.test', '/plain'));
    await sleep(1500);
    const status = await msg(ACTIONS.GET_AI_STATUS, {});
    assert.ok(status.stats.cancelled >= 1, `cancelled ${status.stats.cancelled}`);
    const popup = await msg(ACTIONS.GET_POPUP_STATE, { tabId: await tabIdOf(at('pending.test', '/')) });
    assert.equal(popup.adjustments.length, 0);
  });

  // ---- Light mode

  await check('Light: AI and tracker learning pause, blocking and explicit choices stay', async () => {
    await model({ mode: 'article-hide' });
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'light' });
    await visit(at('lightnews.test', '/article/newsletter'));
    await sleep(4500);
    assert.equal(await shown('.newsletter-popup'), true, 'no automatic adjustment in Light');
    assert.equal((await modelStats()).calls, 0);
    await visit(at('lightads.test', '/ads'));
    assert.equal(await web.evaluate(() => window.adLoaded), undefined, 'declarative blocking still on');
    for (const site of ['l1.test', 'l2.test', 'l3.test']) await visit(at(site, '/learn'));
    await sleep(1500);
    const st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.equal(st.state.learnedTrackers['tracker.test'], undefined, 'no learning in Light');
    assert.equal(st.state.aiSettings.autoOptimise, true, 'AI preference kept');
  });

  await check('Light: recognised consent platform still answered, unknown banners left alone', async () => {
    await visit(at('lightcmp.test', '/consent/onetrust'));
    assert.ok(await poll(() => web.evaluate(() => window.__ot), 8000), 'OneTrust answered');
    await visit(at('lightgen.test', '/consent/granular'));
    await sleep(4000);
    assert.equal(await web.evaluate(() => window.__choice), undefined, 'unknown banner untouched in Light');
  });

  await check('switching Light on stops pending work in open tabs; switching off restores Full', async () => {
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'full' });
    await visit(at('late.test', '/consent/late-generic'));
    await sleep(800);
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'light' });
    await sleep(6000);
    assert.equal(await web.evaluate(() => window.__late), undefined, 'late banner left alone after Light');
    await msg(ACTIONS.SET_OPERATING_MODE, { mode: 'full' });
    await visit(at('late2.test', '/consent/late-generic'));
    assert.equal(await poll(() => web.evaluate(() => window.__late), 10000), 'reject', 'Full handles it again');
    for (const site of ['f1.test', 'f2.test', 'f3.test']) await visit(at(site, '/learn'));
    const learned = await poll(async () => (await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.learnedTrackers['tracker.test'], 6000);
    assert.ok(learned, 'learning back in Full');
  });

  // ---- consent trust fixes

  await check('an existing consent decision is respected when the user reopens preferences', async () => {
    await visit(at('decided.test', '/consent/decided'));
    await sleep(3000);
    await web.click('#prefs');
    await sleep(4000);
    assert.equal(await web.evaluate(() => window.__rejected), undefined, 'Rockyweb did not click Reject');
    assert.equal(await web.evaluate(() => window.__apiRejected), undefined);
  });

  await check('partial Complianz API: no fake API result, button rules apply the real choice', async () => {
    await visit(at('cmplz.test', '/consent/complianz-partial'));
    const saved = await poll(() => web.evaluate(() => window.__saved), 12000);
    assert.deepEqual(saved, { functional: true, analytics: false, marketing: false });
    assert.deepEqual(await web.evaluate(() => window.__setCalls), []);
    const popup = await msg(ACTIONS.GET_POPUP_STATE, { tabId: await tabIdOf(at('cmplz.test', '/')) });
    assert.equal(popup.tabStats.popup.method, 'dom');
    assert.equal(popup.tabStats.popup.decision, 'custom');
  });

  await check('Balanced keeps functional cookies on a banner with granular controls', async () => {
    await visit(at('granular.test', '/consent/granular'));
    const saved = await poll(() => web.evaluate(() => window.__saved), 12000);
    assert.deepEqual(saved, { functional: true, analytics: false, marketing: false });
  });

  await check('private tabs are never learned from or exported', async () => {
    sw = await getSw();
    await msg(ACTIONS.RESET_LEARNED_TRACKERS, {});
    const patched = await sw.evaluate(() => {
      const orig = chrome.tabs.get.bind(chrome.tabs);
      self.__privateHosts = ['p1.test', 'p2.test', 'p3.test'];
      chrome.tabs.get = (id) => orig(id).then((t) => (self.__privateHosts.some((h) => `${t.url || ''} ${t.pendingUrl || ''}`.includes(h)) ? Object.assign({}, t, { incognito: true }) : t));
      return typeof chrome.tabs.get === 'function';
    });
    assert.ok(patched);
    for (const site of ['p1.test', 'p2.test', 'p3.test']) { await visit(at(site, '/learn')); await sleep(300); }
    await sleep(3500);
    const exported = await msg(ACTIONS.EXPORT_SETTINGS, {});
    const text = JSON.stringify(exported.data);
    assert.ok(!/p[123]\.test/.test(text), 'no private site in the export');
    const session = await sw.evaluate(() => chrome.storage.session.get('tabActivity'));
    assert.ok(!/p[123]\.test/.test(JSON.stringify(session)), 'no private tab in session storage');
    await sw.evaluate(() => { self.__privateHosts = []; });
  });

  await check('reset everything clears tab activity, AI memory and pending work', async () => {
    await model({ mode: 'article-hide' });
    await visit(at('reset.test', '/article/newsletter'));
    await becomesHidden('.newsletter-popup');
    const tabId = await tabIdOf(at('reset.test', '/'));
    await msg(ACTIONS.RESET_ALL, {});
    const popup = await msg(ACTIONS.GET_POPUP_STATE, { tabId });
    assert.equal(popup.trackers.length, 0);
    assert.equal(popup.adjustments.length, 0);
    const st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.deepEqual(st.state.aiMemory, { decisions: {}, undone: {} });
    assert.equal(st.state.aiSettings.autoOptimise, false);
    assert.equal(st.state.globalCustomConfig.showToastBadge, false);
    const session = await (await getSw()).evaluate(() => chrome.storage.session.get(null));
    assert.deepEqual(session, {});
  });

  // ---- describe a change (popup, model double in the page)

  await check('describe a change: preview, confirm, apply, undo; unavailable AI is explained', async () => {
    await visit(at('describe.test', '/plain'));
    const tabId = await tabIdOf(at('describe.test', '/'));
    const pop = await context.newPage();
    await pop.addInitScript(() => {
      Object.defineProperty(window, 'LanguageModel', {
        configurable: true,
        writable: true,
        value: {
          async availability() { return 'available'; },
          async create() {
            return {
              async prompt() { return JSON.stringify({ changes: [{ op: 'newsletter_prompts', value: 'hide' }], unsupported: ['keep my tracker settings exactly'] }); },
              destroy() { window.__planDestroyed = true; }
            };
          }
        }
      });
    });
    await pop.setViewportSize({ width: 340, height: 700 });
    await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}&view=advanced`);
    await sleep(600);
    await pop.click('text=describe a change');
    await pop.fill('.describe-input', 'On this site, hide newsletter prompts but keep my current tracker settings');
    await pop.click('text=preview');
    await pop.waitForSelector('.plan');
    const preview = await pop.textContent('.plan');
    assert.match(preview, /newsletter prompts/);
    assert.match(preview, /hide/);
    assert.match(await pop.textContent('.describe'), /Not supported: keep my tracker settings exactly/);
    let st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.equal(st.state.siteProfiles['describe.test'], undefined, 'nothing applied before confirmation');
    await pop.click('.describe-actions >> text=apply');
    await poll(async () => (await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.siteProfiles['describe.test']);
    st = await msg(ACTIONS.GET_OPTIONS_STATE, {});
    assert.equal(st.state.siteProfiles['describe.test'].newsletterPrompts, 'hide');
    assert.equal(st.state.siteProfiles['describe.test'].tier, null, 'site was not promoted to another mode');
    if (process.env.E2E_SCREENSHOTS) await pop.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, 'popup-describe.png'), fullPage: true });
    await pop.click('.describe-done >> text=undo');
    await poll(async () => !(await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.siteProfiles['describe.test']);
    assert.equal((await msg(ACTIONS.GET_OPTIONS_STATE, {})).state.siteProfiles['describe.test'], undefined);
    await pop.close();

    const none = await context.newPage();
    await none.addInitScript(() => Object.defineProperty(window, 'LanguageModel', { configurable: true, writable: true, value: undefined }));
    await none.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}&view=advanced`);
    await sleep(500);
    await none.click('text=describe a change');
    await sleep(300);
    assert.match(await none.textContent('.describe'), /unavailable in this browser or on this device/);
    assert.equal(await none.evaluate(() => document.querySelector('.describe-input').disabled), true);
    await none.close();
  });

  const shots = process.env.E2E_SCREENSHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await msg(ACTIONS.SET_AI_AUTO_OPTIMISE, { enabled: true });
    await model({ mode: 'article-hide' });
    await visit(at('shots.test', '/article/newsletter'));
    await becomesHidden('.newsletter-popup');
    const tabId = await tabIdOf(at('shots.test', '/'));
    const pop = await context.newPage();
    await pop.setViewportSize({ width: 340, height: 420 });
    await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await sleep(600);
    await pop.click('.adj-toggle');
    await sleep(200);
    await pop.screenshot({ path: path.join(shots, 'popup-adjustments.png'), fullPage: true });
    await pop.close();
    const opt = await optionsWith('available');
    await opt.setViewportSize({ width: 1100, height: 900 });
    await opt.screenshot({ path: path.join(shots, 'options-protection-ai.png'), fullPage: true });
    await opt.close();
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
console.log(`\n${results.length - failed.length}/${results.length} automatic optimisation, Light and consent checks passed`);
process.exit(failed.length || exitCode ? 1 : 0);
