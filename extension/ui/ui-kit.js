// DOM and control helpers shared by the popup and options page. No innerHTML anywhere.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});
  const NS = 'http://www.w3.org/2000/svg';

  // 24x24 icons as [tag, attrs] pairs.
  const ICONS = {
    settings: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 17, r: 2 }]],
    gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }]],
    back: [['path', { d: 'M15 6l-6 6 6 6' }]],
    external: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
    off: [['path', { d: 'M12 3.5v7.5' }], ['path', { d: 'M6.6 6.8a8 8 0 1 0 10.8 0' }]],
    consent: [['path', { d: 'M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3.2 3.2 0 0 0 4 4 3.2 3.2 0 0 0 5 5z' }], ['path', { d: 'M8.5 10.5h.01M12 15h.01M8 15.5h.01M15.5 14h.01' }]],
    balanced: [['path', { d: 'M12 3l7 3v5.2c0 4.5-3 8.3-7 9.8-4-1.5-7-5.3-7-9.8V6l7-3z' }], ['path', { d: 'M12 3v18' }]],
    strict: [['path', { d: 'M12 3l7 3v5.2c0 4.5-3 8.3-7 9.8-4-1.5-7-5.3-7-9.8V6l7-3z' }], ['path', { d: 'M9 12l2.2 2.2L15.5 10' }]],
    custom: [['path', { d: 'M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3' }], ['path', { d: 'M3 10h4M10 7h4M17 13h4' }]],
    chevron: [['path', { d: 'M6 9l6 6 6-6' }]],
    undo: [['path', { d: 'M4 12a8 8 0 1 0 2.3-5.7L4 8.5' }], ['path', { d: 'M4 4v4.5h4.5' }]],
    target: [['circle', { cx: 12, cy: 12, r: 7.5 }], ['path', { d: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4' }], ['circle', { cx: 12, cy: 12, r: 1.2 }]],
    globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' }]],
    reload: [['path', { d: 'M20 12a8 8 0 1 1-2.3-5.7L20 8.5' }], ['path', { d: 'M20 4v4.5h-4.5' }]],
    trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' }]],
    download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
    upload: [['path', { d: 'M12 20V9M7 14l5-5 5 5M5 4h14' }]],
    search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M20 20l-4.2-4.2' }]],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
    eye: [['path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
    chart: [['path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }]],
    archive: [['path', { d: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4' }]],
    info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 7.5h.01' }]],
    radar: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['path', { d: 'M12 12l6-6' }]],
    list: [['path', { d: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' }]]
  };

  function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    for (const [tag, attrs] of ICONS[name] || []) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    return svg;
  }

  // h(tag, props, ...children). onX props become listeners, text sets textContent.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function send(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, payload: payload || {} }, (resp) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!resp || !resp.ok) { reject(new Error((resp && resp.error) || 'no_response')); return; }
        resolve(resp);
      });
    });
  }

  function toggle(checked, onChange, label, disabled) {
    const b = h('button', {
      class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked),
      'aria-label': label, disabled: !!disabled
    });
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return b;
  }

  function seg(options, value, onChange, label, disabled, variant) {
    const v = variant || 'bar';
    const wrap = h('div', { class: v, role: 'radiogroup', 'aria-label': label, 'aria-disabled': disabled ? 'true' : null });
    const buttons = options.map((o) => {
      const b = h('button', {
        class: v === 'btns' ? 'btn' : null, type: 'button', role: 'radio', 'aria-checked': String(o.value === value),
        title: o.title || null, tabindex: o.value === value ? '0' : '-1', text: o.label
      });
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-checked') === 'true') return;
        buttons.forEach((x) => { x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; });
        b.setAttribute('aria-checked', 'true');
        b.tabIndex = 0;
        onChange(o.value);
      });
      return b;
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const j = (i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[j].focus();
      buttons[j].click();
      e.preventDefault();
    });
    wrap.append(...buttons);
    return wrap;
  }

  const onOff = (value, onChange, label, disabled) =>
    seg([{ value: false, label: 'off' }, { value: true, label: 'on' }], !!value, onChange, label, disabled, 'btns');

  const TRI_LABELS = { allow: 'allow', cookie_block: 'cookies', block: 'block' };
  const TRI_TITLES = { allow: 'Allow', cookie_block: 'Block its cookies', block: 'Block it' };

  function tri(state, onChange, domain, disabled) {
    const wrap = h('div', { class: 'tri', role: 'radiogroup', 'aria-label': `Action for ${domain}`, 'aria-disabled': disabled ? 'true' : null });
    const buttons = ['allow', 'cookie_block', 'block'].map((s) => {
      const b = h('button', {
        type: 'button', role: 'radio', 'data-v': s, 'aria-checked': String(s === state),
        title: `${TRI_TITLES[s]}: ${domain}`, tabindex: s === state ? '0' : '-1', text: TRI_LABELS[s]
      });
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-checked') === 'true') return;
        buttons.forEach((x) => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        onChange(s);
      });
      return b;
    });
    wrap.append(...buttons);
    return wrap;
  }

  function fmt(n) {
    const v = Number(n) || 0;
    if (v < 10000) return v.toLocaleString();
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }

  function timeAgo(ts) {
    if (!ts) return ', ';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (s < 60) return 'just now';
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
    return new Date(ts).toLocaleDateString();
  }

  const ERROR_TEXT = {
    invalid_site: 'That is not a valid website domain.',
    invalid_domain: 'That is not a valid domain.',
    invalid_selector: 'That CSS selector is not allowed (no braces, comments or at-rules).',
    too_many_selectors: 'This site already has the maximum number of hidden elements.',
    first_party: 'A site cannot override its own domain.',
    invalid_file: 'That file is not a Rockyweb backup.',
    file_too_large: 'That file is too large.'
  };
  const errorText = (err) => ERROR_TEXT[err && err.message] || (err && err.message) || 'Something went wrong.';

  RW.UI = { ICONS, icon, h, send, toggle, seg, onOff, tri, fmt, timeAgo, errorText, TRI_LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
