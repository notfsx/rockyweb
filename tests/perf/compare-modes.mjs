#!/usr/bin/env node
// Compares Light, Full with AI off, and Full with automatic optimisation (model double) on the same
// fixtures and tab workload. Counts are measured; CPU and memory come from /proc (Linux) and CDP.
// Run: node tests/perf/compare-modes.mjs   (writes tests/perf/results.json and results.md)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXT_DIR } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUNS = Number(process.env.PERF_RUNS || 3);
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');

const ARTICLE = '<article style="max-width:640px;margin:40px auto"><h1>Story</h1>' + '<p>Some paragraph text for the article body.</p>'.repeat(30) + '</article>';
const OVERLAY = '<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;z-index:9"><h2>Join our newsletter</h2><p>In your inbox weekly.</p><input type="email" name="email"><button>Subscribe</button><button aria-label="Close">×</button></div>';
const later = (html, ms) => `<script>setTimeout(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)});}, ${ms});</script>`;
const thirdParty = (port) => ['t1.test', 't2.test', 't3.test', 'cdn.test'].map((h) => `<img src="http://${h}:${port}/p.gif" width="1" height="1">`).join('');
const FIXTURES = {
  '/article': (port) => `<!doctype html><body>${ARTICLE}${thirdParty(port)}${later(OVERLAY, 600)}</body>`,
  '/plain': (port) => `<!doctype html><body>${ARTICLE.replace('<article', '<main').replace('</article>', '</main>')}${thirdParty(port)}</body>`,
  '/checkout/': (port) => `<!doctype html><body><h1>Basket</h1>${thirdParty(port)}${later(OVERLAY.replace('Join our newsletter', 'Subscribe for 10% off your order'), 600)}</body>`,
  '/banner': (port) => `<!doctype html><body>${ARTICLE}${thirdParty(port)}<div class="notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff">We use cookies. <button onclick="this.parentNode.remove()">Reject all</button><button onclick="this.parentNode.remove()">Accept all</button></div></body>`,
  '/busy': (port) => `<!doctype html><body>${ARTICLE}${thirdParty(port)}<script>let n=0;setInterval(function(){const d=document.createElement('div');d.textContent='update '+(++n);document.body.appendChild(d);if(n>200)d.remove();},50);</script></body>`
};
// Same workload for every configuration: one tab per fixture on distinct sites.
const WORKLOAD = [['a1.test', '/article'], ['p1.test', '/plain'], ['c1.test', '/checkout/'], ['b1.test', '/banner'], ['u1.test', '/busy']];

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/p.gif') { res.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': 'uid=a8F3kL9qZx72Pp1w; Path=/' }); res.end(GIF); return; }
  const f = FIXTURES[p];
  res.writeHead(f ? 200 : 404, { 'content-type': 'text/html' });
  res.end(f ? f(server.address().port) : '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

function procTicks() {
  // utime + stime of every Chrome process started by this run, split by the extension process.
  let total = 0;
  let extension = 0;
  let rssKb = 0;
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes('rockyweb-perf-')) continue;
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      const ticks = Number(stat[11]) + Number(stat[12]);
      total += ticks;
      if (cmd.includes('--extension-process')) extension += ticks;
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      rssKb += Number((/VmRSS:\s+(\d+)/.exec(status) || [0, 0])[1]);
    } catch (_) { /* process ended */ }
  }
  return { total, extension, rssKb };
}

function installModelDouble() {
  const F = (self.__fakeLM = { calls: 0 });
  const session = () => ({ async clone() { return session(); }, destroy() {}, async prompt(text) { F.calls++; const id = (/"candidate":"(c\d+)"/.exec(text) || [])[1]; return JSON.stringify({ candidate: id, action: /"page":"article"/.test(text) ? 'hide_overlay' : 'leave_unchanged', confidence: 'high' }); } });
  Object.defineProperty(self, 'LanguageModel', { configurable: true, writable: true, value: { async availability() { return 'available'; }, async create() { return session(); } } });
}

// Counts service-worker work by wrapping the extension's own functions (test instrumentation only).
function instrument() {
  const C = (self.__perf = { executeScript: 0, insertCSS: 0, thirdPartyEvents: 0, learnCalls: 0, navigations: 0 });
  const wrap = (obj, key, counter) => { const orig = obj[key].bind(obj); obj[key] = (...a) => { C[counter]++; return orig(...a); }; };
  wrap(chrome.scripting, 'executeScript', 'executeScript');
  wrap(chrome.scripting, 'insertCSS', 'insertCSS');
  const tp = thirdPartyContext; thirdPartyContext = (d) => { C.thirdPartyEvents++; return tp(d); }; // eslint-disable-line no-global-assign
  const lf = learnFrom; learnFrom = (ctx) => { C.learnCalls++; return lf(ctx); }; // eslint-disable-line no-global-assign
  const st = startTabRecord; startTabRecord = (...a) => { C.navigations++; return st(...a); }; // eslint-disable-line no-global-assign
}

async function runConfig(name, setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-perf-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server']
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${extId}/options.html`);
  const msg = (action, payload) => ctl.evaluate(([a, p]) => chrome.runtime.sendMessage({ action: a, payload: p }), [action, payload]);
  await setup(msg, sw);
  await ctl.evaluate(() => setInterval(() => chrome.runtime.sendMessage({ action: 'getAiStatus', payload: {} }), 8000));
  await sleep(1000);
  await sw.evaluate(instrument);
  const before = procTicks();
  const t0 = Date.now();
  const pages = [];
  for (const [host, p] of WORKLOAD) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.bringToFront();
    await page.goto(`http://${host}:${PORT}${p}`);
    pages.push({ page, cdp, fixture: p });
    await sleep(4000); // read each page in the foreground for a moment, like ordinary browsing
  }
  await sleep(4000);
  const after = procTicks();
  const wall = (Date.now() - t0) / 1000;
  const counters = await sw.evaluate(() => Object.assign({}, self.__perf, {
    modelCalls: self.__fakeLM ? self.__fakeLM.calls : 0,
    brokerPrompts: broker.stats.prompts,
    headerListeners: chrome.webRequest.onSendHeaders.hasListener(onSendHeaders)
  }));
  const perPage = {};
  for (const { cdp, fixture, page } of pages) {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    perPage[fixture] = {
      scriptMs: Math.round(m.ScriptDuration * 1000),
      taskMs: Math.round(m.TaskDuration * 1000),
      heapMb: Math.round(m.JSHeapUsedSize / 1048576 * 10) / 10,
      overlayHidden: await page.evaluate(() => { const el = document.querySelector('.newsletter-popup'); return el ? getComputedStyle(el).display === 'none' : null; })
    };
  }
  const hz = 100; // USER_HZ on Linux
  await context.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    name, wallSeconds: wall, counters, perPage,
    cpuSecondsAllChrome: (after.total - before.total) / hz,
    cpuSecondsExtensionProcess: (after.extension - before.extension) / hz,
    rssMbAllChrome: Math.round(after.rssKb / 1024)
  };
}

const CONFIGS = [
  ['Light', async (msg) => { await msg('setOperatingMode', { mode: 'light' }); }],
  ['Full, AI off', async () => {}],
  ['Full, auto-optimisation (model double)', async (msg, sw) => { await sw.evaluate(installModelDouble); await msg('setAiAutoOptimise', { enabled: true }); }]
];

const all = [];
for (let r = 0; r < RUNS; r++) {
  for (const [name, setup] of CONFIGS) {
    const res = await runConfig(name, setup);
    console.log(`${name} run ${r + 1}: cpu ${res.cpuSecondsAllChrome.toFixed(2)} s, model calls ${res.counters.modelCalls}, injections ${res.counters.executeScript}`);
    all.push(res);
  }
}
server.close();

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = CONFIGS.map(([name]) => {
  const rs = all.filter((r) => r.name === name);
  const pick = (f) => median(rs.map(f));
  return {
    name,
    runs: rs.length,
    executeScript: pick((r) => r.counters.executeScript),
    insertCSS: pick((r) => r.counters.insertCSS),
    thirdPartyEvents: pick((r) => r.counters.thirdPartyEvents),
    learnCalls: pick((r) => r.counters.learnCalls),
    modelCalls: pick((r) => r.counters.modelCalls),
    headerObservation: rs[0].counters.headerListeners,
    cpuAll: pick((r) => r.cpuSecondsAllChrome),
    cpuExt: pick((r) => r.cpuSecondsExtensionProcess),
    rssMb: pick((r) => r.rssMbAllChrome),
    pageTaskMs: Object.fromEntries(Object.keys(FIXTURES).map((f) => [f, pick((r) => r.perPage[f].taskMs)])),
    plainPageModelCalls: 'see the AI e2e suite (zero by assertion)',
    articleOverlayHidden: rs.every((r) => r.perPage['/article'].overlayHidden === true),
    checkoutOverlayHidden: rs.some((r) => r.perPage['/checkout/'].overlayHidden === true)
  };
});
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'results');
fs.writeFileSync(`${out}.json`, `${JSON.stringify({ date: new Date().toISOString(), machine: `${os.cpus().length} CPUs, ${Math.round(os.totalmem() / 2 ** 30)} GB`, summary, raw: all }, null, 2)}\n`);
const rows = summary.map((s) => `| ${s.name} | ${s.executeScript} | ${s.insertCSS} | ${s.thirdPartyEvents} | ${s.learnCalls} | ${s.headerObservation ? 'yes' : 'no'} | ${s.modelCalls} | ${s.cpuAll.toFixed(2)} | ${s.cpuExt.toFixed(2)} | ${s.rssMb} | ${s.pageTaskMs['/busy']} | ${s.articleOverlayHidden ? 'yes' : 'no'} | ${s.checkoutOverlayHidden ? 'yes' : 'no'} |`);
fs.writeFileSync(`${out}.md`, [
  `# Light vs Full: measured on ${new Date().toISOString().slice(0, 10)}`,
  '',
  `Five tabs opened one after another, each in the foreground for 4 s and left open (article with newsletter overlay, ordinary page, checkout overlay, cookie banner, busy DOM page), median of ${RUNS} runs, headless Chromium, ${os.cpus().length} CPUs. The model is a deterministic double, so model latency and memory are not included.`,
  '',
  '| Configuration | Script injections | CSS injections | Third-party request events handled | Learning checks | Header observation | Model calls | CPU s, all Chrome | CPU s, extension process | RSS MB, all Chrome | Busy page main-thread ms | Article overlay hidden | Checkout overlay hidden |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  ''
].join('\n'));
console.log(fs.readFileSync(`${out}.md`, 'utf8'));
