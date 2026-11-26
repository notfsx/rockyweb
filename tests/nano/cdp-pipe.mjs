// Minimal CDP client over --remote-debugging-pipe. Never auto-attaches to anything.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

export const CHROME = process.env.ROCKYWEB_NANO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Extra Chrome switches, e.g. NANO_CHROME_ARGS="--headless=new" to run without a window.
export const EXTRA_ARGS = (process.env.NANO_CHROME_ARGS || '').split(' ').filter(Boolean);

export function launch({ profile, args = [], url = 'about:blank' }) {
  const chrome = spawn(CHROME, [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', ...EXTRA_ARGS, ...args, url], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let buf = '';
  let n = 0;
  const waiting = new Map();
  const listeners = [];
  chrome.stdio[4].on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else for (const l of listeners) l(m);
    }
  });
  const send = (method, params = {}, sessionId, timeout = 30000) => new Promise((resolve, reject) => {
    const id = ++n;
    const t = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
    waiting.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
    chrome.stdio[3].write(`${JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })}\0`);
  });
  const api = {
    chrome,
    send,
    on: (fn) => listeners.push(fn),
    async targets() { return (await send('Target.getTargets')).targetInfos; },
    async attach(targetId) { return (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId; },
    async detach(sessionId) { await send('Target.detachFromTarget', { sessionId }).catch(() => {}); },
    async evaluate(sessionId, expression, timeout = 30000) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeout);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    },
    // Load extension/ fresh: Chrome keeps a cached worker on a plain load, so uninstall and load again.
    async loadExtension(dir) {
      const a = await send('Extensions.loadUnpacked', { path: dir });
      await send('Extensions.uninstall', { id: a.id }).catch(() => {});
      await sleep(1000);
      return (await send('Extensions.loadUnpacked', { path: dir })).id;
    },
    async swTarget(extId) {
      return (await api.targets()).find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`) || null;
    },
    // Attach to the worker for one evaluation only, then detach.
    async inWorker(extId, expression) {
      const t = await api.swTarget(extId);
      if (!t) return { notRunning: true };
      const s = await api.attach(t.targetId);
      try { return await api.evaluate(s, expression); } finally { await api.detach(s); }
    },
    async newPage(url = 'about:blank') {
      const { targetId } = await send('Target.createTarget', { url });
      const sessionId = await api.attach(targetId);
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      return { targetId, sessionId };
    },
    async goto(page, url) {
      await send('Page.navigate', { url }, page.sessionId);
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        const s = await api.evaluate(page.sessionId, 'document.readyState + "|" + location.href').catch(() => '');
        if (s.startsWith('complete|') && s.includes(url.split('#')[0].replace(/\/$/, ''))) return;
      }
    },
    async close() { await send('Browser.close').catch(() => {}); await sleep(1500); try { chrome.kill(); } catch (_) {} }
  };
  return api;
}

// Windows memory of this profile's Chrome processes, grouped by process type (private MB).
export function memory(profile) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { [pscustomobject]@{ priv=$_.PrivatePageCount; cmd=$_.CommandLine } } | ConvertTo-Json -Compress`;
  const rows = [].concat(JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }) || '[]'));
  const g = {};
  for (const r of rows) {
    const type = (/--type=(\S+)/.exec(r.cmd) || [0, 'browser'])[1];
    const sub = (/--utility-sub-type=(\S+)/.exec(r.cmd) || [0, ''])[1];
    const k = sub ? sub.split('.')[0] : type + (/--extension-process/.test(r.cmd) ? ':extension' : '');
    g[k] = (g[k] || 0) + Math.round(r.priv / 2 ** 20);
  }
  return g;
}
