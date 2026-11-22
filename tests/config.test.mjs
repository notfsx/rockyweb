import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

test('fresh state defaults to Balanced with the documented schema', () => {
  const s = RW.createDefaultState();
  assert.equal(s.globalDefaultTier, 'balanced');
  assert.deepEqual(s.globalCustomConfig.consentCategories, { necessary: true, functional: true, analytics: false, marketing: false });
  assert.equal(s.globalCustomConfig.trackerHeuristicMode, 'cookie_strip');
  assert.deepEqual(s.stats, { totalPopupsHandled: 0, totalAdsBlocked: 0, totalTrackersRestricted: 0 });
  assert.deepEqual(s.siteProfiles, {});
  assert.deepEqual(s.learnedTrackers, {});
});

test('getEffectiveConfig: global balanced preset', () => {
  const c = RW.getEffectiveConfig(RW.createDefaultState(), 'www.news.example.com');
  assert.equal(c.tier, 'balanced');
  assert.equal(c.source, 'global');
  assert.equal(c.siteKey, 'example.com');
  assert.equal(c.adBlockNetwork, true);
  assert.equal(c.trackerHeuristicMode, 'cookie_strip');
  assert.equal(c.consentMode, 'custom_categories');
  assert.equal(c.cosmeticFiltering, true);
  assert.equal(c.stripUrlParams, true);
  assert.equal(c.aggressiveFiltering, false);
});

test('each tier resolves to its documented engines', () => {
  const s0 = RW.createDefaultState();
  const expect = {
    off: ['off', false, 'off', false, false],
    consent_only: ['custom_categories', false, 'off', false, false],
    balanced: ['custom_categories', true, 'cookie_strip', true, true],
    strict: ['strict_reject', true, 'hard_block', true, true]
  };
  for (const [tier, [consent, ads, heur, cosm, strip]] of Object.entries(expect)) {
    const s = RW.setSiteTier(s0, 'site.test', tier, 1);
    const c = RW.getEffectiveConfig(s, 'site.test');
    assert.equal(c.tier, tier);
    assert.equal(c.source, 'site');
    assert.equal(c.consentMode, consent, tier);
    assert.equal(c.adBlockNetwork, ads, tier);
    assert.equal(c.trackerHeuristicMode, heur, tier);
    assert.equal(c.cosmeticFiltering, cosm, tier);
    assert.equal(c.stripUrlParams, strip, tier);
  }
  const strict = RW.getEffectiveConfig(RW.setSiteTier(s0, 'site.test', 'strict', 1), 'site.test');
  assert.deepEqual(strict.consentCategories, { necessary: true, functional: false, analytics: false, marketing: false });
});

test('site profile applies to subdomains (registrable-domain key)', () => {
  const s = RW.setSiteTier(RW.createDefaultState(), 'https://shop.example.co.uk'.replace('https://', ''), 'consent_only', 1);
  assert.ok(s.siteProfiles['example.co.uk']);
  assert.equal(RW.getEffectiveConfig(s, 'checkout.example.co.uk').tier, 'consent_only');
  assert.equal(RW.getEffectiveConfig(s, 'other.co.uk').tier, 'balanced');
});

test('flipping one switch snapshots the current preset into Custom', () => {
  let s = RW.setSiteTier(RW.createDefaultState(), 'example.com', 'strict', 1);
  s = RW.setSiteCustomOption(s, 'example.com', 'trackerHeuristicMode', 'cookie_strip', 2);
  const c = RW.getEffectiveConfig(s, 'example.com');
  assert.equal(c.tier, 'custom');
  assert.equal(c.trackerHeuristicMode, 'cookie_strip');
  // Everything else carried over from Strict
  assert.equal(c.consentMode, 'strict_reject');
  assert.equal(c.aggressiveFiltering, true);
  assert.equal(c.adBlockNetwork, true);
  assert.equal(s.siteProfiles['example.com'].updatedAt, 2);
});

test('custom site config is independent of later global custom edits', () => {
  let s = RW.setSiteCustomOption(RW.createDefaultState(), 'example.com', 'cosmeticFiltering', false, 1);
  s = RW.setGlobalCustomOption(s, 'adBlockNetwork', false);
  assert.equal(s.globalDefaultTier, 'custom');
  assert.equal(RW.getEffectiveConfig(s, 'example.com').adBlockNetwork, true);
  assert.equal(RW.getEffectiveConfig(s, 'elsewhere.com').adBlockNetwork, false);
});

test('consent categories and the toast toggle never change the global tier', () => {
  let s = RW.setGlobalCustomOption(RW.createDefaultState(), 'consentCategories', { functional: false, analytics: true, marketing: false });
  s = RW.setGlobalCustomOption(s, 'showToastBadge', false);
  assert.equal(s.globalDefaultTier, 'balanced');
  const c = RW.getEffectiveConfig(s, 'a.com');
  assert.deepEqual(c.consentCategories, { necessary: true, functional: false, analytics: true, marketing: false });
  assert.equal(c.showToastBadge, false);
});

test('domain slider switches the site to custom; null removes it', () => {
  let s = RW.setDomainSlider(RW.createDefaultState(), 'example.com', 'cdn.tracker.net', 'allow', 1);
  const p = s.siteProfiles['example.com'];
  assert.equal(p.tier, 'custom');
  assert.deepEqual(p.domainSliderOverrides, { 'tracker.net': 'allow' });
  s = RW.setDomainSlider(s, 'example.com', 'tracker.net', null, 2);
  assert.deepEqual(s.siteProfiles['example.com'].domainSliderOverrides, {});
  assert.throws(() => RW.setDomainSlider(s, 'example.com', 'example.com', 'block', 3), /first_party/);
  assert.throws(() => RW.setDomainSlider(s, 'example.com', 'x.com', 'nuke', 3), /invalid_value/);
});

test('reset keeps hidden elements; empty profiles are pruned', () => {
  let s = RW.setSiteTier(RW.createDefaultState(), 'example.com', 'off', 1);
  s = RW.resetSiteProfile(s, 'example.com', 2);
  assert.equal(s.siteProfiles['example.com'], undefined);
  s = RW.addCosmeticSelector(s, 'example.com', '.promo', 3);
  s = RW.setSiteTier(s, 'example.com', 'strict', 4);
  s = RW.resetSiteProfile(s, 'example.com', 5);
  assert.deepEqual(s.siteProfiles['example.com'].customCosmeticSelectors, ['.promo']);
  assert.equal(s.siteProfiles['example.com'].tier, null);
  assert.equal(RW.getEffectiveConfig(s, 'example.com').source, 'global');
});

test('mutators never modify their input state', () => {
  const s = RW.createDefaultState();
  const frozen = JSON.stringify(s);
  RW.setSiteTier(s, 'a.com', 'strict', 1);
  RW.setSiteCustomOption(s, 'a.com', 'adBlockNetwork', false, 1);
  RW.setGlobalTier(s, 'custom');
  RW.setGlobalCustomOption(s, 'stripUrlParams', false);
  RW.setTrackerGlobalOverride(s, 'b.com', 'block', 1);
  assert.equal(JSON.stringify(s), frozen);
});

test('consentIntent maps choices to decisions', () => {
  const s = RW.createDefaultState();
  // Default categories keep functional cookies, so the answer is a custom choice, not reject-all.
  assert.equal(RW.consentIntent(RW.getEffectiveConfig(s, 'a.com')).decision, 'custom');
  const none = RW.setGlobalCustomOption(s, 'consentCategories', { functional: false, analytics: false, marketing: false });
  assert.equal(RW.consentIntent(RW.getEffectiveConfig(none, 'a.com')).decision, 'reject');
  const all = RW.setGlobalCustomOption(s, 'consentCategories', { functional: true, analytics: true, marketing: true });
  assert.equal(RW.consentIntent(RW.getEffectiveConfig(all, 'a.com')).decision, 'accept');
  const mixed = RW.setGlobalCustomOption(s, 'consentCategories', { functional: true, analytics: true, marketing: false });
  assert.equal(RW.consentIntent(RW.getEffectiveConfig(mixed, 'a.com')).decision, 'custom');
  const strict = RW.setSiteTier(all, 'a.com', 'strict', 1);
  const si = RW.consentIntent(RW.getEffectiveConfig(strict, 'a.com'));
  assert.equal(si.decision, 'reject');
  assert.equal(si.categories.analytics, false);
  assert.equal(RW.consentIntent(RW.getEffectiveConfig(RW.setSiteTier(s, 'a.com', 'off', 1), 'a.com')), null);
});

test('learnTracker promotes after 3 distinct first parties', () => {
  const s = RW.createDefaultState();
  assert.equal(RW.learnTracker(s, 'thirdparty.com', 'site1.com', 1).promoted, false);
  assert.equal(RW.learnTracker(s, 'thirdparty.com', 'site1.com', 2).changed, false);
  assert.equal(RW.learnTracker(s, 'thirdparty.com', 'site2.com', 3).promoted, false);
  assert.equal(s.learnedTrackers['thirdparty.com'].learnedStatus, 'allow');
  assert.equal(RW.learnTracker(s, 'thirdparty.com', 'site3.com', 4).promoted, true);
  assert.deepEqual(s.learnedTrackers['thirdparty.com'], {
    firstPartyHosts: ['site1.com', 'site2.com', 'site3.com'],
    learnedStatus: 'cookie_block',
    globalManualOverride: null,
    firstSeen: 1,
    lastSeen: 4
  });
});

test('normalizeState rejects hostile or malformed imports', () => {
  const s = RW.normalizeState({
    globalDefaultTier: 'nuclear',
    globalCustomConfig: { adBlockNetwork: 'yes', trackerHeuristicMode: 'hard_block', consentCategories: { necessary: false, marketing: 1 } },
    siteProfiles: {
      'Example.COM': { tier: 'strict', customCosmeticSelectors: ['.ok', 'body{display:none}', 'a/*x*/', '@import url(x)', 'div[foo'] },
      'not a domain': { tier: 'off' },
      'empty.com': { tier: 'bogus' }
    },
    learnedTrackers: { 'bad domain!': {}, 'ok.net': { firstPartyHosts: ['a.com', 'b.com', 'c.com', '<script>'], learnedStatus: 'weird' } },
    stats: { totalAdsBlocked: -5, totalPopupsHandled: 3.7 }
  });
  assert.equal(s.globalDefaultTier, 'balanced');
  assert.equal(s.globalCustomConfig.adBlockNetwork, true);
  assert.equal(s.globalCustomConfig.trackerHeuristicMode, 'hard_block');
  assert.equal(s.globalCustomConfig.consentCategories.necessary, true);
  assert.equal(s.globalCustomConfig.consentCategories.marketing, false);
  assert.deepEqual(Object.keys(s.siteProfiles), ['example.com']);
  assert.deepEqual(s.siteProfiles['example.com'].customCosmeticSelectors, ['.ok']);
  assert.deepEqual(Object.keys(s.learnedTrackers), ['ok.net']);
  assert.equal(s.learnedTrackers['ok.net'].learnedStatus, 'cookie_block');
  assert.deepEqual(s.stats, { totalPopupsHandled: 3, totalAdsBlocked: 0, totalTrackersRestricted: 0 });
});

test('isValidSelector blocks CSS injection', () => {
  for (const ok of ['.promo', '#ad-1', 'div[data-x="a b"] > span', 'a:not(.x)', 'li:nth-of-type(3)', '#\\31 23', 'div.md\\:flex']) assert.ok(RW.isValidSelector(ok), ok);
  for (const bad of ['', 'a{}', '} body { display:none', 'a /* */', '@media x', 'a;b', '<b>', 'a\\', 'a(', 'a]', '"open']) assert.ok(!RW.isValidSelector(bad), bad);
});

test('custom switches are remembered across presets; resume keeps sliders', () => {
  let s = RW.setSiteCustomOption(RW.createDefaultState(), 'a.com', 'cosmeticFiltering', false, 1);
  s = RW.setDomainSlider(s, 'a.com', 'x.net', 'block', 2);
  s = RW.setSiteTier(s, 'a.com', 'off', 3);
  assert.equal(RW.getEffectiveConfig(s, 'a.com').tier, 'off');
  s = RW.setSiteTier(s, 'a.com', 'custom', 4);
  assert.equal(RW.getEffectiveConfig(s, 'a.com').cosmeticFiltering, false);
  s = RW.setSiteTier(s, 'a.com', 'off', 5);
  s = RW.resetSiteProfile(s, 'a.com', 6, { keepRules: true });
  assert.equal(RW.getEffectiveConfig(s, 'a.com').tier, 'balanced');
  assert.deepEqual(s.siteProfiles['a.com'].domainSliderOverrides, { 'x.net': 'block' });
  // A switch flipped on a preset still snapshots that preset, not the remembered set.
  s = RW.setSiteTier(s, 'a.com', 'strict', 7);
  s = RW.setSiteCustomOption(s, 'a.com', 'stripUrlParams', false, 8);
  assert.equal(RW.getEffectiveConfig(s, 'a.com').cosmeticFiltering, true);
  assert.equal(RW.getEffectiveConfig(s, 'a.com').consentMode, 'strict_reject');
});

test('new installs are silent; a saved notification preference is kept', () => {
  assert.equal(RW.createDefaultState().globalCustomConfig.showToastBadge, false);
  const v1 = RW.normalizeState({ schemaVersion: 1, globalCustomConfig: { showToastBadge: true }, siteProfiles: { 'a.com': { tier: 'strict' } } });
  assert.equal(v1.globalCustomConfig.showToastBadge, true);
  assert.equal(v1.siteProfiles['a.com'].tier, 'strict');
  assert.equal(v1.operatingMode, 'full');
  assert.deepEqual(v1.aiSettings, { enabled: false, keepLoaded: true, autoOptimise: false, pageEdits: true, pageFixes: 'suggest' });
});

test('runtimeCapabilities: one precedence for Light, AI, Incognito and explicit choices', () => {
  let s = RW.setAiAutoOptimise(RW.setAiEnabled(RW.createDefaultState(), true), true);
  const caps = (st, host, ctx) => RW.runtimeCapabilities(RW.getEffectiveConfig(st, host), ctx);
  assert.deepEqual(caps(s, 'a.com'), { consent: 'full', learning: true, headerObservation: true, newsletter: 'ai', ai: true, consentAi: true, aiPausedReason: null, pageFixes: 'suggest', pageFixAi: false });
  const light = RW.setOperatingMode(s, 'light');
  assert.deepEqual(caps(light, 'a.com'), { consent: 'bounded', learning: false, headerObservation: false, newsletter: 'off', ai: false, consentAi: false, aiPausedReason: 'light', pageFixes: 'off', pageFixAi: false });
  assert.equal(caps(s, 'a.com', { incognito: true }).ai, false);
  assert.equal(caps(s, 'a.com', { incognito: true }).learning, false);
  assert.equal(caps(s, 'a.com', { incognito: true }).aiPausedReason, 'incognito');
  // Explicit per-site choices win over AI and survive Light.
  const keep = RW.setSiteNewsletter(s, 'a.com', 'keep', 1);
  assert.equal(caps(keep, 'a.com').newsletter, 'off');
  const hide = RW.setSiteNewsletter(RW.setOperatingMode(s, 'light'), 'a.com', 'hide', 1);
  assert.equal(caps(hide, 'a.com').newsletter, 'hide');
  // Site policies that do not hide anything never get automatic hiding.
  assert.equal(caps(RW.setSiteTier(s, 'a.com', 'consent_only', 1), 'a.com').newsletter, 'off');
  assert.equal(caps(RW.setSiteTier(s, 'a.com', 'off', 1), 'a.com').consent, 'off');
  assert.equal(caps(RW.setSiteCustomOption(s, 'a.com', 'cosmeticFiltering', false, 1), 'a.com').ai, false);
  assert.equal(caps(RW.createDefaultState(), 'a.com').ai, false); // AI is off by default
});

test('runtimeCapabilities: AI for unknown cookie banners is gated by mode, privacy, intent and site choice', () => {
  const on = RW.setAiAutoOptimise(RW.setAiEnabled(RW.createDefaultState(), true), true);
  const caps = (st, ctx) => RW.runtimeCapabilities(RW.getEffectiveConfig(st, 'a.com'), ctx).consentAi;
  assert.equal(caps(on), true);
  assert.equal(caps(RW.setAiEnabled(on, false)), false, 'off with on-device AI off');
  assert.equal(caps(RW.createDefaultState()), false, 'off unless automatic optimisation is on');
  assert.equal(caps(RW.setOperatingMode(on, 'light')), false, 'never in Light');
  assert.equal(caps(on, { incognito: true }), false, 'never in Incognito');
  assert.equal(caps(RW.setSiteTier(on, 'a.com', 'off', 1)), false);
  assert.equal(caps(RW.setSiteCustomOption(on, 'a.com', 'consentMode', 'off', 1)), false);
  // Nothing to refuse when every category is allowed.
  const all = RW.setGlobalCustomOption(on, 'consentCategories', { necessary: true, functional: true, analytics: true, marketing: true });
  assert.equal(caps(all), false);
  // "Don't do this on this site" is an explicit choice and survives everything else.
  const no = RW.setSiteCookieBannerAi(on, 'a.com', 'off', 1);
  assert.equal(caps(no), false);
  assert.equal(RW.getEffectiveConfig(no, 'b.com').cookieBannerAi, 'auto');
  assert.notEqual(RW.settingsEpoch(RW.getEffectiveConfig(no, 'a.com')), RW.settingsEpoch(RW.getEffectiveConfig(on, 'a.com')));
  assert.throws(() => RW.setSiteCookieBannerAi(on, 'a.com', 'sometimes', 1), /invalid_value/);
  // The code switch wins over every setting.
  RW.AI_CONSENT_ENABLED = false;
  try { assert.equal(caps(on), false); } finally { RW.AI_CONSENT_ENABLED = true; }
});

test('on-device AI is off by default, turned on on purpose, and gates automatic optimisation', () => {
  const s = RW.createDefaultState();
  assert.equal(RW.getEffectiveConfig(s, 'a.com').aiEnabled, false);
  // Automatic optimisation on its own does nothing until AI is on.
  const auto = RW.setAiAutoOptimise(s, true);
  assert.equal(RW.getEffectiveConfig(auto, 'a.com').aiPreference, false);
  const on = RW.setAiEnabled(auto, true);
  assert.equal(RW.getEffectiveConfig(on, 'a.com').aiEnabled, true);
  assert.equal(RW.getEffectiveConfig(on, 'a.com').aiPreference, true);
  assert.equal(on.aiSettings.keepLoaded, true, 'kept loaded unless the user says otherwise');
  assert.equal(RW.setAiPageSettings(on, { keepLoaded: false }).aiSettings.keepLoaded, false);
  // Saved before the switch existed: automatic optimisation on means AI was already chosen.
  assert.equal(RW.normalizeState({ aiSettings: { autoOptimise: true } }).aiSettings.enabled, true);
  assert.equal(RW.normalizeState({ aiSettings: { autoOptimise: false } }).aiSettings.enabled, false);
  assert.equal(RW.normalizeState({ aiSettings: { enabled: false, autoOptimise: true } }).aiSettings.enabled, false);
});

test('AI memory keeps a verified cookie banner answer with its label, and drops malformed ones', () => {
  let s = RW.rememberAiDecision(RW.createDefaultState(), 'a.com', 'consent|k:1234abcd|n:2', 'refuse_non_essential', 'e1', 1000, 'Only the necessary ones');
  assert.deepEqual(RW.recallAiEntry(s, 'a.com', 'consent|k:1234abcd|n:2', 'e1', 2000), { action: 'refuse_non_essential', at: 1000, epoch: 'e1', label: 'Only the necessary ones' });
  assert.equal(RW.recallAiEntry(s, 'a.com', 'consent|k:1234abcd|n:2', 'e2', 2000), null, 'settings changed');
  const bad = RW.normalizeState({ aiMemory: { decisions: { 'a.com': { 'consent|k:1|n:1': { action: 'refuse_non_essential', at: Date.now(), epoch: 'e1' } } } } });
  assert.deepEqual(bad.aiMemory.decisions, {}, 'no label, no memory');
  s = RW.forgetAiDecision(s, 'a.com', 'consent|k:1234abcd|n:2', 2000);
  assert.equal(RW.recallAiEntry(s, 'a.com', 'consent|k:1234abcd|n:2', 'e1', 2000), null);
});

test('Light is separate from site policies and switching back restores everything', () => {
  let s = RW.setAiAutoOptimise(RW.createDefaultState(), true);
  s = RW.setSiteTier(s, 'a.com', 'strict', 1);
  s = RW.setDomainSlider(s, 'b.com', 'x.net', 'block', 2);
  const before = JSON.stringify([s.siteProfiles, s.aiSettings, RW.getEffectiveConfig(s, 'a.com')]);
  const back = RW.setOperatingMode(RW.setOperatingMode(s, 'light'), 'full');
  assert.equal(JSON.stringify([back.siteProfiles, back.aiSettings, RW.getEffectiveConfig(back, 'a.com')]), before);
  assert.equal(RW.getEffectiveConfig(RW.setOperatingMode(s, 'light'), 'a.com').tier, 'strict');
  assert.throws(() => RW.setOperatingMode(s, 'turbo'), /invalid_value/);
});

test('settings epoch changes only with settings that matter', () => {
  const s = RW.setAiAutoOptimise(RW.createDefaultState(), true);
  const e = (st) => RW.settingsEpoch(RW.getEffectiveConfig(st, 'a.com'));
  assert.equal(e(s), e(RW.setTrackerGlobalOverride(s, 'x.com', 'block', 1)));
  assert.notEqual(e(s), e(RW.setSiteNewsletter(s, 'a.com', 'keep', 1)));
  assert.notEqual(e(s), e(RW.setOperatingMode(s, 'light')));
  assert.notEqual(e(s), e(RW.setSiteTier(s, 'a.com', 'strict', 1)));
});

test('automatic adjustment memory: bounded, invalidated by settings, honours undo', () => {
  const t = 1_000_000_000_000;
  let s = RW.createDefaultState();
  s = RW.rememberAiDecision(s, 'a.com', 'article|v:klaviyo|n:1', 'hide_overlay', 'e1', t);
  assert.equal(RW.recallAiDecision(s, 'a.com', 'article|v:klaviyo|n:1', 'e1', t + 1000), 'hide_overlay');
  assert.equal(RW.recallAiDecision(s, 'a.com', 'article|v:klaviyo|n:1', 'e2', t + 1000), null, 'settings changed');
  assert.equal(RW.recallAiDecision(s, 'a.com', 'article|v:klaviyo|n:1', 'e1', t + RW.AI_DECISION_TTL + 1), null, 'expired');
  assert.equal(RW.recallAiDecision(s, 'b.com', 'article|v:klaviyo|n:1', 'e1', t), null, 'other site');
  s = RW.markAiUndone(s, 'a.com', 'v:klaviyo|n:1', t);
  assert.equal(RW.isAiUndone(s, 'a.com', 'v:klaviyo|n:1', t + 86400e3), true);
  assert.equal(RW.recallAiDecision(s, 'a.com', 'article|v:klaviyo|n:1', 'e1', t), null, 'undo drops the decision');
  assert.equal(RW.isAiUndone(s, 'a.com', 'v:klaviyo|n:1', t + RW.AI_UNDO_TTL + 1), false);
  for (let i = 0; i < 50; i++) s = RW.rememberAiDecision(s, 'a.com', `other|n:${i}`, 'leave_unchanged', 'e1', t);
  assert.ok(Object.keys(s.aiMemory.decisions['a.com']).length <= 30);
  assert.deepEqual(RW.clearAiMemory(s).aiMemory, { decisions: {}, undone: {} });
  const bad = RW.normalizeState({ aiMemory: { decisions: { 'a.com': { '<x>': { action: 'hide_overlay', at: Date.now(), epoch: 'e' } }, 'not a site': {} }, undone: 7 } });
  assert.deepEqual(bad.aiMemory, { decisions: {}, undone: {} });
});

test('restoreSiteProfile undoes a described change exactly', () => {
  let s = RW.setSiteTier(RW.createDefaultState(), 'a.com', 'strict', 1);
  const snapshot = JSON.parse(JSON.stringify(s.siteProfiles['a.com']));
  s = RW.setSiteNewsletter(s, 'a.com', 'hide', 2);
  s = RW.setSiteCustomOption(s, 'a.com', 'stripUrlParams', false, 3);
  s = RW.restoreSiteProfile(s, 'a.com', snapshot, 4);
  assert.equal(s.siteProfiles['a.com'].tier, 'strict');
  assert.equal(s.siteProfiles['a.com'].newsletterPrompts, 'auto');
  assert.equal(RW.restoreSiteProfile(s, 'a.com', null, 5).siteProfiles['a.com'], undefined);
});
