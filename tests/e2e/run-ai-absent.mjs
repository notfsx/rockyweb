#!/usr/bin/env node
// A browser with no built-in AI at all (no LanguageModel anywhere, as in Chrome 116). Nothing is faked:
// run it with ROCKYWEB_CHROME pointing at an older Chrome, e.g. Chrome for Testing 116.
// Checks: the worker and pages see no model, settings explain it, AI stays off even if the stored
// preference says on, and pages with overlays or unknown cookie banners are left alone without errors.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const CHROME = process.env.ROCKYWEB_CHROME;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); } catch (e) { results.push(false); console.log(`  ✗ ${name}\n      ${String(e && e.message).split('\n').join('\n      ')}`); }
}

const doc = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
const ARTICLE = '<article><h1>Spaniel catches ball</h1>' + '<p>Witnesses described the moment as graceful.</p>'.repeat(12) + '</article>';
const later = (html) => `<script>window.__clicks = []; setTimeout(function () { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); }, 400);</script>`;
const ROUTES = {
  '/article/newsletter': doc(ARTICLE + later('<div class="newsletter-popup" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;background:#fff;z-index:9"><h2>Join our newsletter</h2><input type="email"><button>Subscribe</button></div>')),
  '/consent/unknown': doc('<main><p>article</p></main>' + later(`<div class="site-cookie-notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;z-index:9"><h3>Your privacy</h3><p>We use cookies to analyse traffic.</p>
    <button onclick="window.__clicks.push('accept')">Agree and proceed</button><button onclick="window.__clicks.push('refuse')">Continue without agreeing to cookies</button></div>`))
};
const server = http.createServer((req, res) => {
  const body = ROUTES[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-ai-absent-'));
const context = await chromium.launchPersistentContext(dir, {
  headless: !CHROME, executablePath: CHROME || undefined, channel: CHROME ? undefined : 'chromium',
  ignoreDefaultArgs: CHROME ? ['--headless'] : undefined,
  args: [...(CHROME ? ['--headless=new'] : []), `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP * 127.0.0.1']
});
let code = 0;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const A = await ext.evaluate(() => window.RockyShared.ACTIONS);
  const msg = (a, p) => ext.evaluate(([x, y]) => chrome.runtime.sendMessage({ action: x, payload: y }), [a, p]);
  const errors = [];
  context.on('weberror', (e) => { if (String(e.error().stack || '').includes('chrome-extension://')) errors.push(String(e.error().message)); });
  console.log(`browser ${context.browser() ? context.browser().version() : (await ext.evaluate(() => navigator.userAgent)).match(/Chrome\/[\d.]+/)[0]}, extension ${extId}`);

  await check('no LanguageModel in the worker or in pages', async () => {
    assert.equal(await sw.evaluate(() => typeof self.LanguageModel), 'undefined');
    assert.equal(await ext.evaluate(() => typeof window.LanguageModel), 'undefined');
  });

  await check('AI status says absent; nothing created, no consent brokers', async () => {
    const st = await msg(A.GET_AI_STATUS, {});
    assert.equal(st.availability, 'absent'); // the API does not exist, as opposed to a device that cannot run it
    assert.equal(st.hasSession, false);
    assert.deepEqual(st.consent.languages, []);
  });

  await check('settings: the on-device AI switch is greyed out with an explanation', async () => {
    await ext.reload();
    await sleep(800);
    const ui = await ext.evaluate(() => ({ disabled: document.querySelector('#aiMasterToggle .switch').disabled, status: document.getElementById('aiMasterStatus').textContent }));
    assert.equal(ui.disabled, true);
    assert.match(ui.status, /unavailable in this browser or on this computer/);
  });

  // Even if a synced or imported preference says on, nothing AI runs.
  await msg(A.SET_OPERATING_MODE, { mode: 'full' });
  await msg(A.SET_AI_ENABLED, { enabled: true });
  await msg(A.SET_AI_AUTO_OPTIMISE, { enabled: true });
  const web = await context.newPage();

  await check('article overlay left alone, no AI attempt, no errors', async () => {
    await web.goto(`http://news.test:${PORT}/article/newsletter`);
    await sleep(5000);
    assert.notEqual(await web.evaluate(() => getComputedStyle(document.querySelector('.newsletter-popup')).display), 'none');
    const st = await msg(A.GET_AI_STATUS, {});
    assert.equal(st.stats.requests || 0, 0);
  });

  await check('unknown cookie banner left alone (no model), never accepted, no errors', async () => {
    await web.goto(`http://cookies.test:${PORT}/consent/unknown`);
    await sleep(7000);
    assert.deepEqual(await web.evaluate(() => window.__clicks), []);
    const st = await msg(A.GET_AI_STATUS, {});
    assert.equal(st.consent.attempts, 0);
    assert.deepEqual(errors, []);
  });
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await context.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} AI-absent checks passed`);
process.exit(failed || code ? 1 : 0);
