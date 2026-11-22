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

// ---- demo website (one serif throughout)
const DEMO = `<!doctype html><html><head><meta charset="utf-8"><title>The Daily Bark</title><style>
  body { margin: 0; font: 17px/1.65 Georgia, "Times New Roman", serif; color: #2a2420; background: #fbf8f3; }
  .caps { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
  .mast { padding: 12px 48px 0; text-align: center; border-bottom: 3px double #2a2420; }
  .edition { display: flex; justify-content: space-between; color: #7a6d62; padding-bottom: 8px; border-bottom: 1px solid #e2d9cc; }
  .title { font-size: 42px; font-weight: 700; letter-spacing: -.01em; padding: 8px 0 4px; }
  nav { display: flex; justify-content: center; gap: 30px; color: #5d5148; padding: 6px 0 10px; }
  main { display: grid; grid-template-columns: 1fr 250px; gap: 52px; max-width: 1060px; margin: 0 auto; padding: 26px 48px; }
  .kicker { color: #a0522d; }
  h1 { font-size: 36px; line-height: 1.15; margin: 6px 0 10px; }
  .stand { font-style: italic; font-size: 19px; line-height: 1.5; color: #4a4038; margin: 0 0 12px; }
  .by { font-size: 13px; color: #7a6d62; padding-bottom: 14px; border-bottom: 1px solid #e2d9cc; margin-bottom: 16px; }
  p { margin: 0 0 14px; }
  .ad { display: grid; place-items: center; border: 1px solid #e2d9cc; background: #f3eee6; color: #9a8e82; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
  aside h2 { margin: 0; padding-bottom: 6px; border-bottom: 1px solid #2a2420; font-weight: 400; color: #7a6d62; }
  aside ol { list-style: none; margin: 0 0 20px; padding: 0; counter-reset: n; }
  aside li { counter-increment: n; display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #e2d9cc; font-size: 15px; line-height: 1.35; }
  aside li::before { content: counter(n); font-size: 22px; line-height: 1; color: #a0522d; }
  .side .ad { height: 250px; }
  .cookie { position: fixed; left: 24px; right: 24px; bottom: 24px; padding: 16px 20px; background: #fff; border: 1px solid #e2d9cc; border-radius: 6px; box-shadow: 0 8px 30px rgba(0,0,0,.14); font-size: 14px; display: flex; gap: 12px; align-items: center; z-index: 5; }
  .cookie p { flex: 1; margin: 0; } .cookie button { padding: 8px 14px; border-radius: 4px; border: 1px solid #cfc5b8; background: #fff; font: 14px Georgia, serif; }
  .cookie button.primary { background: #2a2420; color: #fff; border-color: #2a2420; }
</style></head><body>
<header class="mast"><div class="edition caps"><span>Summer 2019</span><span>Price: one tennis ball</span></div>
<div class="title">The Daily Bark</div>
<nav class="caps"><span>News</span><span>Walks</span><span>Treats</span><span>Sport</span><span>Opinion</span></nav></header>
<main><article><div class="kicker caps">Local news</div>
<h1>Harefield cocker spaniel evades capture, deflates another football</h1>
<p class="stand">Too big to carry, the ball was dealt with where it lay. Witnesses called the work quick and thorough.</p>
<div class="by">By our park correspondent · August 2019</div>
<p>It is the fourth football to go flat this summer. The suspect, a ginger cocker spaniel, was last seen trotting home with a tennis ball, which he is said to prefer.</p>
<div class="ad" id="inline-ad" style="height:90px;margin:30px 0 22px">Advertisement</div>
<p>Neighbours have stopped lending him theirs. Tennis balls, which fit, are returned with care and only slightly damp.</p></article>
<aside class="side"><h2 class="caps">Most read</h2><ol><li>Park reports football shortage, again</li><li>Tennis balls: the case for keeping a spare</li><li>Ten walks for rainy Tuesdays</li></ol>
<div class="ad promo-banner">Advertisement</div></aside></main>
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

// Browser window in the screenshots: the page area under the mock Chrome toolbar.
const WIN = { left: 60, top: 168, width: 1160, bars: 78 };
const PAGE_H = 800 - WIN.top - WIN.bars;

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
  const seed = {
    globalDefaultTier: 'balanced',
    // The optional confirmation note (off for new installs) makes the answered popup visible.
    globalCustomConfig: { showToastBadge: true },
    siteProfiles: {
      'github.com': { tier: 'consent_only', updatedAt: now - 86400e3 },
      'thedailybark.test': { tier: null, updatedAt: now - 3600e3, customCosmeticSelectors: ['div.promo-banner'] },
      'shop.example.com': { tier: 'strict', updatedAt: now - 5 * 86400e3 }
    },
    learnedTrackers: learned,
    stats: { totalPopupsHandled: 214, totalAdsBlocked: 5182, totalTrackersRestricted: 18940 }
  };
  await ext.evaluate((d) => chrome.runtime.sendMessage({ action: 'importSettings', payload: { data: d } }), JSON.stringify(seed));

  // Real UI captures (2x).
  const web = await context.newPage();
  await web.setViewportSize({ width: WIN.width, height: PAGE_H });
  const t0 = Date.now();
  await web.goto(SITE, { waitUntil: 'commit' });
  await web.waitForFunction(() => !!document.querySelector('rockyweb-toast'), null, { timeout: 15000, polling: 100 });
  console.log(`toast after ${Date.now() - t0} ms`);
  await sleep(500);
  const pageWithToast = await web.screenshot();
  const tabId = await ext.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(u)).id), SITE);
  const badge = await ext.evaluate(async (t) => ({
    text: await chrome.action.getBadgeText({ tabId: t }),
    colour: await chrome.action.getBadgeBackgroundColor({ tabId: t })
  }), tabId);

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

  // Picker hovering the inline ad slot.
  await web.bringToFront();
  await ext.evaluate((t) => chrome.tabs.sendMessage(t, { action: 'startElementPicker', payload: {} }, { frameId: 0 }), tabId);
  await web.evaluate(() => window.scrollTo(0, 150));
  const ad = await web.locator('#inline-ad').boundingBox();
  await web.mouse.move(ad.x + 40, ad.y + 30, { steps: 4 });
  await sleep(300);
  const pickerShot = await web.screenshot();
  await web.keyboard.press('Escape');

  // ---- composition
  const font = (w) => `@font-face { font-family: L; font-weight: ${w}; src: url(data:font/woff2;base64,${b64(path.join(EXT_DIR, 'ui', 'fonts', `lexend-deca-${w}.woff2`))}); }`;
  const BASE = `${font(400)} ${font(500)} * { box-sizing: border-box; } body { margin: 0; background: #1f1914; color: #f3e9dc; font-family: L, sans-serif; overflow: hidden; position: relative; }
    .h { font-size: 44px; font-weight: 500; letter-spacing: -0.03em; line-height: 1.12; } .h em { font-style: normal; color: #e0975a; }
    .s { font-size: 19px; color: rgba(196,173,150,.85); line-height: 1.5; margin-top: 14px; }
    .top { padding: 56px 72px 0; } .top .h { font-size: 36px; } .top .s { font-size: 17px; margin-top: 8px; }
    img.ui { display: block; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
    .win { position: absolute; left: ${WIN.left}px; top: ${WIN.top}px; width: ${WIN.width}px; height: ${800 - WIN.top + 20}px; border-radius: 12px 12px 0 0; overflow: hidden; background: #202124; box-shadow: 0 30px 80px rgba(0,0,0,.55); font-family: "Segoe UI", system-ui, sans-serif; }
    .tabs { height: 38px; display: flex; align-items: flex-end; gap: 8px; padding: 0 10px; color: #c4c7c5; }
    .tab { width: 230px; height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 8px 8px 0 0; background: #35363a; color: #e8eaed; font-size: 12px; }
    .tab .fav { width: 16px; height: 16px; border-radius: 3px; background: #fbf8f3; color: #2a2420; font: 700 11px/16px Georgia, serif; text-align: center; }
    .tab .x { margin-left: auto; color: #9aa0a6; }
    .wc { margin-left: auto; align-self: center; display: flex; gap: 26px; padding-right: 8px; font-size: 13px; }
    .bar { height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: #35363a; color: #c4c7c5; }
    .bar svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; position: relative; }
    .btn.on { background: rgba(255,255,255,.12); }
    .omni { flex: 1; height: 30px; margin: 0 6px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: 15px; background: #202124; color: #e8eaed; font-size: 14px; }
    .omni svg { width: 15px; height: 15px; color: #9aa0a6; }
    .btn img { width: 16px; height: 16px; }
    .badge { position: absolute; right: 0; bottom: 3px; min-width: 14px; height: 12px; padding: 0 3px; border-radius: 3px; color: #fff; font: 600 9px/12px "Segoe UI", sans-serif; text-align: center; }
    .avatar { width: 22px; height: 22px; border-radius: 50%; background: #c4ad96; }
    .win .page { display: block; width: ${WIN.width}px; }
    .win .popup { position: absolute; top: ${WIN.bars + 2}px; right: 96px; width: 340px; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }`;
  const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const logo = `data:image/png;base64,${b64(path.join(EXT_DIR, 'icons', 'rocky.png'))}`;
  const toolbarIcon = `data:image/png;base64,${b64(path.join(EXT_DIR, 'icons', 'icon-32.png'))}`;
  const svg = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const [r, g, b] = badge.colour || [0, 0, 0];

  // A Chrome window with Rockyweb pinned next to the extensions button.
  const browser = (page, popup) => `
    <div class="win">
      <div class="tabs"><div class="tab"><span class="fav">B</span>The Daily Bark<span class="x">&#x2715;</span></div><span style="align-self:center">+</span>
        <span class="wc"><span>&#x2014;</span><span>&#x25A1;</span><span>&#x2715;</span></span></div>
      <div class="bar">
        <span class="btn">${svg('M15 6l-6 6 6 6')}</span><span class="btn">${svg('M9 6l6 6-6 6')}</span><span class="btn">${svg('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7')}</span>
        <div class="omni">${svg('M4 8h10M18 8h2M4 16h2M10 16h10M16 6v4M8 14v4')}thedailybark.test</div>
        <span class="btn${popup ? ' on' : ''}"><img src="${toolbarIcon}" alt="">${badge.text ? `<b class="badge" style="background:rgb(${r},${g},${b})">${badge.text}</b>` : ''}</span>
        <span class="btn">${svg('M10 4a2 2 0 0 1 4 0v2h4v4h-2a2 2 0 0 0 0 4h2v4h-4v-2a2 2 0 0 0-4 0v2H6v-4h2a2 2 0 0 0 0-4H6V6h4z')}</span>
        <span class="btn"><span class="avatar"></span></span>
        <span class="btn">${svg('M12 5.5v.01M12 12v.01M12 18.5v.01')}</span>
      </div>
      <img class="page" src="${img(page)}" alt="">
      ${popup ? `<img class="popup" src="${img(popup)}" alt="">` : ''}
    </div>`;

  const composer = await context.newPage();

  async function compose(file, width, height, html) {
    await composer.setViewportSize({ width, height });
    await composer.setContent(`<!doctype html><html><head><style>${BASE}</style></head><body style="width:${width}px;height:${height}px">${html}</body></html>`);
    await composer.evaluate(() => document.fonts.ready);
    await sleep(150);
    await composer.screenshot({ path: file, scale: 'css' });
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }

  const heading = (title, sub) => `<div class="top"><div class="h">${title}</div><div class="s">${sub}</div></div>`;
  const split = (title, sub, right) => `
    <div style="display:flex;height:100%;align-items:center;gap:56px;padding:0 72px">
      <div style="flex:0 0 400px"><img src="${logo}" width="64" height="64" style="margin-bottom:26px"><div class="h">${title}</div><div class="s">${sub}</div></div>
      <div style="flex:1;display:flex;justify-content:center;align-items:center;gap:28px">${right}</div>
    </div>`;

  for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.rmSync(path.join(SHOTS, f));

  await compose(path.join(SHOTS, '1-cookie-banners.png'), 1280, 800,
    heading('Cookie banners <em>answered for you</em>', 'Set your choices once. Rockyweb applies them on each site, and the toolbar badge counts what it blocked.') +
    browser(pageWithToast, popupMain));

  await compose(path.join(SHOTS, '2-one-switch.png'), 1280, 800, split(
    'One switch <em>per site</em>',
    'The popup shows the mode and what was blocked. The gear opens the detailed controls.',
    `<img class="ui" src="${img(popupMain)}" style="width:340px;align-self:flex-start;margin-top:120px"><img class="ui" src="${img(popupAdvanced)}" style="width:340px">`));

  await compose(path.join(SHOTS, '3-hide-an-element.png'), 1280, 800,
    heading('Hide <em>part of a page</em>', 'Click a banner or box and it stays hidden on that site until you undo it.') +
    browser(pickerShot, null));

  await compose(path.join(SHOTS, '4-modes.png'), 1280, 800, `
    ${heading('Five modes, <em>set per site</em>', 'Off, consent only, balanced, strict, or a custom mix.')}
    <img class="ui" src="${img(optProtection)}" style="position:absolute;left:90px;top:210px;width:1100px">`);

  await compose(path.join(SHOTS, '5-trackers.png'), 1280, 800, `
    ${heading('Trackers <em>it notices as you browse</em>', 'A third-party domain seen on 3 or more sites loses its cookies. The list stays on your device.')}
    <img class="ui" src="${img(optTrackers)}" style="position:absolute;left:90px;top:210px;width:1100px">`);

  await compose(path.join(OUT, 'promo-small-440x280.png'), 440, 280, `
    <div style="display:flex;height:100%;align-items:center;gap:22px;padding:0 30px">
      <img src="${logo}" width="120" height="120">
      <div><div class="h" style="font-size:34px">rockyweb</div><div class="s" style="font-size:15px;margin-top:6px">Answers cookie banners.<br>Blocks ads and trackers.</div></div></div>`);

  await compose(path.join(OUT, 'promo-marquee-1400x560.png'), 1400, 560, `
    <div style="display:flex;height:100%;align-items:center;gap:60px;padding:0 90px">
      <img src="${logo}" width="260" height="260">
      <div style="flex:1"><div class="h" style="font-size:42px">Cookie banners answered,<br><em>ads and trackers blocked</em></div>
      <div class="s" style="font-size:20px">With a switch for each site, and everything kept on your device.</div>
      <div class="s" style="font-size:15px;margin-top:22px;opacity:.7">Named after Rocky, a cocker spaniel with strong views on tennis balls.</div></div>
      <img class="ui" src="${img(popupMain)}" style="width:300px"></div>`);

  fs.copyFileSync(path.join(EXT_DIR, 'icons', 'icon-128.png'), path.join(OUT, 'icon-128.png'));
  console.log('wrote store/icon-128.png');
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
