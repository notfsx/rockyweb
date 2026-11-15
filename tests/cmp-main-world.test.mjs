import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { EXT_DIR } from '../scripts/load-shared.mjs';

globalThis.self = globalThis;
createRequire(import.meta.url)(path.join(EXT_DIR, 'engines', 'cmp-main-world.js'));
const run = (win, categories) => {
  globalThis.window = win;
  globalThis.document = { cookie: '' };
  return globalThis.rockywebCmpMainWorld({ categories });
};
const balanced = { necessary: true, functional: true, analytics: false, marketing: false };
const rejectAll = { necessary: true, functional: false, analytics: false, marketing: false };

test('partial Complianz API (no deny_all) submits nothing and is not reported as handled', async () => {
  const calls = [];
  const res = await run({ cmplz_set_category: (c) => calls.push(c) }, rejectAll);
  assert.equal(res.handled, false);
  assert.equal(res.reason, 'api_error');
  assert.deepEqual(calls, []);
});

test('full Complianz API keeps functional cookies when the user allows them', async () => {
  const calls = [];
  const res = await run({ cmplz_deny_all: () => calls.push('deny'), cmplz_set_category: (c) => calls.push(c) }, balanced);
  assert.deepEqual(res, { handled: true, cmp: 'Complianz', method: 'api', decision: 'custom' });
  assert.deepEqual(calls, ['deny', 'preferences']);
});

test('an existing decision is reported, not overwritten', async () => {
  let rejected = false;
  const res = await run({ OneTrust: { RejectAll() { rejected = true; }, AllowAll() {}, IsAlertBoxClosed: () => true } }, rejectAll);
  assert.deepEqual(res, { handled: false, cmp: 'OneTrust', reason: 'already_decided' });
  assert.equal(rejected, false);
});

test('no platform present returns at once without a promise', () => {
  const res = run({}, balanced);
  assert.deepEqual(res, { handled: false, reason: 'not_found' });
});
