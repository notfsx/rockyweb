import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

const edit = (id, at, extra) => Object.assign({ id, label: 'hide app bar', request: 'hide the app bar', source: 'described',
  ops: [{ op: 'hide', selector: 'div.appbar' }], settings: [], enabled: true, createdAt: at, updatedAt: at }, extra);

function stateWith(over) {
  const s = RW.createDefaultState();
  s.siteProfiles = {};
  s.pageEdits = {};
  return Object.assign(s, over);
}
const profile = (tier, at, extra) => Object.assign(RW.normalizeState({ siteProfiles: { 'x.com': { tier, updatedAt: at } } }).siteProfiles['x.com'], extra);
const roundTrip = (view, meta) => RW.decodeSync(RW.encodeSync(view, Object.assign({ device: 'a', at: 1 }, meta)).items);

test('sync view: settings, sites and page changes; never trackers, stats, AI memory, Light or automatic optimisation', () => {
  const s = stateWith({
    globalDefaultTier: 'strict',
    operatingMode: 'light',
    siteProfiles: { 'news.example': profile('consent_only', 10) },
    pageEdits: { 'news.example': [edit('abcd1', 5)] },
    learnedTrackers: { 'tracker.example': { firstPartyHosts: ['a.com', 'b.com', 'c.com'], learnedStatus: 'cookie_block' } },
    stats: { totalPopupsHandled: 9, totalAdsBlocked: 9, totalTrackersRestricted: 9 }
  });
  s.aiSettings.autoOptimise = true;
  const v = RW.syncView(s);
  assert.deepEqual(Object.keys(v).sort(), ['edits', 'prefs', 'sites']);
  assert.equal(v.prefs.globalDefaultTier, 'strict');
  assert.ok(!('operatingMode' in v.prefs) && !('autoOptimise' in v.prefs));
  assert.equal(v.sites['news.example'].tier, 'consent_only');
  assert.equal(v.edits['news.example'][0].id, 'abcd1');
  const text = JSON.stringify(RW.encodeSync(v, { device: 'a' }).items);
  for (const word of ['tracker.example', 'totalAdsBlocked', 'learnedTrackers', 'light', 'autoOptimise']) assert.ok(!text.includes(word), word);
});

test('sites changed in Incognito are never synced, with their page changes', () => {
  const s = stateWith({
    siteProfiles: { 'private.example': profile('off', 10, { private: true }), 'open.example': profile('strict', 10) },
    pageEdits: { 'private.example': [edit('abcd1', 5)] }
  });
  const v = RW.syncView(s);
  assert.deepEqual(Object.keys(v.sites), ['open.example']);
  assert.deepEqual(v.edits, {});
  // markSitePrivate keeps the flag through normalisation, and a private profile is never dropped as empty.
  const m = RW.markSitePrivate(stateWith({}), 'only.example');
  assert.equal(RW.normalizeState(m).siteProfiles['only.example'].private, true);
});

test('encode and decode: chunks under 8 KB, total under 100 KB, non-ASCII safe', () => {
  const sites = {};
  for (let i = 0; i < 400; i++) sites[`site${i}.example`] = profile('custom', i, { customCosmeticSelectors: [`div.ünïcode-${i}`, `#banner-${i}`] });
  const v = RW.syncView(stateWith({ siteProfiles: sites }));
  const enc = RW.encodeSync(v, { device: 'a', at: 1 });
  for (const [k, val] of Object.entries(enc.items)) assert.ok(k.length + JSON.stringify(val).length <= RW.SYNC_ITEM_MAX, k);
  assert.ok(enc.bytes <= RW.SYNC_TOTAL_MAX);
  const back = RW.decodeSync(enc.items);
  assert.equal(Object.keys(back.view.sites).length, Object.keys(enc.view.sites).length);
  assert.equal(back.view.sites['site399.example'].customCosmeticSelectors[0], 'div.ünïcode-399');
});

test('too much to sync: the sites changed longest ago are left out and counted', () => {
  const sites = {};
  for (let i = 0; i < 3000; i++) sites[`site${i}.example`] = profile('custom', 1000 + i, { customCosmeticSelectors: [`div.banner-number-${i}`] });
  const enc = RW.encodeSync(RW.syncView(stateWith({ siteProfiles: sites })), { device: 'a' });
  assert.ok(enc.skipped > 0);
  assert.ok(enc.bytes <= RW.SYNC_TOTAL_MAX);
  assert.ok(enc.view.sites['site2999.example'], 'the newest is kept');
  assert.ok(!enc.view.sites['site0.example'], 'the oldest is left out');
  assert.equal(enc.items[RW.SYNC_META_KEY].skipped, enc.skipped);
});

test('a half-arrived or tampered copy is not used', () => {
  const enc = RW.encodeSync(RW.syncView(stateWith({ siteProfiles: { 'x.com': profile('strict', 1) } })), { device: 'a' });
  const missing = Object.assign({}, enc.items);
  delete missing['rw:d0'];
  assert.equal(RW.decodeSync(missing).partial, true);
  const changed = Object.assign({}, enc.items, { 'rw:d0': enc.items['rw:d0'].replace('strict', 'off') });
  assert.equal(RW.decodeSync(changed).partial, true);
  assert.equal(RW.decodeSync({}), null);
});

test('remote data is checked like an import: bad values are dropped', () => {
  const body = JSON.stringify({ v: 1, prefsAt: 0, prefs: { globalDefaultTier: 'evil', globalCustomConfig: { adBlockNetwork: 'yes' } },
    sites: { 'ok.example': { tier: 'strict' }, 'not a domain': { tier: 'off' }, 'bad.example': { customCosmeticSelectors: ['body{}'] } },
    edits: { 'ok.example': [{ id: 'abcd1', ops: [{ op: 'hide', selector: 'body' }] }] } });
  const items = { 'rw:d0': body, 'rw:meta': { v: 1, n: 1, hash: RW.syncHash(body), device: 'b', at: 1 } };
  const d = RW.decodeSync(items);
  assert.equal(d.view.prefs.globalDefaultTier, 'balanced');
  assert.equal(d.view.prefs.globalCustomConfig.adBlockNetwork, RW.createDefaultState().globalCustomConfig.adBlockNetwork);
  assert.deepEqual(Object.keys(d.view.sites), ['ok.example']);
  assert.deepEqual(d.view.edits, {}, 'an edit that hides the page is dropped');
});

test('first merge: both sides kept, the newer site wins, general settings come from sync', () => {
  const local = RW.syncView(stateWith({ globalDefaultTier: 'strict', siteProfiles: { 'a.com': profile('off', 50), 'both.com': profile('strict', 10) } }));
  const remote = RW.syncView(stateWith({ globalDefaultTier: 'consent_only', siteProfiles: { 'b.com': profile('off', 5), 'both.com': profile('consent_only', 20) } }));
  const m = RW.mergeSync(null, local, remote, { localPrefsAt: 0, remotePrefsAt: 0 });
  assert.deepEqual(Object.keys(m.sites).sort(), ['a.com', 'b.com', 'both.com']);
  assert.equal(m.sites['both.com'].tier, 'consent_only', 'newer wins');
  assert.equal(m.prefs.globalDefaultTier, 'consent_only', 'settings from the devices already syncing');
});

test('three-way merge: one-sided changes and deletions carry over, conflicts go to the newer change', () => {
  const base = RW.syncView(stateWith({ siteProfiles: { 'gone.com': profile('off', 1), 'keep.com': profile('strict', 1), 'c.com': profile('strict', 1) } }));
  // Here: gone.com deleted, c.com changed at 30. There: keep.com changed at 20, c.com changed at 40.
  const local = RW.syncView(stateWith({ siteProfiles: { 'keep.com': profile('strict', 1), 'c.com': profile('off', 30) } }));
  const remote = RW.syncView(stateWith({ siteProfiles: { 'gone.com': profile('off', 1), 'keep.com': profile('consent_only', 20), 'c.com': profile('balanced', 40) } }));
  const m = RW.mergeSync(base, local, remote, {});
  assert.ok(!m.sites['gone.com'], 'a deletion here reaches sync');
  assert.equal(m.sites['keep.com'].tier, 'consent_only', 'a change there reaches here');
  assert.equal(m.sites['c.com'].tier, 'balanced', 'the newer of two changes wins');
  // A site the other device deleted, which this device changed meanwhile, is kept.
  const m2 = RW.mergeSync(base, RW.syncView(stateWith({ siteProfiles: { 'gone.com': profile('consent_only', 9) } })), RW.syncView(stateWith({})), {});
  assert.equal(m2.sites['gone.com'].tier, 'consent_only');
});

test('page changes merge per change: switched off there, added here, deleted there', () => {
  const base = { prefs: {}, sites: {}, edits: { 'x.com': [edit('aaaa1', 1), edit('bbbb2', 2)] } };
  const local = { prefs: {}, sites: {}, edits: { 'x.com': [edit('aaaa1', 1), edit('bbbb2', 2), edit('cccc3', 3)] } };
  const remote = { prefs: {}, sites: {}, edits: { 'x.com': [edit('aaaa1', 1, { enabled: false, updatedAt: 9 })] } };
  const m = RW.mergeSync(base, local, remote, {});
  assert.deepEqual(m.edits['x.com'].map((e) => [e.id, e.enabled]), [['aaaa1', false], ['cccc3', true]]);
});

test('general settings: the newer side wins when both changed', () => {
  const base = { prefs: { globalDefaultTier: 'balanced' }, sites: {}, edits: {} };
  const local = { prefs: { globalDefaultTier: 'strict' }, sites: {}, edits: {} };
  const remote = { prefs: { globalDefaultTier: 'off' }, sites: {}, edits: {} };
  assert.equal(RW.mergeSync(base, local, remote, { localPrefsAt: 5, remotePrefsAt: 9 }).prefs.globalDefaultTier, 'off');
  assert.equal(RW.mergeSync(base, local, remote, { localPrefsAt: 9, remotePrefsAt: 5 }).prefs.globalDefaultTier, 'strict');
});

test('applying a merged view keeps trackers, stats, Light mode and private sites on this device', () => {
  const s = stateWith({
    operatingMode: 'light',
    siteProfiles: { 'private.example': profile('off', 1, { private: true }) },
    learnedTrackers: { 't.example': RW.normalizeState({ learnedTrackers: { 't.example': {} } }).learnedTrackers['t.example'] },
    stats: { totalPopupsHandled: 3, totalAdsBlocked: 4, totalTrackersRestricted: 5 }
  });
  const remote = roundTrip(RW.syncView(stateWith({ globalDefaultTier: 'strict', siteProfiles: { 'private.example': profile('strict', 99), 'new.example': profile('consent_only', 2) } })));
  const next = RW.applySyncView(s, remote.view);
  assert.equal(next.globalDefaultTier, 'strict');
  assert.equal(next.operatingMode, 'light');
  assert.equal(next.siteProfiles['private.example'].tier, 'off', 'the private choice here is kept');
  assert.equal(next.siteProfiles['new.example'].tier, 'consent_only');
  assert.ok(next.learnedTrackers['t.example']);
  assert.equal(next.stats.totalAdsBlocked, 4);
});

test('stale chunk keys are found for removal, other extensions\' keys never', () => {
  assert.deepEqual(RW.syncStaleKeys({ 'rw:d0': 'x', 'rw:d5': 'y', 'other': 1 }, { 'rw:d0': 'x', 'rw:meta': {} }), ['rw:d5']);
});
