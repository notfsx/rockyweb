#!/usr/bin/env node
// Real Gemini Nano check on your own machine: npm run test:nano
// Uses your installed Google Chrome (138+) with a separate profile in .nano-profile/, never your
// everyday profile. Writes tests/nano/nano-report.json. Needs Playwright (npm i -D playwright);
// no Playwright browser download is required because your own Chrome is used.
// NANO_PROFILE=<dir> puts the profile (and the model) elsewhere, e.g. outside a synced folder.
// NANO_DOWNLOAD=yes starts the model download without asking.
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
// NANO_PROFILE moves the profile (and the model Chrome downloads into it) out of a synced folder.
const PROFILE = process.env.NANO_PROFILE || path.join(ROOT, '.nano-profile');
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
// Official Chrome ignores --load-extension, so the extension is loaded through CDP over a pipe
// (Extensions.loadUnpacked). It lasts for this run only; "Load unpacked" by hand stays as a fallback.
const chrome = spawn(chromePath, [
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--load-extension=${EXT_DIR}`,
  '--host-resolver-rules=MAP *.test 127.0.0.1'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: false });

let pipeBuf = '';
let pipeId = 0;
const pipeWaiting = new Map();
chrome.stdio[4].on('data', (d) => {
  pipeBuf += d.toString();
  let i;
  while ((i = pipeBuf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(pipeBuf.slice(0, i));
    pipeBuf = pipeBuf.slice(i + 1);
    if (pipeWaiting.has(msg.id)) { pipeWaiting.get(msg.id)(msg); pipeWaiting.delete(msg.id); }
  }
});
const pipe = (method, params) => new Promise((resolve) => {
  const id = ++pipeId;
  pipeWaiting.set(id, resolve);
  chrome.stdio[3].write(`${JSON.stringify({ id, method, params })}\0`);
  setTimeout(() => { if (pipeWaiting.delete(id)) resolve({ error: { message: 'no reply' } }); }, 15000);
});
// Chrome keeps the profile's cached service worker on a plain load, so uninstall and load again
// to run the code on disk.
async function loadOverPipe() {
  const first = await pipe('Extensions.loadUnpacked', { path: EXT_DIR });
  if (!first.result) return `error: ${first.error && first.error.message}`;
  await pipe('Extensions.uninstall', { id: first.result.id });
  await sleep(1000);
  const again = await pipe('Extensions.loadUnpacked', { path: EXT_DIR });
  return again.result ? again.result.id : `error: ${again.error && again.error.message}`;
}

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
  step('extension loaded over the CDP pipe', { result: await loadOverPipe() });

  // Other extensions can also name their worker background.js, so check the manifest.
  const findWorker = async () => {
    for (const w of context.serviceWorkers()) {
      if (!/^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(w.url())) continue;
      const name = await w.evaluate(() => chrome.runtime.getManifest().short_name).catch(() => '');
      if (name === 'Rockyweb') return w;
    }
    return null;
  };
  let sw = await findWorker();
  for (let i = 0; i < 10 && !sw; i++) { await sleep(500); sw = await findWorker(); }
  while (!sw) {
    const setup = await context.newPage();
    await setup.goto('chrome://extensions').catch(() => {});
    console.log(`\nRockyweb is not loaded in the test profile yet. In the Chrome window that opened:\n  1. turn on Developer mode (top right)\n  2. click "Load unpacked" and choose ${EXT_DIR}\n`);
    await ask('Press Enter when Rockyweb appears in the list… ');
    for (let i = 0; i < 10 && !sw; i++) { await sleep(500); sw = await findWorker(); }
  }
  const extId = new URL(sw.url()).host;
  const manifestName = await sw.evaluate(() => chrome.runtime.getManifest().name);
  step('Rockyweb loaded', { extId, manifestName });
  const fresh = await sw.evaluate(async () => (await (await fetch('engines/ai-broker.js')).text()).includes(self.RockyShared.createAiBroker.toString()));
  step('service worker runs the code on disk', { fresh });
  if (!fresh) throw new Error('the service worker is running a cached copy of the extension');

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
      const ok = process.env.NANO_DOWNLOAD === 'yes' ? 'y' : await ask('\nChrome needs to download Gemini Nano (a large, one-time download of several GB, kept by Chrome). Start it? [y/N] ');
      if (!/^y/i.test(ok)) { report.result = 'download_declined'; save(); process.exit(0); }
      // The click on the settings page is the user gesture Chrome requires for the download.
      const opt = await context.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html#ai`);
      await sleep(800);
      await opt.click('#aiMasterToggle .switch');
      await opt.check('#aiMasterSetup input[type=checkbox]');
      await opt.click('#aiMasterSetup >> text=download and turn on');
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

  // Turn on-device AI and automatic optimisation on, forget earlier decisions, then close every Rockyweb page.
  const opt = context.pages().find((p) => p.url().startsWith(`chrome-extension://${extId}/`)) || await context.newPage();
  if (!opt.url().startsWith(`chrome-extension://${extId}/`)) await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.evaluate(() => chrome.runtime.sendMessage({ action: 'setAiEnabled', payload: { enabled: true } }));
  await opt.evaluate(() => chrome.runtime.sendMessage({ action: 'setAiAutoOptimise', payload: { enabled: true } }));
  await opt.evaluate(() => chrome.runtime.sendMessage({ action: 'clearAiMemory', payload: {} }));
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  const openExtensionPages = context.pages().filter((p) => p.url().startsWith('chrome-extension://')).length;
  step('all Rockyweb pages closed', { openExtensionPages });

  const stats = () => sw.evaluate(() => Object.assign({}, broker.stats, { hasSession: broker.hasSession, pending: broker.pending }));
  const web = await context.newPage();
  await web.bringToFront();
  const overlay = () => web.evaluate(() => { const el = document.querySelector('.newsletter-popup'); return !el ? 'absent' : getComputedStyle(el).display === 'none' ? 'hidden' : 'shown'; });
  // Each article is on its own site, so no decision is recalled from memory.
  async function article(host, waitMs) {
    const before = await stats();
    const t0 = Date.now();
    await web.goto(`http://${host}:${PORT}/article`);
    let state = 'absent';
    for (const end = Date.now() + waitMs; Date.now() < end;) {
      state = await overlay();
      const s = await stats();
      if (state === 'hidden' || (state === 'shown' && s.timeouts + s.failures + s.invalid + s.warming > before.timeouts + before.failures + before.invalid + before.warming)) break;
      await sleep(250);
    }
    const after = await stats();
    return {
      state, seconds: Math.round((Date.now() - t0) / 100) / 10, modelCalls: after.prompts - before.prompts,
      timeouts: after.timeouts - before.timeouts, warming: after.warming - before.warming, pending: after.pending
    };
  }

  // 1. Cold: the first inference after a browser start can take minutes. The request must stay
  //    bounded by the 20 s broker timeout and leave the overlay alone, never hang the queue.
  const cold = await article('cold.test', 45000);
  step('cold model: article overlay', cold);
  // The next article within a minute is answered at once ("model_warming"), without waiting again.
  const backoff = await article('cold2.test', 30000);
  step('cold model: next article during the backoff', backoff);

  // 2. Measured warm-up, done by this harness (not by Rockyweb) so the next checks see a ready model.
  const warm = await sw.evaluate(async () => {
    const t = performance.now();
    const s = await LanguageModel.create(Object.assign({}, self.RockyShared.AI_MODEL_OPTIONS));
    const createMs = performance.now() - t;
    await s.prompt('Reply with OK.');
    s.destroy();
    return { createSeconds: Math.round(createMs / 100) / 10, firstInferenceSeconds: Math.round((performance.now() - t - createMs) / 100) / 10 };
  });
  step('model warm-up by the test harness', warm);

  // 3. Warm: hidden with exactly one real model call.
  const warmArticle = await article('news.test', 60000);
  step('article with newsletter overlay', warmArticle);

  const beforePlain = await stats();
  await web.goto(`http://quiet.test:${PORT}/plain`);
  await sleep(6000);
  const plainCalls = (await stats()).prompts - beforePlain.prompts;
  step('ordinary page with no candidate', { modelCalls: plainCalls });

  await web.goto('about:blank');
  await sleep(65000);
  const released = !(await stats()).hasSession;
  step('idle session released', { hasSession: !released });

  // 4. After release: is the model still warm in Chrome, or cold again?
  const afterRelease = await article('later.test', 30000);
  step('article after the session was released', afterRelease);

  const coldOk = cold.state !== 'absent' && cold.pending === 0 && (cold.state === 'hidden' || cold.timeouts >= 1);
  const warmOk = warmArticle.state === 'hidden' && warmArticle.modelCalls === 1;
  const backoffOk = cold.state === 'hidden' || (backoff.state === 'shown' && backoff.warming === 1 && backoff.modelCalls === 0 && backoff.seconds < 10);
  report.result = coldOk && backoffOk && warmOk && plainCalls === 0 && released ? 'pass' : 'check_report';
  console.log(`
result: ${report.result}`);
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
