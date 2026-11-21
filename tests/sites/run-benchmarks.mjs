#!/usr/bin/env node
// Public blocking tests, with and without Rockyweb. Browse only: one visit per page per config,
// no clicks. adblock-tester.com runs its checks on load and we read the score it prints.
// d3ward's hosted test now only says "Project Archived", so its host list (from the repository,
// fetched into tests/sites/.data, git-ignored) is checked the way it did: one request per host from
// a local page, counted as blocked when Chrome reports it blocked by an extension.
// Cover Your Tracks needs a click on its start button, so it is not run (browse-only rule).
// usage: node tests/sites/run-benchmarks.mjs [--configs=baseline,balanced,strict] [--tag=name] [--only=d3ward]
// Text and screenshots go to tests/sites/.out/<tag>/bench (not committed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { EXT_DIR as DEFAULT_EXT, loadShared } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const RW = loadShared();
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const CONFIGS = arg('configs', 'baseline,balanced,strict').split(',');
const ONLY = arg('only', '');
const EXT_DIR = arg('ext', DEFAULT_EXT);
const OUT = path.join(HERE, '.out', arg('tag', new Date().toISOString().slice(0, 10)), 'bench');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D3WARD = path.join(HERE, '.data', 'd3ward-adblock-data.json');

const PAGES = [
  // adblock-tester.com: loads ad, analytics and error tracking hosts and scores them out of 100.
  { id: 'adblock-tester', url: 'https://adblock-tester.com/', wait: 30000, score: [/(\d{1,3})\s*(?:points|pts)/i, /score[^\d]{0,20}(\d{1,3})/i] }
];

// Every host in d3ward's list, by category, from a local page.
async function d3ward(context, config) {
  const data = JSON.parse(fs.readFileSync(D3WARD, 'utf8'));
  const hosts = [];
  for (const [cat, groups] of Object.entries(data)) for (const list of Object.values(groups)) for (const h of list) hosts.push({ cat, h });
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>hosts</title>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const page = await context.newPage();
  const blocked = new Set();
  page.on('requestfailed', (q) => { if (/BLOCKED_BY_CLIENT/.test((q.failure() || {}).errorText || '')) blocked.add(new URL(q.url()).hostname); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.evaluate((list) => Promise.allSettled(list.map(({ h }) => Promise.race([
    fetch(`https://${h}/`, { mode: 'no-cors', cache: 'no-store' }),
    new Promise((r) => setTimeout(r, 8000))]))), hosts);
  await sleep(500);
  await page.close();
  srv.close();
  const byCat = {};
  for (const { cat, h } of hosts) {
    const c = (byCat[cat] = byCat[cat] || { hosts: 0, blocked: 0 });
    c.hosts++;
    if (blocked.has(h)) c.blocked++;
  }
  const r = { config, id: 'd3ward-hosts', hosts: hosts.length, blockedRequests: blocked.size, score: `${blocked.size}/${hosts.length}`, byCat };
  console.log(`[${config}] d3ward hosts: ${r.score} blocked ${JSON.stringify(byCat)}`);
  return r;
}

async function run(config) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-bench-'));
  const args = config === 'baseline' ? [] : [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`];
  const context = await chromium.launchPersistentContext(userDir, { headless: true, channel: 'chromium', userAgent: UA, locale: 'en-GB', viewport: { width: 1366, height: 900 }, args });
  const out = [];
  try {
    if (config !== 'baseline') {
      let sw = context.serviceWorkers()[0];
      if (!sw) sw = await context.waitForEvent('serviceworker');
      const ext = await context.newPage();
      await ext.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
      await ext.evaluate(([a, t]) => chrome.runtime.sendMessage({ action: a, payload: { tier: t } }), [RW.ACTIONS.SET_GLOBAL_TIER, config]);
      await ext.close();
      await sleep(1500); // rules compile
    }
    if (fs.existsSync(D3WARD) && (!ONLY || ONLY === 'd3ward')) out.push(await d3ward(context, config));
    for (const p of PAGES.filter((x) => !ONLY || ONLY === x.id)) {
      const page = await context.newPage();
      const r = { config, id: p.id, url: p.url };
      let blocked = 0;
      page.on('requestfailed', (q) => { if (/BLOCKED_BY_CLIENT/.test((q.failure() || {}).errorText || '')) blocked++; });
      try {
        await page.goto(p.url, { waitUntil: 'load', timeout: 45000 });
        await sleep(p.wait);
        const text = await page.evaluate(() => document.body.innerText.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n'));
        fs.writeFileSync(path.join(OUT, `${config}.${p.id}.txt`), text);
        await page.screenshot({ path: path.join(OUT, `${config}.${p.id}.png`), fullPage: true }).catch(() => {});
        for (const re of p.score) { const m = text.match(re); if (m) { r.score = m.slice(1).join('/'); break; } }
      } catch (e) { r.error = String(e.message || e).slice(0, 160); }
      r.blockedRequests = blocked;
      out.push(r);
      console.log(`[${config}] ${p.id}: ${r.error ? `error ${r.error}` : `score ${r.score || 'not found'}, ${blocked} requests blocked`}`);
      await page.close();
      await sleep(3000);
    }
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'bench.json');
// Results from an earlier call are kept for the pages and configs not run now.
const ranNow = (r) => CONFIGS.includes(r.config) && (!ONLY || r.id === ONLY || (ONLY === 'd3ward' && r.id === 'd3ward-hosts'));
const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).filter((r) => !ranNow(r)) : [];
for (const c of CONFIGS) all.push(...await run(c));
fs.writeFileSync(file, JSON.stringify(all.filter((r) => r.id !== 'd3ward'), null, 2));
console.log(`done, ${OUT}`);
