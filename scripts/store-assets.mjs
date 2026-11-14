#!/usr/bin/env node
// Renders Chrome Web Store images into store/: 1280x800 screenshots, 440x280 and 1400x560 promo tiles,
// and the 128px store icon. Uses the real extension UI against a local demo site (needs Playwright).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXT_DIR } from './load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(EXT_DIR, '..');
const OUT = path.join(ROOT, 'store');
const SHOTS = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (file) => fs.readFileSync(file).toString('base64');

// ---- demo website
const DEMO = `<!doctype html><html><head><meta charset="utf-8"><title>The Daily Bark</title><style>
  body { margin: 0; font: 16px/1.6 Georgia, serif; color: #222; background: #faf7f2; }
  header { padding: 18px 48px; border-bottom: 1px solid #e4ddd2; display: flex; justify-content: space-between; align-items: center; }
  header b { font: 700 26px Georgia, serif; } header nav { font: 14px sans-serif; color: #666; display: flex; gap: 22px; }
  main { display: grid; grid-template-columns: 1fr 300px; gap: 40px; padding: 32px 48px; }
  h1 { font-size: 38px; line-height: 1.15; margin: 0 0 12px; } .by { font: 13px sans-serif; color: #888; margin-bottom: 18px; }
  .hero { height: 220px; border-radius: 6px; background: linear-gradient(135deg, #d8b48c, #8f6a4a); margin-bottom: 18px; }
  .ad { display: grid; place-items: center; font: 600 13px sans-serif; color: #8a7a60; background: repeating-linear-gradient(45deg, #efe6d6, #efe6d6 10px, #e7dcc8 10px, #e7dcc8 20px); border: 1px dashed #cdbb9c; border-radius: 4px; }
  .side .ad { height: 250px; margin-bottom: 18px; } .card { font: 14px sans-serif; color: #555; padding: 12px 0; border-top: 1px solid #e4ddd2; }
  .cookie { position: fixed; left: 24px; right: 24px; bottom: 24px; padding: 18px 22px; background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.18); font: 14px sans-serif; display: flex; gap: 14px; align-items: center; z-index: 5; }
  .cookie p { flex: 1; margin: 0; } .cookie button { padding: 9px 14px; border-radius: 6px; border: 1px solid #ccc; background: #fff; font: 600 13px sans-serif; }
  .cookie button.primary { background: #222; color: #fff; border-color: #222; }
</style></head><body>
<header><b>The Daily Bark</b><nav><span>News</span><span>Walks</span><span>Treats</span><span>Opinion</span></nav></header>
<main><article><h1>Local spaniel finally catches the red ball after nine years of trying</h1>
<div class="by">By R. Spaniel · 4 min read</div><div class="hero"></div>
<p>Witnesses at the park described the moment as "unexpectedly graceful". The ball, which has evaded capture since 2017, was reportedly returned within seconds, slightly damp.</p>
<p>Experts caution that this does not mean the ball will be caught again any time soon, but the mood at the pond was celebratory.</p>
<div class="ad" id="inline-ad" style="height:90px;margin-top:18px">ADVERTISEMENT</div></article>
<aside class="side"><div class="ad promo-banner">ADVERTISEMENT</div><div class="card">Most read: the great sock heist</div><div class="card">Why tennis balls are the new currency</div><div class="card">Ten walks for rainy Tuesdays</div></aside></main>
<img src="http://pixel.adnetwork-sync.com:PORT/p.gif" alt="" width="1" height="1"><img src="http://cdn-metrics.com:PORT/m.gif" alt="" width="1" height="1">
<script src="http://securepubads.g.doubleclick.net:PORT/ad.js"></script><script src="http://www.google-analytics.com:PORT/analytics.js"></script>
<div class="cookie" id="cookies"><p>We use cookies to personalise content and analyse traffic. You can accept all cookies or manage your choices.</p>
<button>Cookie settings</button><button onclick="this.parentNode.remove()">Reject all</button><button class="primary" onclick="this.parentNode.remove()">Accept all</button></div>
</body></html>`;

const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.endsWith('.gif')) {
    res.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': 'uid=a8F3kL9qZx72Pp1w; Path=/' });
    res.end(GIF);
  } else if (url.endsWith('.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end('');
  } else {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(DEMO.replaceAll('PORT', String(server.address().port)));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const SITE = `http://thedailybark.test:${PORT}/`;

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-store-'));
const context = await chromium.launchPersistentContext(userDir, {
  headless: true,
  channel: 'chromium',
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server']
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const now = Date.now();
  const learned = {};
  for (const [d, n] of [['adnetwork-sync.com', 9], ['pixel-tracker.net', 7], ['audience-graph.io', 5], ['cdn-metrics.com', 4], ['social-share.example', 2]]) {
    learned[d] = { firstPartyHosts: Array.from({ length: n }, (_, i) => `site${i}.example`), learnedStatus: n >= 3 ? 'cookie_block' : 'allow', globalManualOverride: null, firstSeen: now, lastSeen: now };
  }
  await ext.evaluate((data) => chrome.runtime.sendMessage({ action: 'importSettings', payload: { data } }), JSON.stringify({
    globalDefaultTier: 'balanced',
    siteProfiles: {
      'github.com': { tier: 'consent_only', updatedAt: now - 86400e3 },
      'thedailybark.test': { tier: null, updatedAt: now - 3600e3, customCosmeticSelectors: ['div.promo-banner'] },
      'shop.example.com': { tier: 'strict', updatedAt: now - 5 * 86400e3 }
    },
    learnedTrackers: learned,
    stats: { totalPopupsHandled: 214, totalAdsBlocked: 5182, totalTrackersRestricted: 18940 }
  }));

  // Real UI captures (2x).
  const web = await context.newPage();
  await web.setViewportSize({ width: 1280, height: 800 });
  const t0 = Date.now();
  await web.goto(SITE, { waitUntil: 'commit' });
  await web.waitForFunction(() => !!document.querySelector('rockyweb-toast'), null, { timeout: 15000, polling: 100 });
  console.log(`toast after ${Date.now() - t0} ms`);
  await sleep(500);
  const pageWithToast = await web.screenshot();
  const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), SITE);

  async function popupShot(query, height) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 340, height });
    await p.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}${query}`);
    await sleep(700);
    const buf = await p.screenshot({ fullPage: true });
    await p.close();
    return buf;
  }
  const popupMain = await popupShot('', 300);
  const popupAdvanced = await popupShot('&view=advanced', 640);

  async function optionsShot(hash) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 1100, height: 700 });
    await p.goto(`chrome-extension://${extId}/options.html#${hash}`);
    await sleep(700);
    const buf = await p.screenshot();
    await p.close();
    return buf;
  }
  const optProtection = await optionsShot('protection');
  const optTrackers = await optionsShot('trackers');

  // Picker hovering an ad slot.
  await web.bringToFront();
  await ext.evaluate((t) => chrome.tabs.sendMessage(t, { action: 'startElementPicker', payload: {} }, { frameId: 0 }), tabId);
  const ad = await web.locator('#inline-ad').boundingBox();
  await web.mouse.move(ad.x + 40, ad.y + 30, { steps: 4 });
  await sleep(300);
  const pickerShot = await web.screenshot();

  // ---- composition
  const font = (w) => `@font-face { font-family: L; font-weight: ${w}; src: url(data:font/woff2;base64,${b64(path.join(EXT_DIR, 'ui', 'fonts', `lexend-deca-${w}.woff2`))}); }`;
  const BASE = `${font(400)} ${font(500)} * { box-sizing: border-box; } body { margin: 0; background: #1f1914; color: #f3e9dc; font-family: L, sans-serif; overflow: hidden; }
    .h { font-size: 44px; font-weight: 500; letter-spacing: -0.03em; line-height: 1.12; } .h em { font-style: normal; color: #e0975a; }
    .s { font-size: 19px; color: rgba(196,173,150,.85); line-height: 1.5; margin-top: 14px; }
    img.ui { display: block; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }`;
  const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const logo = `data:image/png;base64,${b64(path.join(EXT_DIR, 'icons', 'rocky.png'))}`;
  const composer = await context.newPage();

  async function compose(file, width, height, html) {
    await composer.setViewportSize({ width, height });
    await composer.setContent(`<!doctype html><html><head><style>${BASE}</style></head><body style="width:${width}px;height:${height}px">${html}</body></html>`);
    await composer.evaluate(() => document.fonts.ready);
    await sleep(150);
    await composer.screenshot({ path: file, scale: 'css' });
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }

  const split = (title, sub, right) => `
    <div style="display:flex;height:100%;align-items:center;gap:56px;padding:0 72px">
      <div style="flex:0 0 400px"><img src="${logo}" width="64" height="64" style="margin-bottom:26px"><div class="h">${title}</div><div class="s">${sub}</div></div>
      <div style="flex:1;display:flex;justify-content:center;align-items:center;gap:28px">${right}</div>
    </div>`;

  await compose(path.join(SHOTS, '1-cookie-popups.png'), 1280, 800, `
    <img src="${img(pageWithToast)}" style="position:absolute;inset:0;width:1280px;height:800px;filter:saturate(.9)">
    <img class="ui" src="${img(popupMain)}" style="position:absolute;top:20px;right:28px;width:340px">
    <div style="position:absolute;left:84px;top:262px;padding:22px 28px;border-radius:16px;background:rgba(31,25,20,.94);max-width:560px">
      <div class="h" style="font-size:34px">Cookie popups, <em>answered your way</em></div>
      <div class="s" style="font-size:16px;margin-top:8px">Your choices applied on every site. No more clicking "reject all".</div></div>`);

  await compose(path.join(SHOTS, '2-simple-by-default.png'), 1280, 800, split(
    'One switch per site. <em>The rest is one click away.</em>',
    'Protection mode and live stats up front. Per-engine controls and per-domain choices behind the gear.',
    `<img class="ui" src="${img(popupMain)}" style="width:340px;align-self:flex-start;margin-top:120px"><img class="ui" src="${img(popupAdvanced)}" style="width:340px">`));

  await compose(path.join(SHOTS, '3-hide-anything.png'), 1280, 800, `
    <img src="${img(pickerShot)}" style="position:absolute;inset:0;width:1280px;height:800px">
    <div style="position:absolute;right:40px;top:250px;padding:22px 28px;border-radius:16px;background:rgba(31,25,20,.94);max-width:380px">
      <div class="h" style="font-size:34px">Hide anything <em>with a click</em></div>
      <div class="s" style="font-size:16px;margin-top:8px">Point at a banner, click, done. Rockyweb remembers it for that site, and undo is one key away.</div></div>`);

  await compose(path.join(SHOTS, '4-settings.png'), 1280, 800, `
    <div style="padding:56px 72px 0"><div class="h" style="font-size:36px">Five modes, <em>you pick per site</em></div>
    <div class="s" style="font-size:17px;margin-top:8px">Off, consent only, balanced, strict or your own custom mix.</div></div>
    <img class="ui" src="${img(optProtection)}" style="position:absolute;left:90px;top:210px;width:1100px">`);

  await compose(path.join(SHOTS, '5-trackers.png'), 1280, 800, `
    <div style="padding:56px 72px 0"><div class="h" style="font-size:36px">Trackers <em>learned</em>, not just listed</div>
    <div class="s" style="font-size:17px;margin-top:8px">Anything that follows you across 3 sites loses its cookies. Everything stays on your device.</div></div>
    <img class="ui" src="${img(optTrackers)}" style="position:absolute;left:90px;top:210px;width:1100px">`);

  await compose(path.join(OUT, 'promo-small-440x280.png'), 440, 280, `
    <div style="display:flex;height:100%;align-items:center;gap:22px;padding:0 30px">
      <img src="${logo}" width="120" height="120">
      <div><div class="h" style="font-size:34px">rockyweb</div><div class="s" style="font-size:15px;margin-top:6px">Cookie popups answered.<br>Ads and trackers gone.</div></div></div>`);

  await compose(path.join(OUT, 'promo-marquee-1400x560.png'), 1400, 560, `
    <div style="display:flex;height:100%;align-items:center;gap:60px;padding:0 90px">
      <img src="${logo}" width="260" height="260">
      <div style="flex:1"><div class="h" style="font-size:58px">Browse like Rocky:<br><em>calm, curious, untracked</em></div>
      <div class="s" style="font-size:20px">Cookie popups answered your way, ads and trackers blocked, and a per-site switch for anything that misbehaves.</div></div>
      <img class="ui" src="${img(popupMain)}" style="width:300px"></div>`);

  fs.copyFileSync(path.join(EXT_DIR, 'icons', 'icon-128.png'), path.join(OUT, 'icon-128.png'));
  console.log('wrote store/icon-128.png');
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
