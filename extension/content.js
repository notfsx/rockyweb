// Rockyweb content script: cosmetic CSS request, cookie consent engine, toast, element picker.
// Runs in the isolated world; page scripts cannot see it. UI lives in closed shadow roots.
(() => {
  'use strict';

  const RW = globalThis.RockyShared;
  if (!RW || !RW.ACTIONS || globalThis.__rockywebContentLoaded) return;
  globalThis.__rockywebContentLoaded = true;

  const A = RW.ACTIONS;
  let IS_TOP = false;
  try { IS_TOP = window.top === window; } catch (_) { IS_TOP = false; }
  const CONSENT_HOST = RW.CONSENT_FRAME_HOST_RE.test(location.hostname);

  let config = null;
  let intent = null;

  // ---------------------------------------------------------------- utils

  function send(action, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action, payload: payload || {} }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(resp || null);
        });
      } catch (_) {
        resolve(null); // extension was reloaded; this context is orphaned
      }
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // For reports the worker treats as idempotent: retry if Chrome stopped the worker mid-message.
  async function sendReport(action, payload) {
    for (const wait of [0, 400, 1500, 4000]) {
      if (wait) await sleep(wait);
      const resp = await send(action, payload);
      if (resp) return resp;
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
  }

  function normalizeText(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  }

  function labelOf(el) {
    let t = el instanceof HTMLInputElement ? el.value || el.getAttribute('aria-label') || '' : el.innerText || el.textContent || '';
    t = normalizeText(t);
    if (!t || t.length > 60) {
      const aria = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (aria && aria.length <= 60) return aria;
    }
    return t.length <= 60 ? t : '';
  }

  const matchesAny = (patterns, text) => !!text && patterns.some((re) => re.test(text));

  function qsAll(root, selector) {
    try { return Array.from(root.querySelectorAll(selector)); } catch (_) { return []; }
  }

  function firstVisible(root, selectors) {
    if (!root || !selectors) return null;
    for (const sel of selectors) {
      for (const el of qsAll(root, sel)) if (isVisible(el)) return el;
    }
    return null;
  }

  const BUTTON_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a[href], a[role], a:not([href])[onclick], [tabindex="0"]';

  function collectButtons(scope) {
    const out = [];
    for (const el of qsAll(scope, BUTTON_SELECTOR)) {
      if (out.length >= 80) break;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !isVisible(el)) continue;
      const label = labelOf(el);
      if (label) out.push({ el, label });
    }
    return out;
  }

  let clickBudget = 12;
  function press(el) {
    if (!el || clickBudget <= 0) return false;
    clickBudget--;
    try {
      el.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function waitFor(fn, timeout, interval) {
    const end = Date.now() + (timeout || 3000);
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval || 150);
    }
    return null;
  }

  function forceHide(el) {
    if (el && el.style) {
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-rockyweb-hidden', 'consent');
    }
  }

  const FONT = '"Lexend Deca", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif';

  // Most recent real user gesture. Dialogues that appear right after one were opened by the user.
  const Activity = { at: 0 };
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, (e) => { if (e.isTrusted) Activity.at = Date.now(); }, { capture: true, passive: true });
  }
  const USER_OPENED_WINDOW = 2500;
  const recentlyUsed = () => Date.now() - Activity.at < USER_OPENED_WINDOW;

  // ---------------------------------------------------------------- toast

  // One quiet line in the corner, in the popup's style: the wordmark, what happened, and where.
  const Toast = (() => {
    let host = null;
    let timer = 0;
    const STYLE = `
      :host { all: initial; --fs-xs: 11px; --fs-m: 13px; } /* same steps as ui/tokens.css */
      .t { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: baseline; gap: 10px;
        max-width: min(380px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 10px;
        background: #17120E; color: #F3E9DC; border: 1px solid rgba(196,173,150,.12);
        box-shadow: 0 6px 20px rgba(0,0,0,.28); font: 400 var(--fs-m)/1.35 ${FONT}; letter-spacing: -0.005em;
        pointer-events: none; animation: in .2s cubic-bezier(.2,.8,.2,1) both; }
      .t.out { animation: out .2s ease forwards; }
      .w { flex: none; color: #E0975A; font-weight: 500; letter-spacing: -0.01em; }
      .d { color: rgba(196,173,150,.78); }
      @keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @keyframes out { to { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .t, .t.out { animation: none; } }
    `;

    function show(what, detail) {
      if (!IS_TOP || !document.documentElement) return;
      try {
        if (host) host.remove();
        clearTimeout(timer);
        host = document.createElement('rockyweb-toast');
        const shadow = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = STYLE;
        const box = document.createElement('div');
        box.className = 't';
        box.setAttribute('role', 'status');
        const mark = document.createElement('span');
        mark.className = 'w';
        mark.textContent = 'rockyweb';
        const text = document.createElement('span');
        text.textContent = what;
        if (detail) {
          const d = document.createElement('span');
          d.className = 'd';
          d.textContent = ` · ${detail}`;
          text.append(d);
        }
        box.append(mark, text);
        shadow.append(style, box);
        document.documentElement.appendChild(host);
        timer = setTimeout(() => {
          box.classList.add('out');
          setTimeout(() => { if (host) { host.remove(); host = null; } }, 250);
        }, 3200);
      } catch (_) { /* UI must never break the page */ }
    }

    return { show };
  })();

  // What the corner note says after a cookie banner: plain words, and the platform only when it is a named one.
  function consentNote(info) {
    const what = info.method === 'hidden' ? 'cookie notice hidden, nothing agreed'
      : info.decision === 'accept' ? 'cookies accepted, as you set'
        : info.decision === 'custom' ? 'your cookie choices applied'
          : 'cookies refused';
    Toast.show(what, info.cmp && info.cmp !== 'Generic' ? info.cmp : '');
  }

  // ---------------------------------------------------------------- scroll-lock healing

  const Scroll = (() => {
    function otherModalOpen() {
      const nodes = qsAll(document, '[aria-modal="true"], dialog[open]').slice(0, 20);
      return nodes.some((n) => isVisible(n) && !RW.CONSENT_COOKIE_TEXT_RE.test((n.innerText || '').slice(0, 2000)) && !n.hasAttribute('data-rockyweb-hidden'));
    }

    function heal(extraClasses) {
      if (!IS_TOP) return;
      const html = document.documentElement;
      const body = document.body;
      if (!html) return;
      const modal = otherModalOpen();
      const classes = new Set([...(extraClasses || []), ...(modal ? [] : RW.SCROLL_LOCK_CLASSES)]);
      for (const el of [html, body]) {
        if (!el) continue;
        for (const c of classes) if (el.classList.contains(c)) el.classList.remove(c);
      }
      if (modal) return; // a real site modal may lock scrolling on purpose

      for (const el of [html, body]) {
        if (!el) continue;
        const st = el.style;
        if (/hidden|clip/.test(st.overflow) || /hidden|clip/.test(st.overflowY)) {
          st.removeProperty('overflow');
          st.removeProperty('overflow-y');
        }
      }
      if (body && body.style.position === 'fixed') {
        const top = parseInt(body.style.top || '0', 10);
        for (const p of ['position', 'top', 'left', 'right', 'width']) body.style.removeProperty(p);
        if (top < 0) window.scrollTo(0, -top);
      }
      const overflows = Math.max(html.scrollHeight, body ? body.scrollHeight : 0) > window.innerHeight + 10;
      if (overflows) {
        for (const el of [html, body]) {
          if (!el) continue;
          const cs = getComputedStyle(el);
          if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') el.style.setProperty('overflow-y', 'auto', 'important');
        }
      }
      if (body && getComputedStyle(body).pointerEvents === 'none') body.style.setProperty('pointer-events', 'auto', 'important');
    }

    function healSoon(extraClasses) {
      heal(extraClasses);
      setTimeout(() => heal(extraClasses), 800);
      setTimeout(() => heal(extraClasses), 2200);
    }

    return { healSoon };
  })();

  // ---------------------------------------------------------------- consent engine

  const Consent = (() => {
    const RULES = RW.CONSENT_RULES;
    let handled = false;
    let busy = false;
    let pending = false;
    let apiResult = null; // null while the MAIN-world API attempt is pending
    let attempts = 0;
    let startedAt = 0;
    let stopAt = 0;
    let observer = null;
    let interval = 0;
    const failedRules = new Set();
    const failedContainers = new WeakSet();
    const userOpened = new Set();
    let bounded = false;
    let timers = [];

    function ruleRoot(rule) {
      if (!rule.shadowHost) return document;
      const host = document.querySelector(rule.shadowHost);
      return (host && host.shadowRoot) || null;
    }

    function detectKnown() {
      for (const rule of RULES) {
        if (failedRules.has(rule.id)) continue;
        const root = ruleRoot(rule);
        if (!root) continue;
        const el = firstVisible(root, rule.detect);
        if (el) return { rule, root, banner: el };
      }
      return null;
    }

    const OVERLAY_CANDIDATES = [
      '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
      '[id*="gdpr" i]', '[class*="gdpr" i]', '[id*="privacy" i]', '[aria-label*="cookie" i]',
      '[aria-label*="consent" i]', '[aria-describedby*="cookie" i]', '[role="dialog"]',
      '[role="alertdialog"]', 'dialog[open]'
    ].join(',');

    const TOP_LEVEL_OVERLAYS = [
      'body > div', 'body > section', 'body > aside', 'body > footer', 'body > form', 'body > dialog',
      'body > div > div', 'body > div > section', 'body > div > aside'
    ].join(',');

    function overlayAncestor(el) {
      let cur = el;
      for (let i = 0; cur && cur !== document.body && cur !== document.documentElement && i < 8; i++) {
        const pos = getComputedStyle(cur).position;
        if (pos === 'fixed' || pos === 'sticky') return cur;
        if (cur.tagName === 'DIALOG' && cur.open) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    // An ordinary block named as a cookie banner, in the first screen, that offers a reject answer
    // (GOV.UK style). Overlays are handled above; this never acts on text further down a page.
    const INLINE_NAMED = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [aria-label*="consent" i]';
    function inlineBanner(el) {
      if (!el.matches(INLINE_NAMED)) return null;
      const r = el.getBoundingClientRect();
      if (r.top + window.scrollY > window.innerHeight || r.height < 30 || r.height > window.innerHeight * 0.7) return null;
      return collectButtons(el).some((b) => matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label)) ? el : null;
    }

    function detectGeneric() {
      if (CONSENT_HOST) {
        const body = document.body;
        if (body && !failedContainers.has(body) && collectButtons(body).length) return { container: body };
        return null;
      }
      if (!IS_TOP) return null;
      const named = qsAll(document, OVERLAY_CANDIDATES).slice(0, 400);
      const anonymous = qsAll(document, TOP_LEVEL_OVERLAYS).slice(0, 80)
        .filter((el) => { const pos = getComputedStyle(el).position; return pos === 'fixed' || pos === 'sticky'; });
      for (const el of [...named, ...anonymous]) {
        if (el === document.body || el === document.documentElement) continue;
        if (el.closest('[data-rockyweb-hidden]') || !isVisible(el)) continue;
        const box = overlayAncestor(el) || inlineBanner(el);
        if (!box || failedContainers.has(box) || !isVisible(box)) continue;
        if (box.querySelector('input[type="password"], input[type="email"], input[type="search"], textarea')) continue;
        if (!RW.CONSENT_STRONG_TEXT_RE.test((box.innerText || '').slice(0, 8000))) continue;
        if (box.getBoundingClientRect().height < 30) continue;
        const buttons = collectButtons(box);
        if (!buttons.length) continue;
        // A banner first seen straight after your click or key press is yours: never answered for you.
        if (!bannerSeen.has(box)) bannerSeen.set(box, { at: Date.now(), byUser: recentlyUsed() });
        if (bannerSeen.get(box).byUser) continue;
        // Must look like a consent UI: an accept/reject answer, or a plain notice. With AI on, a banner
        // whose buttons no rule recognises may still go to the model, refusal-like buttons only.
        const answers = buttons.some((b) => matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label) || matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label));
        if (!answers && !isNoticeOnly(box)) {
          if (!aiTried && IS_TOP && config && config.consentAi && consentCandidates(box).length) return { container: box, aiOnly: true };
          continue;
        }
        return { container: box };
      }
      return frameBanner();
    }

    // Some platforms (AppConsent, for one) draw the banner inside an iframe with no address of its own,
    // where the content script does not run. The top frame may read such a same-origin frame directly.
    const frameOf = new WeakMap();
    function frameBanner() {
      for (const frame of qsAll(document, 'iframe:not([src]), iframe[src="about:blank"], iframe[srcdoc]').slice(0, 20)) {
        if (!isVisible(frame)) continue;
        const r = frame.getBoundingClientRect();
        if (r.width * r.height < 20000) continue;
        let body = null;
        try { body = frame.contentDocument && frame.contentDocument.body; } catch (_) { body = null; }
        if (!body || failedContainers.has(body)) continue;
        if (body.querySelector('input[type="password"], input[type="email"], input[type="search"], textarea')) continue;
        if (!RW.CONSENT_STRONG_TEXT_RE.test((body.innerText || '').slice(0, 8000))) continue;
        const buttons = collectButtons(body);
        if (!buttons.some((b) => matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label) || matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label))) continue;
        if (!bannerSeen.has(body)) bannerSeen.set(body, { at: Date.now(), byUser: recentlyUsed() });
        if (bannerSeen.get(body).byUser) continue;
        frameOf.set(body, frame);
        return { container: body };
      }
      return null;
    }

    function toggleLabel(input) {
      const parts = [];
      const id = input.getAttribute('id');
      if (id) {
        const q = `label[for="${window.CSS.escape(id)}"]`;
        const rootNode = input.getRootNode();
        const lab = document.querySelector(q) || (rootNode.querySelector ? rootNode.querySelector(q) : null);
        if (lab) parts.push(lab.innerText || lab.textContent || '');
      }
      const wrap = input.closest('label');
      if (wrap) parts.push(wrap.innerText || '');
      const labelledBy = input.getAttribute('aria-labelledby');
      if (labelledBy) {
        for (const ref of labelledBy.split(/\s+/)) {
          const n = document.getElementById(ref);
          if (n) parts.push(n.innerText || n.textContent || '');
        }
      }
      parts.push(input.getAttribute('aria-label') || '', input.getAttribute('name') || '', id || '', input.getAttribute('value') || '');
      let cur = input.parentElement;
      for (let i = 0; cur && i < 4; i++, cur = cur.parentElement) {
        const t = (cur.innerText || '').trim();
        if (t && t.length < 240) { parts.push(t); break; }
      }
      return parts.join(' ').slice(0, 600);
    }

    function categoryOf(text) {
      const P = RW.CONSENT_CATEGORY_PATTERNS;
      if (P.necessary.test(text)) return 'necessary';
      if (P.marketing.test(text)) return 'marketing';
      if (P.analytics.test(text)) return 'analytics';
      if (P.functional.test(text)) return 'functional';
      return 'unknown';
    }

    const isOn = (el) => (el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true');

    // Returns how many non-necessary toggles were found.
    function applyToggles(scope, categories) {
      const toggles = qsAll(scope, 'input[type="checkbox"], [role="switch"], [role="checkbox"]')
        .filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
        .slice(0, 60);
      let seen = 0;
      for (const t of toggles) {
        const cat = categoryOf(toggleLabel(t));
        if (cat === 'necessary') continue;
        seen++;
        const want = cat === 'unknown' ? false : !!categories[cat];
        if (isOn(t) !== want) {
          const target = t instanceof HTMLInputElement && !isVisible(t) && t.closest('label') ? t.closest('label') : t;
          press(target);
        }
      }
      return seen;
    }

    // A link to another page or window: following it would navigate away from the banner.
    function linkLeaves(el) {
      const a = el.closest('a[href]');
      if (!a) return false;
      if (a.target && a.target !== '_self') return true;
      const raw = a.getAttribute('href') || '';
      if (/^\s*(#|javascript:)/i.test(raw)) return false;
      try {
        const u = new URL(raw, location.href);
        return u.origin + u.pathname + u.search !== location.origin + location.pathname + location.search;
      } catch (_) { return true; }
    }

    // A refusal whose accessible name says accept is a trap: never press it. (Ids are no guide:
    // NHS gives its real reject button the id ...link_accept.)
    function namedAccept(el) {
      const n = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (!n || matchesAny(RW.CONSENT_REJECT_PATTERNS, n)) return false;
      return matchesAny(RW.CONSENT_ACCEPT_PATTERNS, n) || /\b(accept|agree|allow|consent)/.test(n);
    }
    function safeRefusal(b) {
      return matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label) && !namedAccept(b.el) && !linkLeaves(b.el);
    }

    async function settingsFlow(root, container, rule, categories) {
      const settingsBtn = (rule && firstVisible(root, rule.settings)) ||
        collectButtons(container).find((b) => RW.CONSENT_SETTINGS_RE.test(b.label) && !matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label) &&
          !matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label) && !linkLeaves(b.el));
      if (!settingsBtn) return false;
      press(settingsBtn.el || settingsBtn);
      await sleep(700);
      // The toggles may be in the banner itself or in a preferences dialogue it just opened.
      const hasToggles = (el) => qsAll(el, 'input[type="checkbox"], [role="switch"], [role="checkbox"]').some((t) => !t.disabled);
      const scopeFor = () => {
        const options = [];
        if (rule && rule.toggleScope) options.push(...qsAll(root, rule.toggleScope));
        if (container.isConnected) options.push(container);
        options.push(...qsAll(document, '[role="dialog"], [aria-modal="true"], dialog[open]')
          .filter((d) => RW.CONSENT_COOKIE_TEXT_RE.test((d.innerText || '').slice(0, 4000))));
        return options.find((el) => isVisible(el) && hasToggles(el)) || null;
      };
      const scope = await waitFor(scopeFor, 2500);
      if (!scope || !applyToggles(scope, categories)) return false;
      await sleep(200);
      const saveBtn = (rule && firstVisible(root, rule.save)) ||
        collectButtons(scope).find((b) => matchesAny(RW.CONSENT_SAVE_PATTERNS, b.label));
      return saveBtn ? press(saveBtn.el || saveBtn) : false;
    }

    async function rejectFlow(root, container, rule) {
      const direct = (rule && firstVisible(root, rule.reject)) ||
        collectButtons(container).find(safeRefusal);
      if (direct) return press(direct.el || direct) ? 'reject' : null;
      if (await settingsFlow(root, container, rule, { necessary: true, functional: false, analytics: false, marketing: false })) {
        await sleep(300);
        return 'reject';
      }
      // A second-layer preference dialog may now show a reject button.
      const later = collectButtons(document.body).find((b) => {
        if (!safeRefusal(b)) return false;
        const dlg = b.el.closest('[role="dialog"], [aria-modal="true"], dialog');
        return !!dlg && RW.CONSENT_STRONG_TEXT_RE.test((dlg.innerText || '').slice(0, 4000));
      });
      return later && press(later.el) ? 'reject' : null;
    }

    async function acceptFlow(root, container, rule) {
      const btn = (rule && firstVisible(root, rule.accept)) ||
        collectButtons(container).find((b) => matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label));
      return btn && press(btn.el || btn) ? 'accept' : null;
    }

    const TOGGLES = 'input[type="checkbox"]:not([disabled]), [role="switch"], [role="checkbox"]';
    function panelInPage(container) {
      if (qsAll(container, TOGGLES).length) return true;
      return qsAll(document, '[role="dialog"], [aria-modal="true"], dialog').some((d) => d !== container &&
        !!d.querySelector(TOGGLES) && RW.CONSENT_COOKIE_TEXT_RE.test((d.textContent || '').slice(0, 4000)));
    }

    function hasDirectRefusal(root, container, rule) {
      return !!((rule && firstVisible(root, rule.reject)) || collectButtons(container).find(safeRefusal));
    }

    function openConsentDialogs() {
      return qsAll(document, '[role="dialog"], [aria-modal="true"], dialog[open]')
        .filter((d) => isVisible(d) && RW.CONSENT_COOKIE_TEXT_RE.test((d.innerText || '').slice(0, 4000)));
    }

    const CLOSE_RE = /^(close|back|go back|×|✕|x|schließen|zurück|fermer|retour|cerrar|volver|chiudi|indietro|sluiten|terug|fechar|voltar|zamknij|wstecz|stäng|tillbaka|luk|tilbage|lukk|sulje|takaisin|zavřít|zpět|bezár|vissza)$/;
    async function backOut(dialogsBefore) {
      for (const d of openConsentDialogs()) {
        if (dialogsBefore.has(d)) continue;
        const close = collectButtons(d).find((b) => (CLOSE_RE.test(b.label) || CLOSE_RE.test(normalizeText(b.el.getAttribute('aria-label') || b.el.getAttribute('title') || ''))) &&
          !matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label) && !namedAccept(b.el) && !linkLeaves(b.el));
        if (close && press(close.el)) { await sleep(600); return true; }
      }
      return false;
    }

    async function decide(root, container, rule) {
      if (intent.decision === 'accept') return acceptFlow(root, container, rule);
      if (intent.decision === 'custom') {
        // The settings route is tried only where its toggles are known to be reachable: a rule that names
        // them, or a preference panel already in the page. Elsewhere (Ryanair loads its settings in an
        // iframe) a plain refusal is safer than a settings layer that cannot be finished.
        const reachable = rule ? !!rule.toggleScope : panelInPage(container);
        if (!reachable && hasDirectRefusal(root, container, rule)) return rejectFlow(root, container, rule);
        const dialogsBefore = new Set(openConsentDialogs());
        if (await settingsFlow(root, container, rule, intent.categories)) return 'custom';
        const refused = await rejectFlow(root, container, rule); // privacy-safe fallback
        if (refused) return refused;
        // The settings layer we opened could not be finished: close it (never save or accept) and refuse
        // from the first layer, so the page is not left behind an open dialogue.
        if (await backOut(dialogsBefore)) return rejectFlow(root, container, rule);
        return null;
      }
      return rejectFlow(root, container, rule);
    }

    function isNoticeOnly(container) {
      const btns = collectButtons(container);
      if (!btns.length || btns.length > 3) return false;
      if (btns.some((b) => RW.CONSENT_SETTINGS_RE.test(b.label))) return false;
      return btns.every((b) => RW.CONSENT_NOTICE_DISMISS_RE.test(b.label) || /privacy|policy|learn more|more info|datenschutz/.test(b.label));
    }

    function finish(info, hideTargets, scrollClasses) {
      handled = true;
      stop();
      sendReport(A.CONSENT_HANDLED, { cmp: info.cmp, method: info.method, decision: info.decision });
      if (IS_TOP && config && config.showToastBadge) consentNote(info);
      setTimeout(() => {
        for (const t of hideTargets()) if (isVisible(t)) forceHide(t);
        Scroll.healSoon(scrollClasses);
      }, 900);
    }

    function hideTargetsForRule(rule) {
      return () => {
        const root = ruleRoot(rule) || document;
        const out = [];
        for (const sel of rule.hide || rule.detect) out.push(...qsAll(root, sel));
        if (rule.shadowHost) { const h = document.querySelector(rule.shadowHost); if (h) out.push(h); }
        return out;
      };
    }

    async function handleKnown(match) {
      const { rule, root, banner } = match;
      attempts++;
      if (rule.containerOnly) return; // buttons are in a consent iframe; that frame answers
      const container = banner.closest('[role="dialog"], [aria-modal="true"], dialog') || banner;
      const decision = await decide(root, container, rule);
      if (decision) {
        finish({ cmp: rule.name, method: 'dom', decision }, hideTargetsForRule(rule), rule.scrollClasses);
        return;
      }
      if (intent.decision !== 'accept' && isNoticeOnly(container)) {
        forceHide(container);
        finish({ cmp: rule.name, method: 'hidden', decision: 'reject' }, () => [container], rule.scrollClasses);
        return;
      }
      failedRules.add(rule.id);
    }

    // ---- unknown banners answered with the on-device model
    // Runs only after every rule above gave up on a banner that still looks like consent. Offers the
    // model refusal-like buttons only, rechecks everything before one click, then verifies it.

    let aiTried = false;
    const bannerSeen = new WeakMap();
    const STORE_KEY = /(consent|cookie|gdpr|privacy|cmp|tcf|optanon|didomi|usercentrics|cookiebot)/i;

    function bannerLang(container) {
      const el = container.closest('[lang]') || document.documentElement;
      const lang = String((el && el.getAttribute('lang')) || '').toLowerCase().split(/[-_]/)[0];
      if (/^[a-z]{2,3}$/.test(lang)) return lang;
      return /\b(the|we|you|your|our|use|and)\b/i.test((container.innerText || '').slice(0, 600)) ? 'en' : '';
    }

    // Everything on the element that could reveal an accept button behind refusal-like text.
    function attrText(el) {
      const parts = [el.id, String(el.className || ''), el.getAttribute('name'), el.getAttribute('value'), el.getAttribute('aria-label'), el.getAttribute('title')];
      for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) parts.push(a.name, a.value);
      return parts.filter(Boolean).join(' ').slice(0, 800);
    }

    // Links to another page, new windows and form submissions are never candidates.
    function leavesPage(el) {
      if (linkLeaves(el)) return true;
      const form = el.form || el.closest('form');
      const submits = el.matches('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
      return !!form && submits && (form.getAttribute('method') || '').toLowerCase() !== 'dialog';
    }

    // The label as the page shows it, for the model and the toolbar; checks use the normalised label.
    function shownLabel(el, label) {
      const t = String((el instanceof HTMLInputElement ? el.value : el.innerText) || '').replace(/\s+/g, ' ').trim();
      return t && normalizeText(t) === label ? t : label;
    }

    function consentCandidates(container) {
      const out = [];
      for (const b of collectButtons(container)) {
        if (out.length >= RW.AI_CONSENT_MAX_BUTTONS) break;
        if (!RW.consentLabelAllowed(b.label) || !RW.consentAttrAllowed(attrText(b.el)) || leavesPage(b.el)) continue;
        if (out.some((c) => c.label === b.label)) continue;
        out.push({ id: `b${out.length + 1}`, el: b.el, label: b.label, shown: shownLabel(b.el, b.label) });
      }
      return out;
    }

    // Consent-looking cookies and storage keys, compared before and after the click. Read and compared
    // here only; nothing is sent anywhere.
    function consentStore() {
      const parts = [];
      try { for (const c of document.cookie.split(';')) if (STORE_KEY.test(c.split('=')[0])) parts.push(c.trim()); } catch (_) { /* blocked */ }
      try {
        for (let i = 0; i < localStorage.length && i < 200; i++) {
          const k = localStorage.key(i);
          if (STORE_KEY.test(k)) parts.push(`${k}=${String(localStorage.getItem(k)).slice(0, 200)}`);
        }
      } catch (_) { /* blocked */ }
      return { readable: parts.length > 0, value: parts.sort().join('\n') };
    }

    function aiAllowed(container) {
      if (aiTried || !IS_TOP || bounded || !RW.AI_CONSENT_ENABLED || !config || !config.consentAi) return false;
      if (!RW.consentWantsRefusal(intent)) return false;
      // A banner you opened, or are using, is yours.
      const seen = bannerSeen.get(container);
      if (recentlyUsed() || !seen || seen.byUser) return false;
      return !(document.activeElement && container.contains(document.activeElement) && document.activeElement !== container);
    }

    async function aiAnswer(container) {
      if (!aiAllowed(container)) return false;
      aiTried = true; // one attempt per page, never repeated automatically
      const cands = consentCandidates(container);
      const lang = bannerLang(container);
      if (!cands.length || !lang) return false;
      const heading = container.querySelector('h1, h2, h3, h4, [class*="title" i], [class*="heading" i]');
      const signature = RW.consentSignature(cands.map((c) => c.label));
      const href = location.href;
      const epoch = config.epoch;
      const askedAt = Date.now();
      const resp = await send(A.AI_EVALUATE_CONSENT, { signals: {
        signature, lang, heading: heading ? (heading.innerText || '').slice(0, 120) : '',
        buttonCount: collectButtons(container).length,
        buttons: cands.map(({ id, shown }) => ({ id, label: shown }))
      } });
      if (!resp || !resp.ok || resp.outcome !== 'refuse_non_essential') return false;
      const target = cands.find((c) => c.id === resp.candidate && c.shown === resp.label);
      // Recheck: same document and settings, banner and button unchanged and visible, untouched by you.
      if (!target || handled || !config || config.epoch !== epoch || resp.epoch !== epoch || location.href !== href) return false;
      if (Activity.at > askedAt || !container.isConnected || !isVisible(container)) return false;
      if (!target.el.isConnected || !isVisible(target.el) || !container.contains(target.el) || labelOf(target.el) !== target.label) return false;
      if (!RW.consentLabelAllowed(target.label) || !RW.consentAttrAllowed(attrText(target.el)) || leavesPage(target.el)) return false;
      if (RW.consentSignature(consentCandidates(container).map((c) => c.label)) !== signature) return false;
      const attempt = await send(A.AI_CONSENT_ATTEMPT, {});
      if (!attempt || !attempt.ok || handled) return false;

      const before = consentStore();
      let left = false;
      const onLeave = () => { left = true; };
      window.addEventListener('pagehide', onLeave);
      window.addEventListener('beforeunload', onLeave);
      press(target.el);
      const gone = await waitFor(() => !container.isConnected || !isVisible(container), 4000, 150);
      let changed = consentStore().value !== before.value;
      if (gone && !changed) changed = !!(await waitFor(() => consentStore().value !== before.value, 1500, 150));
      const readable = before.readable || consentStore().readable;
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
      // Verified only if the banner went away, the page stayed, and readable consent storage changed.
      const verified = !!gone && !left && location.href === href && (!readable || changed);
      const id = `a${Math.random().toString(36).slice(2, 10)}`;
      sendReport(A.AI_CONSENT_RESULT, { id, signature, label: target.shown, verified, source: resp.source });
      if (verified) finish({ cmp: 'Generic', method: 'ai', decision: 'reject' }, () => [], []);
      else halt();
      return true;
    }

    async function handleGeneric({ container, aiOnly }) {
      attempts++;
      if (aiOnly) {
        if (!(await aiAnswer(container))) failedContainers.add(container);
        return;
      }
      const decision = await decide(document, container, null);
      if (decision) {
        finish({ cmp: 'Generic', method: 'heuristic', decision }, () => [frameOf.get(container) || container], []);
        return;
      }
      if (!CONSENT_HOST && intent.decision !== 'accept' && isNoticeOnly(container)) {
        forceHide(container);
        finish({ cmp: 'Generic', method: 'hidden', decision: 'reject' }, () => [container], []);
        return;
      }
      if (await aiAnswer(container)) return;
      failedContainers.add(container);
    }

    async function scan() {
      pending = false;
      if (handled || busy || attempts >= 6) return;
      if (Date.now() > stopAt) { stop(); return; }
      busy = true;
      try {
        const match = detectKnown();
        if (match) {
          if (match.rule.api && IS_TOP && apiResult === null) return; // wait for the API attempt
          // A banner that appears straight after a click was opened by the user: leave it alone.
          if (recentlyUsed()) { userOpened.add(match.rule.id); return; }
          if (userOpened.has(match.rule.id)) return;
          await handleKnown(match);
          return;
        }
        if (bounded) return; // Light mode: recognised platforms only
        if (IS_TOP && apiResult === null && Date.now() - startedAt < 2500) return;
        const generic = detectGeneric(); // also notes banners that appear just after your input
        if (recentlyUsed()) return;
        if (generic) await handleGeneric(generic);
      } catch (_) {
        /* a broken page must never break us */
      } finally {
        busy = false;
      }
    }

    function schedule() {
      if (pending || handled) return;
      pending = true;
      setTimeout(scan, 250);
    }

    function stop() {
      if (observer) { observer.disconnect(); observer = null; }
      if (interval) { clearInterval(interval); interval = 0; }
      for (const t of timers) clearTimeout(t);
      timers = [];
    }

    // Stop all further work on this page (Light switched on, consent turned off, or a decision exists).
    function halt() {
      handled = true;
      stop();
    }

    function start(depth) {
      if (!intent || (!IS_TOP && !CONSENT_HOST) || depth === 'off') return;
      bounded = depth === 'bounded';
      if (bounded && !IS_TOP) return;
      startedAt = Date.now();
      stopAt = startedAt + (bounded ? 6000 : 30000);

      if (IS_TOP) {
        send(A.RUN_CMP_API).then((resp) => {
          apiResult = (resp && resp.ok && resp.result) || { handled: false, reason: 'unavailable' };
          if (handled) return;
          // The platform says the user already answered: never touch its dialogues on this page.
          if (apiResult.reason === 'already_decided') { halt(); return; }
          if (apiResult.handled) {
            const rule = RULES.find((r) => r.name === apiResult.cmp);
            finish({ cmp: apiResult.cmp, method: 'api', decision: apiResult.decision || intent.decision },
              rule ? hideTargetsForRule(rule) : () => [], rule ? rule.scrollClasses : []);
            return;
          }
          schedule();
        });
      } else {
        apiResult = { handled: false, reason: 'frame' };
      }

      const begin = () => {
        if (handled) return;
        schedule();
        if (bounded) {
          // Three cheap checks, no observer and no retries after that.
          timers = [1500, 4000].map((ms) => setTimeout(schedule, ms));
          return;
        }
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        interval = setInterval(() => (Date.now() > stopAt ? stop() : schedule()), 1000);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
      else begin();
    }

    // Top frame: a consent iframe handled the popup, so clean up here.
    function followup(info) {
      const rule = RULES.find((r) => r.name === info.cmp);
      if (info.fromSubframe) {
        handled = true;
        stop();
        setTimeout(() => {
          if (rule) for (const t of hideTargetsForRule(rule)()) if (isVisible(t)) forceHide(t);
          Scroll.healSoon(rule ? rule.scrollClasses : []);
        }, 900);
      }
      if (info.showToast) consentNote(info);
    }

    // Still looking for or answering a cookie banner on this page.
    const working = () => !handled && stopAt > Date.now();

    return { start, followup, halt, working };
  })();

  // ---------------------------------------------------------------- automatic optimisation (newsletter overlays)
  // Finds overlays cheaply, sends compact signals (never form values, cookies or query strings) for a
  // decision, rechecks everything before acting, and only ever hides the one element on this page.

  const Optimiser = (() => {
    const MAX_SCANS = 6;
    const MAX_REQUESTS = 3;
    const seen = new WeakSet();
    const firstSeen = new WeakMap();
    const applied = new Map(); // adjustment id -> { el, prev, prevPriority }
    let generation = 0;
    let observer = null;
    let scanTimer = 0;
    let scans = 0;
    let requests = 0;
    let candidateCounter = 0;
    let running = false;

    const PATH_ACCOUNT = /(^|\/)(log-?in|sign-?in|signin|account|my-account|profile|register|sign-?up|password|auth)(\/|$|\.)/i;
    const PATH_CHECKOUT = /(^|\/)(checkout|cart|basket|payment|order|billing)(\/|$|\.)/i;
    const PATH_SEARCH = /(^|\/)search(\/|$)/i;
    const VENDOR_RE = new RegExp(RW.AI_VENDORS.join('|'), 'i');
    const WORDS = [
      ['newsletter', /newsletter|mailing list|in your inbox|weekly email|daily email/i],
      ['subscribe', /subscribe|sign up|join (us|our|the)|get updates/i],
      ['discount', /% ?off|discount|coupon|promo code/i],
      ['sign_in', /sign in|log ?in|password|forgot/i],
      ['account', /my account|create (an )?account|your account/i],
      ['checkout', /checkout|basket|your cart|place order/i],
      ['payment', /card number|payment|billing/i],
      ['cookie', /cookie|consent/i]
    ];

    function stableToken(t) {
      return /^[A-Za-z][\w-]{1,30}$/.test(t) && !/\d{3,}/.test(t) && !/^(css|sc|jsx|svelte|emotion|styled)-/i.test(t) &&
        !/[a-z][A-Z].*\d|\d.*[A-Z][a-z]/.test(t);
    }

    function articleOnPage() {
      const og = document.querySelector('meta[property="og:type"]');
      return !!(document.querySelector('article, [itemtype*="Article"]') || (og && /article/i.test(og.getAttribute('content') || '')));
    }

    function pageKind() {
      const path = location.pathname || '/';
      if (PATH_ACCOUNT.test(path)) return 'account';
      if (PATH_CHECKOUT.test(path)) return 'checkout';
      if (PATH_SEARCH.test(path)) return 'search';
      if (articleOnPage()) return 'article';
      if (path === '/' || path === '') return 'home';
      return 'other';
    }

    function isOverlay(el) {
      for (let cur = el, i = 0; cur && cur !== document.body && i < 4; cur = cur.parentElement, i++) {
        const p = getComputedStyle(cur).position;
        if (p === 'fixed' || p === 'sticky') return true;
        if (cur.tagName === 'DIALOG' && cur.open) return true;
        if (cur.getAttribute('aria-modal') === 'true') return true;
      }
      return false;
    }

    function position(el) {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const coverage = Math.round((w * h * 100) / (vw * vh));
      let pos = 'inline';
      if (isOverlay(el)) {
        if (coverage >= 85) pos = 'full_screen';
        else if (r.bottom >= vh - 4 && r.height < vh * 0.45) pos = 'bottom_bar';
        else if (r.top <= 4 && r.height < vh * 0.3) pos = 'top_bar';
        else if (Math.abs((r.left + r.right) / 2 - vw / 2) < vw * 0.15 && Math.abs((r.top + r.bottom) / 2 - vh / 2) < vh * 0.2) pos = 'centre_modal';
        else pos = 'corner';
      }
      return { pos, coverage };
    }

    // Class names, ids and form action hosts only: enough to recognise a newsletter tool.
    function markers(el) {
      const parts = [el.id, String(el.className || '')];
      for (const d of Array.from(el.querySelectorAll('[class], [id], form')).slice(0, 40)) {
        let host = '';
        if (d.tagName === 'FORM' && d.getAttribute('action')) { try { host = new URL(d.getAttribute('action'), location.href).hostname; } catch (_) { host = ''; } }
        parts.push(d.id, String(d.className || ''), host);
      }
      return parts.join(' ');
    }

    function signals(el) {
      const inputs = Array.from(el.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')).slice(0, 30);
      const attr = (i, a) => (i.getAttribute(a) || '').toLowerCase();
      const isEmail = (i) => attr(i, 'type') === 'email' || /e-?mail/.test(`${attr(i, 'name')} ${attr(i, 'id')} ${attr(i, 'placeholder')} ${attr(i, 'autocomplete')}`);
      const isPayment = (i) => /^cc-/.test(attr(i, 'autocomplete')) || /card|cvc|cvv|iban|expiry|security code/.test(`${attr(i, 'name')} ${attr(i, 'id')} ${attr(i, 'placeholder')}`);
      const text = (el.innerText || '').slice(0, 800);
      const vendorMatch = VENDOR_RE.exec(markers(el));
      const heading = el.querySelector('h1, h2, h3, h4, [class*="title" i], [class*="heading" i]');
      const { pos, coverage } = position(el);
      const locked = [document.documentElement, document.body].some((n) => n && /hidden|clip/.test(getComputedStyle(n).overflowY));
      const tokens = Array.from(el.classList).filter(stableToken).map((t) => t.toLowerCase()).sort().slice(0, 3);
      const vendor = vendorMatch ? vendorMatch[0].toLowerCase() : '';
      const sig = [vendor && `v:${vendor}`, tokens.length && `c:${tokens.join('.')}`, el.id && stableToken(el.id) && `i:${el.id.toLowerCase()}`, `n:${inputs.length}`]
        .filter(Boolean).join('|').replace(/[^a-z0-9:|._-]/g, '').slice(0, 120);
      const seenAt = firstSeen.get(el) || Date.now();
      return {
        id: `c${++candidateCounter}`,
        signature: sig || 'n:0',
        pageKind: pageKind(),
        articleOnPage: articleOnPage(),
        position: pos,
        coverage,
        hasEmailInput: inputs.some(isEmail),
        inputCount: inputs.length,
        hasPassword: inputs.some((i) => attr(i, 'type') === 'password'),
        hasPaymentField: inputs.some(isPayment),
        // Only whether something was typed, never what.
        hasTypedValue: inputs.some((i) => typeof i.value === 'string' && i.value.length > 0 && !i.readOnly && !['checkbox', 'radio'].includes(attr(i, 'type'))),
        focusInside: !!(document.activeElement && el.contains(document.activeElement) && document.activeElement !== el),
        openedByUser: seenAt - Activity.at < USER_OPENED_WINDOW,
        appearedAfterMs: Math.max(0, Math.round(seenAt - performance.timeOrigin)),
        scrollLocked: locked,
        hasCloseControl: !!el.querySelector('[aria-label*="close" i], [class*="close" i], button[title*="close" i]') || /(^|\s)[×✕](\s|$)/.test(text),
        vendor,
        wording: WORDS.filter(([, re]) => re.test(text)).map(([w]) => w),
        heading: heading ? (heading.innerText || '').slice(0, 80) : ''
      };
    }

    function candidates() {
      const body = document.body;
      if (!body) return [];
      const out = new Set(Array.from(body.children).slice(0, 60));
      for (const el of qsAll(document, 'dialog[open], [role="dialog"], [aria-modal="true"]').slice(0, 20)) out.add(el);
      return [...out].filter((el) => {
        if (seen.has(el) || el.hasAttribute('data-rockyweb-hidden')) return false;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName.startsWith('ROCKYWEB-')) return false;
        if (!firstSeen.has(el)) firstSeen.set(el, Date.now());
        return !!el.querySelector('input') && isVisible(el) && isOverlay(el);
      });
    }

    async function evaluate(el) {
      seen.add(el);
      const sig = signals(el);
      if (RW.localVerdict(sig).outcome !== 'ask' || requests >= MAX_REQUESTS) return;
      requests++;
      const gen = generation;
      const askedAt = Date.now();
      const where = location.origin + location.pathname;
      const resp = await send(A.AI_EVALUATE_CANDIDATE, { signals: sig });
      if (!resp || !resp.ok || resp.outcome !== 'hide_overlay') return;
      // Recheck everything: same page, same settings, still showing, and untouched by the user meanwhile.
      if (gen !== generation || !config || resp.epoch !== config.epoch) return;
      if (location.origin + location.pathname !== where) return;
      if (!el.isConnected || !isVisible(el) || Activity.at > askedAt) return;
      const recheck = signals(el);
      recheck.id = sig.id;
      if (RW.localVerdict(recheck).outcome !== 'ask' || recheck.signature !== sig.signature) return;
      apply(el, sig, resp.source);
    }

    function apply(el, sig, source) {
      const id = `a${Math.random().toString(36).slice(2, 10)}`;
      applied.set(id, { el, prev: el.style.getPropertyValue('display'), prevPriority: el.style.getPropertyPriority('display') });
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-rockyweb-hidden', 'optimised');
      if (sig.scrollLocked) Scroll.healSoon([]);
      sendReport(A.AI_ADJUSTMENT_APPLIED, { id, signature: sig.signature, source });
    }

    function revert(id) {
      const entry = applied.get(id);
      if (!entry) return false;
      if (entry.prev) entry.el.style.setProperty('display', entry.prev, entry.prevPriority);
      else entry.el.style.removeProperty('display');
      entry.el.removeAttribute('data-rockyweb-hidden');
      applied.delete(id);
      return true;
    }

    async function scan() {
      scanTimer = 0;
      if (running || scans >= MAX_SCANS || document.visibilityState !== 'visible') return;
      running = true;
      scans++;
      try {
        for (const el of candidates().slice(0, 4)) await evaluate(el);
      } catch (_) {
        /* never break the page */
      } finally {
        running = false;
      }
    }

    // Growing gaps: the first overlay is seen quickly, and a page that keeps changing still has
    // scans left about 10 s in. MAX_SCANS still caps the total.
    const SCAN_DELAYS = [800, 300, 600, 1200, 2400, 4800];

    function schedule() {
      if (scanTimer || scans >= MAX_SCANS || !observer) return;
      scanTimer = setTimeout(scan, SCAN_DELAYS[Math.min(scans, SCAN_DELAYS.length - 1)]);
    }

    function onVisible() { if (document.visibilityState === 'visible') schedule(); }

    function start() {
      if (!IS_TOP || observer) return;
      const begin = () => {
        if (!document.body || observer) return;
        // Only direct children of <body>: popups are appended there, deeper changes are ignored.
        // Note when each element arrived, so "opened by you" never depends on when the scan runs.
        observer = new MutationObserver((records) => {
          const at = Date.now();
          for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && !firstSeen.has(n)) firstSeen.set(n, at);
          schedule();
        });
        observer.observe(document.body, { childList: true });
        document.addEventListener('visibilitychange', onVisible);
        schedule();
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
      else begin();
    }

    // Pending answers are discarded; adjustments already made stay until undone.
    function stop() {
      generation++;
      if (observer) { observer.disconnect(); observer = null; }
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(scanTimer);
      scanTimer = 0;
    }

    function invalidate() { generation++; }

    return { start, stop, revert, invalidate };
  })();

  // ---------------------------------------------------------------- element picker

  const Picker = (() => {
    const STYLE = `
      :host { all: initial; --fs-xs: 11px; --fs-m: 13px; } /* same steps as ui/tokens.css */
      .box { position: fixed; z-index: 2147483646; pointer-events: none; display: none; border-radius: 4px;
        border: 2px solid #E0975A; background: rgba(224,151,90,.16); transition: all .05s ease-out; }
      .tag { position: fixed; z-index: 2147483647; pointer-events: none; display: none; max-width: 60vw;
        padding: 3px 7px; border-radius: 6px; background: #E0975A; color: #1F1914;
        font: 500 var(--fs-xs)/1.3 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bar { position: fixed; z-index: 2147483647; left: 50%; bottom: 18px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 6px; padding: 7px 7px 7px 14px; border-radius: 12px;
        background: rgba(31,25,20,.97); border: 1px solid rgba(196,173,150,.18); color: #F3E9DC;
        box-shadow: 0 16px 40px rgba(0,0,0,.45); font: 400 var(--fs-m)/1.3 ${FONT}; pointer-events: auto; white-space: nowrap; }
      .hint { color: rgba(196,173,150,.9); }
      .hint b { color: #F3E9DC; font-weight: 500; }
      .count { color: #E0975A; padding: 0 4px; }
      .msg { color: #F1CC80; padding: 0 4px; }
      button { all: unset; cursor: pointer; padding: 6px 11px; border-radius: 8px; background: #17120E; color: #F3E9DC; }
      button:hover { background: #F3E9DC; color: #1F1914; }
      button:focus-visible { outline: 2px solid #E0975A; outline-offset: 1px; }
      button.primary { background: #E0975A; color: #1F1914; }
      button.primary:hover { background: #F3E9DC; }
      button[disabled] { opacity: .35; pointer-events: none; }
    `;
    const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu', 'touchstart', 'touchend'];
    const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-component', 'data-ad', 'data-ad-slot', 'aria-label', 'role', 'name', 'itemprop'];

    let active = false;
    let host = null;
    let ui = null;
    let current = null;
    let trail = []; // children left behind when widening with ArrowUp
    let lastPoint = null;
    const history = []; // { el, sel, prev, prevPriority, saved, pending }
    let siteKey = '';

    // ---- selector building

    const esc = (s) => window.CSS.escape(s);

    // Ids and classes that look generated (hashes, counters) or reflect state make brittle selectors.
    function stable(token) {
      return typeof token === 'string' && token.length >= 2 && token.length <= 40 &&
        /^[A-Za-z][\w-]*$/.test(token) && !/\d{3,}/.test(token) &&
        !/^(css|sc|jsx|svelte|emotion|styled|chakra|mui|ember)-/i.test(token) &&
        !/[a-z][A-Z].*\d|\d.*[A-Z][a-z]|^[a-z]{1,3}[A-Z][A-Za-z]{2,}$/.test(token) &&
        !/^(active|open|opened|show|shown|hidden|hover|focus|focused|selected|visible|current|is-|has-)/i.test(token);
    }

    function attrPart(el) {
      for (const a of TEST_ATTRS) {
        const v = el.getAttribute(a);
        if (v && v.length <= 60 && !/["\\\n]/.test(v)) return `[${a}="${v}"]`;
      }
      return '';
    }

    function matchesOnly(sel, el) {
      const list = qsAll(document, sel);
      return list.length === 1 && list[0] === el;
    }

    function sameTagIndex(el) {
      return Array.from(el.parentElement.children).filter((c) => c.localName === el.localName).indexOf(el) + 1;
    }

    // One path segment for `el`, disambiguated among its siblings when needed.
    function segment(el) {
      if (el.id && stable(el.id)) return { sel: `#${esc(el.id)}`, anchor: true, id: true };
      const classes = Array.from(el.classList).filter(stable).slice(0, 2);
      let sel = el.localName + classes.map((c) => `.${esc(c)}`).join('');
      let anchor = classes.length > 0;
      if (!anchor) {
        const attr = attrPart(el);
        if (attr) { sel += attr; anchor = true; }
      }
      const parent = el.parentElement;
      if (parent) {
        const twins = Array.from(parent.children).filter((c) => { try { return c.matches(sel); } catch (_) { return false; } });
        if (twins.length > 1) sel += `:nth-of-type(${sameTagIndex(el)})`;
      }
      return { sel, anchor, id: false };
    }

    function fullPath(el) {
      const parts = [];
      for (let cur = el; cur && cur !== document.body && cur.parentElement; cur = cur.parentElement) {
        parts.unshift(`${cur.localName}:nth-of-type(${sameTagIndex(cur)})`);
      }
      return ['body', ...parts].join(' > ');
    }

    // Shortest selector that matches exactly this element and is anchored by an id, class or attribute.
    function selectorFor(el) {
      if (el.id && stable(el.id) && matchesOnly(`#${esc(el.id)}`, el)) return `#${esc(el.id)}`;
      const tag = el.localName;
      const classes = Array.from(el.classList).filter(stable).slice(0, 4);
      const singles = classes.map((c) => `${tag}.${esc(c)}`);
      if (classes.length > 1) singles.push(tag + classes.slice(0, 3).map((c) => `.${esc(c)}`).join(''));
      const attr = attrPart(el);
      if (attr) singles.push(tag + attr);
      for (const s of singles) if (matchesOnly(s, el)) return s;

      const parts = [];
      let anchored = false;
      for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
        if (cur === document.body || cur === document.documentElement) { parts.unshift('body'); break; }
        const seg = segment(cur);
        parts.unshift(seg.sel);
        anchored = anchored || seg.anchor;
        if (seg.id) break;
        if (anchored && parts.length <= 6 && matchesOnly(parts.join(' > '), el)) return parts.join(' > ');
      }
      const path = parts.join(' > ');
      return matchesOnly(path, el) ? path : fullPath(el);
    }

    function describe(el) {
      const r = el.getBoundingClientRect();
      const cls = Array.from(el.classList).filter(stable).slice(0, 2).map((c) => `.${c}`).join('');
      const id = el.id && stable(el.id) ? `#${el.id}` : '';
      return `${el.localName}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    }

    // ---- UI

    function build() {
      host = document.createElement('rockyweb-picker');
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      const box = document.createElement('div');
      box.className = 'box';
      const tag = document.createElement('div');
      tag.className = 'tag';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Rockyweb element picker');
      const hint = document.createElement('span');
      hint.className = 'hint';
      const count = document.createElement('span');
      count.className = 'count';
      const msg = document.createElement('span');
      msg.className = 'msg';
      const mk = (label, fn, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
        return b;
      };
      const undoBtn = mk('undo', undo);
      const doneBtn = mk('done', stop, 'primary');
      bar.append(hint, count, msg, undoBtn, doneBtn);
      shadow.append(style, box, tag, bar);
      document.documentElement.appendChild(host);
      ui = { box, tag, bar, hint, count, msg, undoBtn };
      const b1 = document.createElement('b');
      b1.textContent = 'click';
      const b2 = document.createElement('b');
      b2.textContent = '↑ ↓';
      const b3 = document.createElement('b');
      b3.textContent = 'esc';
      hint.append(b1, ' to hide · ', b2, ' bigger / smaller · ', b3, ' when done');
    }

    function renderBar() {
      const n = history.length;
      ui.count.textContent = n ? `${n} hidden` : '';
      ui.undoBtn.disabled = n === 0;
    }

    function flash(text) {
      ui.msg.textContent = text;
      clearTimeout(flash.t);
      flash.t = setTimeout(() => { if (ui) ui.msg.textContent = ''; }, 3500);
    }

    function highlight(el) {
      if (!el || !el.isConnected) {
        ui.box.style.display = 'none';
        ui.tag.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(ui.box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      ui.tag.textContent = describe(el);
      ui.tag.style.display = 'block';
      const above = r.top - 24;
      ui.tag.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 260))}px`;
      ui.tag.style.top = `${above > 4 ? above : Math.min(r.bottom + 4, window.innerHeight - 28)}px`;
    }

    // ---- behaviour

    function targetAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || el === host || el === document.documentElement || el === document.body) return null;
      return el;
    }

    const fromUs = (e) => e.composedPath().includes(host);

    function swallow(e) {
      if (fromUs(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    function onMove(e) {
      if (fromUs(e)) return;
      lastPoint = { x: e.clientX, y: e.clientY };
      const el = targetAt(e.clientX, e.clientY);
      if (trail.length && current && el && current.contains(el)) return; // keep a widened selection
      if (el !== current) {
        current = el;
        trail = [];
        highlight(current);
      }
    }

    async function hideCurrent() {
      const el = current;
      if (!el || !el.isConnected) return;
      let sel;
      try { sel = selectorFor(el); } catch (_) { sel = fullPath(el); }
      const entry = {
        el, sel, saved: false,
        prev: el.style.getPropertyValue('display'),
        prevPriority: el.style.getPropertyPriority('display')
      };
      el.style.setProperty('display', 'none', 'important');
      history.push(entry);
      current = null;
      trail = [];
      highlight(null);
      renderBar();
      entry.pending = send(A.PICKER_ADD_SELECTOR, { selector: sel }).then((resp) => {
        if (resp && resp.ok) {
          entry.saved = true;
          siteKey = resp.siteKey || siteKey;
        } else if (ui) {
          flash('hidden until reload (could not save)');
        }
      });
      if (lastPoint) onMove({ clientX: lastPoint.x, clientY: lastPoint.y, composedPath: () => [] });
      await entry.pending;
    }

    async function undo() {
      const entry = history.pop();
      if (!entry) return;
      if (entry.prev) entry.el.style.setProperty('display', entry.prev, entry.prevPriority);
      else entry.el.style.removeProperty('display');
      renderBar();
      // Wait for the save to finish so the removal can't overtake it.
      await entry.pending;
      if (entry.saved) await send(A.PICKER_REMOVE_SELECTOR, { selector: entry.sel });
    }

    function onClick(e) {
      if (fromUs(e)) return;
      swallow(e);
      const el = targetAt(e.clientX, e.clientY);
      if (el && el !== current && !trail.length) current = el;
      hideCurrent();
    }

    function onKey(e) {
      if (e.key === 'Escape') { swallow(e); stop(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { swallow(e); undo(); return; }
      if (!current) return;
      if (e.key === 'ArrowUp') {
        swallow(e);
        const parent = current.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          trail.push(current);
          current = parent;
          highlight(current);
        }
      } else if (e.key === 'ArrowDown') {
        swallow(e);
        if (trail.length) {
          current = trail.pop();
          highlight(current);
        }
      } else if (e.key === 'Enter') {
        swallow(e);
        hideCurrent();
      }
    }

    function onScroll() { if (current) highlight(current); }

    function start() {
      if (active || !IS_TOP || !document.documentElement) return;
      active = true;
      history.length = 0;
      current = null;
      trail = [];
      build();
      renderBar();
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      for (const t of BLOCKED) window.addEventListener(t, swallow, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
    }

    function stop() {
      if (!active) return;
      active = false;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      for (const t of BLOCKED) window.removeEventListener(t, swallow, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      if (host) host.remove();
      host = null;
      ui = null;
      const saved = history.filter((h) => h.saved).length;
      if (history.length) {
        Toast.show(`${history.length} element${history.length === 1 ? '' : 's'} hidden`,
          saved ? `saved for ${siteKey || location.hostname}` : 'until you reload');
      }
    }

    return { start, selectorFor };
  })();

  // ---------------------------------------------------------------- page edits and proactive fixes
  // The model never sees or writes selectors. Rockyweb builds an outline of notable elements with
  // short ids, the model answers with ids, and this module turns ids into selectors after checking
  // the target is not the page itself, the main content, or something holding a form in use.

  const PageEdits = (() => {
    const OUTLINE_TTL = 5 * 60e3;
    const MAX_WALK = 4000;
    let outline = new Map(); // id -> element
    let outlineAt = 0;
    let saved = []; // enabled edits for this site: { id, ops }
    const skipped = new Map(); // edit id -> reason it was not applied on this page
    let previewStyle = null;
    let mediaOps = [];
    let lastGesture = 0;
    let fixScans = 0;
    let fixTimer = 0;
    const reported = new Set();

    addEventListener('pointerdown', (e) => { if (e.isTrusted) lastGesture = Date.now(); }, true);
    addEventListener('keydown', (e) => { if (e.isTrusted) lastGesture = Date.now(); }, true);

    const vw = () => window.innerWidth || 1;
    const vh = () => window.innerHeight || 1;
    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

    // The element's own size as a share of the screen, wherever it is on the page.
    function sizePct(el) {
      const r = el.getBoundingClientRect();
      return Math.min(100, Math.round((r.width * r.height * 100) / (vw() * vh())));
    }

    // Words from an element's id and classes that say what it is. Only these words ever reach the
    // model, so a page cannot write instructions into its class names.
    const HINTS = ['comments', 'comment', 'newsletter', 'signup', 'subscribe', 'related', 'recommended', 'share', 'social',
      'promo', 'advert', 'ads', 'ad', 'sponsored', 'sidebar', 'rail', 'author', 'bio', 'tags', 'toc', 'popular', 'trending',
      'mostread', 'banner', 'chat', 'video', 'player', 'gallery', 'hero', 'menu', 'breadcrumb', 'pagination'];
    function hintOf(el) {
      const words = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase().split(/[^a-z]+/);
      const joined = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase().replace(/[^a-z]+/g, '');
      const hit = HINTS.find((w) => words.includes(w)) || (joined.includes('mostread') ? 'mostread' : '');
      return hit === 'mostread' ? 'most read' : hit === 'ad' || hit === 'ads' ? 'advert' : hit;
    }

    function areaPct(el) {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw()) - Math.max(r.left, 0));
      const hgt = Math.max(0, Math.min(r.bottom, vh()) - Math.max(r.top, 0));
      return Math.round((w * hgt * 100) / (vw() * vh()));
    }

    // The block holding most of the page's reading text.
    function mainContent() {
      const named = qsAll(document, 'main, [role="main"], article, #content, #main, .article-body, .post-content');
      const pool = named.length ? named : Array.from(document.body ? document.body.children : []);
      let best = null;
      let bestLen = 0;
      for (const el of pool) {
        if (!isVisible(el)) continue;
        const len = qsAll(el, 'p').reduce((n, p) => n + (p.textContent || '').length, 0) || textOf(el).length / 4;
        if (len > bestLen) { best = el; bestLen = len; }
      }
      return best;
    }

    function holdsInput(el) {
      if (el.querySelector('input[type="password"], input[autocomplete^="cc-"], [autocomplete="current-password"]')) return true;
      const a = document.activeElement;
      return !!(a && a !== document.body && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    }

    const isRootish = (el) => !el || el === document.documentElement || el === document.body || el === document.head;

    // Hiding or unsticking this would take the page or its reading text with it.
    function coversMain(el, main) {
      if (isRootish(el)) return true;
      if (main && (el === main || el.contains(main))) return true;
      const bodyLen = document.body ? (document.body.textContent || '').length : 0;
      return bodyLen > 2000 && (el.textContent || '').length > bodyLen * 0.5;
    }

    function positionOf(el) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const fixed = cs.position === 'fixed' || cs.position === 'sticky';
      const wide = r.width > vw() * 0.7;
      let where = 'inline';
      if (fixed) {
        if (r.top <= 4 && wide) where = 'top bar';
        else if (r.bottom >= vh() - 4 && wide) where = 'bottom bar';
        else if (r.width < vw() * 0.5 && r.height < vh() * 0.5) where = 'corner box';
        else where = 'box over the page';
      }
      return { fixed, sticky: cs.position === 'sticky', where, height: r.height };
    }

    function kindOf(el, pos, main) {
      const tag = el.localName;
      const role = el.getAttribute('role') || '';
      let what = 'section';
      if (el === main) what = 'main content';
      else if (tag === 'header' || role === 'banner') what = 'header';
      else if (tag === 'nav' || role === 'navigation') what = 'navigation';
      else if (tag === 'footer' || role === 'contentinfo') what = 'footer';
      else if (tag === 'aside' || role === 'complementary') what = 'sidebar';
      else if (tag === 'video' || el.querySelector('video')) what = 'video';
      else if (tag === 'iframe') what = 'embedded frame';
      else if (role === 'dialog' || tag === 'dialog' || el.getAttribute('aria-modal') === 'true') what = 'dialog';
      else if (tag === 'form') what = 'form';
      const hint = hintOf(el);
      if (what === 'section' && hint) what = `${hint} section`;
      return pos.fixed ? `${pos.sticky ? 'sticky' : 'fixed'} ${what === 'section' ? pos.where : `${what}, ${pos.where}`}` : what;
    }

    function shortText(el) {
      // Its own words when short (a bar or a box), otherwise its heading.
      const label = el.getAttribute('aria-label') || '';
      const all = textOf(el);
      const head = all.length > 120 && el.querySelector('h1, h2, h3, [role="heading"], strong');
      const t = label || (head && textOf(head)) || all;
      return RW.cleanPageText(t, 60);
    }

    // Notable elements: anything fixed or sticky, landmarks, media and the main content.
    function buildOutline() {
      const main = mainContent();
      const found = new Set();
      const add = (el) => { if (el && !isRootish(el) && !el.closest('rockyweb-picker, rockyweb-toast') && isVisible(el)) found.add(el); };
      const all = document.body ? document.body.getElementsByTagName('*') : [];
      for (let i = 0; i < all.length && i < MAX_WALK; i++) {
        const el = all[i];
        const p = getComputedStyle(el).position;
        // The outermost fixed or sticky element only.
        if ((p === 'fixed' || p === 'sticky') && !(el.parentElement && el.parentElement.closest && hasFixedAncestor(el.parentElement))) add(el);
      }
      for (const el of qsAll(document, 'header, nav, footer, aside, [role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], dialog[open], [aria-modal="true"], video, iframe')) {
        if (sizePct(el) >= 2 || el.localName === 'video') add(el);
      }
      // Blocks a reader can name: ones whose id or class says what they are, and headed sections
      // inside the main content (a newsletter box, the comments), never the main content itself.
      const mainLen = main ? (main.textContent || '').length : 0;
      const blockOk = (el) => sizePct(el) >= 1 && !(main && (el === main || el.contains(main))) && (!main || !main.contains(el) || (el.textContent || '').length < mainLen * 0.6);
      for (let i = 0, n = 0; i < all.length && i < MAX_WALK && n < 12; i++) {
        const el = all[i];
        if (!/^(div|section|aside|form|figure|ul|ol)$/.test(el.localName) || !hintOf(el) || found.has(el)) continue;
        if (el.parentElement && el.parentElement.closest && hintOf(el.parentElement) === hintOf(el)) continue;
        if (blockOk(el)) { add(el); n++; }
      }
      if (main) {
        for (const el of qsAll(main, ':scope > section, :scope > aside, :scope > form, :scope > div, :scope > * > section, :scope > * > aside, :scope > * > form').slice(0, 40)) {
          if (!found.has(el) && el.querySelector('h2, h3, h4') && blockOk(el)) add(el);
        }
      }
      add(main);
      const nodes = [...found].map((el) => ({ el, pos: positionOf(el), area: sizePct(el) }))
        .sort((a, b) => (b.pos.fixed - a.pos.fixed) || (b.area - a.area))
        .slice(0, RW.PAGE_OUTLINE_MAX);
      outline = new Map();
      outlineAt = Date.now();
      return nodes.map((n, i) => {
        const id = `e${i + 1}`;
        outline.set(id, n.el);
        const flags = [];
        if (n.el.querySelector('video') || n.el.localName === 'video') flags.push('video');
        if (n.el.querySelector('form, input')) flags.push('form');
        if (!n.pos.fixed && n.el.getBoundingClientRect().top > vh()) flags.push('further down');
        if (n.el !== main && main && main.contains(n.el)) flags.push('inside the main content');
        return {
          id, kind: kindOf(n.el, n.pos, main), area: n.area, text: shortText(n.el), flags,
          main: n.el === main, protected: holdsInput(n.el) || !!n.el.querySelector('input[type="password"]')
        };
      });
    }

    function hasFixedAncestor(el) {
      for (let cur = el, i = 0; cur && cur !== document.body && i < 12; cur = cur.parentElement, i++) {
        const p = getComputedStyle(cur).position;
        if (p === 'fixed' || p === 'sticky') return true;
      }
      return false;
    }

    // Ids from the model to selectors. Returns { ops, notes }.
    function resolve(edits) {
      const ops = [];
      const notes = [];
      if (Date.now() - outlineAt > OUTLINE_TTL) return { ops, notes: ['the page changed; ask again'] };
      const main = mainContent();
      for (const e of Array.isArray(edits) ? edits.slice(0, 8) : []) {
        if (!e || !RW.PAGE_EDIT_OPS[e.op]) continue;
        if (e.target === 'page') { ops.push({ op: e.op, selector: 'page', value: e.value }); continue; }
        const el = outline.get(String(e.target));
        if (!el || !el.isConnected) { notes.push('an element that is no longer on the page'); continue; }
        if ((e.op === 'hide' || e.op === 'unstick') && coversMain(el, main)) { notes.push('hiding the main content of the page'); continue; }
        if (e.op === 'hide' && holdsInput(el)) { notes.push('hiding a form you are using'); continue; }
        const sel = Picker.selectorFor(el);
        if (!RW.isSafeEditSelector(sel) || qsAll(document, sel).length > 3) { notes.push('an element Rockyweb cannot point to reliably'); continue; }
        ops.push({ op: e.op, selector: sel, value: e.value, what: RW.cleanPageText(e.what || shortText(el), 60) });
      }
      return { ops: ops.map(RW.sanitizePageEditOp).filter(Boolean), notes };
    }

    // ---- live preview while the popup is open

    function preview(ops) {
      clearPreview();
      const css = RW.buildPageEditCss({ id: 'preview', ops: (ops || []).map(RW.sanitizePageEditOp).filter(Boolean) });
      if (!css) return false;
      previewStyle = document.createElement('style');
      previewStyle.setAttribute('data-rockyweb', 'preview');
      previewStyle.textContent = css;
      (document.head || document.documentElement).append(previewStyle);
      return true;
    }

    function clearPreview() {
      if (previewStyle) { previewStyle.remove(); previewStyle = null; }
    }

    // ---- saved edits: checked against this page, applied by the service worker at user origin

    function guard(op, main) {
      if (op.selector === 'page') return null;
      const list = qsAll(document, op.selector);
      if (list.length > 10) return 'matched too many elements';
      if ((op.op === 'hide' || op.op === 'unstick') && list.some((el) => coversMain(el, main))) return 'would have hidden the main content';
      if (op.op === 'hide' && list.some(holdsInput)) return 'holds a form you are using';
      return null;
    }

    async function start(edits) {
      saved = Array.isArray(edits) ? edits : [];
      if (!saved.length) return;
      // Applied at once so nothing flashes, then checked once the page has content.
      await send(A.APPLY_PAGE_EDITS, { ids: saved.map((e) => e.id) });
      setupMedia();
      const check = () => recheck();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
      else check();
      addEventListener('load', () => setTimeout(check, 2500), { once: true });
    }

    function recheck() {
      if (!document.body) return;
      const main = mainContent();
      const off = [];
      for (const e of saved) {
        if (skipped.has(e.id)) continue;
        for (const op of e.ops) {
          const why = guard(op, main);
          if (why) { skipped.set(e.id, why); off.push(e.id); break; }
        }
      }
      if (off.length) send(A.APPLY_PAGE_EDITS, { ids: off, remove: true, reasons: off.map((id) => skipped.get(id)) });
    }

    function setupMedia() {
      mediaOps = saved.filter((e) => !skipped.has(e.id)).flatMap((e) => e.ops.filter((o) => o.op === 'pause_media'));
      if (!mediaOps.length) return;
      const covered = (m) => mediaOps.some((o) => o.selector === 'page' || qsAll(document, o.selector).some((el) => el === m || el.contains(m)));
      const stop = (m) => { if (Date.now() - lastGesture > 1500 && covered(m)) { m.autoplay = false; m.removeAttribute('autoplay'); m.pause(); } };
      document.addEventListener('play', (e) => { if (e.target instanceof HTMLMediaElement) stop(e.target); }, true);
      const sweep = () => { for (const m of qsAll(document, 'video, audio')) if (!m.paused) stop(m); };
      sweep();
      addEventListener('load', sweep, { once: true });
    }

    async function changed() {
      const resp = await send(A.GET_EFFECTIVE_CONFIG);
      saved = (resp && resp.edits) || [];
      skipped.clear();
      recheck();
      setupMedia();
    }

    // ---- proactive fixes: rules find candidates; the service worker decides what happens

    const APP_RE = /\b(get|open|download|install|use|try) (it in |in )?(the |our )?app\b|\bopen in (the )?app\b|\bapp store\b|\bgoogle play\b/i;
    const PROMO_RE = /\b(\d+% off|sale|offer|deal|discount|free (delivery|shipping)|subscribe|sign up|download|limited time|black friday)\b/i;
    const VIDEO_HOST = /youtube|vimeo|dailymotion|jwplayer|brightcove|jwpcdn|vidazoo|connatix|primis|anyclip|ex\.co|teads|aniview/i;

    function fixCandidates() {
      const out = [];
      const main = mainContent();
      const seenEls = new Set();
      const push = (kind, el, extra) => {
        if (el && seenEls.has(el)) return;
        if (el && (coversMain(el, main) || holdsInput(el))) return;
        const text = el ? shortText(el) : '';
        if (!RW.pageFixAllowed(kind, el ? textOf(el).slice(0, 400) : '')) return;
        const sel = el ? Picker.selectorFor(el) : 'page';
        if (el && (!RW.isSafeEditSelector(sel) || qsAll(document, sel).length > 3)) return;
        if (el) seenEls.add(el);
        out.push(Object.assign({ kind, selector: sel, text, area: el ? areaPct(el) : 0, position: el ? positionOf(el).where : 'page' }, extra || {}));
      };
      // One walk over the page finds candidates and anything large enough to explain locked scrolling.
      const de = document.documentElement;
      const locked = [de, document.body].some((x) => x && getComputedStyle(x).overflowY === 'hidden');
      let covering = false;
      const all = document.body ? document.body.getElementsByTagName('*') : [];
      for (let i = 0; i < all.length && i < MAX_WALK && out.length < 6; i++) {
        const el = all[i];
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        if (!isVisible(el) || hasFixedAncestor(el.parentElement)) continue;
        const pos = positionOf(el);
        const area = areaPct(el);
        if (area > 25) covering = true;
        const text = textOf(el).slice(0, 400);
        const media = el.querySelector('video') || Array.from(el.querySelectorAll('iframe')).find((f) => VIDEO_HOST.test(f.src || ''));
        if (media && pos.where === 'corner box' && area <= 30) push('floating_video', el);
        else if (APP_RE.test(text) && area <= 35 && !el.querySelector('input[type="email"]')) push('app_banner', el);
        else if (pos.where === 'top bar' && pos.height > vh() * 0.18 && !el.querySelector('input[type="email"]')) push('tall_sticky_header', el);
        else if ((pos.where === 'bottom bar' || pos.where === 'top bar') && area <= 25 && PROMO_RE.test(text) && !el.querySelector('input')) push('promo_bar', el);
      }
      // Locked scrolling with nothing on screen that explains it.
      if (locked && !covering && de.scrollHeight > vh() * 1.5 && !Consent.working()) push('scroll_lock', null);
      return out.filter((c) => !reported.has(`${c.kind}|${c.selector}`));
    }

    async function scanFixes() {
      fixTimer = 0;
      if (!config || config.pageFixes === 'off' || fixScans >= 2 || document.hidden) return;
      fixScans++;
      const cands = fixCandidates();
      if (!cands.length) return;
      for (const c of cands) reported.add(`${c.kind}|${c.selector}`);
      await send(A.PAGE_FIX_CANDIDATES, { candidates: cands });
    }

    function startFixes() {
      if (!IS_TOP || !config || config.pageFixes === 'off') return;
      // After load, when the browser is idle: the scan reads computed styles, so it never competes with the page.
      const later = (ms) => { if (!fixTimer) fixTimer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(scanFixes, { timeout: 2000 }) : scanFixes()), ms); };
      if (document.readyState === 'complete') later(2000);
      else addEventListener('load', () => later(2000), { once: true });
      // Floating players usually appear once you scroll past them.
      let scrolled = 0;
      addEventListener('scroll', () => { if (++scrolled === 20) later(800); }, { passive: true });
    }

    return { buildOutline, resolve, preview, clearPreview, start, changed, startFixes, skippedReasons: () => Object.fromEntries(skipped) };
  })();

  // ---------------------------------------------------------------- messaging + boot

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only this extension's popup or service worker, never another tab.
    if (!msg || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (msg.action === A.MODE_CHANGED) {
      refreshConfig();
      sendResponse({ ok: true });
      return false;
    }
    if (!IS_TOP) return false;
    if (msg.action === A.AI_REVERT) {
      sendResponse({ ok: Optimiser.revert(String((msg.payload || {}).id || '')) });
    } else if (msg.action === A.START_ELEMENT_PICKER) {
      Picker.start();
      sendResponse({ ok: true });
    } else if (msg.action === A.CONSENT_FOLLOWUP) {
      Consent.followup(msg.payload || {});
      sendResponse({ ok: true });
    } else if (msg.action === A.GET_PAGE_OUTLINE) {
      sendResponse({ ok: true, outline: PageEdits.buildOutline() });
    } else if (msg.action === A.RESOLVE_PAGE_EDITS) {
      sendResponse(Object.assign({ ok: true }, PageEdits.resolve((msg.payload || {}).edits)));
    } else if (msg.action === A.PAGE_EDITS_CHANGED) {
      PageEdits.changed();
      sendResponse({ ok: true });
    }
    return false;
  });

  // The popup's live preview lives as long as its connection: closing the popup removes it.
  chrome.runtime.onConnect.addListener((port) => {
    if (!IS_TOP || port.name !== 'rockyweb-preview' || !port.sender || port.sender.id !== chrome.runtime.id || port.sender.tab) return;
    port.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.action === A.PREVIEW_PAGE_EDITS) PageEdits.preview((msg.payload || {}).ops);
      else if (msg.action === A.CLEAR_PAGE_PREVIEW) PageEdits.clearPreview();
    });
    port.onDisconnect.addListener(() => PageEdits.clearPreview());
  });

  async function boot() {
    const resp = await send(A.GET_EFFECTIVE_CONFIG);
    if (!resp || !resp.ok || !resp.config) return;
    config = resp.config;
    intent = resp.intent || null;
    if (!config.supported || config.tier === 'off') return;
    if (resp.hasCosmetics) send(A.APPLY_COSMETICS);
    if (IS_TOP && Array.isArray(resp.edits) && resp.edits.length) PageEdits.start(resp.edits);
    if (intent) Consent.start(config.consentDepth);
    if (config.newsletter !== 'off') Optimiser.start();
    PageEdits.startFixes();
  }

  // Settings changed elsewhere: stop work that no longer applies (Light, consent off, AI off, new epoch).
  async function refreshConfig() {
    const resp = await send(A.GET_EFFECTIVE_CONFIG);
    if (!resp || !resp.ok || !resp.config) return;
    const prev = config;
    config = resp.config;
    if (!prev) return;
    if (config.consentDepth !== prev.consentDepth || config.tier === 'off') Consent.halt();
    if (config.newsletter === 'off' || config.tier === 'off') Optimiser.stop();
    else if (config.epoch !== prev.epoch) Optimiser.invalidate();
  }

  boot();
})();
