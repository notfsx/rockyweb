// Local: on-device AI turned on with "keep the model loaded" (its default), against REAL Gemini Nano.
// Chrome starts, Rockyweb loads, AI is turned on at once and every Rockyweb page is closed. Then: how
// long until the model is ready with nothing open, whether it stays loaded through long idle gaps,
// how quickly an article overlay is answered after each gap, what happens when Chrome stops the
// worker, and whether turning AI off lets the model go. The worker is attached for one evaluation
// at a time, and not at all during the idle gaps.
// usage: node tests/nano/keep-loaded.mjs <extension dir> <profile> <out.json>
// env: RW_GAPS_S (default "300,900,1800"), RW_WARM_CAP_S (default 1500), RW_OFF_WAIT_S (default 600),
//      NANO_CHROME_ARGS (extra Chrome switches, e.g. "--headless=new")
import http from 'node:http';
import fs from 'node:fs';
import { launch, sleep, memory, EXTRA_ARGS } from './cdp-pipe.mjs';

const [EXT, PROFILE, OUT] = process.argv.slice(2);
const GAPS = (process.env.RW_GAPS_S || '300,900,1800').split(',').filter(Boolean).map((s) => Number(s) * 1000);
const WARM_CAP = Number(process.env.RW_WARM_CAP_S || 1500) * 1000;
const OFF_WAIT = Number(process.env.RW_OFF_WAIT_S || 600) * 1000;
const T0 = Date.now();
const secs = () => Math.round((Date.now() - T0) / 100) / 10;
const out = { startedAt: new Date(T0).toISOString(), ext: EXT, chromeArgs: EXTRA_ARGS, gapsS: GAPS.map((g) => g / 1000), steps: [], samples: [] };
const save = () => fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
const step = (name, data) => { out.steps.push(Object.assign({ name, t: secs() }, data)); console.log(`[${secs()}s] ${name}`, JSON.stringify(data || {})); save(); };

const ARTICLE = '<article style="max-width:640px;margin:40px auto;font-family:sans-serif"><h1>Spaniel catches ball</h1>' +
  '<p>Witnesses described the moment as graceful. The ball was returned, slightly damp.</p>'.repeat(14) + '</article>';
const OVERLAY = '<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;border:1px solid #ccc;z-index:9"><h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p><input type="email" name="email" placeholder="Email address"><button>Subscribe</button><button aria-label="Close">×</button></div>';
const PAGE = `<!doctype html><html><body>${ARTICLE}<script>setTimeout(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(OVERLAY)});document.documentElement.style.overflow='hidden';}, 800);</script></body></html>`;
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const c = launch({ profile: PROFILE, args: ['--host-resolver-rules=MAP *.test 127.0.0.1'] });
const mem = () => { try { return memory(PROFILE); } catch (_) { return {}; } };
const modelMb = (m) => m.on_device_model || 0;
try {
  await sleep(2500);
  const id = await c.loadExtension(EXT);
  step('Rockyweb loaded', { id });
  const WORKER = `(async () => ({
    has: broker.hasSession, pinned: broker.pinned, pending: broker.pending,
    stats: Object.assign({}, broker.stats),
    note: (await chrome.storage.session.get('aiModelLoad')).aiModelLoad || null,
    alarm: !!(await chrome.alarms.get('rw-ai-keep'))
  }))()`;
  const worker = () => c.inWorker(id, WORKER).catch((e) => ({ error: String(e.message || e) }));
  const swRunning = async () => !!(await c.swTarget(id).catch(() => null));

  // Turn AI on from a settings page, as the user would, then close it.
  const opt = await c.newPage(`chrome-extension://${id}/options.html`);
  await sleep(1500);
  const availability = await c.evaluate(opt.sessionId, 'LanguageModel.availability(window.RockyShared.AI_MODEL_OPTIONS)').catch((e) => `error: ${e.message}`);
  step('availability in an extension page', { availability });
  if (availability !== 'available') { out.result = `model_${availability}`; save(); throw new Error(`model ${availability}`); }
  const send = (action, payload) => c.evaluate(opt.sessionId, `chrome.runtime.sendMessage(${JSON.stringify({ action, payload })})`);
  await send('setAiEnabled', { enabled: true });
  await send('setAiAutoOptimise', { enabled: true });
  await send('clearAiMemory', {});
  const enabledAt = secs();
  await c.send('Target.closeTarget', { targetId: opt.targetId }).catch(() => {});
  step('on-device AI turned on, settings closed', { enabledAt });

  // 1. Ready with nothing open: the extension loads the model by itself.
  let ready = null;
  for (const end = Date.now() + WARM_CAP; Date.now() < end && !ready;) {
    await sleep(30000);
    const w = await worker();
    const m = mem();
    out.samples.push({ t: secs(), phase: 'warming', modelMb: modelMb(m), sw: !w.notRunning, has: w.has, note: w.note });
    save();
    if (w.note && w.note.warm) ready = w;
  }
  if (!ready) { step('model never became ready', { capS: WARM_CAP / 1000 }); out.result = 'never_ready'; save(); throw new Error('never ready'); }
  step('model ready, loaded by Rockyweb with nothing open', {
    warm: ready.note.warm, secondsFromEnable: Math.round((ready.note.warmAt - ready.note.loadingSince) / 100) / 10,
    secondsFromChromeStart: Math.round((ready.note.warmAt - T0) / 100) / 10, has: ready.has, pinned: ready.pinned, alarm: ready.alarm, modelMb: modelMb(mem())
  });

  const site = await c.newPage('about:blank');
  const overlay = () => c.evaluate(site.sessionId, `(() => { const el = document.querySelector('.newsletter-popup'); return !el ? 'absent' : getComputedStyle(el).display === 'none' ? 'hidden' : 'shown'; })()`).catch(() => 'error');
  async function article(host) {
    const before = await worker();
    const t = Date.now();
    await c.goto(site, `http://${host}:${PORT}/article`);
    let state = 'absent';
    for (const end = Date.now() + 60000; Date.now() < end;) {
      state = await overlay();
      if (state === 'hidden') break;
      await sleep(250);
    }
    const seconds = Math.round((Date.now() - t) / 100) / 10;
    const after = await worker();
    const d = (k) => ((after.stats || {})[k] || 0) - ((before.stats || {})[k] || 0);
    await c.goto(site, 'about:blank');
    return { state, seconds, modelCalls: d('prompts'), timeouts: d('timeouts'), warming: d('warming'), sessionsMade: d('sessionsCreated'), touches: d('touches'), workerWasRunning: !before.notRunning };
  }

  const first = await article('warm1.test');
  step('article overlay once ready', first);

  // 2. Long idle gaps with nothing attached to the worker.
  let n = 0;
  for (const gap of GAPS) {
    n++;
    const end = Date.now() + gap;
    while (Date.now() < end) {
      await sleep(Math.min(30000, Math.max(0, end - Date.now())));
      out.samples.push({ t: secs(), phase: `idle ${gap / 1000}s`, modelMb: modelMb(mem()), sw: await swRunning() });
      save();
    }
    const gapSamples = out.samples.filter((s) => s.phase === `idle ${gap / 1000}s`);
    const r = await article(`gap${n}.test`);
    step(`article after ${gap / 1000} s idle`, Object.assign(r, {
      modelLoadedThroughout: gapSamples.every((s) => s.modelMb > 0), workerRunningThroughout: gapSamples.every((s) => s.sw),
      modelMbRange: [Math.min(...gapSamples.map((s) => s.modelMb)), Math.max(...gapSamples.map((s) => s.modelMb))]
    }));
  }

  // 3. Chrome stops the worker: the alarm should bring it back and load the model again.
  const swi = await c.newPage('chrome://serviceworker-internals/');
  await c.send('ServiceWorker.enable', {}, swi.sessionId).catch(() => {});
  const stopRes = await c.send('ServiceWorker.stopAllWorkers', {}, swi.sessionId).then(() => 'ok', (e) => String(e));
  await c.send('Target.closeTarget', { targetId: swi.targetId }).catch(() => {});
  await sleep(3000);
  step('worker stopped', { stopRes, running: await swRunning() });
  let back = null;
  for (let i = 0; i < 16 && !back; i++) {
    await sleep(10000);
    if (await swRunning()) back = secs();
    out.samples.push({ t: secs(), phase: 'after stop', modelMb: modelMb(mem()), sw: !!back });
  }
  step('worker back by itself', { back, modelMb: modelMb(mem()) });
  let rewarm = null;
  for (let i = 0; i < 40 && !rewarm; i++) {
    const w = await worker();
    if (w.has) rewarm = { t: secs(), note: w.note, alarm: w.alarm };
    else await sleep(15000);
  }
  step('model session held again after the restart', rewarm || { held: false });
  step('article after the worker restart', await article('restart.test'));

  // 4. Turning AI off lets the model go.
  const opt2 = await c.newPage(`chrome-extension://${id}/options.html`);
  await sleep(1000);
  await c.evaluate(opt2.sessionId, `chrome.runtime.sendMessage(${JSON.stringify({ action: 'setAiEnabled', payload: { enabled: false } })})`);
  await c.send('Target.closeTarget', { targetId: opt2.targetId }).catch(() => {});
  const off = await worker();
  step('on-device AI turned off', { has: off.has, pinned: off.pinned, alarm: off.alarm });
  let gone = null;
  for (const end = Date.now() + OFF_WAIT; Date.now() < end && gone === null;) {
    await sleep(30000);
    const mb = modelMb(mem());
    out.samples.push({ t: secs(), phase: 'after off', modelMb: mb, sw: await swRunning() });
    if (mb === 0) gone = secs();
  }
  step('model process after turning AI off', { goneAt: gone, waitedS: OFF_WAIT / 1000, modelMb: modelMb(mem()) });
  out.result = 'done';
  save();
} catch (e) {
  out.error = String(e && e.stack || e);
  save();
  console.error(e);
  process.exitCode = 1;
} finally {
  await c.close();
  server.close();
}
