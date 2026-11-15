// Rockyweb options page. Each nav item is its own page (hash routing). All writes go through the background.
(() => {
  'use strict';

  const RW = window.RockyShared;
  const A = RW.ACTIONS;
  const { h, send, seg, onOff, toggle, fmt, timeAgo, errorText } = RW.UI;
  const $ = (id) => document.getElementById(id);

  const PAGES = ['protection', 'cookies', 'custom', 'websites', 'trackers', 'hidden', 'data'];
  const MODE_LABEL = { off: 'off', consent_only: 'consent', balanced: 'balanced', strict: 'strict', custom: 'custom' };
  const HEURISTIC_TEXT = { off: 'ignored', cookie_strip: 'cookies stripped', hard_block: 'blocked' };
  const CONSENT_TEXT = { off: 'left alone', custom_categories: 'your choices', strict_reject: 'reject all' };
  const OVERRIDE_TEXT = { allow: 'allow', cookie_block: 'block cookies', block: 'block' };

  let S = null;
  let diag = null;
  const ui = { siteQuery: '', trackerQuery: '', trackerFilter: 'all', trackerLimit: 200 };

  // ---------------------------------------------------------------- helpers

  let toastTimer = 0;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function load() {
    try {
      const r = await send(A.GET_OPTIONS_STATE);
      S = r.state;
      diag = r.diagnostics;
      renderAll();
    } catch (err) {
      toast(errorText(err), true);
    }
  }

  async function act(action, payload, okMsg) {
    try {
      await send(action, payload);
      if (okMsg) toast(okMsg);
    } catch (err) {
      toast(errorText(err), true);
    }
    await load();
  }

  // Accepts a URL or a bare domain and returns the site key.
  function siteKeyFromInput(value) {
    let v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    try {
      v = new URL(v.includes('://') ? v : `https://${v}`).hostname;
    } catch (_) {
      return '';
    }
    const key = RW.siteKeyForHost(v);
    return RW.isValidDomain(key) ? key : '';
  }

  const setting = (title, desc, control) => h('div', { class: 'setting' },
    h('div', { class: 'setting-text' }, h('h3', { text: title }), desc ? h('p', { text: desc }) : null),
    h('div', { class: 'setting-ctl' }, control));

  // ---------------------------------------------------------------- routing

  function showPage() {
    const id = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'protection';
    for (const p of PAGES) $(p).hidden = p !== id;
    for (const a of document.querySelectorAll('#nav a')) {
      if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- pages

  function renderProtection() {
    const tier = S.globalDefaultTier;
    $('tierButtons').replaceChildren(seg(
      RW.TIER_ORDER.map((t) => ({ value: t, label: MODE_LABEL[t], title: RW.TIER_META[t].name })),
      tier,
      (t) => act(A.SET_GLOBAL_TIER, { tier: t }, `default mode: ${MODE_LABEL[t]}`),
      'Default protection mode', false, 'btns'));
    $('tierDescription').textContent = RW.TIER_META[tier].description;
    const cfg = RW.getEffectiveConfig(S, null);
    const fact = (label, value, on) => h('div', {}, h('dt', { text: label }), h('dd', { class: on ? null : 'off', text: value }));
    $('tierFacts').replaceChildren(
      fact('cookie popups', CONSENT_TEXT[cfg.consentMode], cfg.consentMode !== 'off'),
      fact('known ads & trackers', cfg.adBlockNetwork ? 'blocked' : 'allowed', cfg.adBlockNetwork),
      fact('learned trackers', HEURISTIC_TEXT[cfg.trackerHeuristicMode], cfg.trackerHeuristicMode !== 'off'),
      fact('ad slots', cfg.cosmeticFiltering ? 'hidden' : 'shown', cfg.cosmeticFiltering),
      fact('annoyances', cfg.aggressiveFiltering ? 'hidden' : 'shown', cfg.aggressiveFiltering),
      fact('tracking links', cfg.stripUrlParams ? 'cleaned' : 'untouched', cfg.stripUrlParams));

    $('operatingButtons').replaceChildren(seg(
      ['full', 'light'].map((m) => ({ value: m, label: m, title: RW.OPERATING_META[m].description })),
      S.operatingMode,
      (m) => act(A.SET_OPERATING_MODE, { mode: m }, m === 'light' ? 'Light mode is on' : 'Full mode is on'),
      'How hard Rockyweb works', false, 'btns'));
    $('operatingDescription').textContent = RW.OPERATING_META[S.operatingMode].description;
    renderAi();
  }

  // ---- automatic optimisation (Chrome's on-device AI)
  // Opening this page only calls availability(). A model download starts only from the user's click.

  const SETUP_KEY = 'aiSetupInProgress';
  const ai = { availability: null, setup: 'idle', progress: 0, error: '', ctrl: null, otherSetup: false, pollTimer: 0 };

  async function checkAi() {
    if (typeof self.LanguageModel === 'undefined' || typeof LanguageModel.availability !== 'function') {
      ai.availability = 'absent';
    } else {
      try { ai.availability = await LanguageModel.availability(RW.AI_MODEL_OPTIONS); } catch (_) { ai.availability = 'unavailable'; }
    }
    const flag = await chrome.storage.session.get(SETUP_KEY).catch(() => ({}));
    ai.otherSetup = !!flag[SETUP_KEY] && ai.setup !== 'downloading';
    clearTimeout(ai.pollTimer);
    if ((ai.availability === 'downloading' || ai.otherSetup) && document.visibilityState === 'visible') ai.pollTimer = setTimeout(checkAi, 4000);
    renderAi();
  }

  function aiState() {
    const pref = !!S.aiSettings.autoOptimise;
    const a = ai.availability;
    if (S.operatingMode === 'light') {
      return { disabled: true, text: pref ? 'AI is paused in Light mode. Your choice is kept and resumes in Full mode.' : 'AI is paused in Light mode.' };
    }
    if (a === null) return { disabled: true, text: 'Checking whether on-device AI is available…' };
    if (a === 'absent' || a === 'unavailable' || a === 'error') return { disabled: true, warn: true, text: 'On-device AI is unavailable in this browser or on this device.' };
    if (ai.setup === 'downloading') {
      return { disabled: true, text: `Chrome is downloading the on-device model${ai.progress ? ` (${Math.round(ai.progress * 100)}%)` : ''}. You can keep browsing.` };
    }
    if (a === 'downloading' || ai.otherSetup) return { disabled: true, text: 'Chrome is downloading the on-device model. This page updates when it is ready.' };
    if (a === 'downloadable') {
      return { disabled: false, text: pref ? 'On, but Chrome still needs to download its on-device model.' : 'Chrome needs to download its on-device model once when you turn this on.' };
    }
    return { disabled: false, text: pref ? 'On. Adjustments happen quietly; undo them from the toolbar.' : 'Off.' };
  }

  function renderAi() {
    if (!S) return;
    const st = aiState();
    const pref = !!S.aiSettings.autoOptimise;
    const sw = toggle(pref, (v) => onAiToggle(v), 'Automatically optimise protection for each site', st.disabled);
    sw.setAttribute('aria-describedby', 'aiStatus');
    $('aiToggle').replaceChildren(sw);
    const status = $('aiStatus');
    status.textContent = ai.error || st.text;
    status.classList.toggle('warn', !!(ai.error || st.warn));

    const setup = $('aiSetup');
    setup.replaceChildren();
    const needsDownload = ai.availability === 'downloadable' && S.operatingMode !== 'light';
    if (ai.setup === 'confirm' || (pref && needsDownload && ai.setup === 'idle')) {
      setup.append(
        h('p', { text: 'Chrome will download Gemini Nano, its on-device model. It is a large download (usually a few gigabytes) managed and stored by Chrome. Rockyweb sends nothing to any server.' }),
        h('button', { class: 'btn on', type: 'button', onclick: startDownload, text: 'download and turn on' }),
        h('button', { class: 'btn', type: 'button', text: 'cancel', onclick: () => { ai.setup = 'idle'; if (pref) act(A.SET_AI_AUTO_OPTIMISE, { enabled: false }); else renderAi(); } }));
    } else if (ai.setup === 'downloading') {
      const bar = h('span', { style: { width: `${Math.round(ai.progress * 100)}%` } });
      setup.append(
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Model download', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ai.progress * 100)) }, bar),
        h('button', { class: 'btn', type: 'button', text: 'cancel download', onclick: () => ai.ctrl && ai.ctrl.abort() }));
    }
    setup.hidden = !setup.childNodes.length;
  }

  function onAiToggle(enabled) {
    ai.error = '';
    if (!enabled) { ai.setup = 'idle'; act(A.SET_AI_AUTO_OPTIMISE, { enabled: false }, 'Automatic optimisation is off'); return; }
    if (ai.availability === 'available') { act(A.SET_AI_AUTO_OPTIMISE, { enabled: true }, 'Automatic optimisation is on'); return; }
    if (ai.availability === 'downloadable') { ai.setup = 'confirm'; renderAi(); return; }
    renderAi();
  }

  // Runs from the user's click, which Chrome requires before it downloads the model.
  async function startDownload() {
    if (ai.setup === 'downloading' || ai.otherSetup) return;
    ai.setup = 'downloading';
    ai.progress = 0;
    ai.error = '';
    ai.ctrl = new AbortController();
    const ctrl = ai.ctrl;
    let created;
    try {
      created = LanguageModel.create(Object.assign({}, RW.AI_MODEL_OPTIONS, {
        signal: ctrl.signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            ai.progress = e.total ? e.loaded / e.total : e.loaded;
            renderAi();
          });
        }
      }));
    } catch (_) {
      created = Promise.reject(new Error('create_failed'));
    }
    chrome.storage.session.set({ [SETUP_KEY]: Date.now() }).catch(() => {});
    renderAi();
    send(A.SET_AI_AUTO_OPTIMISE, { enabled: true }).catch(() => {});
    try {
      const session = await created;
      session.destroy(); // only needed the download; inference runs in the background
      toast('On-device AI is ready. Automatic optimisation is on.');
    } catch (_) {
      ai.error = ctrl.signal.aborted ? 'Download cancelled. Automatic optimisation stays off.' : 'Chrome could not set up the on-device model. Please try again later.';
      await send(A.SET_AI_AUTO_OPTIMISE, { enabled: false }).catch(() => {});
    } finally {
      ai.setup = 'idle';
      ai.ctrl = null;
      await chrome.storage.session.remove(SETUP_KEY).catch(() => {});
      await load();
      checkAi();
    }
  }

  function renderCookies() {
    const cats = S.globalCustomConfig.consentCategories;
    const setCat = (key, value) => act(A.SET_GLOBAL_CUSTOM_OPTION, { key: 'consentCategories', value: Object.assign({}, cats, { [key]: value }) });
    $('consentRows').replaceChildren(
      setting('strictly necessary', 'Needed for the site to work. Always allowed.', h('span', { class: 'locked', text: 'always on' })),
      setting('functional', 'Preferences like language, region or chat widgets.', onOff(cats.functional, (v) => setCat('functional', v), 'Functional cookies')),
      setting('analytics', 'Statistics and performance measurement.', onOff(cats.analytics, (v) => setCat('analytics', v), 'Analytics cookies')),
      setting('marketing', 'Advertising, personalisation and social media tracking.', onOff(cats.marketing, (v) => setCat('marketing', v), 'Marketing cookies')),
      setting('confirmation', 'A small note in the corner when a popup was handled.', onOff(S.globalCustomConfig.showToastBadge, (v) => act(A.SET_GLOBAL_CUSTOM_OPTION, { key: 'showToastBadge', value: v }), 'Show confirmation note'))
    );
  }

  function renderCustom() {
    const g = RW.getEffectiveConfig(S, null);
    const set = (key, value) => act(A.SET_GLOBAL_CUSTOM_OPTION, { key, value }, S.globalDefaultTier !== 'custom' ? 'default mode is now custom' : null);
    $('engineRows').replaceChildren(
      setting('cookie popups', 'How popups are answered.', seg([
        { value: 'off', label: 'off' }, { value: 'custom_categories', label: 'my choices' }, { value: 'strict_reject', label: 'reject all' }
      ], g.consentMode, (v) => set('consentMode', v), 'Cookie consent mode', false, 'btns')),
      setting('ad blocking', 'Blocks known ad networks and analytics domains.', onOff(g.adBlockNetwork, (v) => set('adBlockNetwork', v), 'Network blocking')),
      setting('learned trackers', 'Stripping cookies is safe. Blocking can break embeds on some sites.', seg([
        { value: 'off', label: 'off' }, { value: 'cookie_strip', label: 'strip cookies' }, { value: 'hard_block', label: 'block' }
      ], g.trackerHeuristicMode, (v) => set('trackerHeuristicMode', v), 'Learned tracker handling', false, 'btns')),
      setting('hide ads', 'Hides empty ad slots and ad containers.', onOff(g.cosmeticFiltering, (v) => set('cosmeticFiltering', v), 'Element hiding')),
      setting('annoyances', 'Stricter block list, social widgets, newsletter and push popups.', onOff(g.aggressiveFiltering, (v) => set('aggressiveFiltering', v), 'Aggressive filters')),
      setting('clean links', 'Removes utm_*, fbclid, gclid and similar from links you open.', onOff(g.stripUrlParams, (v) => set('stripUrlParams', v), 'Strip tracking parameters'))
    );
  }

  function tierSelect(site, current) {
    const sel = h('select', { class: 'select', 'aria-label': `Mode for ${site}` },
      h('option', { value: '', selected: !current, text: `default (${MODE_LABEL[S.globalDefaultTier]})` }),
      RW.TIER_ORDER.map((t) => h('option', { value: t, selected: t === current, text: MODE_LABEL[t] })));
    sel.addEventListener('change', () => {
      if (sel.value) act(A.SET_SITE_TIER, { siteKey: site, tier: sel.value }, `${site}: ${MODE_LABEL[sel.value]}`);
      else act(A.RESET_SITE_PROFILE, { siteKey: site }, `${site} follows the default`);
    });
    return sel;
  }

  function renderWebsites() {
    const wrap = $('siteList');
    const q = ui.siteQuery.trim().toLowerCase();
    const entries = Object.entries(S.siteProfiles)
      .filter(([k]) => !q || k.includes(q))
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    if (!entries.length) {
      wrap.replaceChildren(h('div', { class: 'empty', text: q ? 'No website matches.' : 'No website has its own settings yet.' }));
      return;
    }
    wrap.replaceChildren(...entries.map(([site, p]) => {
      const notes = [];
      const sliders = Object.keys(p.domainSliderOverrides || {}).length;
      if (sliders) notes.push(`${sliders} domain choice${sliders === 1 ? '' : 's'}`);
      if (p.customCosmeticSelectors.length) notes.push(`${p.customCosmeticSelectors.length} hidden`);
      if (p.newsletterPrompts === 'hide') notes.push('newsletter prompts hidden');
      if (p.newsletterPrompts === 'keep') notes.push('newsletter prompts left alone');
      notes.push(timeAgo(p.updatedAt));
      return h('div', { class: 'item' },
        h('span', { class: 'name', title: site, text: site }),
        tierSelect(site, p.tier),
        h('span', { class: 'meta', title: Object.entries(p.domainSliderOverrides).map(([d, s]) => `${d}: ${OVERRIDE_TEXT[s]}`).join('\n') || null, text: notes.join(' · ') }),
        h('button', { class: 'textbtn act', type: 'button', text: 'remove', title: `Forget all settings for ${site}`, onclick: () => act(A.DELETE_SITE_PROFILE, { siteKey: site }, `removed ${site}`) }));
    }));
  }

  function renderTrackers() {
    const all = Object.entries(S.learnedTrackers);
    const learned = all.filter(([, r]) => r.learnedStatus !== 'allow' && !r.globalManualOverride).length;
    const overridden = all.filter(([, r]) => r.globalManualOverride).length;
    $('trackerSummary').replaceChildren(
      h('b', { text: fmt(all.length) }), ' domains seen · ',
      h('b', { text: fmt(learned) }), ' learned trackers · ',
      h('b', { text: fmt(overridden) }), ' with your choice');

    $('trackerFilter').replaceChildren(seg([
      { value: 'all', label: 'all' }, { value: 'learned', label: 'learned' },
      { value: 'observing', label: 'watching' }, { value: 'overridden', label: 'yours' }
    ], ui.trackerFilter, (v) => { ui.trackerFilter = v; ui.trackerLimit = 200; renderTrackers(); }, 'Filter trackers'));

    const q = ui.trackerQuery.trim().toLowerCase();
    const list = all.filter(([d, r]) => {
      if (q && !d.includes(q)) return false;
      if (ui.trackerFilter === 'learned') return r.learnedStatus !== 'allow' && !r.globalManualOverride;
      if (ui.trackerFilter === 'observing') return r.learnedStatus === 'allow' && !r.globalManualOverride;
      if (ui.trackerFilter === 'overridden') return !!r.globalManualOverride;
      return true;
    }).sort((a, b) =>
      (b[1].learnedStatus !== 'allow') - (a[1].learnedStatus !== 'allow') ||
      b[1].firstPartyHosts.length - a[1].firstPartyHosts.length ||
      a[0].localeCompare(b[0]));

    const wrap = $('trackerList');
    if (!list.length) {
      wrap.replaceChildren(h('div', { class: 'empty', text: all.length ? 'No domain matches.' : 'Nothing learned yet. Trackers that follow you between websites show up here.' }));
      return;
    }
    const rows = list.slice(0, ui.trackerLimit).map(([domain, r]) => {
      const sel = h('select', { class: 'select', 'aria-label': `Your choice for ${domain}` },
        h('option', { value: '', selected: !r.globalManualOverride, text: 'automatic' }),
        ['allow', 'cookie_block', 'block'].map((v) => h('option', { value: v, selected: r.globalManualOverride === v, text: OVERRIDE_TEXT[v] })));
      sel.addEventListener('change', () => act(A.SET_TRACKER_GLOBAL_OVERRIDE, { domain, value: sel.value || null }, `${domain}: ${sel.value ? OVERRIDE_TEXT[sel.value] : 'automatic'}`));
      const n = r.firstPartyHosts.length;
      return h('div', { class: 'item tracker-item' },
        h('span', { class: 'name', title: domain, text: domain }),
        h('span', { class: 'meta', title: r.firstPartyHosts.join('\n'), text: `${n >= 12 ? '12+' : n} site${n === 1 ? '' : 's'}` }),
        h('span', { class: `meta status-${r.learnedStatus}`, text: r.learnedStatus === 'allow' ? 'watching' : 'learned' }),
        sel,
        h('button', { class: 'textbtn act', type: 'button', text: 'forget', onclick: () => act(A.FORGET_TRACKER, { domain }, `forgot ${domain}`) }));
    });
    if (list.length > ui.trackerLimit) {
      rows.push(h('div', { class: 'more' }, h('button', {
        class: 'btn', type: 'button', text: `show ${Math.min(200, list.length - ui.trackerLimit)} more`,
        onclick: () => { ui.trackerLimit += 200; renderTrackers(); }
      })));
    }
    wrap.replaceChildren(...rows);
  }

  function renderHidden() {
    const wrap = $('hiddenList');
    const sites = Object.entries(S.siteProfiles).filter(([, p]) => p.customCosmeticSelectors.length).sort((a, b) => a[0].localeCompare(b[0]));
    if (!sites.length) {
      wrap.replaceChildren(h('div', { class: 'empty', text: 'No hidden elements yet.' }));
      return;
    }
    wrap.replaceChildren(...sites.map(([site, p]) => h('div', { class: 'group' },
      h('div', { class: 'group-head' }, h('h3', { text: site }), h('span', { text: `${p.customCosmeticSelectors.length} hidden` })),
      p.customCosmeticSelectors.map((sel) => h('div', { class: 'sel' },
        h('code', { title: sel, text: sel }),
        h('button', {
          class: 'textbtn', type: 'button', text: 'show again', 'aria-label': `Show ${sel} on ${site} again`,
          onclick: () => act(A.REMOVE_COSMETIC_SELECTOR, { siteKey: site, selector: sel }, 'Shows again after a reload')
        }))))));
  }

  function renderData() {
    const sites = new Set([...Object.keys(S.aiMemory.decisions), ...Object.keys(S.aiMemory.undone)]);
    $('aiMemoryText').textContent = `Decisions are remembered for a week and undos for 30 days, per website. Currently ${sites.size} website${sites.size === 1 ? '' : 's'}.`;
    const s = S.stats;
    const stat = (label, v) => h('div', {}, h('div', { class: 'stat-l', text: label }), h('div', { class: 'stat-v', text: fmt(v) }));
    $('statGrid').replaceChildren(
      stat('cookie popups', s.totalPopupsHandled),
      stat('ads blocked', s.totalAdsBlocked),
      stat('trackers stopped', s.totalTrackersRestricted));
    $('aboutPanel').replaceChildren(
      h('p', {}, 'rockyweb ', h('b', { text: `v${diag.version}` }),
        ` · ${Object.keys(S.siteProfiles).length} websites · ${Object.keys(S.learnedTrackers).length} domains seen · ${diag.dynamicRuleCount} rules built from your settings`),
      h('p', { text: 'Everything stays in this browser. Rockyweb makes no network requests of its own, has no analytics and loads no remote code.' }),
      h('p', { text: 'Named after Rocky the British cocker spaniel. Font: Lexend Deca, SIL Open Font License.' }),
      h('p', { id: 'aiDiagnostics' }));
    send(A.GET_AI_STATUS).then((st) => {
      const el = $('aiDiagnostics');
      if (!el) return;
      const words = { absent: 'not offered by this browser', unavailable: 'unavailable on this device', downloadable: 'not downloaded', downloading: 'downloading', available: 'ready', error: 'not responding' };
      el.textContent = `On-device AI in the background: ${words[st.availability] || st.availability} · ${st.stats.prompts} model call${st.stats.prompts === 1 ? '' : 's'} since Chrome started · ${st.hasSession ? 'session open' : 'no session open'}`;
    }).catch(() => {});
  }

  function renderAll() {
    if (!S) return;
    renderProtection();
    renderCookies();
    renderCustom();
    renderWebsites();
    renderTrackers();
    renderHidden();
    renderData();
  }

  // ---------------------------------------------------------------- wiring

  window.addEventListener('hashchange', showPage);
  showPage();

  $('addSiteTier').append(...RW.TIER_ORDER.map((t) => h('option', { value: t, selected: t === 'consent_only', text: MODE_LABEL[t] })));
  $('siteSearch').addEventListener('input', (e) => { ui.siteQuery = e.target.value; renderWebsites(); });
  $('trackerSearch').addEventListener('input', (e) => { ui.trackerQuery = e.target.value; ui.trackerLimit = 200; renderTrackers(); });

  $('addSiteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = siteKeyFromInput($('addSiteInput').value);
    if (!key) { toast(errorText(new Error('invalid_site')), true); return; }
    const tier = $('addSiteTier').value;
    act(A.SET_SITE_TIER, { siteKey: key, tier }, `${key}: ${MODE_LABEL[tier]}`);
    $('addSiteInput').value = '';
  });

  $('addSelectorForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = siteKeyFromInput($('selSiteInput').value);
    const sel = $('selInput').value.trim();
    if (!key) { toast(errorText(new Error('invalid_site')), true); return; }
    let valid = RW.isValidSelector(sel);
    if (valid) { try { document.createDocumentFragment().querySelector(sel); } catch (_) { valid = false; } }
    if (!valid) { toast(errorText(new Error('invalid_selector')), true); return; }
    act(A.ADD_COSMETIC_SELECTOR, { siteKey: key, selector: sel }, `Hidden on ${key} after a reload`);
    $('selInput').value = '';
  });

  $('clearAiMemoryBtn').addEventListener('click', () => act(A.CLEAR_AI_MEMORY, {}, 'Automatic adjustment memory cleared'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAi(); });

  $('resetLearned').addEventListener('click', () => {
    if (confirm('Forget every learned tracker? Your own choices for individual domains are kept.')) act(A.RESET_LEARNED_TRACKERS, {}, 'Learning reset');
  });
  $('resetStatsBtn').addEventListener('click', () => {
    if (confirm('Reset all statistics to zero?')) act(A.RESET_STATS, {}, 'Statistics reset');
  });
  $('resetAllBtn').addEventListener('click', () => {
    if (confirm('Reset Rockyweb completely? All websites, learned trackers, hidden elements and statistics will be deleted.')) act(A.RESET_ALL, {}, 'Reset to balanced');
  });

  $('exportBtn').addEventListener('click', async () => {
    try {
      const { data } = await send(A.EXPORT_SETTINGS);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'rockyweb-settings.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      toast(errorText(err), true);
    }
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast(errorText(new Error('file_too_large')), true); return; }
    if (!confirm(`Replace your current settings with "${file.name}"?`)) return;
    try {
      const r = await send(A.IMPORT_SETTINGS, { data: await file.text() });
      toast(`Imported ${r.sites} websites and ${r.trackers} tracker records`);
    } catch (err) {
      toast(err instanceof SyntaxError ? errorText(new Error('invalid_file')) : errorText(err), true);
    }
    load();
  });

  // Refresh when the popup or the learner changes storage.
  let refreshTimer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 400);
  });

  load();
  checkAi();
})();
