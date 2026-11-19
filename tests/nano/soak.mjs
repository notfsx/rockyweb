// Local-only soak against REAL Gemini Nano in official Chrome: many navigations through article overlays,
// known and unknown cookie banners and plain pages, then memory, storage and model-session checks.
// usage: node tests/nano/soak.mjs <repoRoot> <profileDir> <outJson> [navigations]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { CHROME } from './cdp-pipe.mjs';

const [ROOT, PROFILE, OUT, COUNT] = process.argv.slice(2);
const N = Number(COUNT) || 200;
const EXT_DIR = path.join(ROOT, 'extension');
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString(), navigations: N, memory: [] };

const doc = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>soak</title></head><body style="font-family:sans-serif;margin:0">${body}</body></html>`;
const ARTICLE = '<article style="max-width:640px;margin:40px auto"><h1>Spaniel catches ball</h1>' + '<p>Witnesses described the moment as graceful. The ball was returned, slightly damp.</p>'.repeat(12) + '</article>';
const later = (html, ms = 500) => `<script>window.__clicks = []; setTimeout(function () { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); }, ${ms});</script>`;
const OVERLAY = '<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;border:1px solid #ccc;z-index:9"><h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p><input type="email" name="email" placeholder="Email address"><button>Subscribe</button><button aria-label="Close">×</button></div>';
const btn = (label, kind) => `<button onclick="window.__clicks.push('${kind}');${kind === 'refuse' ? "document.cookie='site_consent=refused; path=/';" : ''}this.parentNode.remove()">${label}</button>`;
const BANNER = (buttons) => `<div class="site-cookie-notice" style="position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;z-index:9"><h3>Your privacy</h3><p>We use cookies to analyse traffic and show personalised ads.</p>${buttons}</div>`;
const PAGES = {
  article: () => doc(ARTICLE + later(OVERLAY)),
  plain: () => doc(ARTICLE.replace('<article', '<main').replace('</article>', '</main>')),
  known: () => doc('<main><p>article</p></main>' + later(BANNER(btn('Reject all', 'refuse') + btn('Accept all', 'accept')))),
  unknown: () => doc('<main><p>article</p></main>' + later(BANNER(btn('Agree and proceed', 'accept') + btn('Only the necessary ones', 'refuse')))),
  login: () => doc('<main><h1>Your account</h1></main>' + later(OVERLAY.replace('<h2>Join our newsletter</h2>', '<h3>Sign in</h3><input type="password" name="password">')))
};
const KINDS = ['article', 'plain', 'known', 'unknown', 'login'];
const server = http.createServer((req, res) => {
  const k = req.url.split('?')[0].slice(1);
  res.writeHead(PAGES[k] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGES[k] ? PAGES[k]() : '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

function memory() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(PROFILE)}*' } | ForEach-Object { [pscustomobject]@{ ws=$_.WorkingSetSize; priv=$_.PrivatePageCount; cmd=$_.CommandLine } } | ConvertTo-Json -Compress`;
  const rows = [].concat(JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }) || '[]'));
  const sum = (f) => Math.round(rows.filter(f).reduce((a, r) => a + r.priv, 0) / 2 ** 20);
  return { processes: rows.length, privateMB: sum(() => true), extensionPrivateMB: sum((r) => /--extension-process/.test(r.cmd)),
    modelPrivateMB: sum((r) => /on_device_model/.test(r.cmd)) };
}

const chrome = spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--remote-debugging-port=9337', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.test 127.0.0.1'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let pbuf = ''; let pn = 0; const pw = new Map();
chrome.stdio[4].on('data', (d) => { pbuf += d; let i; while ((i = pbuf.indexOf('\0')) >= 0) { const m = JSON.parse(pbuf.slice(0, i)); pbuf = pbuf.slice(i + 1); if (pw.has(m.id)) { pw.get(m.id)(m); pw.delete(m.id); } } });
const cdp = (method, params) => new Promise((r) => { const k = ++pn; pw.set(k, r); chrome.stdio[3].write(`${JSON.stringify({ id: k, method, params })}\0`); });

let browser;
try {
  for (let i = 0; i < 40 && !browser; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9337'); } catch (_) { await sleep(500); } }
  const first = await cdp('Extensions.loadUnpacked', { path: EXT_DIR });
  await cdp('Extensions.uninstall', { id: first.result.id });
  await sleep(1000);
  const extId = (await cdp('Extensions.loadUnpacked', { path: EXT_DIR })).result.id;
  const context = browser.contexts()[0];
  out.chrome = browser.version();
  const worker = async () => { for (let i = 0; i < 30; i++) { const w = context.serviceWorkers().filter((x) => x.url() === `chrome-extension://${extId}/background.js`).pop(); if (w) return w; await sleep(500); } return null; };
  let sw = await worker();
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  const msg = (a, p) => opt.evaluate(([x, y]) => chrome.runtime.sendMessage({ action: x, payload: y }), [a, p]);
  const A = await opt.evaluate(() => window.RockyShared.ACTIONS);
  await msg(A.SET_OPERATING_MODE, { mode: 'full' });
  await msg(A.SET_AI_AUTO_OPTIMISE, { enabled: true });
  await opt.evaluate(() => chrome.storage.local.set({ aiMemory: {} }));
  const t = Date.now();
  await sw.evaluate(async () => { const s = await LanguageModel.create(Object.assign({}, self.RockyShared.AI_MODEL_OPTIONS)); await s.prompt('Reply with OK.'); s.destroy(); });
  out.warmupSeconds = Math.round((Date.now() - t) / 1000);
  console.log('chrome', out.chrome, 'warm after', out.warmupSeconds, 's');
  const bytes = () => opt.evaluate(async () => ({ local: await chrome.storage.local.getBytesInUse(null), session: await chrome.storage.session.getBytesInUse(null) }));
  out.bytesStart = await bytes();
  out.memory.push(Object.assign({ at: 0 }, memory()));
  const web = await context.newPage();
  const tally = { article: [0, 0], known: [0, 0], unknown: [0, 0], loginLeft: [0, 0], accepts: 0, navigations: 0, settleMs: [] };
  for (let i = 0; i < N; i++) {
    const kind = KINDS[i % KINDS.length];
    const url = `http://soak${i}.test:${PORT}/${kind}`;
    const t0 = Date.now();
    await web.goto(url);
    const done = async () => web.evaluate((k) => {
      if (k === 'article') { const el = document.querySelector('.newsletter-popup'); return !!el && getComputedStyle(el).display === 'none'; }
      if (k === 'known' || k === 'unknown') return window.__clicks.length > 0;
      return false;
    }, kind).catch(() => false);
    let ok = false;
    const end = Date.now() + (kind === 'plain' || kind === 'login' ? 4000 : 15000);
    while (Date.now() < end && !(ok = await done())) await sleep(200);
    if (ok) tally.settleMs.push(Date.now() - t0);
    const clicks = await web.evaluate(() => window.__clicks || []).catch(() => []);
    tally.accepts += clicks.filter((c) => c === 'accept').length;
    if (web.url() !== url) tally.navigations++;
    if (kind === 'article') tally.article[ok ? 0 : 1]++;
    if (kind === 'known') tally.known[clicks.includes('refuse') ? 0 : 1]++;
    if (kind === 'unknown') tally.unknown[clicks.includes('refuse') ? 0 : 1]++;
    if (kind === 'login') tally.loginLeft[(await web.evaluate(() => getComputedStyle(document.querySelector('.newsletter-popup')).display !== 'none').catch(() => false)) ? 0 : 1]++;
    if ((i + 1) % 50 === 0) {
      out.memory.push(Object.assign({ at: i + 1 }, memory()));
      console.log(`after ${i + 1}: ${JSON.stringify(tally, (k, v) => (k === 'settleMs' ? undefined : v))} memory ${JSON.stringify(out.memory[out.memory.length - 1])}`);
    }
  }
  sw = await worker();
  out.bytesEnd = await bytes();
  out.worker = await sw.evaluate(() => ({ tabs: tabs.size, consentBrokers: consentBrokers.size, hasSession: broker.hasSession, stats: Object.assign({}, broker.stats), consent: Object.assign({}, consentStats) }));
  const ms = tally.settleMs.sort((a, b) => a - b);
  out.tally = Object.assign({}, tally, { settleMs: undefined, settleMedianMs: ms[Math.floor(ms.length / 2)], settleP95Ms: ms[Math.floor(ms.length * 0.95)] });
  console.log('result', JSON.stringify(out.tally), 'worker', JSON.stringify(out.worker), 'bytes', JSON.stringify(out.bytesStart), '->', JSON.stringify(out.bytesEnd));
} catch (e) {
  out.error = String(e && e.stack || e);
  console.error(e);
} finally {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  server.close();
  if (browser) await browser.close().catch(() => {});
  chrome.kill();
  setTimeout(() => process.exit(0), 1000);
}
