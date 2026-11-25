// Local: Rockyweb allowed in Incognito, checked in a real private window (chrome.windows.create
// incognito:true). usage: node tests/nano/incognito.mjs <extDir> <profile> <out>
import http from 'node:http';
import fs from 'node:fs';
import { launch, sleep } from './cdp-pipe.mjs';

const [EXT, PROFILE, OUT] = process.argv.slice(2);
const out = { steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
const ARTICLE = '<article style="max-width:640px;margin:40px auto"><h1>Spaniel catches ball</h1>' + '<p>Witnesses described the moment as graceful.</p>'.repeat(14) + '</article>';
const OVERLAY = '<div class="newsletter-popup klaviyo-form" role="dialog" style="position:fixed;top:25%;left:30%;width:40%;padding:24px;background:#fff;z-index:9"><h2>Join our newsletter</h2><p>Get the best stories in your inbox every week.</p><input type="email" name="email"><button>Subscribe</button><button aria-label="Close">×</button></div>';
let PORT;
const server = http.createServer((q, r) => {
  const p = q.url.split('?')[0];
  if (p === '/p.gif') { r.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': 'uid=a8F3kL9qZx72Pp1w; Path=/; SameSite=None' }); r.end(GIF); return; }
  r.writeHead(200, { 'content-type': 'text/html' });
  if (p === '/learn') r.end(`<!doctype html><p>learn</p><img src="http://pixel.tracker-inc.test:${PORT}/p.gif">`);
  else if (p === '/learn-normal') r.end(`<!doctype html><p>learn</p><img src="http://pixel.tracker-normal.test:${PORT}/p.gif">`);
  else r.end(`<!doctype html><body>${ARTICLE}<script>setTimeout(function(){document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(OVERLAY)});document.documentElement.style.overflow='hidden';}, 800);</script></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;

const c = launch({ profile: PROFILE, args: ['--host-resolver-rules=MAP *.test 127.0.0.1'] });
try {
  await sleep(2500);
  const id = await c.loadExtension(EXT);
  await sleep(1500);
  // Allow in Incognito through the extensions page (Chrome reloads the extension).
  const oldWorker = (await c.swTarget(id) || {}).targetId;
  const ext = await c.newPage('chrome://extensions/');
  await sleep(1500);
  // Developer mode on, as a user loading an unpacked extension would have it.
  const dev = await c.evaluate(ext.sessionId, `new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.developerPrivate.getProfileConfiguration((p) => r(p.inDeveloperMode))))`);
  step('developer mode', { on: dev });
  await sleep(1000);
  const allowed = await c.evaluate(ext.sessionId, `new Promise((r) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: '${id}', incognitoAccess: true }, () => chrome.developerPrivate.getExtensionInfo('${id}', (i) => r(i.incognitoAccess))))`);
  step('allowed in Incognito', { allowed });
  await sleep(3000);
  // Keep one session on the worker for this test, to count every broker request.
  let t = null;
  // Wake the reloaded worker from an extension page, then attach to whichever worker answers.
  // Chrome disables the extension for a few seconds while it reloads it.
  for (let i = 0; i < 60; i++) {
    const st = await c.evaluate(ext.sessionId, `new Promise((r) => chrome.developerPrivate.getExtensionInfo('${id}', (i) => r(i.state)))`);
    if (st === 'ENABLED') { step('enabled again', { afterS: i / 2 }); break; }
    await sleep(500);
  }
  await sleep(1000);
  await c.newPage(`chrome-extension://${id}/popup.html`);
  let sw = null;
  for (let i = 0; i < 30 && !sw; i++) {
    const all = (await c.targets()).filter((x) => x.type === 'service_worker' && x.url === `chrome-extension://${id}/background.js`);
    if (i === 0) step('workers after reload', { n: all.length, sameAsBefore: all.map((x) => x.targetId === oldWorker) });
    for (const x of all.reverse()) {
      const s = await c.attach(x.targetId).catch(() => null);
      if (!s) continue;
      await c.send('Runtime.runIfWaitingForDebugger', {}, s, 3000).catch(() => {});
      const info = await c.send('Target.getTargetInfo', { targetId: x.targetId }, undefined, 3000).catch((e) => String(e));
      if (i % 5 === 0) console.log('info', JSON.stringify(info).slice(0, 300));
      const ok = await c.evaluate(s, 'typeof HANDLERS === "object"', 4000).catch((e) => { if (i % 5 === 0) console.log('try', i, String(e).slice(0, 120)); return false; });
      if (!ok && i === 10) await c.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
      if (ok) { sw = s; break; }
      await c.detach(s);
    }
    if (!sw) await sleep(1000);
  }
  if (!sw) throw new Error('no answering worker after the reload');
  const W = (expr) => c.evaluate(sw, expr);
  await W(`(async () => {
    await HANDLERS[A.SET_AI_ENABLED].fn({ enabled: true });
    await HANDLERS[A.SET_AI_AUTO_OPTIMISE].fn({ enabled: true });
    await HANDLERS[A.CLEAR_AI_MEMORY].fn({});
    self.__requests = [];
    const p = broker.prompt; broker.prompt = (j) => { self.__requests.push(j.key); return p(j); };
    self.__asks = [];
    const h = HANDLERS[A.AI_EVALUATE_CANDIDATE], f = h.fn;
    h.fn = async (q, sender) => { const r = await f(q, sender); self.__asks.push({ incognito: !!(sender.tab && sender.tab.incognito), reason: r.reason || r.outcome }); return r; };
    return true;
  })()`);

  // A real private window, opened by the extension itself.
  const win = await W(`chrome.windows.create({ incognito: true, url: 'http://inc-news.test:${PORT}/article' }).then((w) => ({ id: w.id, incognito: w.incognito, tabId: w.tabs[0].id }))`);
  step('private window opened', win);
  await sleep(9000);
  const navigate = (url) => W(`chrome.tabs.update(${win.tabId}, { url: '${url}' }).then(() => new Promise((r) => setTimeout(r, 3500)))`);
  for (const s of ['inc1.test', 'inc2.test', 'inc3.test', 'inc4.test']) await navigate(`http://${s}:${PORT}/learn`);
  const incSession = await W(`chrome.storage.session.get(null).then((s) => JSON.stringify(s))`);
  const afterInc = await W(`({ requests: self.__requests.length, asks: self.__asks.length, prompts: broker.stats.prompts,
    learned: Object.keys(state.learnedTrackers || {}), tabRecord: tabs.has(${win.tabId}) ? Object.assign({}, tabs.get(${win.tabId}), { domains: undefined }) : null })`);
  step('after browsing in the private window', {
    modelRequests: afterInc.requests, aiAsksFromPrivateTab: afterInc.asks, learned: afterInc.learned, inMemoryTabRecord: afterInc.tabRecord,
    sessionHasPrivateTab: incSession.includes(`"${win.tabId}"`), sessionMentionsPrivateSites: /inc[0-9-]|tracker-inc/.test(incSession), sessionBytes: incSession.length
  });

  // Controls in a normal window: the same pages do reach the model and do teach a tracker.
  const nw = await W(`chrome.windows.create({ incognito: false, focused: true, url: 'http://normal-news.test:${PORT}/article' }).then((w) => ({ incognito: w.incognito, tabId: w.tabs[0].id }))`);
  step('normal window opened', nw);
  const nt = nw.tabId;
  await sleep(9000);
  for (const s of ['n1.test', 'n2.test', 'n3.test', 'n4.test']) { await W(`chrome.tabs.update(${nt}, { url: 'http://${s}:${PORT}/learn-normal' }).then(() => new Promise((r) => setTimeout(r, 3500)))`); }
  await sleep(4000);
  const afterNormal = await W(`({ requests: self.__requests.length, asks: self.__asks, learned: Object.keys(state.learnedTrackers || {}) })`);
  step('control in a normal window', { modelRequests: afterNormal.requests - afterInc.requests, aiAsks: afterNormal.asks, learned: afterNormal.learned });

  await W(`new Promise((r) => setTimeout(r, 3000))`);
  const session = await W(`chrome.storage.session.get(null).then((s) => JSON.stringify(s))`);
  const exported = await W(`HANDLERS[A.EXPORT_SETTINGS].fn({}).then((r) => JSON.stringify(r.data))`);
  const stored = await W(`chrome.storage.local.get(null).then((s) => JSON.stringify(s))`);
  step('storage and export', {
    sessionHasPrivateTab: session.includes(`"${win.tabId}"`), sessionMentionsPrivateSites: /inc[0-9-]|tracker-inc/.test(session),
    sessionMentionsNormalSites: /n[1-4]\.test|normal-news/.test(session),
    exportMentionsPrivateSites: /inc[0-9-]\.test|inc-news|tracker-inc/.test(exported), exportMentionsNormalTracker: /tracker-normal/.test(exported),
    localMentionsPrivateSites: /inc[0-9-]\.test|inc-news|tracker-inc/.test(stored), exportBytes: exported.length
  });
  out.exportStats = JSON.parse(exported).stats;
  await c.detach(sw);
} catch (e) { out.error = String(e.stack || e); console.error(e); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
await c.close(); server.close(); process.exit(0);
