// Rockyweb popup. Minimal view by default, advanced controls behind the gear icon.
(() => {
  'use strict';

  const RW = window.RockyShared;
  const A = RW.ACTIONS;
  const { h, icon, send, toggle, seg, tri, fmt, errorText } = RW.UI;

  const main = document.getElementById('main');
  const gear = document.getElementById('gear');

  const CONTENT_SCRIPT_FILES = ['shared/constants.js', 'shared/domain.js', 'engines/consent-rules.js', 'content.js'];
  const MODE_LABEL = { off: 'off', consent_only: 'consent', balanced: 'balanced', strict: 'strict', custom: 'custom' };
  const SOURCE_TEXT = {
    site_override: 'your choice', global_override: 'your global choice', learned: 'learned tracker',
    filter_list: 'filter list', strict_list: 'strict list', observed: 'seen', none: 'unknown', paused: 'paused'
  };
  const DECISION_WORD = { reject: 'rejected', accept: 'accepted', custom: 'custom' };

  let tab = null;
  let data = null;
  let advanced = false;
  let dirty = false;
  let errorMsg = '';

  gear.append(icon('gear'));
  gear.addEventListener('click', () => {
    advanced = !advanced;
    gear.setAttribute('aria-pressed', String(advanced));
    gear.title = advanced ? 'Back' : 'Advanced settings';
    render();
  });

  // ---- data

  async function load() {
    try {
      data = await send(A.GET_POPUP_STATE, { tabId: tab.id });
      errorMsg = '';
    } catch (err) {
      errorMsg = errorText(err);
    }
    render();
  }

  async function mutate(action, payload) {
    try {
      await send(action, payload);
      dirty = true;
      errorMsg = '';
    } catch (err) {
      errorMsg = errorText(err);
    }
    await load();
  }

  const setTier = (tier) => mutate(A.SET_SITE_TIER, { siteKey: data.siteKey, tier });
  const setOption = (key, value) => mutate(A.SET_SITE_CUSTOM_OPTION, { siteKey: data.siteKey, key, value });
  const setSlider = (domain, value) => mutate(A.SET_DOMAIN_SLIDER, { siteKey: data.siteKey, domain, value });
  const useDefault = () => mutate(A.RESET_SITE_PROFILE, { siteKey: data.siteKey });

  // Off pauses the site. On resumes it and keeps its per-domain choices.
  function setEnabled(on) {
    if (!on) return setTier('off');
    if (data.globalDefaultTier === 'off') return setTier('balanced');
    return mutate(A.RESET_SITE_PROFILE, { siteKey: data.siteKey, keepRules: true });
  }

  async function startPicker() {
    const msg = { action: A.START_ELEMENT_PICKER, payload: {} };
    try {
      await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
    } catch (_) {
      // Tab was opened before the extension loaded: inject the content script, then retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: CONTENT_SCRIPT_FILES });
        await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
      } catch (err) {
        errorMsg = 'The element picker cannot run on this page.';
        render();
        return;
      }
    }
    window.close();
  }

  function openSettings() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  // ---- render

  function render() {
    main.replaceChildren();
    if (!data) {
      main.append(h('p', { class: 'error', role: 'alert', text: errorMsg || 'Could not load Rockyweb.' }));
      return;
    }
    if (!data.supported) {
      gear.hidden = true;
      main.append(renderUnsupported());
      return;
    }
    gear.hidden = false;
    if (errorMsg) main.append(h('p', { class: 'error', role: 'alert', text: errorMsg }));
    if (advanced) main.append(...renderAdvanced(data.config));
    else main.append(...renderMain(data.config));
    main.append(renderFoot());
  }

  function renderUnsupported() {
    const t = data.totals;
    return h('div', { class: 'unsupported' },
      h('div', { class: 'host', text: 'nothing to sniff here' }),
      h('p', { text: 'Rocky only guards regular websites. Browser pages, the Web Store and local files are off-limits to extensions.' }),
      h('p', { class: 'dim', text: `${fmt(t.totalAdsBlocked + t.totalTrackersRestricted)} blocked · ${fmt(t.totalPopupsHandled)} popups, all time` }));
  }

  function renderMain(cfg) {
    const on = cfg.tier !== 'off';
    const state = on
      ? h('div', { class: 'state' }, 'on guard · ', h('b', { text: MODE_LABEL[cfg.tier] }), cfg.source === 'site' ? ' for this site' : ' (default)')
      : h('div', { class: 'state paused' }, h('b', { text: 'napping' }), ' · nothing is blocked here');

    const modes = ['off', 'consent_only', 'balanced', 'strict'].concat(cfg.tier === 'custom' ? ['custom'] : []);
    const bar = seg(modes.map((m) => ({ value: m, label: MODE_LABEL[m], title: RW.TIER_META[m].description })),
      cfg.tier, setTier, 'Protection mode for this site');

    const s = data.tabStats;
    const stat = (value, label, word, dim) => h('div', {},
      h('div', { class: `stat-v${word ? ' word' : ''}${dim ? ' none' : ''}`, text: value }),
      h('div', { class: 'stat-l', text: label }));
    const popup = s.popup;

    return [
      h('section', { class: 'site' },
        h('div', { class: 'site-text' },
          h('div', { class: 'host', title: cfg.hostname, text: cfg.hostname }),
          state),
        toggle(on, setEnabled, `Protection on ${cfg.hostname}`)),
      h('div', { class: 'modes' }, bar),
      h('section', { class: 'stats', 'aria-label': 'This page' },
        on ? stat(fmt(s.ads), 'ads') : stat('off', 'ads', true, true),
        on ? stat(fmt(s.trackers), 'trackers') : stat('off', 'trackers', true, true),
        popup
          ? stat(popup.method === 'hidden' ? 'hidden' : DECISION_WORD[popup.decision] || 'done', `cookies · ${popup.cmp.toLowerCase()}`, true)
          : stat('none', 'cookie popup', true, true))
    ];
  }

  function renderAdvanced(cfg) {
    const row = (label, control) => h('div', { class: 'row' }, h('span', { class: 'row-l', text: label }), control);
    const onOff = (key, label) => seg([{ value: false, label: 'off' }, { value: true, label: 'on' }], !!cfg[key], (v) => setOption(key, v), label);

    const site = h('section', { class: 'section' },
      h('div', { class: 'section-t' }, h('span', { text: 'this site' }), h('span', { class: 'main', text: cfg.hostname })),
      h('div', { class: 'row wide' }, h('span', { class: 'row-l', text: 'mode' }), seg(RW.TIER_ORDER.map((m) => ({ value: m, label: MODE_LABEL[m], title: RW.TIER_META[m].description })), cfg.tier, setTier, 'Protection mode')),
      row('cookie popups', seg([
        { value: 'off', label: 'off' }, { value: 'custom_categories', label: 'my choices' }, { value: 'strict_reject', label: 'reject all' }
      ], cfg.consentMode, (v) => setOption('consentMode', v), 'Cookie consent mode')));

    if (cfg.consentMode === 'custom_categories') {
      const cats = h('div', { class: 'cats', role: 'group', 'aria-label': 'Allowed cookie categories' });
      for (const key of ['functional', 'analytics', 'marketing']) {
        const pressed = !!cfg.consentCategories[key];
        cats.append(h('button', {
          type: 'button', 'aria-pressed': String(pressed), text: key,
          onclick: () => setOption('consentCategories', Object.assign({}, cfg.consentCategories, { [key]: !pressed }))
        }));
      }
      site.append(row('allow', cats));
    }
    site.append(
      row('ad blocking', onOff('adBlockNetwork', 'Network ad and tracker blocking')),
      row('trackers', seg([
        { value: 'off', label: 'off' }, { value: 'cookie_strip', label: 'strip cookies' }, { value: 'hard_block', label: 'block' }
      ], cfg.trackerHeuristicMode, (v) => setOption('trackerHeuristicMode', v), 'Learned tracker handling')),
      row('hide ads', onOff('cosmeticFiltering', 'Element hiding')),
      row('annoyances', onOff('aggressiveFiltering', 'Aggressive filters')),
      row('clean links', onOff('stripUrlParams', 'Strip tracking parameters')),
      h('p', { class: 'note', text: cfg.tier === 'custom' ? 'saved for this site' : 'changing a switch makes this site custom' }));

    return [site, renderDomains(cfg), renderLinks(cfg)];
  }

  function renderDomains(cfg) {
    const paused = !(cfg.adBlockNetwork || cfg.trackerHeuristicMode !== 'off' || cfg.stripUrlParams);
    const list = data.trackers;
    const sec = h('section', { class: 'section' },
      h('div', { class: 'section-t' }, h('span', { text: 'third-party domains' }), h('span', { text: String(list.length) })));
    if (paused) sec.append(h('p', { class: 'empty', text: 'network protection is off in this mode' }));
    if (!list.length) {
      sec.append(h('p', { class: 'empty', text: 'nothing seen yet, reload the page' }));
      return sec;
    }
    const ul = h('ul', { class: 'domains' });
    for (const t of list) {
      const meta = [t.override ? h('span', { class: 'yours', text: 'your choice' }) : SOURCE_TEXT[t.source] || ''];
      if (t.seenOn) meta.push(` · ${t.seenOn >= 12 ? '12+' : t.seenOn} site${t.seenOn === 1 ? '' : 's'}`);
      if (t.blocked) meta.push(` · ${t.blocked} blocked`);
      ul.append(h('li', { class: 'domain' },
        h('div', { class: 'domain-text' },
          h('div', { class: 'domain-name', title: t.hosts.join(', '), text: t.domain }),
          h('div', { class: 'domain-meta' }, meta)),
        t.override ? h('button', { class: 'undo', type: 'button', title: 'Remove your choice', 'aria-label': `Remove your choice for ${t.domain}`, onclick: () => setSlider(t.domain, null) }, icon('undo')) : null,
        tri(t.action, (v) => setSlider(t.domain, v), t.domain, paused)));
    }
    sec.append(ul);
    return sec;
  }

  function renderLinks(cfg) {
    return h('section', { class: 'links' },
      h('button', { type: 'button', onclick: startPicker }, icon('target'), 'hide an element'),
      cfg.source === 'site' ? h('button', { type: 'button', onclick: useDefault, title: 'Forget this site’s mode, switches and domain choices' }, icon('undo'), 'use default') : null,
      h('button', { type: 'button', onclick: openSettings }, icon('external'), 'all settings'));
  }

  function renderFoot() {
    const t = data.totals;
    return h('footer', { class: 'foot' },
      dirty
        ? h('button', { class: 'reload', type: 'button', onclick: () => { chrome.tabs.reload(tab.id); window.close(); } }, icon('reload'), 'reload to apply')
        : h('span'),
      h('span', { class: 'total', title: 'All-time totals', text: `${fmt(t.totalAdsBlocked + t.totalTrackersRestricted)} blocked all time` }));
  }

  // ---- init

  // popup.html?tabId=N[&view=advanced] targets a tab directly (used by the tests).
  const params = new URLSearchParams(location.search);
  const forcedTabId = Number(params.get('tabId'));
  if (params.get('view') === 'advanced') { advanced = true; gear.setAttribute('aria-pressed', 'true'); }
  const findTab = Number.isInteger(forcedTabId) && forcedTabId > 0
    ? chrome.tabs.get(forcedTabId).then((t) => [t], () => [])
    : chrome.tabs.query({ active: true, currentWindow: true });
  findTab.then(([active]) => {
    tab = active;
    if (!tab) { render(); return; }
    load();
  });
})();
