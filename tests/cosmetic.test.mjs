import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

test('Balanced uses safe selectors only; Strict adds aggressive ones', () => {
  const s = RW.createDefaultState();
  const bal = RW.buildCosmeticSelectors(RW.getEffectiveConfig(s, 'news.com'), 'news.com');
  assert.ok(bal.includes('ins.adsbygoogle'));
  assert.ok(!bal.includes('.ad-container'));
  const strict = RW.buildCosmeticSelectors(RW.getEffectiveConfig(RW.setSiteTier(s, 'news.com', 'strict', 1), 'news.com'), 'news.com');
  assert.ok(strict.includes('.ad-container'));
  assert.ok(strict.includes('#onesignal-slidedown-container'));
});

test('site-specific selectors apply on the matching site and subdomains only', () => {
  const s = RW.createDefaultState();
  const yt = RW.buildCosmeticSelectors(RW.getEffectiveConfig(s, 'www.youtube.com'), 'www.youtube.com');
  assert.ok(yt.includes('ytd-ad-slot-renderer'));
  const other = RW.buildCosmeticSelectors(RW.getEffectiveConfig(s, 'notyoutube.com'), 'notyoutube.com');
  assert.ok(!other.includes('ytd-ad-slot-renderer'));
});

test('user selectors survive Consent-only but not Off', () => {
  let s = RW.addCosmeticSelector(RW.createDefaultState(), 'a.com', '.annoying-promo-banner', 1);
  s = RW.setSiteTier(s, 'a.com', 'consent_only', 2);
  assert.deepEqual(RW.buildCosmeticSelectors(RW.getEffectiveConfig(s, 'a.com'), 'a.com'), ['.annoying-promo-banner']);
  s = RW.setSiteTier(s, 'a.com', 'off', 3);
  assert.deepEqual(RW.buildCosmeticSelectors(RW.getEffectiveConfig(s, 'a.com'), 'a.com'), []);
});

test('every shipped selector is valid and the CSS has one rule per selector', () => {
  const all = [...RW.COSMETIC_GENERIC_SAFE, ...RW.COSMETIC_AGGRESSIVE, ...Object.values(RW.COSMETIC_SITE_SPECIFIC).flat()];
  for (const sel of all) assert.ok(RW.isValidSelector(sel), sel);
  const css = RW.buildCosmeticCss(['.a', '#b']);
  assert.equal(css, '.a { display: none !important; }\n#b { display: none !important; }');
});

test('consent rules are well-formed', () => {
  const ids = new Set();
  for (const r of RW.CONSENT_RULES) {
    assert.ok(!ids.has(r.id), r.id);
    ids.add(r.id);
    assert.ok(Array.isArray(r.detect) && r.detect.length, r.id);
    assert.ok(RW.KNOWN_CMP_NAMES.includes(r.name), r.name);
  }
  const reject = (t) => RW.CONSENT_REJECT_PATTERNS.some((re) => re.test(t));
  for (const t of ['reject all', 'decline', 'only necessary cookies', 'alle ablehnen', 'tout refuser', 'rechazar todo', 'continue without accepting', 'nur notwendige cookies']) assert.ok(reject(t), t);
  for (const t of ['accept all', 'settings', 'reject all ads forever please', 'subscribe']) assert.ok(!reject(t), t);
  // Seen on real sites (NHS, Ryanair) in the 2026-11-15 corpus run.
  for (const t of ['reject analytics cookies', 'no, thanks', 'no thanks', 'decline marketing cookies', "no, i don't agree"]) assert.ok(reject(t), t);
  for (const t of ['no thanks, i will subscribe', 'reject and subscribe', 'accept analytics cookies', 'no']) assert.ok(!reject(t), t);
  const accept = (t) => RW.CONSENT_ACCEPT_PATTERNS.some((re) => re.test(t));
  for (const t of ['yes, i agree', 'i agree', 'accept all']) assert.ok(accept(t), t);
  for (const t of ['no, thanks', 'reject analytics cookies']) assert.ok(!accept(t) && reject(t), t);
});
