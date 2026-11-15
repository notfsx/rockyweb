#!/usr/bin/env node
// Real Gemini Nano check on your own machine: npm run test:nano
// Uses your installed Google Chrome (138+) with a separate profile in .nano-profile/, never your
// everyday profile. Writes tests/nano/nano-report.json. Needs Playwright (npm i -D playwright);
// no Playwright browser download is required because your own Chrome is used.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(EXT_DIR, '..');
const PROFILE = path.join(ROOT, '.nano-profile');
const REPORT = path.join(ROOT, 'tests', 'nano', 'nano-report.json');
const DEBUG_PORT = Number(process.env.NANO_DEBUG_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = async (q) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(local, 'Google\\Chrome\\Application\\chrome.exe')
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome']
  }[process.platform] || [];
  return candidates.find((p) => p && fs.existsSync(p));
}

// ---- fixtures: an article with a late newsletter overlay, and an ordinary page with no candidate
const ARTICLE = '<article style="max-width:640px;margin:40px auto;font-family:sans-serif"><h1>Spaniel catches ball</h1>' +
  '<p>Witnesses described the moment as graceful. The ball was returned, slightly damp.</p>'.repeat(14) + '</article>';
const OVERLAY = `<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;border:1px solid #ccc;z-index:9">
  <h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p>
  <input type="email" name="email" placeholder="Email address"><button>Subscribe</button><button aria-label="Close">×</button></div>`;
const pages = {
  '/article': `<!doctype html><html><body>${ARTICLE}<script>setTimeout(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(OVERLAY)});document.documentElement.style.overflow='hidden';}, 800);</script></body></html>`,
  '/plain': `<!doctype html><html><body>${ARTICLE.replace('<article', '<main').replace('</article>', '</main>')}</body></html>`
};

const report = { startedAt: new Date().toISOString(), platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30), steps: [] };
const step = (name, data) => { report.steps.push(Object.assign({ name }, data)); console.log(`• ${name}`, data ? JSON.stringify(data) : ''); };
const save = () => { fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`); console.log(`\nreport written to ${path.relative(ROOT, REPORT)}`); };

const chromePath = findChrome();
if (!chromePath) {
  console.error('Google Chrome was not found. Set CHROME_PATH to chrome.exe / Google Chrome.');
  process.exit(1);
}
fs.mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(chromePath, [
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run', '--no-default-browser-check',
  `--load-extension=${EXT_DIR}` // honoured by Chromium builds; official Chrome needs "Load unpacked" once (below)
], { stdio: 'ignore', detached: false });

const server = http.createServer((req, res) => {
  const body = pages[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
  res.end(body || '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let browser;
try {
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); } catch (_) { await sleep(500); }
  }
  if (!browser) throw new Error('could not connect to Chrome on the debugging port');
  const context = browser.contexts()[0];
  report.chrome = browser.version();
  step('connected to Chrome', { version: report.chrome });

  const findWorker = () => context.serviceWorkers().find((w) => /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(w.url()));
  let sw = findWorker();
  for (let i = 0; i < 10 && !sw; i++) { await sleep(500); sw = findWorker(); }
  while (!sw) {
    const setup = await context.newPage();
    await setup.goto('chrome://extensions').catch(() => {});
    console.log(`\nRockyweb is not loaded in the test profile yet. In the Chrome window that opened:\n  1. turn on Developer mode (top right)\n  2. click "Load unpacked" and choose ${EXT_DIR}\n`);
    await ask('Press Enter when Rockyweb appears in the list… ');
    for (let i = 0; i < 10 && !sw; i++) { await sleep(500); sw = findWorker(); }
  }
  const extId = new URL(sw.url()).host;
  const manifestName = await sw.evaluate(() => chrome.runtime.getManifest().name);
  step('Rockyweb loaded', { extId, manifestName });

  const availability = () => sw.evaluate(() => (typeof LanguageModel === 'undefined' ? 'absent' : LanguageModel.availability(self.RockyShared.AI_MODEL_OPTIONS)));
  let avail = await availability();
  step('LanguageModel in the service worker', { availability: avail });
  if (avail === 'absent' || avail === 'unavailable') {
    console.log('\nChrome reports that on-device AI is not available on this machine, so there is nothing real to test.');
    console.log('Check chrome://on-device-internals and Google\'s hardware requirements (22 GB free disk; GPU with >4 GB VRAM, or 16 GB RAM and 4 CPU cores).');
    report.result = 'unavailable_on_this_machine';
    save();
    process.exit(0);
  }

  if (avail === 'downloadable' || avail === 'downloading') {
    if (avail === 'downloadable') {
      const ok = await ask('\nChrome needs to download Gemini Nano (a large, one-time download of several GB, kept by Chrome). Start it? [y/N] ');
      if (!/^y/i.test(ok)) { report.result = 'download_declined'; save(); process.exit(0); }
      // The click on the settings page is the user gesture Chrome requires for the download.
      const opt = await context.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html#protection`);
      await sleep(800);
      await opt.click('#aiToggle .switch');
      await opt.click('text=download and turn on');
      step('download started from the settings page');
    }
    const started = Date.now();
    while ((avail = await availability()) !== 'available') {
      process.stdout.write(`\r  waiting for the model: ${avail}, ${Math.round((Date.now() - started) / 1000)} s `);
      await sleep(5000);
    }
    process.stdout.write('\n');
    step('model ready', { seconds: Math.round((Date.now() - started) / 1000) });
  }

  // Turn automatic optimisation on, then close every Rockyweb page before browsing.
  const opt = context.pages().find((p) => p.url().startsWith(`chrome-extension://${extId}/`)) || await context.newPage();
  if (!opt.url().startsWith(`chrome-extension://${extId}/`)) await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.evaluate(() => chrome.runtime.sendMessage({ action: 'setAiAutoOptimise', payload: { enabled: true } }));
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  const openExtensionPages = context.pages().filter((p) => p.url().startsWith('chrome-extension://')).length;
  step('all Rockyweb pages closed', { openExtensionPages });

  const stats = () => sw.evaluate(() => Object.assign({}, broker.stats, { hasSession: broker.hasSession }));
  const web = await context.newPage();
  await web.bringToFront();

  const before = await stats();
  const t0 = Date.now();
  await web.goto(`http://localhost:${PORT}/article`);
  let hidden = false;
  for (let i = 0; i < 120 && !hidden; i++) {
    hidden = await web.evaluate(() => { const el = document.querySelector('.newsletter-popup'); return !!el && getComputedStyle(el).display === 'none'; });
    if (!hidden) await sleep(500);
  }
  const afterArticle = await stats();
  step('article with newsletter overlay', { hidden, seconds: Math.round((Date.now() - t0) / 100) / 10, modelCalls: afterArticle.prompts - before.prompts });

  await web.goto(`http://127.0.0.1:${PORT}/plain`);
  await sleep(6000);
  const afterPlain = await stats();
  step('ordinary page with no candidate', { modelCalls: afterPlain.prompts - afterArticle.prompts });

  await sleep(65000);
  step('idle session released', { hasSession: (await stats()).hasSession });

  report.result = hidden && afterArticle.prompts - before.prompts === 1 && afterPlain.prompts === afterArticle.prompts ? 'pass' : 'check_report';
  console.log(`\nresult: ${report.result}`);
  save();
} catch (err) {
  report.result = 'error';
  report.error = String(err && err.stack || err);
  console.error(err);
  save();
  process.exitCode = 1;
} finally {
  server.close();
  if (browser) await browser.close().catch(() => {});
  chrome.kill();
}
