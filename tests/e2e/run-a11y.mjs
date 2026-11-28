#!/usr/bin/env node
// Accessibility: axe-core on every popup state and every settings page, then a keyboard-only pass
// (every control reachable with Tab, named, visible, with a visible focus style, and no trap).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html lang="en"><body><h1>Shop</h1><div class="site-privacy" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff">We use cookies. <button onclick="this.parentNode.remove()">Reject all</button><button>Accept all</button></div></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-a11y-'));
const context = await chromium.launchPersistentContext(work, {
  headless: true,
  ...(process.env.ROCKYWEB_CHROME ? { executablePath: process.env.ROCKYWEB_CHROME, headless: false, ignoreDefaultArgs: ['--headless'] } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP *.test 127.0.0.1', ...(process.env.ROCKYWEB_CHROME ? ['--headless=new'] : [])],
  viewport: { width: 1280, height: 800 }
});

const findings = [];
let problems = 0;

async function audit(p, label) {
  await p.evaluate(AXE);
  const r = await p.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((x) => x.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 12).map((n) => n.target.join(' ') + (v.id === 'color-contrast' && n.any[0] ? ` (${n.any[0].data.fgColor} on ${n.any[0].data.bgColor}, ${n.any[0].data.contrastRatio}:1, needs ${n.any[0].data.expectedContrastRatio})` : ''))
  }))));
  problems += r.length;
  findings.push({ label, axe: r });
  console.log(`${r.length ? '✗' : '✓'} axe: ${label}${r.length ? '' : ' (no violations)'}`);
  for (const v of r) console.log(`    ${v.impact} ${v.id}: ${v.help}\n      ${v.nodes.join('\n      ')}`);
}

// Tab round the page until the cycle closes; report unnamed, invisible or unstyled focus stops,
// and a trap (a cycle that never lets focus leave the page).
async function keyboard(p, label, max = 120) {
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  const stops = [];
  const issues = [];
  let leftPage = false;
  for (let i = 0; i < max; i++) {
    await p.keyboard.press('Tab');
    const s = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const name = (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.title || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')).innerText || '').trim();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      const path = [];
      for (let n = el; n && n !== document.body && path.length < 4; n = n.parentElement) path.unshift(n.id ? `${n.tagName.toLowerCase()}#${n.id}` : n.tagName.toLowerCase() + (n.classList[0] ? `.${n.classList[0]}` : ''));
      return { key: path.join('>') + `@${Math.round(r.left)},${Math.round(r.top + scrollY)}`, path: path.join(' > '), name: name.slice(0, 40), visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', ring };
    });
    if (!s) { leftPage = true; continue; } // past the last control, before wrapping round
    if (stops.some((x) => x.key === s.key)) {
      if (!leftPage) issues.push(`keyboard trap: focus cycles inside the page at ${s.path}`);
      break;
    }
    stops.push(s);
    if (!s.name) issues.push(`no accessible name: ${s.path}`);
    if (!s.visible) issues.push(`focus on an invisible element: ${s.path}`);
    if (!s.ring) issues.push(`no visible focus style: ${s.path} "${s.name}"`);
  }
  problems += issues.length;
  findings.push({ label, keyboardStops: stops.length, keyboard: issues });
  console.log(`${issues.length ? '✗' : '✓'} keyboard: ${label} (${stops.length} stops)`);
  for (const i of issues) console.log(`    ${i}`);
}

// A radio group is one Tab stop; arrows, Home and End choose within it, and focus stays on the
// chosen option even when the page rebuilds its controls.
async function radioKeys(p, label) {
  const sel = '[role="radiogroup"]:not([aria-disabled="true"])';
  const radios = await p.evaluate((s) => {
    const group = [...document.querySelectorAll(s)].find((x) => x.checkVisibility());
    const all = [...group.querySelectorAll('[role="radio"]')];
    group.querySelector('[tabindex="0"]').focus();
    return { start: all.findIndex((b) => b.getAttribute('aria-checked') === 'true'), count: all.length, name: group.getAttribute('aria-label') };
  }, sel);
  const order = [];
  for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) {
    await p.keyboard.press(key);
    await sleep(250);
    order.push(await p.evaluate((name) => {
      const group = [...document.querySelectorAll('[role="radiogroup"]')].find((g) => g.getAttribute('aria-label') === name && g.checkVisibility());
      return [...group.querySelectorAll('[role="radio"]')].findIndex((b) => b.getAttribute('aria-checked') === 'true' && b === document.activeElement);
    }, radios.name));
  }
  const want = [(radios.start + 1) % radios.count, radios.start, radios.count - 1, 0];
  const ok = JSON.stringify(order) === JSON.stringify(want);
  if (!ok) problems++;
  findings.push({ label: `${label} radio keys`, ok, order, want });
  console.log(`${ok ? '✓' : '✗'} keyboard: ${label}, "${radios.name}" follows arrows, Home and End (${order.join(',')}, wanted ${want.join(',')})`);
  // Put the original choice back.
  for (let i = 0; i < radios.start; i++) await p.keyboard.press('ArrowRight');
  await sleep(250);
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const A = await ext.evaluate(() => window.RockyShared.ACTIONS);
  const msg = (action, payload) => ext.evaluate(([a, q]) => chrome.runtime.sendMessage({ action: a, payload: q }), [action, payload || {}]);

  const web = await context.newPage();
  await web.goto(`http://shop.test:${PORT}/`);
  await sleep(4000);
  const tabOf = (prefix) => ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), prefix);
  const shopTab = await tabOf(`http://shop.test:${PORT}/`);
  const browserTab = await ext.evaluate(() => chrome.tabs.create({ url: 'chrome://version/', active: false }).then((t) => t.id));
  await sleep(500);

  const popup = async (tabId, ready) => {
    const p = await context.newPage();
    await p.setViewportSize({ width: 380, height: 600 });
    await p.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    for (let i = 0; i < 25 && !(await p.evaluate(ready).catch(() => false)); i++) await sleep(200);
    await sleep(300);
    return p;
  };

  let p = await popup(shopTab, () => !!document.querySelector('.stats'));
  await audit(p, 'popup: website, simple view');
  await keyboard(p, 'popup: website, simple view');
  await p.click('#gear');
  await sleep(400);
  await audit(p, 'popup: website, advanced view');
  await keyboard(p, 'popup: website, advanced view');
  await radioKeys(p, 'popup');
  await p.close();

  await msg(A.SET_SITE_TIER, { siteKey: 'shop.test', tier: 'off' });
  p = await popup(shopTab, () => !!document.querySelector('.stats'));
  await audit(p, 'popup: website switched off');
  await p.close();
  await msg(A.SET_SITE_TIER, { siteKey: 'shop.test', tier: 'balanced' });

  await msg(A.SET_OPERATING_MODE, { mode: 'light' });
  p = await popup(shopTab, () => !!document.querySelector('.stats'));
  await audit(p, 'popup: Light mode');
  await p.close();
  await msg(A.SET_OPERATING_MODE, { mode: 'full' });

  p = await popup(browserTab, () => !!document.querySelector('.unsupported'));
  await audit(p, 'popup: browser page (unsupported)');
  await keyboard(p, 'popup: browser page (unsupported)');
  await p.close();

  const pages = await ext.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)).filter(Boolean));
  for (const id of [...new Set([...pages, 'welcome'])]) {
    const o = await context.newPage();
    await o.goto(`chrome-extension://${extId}/options.html#${id}`);
    await sleep(700);
    await audit(o, `settings: ${id}`);
    await keyboard(o, `settings: ${id}`);
    if (id === 'protection' || id === 'cookies') await radioKeys(o, `settings: ${id}`);
    await o.close();
  }

  // First-run setup, step 2 (step 1 is "settings: welcome" above), and its AI confirm.
  let o = await context.newPage();
  await o.addInitScript(() => { window.LanguageModel = { availability: async () => 'downloadable', create: () => new Promise(() => {}) }; });
  await o.goto(`chrome-extension://${extId}/options.html#welcome`);
  await sleep(700);
  await o.click('#setupNext');
  await o.waitForFunction(() => !document.getElementById('setupAi').hidden);
  await audit(o, 'settings: welcome, general settings');
  await keyboard(o, 'settings: welcome, general settings');
  await radioKeys(o, 'settings: welcome, general settings');
  await o.click('#setupAiToggle .switch');
  await o.waitForSelector('#setupAiConfirm input[type=checkbox]');
  await audit(o, 'settings: welcome, AI confirm');
  await keyboard(o, 'settings: welcome, AI confirm');
  await o.close();

  // The AI page's confirm step and its features, which stay hidden until AI is on.
  o = await context.newPage();
  await o.addInitScript(() => { window.LanguageModel = { availability: async () => 'downloadable', create: () => new Promise(() => {}) }; });
  await o.goto(`chrome-extension://${extId}/options.html#ai`);
  await sleep(700);
  await o.click('#aiMasterToggle .switch');
  await o.waitForSelector('#aiMasterSetup input[type=checkbox]');
  await audit(o, 'settings: ai (confirm)');
  await keyboard(o, 'settings: ai (confirm)');
  await o.close();
  await msg(A.SET_AI_ENABLED, { enabled: true });
  o = await context.newPage();
  await o.goto(`chrome-extension://${extId}/options.html#ai`);
  await o.waitForFunction(() => !document.getElementById('aiFeatures').hidden);
  await audit(o, 'settings: ai (on)');
  await keyboard(o, 'settings: ai (on)');
  await o.close();
  await msg(A.SET_AI_ENABLED, { enabled: false });
} catch (e) {
  problems++;
  console.error(e);
} finally {
  await context.close().catch(() => {});
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
if (process.env.A11Y_OUT) fs.writeFileSync(process.env.A11Y_OUT, JSON.stringify(findings, null, 2));
console.log(problems ? `\n${problems} accessibility problem(s)` : '\nno accessibility problems found');
process.exit(problems ? 1 : 0);
