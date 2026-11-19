#!/usr/bin/env node
// Upgrade in place: install the 1.0.0 build (git 97f0aa6) unpacked, make non-default choices, replace
// the files with the current build in the same folder, reload, and check every choice survived and
// the stored schema was migrated. Needs git and Playwright's Chromium.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EXT_DIR, loadShared } from '../../scripts/load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const RW = loadShared();
const ROOT = path.resolve(EXT_DIR, '..');
const OLD = '97f0aa64fee703affa1e5e33a2fa951b12da4fba';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-upgrade-'));
const live = path.join(work, 'live');
fs.mkdirSync(live);
// Shallow clones (CI) lack the old commit: fetch just that one.
try { execSync(`git cat-file -e ${OLD}^{commit}`, { cwd: ROOT, stdio: 'ignore' }); } catch {
  execSync(`git fetch --quiet --depth=1 origin ${OLD}`, { cwd: ROOT, stdio: 'inherit' });
}
execSync(`git archive ${OLD} extension | tar -x -C "${live.replace(/\\/g, '/')}"`, { cwd: ROOT, shell: 'bash' });
const LIVE_EXT = path.join(live, 'extension');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><body><h1>Upgrade</h1><div class="promo-strip">Hide me</div><p>Text.</p></body>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${LIVE_EXT}`, `--load-extension=${LIVE_EXT}`, '--host-resolver-rules=MAP *.test 127.0.0.1']
});
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
};

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  // What chrome://extensions knows, for diagnosing a reload that did not come back.
  const extensionsInfo = async () => {
    const p = await context.newPage();
    try {
      await p.goto('chrome://extensions');
      return await p.evaluate(async () => JSON.stringify((await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }))
        .map((x) => ({ id: x.id, version: x.version, state: x.state, disableReasons: x.disableReasons, manifestErrors: x.manifestErrors, runtimeErrors: (x.runtimeErrors || []).map((r) => r.message) })), null, 1));
    } catch (e) { return `no extension info: ${e.message}`; } finally { await p.close().catch(() => {}); }
  };
  // A reload leaves the extension disabled for a while, so retry until the page loads.
  const openOptions = async () => {
    const p = await context.newPage();
    for (let i = 0; ; i++) {
      try { await p.goto(`chrome-extension://${extId}/options.html`); return p; } catch (e) {
        if (i >= 60) { console.error(await extensionsInfo()); throw e; }
        await sleep(500);
      }
    }
  };
  let ext = await openOptions();
  const msg = (action, payload) => ext.evaluate(([a, p]) => chrome.runtime.sendMessage({ action: a, payload: p }), [action, payload || {}]);
  const A = RW.ACTIONS;

  const v0 = await ext.evaluate(() => chrome.runtime.getManifest().version);
  console.log(`installed ${v0} from ${OLD}`);
  // Non-default choices, using only actions 1.0.0 had.
  const now = Date.now();
  await msg(A.IMPORT_SETTINGS, { data: JSON.stringify({
    learnedTrackers: { 'pixel-tracker.net': { firstPartyHosts: ['a.example', 'b.example', 'c.example'], learnedStatus: 'cookie_block', globalManualOverride: null, firstSeen: now, lastSeen: now } },
    stats: { totalPopupsHandled: 7, totalAdsBlocked: 70, totalTrackersRestricted: 700 }
  }) });
  await msg(A.SET_SITE_TIER, { siteKey: 'strict.test', tier: 'strict' });
  await msg(A.SET_SITE_TIER, { siteKey: 'paused.test', tier: 'off' });
  await msg(A.SET_SITE_CUSTOM_OPTION, { siteKey: 'mix.test', key: 'stripUrlParams', value: false });
  await msg(A.SET_SITE_CUSTOM_OPTION, { siteKey: 'mix.test', key: 'aggressiveFiltering', value: true });
  await msg(A.ADD_COSMETIC_SELECTOR, { siteKey: 'hide.test', selector: 'div.promo-strip' });
  await msg(A.SET_DOMAIN_SLIDER, { siteKey: 'slider.test', domain: 'cdn-metrics.com', value: 'allow' });
  await msg(A.SET_TRACKER_GLOBAL_OVERRIDE, { domain: 'pixel-tracker.net', value: 'block' });
  await msg(A.SET_GLOBAL_CUSTOM_OPTION, { key: 'showToastBadge', value: true });
  await msg(A.SET_GLOBAL_CUSTOM_OPTION, { key: 'consentCategories', value: { necessary: true, functional: false, analytics: true, marketing: false } });
  await sleep(1500);
  const before = await ext.evaluate(() => chrome.storage.local.get(null));

  // Replace the files in place, as "Load unpacked" users do, and reload. Such users have developer
  // mode on; without it Chrome disables an unpacked extension on reload.
  const dev = await context.newPage();
  await dev.goto('chrome://extensions');
  await dev.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  await dev.close();
  fs.rmSync(LIVE_EXT, { recursive: true, force: true });
  fs.cpSync(EXT_DIR, LIVE_EXT, { recursive: true, filter: (src) => !src.includes('_metadata') });
  const nextWorker = context.waitForEvent('serviceworker', { timeout: 20000 });
  await ext.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await nextWorker.catch(() => null);
  await sleep(1500);
  ext = await openOptions();
  const v1 = await ext.evaluate(() => chrome.runtime.getManifest().version);
  console.log(`reloaded as ${v1}`);
  const after = await ext.evaluate(() => chrome.storage.local.get(null));

  await check('version changed in place, same extension id', async () => {
    assert.equal(v0, '1.0.0');
    assert.equal(v1, JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version);
  });
  await check('schema migrated', async () => {
    assert.equal(before.schemaVersion, 1);
    assert.equal(after.schemaVersion, RW.SCHEMA_VERSION);
  });
  await check('site modes, custom mix, hidden elements and domain choices kept', async () => {
    const sp = after.siteProfiles;
    assert.equal(sp['strict.test'].tier, 'strict');
    assert.equal(sp['paused.test'].tier, 'off');
    assert.equal(sp['mix.test'].tier, 'custom');
    assert.equal(sp['mix.test'].customOverrides.stripUrlParams, false);
    assert.equal(sp['mix.test'].customOverrides.aggressiveFiltering, true);
    assert.deepEqual(sp['hide.test'].customCosmeticSelectors, ['div.promo-strip']);
    // A domain choice switches that site to Custom in both versions.
    assert.equal(sp['slider.test'].tier, 'custom');
    assert.equal(sp['slider.test'].domainSliderOverrides['cdn-metrics.com'], 'allow');
    const pick = (p) => ({ tier: p.tier, customOverrides: p.customOverrides, domainSliderOverrides: p.domainSliderOverrides, customCosmeticSelectors: p.customCosmeticSelectors });
    for (const k of Object.keys(before.siteProfiles)) assert.deepEqual(pick(sp[k]), pick(before.siteProfiles[k]), k);
  });
  await check('global choices, learned trackers and stats kept', async () => {
    assert.equal(after.globalCustomConfig.showToastBadge, true);
    assert.deepEqual(after.globalCustomConfig.consentCategories, { necessary: true, functional: false, analytics: true, marketing: false });
    assert.equal(after.learnedTrackers['pixel-tracker.net'].globalManualOverride, 'block');
    assert.equal(after.learnedTrackers['pixel-tracker.net'].firstPartyHosts.length, 3);
    assert.equal(after.stats.totalTrackersRestricted, 700);
  });
  await check('new 1.1 settings start at their defaults', async () => {
    const st = await msg(A.GET_OPTIONS_STATE, {});
    assert.equal(st.operatingMode || 'full', 'full');
    assert.equal(!!(st.aiSettings && st.aiSettings.autoOptimise), false);
  });
  await check('a hidden element chosen in 1.0.0 is still hidden after the upgrade', async () => {
    const web = await context.newPage();
    await web.goto(`http://hide.test:${PORT}/`);
    const shown = async () => web.evaluate(() => getComputedStyle(document.querySelector('.promo-strip')).display !== 'none');
    for (let i = 0; i < 20 && await shown(); i++) await sleep(250);
    assert.equal(await shown(), false);
    await web.close();
  });
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await context.close().catch(() => {});
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} upgrade check(s) failed` : '\nall upgrade checks passed');
process.exit(failed ? 1 : 0);
