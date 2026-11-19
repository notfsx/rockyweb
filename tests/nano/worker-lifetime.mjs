// Local: real Nano with NO debugger kept on the service worker. Pages only; the worker is attached
// for a single evaluation at a time. usage: node tests/nano/worker-lifetime.mjs <extDir> <profile> <out>
import http from 'node:http';
import fs from 'node:fs';
import { launch, sleep, memory } from './cdp-pipe.mjs';

const [EXT, PROFILE, OUT] = process.argv.slice(2);
const out = { startedAt: new Date().toISOString(), steps: [] };
const step = (name, data) => { out.steps.push(Object.assign({ name, t: Math.round((Date.now() - T0) / 1000) }, data)); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${name}`, JSON.stringify(data)); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); };
const T0 = Date.now();

const ARTICLE = '<article style="max-width:640px;margin:40px auto"><h1>Spaniel catches ball</h1>' + '<p>Witnesses described the moment as graceful.</p>'.repeat(14) + '</article>';
const OVERLAY = '<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;border:1px solid #ccc;z-index:9"><h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p><input type="email" name="email" placeholder="Email address"><button>Subscribe</button><button aria-label="Close">×</button></div>';
const pages = {
  '/article': `<!doctype html><html><body>${ARTICLE}<script>setTimeout(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(OVERLAY)});document.documentElement.style.overflow='hidden';}, 800);</script></body></html>`,
  '/plain': `<!doctype html><html><body>${ARTICLE.replace('<article', '<main').replace('</article>', '</main>')}</body></html>`
};
const server = http.createServer((q, r) => { const b = pages[q.url.split('?')[0]]; r.writeHead(b ? 200 : 404, { 'content-type': 'text/html' }); r.end(b || ''); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const c = launch({ profile: PROFILE, args: ['--host-resolver-rules=MAP *.test 127.0.0.1'] });
try {
  await sleep(2500);
  const id = await c.loadExtension(EXT);
  await sleep(1500);
  const STATS = 'Object.assign({}, broker.stats, { hasSession: broker.hasSession, pending: broker.pending })';
  const setup = await c.inWorker(id, `(async () => {
    const fresh = (await (await fetch('engines/ai-broker.js')).text()).includes(self.RockyShared.createAiBroker.toString());
    await HANDLERS[A.SET_AI_AUTO_OPTIMISE].fn({ enabled: true });
    await HANDLERS[A.CLEAR_AI_MEMORY].fn({});
    return { fresh, autoOptimise: state.aiSettings.autoOptimise };
  })()`);
  step('extension loaded, AI on', { id, ...setup });

  // chrome://serviceworker-internals, read fresh each time
  const swi = await c.newPage();
  const swStatus = async () => {
    await c.goto(swi, 'chrome://serviceworker-internals/');
    await sleep(600);
    return c.evaluate(swi.sessionId, `(() => {
      const t = document.body.innerText; const i = t.indexOf('Scope: chrome-extension://${id}/');
      if (i < 0) return 'NOT_REGISTERED';
      const m = /Running Status: (\\w+)/.exec(t.slice(i)); return m ? m[1] : 'UNKNOWN';
    })()`);
  };
  const waitStopped = async (maxS) => {
    const t = Date.now();
    for (;;) {
      const s = await swStatus();
      if (s !== 'RUNNING') return { status: s, seconds: Math.round((Date.now() - t) / 1000) };
      if (Date.now() - t > maxS * 1000) return { status: s, seconds: Math.round((Date.now() - t) / 1000), gaveUp: true };
      await sleep(3000);
    }
  };

  const web = await c.newPage();
  const overlay = () => c.evaluate(web.sessionId, `(() => { const el = document.querySelector('.newsletter-popup'); return !el ? 'absent' : getComputedStyle(el).display === 'none' ? 'hidden' : 'shown'; })()`);
  const visit = async (host, waitMs) => {
    await c.send('Target.activateTarget', { targetId: web.targetId });
    const t = Date.now();
    await c.goto(web, `http://${host}:${PORT}/article`);
    let s = 'absent';
    let hiddenAt = null;
    while (Date.now() - t < waitMs) {
      s = await overlay().catch(() => 'error');
      if (s === 'hidden') { hiddenAt = Math.round((Date.now() - t) / 100) / 10; break; }
      await sleep(250);
    }
    return { state: s, hiddenAfterSeconds: hiddenAt };
  };

  const ODI_JS = String(function () { const walk = (n) => { let t = ''; for (const k of n.childNodes) { if (k.nodeType === 3) t += k.textContent; else if (k.nodeType === 1) { if (k.shadowRoot) t += ' ' + walk(k.shadowRoot); t += walk(k); if (['DIV', 'P', 'TR', 'LI', 'H1', 'H2', 'H3'].includes(k.tagName)) t += String.fromCharCode(10); } } return t; }; return walk(document.body).slice(0, 6000); });
  const odi = async () => { await c.goto(swi, 'chrome://on-device-internals/'); await sleep(2500); return c.evaluate(swi.sessionId, `(${ODI_JS})()`); };
  out.odiStart = await odi();
  step('worker status at start', { status: await swStatus() });

  // (b) cold start, no debugger on the worker
  const cold = await visit('cold.test', 40000);
  step('(b) cold article, no debugger', { ...cold, worker: await c.inWorker(id, STATS), mem: memory(PROFILE) });

  // (c) the worker is stopped while a cold request is pending
  await c.send('Target.activateTarget', { targetId: web.targetId });
  await c.goto(web, `http://cold2.test:${PORT}/article`);
  await sleep(9000);
  const before = await c.inWorker(id, STATS);
  await c.send('ServiceWorker.enable', {}, swi.sessionId).catch(() => {});
  const stopRes = await c.send('ServiceWorker.stopAllWorkers', {}, swi.sessionId).then(() => 'stopAllWorkers ok', (e) => String(e));
  await sleep(3000);
  const afterStop = { status: await swStatus(), overlay: await overlay() };
  await sleep(15000);
  step('(c) worker stopped during a pending cold request', { pendingBefore: before.pending, stopRes, afterStop, overlayLater: await overlay() });

  // warm the model from an extension page (harness only), then close it
  const opt = await c.newPage(`chrome-extension://${id}/options.html`);
  await sleep(1500);
  const warm = await c.evaluate(opt.sessionId, `(async () => {
    const t = performance.now(); const s = await LanguageModel.create(Object.assign({}, RockyShared.AI_MODEL_OPTIONS));
    const c = performance.now() - t; await s.prompt('Reply with OK.'); s.destroy();
    return { createSeconds: Math.round(c / 100) / 10, firstInferenceSeconds: Math.round((performance.now() - t - c) / 100) / 10 };
  })()`, 1200000);
  await c.send('Target.closeTarget', { targetId: opt.targetId });
  step('model warmed by the harness from an extension page', warm);
  out.odiWarm = await odi();

  // (a) and (c): several cycles of "wait until Chrome stops the idle worker, then a decision"
  for (let i = 1; i <= 3; i++) {
    await c.goto(web, 'about:blank');
    const stopped = await waitStopped(240);
    const memStopped = memory(PROFILE);
    const v = await visit(`warm${i}.test`, 30000);
    await sleep(500);
    const w = await c.inWorker(id, STATS);
    step(`(a) cycle ${i}: decision after Chrome stopped the idle worker`, { stopped, ...v, worker: w, memStopped, memAfter: memory(PROFILE) });
  }
  // ordinary page: zero calls
  const p0 = await c.inWorker(id, STATS);
  await c.goto(web, `http://quiet.test:${PORT}/plain`);
  await sleep(6000);
  const p1 = await c.inWorker(id, STATS);
  step('ordinary page', { modelCalls: (p1.prompts || 0) - (p0.prompts || 0), p0, p1 });
  out.result = 'done';
} catch (e) {
  out.error = String(e.stack || e);
  console.error(e);
} finally {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  await c.close();
  server.close();
  process.exit(0);
}
