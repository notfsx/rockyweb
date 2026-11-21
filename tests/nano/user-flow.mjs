// Local: the popup's "describe a change" as a real user meets it, against REAL Gemini Nano.
// A normal Chrome start, the extension loaded, Chrome left alone for a while, then the popup.
// Every LanguageModel call the popup makes is timed (availability, create, clone, prompt), the
// popup's own messages are recorded as they change, and Chrome's model process is sampled so a
// model unload shows up. After the first answer the popup is closed and opened again after
// growing idle gaps, to see whether Chrome unloads the model and what a reload costs.
// usage: node tests/nano/user-flow.mjs <extension dir> <profile> <out.json>
// env: RW_IDLE_BEFORE_S (default 300), RW_GAPS_S (default "180,480,900"), RW_RETRY_S (default 60),
//      RW_CAP_S (default 1500): how long a "user" keeps retrying before giving up.
//      RW_COST (default 1): once the model is warm, time what the page change instructions and the
//      answer format cost (prefill, clone, prompt with and without omitResponseConstraintInput).
import http from 'node:http';
import fs from 'node:fs';
import { launch, memory, sleep } from './cdp-pipe.mjs';

const [EXT, PROFILE, OUT] = process.argv.slice(2);
const IDLE_BEFORE = Number(process.env.RW_IDLE_BEFORE_S || 300) * 1000;
const GAPS = (process.env.RW_GAPS_S || '180,480,900').split(',').filter(Boolean).map((s) => Number(s) * 1000);
const RETRY = Number(process.env.RW_RETRY_S || 60) * 1000;
const CAP = Number(process.env.RW_CAP_S || 1500) * 1000;
const ASK = 'hide the bar asking me to download the app';
const LOG = OUT.replace(/\.json$/, '.log');
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 100) / 10;
const log = (s) => { const l = `+${secs()}s ${s}`; fs.appendFileSync(LOG, `${l}\n`); console.log(l); };

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Morning Ledger</title><style>
body{margin:0;font:16px/1.5 Arial,sans-serif} main{padding:16px 24px}
.appbar{position:fixed;left:0;right:0;bottom:0;height:64px;background:#123;color:#fff;display:flex;align-items:center;padding:0 24px}</style></head>
<body><main><article><h1>Town finally agrees on the new bridge</h1>${'<p>Councillors met late into the evening to argue about the new bridge and the cost of the works.</p>'.repeat(12)}</article></main>
<div class="appbar">Read faster in the Ledger app <a href="#" style="color:#fff;margin-left:12px">Open</a></div></body></html>`;
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://ledger.test:${server.address().port}/`;

// Times every LanguageModel call the popup makes, without changing what it does.
const TRACE = `(() => {
  if (window.__rwTrace) return 'already';
  const T = window.__rwTrace = [];
  const rec = (e) => T.push(Object.assign({ t: Math.round(performance.now()) }, e));
  const LM = window.LanguageModel;
  if (!LM) return 'no LanguageModel';
  const timed = (name, fn, extra) => (...args) => {
    const s = performance.now();
    rec(Object.assign({ ev: name + ':start' }, extra ? extra(args) : {}));
    return Promise.resolve(fn(...args)).then((v) => { rec({ ev: name + ':done', ms: Math.round(performance.now() - s) }); return v; },
      (e) => { rec({ ev: name + ':error', ms: Math.round(performance.now() - s), err: String(e && e.name) }); throw e; });
  };
  const wrapSession = (sn) => {
    if (!sn || sn.__rw) return sn;
    sn.__rw = true;
    const p = sn.prompt.bind(sn);
    sn.prompt = timed('prompt', p, (a) => ({ chars: String(a[0]).length }));
    if (typeof sn.clone === 'function') { const c = sn.clone.bind(sn); sn.clone = (...a) => timed('clone', c)(...a).then(wrapSession); }
    return sn;
  };
  const av = LM.availability.bind(LM);
  LM.availability = timed('availability', av);
  const cr = LM.create.bind(LM);
  LM.create = (opts) => {
    const o = Object.assign({}, opts);
    const mine = o.monitor;
    o.monitor = (m) => { m.addEventListener('downloadprogress', (e) => rec({ ev: 'progress', loaded: e.loaded })); if (mine) mine(m); };
    const ip = Array.isArray(o.initialPrompts) ? o.initialPrompts.reduce((n, x) => n + String(x.content).length, 0) : 0;
    return timed('create', cr, () => ({ initialChars: ip }))(o).then(wrapSession);
  };
  return 'ok';
})()`;

// Run in an extension page on a warm model. Same instructions, request and schema as the popup.
const COST = `(async () => {
  const RW = window.RockyShared;
  const R = { steps: [], prompts: [] };
  const t = () => performance.now();
  const outline = [
    { id: 'e1', kind: 'main content', area: 70, text: 'Town finally agrees on the new bridge' },
    { id: 'e2', kind: 'fixed bottom bar', area: 9, text: 'Read faster in the Ledger app Open' }];
  const req = RW.editRequest(${JSON.stringify(ASK)}, outline);
  const schema = RW.planWithEditsSchema();
  let a = t();
  const plain = await RW.aiCreate(LanguageModel, {});
  R.steps.push({ step: 'create, no instructions', ms: Math.round(t() - a), usage: plain.contextUsage, window: plain.contextWindow });
  a = t(); await plain.prompt('Reply with OK.'); R.steps.push({ step: 'short prompt', ms: Math.round(t() - a) });
  plain.destroy();
  for (const [name, ip] of [['plan instructions', RW.planInitialPrompts()], ['page change instructions', RW.editInitialPrompts()]]) {
    a = t();
    const s = await RW.aiCreate(LanguageModel, { initialPrompts: ip });
    R.steps.push({ step: 'create, ' + name, ms: Math.round(t() - a), chars: ip.reduce((n, x) => n + String(x.content).length, 0), usage: s.contextUsage, window: s.contextWindow });
    s.destroy();
  }
  const base = await RW.aiCreate(LanguageModel, { initialPrompts: RW.editInitialPrompts() });
  if (typeof base.measureContextUsage === 'function') {
    R.request = await base.measureContextUsage(req);
    R.requestWithSchema = await base.measureContextUsage(req, { responseConstraint: schema });
  }
  for (let i = 0; i < 12; i++) {
    const omit = i % 2 === 1;
    a = t(); const c = await base.clone(); const cloneMs = Math.round(t() - a);
    a = t();
    let out = '';
    try { out = await c.prompt(req, { responseConstraint: schema, omitResponseConstraintInput: omit }); } catch (e) { out = 'error ' + e.name; }
    let ok = false; try { const j = JSON.parse(out); ok = Array.isArray(j.edits) && j.edits.some((x) => x.op === 'hide' && x.target === 'e2'); } catch (_) {}
    R.prompts.push({ omit, cloneMs, promptMs: Math.round(t() - a), ok, out: out.slice(0, 160) });
    c.destroy();
  }
  base.destroy();
  return R;
})()`;

const out = { ext: EXT, started: new Date(t0).toISOString(), idleBeforeS: IDLE_BEFORE / 1000, attempts: [], reopen: [], memory: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const c = launch({ profile: PROFILE, args: ['--host-resolver-rules=MAP *.test 127.0.0.1'] });
let memTimer = 0;
try {
  await sleep(4000);
  const id = await c.loadExtension(EXT);
  log(`extension ${id}`);
  const modelMb = () => { try { return memory(PROFILE).on_device_model || 0; } catch (_) { return -1; } };
  let lastMb = null;
  let lastSw = null;
  memTimer = setInterval(async () => {
    const mb = modelMb();
    // Whether Rockyweb's service worker is running, from the target list (nothing attaches to it).
    const sw = await c.swTarget(id).then((t) => !!t, () => null);
    out.memory.push({ s: secs(), modelMb: mb, sw });
    if ((mb > 0) !== (lastMb > 0)) log(`model process ${mb > 0 ? `running, ${mb} MB` : 'not running'}`);
    if (sw !== lastSw) log(`service worker ${sw ? 'running' : 'stopped'}`);
    lastMb = mb;
    lastSw = sw;
  }, 15000);
  const site = await c.newPage('about:blank');
  await c.goto(site, SITE);
  log(`site open, waiting ${IDLE_BEFORE / 1000}s as a user would before opening the popup`);
  await sleep(IDLE_BEFORE);

  const tabId = async (pop) => c.evaluate(pop.sessionId, `chrome.tabs.query({}).then((ts) => ts.find((x) => (x.url || '').startsWith(${JSON.stringify(SITE)})).id)`);
  const openPopup = async () => {
    const pop = await c.newPage(`chrome-extension://${id}/popup.html`);
    await sleep(800);
    const tid = await tabId(pop);
    await c.goto(pop, `chrome-extension://${id}/popup.html?tabId=${tid}&view=advanced`);
    await sleep(800);
    await c.evaluate(pop.sessionId, TRACE);
    return pop;
  };
  const ev = (pop, js) => c.evaluate(pop.sessionId, js).catch((e) => ({ error: String(e.message || e) }));
  const openDescribe = (pop) => ev(pop, `(() => { const b = document.querySelector('.describe-toggle'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); return !!b; })()`);
  const typeAsk = (pop) => ev(pop, `(() => { const t = document.querySelector('.describe-input'); if (!t || t.disabled) return false; t.value = ${JSON.stringify(ASK)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const clickPreview = (pop) => ev(pop, `(() => { const b = [...document.querySelectorAll('.describe button')].find((x) => /^(preview|try again)$/.test(x.textContent.trim()) && !x.disabled); if (b) b.click(); return !!b; })()`);
  const read = (pop) => ev(pop, `(() => { const s = document.querySelector('.describe'); return { text: s ? s.innerText.replace(/\\s+/g, ' ').trim() : '', plan: !!document.querySelector('.describe .plan'), busy: !![...document.querySelectorAll('.describe button')].find((x) => x.disabled && /think|load|wait/i.test(x.textContent)), error: (document.querySelector('.describe [role=alert]') || {}).textContent || '', trace: window.__rwTrace || [] }; })()`);

  // One "describe" from click to a result or an error. Records every message the popup shows.
  async function describeOnce(pop, label, limitMs) {
    const start = Date.now();
    const seen = [];
    await openDescribe(pop);
    for (let i = 0; i < 30; i++) { if (await typeAsk(pop)) break; await sleep(1000); }
    await clickPreview(pop);
    let r = null;
    while (Date.now() - start < limitMs) {
      await sleep(1000);
      r = await read(pop);
      if (r.error && r.error.error) break;
      const msg = r.text.replace(ASK, '').slice(0, 300);
      if (!seen.length || seen[seen.length - 1].msg !== msg) seen.push({ s: Math.round((Date.now() - start) / 1000), msg });
      if (r.plan) break;
      if (r.error && !r.busy) break;
    }
    const res = { label, at: secs(), seconds: Math.round((Date.now() - start) / 100) / 10, ok: !!(r && r.plan), error: r && r.error, messages: seen, trace: r && r.trace };
    log(`${label}: ${res.ok ? 'answered' : 'no answer'} in ${res.seconds}s${res.error ? ` (${res.error})` : ''}`);
    return res;
  }

  // A user's experience: open the popup, ask, and retry after each failure until it works.
  let pop = await openPopup();
  const first = Date.now();
  while (Date.now() - first < CAP) {
    const r = await describeOnce(pop, `attempt ${out.attempts.length + 1}`, CAP - (Date.now() - first));
    out.attempts.push(r);
    save();
    if (r.ok) break;
    await sleep(RETRY);
    // A user closes and reopens the popup between tries.
    await c.send('Target.closeTarget', { targetId: pop.targetId }).catch(() => {});
    pop = await openPopup();
  }
  out.firstAnswerAfterS = Math.round((Date.now() - first) / 1000);
  out.firstAnswerAfterLaunchS = secs();
  // A second request in the same popup, model warm.
  await ev(pop, `(() => { const b = [...document.querySelectorAll('.describe button')].find((x) => x.textContent.trim() === 'cancel'); if (b) b.click(); })()`);
  out.warmSamePopup = await describeOnce(pop, 'same popup, warm', 120000);
  await c.send('Target.closeTarget', { targetId: pop.targetId }).catch(() => {});
  save();
  if (process.env.RW_COST !== '0') {
    const pg = await c.newPage(`chrome-extension://${id}/options.html`);
    await sleep(1500);
    out.promptCost = await c.evaluate(pg.sessionId, COST, 600000).catch((e) => ({ error: String(e.message || e) }));
    log(`prompt cost: ${JSON.stringify(out.promptCost).slice(0, 400)}`);
    await c.send('Target.closeTarget', { targetId: pg.targetId }).catch(() => {});
    save();
  }

  for (const gap of GAPS) {
    log(`popup closed, idle ${gap / 1000}s`);
    await sleep(gap);
    pop = await openPopup();
    const r = await describeOnce(pop, `reopened after ${gap / 1000}s idle`, CAP);
    r.gapS = gap / 1000;
    out.reopen.push(r);
    await c.send('Target.closeTarget', { targetId: pop.targetId }).catch(() => {});
    save();
  }
} catch (err) {
  out.error = String(err && err.stack || err);
  log(`error ${out.error}`);
} finally {
  clearInterval(memTimer);
  save();
  await c.close();
  server.close();
  log('done');
  process.exit(0);
}
