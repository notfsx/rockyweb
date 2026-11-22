// Rockyweb options page. Each nav item is its own page (hash routing). All writes go through the background.
(() => {
  'use strict';

  const RW = window.RockyShared;
  const A = RW.ACTIONS;
  const { h, send, seg, onOff, toggle, fmt, timeAgo, errorText, keepFocus, infoText, hintUses, countHintUse, hintFor } = RW.UI;
  const $ = (id) => document.getElementById(id);

  const PAGES = ['welcome', 'protection', 'cookies', 'custom', 'websites', 'trackers', 'hidden', 'ai', 'data'];
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
      const [r, sy] = await Promise.all([send(A.GET_OPTIONS_STATE), send(A.GET_SYNC_STATUS).catch(() => null)]);
      S = r.state;
      diag = r.diagnostics;
      if (sy) syncInfo = sy.sync;
      keepFocus(renderAll);
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
    h('div', { class: 'setting-text' }, h('h2', { text: title }), desc ? h('p', { text: desc }) : null),
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
    renderWelcome();
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
    // Each value is a button: it switches to the next value and makes the default mode custom,
    // exactly as the same switch on the custom page does.
    const fact = (label, key, words) => {
      const order = Object.keys(words);
      const cur = String(cfg[key]);
      const next = order[(order.indexOf(cur) + 1) % order.length];
      const value = (v) => (v === 'true' ? true : v === 'false' ? false : v);
      const offish = cur === 'false' || cur === 'off';
      return h('div', {}, h('dt', { id: `fact-${key}`, text: label }), h('dd', { class: offish ? 'off' : null },
        h('button', {
          class: 'fact-btn', type: 'button', text: words[cur], 'aria-describedby': `fact-${key}`,
          'aria-label': `${label}: ${words[cur]}. Change to ${words[next]}`,
          title: `Change to ${words[next]}${tier === 'custom' ? '' : ' (the default mode becomes custom)'}`,
          onclick: () => act(A.SET_GLOBAL_CUSTOM_OPTION, { key, value: value(next) }, `${label}: ${words[next]}${tier === 'custom' ? '' : ' · default mode is now custom'}`)
        })));
    };
    $('tierFacts').replaceChildren(
      fact('cookie popups', 'consentMode', CONSENT_TEXT),
      fact('known ads & trackers', 'adBlockNetwork', { true: 'blocked', false: 'allowed' }),
      fact('learned trackers', 'trackerHeuristicMode', HEURISTIC_TEXT),
      fact('ad slots', 'cosmeticFiltering', { true: 'hidden', false: 'shown' }),
      fact('annoyances', 'aggressiveFiltering', { true: 'hidden', false: 'shown' }),
      fact('tracking links', 'stripUrlParams', { true: 'cleaned', false: 'untouched' }));

    $('operatingButtons').replaceChildren(seg(
      ['full', 'light'].map((m) => ({ value: m, label: m, title: RW.OPERATING_META[m].description })),
      S.operatingMode,
      (m) => act(A.SET_OPERATING_MODE, { mode: m }, m === 'light' ? 'Light mode is on' : 'Full mode is on'),
      'How hard Rockyweb works', false, 'btns'));
    const op = OPERATING_TEXT[S.operatingMode];
    $('operatingDescription').replaceChildren(infoText(op[0], op[1], 'how hard Rockyweb works'));
    renderAi();
  }

  const OPERATING_TEXT = {
    full: ['Everything Rockyweb offers.', 'Includes tracker learning and deep page scanning, and automatic optimisation if you turn it on. Light mode uses less of your computer.'],
    light: ['Uses less of your computer.', 'Blocking, link cleaning and your site settings stay. Tracker learning, AI and deep page scanning pause. Cookie popups are answered only for the consent platforms Rockyweb recognises.']
  };

  // ---- on-device AI (#ai). Off by default and turned on deliberately: while on, Chrome's model is kept
  // loaded, which is heavy. Opening this page only calls availability(); a model download starts only
  // from the user's click.

  const SETUP_KEY = 'aiSetupInProgress';
  const ai = { availability: null, setup: 'idle', understood: false, progress: 0, error: '', ctrl: null, otherSetup: false, pollTimer: 0, startup: false };
  const pct = () => (ai.progress ? ` (${Math.round(ai.progress * 100)}%)` : '');
  const unusable = (a) => a === 'absent' || a === 'unavailable' || a === 'error';

  async function checkAi() {
    if (typeof self.LanguageModel === 'undefined' || typeof LanguageModel.availability !== 'function') {
      ai.availability = 'absent';
    } else {
      try { ai.availability = await LanguageModel.availability(RW.AI_MODEL_OPTIONS); } catch (_) { ai.availability = 'unavailable'; }
    }
    const flag = await chrome.storage.session.get(SETUP_KEY).catch(() => ({}));
    ai.otherSetup = !!flag[SETUP_KEY] && ai.setup !== 'downloading';
    ai.startup = await chrome.permissions.contains({ permissions: ['background'] }).catch(() => false);
    clearTimeout(ai.pollTimer);
    if ((ai.availability === 'downloading' || ai.otherSetup) && document.visibilityState === 'visible') ai.pollTimer = setTimeout(checkAi, 4000);
    renderAi();
  }

  function masterState() {
    const on = !!S.aiSettings.enabled;
    const a = ai.availability;
    if (a === null) return { disabled: true, text: 'Checking whether this computer can run Chrome’s on-device model…' };
    if (unusable(a)) return { disabled: !on, warn: true, text: 'Chrome’s on-device model is unavailable in this browser or on this computer.' };
    if (ai.setup === 'downloading') return { disabled: true, text: `Chrome is downloading the model${pct()}. You can keep browsing.` };
    if (a === 'downloading' || ai.otherSetup) return { disabled: true, text: 'Chrome is downloading the model. This page updates when it is ready.' };
    if (S.operatingMode === 'light') return { disabled: false, text: on ? 'On, but paused in Light mode. It resumes in Full mode.' : 'Off. Light mode would pause it anyway.' };
    if (!on) return { disabled: false, text: 'Off.' };
    if (a === 'downloadable') return { disabled: false, text: 'On, but Chrome still needs to download its model.' };
    return { disabled: false, text: S.aiSettings.keepLoaded !== false ? 'On. The model is kept loaded while Chrome runs.' : 'On. The model loads when you first use it.' };
  }

  function renderAi() {
    if (!S) return;
    const on = !!S.aiSettings.enabled;
    $('aiMasterDescription').replaceChildren(infoText(
      'Lets you describe page changes in the toolbar, and lets Rockyweb adjust sites by itself if you want, using Gemini Nano, the model Chrome runs on this computer.',
      'It is experimental and heavy. Answers take seconds and can be wrong, so every change previews first and can be undone. While it is on, Rockyweb keeps the model loaded so answers come quickly; that keeps several gigabytes of memory (or graphics memory) busy and uses more battery. It suits a desktop, or a laptop on mains power, not a low-powered computer. Chrome’s stated minimum is a graphics card with more than 4 GB of memory, or 16 GB of memory and 4 processor cores, and 22 GB of free disk space for the download. Nothing is sent to any server.',
      'on-device AI'));
    const st = masterState();
    const sw = toggle(on || ai.setup === 'confirm', onMasterToggle, 'Use Chrome’s on-device AI', st.disabled);
    sw.setAttribute('aria-describedby', 'aiMasterStatus');
    $('aiMasterToggle').replaceChildren(sw);
    const status = $('aiMasterStatus');
    status.textContent = ai.error || st.text;
    status.classList.toggle('warn', !!(ai.error || st.warn));

    const setup = $('aiMasterSetup');
    setup.replaceChildren();
    if (ai.setup === 'confirm') {
      const needsDownload = ai.availability === 'downloadable';
      const go = h('button', { class: 'btn on', type: 'button', disabled: !ai.understood, text: needsDownload ? 'download and turn on' : 'turn on', onclick: confirmTurnOn });
      const box = h('input', { type: 'checkbox', checked: ai.understood, onchange: (e) => { ai.understood = e.target.checked; go.disabled = !ai.understood; } });
      setup.append(
        h('p', { text: 'While it is on, Rockyweb loads the model when Chrome starts and keeps it loaded until Chrome quits, so it is ready when you ask. That is what makes it quick, and what makes it heavy.' }),
        ...(needsDownload ? [h('p', { text: 'Chrome first downloads the model once. It is large (usually a few gigabytes), and Chrome manages and stores it, not Rockyweb.' })] : []),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, box, 'I understand it keeps a lot of memory busy and uses more battery'),
        go,
        h('button', { class: 'btn', type: 'button', text: 'cancel', onclick: () => { ai.setup = 'idle'; ai.understood = false; renderAi(); } }));
    } else if (ai.setup === 'downloading') {
      setup.append(
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Model download', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ai.progress * 100)) },
          h('span', { style: { width: `${Math.round(ai.progress * 100)}%` } })),
        h('button', { class: 'btn', type: 'button', text: 'cancel download', onclick: () => ai.ctrl && ai.ctrl.abort() }));
    }
    setup.hidden = !setup.childNodes.length;
    $('aiFeatures').hidden = !on;
    if (on) renderAiFeatures();
    renderWelcome();
  }

  function renderAiFeatures() {
    const st = S.aiSettings;
    $('aiKeepDescription').replaceChildren(infoText(
      'Loads the model when Chrome starts and keeps it ready, so answers take seconds rather than minutes.',
      'Chrome unloads its model a few minutes after it was last used, and loading it again took minutes on our test laptop (measured). With this on, Rockyweb keeps a session open and asks the model a one-word question every few minutes, so Chrome keeps it. Off: the model loads when you first ask, and is let go 10 minutes after.',
      'keeping the model loaded'));
    $('aiKeepToggle').replaceChildren(toggle(st.keepLoaded !== false,
      (v) => act(A.SET_AI_PAGE_SETTINGS, { keepLoaded: v }, v ? 'The model is kept loaded' : 'The model loads when needed'), 'Keep the model loaded'));

    $('aiStartDescription').replaceChildren(infoText(
      'Recommended with on-device AI: Chrome starts in the background when you sign in, so the model is ready before you open a window.',
      'Chrome then also keeps running after its last window closes, until you quit it from its icon (on Windows, in the notification area). It needs Chrome’s “Continue running background apps when Google Chrome is closed” setting to be on. If Chrome still does not start at sign-in on your computer, add it to your computer’s startup apps instead. Turning off on-device AI turns this off too.',
      'starting with your computer'));
    $('aiStartToggle').replaceChildren(toggle(ai.startup, onStartupToggle, 'Start Chrome when you sign in to this computer'));
    $('aiStartActions').replaceChildren(h('button', { class: 'btn', type: 'button', text: 'open Chrome’s background setting', onclick: () => chrome.tabs.create({ url: 'chrome://settings/system' }) }));

    $('aiDescription').replaceChildren(infoText(
      'Small adjustments by the model: hiding an unsolicited newsletter overlay on an article, and refusing a cookie banner Rockyweb does not recognise.',
      'An overlay you can undo from the toolbar. A cookie banner is answered only when your cookie choices refuse something, by clicking its refuse button; for that, the banner’s heading and button labels go to the on-device model, which runs on this computer. Buttons that accept are removed before the model sees anything. A banner answer is listed in the toolbar; it cannot be unclicked, but the site’s own cookie settings link reopens its choices. While the model is still loading, nothing is changed.',
      'automatic optimisation'));
    const pref = !!st.autoOptimise;
    const sw = toggle(pref, (v) => act(A.SET_AI_AUTO_OPTIMISE, { enabled: v }, v ? 'Automatic optimisation is on' : 'Automatic optimisation is off'),
      'Automatically optimise protection for each site');
    sw.setAttribute('aria-describedby', 'aiStatus');
    $('aiToggle').replaceChildren(sw);
    $('aiStatus').textContent = S.operatingMode === 'light' ? 'Paused in Light mode.' : pref ? 'On. Adjustments happen quietly; undo them from the toolbar.' : 'Off.';
  }

  function onMasterToggle(v) {
    ai.error = '';
    if (v) { ai.setup = 'confirm'; renderAi(); return; }
    ai.setup = 'idle';
    ai.understood = false;
    if (!S.aiSettings.enabled) { renderAi(); return; }
    act(A.SET_AI_ENABLED, { enabled: false }, 'On-device AI is off').then(checkAi);
  }

  function confirmTurnOn() {
    if (!ai.understood) return;
    ai.setup = 'idle';
    ai.understood = false;
    if (ai.availability === 'downloadable') { startDownload(); return; }
    act(A.SET_AI_ENABLED, { enabled: true }, 'On-device AI is on');
  }

  // permissions.request needs the click, so it is the first thing awaited.
  async function onStartupToggle(v) {
    try {
      if (v) await chrome.permissions.request({ permissions: ['background'] });
      else await chrome.permissions.remove({ permissions: ['background'] });
    } catch (_) {
      toast('Chrome did not allow that.', true);
    }
    ai.startup = await chrome.permissions.contains({ permissions: ['background'] }).catch(() => false);
    renderAi();
  }

  // ---- first run (#welcome, opened once after install): what already works. AI is only mentioned,
  // and only on a computer that can run it.

  function renderWelcome() {
    if (!S || $('welcome').hidden) return;
    const cfg = RW.getEffectiveConfig(S, null);
    const fact = (label, value) => h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
    $('welcomeFacts').replaceChildren(
      fact('cookie popups', CONSENT_TEXT[cfg.consentMode]),
      fact('known ads & trackers', cfg.adBlockNetwork ? 'blocked' : 'allowed'),
      fact('tracking links', cfg.stripUrlParams ? 'cleaned' : 'untouched'));
    const a = ai.availability;
    $('welcomeAi').hidden = a === null || unusable(a) || !!S.aiSettings.enabled;
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
    send(A.SET_AI_ENABLED, { enabled: true }).catch(() => {});
    try {
      const session = await created;
      session.destroy(); // only needed the download; inference runs in the background
      toast('On-device AI is ready and on.');
    } catch (_) {
      ai.error = ctrl.signal.aborted ? 'Download cancelled. On-device AI stays off.' : 'Chrome could not set up the on-device model. Please try again later.';
      await send(A.SET_AI_ENABLED, { enabled: false }).catch(() => {});
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
      wrap.replaceChildren(h('div', { class: 'empty', text: all.length ? 'No domain matches.' : 'Nothing sniffed out yet. Trackers that follow you between websites show up here.' }));
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
      h('div', { class: 'group-head' }, h('h2', { text: site }), h('span', { text: `${p.customCosmeticSelectors.length} hidden` })),
      p.customCosmeticSelectors.map((sel) => h('div', { class: 'sel' },
        h('code', { title: sel, text: sel }),
        h('button', {
          class: 'textbtn', type: 'button', text: 'show again', 'aria-label': `Show ${sel} on ${site} again`,
          onclick: () => act(A.REMOVE_COSMETIC_SELECTOR, { siteKey: site, selector: sel }, 'Shows again after a reload')
        }))))));
  }

  const FIX_NEVER = 'Never on cookie notices, sign-in, payment, paywalls or anti-adblock messages, and never in Incognito or Light mode.';
  const FIX_MODE_TEXT = {
    off: ['Off: Rockyweb only changes pages when you ask.', `Suggest lists fixes in the toolbar; automatic applies the obvious ones. ${FIX_NEVER}`],
    suggest: ['Suggests fixes for common annoyances in the toolbar. Nothing changes until you apply one.',
      `For example a bar asking you to install an app, a video player floating over the text, a tall header that follows you or a page that will not scroll. A fix you dismiss is not suggested again on that site for 30 days. ${FIX_NEVER}`],
    auto: ['Applies the obvious fixes itself and lists each one in the toolbar.',
      `With automatic optimisation on, the on-device AI is asked about the less obvious ones. Every fix can be switched off from the toolbar or under page changes. ${FIX_NEVER}`]
  };

  function renderPageAi() {
    const st = S.aiSettings || {};
    $('pageEditsDescription').replaceChildren(infoText(
      '"Describe a change" in the toolbar can also hide, unstick, resize and recolour parts of a page.',
      'Only from a list of safe changes; the AI never writes code or CSS. You see the change on the page before you apply it. Every change is saved for that website, so you never have to ask twice, and listed in the toolbar and under page changes, where you can switch it off or delete it. Off: describe a change only changes settings.',
      'letting AI change pages'));
    $('pageEditsToggle').replaceChildren(toggle(st.pageEdits !== false,
      (v) => act(A.SET_AI_PAGE_SETTINGS, { pageEdits: v }, v ? 'Described changes can edit pages' : 'Described changes only change settings'),
      'Let AI change pages, not only settings'));
    const mode = st.pageFixes || 'suggest';
    $('pageFixesButtons').replaceChildren(seg(
      [{ value: 'off', label: 'off' }, { value: 'suggest', label: 'suggest' }, { value: 'auto', label: 'automatic' }],
      mode, (v) => act(A.SET_AI_PAGE_SETTINGS, { pageFixes: v }, `page fixes: ${v === 'auto' ? 'automatic' : v}`), 'Page fixes', false, 'btns'));
    $('pageFixesDescription').replaceChildren(infoText(FIX_MODE_TEXT[mode][0], FIX_MODE_TEXT[mode][1], 'page fixes'));
  }

  const EDIT_SOURCE = { described: 'you asked', suggested: 'suggested, you applied it', automatic: 'applied automatically' };

  function renderEdits() {
    const wrap = $('editList');
    const sites = Object.entries(S.pageEdits || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!sites.length) {
      wrap.replaceChildren(h('div', { class: 'empty', text: 'No described changes or page fixes yet.' }));
      return;
    }
    wrap.replaceChildren(...sites.map(([site, list]) => h('div', { class: 'group' },
      h('div', { class: 'group-head' }, h('h2', { text: site }), h('span', { text: `${list.filter((e) => e.enabled).length} of ${list.length} on` })),
      list.map((e) => h('div', { class: `sel edit${e.enabled ? '' : ' off'}` },
        h('div', { class: 'edit-text' },
          h('div', { text: e.label }),
          h('div', { class: 'meta', text: e.request ? `${EDIT_SOURCE[e.source]}: “${e.request}”` : EDIT_SOURCE[e.source] })),
        toggle(e.enabled, (v) => act(A.SET_PAGE_EDIT, { siteKey: site, id: e.id, enabled: v }), `${e.label} on ${site}: on or off`),
        h('button', {
          class: 'textbtn', type: 'button', text: 'delete', 'aria-label': `Delete ${e.label} on ${site}`,
          onclick: () => act(A.DELETE_PAGE_EDIT, { siteKey: site, id: e.id }, 'Change deleted')
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
    renderSync();
    $('aboutPanel').replaceChildren(
      h('p', {}, 'rockyweb ', h('b', { text: `v${diag.version}` }),
        ` · ${Object.keys(S.siteProfiles).length} websites · ${Object.keys(S.learnedTrackers).length} domains seen · ${diag.dynamicRuleCount} rules built from your settings`),
      h('p', { text: syncInfo.enabled
        ? 'Rockyweb has no server, makes no network requests of its own, has no analytics and loads no remote code. With sync on, your settings, website modes and page changes also travel through Chrome sync.'
        : 'Everything stays in this browser. Rockyweb makes no network requests of its own, has no analytics and loads no remote code.' }),
      h('p', {}, 'Open source: ', h('a', { href: 'https://github.com/notfsx/rockyweb', target: '_blank', rel: 'noopener noreferrer', text: 'github.com/notfsx/rockyweb' })),
      h('p', { text: 'Named after Rocky, a British cocker spaniel who loved his tennis ball, a good nap and his dinner. Font: Lexend Deca, SIL Open Font License.' }),
      h('p', { id: 'aiDiagnostics' }));
    send(A.GET_AI_STATUS).then((st) => {
      const el = $('aiDiagnostics');
      if (!el) return;
      const words = { absent: 'not offered by this browser', unavailable: 'unavailable on this device', downloadable: 'not downloaded', downloading: 'downloading', available: 'ready', error: 'not responding' };
      el.textContent = `On-device AI in the background: ${words[st.availability] || st.availability} · ${st.stats.prompts} model call${st.stats.prompts === 1 ? '' : 's'} since Chrome started · ${st.hasSession ? 'session open' : 'no session open'}`;
    }).catch(() => {});
  }

  // ---- Chrome sync (opt-in, per device)
  let syncInfo = { enabled: false };

  function renderSync() {
    const st = syncInfo;
    $('syncDescription').replaceChildren(infoText(
      'Keeps your settings, website modes and page changes the same in Chrome on your other computers. Off by default.',
      'It uses Chrome sync, so it works when you are signed in to Chrome with sync on; otherwise the copy stays on this computer. What syncs leaves this device through Google’s Chrome sync and is kept with your Google Account’s sync data; Rockyweb itself has no server. Learned trackers, statistics, automatic adjustment memory, Light mode, automatic optimisation and any website you changed in an Incognito window stay on this device. Turn it on for each computer. The first time, websites from both sides are combined, the newer setting wins where both have the same website, and the general settings come from your other computers if they already sync. Chrome allows about 100 KB; if it fills up, the websites changed longest ago stay on their own device.',
      'sync'));
    const sw = toggle(!!st.enabled, (v) => setSync(v), 'Sync across your devices');
    sw.setAttribute('aria-describedby', 'syncStatus');
    $('syncToggle').replaceChildren(sw);
    const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0);
    const bits = [];
    if (!st.enabled) bits.push('Off. Everything stays on this device.');
    else {
      bits.push(st.lastSyncAt ? `On. Synced ${timeAgo(st.lastSyncAt)}, ${kb(st.bytes)} KB of ${kb(st.quota || 102400)} KB.` : 'On. Syncing…');
      if (st.skipped) bits.push(`${st.skipped} website${st.skipped === 1 ? '' : 's'} left out: Chrome’s sync limit is full.`);
      if (st.privateSites) bits.push(`${st.privateSites} website${st.privateSites === 1 ? '' : 's'} changed in Incognito stay${st.privateSites === 1 ? 's' : ''} on this device.`);
      if (st.lastError) bits.push(`Could not sync just now (${st.lastError}); Rockyweb tries again in a minute.`);
    }
    const status = $('syncStatus');
    status.textContent = bits.join(' ');
    status.classList.toggle('warn', !!(st.enabled && st.lastError));
    const actions = $('syncActions');
    actions.replaceChildren(st.enabled ? h('button', { class: 'btn danger', type: 'button', text: 'remove the synced copy', onclick: clearSyncCopy }) : '');
    actions.hidden = !st.enabled;
  }

  async function refreshSync() {
    try { syncInfo = (await send(A.GET_SYNC_STATUS)).sync; } catch (_) { /* keep what we had */ }
    if (S) renderSync();
  }

  async function setSync(enabled) {
    try {
      syncInfo = (await send(A.SET_SYNC, { enabled })).sync;
      toast(enabled ? 'Sync is on for this device' : 'Sync is off for this device');
    } catch (err) {
      toast(errorText(err), true);
    }
    await load();
  }

  async function clearSyncCopy() {
    if (!confirm('Remove Rockyweb’s copy from Chrome sync and turn sync off here? Your settings on this device stay. Turn sync off on your other computers first, or they will put the copy back.')) return;
    try { syncInfo = (await send(A.CLEAR_SYNC_COPY)).sync; toast('Synced copy removed'); } catch (err) { toast(errorText(err), true); }
    await load();
  }

  function renderAll() {
    if (!S) return;
    renderProtection();
    renderCookies();
    renderCustom();
    renderWebsites();
    renderTrackers();
    renderHidden();
    renderEdits();
    renderPageAi();
    renderData();
  }

  // ---------------------------------------------------------------- wiring

  window.addEventListener('hashchange', showPage);
  showPage();

  $('addSiteTier').append(...RW.TIER_ORDER.map((t) => h('option', { value: t, selected: t === 'consent_only', text: MODE_LABEL[t] })));
  $('siteSearch').addEventListener('input', (e) => { ui.siteQuery = e.target.value; renderWebsites(); });
  $('trackerSearch').addEventListener('input', (e) => { ui.trackerQuery = e.target.value; ui.trackerLimit = 200; renderTrackers(); });

  const HINTS = [['addSiteInput', 'add a website, e.g. example.com', 'add a website'], ['selInput', 'css selector, e.g. .promo-banner', 'css selector']];
  async function applyHints() {
    for (const [id, full, short] of HINTS) $(id).placeholder = hintFor(await hintUses(id), full, short);
  }
  const usedHint = (id) => countHintUse(id).then(applyHints);
  applyHints();

  $('addSiteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = siteKeyFromInput($('addSiteInput').value);
    if (!key) { toast(errorText(new Error('invalid_site')), true); return; }
    usedHint('addSiteInput');
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
    usedHint('selInput');
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
    if (area === 'local' && changes.syncState) refreshSync();
    if (area !== 'local') return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 400);
  });

  load();
  checkAi();
})();
