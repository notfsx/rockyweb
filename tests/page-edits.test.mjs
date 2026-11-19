import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

const outline = [
  { id: 'e1', kind: 'fixed bottom bar', area: 9, text: 'Get our app', flags: [], main: false, protected: false },
  { id: 'e2', kind: 'main content', area: 70, text: 'Election results', flags: [], main: true, protected: false },
  { id: 'e3', kind: 'fixed box over the page', area: 30, text: 'Sign in', flags: ['form'], main: false, protected: true }
];

test('edit selectors: one element, never the page itself, nothing that could inject CSS', () => {
  for (const ok of ['div.app-banner', '#hdr', 'body > div.x', 'header:nth-of-type(2)', 'main > .a > div.b', 'div[data-testid="bar"]']) {
    assert.equal(RW.isSafeEditSelector(ok), true, ok);
  }
  for (const bad of ['body', 'html', 'html body', 'head', '*', ':root', ':not(.a)', '[class]', 'div, body', 'div:has(body)',
    'div{}', 'div;x', 'a /* x */', 'div\\', 'div !important', 'x'.repeat(301), '', 42, null, 'div @import', 'a<b']) {
    assert.equal(RW.isSafeEditSelector(bad), false, String(bad));
  }
});

test('ops are validated: unknown ops dropped, numbers clamped, choices fixed, page-only ops kept off elements', () => {
  assert.equal(RW.sanitizePageEditOp({ op: 'evil', selector: 'div.a' }), null);
  assert.deepEqual(RW.sanitizePageEditOp({ op: 'text_size', selector: 'page', value: 999 }), { op: 'text_size', selector: 'page', value: 200 });
  assert.deepEqual(RW.sanitizePageEditOp({ op: 'text_size', selector: 'page', value: '-5' }), { op: 'text_size', selector: 'page', value: 70 });
  assert.equal(RW.sanitizePageEditOp({ op: 'text_size', selector: 'page', value: 'big' }), null);
  assert.equal(RW.sanitizePageEditOp({ op: 'colours', selector: 'page', value: 'url(x)' }), null);
  assert.equal(RW.sanitizePageEditOp({ op: 'hide', selector: 'page' }), null, 'hiding the page is not an op');
  assert.equal(RW.sanitizePageEditOp({ op: 'unlock_scroll', selector: 'div.a' }), null, 'page-only op on an element');
  assert.equal(RW.sanitizePageEditOp({ op: 'hide', selector: 'body' }), null);
  assert.deepEqual(RW.sanitizePageEditOp({ op: 'hide', selector: 'div.a', what: 'Get <b>app</b>' }), { op: 'hide', selector: 'div.a', what: 'Get b app /b' });
});

test('CSS is built only from validated ops, at fixed templates', () => {
  const e = RW.sanitizePageEdit({ id: 'abcd1234', ops: [
    { op: 'hide', selector: 'div.app' },
    { op: 'unstick', selector: '#hdr' },
    { op: 'text_size', selector: 'page', value: 125 },
    { op: 'colours', selector: 'page', value: 'dark' },
    { op: 'pause_media', selector: 'page' }
  ] });
  const css = RW.buildPageEditCss(e);
  assert.match(css, /div\.app \{ display: none !important; \}/);
  assert.match(css, /#hdr \{ position: static !important;/);
  assert.match(css, /html \{ zoom: 125% !important; \}/);
  assert.match(css, /invert\(0\.9\)/);
  assert.doesNotMatch(css, /url\(|@import|expression|javascript:/i);
  // Every rule's braces balance: nothing can close a rule early.
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  assert.equal(RW.buildPageEditCss({ id: 'x', ops: [{ op: 'pause_media', selector: 'page' }] }), '', 'pause_media has no CSS');
});

test('stored edits: bounded, de-duplicated, malformed ones dropped, invalid sites dropped', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ id: `id${String(i).padStart(4, '0')}`, ops: [{ op: 'hide', selector: `div.x${i}` }] }));
  const out = RW.sanitizePageEdits({
    'example.com': many.concat([{ id: 'id0000', ops: [{ op: 'hide', selector: 'div.dup' }] }]),
    'not a domain': many,
    'b.com': [{ id: '!!', ops: [{ op: 'hide', selector: 'div.a' }] }, { id: 'okid1', ops: [{ op: 'nope' }] }, { id: 'okid2', ops: [], settings: [] }]
  });
  assert.equal(out['example.com'].length, 30);
  assert.equal(out['not a domain'], undefined);
  assert.equal(out['b.com'], undefined);
  assert.equal(new Set(out['example.com'].map((e) => e.id)).size, 30);
});

test('settings carried by an edit go through the plan validator and keep the value they replaced', () => {
  const e = RW.sanitizePageEdit({ id: 'set12345', ops: [], settings: [
    { op: 'setting', key: 'stripUrlParams', value: false, prev: true },
    { op: 'setting', key: '__proto__', value: true },
    { op: 'site_mode', value: 'nuclear' }
  ] });
  assert.deepEqual(e.settings, [{ op: 'setting', key: 'stripUrlParams', value: false, prev: true }]);
});

test('state: save, switch off, delete; the limit makes room by dropping the oldest automatic fix first', () => {
  let s = RW.createDefaultState();
  const mk = (i, source) => ({ id: `e${String(i).padStart(5, '0')}`, source, ops: [{ op: 'hide', selector: `div.x${i}` }] });
  s = RW.savePageEdit(s, 'shop.example.com', mk(1, 'automatic'));
  for (let i = 2; i <= 30; i++) s = RW.savePageEdit(s, 'example.com', mk(i, 'described'));
  assert.equal(RW.pageEditsFor(s, 'example.com').length, 30, 'subdomains share the site');
  s = RW.savePageEdit(s, 'example.com', mk(31, 'described'));
  const ids = RW.pageEditsFor(s, 'example.com').map((e) => e.id);
  assert.equal(ids.length, 30);
  assert.ok(!ids.includes('e00001'), 'the automatic fix made room');
  s = RW.setPageEditEnabled(s, 'example.com', 'e00002', false);
  assert.equal(RW.pageEditsFor(s, 'example.com').find((e) => e.id === 'e00002').enabled, false);
  s = RW.deletePageEdit(s, 'example.com', 'e00002');
  assert.equal(RW.pageEditsFor(s, 'example.com').length, 29);
  assert.throws(() => RW.savePageEdit(s, 'example.com', { id: 'bad', ops: [{ op: 'hide', selector: 'body' }] }), /invalid_edit/);
  // Export and import keep them.
  const round = RW.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.pageEdits, s.pageEdits);
});

test('the model\'s edits are checked against the outline it saw', () => {
  const ask = (edits) => RW.parsePlanEdits(JSON.stringify({ changes: [], edits, unsupported: [] }), outline);
  assert.deepEqual(ask([{ op: 'hide', target: 'e1' }]).edits, [{ op: 'hide', target: 'e1', what: 'Get our app' }]);
  const main = ask([{ op: 'hide', target: 'e2' }]);
  assert.equal(main.edits.length, 0);
  assert.match(main.notes.join(), /main content/);
  assert.equal(ask([{ op: 'hide', target: 'e3' }]).edits.length, 0, 'never hides a sign-in form');
  assert.equal(ask([{ op: 'hide', target: 'e9' }]).edits.length, 0, 'ids not in the outline are dropped');
  assert.equal(ask([{ op: 'hide', target: 'div.app' }]).edits.length, 0, 'selectors from the model are refused');
  assert.equal(ask([{ op: 'inject_js', target: 'page' }]).edits.length, 0);
  assert.deepEqual(ask([{ op: 'width', target: 'page', value: 70 }]).edits[0].target, 'e2', 'page width means the main text');
  assert.equal(ask([{ op: 'text_size', target: 'page', value: 5000 }]).edits[0].value, 200);
  assert.equal(ask(Array.from({ length: 20 }, () => ({ op: 'hide', target: 'e1' }))).edits.length, 1, 'one per op and target');
  assert.deepEqual(RW.parsePlanEdits('not json', outline), { edits: [], notes: [] });
});

test('a request asked before on the same site is found without the model', () => {
  const edits = [{ id: 'abcd1', request: 'Hide the app banner please', ops: [{ op: 'hide', selector: 'div.a' }] }];
  assert.equal(RW.findSavedPageEdit(edits, 'hide the app banner')?.id, 'abcd1');
  assert.equal(RW.findSavedPageEdit(edits, 'hide the app banner here!')?.id, 'abcd1');
  assert.equal(RW.findSavedPageEdit(edits, 'show the app banner'), null);
  assert.equal(RW.findSavedPageEdit(edits, ''), null);
});

test('proactive fixes: never on consent, sign-in, payment, paywalls or anti-adblock', () => {
  assert.equal(RW.pageFixAllowed('app_banner', 'Get our app for the best experience'), true);
  for (const t of ['We use cookies', 'Sign in to continue', 'Subscribe to read this article', 'Please disable your ad blocker', 'Checkout now', 'Are you over 18?']) {
    assert.equal(RW.pageFixAllowed('promo_bar', t), false, t);
  }
  assert.equal(RW.pageFixAllowed('unknown_kind', 'x'), false);
  const ids = ['f1', 'f2'];
  assert.deepEqual(RW.parsePageFixDecisions(JSON.stringify({ decisions: [{ id: 'f1', action: 'apply', confidence: 'high' }, { id: 'f2', action: 'apply', confidence: 'low' }, { id: 'f9', action: 'apply', confidence: 'high' }] }), ids), { f1: 'apply', f2: 'leave' });
  assert.equal(RW.parsePageFixDecisions('{', ids), null);
});

test('settings: page edits on and fixes suggested by default; a site can opt out; never in Light or Incognito', () => {
  const s = RW.createDefaultState();
  assert.deepEqual(s.aiSettings, { autoOptimise: false, pageEdits: true, pageFixes: 'suggest' });
  const caps = (st, ctx) => RW.runtimeCapabilities(RW.getEffectiveConfig(st, 'a.com'), ctx);
  assert.equal(caps(s).pageFixes, 'suggest');
  assert.equal(caps(RW.setOperatingMode(s, 'light')).pageFixes, 'off');
  assert.equal(caps(s, { incognito: true }).pageFixes, 'off');
  assert.equal(caps(RW.setSitePageFixes(s, 'a.com', 'off', 1)).pageFixes, 'off');
  assert.equal(caps(RW.setSiteTier(s, 'a.com', 'off', 1)).pageFixes, 'off');
  const auto = RW.setAiPageSettings(s, { pageFixes: 'auto' });
  assert.equal(caps(auto).pageFixes, 'auto');
  assert.equal(caps(auto).pageFixAi, false, 'the model only with automatic optimisation on');
  assert.equal(caps(RW.setAiAutoOptimise(auto, true)).pageFixAi, true);
  assert.equal(RW.setAiAutoOptimise(auto, true).aiSettings.pageFixes, 'auto', 'turning AI on keeps the other AI settings');
  assert.throws(() => RW.setAiPageSettings(s, { pageFixes: 'always' }), /invalid_value/);
});

test('fuzz: random edits never produce CSS outside the templates', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = ['}', '{', ';', 'body', 'url(x)', '@import', '<style>', 'div', '.a', '#b', ' > ', ':has(', '!important', '\\', '*', 'html', '\n'];
  for (let i = 0; i < 2000; i++) {
    const sel = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(junk)).join('');
    const op = pick(RW.PAGE_EDIT_OP_NAMES.concat(['evil', '__proto__']));
    const e = RW.sanitizePageEdit({ id: 'fuzz1234', ops: [{ op, selector: rnd() < 0.2 ? 'page' : sel, value: pick([5, 100, 9999, 'dark', 'x', null]) }] });
    if (!e) continue;
    const css = RW.buildPageEditCss(e);
    assert.doesNotMatch(css, /url\(|@import|<|:has\(|;\s*}\s*[^\n]*\{[^}]*\{/i, css);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, css);
  }
});
