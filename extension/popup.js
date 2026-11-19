// Rockyweb popup. Minimal view by default, advanced controls behind the gear icon.
(() => {
  'use strict';

  const RW = window.RockyShared;
  const A = RW.ACTIONS;
  const { h, icon, send, toggle, seg, tri, fmt, errorText, keepFocus } = RW.UI;

  const main = document.getElementById('main');
  const gear = document.getElementById('gear');

  const CONTENT_SCRIPT_FILES = ['shared/constants.js', 'shared/domain.js', 'shared/ai-policy.js', 'shared/page-edits.js', 'engines/consent-rules.js', 'content.js'];
  const EDIT_SOURCE = { described: 'you asked', suggested: 'suggested, you applied it', automatic: 'applied automatically' };
  const ADJUSTMENT_SOURCE = { model: 'decided on this device', memory: 'remembered from an earlier visit', your_choice: 'your setting for this site' };
  const NEWSLETTER_LABEL = { auto: 'automatic', hide: 'hide', keep: 'leave alone' };
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
  let showAdjustments = false;
  let showChanges = false;
  // "Describe a change": optional, on-device only. ops are page edits, shown live on the page until applied or cancelled.
  const describe = { open: false, availability: null, busy: false, text: '', plan: null, preview: null, ops: [], notes: [], error: '', applied: null, saved: null, askAgain: false };
  let previewPort = null;

  gear.append(icon('gear'));
  gear.addEventListener('click', () => {
    // No per-site controls on browser pages, so the same button goes straight to settings.
    if (data && !data.supported) { openSettings(); return; }
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

  const setNewsletter = (value) => mutate(A.SET_SITE_NEWSLETTER, { siteKey: data.siteKey, value });

  async function undoAdjustment(id) {
    try { await send(A.AI_UNDO_ADJUSTMENT, { tabId: tab.id, id }); } catch (err) { errorMsg = errorText(err); }
    await load();
  }

  async function optOutAdjustments(kind) {
    try { await send(A.AI_SITE_OPT_OUT, { tabId: tab.id, kind }); } catch (err) { errorMsg = errorText(err); }
    await load();
  }

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

  // Close only once Chrome has the request; older versions drop it if the popup closes first.
  function openSettings() {
    Promise.resolve(chrome.runtime.openOptionsPage()).catch(() => {}).finally(() => window.close());
  }

  // ---- render

  const render = () => keepFocus(renderView);

  function renderView() {
    main.replaceChildren();
    if (!data) {
      main.append(h('p', { class: 'error', role: 'alert', text: errorMsg || 'Could not load Rockyweb.' }));
      return;
    }
    if (!data.supported) {
      gear.hidden = false;
      gear.removeAttribute('aria-pressed');
      main.append(renderUnsupported());
      return;
    }
    gear.hidden = false;
    gear.setAttribute('aria-pressed', String(advanced));
    if (errorMsg) main.append(h('p', { class: 'error', role: 'alert', text: errorMsg }));
    if (advanced) main.append(...renderAdvanced(data.config));
    else main.append(...renderMain(data.config).filter(Boolean));
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
    const light = data.operatingMode === 'light';
    const state = on
      ? h('div', { class: 'state' }, 'on guard · ', h('b', { text: MODE_LABEL[cfg.tier] }), cfg.source === 'site' ? ' for this site' : ' (default)',
        light ? h('span', { class: 'light-tag', title: RW.OPERATING_META.light.description, text: 'light mode' }) : null)
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
          : stat('none', 'cookie popup', true, true)),
      renderAdjustments(),
      renderChanges(cfg)
    ];
  }

  // ---- changes on this site: every saved page edit, with on, off and delete

  async function setEdit(id, enabled) {
    await mutate(A.SET_PAGE_EDIT, { siteKey: data.siteKey, id, enabled });
  }

  async function deleteEdit(id) {
    await mutate(A.DELETE_PAGE_EDIT, { siteKey: data.siteKey, id });
  }

  async function fixAction(action, id) {
    try { await send(action, { tabId: tab.id, id }); errorMsg = ''; } catch (err) { errorMsg = errorText(err); }
    await load();
  }

  function editMeta(e) {
    const skipped = (data.editSkipped || []).find((x) => x.id === e.id);
    if (skipped && e.enabled) return `not applied on this page: it ${skipped.reason || 'did not fit this page'}`;
    const who = EDIT_SOURCE[e.source] || '';
    return e.request ? `${who}: “${e.request}”` : who;
  }

  function renderChanges(cfg) {
    const edits = data.pageEdits || [];
    const fixes = data.pageFixes || [];
    if (!edits.length && !fixes.length) return null;
    const count = `changes on this site · ${edits.length}${fixes.length ? ` · ${fixes.length} suggested` : ''}`;
    const wrap = h('section', { class: 'adjustments changes', 'aria-label': 'Changes on this site' },
      h('button', {
        class: 'adj-toggle', type: 'button', 'aria-expanded': String(showChanges),
        onclick: () => { showChanges = !showChanges; render(); }
      }, count, icon('chevron', `chev${showChanges ? ' up' : ''}`)));
    if (!showChanges) return wrap;
    const ul = h('ul', { class: 'adj-list' });
    for (const f of fixes) {
      const kind = RW.PAGE_FIX_KINDS[f.kind] || {};
      ul.append(h('li', { class: 'suggestion' },
        h('div', { class: 'adj-text' },
          h('div', { text: kind.ask || 'a page fix' }),
          h('div', { class: 'adj-meta', text: f.text ? `suggested for “${f.text}”` : 'suggested for this page' })),
        h('button', { class: 'adj-btn primary', type: 'button', onclick: () => fixAction(A.APPLY_PAGE_FIX, f.id), text: 'apply' }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Not this', 'aria-label': `Dismiss: ${kind.ask || 'suggestion'}`, onclick: () => fixAction(A.DISMISS_PAGE_FIX, f.id) }, icon('x'))));
    }
    for (const e of edits) {
      ul.append(h('li', { class: e.enabled ? '' : 'off' },
        h('div', { class: 'adj-text' },
          h('div', { class: 'edit-label', text: e.label }),
          h('div', { class: 'adj-meta', text: editMeta(e) })),
        toggle(e.enabled, (v) => setEdit(e.id, v), `${e.label}: on or off`),
        h('button', { class: 'icon-btn', type: 'button', title: 'Delete this change', 'aria-label': `Delete: ${e.label}`, onclick: () => deleteEdit(e.id) }, icon('trash'))));
    }
    wrap.append(ul);
    if (cfg.pageFixesSite !== 'off' && (fixes.length || edits.some((e) => e.source !== 'described'))) {
      wrap.append(h('button', { class: 'adj-optout', type: 'button', onclick: () => mutate(A.SET_SITE_PAGE_FIXES, { siteKey: data.siteKey, value: 'off' }), text: 'don’t suggest page fixes on this site' }));
    }
    return wrap;
  }

  // Discreet list of what Rockyweb adjusted on this page by itself, with undo.
  function renderAdjustments() {
    const list = data.adjustments || [];
    if (!list.length) return null;
    const toggleBtn = h('button', {
      class: 'adj-toggle', type: 'button', 'aria-expanded': String(showAdjustments),
      onclick: () => { showAdjustments = !showAdjustments; render(); }
    }, `automatic adjustments · ${list.length}`, icon('chevron', `chev${showAdjustments ? ' up' : ''}`));
    const wrap = h('section', { class: 'adjustments', 'aria-label': 'Automatic adjustments' }, toggleBtn);
    if (showAdjustments) {
      const ul = h('ul', { class: 'adj-list' });
      const overlays = list.filter((a) => a.kind !== RW.AI_CONSENT_KIND);
      for (const a of list) {
        if (a.kind === RW.AI_CONSENT_KIND) {
          // A click cannot be taken back, so say what happened and how to change it on the site.
          ul.append(h('li', { class: 'adj-consent' },
            h('div', { class: 'adj-text' },
              h('div', { text: `Answered the cookie banner: clicked “${a.label}”` }),
              h('div', { class: 'adj-meta', text: `${ADJUSTMENT_SOURCE[a.source] || ''}. To change your answer, use the site’s own cookie settings link, often at the bottom of the page.` }),
              h('button', { class: 'adj-optout', type: 'button', onclick: () => optOutAdjustments(RW.AI_CONSENT_KIND), text: 'don’t answer cookie banners for me on this site' }))));
          continue;
        }
        ul.append(h('li', {},
          h('div', { class: 'adj-text' },
            h('div', { text: 'Hid a newsletter overlay on this page' }),
            h('div', { class: 'adj-meta', text: ADJUSTMENT_SOURCE[a.source] || '' })),
          h('button', { class: 'adj-btn', type: 'button', onclick: () => undoAdjustment(a.id), text: 'undo' })));
      }
      wrap.append(ul);
      if (overlays.length) wrap.append(h('button', { class: 'adj-optout', type: 'button', onclick: () => optOutAdjustments(), text: 'don’t do this on this site' }));
    }
    return wrap;
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
      h('p', { class: 'note', text: cfg.tier === 'custom' ? 'saved for this site' : 'changing a switch makes this site custom' }),
      row('newsletter prompts', seg(['auto', 'hide', 'keep'].map((v) => ({ value: v, label: NEWSLETTER_LABEL[v] })),
        cfg.newsletterPrompts, setNewsletter, 'Newsletter prompts on this site')),
      h('p', { class: 'note', text: aiStatusText(cfg) }));

    return [site, renderDescribe(cfg), renderDomains(cfg), renderLinks(cfg)];
  }

  function aiStatusText(cfg) {
    const caps = data.capabilities || {};
    if (cfg.newsletterPrompts === 'hide') return 'newsletter overlays are hidden here because you chose to';
    if (cfg.newsletterPrompts === 'keep') return 'Rockyweb leaves newsletter prompts alone here';
    if (!cfg.aiPreference) return 'automatic optimisation is off (turn it on in settings)';
    if (caps.aiPausedReason === 'light') return 'AI is paused in Light mode';
    if (caps.aiPausedReason === 'incognito') return 'automatic optimisation does not run in Incognito';
    if (!caps.ai) return 'automatic optimisation does not apply in this mode';
    return 'automatic optimisation may hide unsolicited newsletter overlays here';
  }

  // ---- describe a change (optional, on-device)

  async function aiAvailability() {
    if (typeof self.LanguageModel === 'undefined' || typeof LanguageModel.availability !== 'function') return 'absent';
    try { return await LanguageModel.availability(RW.AI_MODEL_OPTIONS); } catch (_) { return 'unavailable'; }
  }

  function describeBlocker(cfg) {
    if (data.operatingMode === 'light') return 'AI is paused in Light mode.';
    if (data.incognito) return 'AI does not run in Incognito.';
    const a = describe.availability;
    if (a === null) return 'Checking whether on-device AI is available…';
    if (a === 'absent' || a === 'unavailable') return 'On-device AI is unavailable in this browser or on this device.';
    if (a === 'downloadable') return 'On-device AI is not set up yet. Turn on automatic optimisation in settings to download it.';
    if (a === 'downloading') return 'Chrome is still downloading the on-device model.';
    return null;
  }

  // Live preview on the page while the popup is open; it disappears when the popup closes.
  function pagePort() {
    if (previewPort) return previewPort;
    try {
      previewPort = chrome.tabs.connect(tab.id, { name: 'rockyweb-preview', frameId: 0 });
      previewPort.onDisconnect.addListener(() => { previewPort = null; });
    } catch (_) { previewPort = null; }
    return previewPort;
  }

  function showOnPage(ops) {
    const port = pagePort();
    if (port) { try { port.postMessage({ action: A.PREVIEW_PAGE_EDITS, payload: { ops } }); } catch (_) { /* tab went away */ } }
  }

  function clearOnPage() {
    if (previewPort) { try { previewPort.postMessage({ action: A.CLEAR_PAGE_PREVIEW, payload: {} }); } catch (_) { /* gone */ } }
  }

  async function toPage(action, payload) {
    try { return await chrome.tabs.sendMessage(tab.id, { action, payload: payload || {} }, { frameId: 0 }); } catch (_) { return null; }
  }

  async function previewChange(cfg) {
    const text = describe.text.trim().slice(0, 300);
    if (!text) return;
    Object.assign(describe, { error: '', plan: null, ops: [], notes: [], saved: null, applied: null });
    clearOnPage();
    // Asked before on this site: it is saved, so the model is not asked again.
    const saved = !describe.askAgain && RW.findSavedPageEdit(data.pageEdits, text);
    describe.askAgain = false;
    if (saved) { describe.saved = saved.id; render(); return; }
    describe.busy = true;
    render();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let session = null;
    try {
      const page = data.aiSettings && data.aiSettings.pageEdits !== false ? await toPage(A.GET_PAGE_OUTLINE) : null;
      const outline = page && Array.isArray(page.outline) ? page.outline : null;
      session = await LanguageModel.create(Object.assign({}, RW.AI_MODEL_OPTIONS, {
        initialPrompts: outline ? RW.editInitialPrompts() : RW.planInitialPrompts(), signal: ctrl.signal
      }));
      const raw = await session.prompt(outline ? RW.editRequest(text, outline) : RW.planRequest(text),
        { responseConstraint: outline ? RW.planWithEditsSchema() : RW.AI_PLAN_SCHEMA, signal: ctrl.signal });
      const plan = RW.checkPlan(RW.parsePlan(raw), text, cfg);
      let ops = [];
      let notes = [];
      if (outline && plan) {
        const parsed = RW.parsePlanEdits(raw, outline);
        notes = parsed.notes;
        if (parsed.edits.length) {
          const res = await toPage(A.RESOLVE_PAGE_EDITS, { edits: parsed.edits });
          ops = (res && Array.isArray(res.ops)) ? res.ops : [];
          notes = notes.concat((res && res.notes) || []);
        }
      }
      if (!plan) describe.error = 'Rockyweb could not turn that into a change. Try rephrasing it.';
      else if (!plan.changes.length && !ops.length && !plan.unsupported.length && !notes.length) describe.error = 'That does not seem to ask for any change.';
      else {
        Object.assign(describe, { plan, preview: RW.describePlan(plan, cfg), ops, notes });
        if (ops.length) showOnPage(ops);
      }
    } catch (_) {
      describe.error = ctrl.signal.aborted ? 'That took too long. Please try again.' : 'On-device AI could not answer just now.';
    } finally {
      clearTimeout(timer);
      if (session) { try { session.destroy(); } catch (_) { /* ignore */ } }
      describe.busy = false;
      render();
    }
  }

  // Saved as one change for this site: listed under "changes on this site", reversible there.
  async function applyPlan() {
    const plan = describe.plan;
    if (!plan) return;
    const words = describe.ops.map(RW.describePageEditOp).concat(describe.preview.map((l) => `${l.label} ${l.to}`));
    try {
      const r = await send(A.SAVE_PAGE_EDIT, {
        siteKey: data.siteKey, request: describe.text.trim().slice(0, 200), label: words.join(', ').slice(0, 90),
        ops: describe.ops, settings: plan.changes
      });
      describe.applied = r.edit.id;
      if (plan.changes.length) dirty = true;
    } catch (err) {
      describe.error = errorText(err);
    }
    clearOnPage();
    describe.plan = null;
    await load();
  }

  async function undoPlan() {
    try {
      await send(A.DELETE_PAGE_EDIT, { siteKey: data.siteKey, id: describe.applied });
      describe.applied = null;
      dirty = true;
    } catch (err) {
      describe.error = errorText(err);
    }
    await load();
  }

  function cancelPlan() {
    clearOnPage();
    describe.plan = null;
    render();
  }

  function renderDescribe(cfg) {
    const sec = h('section', { class: 'section describe' });
    const btn = h('button', {
      class: 'describe-toggle', type: 'button', 'aria-expanded': String(describe.open),
      onclick: () => {
        describe.open = !describe.open;
        if (describe.open && describe.availability === null) aiAvailability().then((a) => { describe.availability = a; render(); });
        render();
      }
    }, 'describe a change', icon('chevron', `chev${describe.open ? ' up' : ''}`));
    sec.append(btn);
    if (!describe.open) return sec;
    const blocker = describeBlocker(cfg);
    const edits = !data.aiSettings || data.aiSettings.pageEdits !== false;
    const input = h('textarea', {
      class: 'describe-input', rows: '2', maxlength: '300',
      placeholder: edits ? 'e.g. hide the app banner and make the text bigger' : 'e.g. hide newsletter prompts but keep my current tracker settings',
      'aria-label': 'Describe a change for this site', disabled: !!blocker || describe.busy
    });
    input.value = describe.text;
    input.addEventListener('input', () => { describe.text = input.value; });
    sec.append(input);
    if (blocker) {
      sec.append(h('p', { class: 'note', role: 'status', text: blocker }));
      return sec;
    }
    if (describe.applied) {
      sec.append(h('div', { class: 'describe-done' }, h('span', { text: 'Applied and saved for this site.' }),
        h('button', { class: 'adj-btn', type: 'button', onclick: undoPlan, text: 'undo' })));
    }
    const saved = describe.saved && (data.pageEdits || []).find((e) => e.id === describe.saved);
    if (saved) {
      sec.append(h('div', { class: 'describe-saved' },
        h('p', { class: 'note', text: `You asked for this on this site before, and it is saved${saved.enabled ? '' : ' (switched off)'}: ${saved.label}.` }),
        h('div', { class: 'describe-actions' },
          h('button', { class: 'adj-btn primary', type: 'button', onclick: () => setEdit(saved.id, !saved.enabled), text: saved.enabled ? 'switch off' : 'switch on' }),
          h('button', { class: 'adj-btn', type: 'button', onclick: () => { describe.askAgain = true; previewChange(cfg); }, text: 'ask again' }))));
      return sec;
    }
    if (describe.error) sec.append(h('p', { class: 'note warn', role: 'alert', text: describe.error }));
    if (describe.plan) {
      const ul = h('ul', { class: 'plan' });
      for (const op of describe.ops) ul.append(h('li', {}, h('b', { text: RW.describePageEditOp(op) })));
      for (const line of describe.preview) ul.append(h('li', {}, h('span', { text: line.label }), h('span', { class: 'dim', text: ` ${line.from} → ` }), h('b', { text: line.to })));
      const nothing = !describe.preview.length && !describe.ops.length;
      if (nothing) ul.append(h('li', { class: 'dim', text: 'Nothing would change.' }));
      ul.append(h('li', { class: 'dim', text: describe.ops.length ? 'Shown on the page now. Nothing is saved until you apply.' : 'Everything else stays as it is.' }));
      sec.append(ul);
      if (describe.plan.unsupported.length) {
        sec.append(h('p', { class: 'note warn', text: `Not supported: ${describe.plan.unsupported.join('; ')}` }));
      }
      if (describe.notes.length) sec.append(h('p', { class: 'note warn', text: `Left out: ${describe.notes.join('; ')}` }));
      sec.append(h('div', { class: 'describe-actions' },
        h('button', { class: 'adj-btn primary', type: 'button', disabled: nothing, onclick: applyPlan, text: 'apply' }),
        h('button', { class: 'adj-btn', type: 'button', onclick: cancelPlan, text: 'cancel' })));
    } else {
      sec.append(h('div', { class: 'describe-actions' },
        h('button', { class: 'adj-btn primary', type: 'button', disabled: describe.busy, onclick: () => previewChange(cfg), text: describe.busy ? 'thinking…' : 'preview' })));
    }
    return sec;
  }

  function renderDomains(cfg) {
    const paused = !(cfg.adBlockNetwork || cfg.trackerHeuristicMode !== 'off' || cfg.stripUrlParams);
    const list = data.trackers;
    const sec = h('section', { class: 'section' },
      h('div', { class: 'section-t' }, h('span', { text: 'third-party domains' }), h('span', { text: String(list.length) })));
    if (paused) sec.append(h('p', { class: 'empty', text: 'network protection is off in this mode' }));
    else if (data.operatingMode === 'light') sec.append(h('p', { class: 'empty', text: 'the domain list is paused in Light mode' }));
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
