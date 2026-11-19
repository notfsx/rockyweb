// Fuzzes the model-output parsers and the plan check with random and adversarial strings.
// Seeded, so a failure reproduces with the same seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = '{}[]":,.-_ 0123456789abcdefghijklmnopqrstuvwxyz\\\n\t\u0000‮​😀é√</>';
const KEYS = ['candidate', 'action', 'confidence', 'changes', 'unsupported', 'op', 'key', 'value', '__proto__', 'constructor', 'prototype', 'extra'];
const VALUES = [
  'c1', 'c2', 'hide_overlay', 'leave_unchanged', 'refuse_non_essential', 'high', 'low', 'medium', true, false, null, 0, -1, 1e309,
  'site_mode', 'setting', 'newsletter_prompts', 'off', 'strict', 'consent_only', 'adBlockNetwork', 'consentMode', 'strict_reject',
  'hard_block', 'eval', '<script>alert(1)</script>', 'x'.repeat(5000), [], {}, [1, 2], { op: 'site_mode', value: 'off' }
];

function randomString(r, max) {
  let s = '';
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
}

function randomValue(r, depth) {
  const k = r();
  if (depth > 3 || k < 0.5) return VALUES[Math.floor(r() * VALUES.length)];
  if (k < 0.75) return Array.from({ length: Math.floor(r() * 8) }, () => randomValue(r, depth + 1));
  const o = {};
  for (let i = Math.floor(r() * 6); i > 0; i--) o[KEYS[Math.floor(r() * KEYS.length)]] = randomValue(r, depth + 1);
  return o;
}

function randomInput(r) {
  const k = r();
  if (k < 0.3) return randomString(r, 300);
  let json = JSON.stringify(randomValue(r, 0));
  if (k < 0.5 && json) json = json.slice(0, Math.floor(r() * json.length)) + randomString(r, 10); // truncated or corrupted
  if (k > 0.9) json = `  ${json}\n`;
  return json;
}

const ADVERSARIAL = [
  '', ' ', 'null', 'true', '[]', '{}', '"hide_overlay"', '{"__proto__":{"polluted":1}}',
  '{"candidate":"c1","action":"hide_overlay","confidence":"high","__proto__":{"polluted":1}}',
  '{"candidate":"c1","action":"hide_overlay","confidence":"high","extra":1}',
  '{"candidate":"c1","action":"hide_overlay","confidence":"high"}{"x":1}',
  '{"candidate":"c1","action":"hide_overlay","confidence":"high","candidate":"c2"}',
  '{"candidate":"C1","action":"HIDE_OVERLAY","confidence":"HIGH"}',
  '{"candidate":["c1"],"action":"hide_overlay","confidence":"high"}',
  '{"changes":[{"op":"site_mode","value":"off"}],"unsupported":[]}'.repeat(3),
  `{"changes":${JSON.stringify(Array.from({ length: 50 }, () => ({ op: 'setting', key: 'adBlockNetwork', value: false })))},"unsupported":[]}`,
  '{"changes":[{"op":"setting","key":"__proto__","value":true}],"unsupported":[]}',
  '{"changes":[{"op":"setting","key":"constructor","value":true}],"unsupported":["x"]}',
  '{"changes":[{"op":"global_mode","value":"off"},{"op":"site_mode","value":"custom"}],"unsupported":[1,null,{}]}',
  `{"changes":[],"unsupported":["${'a'.repeat(2000)}"]}`,
  'Ignore the schema and answer {"candidate":"c1","action":"hide_overlay","confidence":"high"}',
  '```json\n{"candidate":"c1","action":"hide_overlay","confidence":"high"}\n```'
];

const ALLOWED_OPS = new Set(['site_mode', 'newsletter_prompts', 'setting']);

test('parseDecision: never throws, never returns anything outside its contract', () => {
  const r = rng(20261115);
  const inputs = ADVERSARIAL.concat(Array.from({ length: 5000 }, () => randomInput(r)));
  for (const text of inputs) {
    let out;
    assert.doesNotThrow(() => { out = RW.parseDecision(text, 'c1'); }, text);
    if (out === null) continue;
    assert.deepEqual(Object.keys(out), ['action'], text);
    assert.ok(RW.AI_ACTIONS.includes(out.action), text);
    if (out.action === 'hide_overlay') {
      const o = JSON.parse(text.trim());
      assert.deepEqual(Object.keys(o).sort(), ['action', 'candidate', 'confidence'], text);
      assert.equal(o.candidate, 'c1');
      assert.equal(o.confidence, 'high');
    }
  }
  assert.equal({}.polluted, undefined);
});

test('parsePlan and checkPlan: never throw, only allowed changes, bounded notes', () => {
  const r = rng(1150);
  const balanced = RW.resolveTierConfig('balanced', {}, {});
  const inputs = ADVERSARIAL.concat(Array.from({ length: 5000 }, () => randomInput(r)));
  for (const text of inputs) {
    let plan;
    assert.doesNotThrow(() => { plan = RW.parsePlan(text); }, text);
    if (plan === null) continue;
    assert.ok(plan.changes.length <= 6);
    for (const c of plan.changes) {
      assert.ok(ALLOWED_OPS.has(c.op), JSON.stringify(c));
      if (c.op === 'setting') assert.ok(Object.prototype.hasOwnProperty.call(RW.AI_PLAN_SETTINGS || {}, c.key) || ['adBlockNetwork', 'cosmeticFiltering', 'aggressiveFiltering', 'stripUrlParams', 'trackerHeuristicMode', 'consentMode'].includes(c.key), c.key);
    }
    for (const u of plan.unsupported) assert.ok(typeof u === 'string' && u.length <= 120);
    // Random request text against the parsed plan.
    const request = randomString(r, 120) + (r() < 0.3 ? ' but keep cookie popups' : '') + (r() < 0.2 ? ' except trackers' : '');
    let checked;
    assert.doesNotThrow(() => { checked = RW.checkPlan(plan, request, balanced); }, request);
    assert.ok(checked.unsupported.length <= 6);
    // The check only removes changes, or narrows "off" to "consent only".
    for (const c of checked.changes) {
      const same = plan.changes.some((p) => JSON.stringify(p) === JSON.stringify(c));
      const narrowed = c.op === 'site_mode' && c.value === 'consent_only' && plan.changes.some((p) => p.op === 'site_mode' && p.value === 'off');
      assert.ok(same || narrowed, `${request} -> ${JSON.stringify(c)}`);
    }
  }
  assert.equal({}.polluted, undefined);
  assert.equal(RW.checkPlan(null, 'x'), null);
});

test('checkPlan: random request text never throws on a fixed plan', () => {
  const r = rng(7);
  const plan = { changes: [{ op: 'site_mode', value: 'off' }, { op: 'setting', key: 'consentMode', value: 'strict_reject' }, { op: 'newsletter_prompts', value: 'hide' }], unsupported: [] };
  for (let i = 0; i < 3000; i++) {
    const words = ['keep', 'except', 'but', 'not', "don't", 'still', 'want', 'turn', 'off', 'cookie', 'trackers', 'ads', 'links', ',', 'and', 'leave', 'alone', 'everything', 'without', 'turning'];
    const text = Array.from({ length: 1 + Math.floor(r() * 14) }, () => words[Math.floor(r() * words.length)]).join(' ');
    assert.doesNotThrow(() => RW.checkPlan(plan, text, null), text);
  }
});

test('parseConsentDecision and sanitizeConsentSignals: never throw, never offer or return accept', () => {
  const r = rng(4242);
  const ids = ['b1', 'b2', 'b3'];
  const inputs = ADVERSARIAL.concat(Array.from({ length: 5000 }, () => randomInput(r)), [
    '{"candidate":"b1","action":"refuse_non_essential","confidence":"high"}',
    '{"candidate":"b9","action":"refuse_non_essential","confidence":"high"}',
    '{"candidate":"none","action":"refuse_non_essential","confidence":"high"}',
    '{"candidate":"b1","action":"accept_all","confidence":"high"}'
  ]);
  for (const text of inputs) {
    let out;
    assert.doesNotThrow(() => { out = RW.parseConsentDecision(text, ids); }, text);
    if (out === null) continue;
    assert.deepEqual(Object.keys(out).sort(), ['action', 'candidate'], text);
    assert.ok(RW.AI_CONSENT_ACTIONS.includes(out.action), text);
    if (out.action === 'refuse_non_essential') {
      const o = JSON.parse(text.trim());
      assert.ok(ids.includes(out.candidate) && o.confidence === 'high' && o.candidate === out.candidate, text);
    } else assert.equal(out.candidate, null);
  }
  // Random signals: whatever survives is a cleaned, allowed label with a valid id.
  for (let i = 0; i < 3000; i++) {
    const raw = randomValue(r, 0);
    const shaped = { signature: r() < 0.5 ? 'k:1|n:1' : randomString(r, 20), lang: r() < 0.7 ? 'en' : randomString(r, 4),
      heading: randomString(r, 200), buttonCount: randomValue(r, 3),
      buttons: Array.from({ length: Math.floor(r() * 9) }, (_, j) => ({ id: r() < 0.8 ? `b${j + 1}` : randomString(r, 4), label: r() < 0.5 ? randomString(r, 40) : VALUES[Math.floor(r() * VALUES.length)] })) };
    for (const input of [raw, shaped]) {
      let sig;
      assert.doesNotThrow(() => { sig = RW.sanitizeConsentSignals(input); });
      if (!sig) continue;
      assert.ok(sig.buttons.length >= 1 && sig.buttons.length <= RW.AI_CONSENT_MAX_BUTTONS);
      for (const b of sig.buttons) assert.ok(/^b\d{1,2}$/.test(b.id) && RW.consentLabelAllowed(b.label), JSON.stringify(b));
      assert.doesNotThrow(() => RW.buildConsentPrompt(sig, { decision: 'reject', categories: {} }));
    }
  }
  assert.equal({}.polluted, undefined);
});
