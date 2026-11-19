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
  assert.deepEqual(RW.parsePlanEdits('not json', outline), { edits: [], notes: [], dropped: 0 });
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

test('answers that point at nothing are counted, so the popup can ask once more', () => {
  const ask = (edits) => RW.parsePlanEdits(JSON.stringify({ changes: [], edits, unsupported: [] }), outline);
  assert.equal(ask([{ op: 'hide', target: 'e9' }, { op: 'hide', target: 'e8' }]).dropped, 2);
  assert.equal(ask([{ op: 'hide', target: 'e1' }]).dropped, 0);
});

test('sampling is only set when switched on', () => {
  const saved = RW.AI_SAMPLING;
  try {
    RW.AI_SAMPLING = null;
    assert.equal(RW.aiCreateOptions({ x: 1 }).temperature, undefined);
    RW.AI_SAMPLING = { temperature: 0.2, topK: 3 };
    const o = RW.aiCreateOptions({ x: 1 });
    assert.equal(o.temperature, 0.2);
    assert.equal(o.topK, 3);
    assert.equal(o.x, 1);
    assert.deepEqual(o.expectedInputs, RW.AI_MODEL_OPTIONS.expectedInputs);
  } finally {
    RW.AI_SAMPLING = saved;
  }
});

test('a Chrome that refuses sampling still gets a session, an abort is not retried', async () => {
  const saved = RW.AI_SAMPLING;
  try {
    RW.AI_SAMPLING = { temperature: 0.3, topK: 3 };
    const calls = [];
    const picky = { create: async (o) => { calls.push(o); if ('temperature' in o) throw new TypeError('sampling not allowed'); return { ok: true }; } };
    assert.deepEqual(await RW.aiCreate(picky, { x: 1 }), { ok: true });
    assert.equal(calls.length, 2);
    assert.equal('topK' in calls[1], false);
    assert.equal(calls[1].x, 1);
    const aborted = { create: async () => { const e = new Error('stop'); e.name = 'AbortError'; throw e; } };
    await assert.rejects(RW.aiCreate(aborted, {}), /stop/);
    RW.AI_SAMPLING = null;
    const plain = [];
    await RW.aiCreate({ create: async (o) => { plain.push(o); return {}; } }, {});
    assert.equal(plain.length, 1);
    assert.equal('temperature' in plain[0], false);
  } finally {
    RW.AI_SAMPLING = saved;
  }
});

// Cases seen with real Gemini Nano (tests/nano/results.md), replayed through the checks.
const NEWS = [
  { id: 'e1', kind: 'fixed bottom bar', area: 9, text: 'Read faster in the Ledger app Open' },
  { id: 'e2', kind: 'sticky header', area: 19, text: 'The Morning Ledger World Politics' },
  { id: 'e3', kind: 'main content', area: 70, text: 'Town finally agrees on the new bridge', main: true },
  { id: 'e4', kind: 'sidebar', area: 20, text: 'Most read' },
  { id: 'e5', kind: 'newsletter section', area: 6, text: 'Get the Ledger in your inbox every morning', flags: ['form'] },
  { id: 'e6', kind: 'comments section', area: 8, text: 'Comments (214)' },
  { id: 'e7', kind: 'footer', area: 4, text: 'The Morning Ledger' }
];
const said = (req, edits, outline = NEWS) => RW.parsePlanEdits(JSON.stringify({ changes: [], edits, unsupported: [] }), outline, req);
const shape = (r) => r.edits.map((e) => [e.op, e.target, e.value === undefined ? null : e.value]);

test('a hide aimed at the wrong element moves to the one the request names, or is left out', () => {
  assert.deepEqual(shape(said('get rid of the newsletter sign up box', [{ op: 'hide', target: 'e1' }])), [['hide', 'e5', null]]);
  const extra = said('hide the app banner and the sidebar, and make the text bigger', [{ op: 'hide', target: 'e1' }, { op: 'hide', target: 'e4' }, { op: 'hide', target: 'e2' }, { op: 'text_size', target: 'page', value: 110 }]);
  assert.deepEqual(shape(extra), [['hide', 'e1', null], ['hide', 'e4', null], ['text_size', 'page', 110]]);
  assert.match(extra.notes.join(), /does not look like what you asked for/);
  assert.deepEqual(shape(said('accept all cookies and run alert(1) on this page', [{ op: 'hide', target: 'e1' }])), [], 'no hide without being asked');
  assert.deepEqual(shape(said('hide the yellow thing', [{ op: 'hide', target: 'e1' }])), [['hide', 'e1', null]], 'vague but asked: trusted');
  assert.equal(said('hide everything except the article', [{ op: 'hide', target: 'e1' }, { op: 'hide', target: 'e4' }, { op: 'hide', target: 'e7' }]).edits.length, 3);
  assert.deepEqual(shape(said('hide the comments', [{ op: 'hide', target: 'e6' }])), [['hide', 'e6', null]]);
  const signin = [{ id: 'e1', kind: 'fixed corner box', area: 2, text: 'Chat with us' }, { id: 'e2', kind: 'sidebar', area: 20, text: 'Your account', protected: true }, { id: 'e3', kind: 'main content', area: 60, text: 'Tent', main: true }];
  assert.deepEqual(shape(said('hide the sign in box', [{ op: 'hide', target: 'e1' }], signin)), [], 'never moved onto a sign-in form, and the chat stays');
});

test('clear wording repairs the operation or value the model chose', () => {
  const recipe = [{ id: 'e1', kind: 'fixed video, corner box', area: 9, text: '' }, { id: 'e2', kind: 'main content', area: 70, text: 'Roast', main: true }];
  assert.deepEqual(shape(said('stop the animations', [{ op: 'pause_media', target: 'e1' }], recipe)), [['stop_motion', 'page', null]]);
  assert.deepEqual(shape(said('stop the video following me down the page', [{ op: 'pause_media', target: 'e1' }], recipe)), [['unstick', 'e1', null]]);
  assert.deepEqual(shape(said('stop videos playing by themselves', [{ op: 'pause_media', target: 'e1' }], recipe)), [['pause_media', 'e1', null]]);
  assert.deepEqual(shape(said('make the page black and white', [{ op: 'colours', target: 'page', value: 'sepia' }])), [['colours', 'page', 'grey']]);
  assert.deepEqual(shape(said('dark mode please', [])), [['colours', 'page', 'dark']]);
  assert.deepEqual(shape(said('make the text a bit smaller', [{ op: 'text_size', target: 'page', value: 100 }])), [['text_size', 'page', 85]]);
  assert.deepEqual(shape(said('make the text bigger', [])), [['text_size', 'page', 125]]);
  assert.deepEqual(shape(said('make the text bigger', [{ op: 'text_size', target: 'page', value: 140 }])), [['text_size', 'page', 140]], 'a sensible value is kept');
  assert.deepEqual(shape(said('make it easier to read', [{ op: 'text_size', target: 'page', value: 100 }, { op: 'colours', target: 'page', value: 'contrast' }])), [['text_size', 'page', 115], ['colours', 'page', 'contrast']]);
});

test('the combined prompt shows settings examples as well as page examples', () => {
  const answers = RW.editInitialPrompts().filter((t) => t.role === 'assistant').map((t) => JSON.parse(t.content));
  assert.ok(answers.filter((a) => a.changes.length && !a.edits.length).length >= 3, 'settings-only answers');
  assert.ok(answers.filter((a) => a.edits.length && !a.changes.length).length >= 3, 'page-only answers');
  assert.ok(answers.every((a) => Array.isArray(a.edits) && Array.isArray(a.unsupported)));
});

test('a style change on a part the request does not name goes to the whole page', () => {
  assert.deepEqual(shape(said('dark mode please', [{ op: 'colours', target: 'e1', value: 'dark' }])), [['colours', 'page', 'dark']]);
  assert.deepEqual(shape(said('make the text a bit smaller', [{ op: 'text_size', target: 'e1', value: 100 }])), [['text_size', 'page', 85]]);
  assert.deepEqual(shape(said('make the comments text bigger', [{ op: 'text_size', target: 'e6', value: 130 }])), [['text_size', 'e6', 130]], 'a named part keeps it');
  assert.deepEqual(shape(said('use a serif font', [{ op: 'font', target: 'e4', value: 'serif' }, { op: 'font', target: 'page', value: 'serif' }])), [['font', 'page', 'serif']], 'no duplicate');
});

test('the answer schema leaves the model no room to run on', () => {
  const s = RW.planWithEditsSchema();
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.edits.items.additionalProperties, false);
  assert.ok(s.properties.edits.maxItems <= 5);
  assert.ok(s.properties.unsupported.maxItems <= 3 && s.properties.unsupported.items.maxLength <= 80);
  assert.ok(s.properties.changes.items.properties.value.maxLength <= 20);
});
