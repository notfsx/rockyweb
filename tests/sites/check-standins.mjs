#!/usr/bin/env node
// Checks that recordRequests tells a request swapped for a stand-in script apart from one that
// loaded: a local page asks for Google Tag Manager's script once, in Strict.
// usage: node tests/sites/check-standins.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { EXT_DIR, loadShared } from '../../scripts/load-shared.mjs';
import { recordRequests } from './privacy-metrics.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const RW = loadShared();
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockyweb-standin-'));
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>t</title><script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>'); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const context = await chromium.launchPersistentContext(userDir, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`] });
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await ext.evaluate(([a]) => chrome.runtime.sendMessage({ action: a, payload: { tier: 'strict' } }), [RW.ACTIONS.SET_GLOBAL_TIER]);
  await new Promise((r) => setTimeout(r, 1500));
  const page = await context.newPage();
  const list = recordRequests(page);
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await new Promise((r) => setTimeout(r, 1500));
  const gtm = list.filter((x) => x.url.includes('googletagmanager.com'));
  console.log(JSON.stringify(gtm));
  if (!gtm.length || !gtm.every((x) => x.standIn || x.failure)) { console.log('✗ the request was counted as loaded'); process.exitCode = 1; } else console.log('✓ counted as a stand-in or blocked, not loaded');
} finally {
  await context.close();
  srv.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
