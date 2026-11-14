import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();
const P = RW.PRIORITY;
const byPriority = (rules, p) => rules.filter((r) => r.priority === p);

function learned(s, domain) {
  for (const site of ['one.com', 'two.com', 'three.com']) RW.learnTracker(s, domain, site, 1);
  return s;
}

test('default state: URL stripping everywhere, no bypass rules', () => {
  const rules = RW.compileDynamicRules(RW.createDefaultState());
  assert.equal(byPriority(rules, P.SITE_BYPASS).length, 0);
  assert.equal(byPriority(rules, P.ADBLOCK_OFF).length, 0);
  assert.equal(byPriority(rules, P.STRICT_EXTRA).length, 0);
  const strip = byPriority(rules, P.URL_STRIP);
  assert.equal(strip.length, RW.URL_STRIP_REGEXES.length);
  for (const r of strip) {
    assert.equal(r.action.type, 'redirect');
    assert.ok(r.action.redirect.transform.queryTransform.removeParams.includes('fbclid'));
    assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
    assert.ok(!('excludedRequestDomains' in r.condition));
  }
  assert.ok(RW.needsStaticRulesets(RW.createDefaultState()));
});

test('Off and Consent-only sites get a top-priority allowAllRequests bypass', () => {
  let s = RW.setSiteTier(RW.createDefaultState(), 'off.com', 'off', 1);
  s = RW.setSiteTier(s, 'consent.com', 'consent_only', 1);
  s = RW.setSiteTier(s, 'strict.com', 'strict', 1);
  const rules = RW.compileDynamicRules(s);
  const bypass = byPriority(rules, P.SITE_BYPASS);
  assert.equal(bypass.length, 2);
  assert.equal(bypass[0].action.type, 'allowAllRequests');
  assert.deepEqual(bypass[0].condition.requestDomains, ['consent.com', 'off.com']);
  assert.equal(bypass[1].action.type, 'allow');
  assert.deepEqual(bypass[1].condition, { initiatorDomains: ['consent.com', 'off.com'] });
  // Those sites are excluded from URL stripping (bypass also covers it, but rules stay consistent)
  for (const r of byPriority(rules, P.URL_STRIP)) assert.deepEqual(r.condition.excludedRequestDomains, ['consent.com', 'off.com']);
  // Strict site gets the aggressive list via initiator scoping
  const strict = byPriority(rules, P.STRICT_EXTRA);
  assert.equal(strict.length, 1);
  assert.deepEqual(strict[0].condition.initiatorDomains, ['strict.com']);
  assert.equal(strict[0].condition.domainType, 'thirdParty');
  assert.ok(strict[0].condition.requestDomains.includes('googletagmanager.com'));
  assert.equal(byPriority(rules, P.STRICT_SURROGATE).length, 2);
});

test('global Consent-only inverts scoping with exclusions', () => {
  let s = RW.setGlobalTier(RW.createDefaultState(), 'consent_only');
  s = RW.setSiteTier(s, 'protected.com', 'balanced', 1);
  const rules = RW.compileDynamicRules(s);
  const bypass = byPriority(rules, P.SITE_BYPASS);
  assert.equal(bypass.length, 2);
  assert.ok(!('requestDomains' in bypass[0].condition));
  assert.deepEqual(bypass[0].condition.excludedRequestDomains, ['protected.com']);
  assert.deepEqual(bypass[1].condition, { excludedInitiatorDomains: ['protected.com'] });
  for (const r of byPriority(rules, P.URL_STRIP)) assert.deepEqual(r.condition.requestDomains, ['protected.com']);
  assert.ok(RW.needsStaticRulesets(s));
  assert.ok(!RW.needsStaticRulesets(RW.setGlobalTier(RW.createDefaultState(), 'off')));
});

test('ad-blocking off but other network engines on uses the low-priority allowAllRequests', () => {
  const s = RW.setSiteCustomOption(RW.createDefaultState(), 'video.com', 'adBlockNetwork', false, 1);
  const rules = RW.compileDynamicRules(s);
  const low = byPriority(rules, P.ADBLOCK_OFF);
  assert.equal(low.length, 2);
  assert.deepEqual(low[0].condition.requestDomains, ['video.com']);
  assert.deepEqual(low[1], Object.assign({}, low[1], { action: { type: 'allow' }, condition: { initiatorDomains: ['video.com'] } }));
  assert.ok(low[0].priority > P.STATIC_SURROGATE && low[0].priority < P.STRICT_EXTRA);
  assert.equal(byPriority(rules, P.SITE_BYPASS).length, 0);
});

test('learned trackers: Balanced strips cookies, Strict blocks, yellowlist capped, never-restrict skipped', () => {
  let s = RW.createDefaultState();
  learned(s, 'thirdparty.com');
  learned(s, 'jsdelivr.net');
  learned(s, 'stripe.com');
  s = RW.setSiteTier(s, 'hard.com', 'strict', 1);
  s = RW.setSiteTier(s, 'none.com', 'consent_only', 1);
  const rules = byPriority(RW.compileDynamicRules(s), P.HEURISTIC);
  const globalCookie = rules.find((r) => r.action.type === 'modifyHeaders' && r.condition.excludedInitiatorDomains);
  assert.deepEqual(globalCookie.condition.requestDomains, ['jsdelivr.net', 'thirdparty.com']);
  assert.deepEqual(globalCookie.condition.excludedInitiatorDomains, ['hard.com', 'none.com']);
  assert.deepEqual(globalCookie.action.requestHeaders, [{ header: 'cookie', operation: 'remove' }]);
  assert.deepEqual(globalCookie.action.responseHeaders, [{ header: 'set-cookie', operation: 'remove' }]);
  const strictBlock = rules.find((r) => r.action.type === 'block');
  assert.deepEqual(strictBlock.condition.requestDomains, ['thirdparty.com']);
  assert.deepEqual(strictBlock.condition.initiatorDomains, ['hard.com']);
  const strictCookie = rules.find((r) => r.action.type === 'modifyHeaders' && r.condition.initiatorDomains);
  assert.deepEqual(strictCookie.condition.requestDomains, ['jsdelivr.net']);
  for (const r of rules) assert.ok(!r.condition.requestDomains.includes('stripe.com'));
});

test('global manual overrides and per-site sliders sit above heuristics', () => {
  let s = learned(RW.createDefaultState(), 'thirdparty.com');
  s = RW.setTrackerGlobalOverride(s, 'ads.example', 'allow', 1);
  s = RW.setTrackerGlobalOverride(s, 'evil.example', 'block', 1);
  s = RW.setDomainSlider(s, 'shop.com', 'thirdparty.com', 'allow', 1);
  s = RW.setDomainSlider(s, 'shop.com', 'cdn.tracker.net', 'cookie_block', 1);
  s = RW.setDomainSlider(s, 'shop.com', 'bad.net', 'block', 1);
  const rules = RW.compileDynamicRules(s);
  assert.deepEqual(byPriority(rules, P.GLOBAL_ALLOW)[0].condition.requestDomains, ['ads.example']);
  assert.deepEqual(byPriority(rules, P.GLOBAL_BLOCK)[0].condition.requestDomains, ['evil.example']);
  const allow = byPriority(rules, P.SLIDER_ALLOW)[0];
  assert.equal(allow.action.type, 'allow');
  assert.deepEqual(allow.condition.requestDomains, ['thirdparty.com', 'tracker.net']);
  assert.deepEqual(allow.condition.initiatorDomains, ['shop.com']);
  const cookie = byPriority(rules, P.SLIDER_COOKIE_MOD)[0];
  assert.equal(cookie.action.type, 'modifyHeaders');
  assert.deepEqual(cookie.condition.requestDomains, ['tracker.net']);
  assert.deepEqual(byPriority(rules, P.SLIDER_BLOCK)[0].condition.requestDomains, ['bad.net']);
  assert.ok(P.SLIDER_ALLOW > P.GLOBAL_BLOCK && P.GLOBAL_ALLOW > P.HEURISTIC && P.SITE_BYPASS > P.SLIDER_BLOCK);
});

test('rule ids are sequential and unique', () => {
  let s = learned(RW.createDefaultState(), 'thirdparty.com');
  s = RW.setSiteTier(s, 'a.com', 'off', 1);
  s = RW.setSiteTier(s, 'b.com', 'strict', 1);
  const rules = RW.compileDynamicRules(s);
  assert.deepEqual(rules.map((r) => r.id), rules.map((_, i) => i + 1));
});

test('URL strip regexes match tracking params and nothing else', () => {
  const res = RW.URL_STRIP_REGEXES.map((r) => new RegExp(r));
  const hit = (u) => res.some((re) => re.test(u));
  assert.ok(hit('https://a.com/?utm_source=x'));
  assert.ok(hit('https://a.com/p?id=1&fbclid=abc'));
  assert.ok(hit('https://a.com/p?gclid=1'));
  assert.ok(!hit('https://a.com/p?id=1&ref=home'));
  assert.ok(!hit('https://a.com/utm_source'));
  for (const p of RW.URL_TRACKING_PARAMS) {
    if (p.startsWith('utm_')) continue;
    assert.ok(hit(`https://a.com/?${p}=1`), `regex coverage for ${p}`);
  }
});

test('domainActionFor mirrors the priority ladder', () => {
  let s = learned(RW.createDefaultState(), 'thirdparty.com');
  const bal = RW.getEffectiveConfig(s, 'site.com');
  assert.deepEqual(RW.domainActionFor(s, bal, 'pixel.thirdparty.com'), { action: 'cookie_block', source: 'learned' });
  assert.deepEqual(RW.domainActionFor(s, bal, 'securepubads.g.doubleclick.net'), { action: 'block', source: 'filter_list' });
  assert.deepEqual(RW.domainActionFor(s, bal, 'googletagmanager.com'), { action: 'allow', source: 'none' });
  s = RW.setSiteTier(s, 'site.com', 'strict', 1);
  const strict = RW.getEffectiveConfig(s, 'site.com');
  assert.deepEqual(RW.domainActionFor(s, strict, 'thirdparty.com'), { action: 'block', source: 'learned' });
  assert.deepEqual(RW.domainActionFor(s, strict, 'www.googletagmanager.com'), { action: 'block', source: 'strict_list' });
  s = RW.setDomainSlider(s, 'site.com', 'doubleclick.net', 'allow', 2);
  assert.deepEqual(RW.domainActionFor(s, RW.getEffectiveConfig(s, 'site.com'), 'doubleclick.net'), { action: 'allow', source: 'site_override' });
  s = RW.setSiteTier(s, 'site.com', 'consent_only', 3);
  assert.deepEqual(RW.domainActionFor(s, RW.getEffectiveConfig(s, 'site.com'), 'doubleclick.net'), { action: 'allow', source: 'paused' });
});
