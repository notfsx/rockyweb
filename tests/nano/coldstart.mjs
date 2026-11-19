// Local: how long the first Nano inference takes after a Chrome start, with and without debugging.
// A localhost page (where Chrome exposes LanguageModel) times create() and prompt() and posts back.
// usage: node tests/nano/coldstart.mjs <profile> <out> <mode...>   modes: plain | pipe
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { launch, CHROME, sleep } from './cdp-pipe.mjs';

const [PROFILE, OUT, ...MODES] = process.argv.slice(2);
const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const PAGE = `<!doctype html><title>cold start</title><pre id="o">running</pre><script>
const post = (d) => fetch('/report', { method: 'POST', body: JSON.stringify(Object.assign({ at: Date.now() }, d)) });
post({ event: 'loaded' });
(async () => {
  const opts = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  const t0 = performance.now();
  const availability = await LanguageModel.availability(opts);
  const t1 = performance.now();
  post({ event: 'availability', availability, visible: document.visibilityState });
  const s = await LanguageModel.create(Object.assign({ monitor(m) { m.addEventListener('downloadprogress', (e) => post({ event: 'progress', loaded: e.loaded })); } }, opts));
  const t2 = performance.now();
  post({ event: 'created', createMs: Math.round(t2 - t1) });
  await s.prompt('Reply with OK.');
  const t3 = performance.now();
  const t4b = performance.now(); await s.prompt('Reply with OK again.'); const t4 = performance.now();
  s.destroy();
  post({ event: 'done', availability, availabilityMs: Math.round(t1 - t0), createMs: Math.round(t2 - t1), firstPromptMs: Math.round(t3 - t2), secondPromptMs: Math.round(t4 - t4b) });
  document.getElementById('o').textContent = 'done';
})().catch((e) => post({ event: 'error', error: String(e) }));
</script>`;

let waiter = null;
let runStart = Date.now();
const LOG = OUT.replace(/\.json$/, '.log');
const logl = (t) => fs.appendFileSync(LOG, `${new Date().toISOString()} +${Math.round((Date.now() - runStart) / 1000)}s ${t}
`);
const server = http.createServer((req, res) => {
  logl(`${req.method} ${req.url}`);
  if (req.url === '/report') {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { res.end('ok'); logl(b); if (waiter) waiter(JSON.parse(b)); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://localhost:${server.address().port}/`;
const next = (pred, ms) => new Promise((resolve) => {
  const t = setTimeout(() => { waiter = null; resolve({ event: 'gave_up' }); }, ms);
  waiter = (m) => { if (pred(m)) { clearTimeout(t); waiter = null; resolve(m); } };
});

function closeProfileChrome() {
  // Graceful close of this profile's browser process only (no /F), then wait for it to go.
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(PROFILE)}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`;
  const pids = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
  for (const pid of pids) { try { execFileSync('taskkill', ['/PID', pid], { stdio: 'ignore' }); } catch (_) { /* gone */ } }
}
async function waitGone() {
  for (let i = 0; i < 60; i++) {
    const ps = `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(PROFILE)}*' }).Count`;
    if (Number(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim() || 0) === 0) return true;
    await sleep(1000);
  }
  return false;
}

for (const mode of MODES) {
  await waitGone();
  const started = Date.now(); runStart = started; logl(`launch ${mode}`);
  let c = null;
  const loaded = next((m) => m.event === 'loaded', 120000);
  if (mode === 'plain') spawn(CHROME, [`--user-data-dir=${PROFILE}`, URL_], { stdio: 'ignore', detached: true }).unref();
  else c = launch({ profile: PROFILE, url: URL_ });
  const l = await loaded;
  const done = await next((m) => m.event === 'done' || m.event === 'error', 1500000);
  const r = { mode, when: new Date(started).toISOString(), pageLoadedAfterS: Math.round((l.at - started) / 100) / 10, ...done, firstInferenceReadyAfterLaunchS: done.at ? Math.round((done.at - started) / 1000) : null };
  results.push(r);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(r));
  if (c) await c.close(); else closeProfileChrome();
  await waitGone();
  await sleep(3000);
}
server.close();
process.exit(0);
