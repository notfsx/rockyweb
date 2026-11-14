// Turns the stored state into declarativeNetRequest dynamic rules. Priority ladder (higher wins):
//   20000 sites with every network engine off   5000-5002 per-site domain choices
//    4000-4002 global choices for trackers       3000 learned trackers
//    2000 tracking-parameter removal             1000-1001 strict list + GTM stand-in
//     100 ad blocking off on a site              1-2 static lists and stand-ins
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const PRIORITY = Object.freeze({
    STATIC: 1,
    STATIC_SURROGATE: 2,
    ADBLOCK_OFF: 100,
    STRICT_EXTRA: 1000,
    STRICT_SURROGATE: 1001,
    URL_STRIP: 2000,
    HEURISTIC: 3000,
    GLOBAL_ALLOW: 4000,
    GLOBAL_COOKIE_MOD: 4001,
    GLOBAL_BLOCK: 4002,
    SLIDER_ALLOW: 5000,
    SLIDER_COOKIE_MOD: 5001,
    SLIDER_BLOCK: 5002,
    SITE_BYPASS: 20000
  });

  const COOKIE_STRIP_ACTION = Object.freeze({
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'cookie', operation: 'remove' }],
    responseHeaders: [{ header: 'set-cookie', operation: 'remove' }]
  });

  // Kept short to stay inside the RE2 2 KB limit.
  const URL_STRIP_REGEXES = [
    '[?&]utm_[a-z_-]+=',
    '[?&](?:fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|igshid|li_fat_id)=',
    '[?&](?:mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|oly_anon_id|oly_enc_id)=',
    '[?&](?:vero_id|vero_conv|wickedid|rb_clickid|s_cid|_openstat|epik|irclickid|srsltid)='
  ];

  const ruleDomain = (d) => typeof d === 'string' && RW.isValidDomain(d) && !d.includes(':');
  const uniqSorted = (arr) => [...new Set(arr.filter(ruleDomain))].sort();

  function profileConfigs(state) {
    return Object.keys(state.siteProfiles)
      .filter(ruleDomain)
      .sort()
      .map((siteKey) => ({ siteKey, config: RW.getEffectiveConfig(state, siteKey) }));
  }

  const isAggressive = (c) => !!(c.adBlockNetwork && c.aggressiveFiltering);

  // requestDomains/excludedRequestDomains -> initiatorDomains/excludedInitiatorDomains
  function renameScope(scope) {
    const out = {};
    if (scope.requestDomains) out.initiatorDomains = scope.requestDomains;
    if (scope.excludedRequestDomains) out.excludedInitiatorDomains = scope.excludedRequestDomains;
    return out;
  }

  function scoped(G, sites, predicate, field, build) {
    const included = `${field === 'Request' ? 'request' : 'initiator'}Domains`;
    const excluded = `excluded${field}Domains`;
    if (predicate(G)) {
      const ex = uniqSorted(sites.filter((s) => !predicate(s.config)).map((s) => s.siteKey));
      return build(ex.length ? { [excluded]: ex } : {});
    }
    const inc = uniqSorted(sites.filter((s) => predicate(s.config)).map((s) => s.siteKey));
    return inc.length ? build({ [included]: inc }) : [];
  }

  function learnedPartitions(state) {
    const learned = [];
    const overrides = { allow: [], cookie_block: [], block: [] };
    for (const [domain, rec] of Object.entries(state.learnedTrackers)) {
      if (!ruleDomain(domain)) continue;
      if (rec.globalManualOverride) {
        overrides[rec.globalManualOverride].push(domain);
        continue;
      }
      if (rec.learnedStatus === 'allow') continue;
      if (RW.isNeverRestrict(domain)) continue;
      learned.push(domain);
    }
    learned.sort();
    return {
      learned,
      capped: learned.filter((d) => RW.isCookieBlockCapped(d)),
      uncapped: learned.filter((d) => !RW.isCookieBlockCapped(d)),
      overrides: {
        allow: uniqSorted(overrides.allow),
        cookie_block: uniqSorted(overrides.cookie_block),
        block: uniqSorted(overrides.block)
      }
    };
  }

  function heuristicLists(parts, mode) {
    if (mode === 'cookie_strip') return { cookie: parts.learned, block: [] };
    if (mode === 'hard_block') return { cookie: parts.capped, block: parts.uncapped };
    return { cookie: [], block: [] };
  }

  function compileDynamicRules(state) {
    const G = RW.getEffectiveConfig(state, null);
    const sites = profileConfigs(state);
    const rules = [];
    const push = (r) => {
      for (const one of [].concat(r)) rules.push(Object.assign({ id: rules.length + 1 }, one));
    };

    // Each bypass pairs allowAllRequests (whole frame tree) with an initiator allow rule. Chrome can match
    // an early parser-discovered request before the frame's allowAllRequests state exists.
    const bypassPair = (priority) => (scope) => [
      {
        priority,
        action: { type: 'allowAllRequests' },
        condition: Object.assign({ resourceTypes: ['main_frame'] }, scope)
      },
      {
        priority,
        action: { type: 'allow' },
        condition: renameScope(scope)
      }
    ];
    push(scoped(G, sites, (c) => !RW.anyNetwork(c), 'Request', bypassPair(PRIORITY.SITE_BYPASS)));
    push(scoped(G, sites, (c) => RW.anyNetwork(c) && !c.adBlockNetwork, 'Request', bypassPair(PRIORITY.ADBLOCK_OFF)));

    // strict list
    push(scoped(G, sites, isAggressive, 'Initiator', (scope) => {
      const out = [{
        priority: PRIORITY.STRICT_EXTRA,
        action: { type: 'block' },
        condition: Object.assign({ requestDomains: uniqSorted(RW.STRICT_EXTRA_DOMAINS), domainType: 'thirdParty' }, scope)
      }];
      for (const s of RW.SURROGATES.filter((x) => x.ruleset === 'strict')) {
        out.push({
          priority: PRIORITY.STRICT_SURROGATE,
          action: { type: 'redirect', redirect: { extensionPath: s.path } },
          condition: Object.assign({ urlFilter: s.urlFilter, resourceTypes: ['script'], domainType: 'thirdParty' }, scope)
        });
      }
      return out;
    }));

    // tracking parameters
    push(scoped(G, sites, (c) => !!c.stripUrlParams, 'Request', (scope) => URL_STRIP_REGEXES.map((regexFilter) => ({
      priority: PRIORITY.URL_STRIP,
      action: {
        type: 'redirect',
        redirect: { transform: { queryTransform: { removeParams: RW.URL_TRACKING_PARAMS.slice() } } }
      },
      condition: Object.assign({ regexFilter, resourceTypes: ['main_frame'] }, scope)
    }))));

    // learned trackers, grouped by each site's tracker mode
    const parts = learnedPartitions(state);
    const emitHeuristic = (lists, scope) => {
      const out = [];
      if (lists.cookie.length) {
        out.push({
          priority: PRIORITY.HEURISTIC,
          action: COOKIE_STRIP_ACTION,
          condition: Object.assign({ requestDomains: lists.cookie, domainType: 'thirdParty' }, scope)
        });
      }
      if (lists.block.length) {
        out.push({
          priority: PRIORITY.HEURISTIC,
          action: { type: 'block' },
          condition: Object.assign({ requestDomains: lists.block, domainType: 'thirdParty' }, scope)
        });
      }
      return out;
    };
    if (G.trackerHeuristicMode !== 'off') {
      const ex = uniqSorted(sites.filter((s) => s.config.trackerHeuristicMode !== G.trackerHeuristicMode).map((s) => s.siteKey));
      push(emitHeuristic(heuristicLists(parts, G.trackerHeuristicMode), ex.length ? { excludedInitiatorDomains: ex } : {}));
    }
    for (const mode of ['cookie_strip', 'hard_block']) {
      if (mode === G.trackerHeuristicMode) continue;
      const inc = uniqSorted(sites.filter((s) => s.config.trackerHeuristicMode === mode).map((s) => s.siteKey));
      if (inc.length) push(emitHeuristic(heuristicLists(parts, mode), { initiatorDomains: inc }));
    }

    // global choices from the trackers page
    const ov = parts.overrides;
    const allowLike = uniqSorted(ov.allow.concat(ov.cookie_block));
    if (allowLike.length) {
      push({ priority: PRIORITY.GLOBAL_ALLOW, action: { type: 'allow' }, condition: { requestDomains: allowLike, domainType: 'thirdParty' } });
    }
    if (ov.cookie_block.length) {
      push({ priority: PRIORITY.GLOBAL_COOKIE_MOD, action: COOKIE_STRIP_ACTION, condition: { requestDomains: ov.cookie_block, domainType: 'thirdParty' } });
    }
    if (ov.block.length) {
      push({ priority: PRIORITY.GLOBAL_BLOCK, action: { type: 'block' }, condition: { requestDomains: ov.block, domainType: 'thirdParty' } });
    }

    // per-site domain choices
    for (const { siteKey, config } of sites) {
      if (!RW.anyNetwork(config)) continue;
      const by = { allow: [], cookie_block: [], block: [] };
      for (const [d, st] of Object.entries(config.domainSliderOverrides)) if (by[st]) by[st].push(d);
      const scope = { initiatorDomains: [siteKey], domainType: 'thirdParty' };
      const allowish = uniqSorted(by.allow.concat(by.cookie_block));
      if (allowish.length) {
        push({ priority: PRIORITY.SLIDER_ALLOW, action: { type: 'allow' }, condition: Object.assign({ requestDomains: allowish }, scope) });
      }
      const cookie = uniqSorted(by.cookie_block);
      if (cookie.length) {
        push({ priority: PRIORITY.SLIDER_COOKIE_MOD, action: COOKIE_STRIP_ACTION, condition: Object.assign({ requestDomains: cookie }, scope) });
      }
      const block = uniqSorted(by.block);
      if (block.length) {
        push({ priority: PRIORITY.SLIDER_BLOCK, action: { type: 'block' }, condition: Object.assign({ requestDomains: block }, scope) });
      }
    }

    return rules;
  }

  function needsStaticRulesets(state) {
    const G = RW.getEffectiveConfig(state, null);
    if (G.adBlockNetwork) return true;
    return profileConfigs(state).some((s) => s.config.adBlockNetwork);
  }

  function domainActionFor(state, cfg, domain) {
    const d = RW.baseDomain(domain);
    if (!cfg || !RW.anyNetwork(cfg)) return { action: 'allow', source: 'paused' };
    const slider = cfg.domainSliderOverrides && cfg.domainSliderOverrides[d];
    if (slider) return { action: slider, source: 'site_override' };
    const rec = state.learnedTrackers[d];
    if (rec && rec.globalManualOverride) return { action: rec.globalManualOverride, source: 'global_override' };

    let heuristic = null;
    if (rec && rec.learnedStatus !== 'allow' && !RW.isNeverRestrict(d) && cfg.trackerHeuristicMode !== 'off') {
      heuristic = cfg.trackerHeuristicMode === 'hard_block' && !RW.isCookieBlockCapped(d) ? 'block' : 'cookie_block';
    }
    if (heuristic === 'block') return { action: 'block', source: 'learned' };
    if (cfg.adBlockNetwork && (RW.isListedAd(domain) || RW.isListedTracker(domain))) return { action: 'block', source: 'filter_list' };
    if (isAggressive(cfg) && RW.isStrictExtra(domain)) return { action: 'block', source: 'strict_list' };
    if (heuristic === 'cookie_block') return { action: 'cookie_block', source: 'learned' };
    return { action: 'allow', source: rec ? 'observed' : 'none' };
  }

  Object.assign(RW, {
    PRIORITY,
    URL_STRIP_REGEXES,
    compileDynamicRules,
    needsStaticRulesets,
    domainActionFor
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
