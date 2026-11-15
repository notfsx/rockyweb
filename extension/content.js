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

  function svgIcon(paths, stroke) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', stroke);
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
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

  const Toast = (() => {
    let host = null;
    let timer = 0;
    const STYLE = `
      :host { all: initial; }
      .t { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 10px;
        align-items: center; max-width: 340px; padding: 10px 14px 10px 10px; border-radius: 12px;
        background: rgba(31,25,20,.97); color: #F3E9DC; border: 1px solid rgba(196,173,150,.16);
        box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 400 12.5px/1.35 ${FONT};
        pointer-events: none; animation: in .28s cubic-bezier(.2,.8,.2,1) both; }
      .t.out { animation: out .25s ease forwards; }
      .i { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: #E0975A; }
      .i svg { width: 15px; height: 15px; }
      .ti { font-weight: 500; }
      .d { color: rgba(196,173,150,.85); margin-top: 1px; }
      @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes out { to { opacity: 0; transform: translateY(6px); } }
      @media (prefers-reduced-motion: reduce) { .t, .t.out { animation: none; } }
    `;

    function show(title, detail) {
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
        const icon = document.createElement('div');
        icon.className = 'i';
        icon.appendChild(svgIcon(['M12 3l7 3v5c0 4.6-3 8.5-7 10-4-1.5-7-5.4-7-10V6l7-3z', 'M9 12l2 2 4-4'], '#1F1914'));
        const text = document.createElement('div');
        const t1 = document.createElement('div');
        t1.className = 'ti';
        t1.textContent = title;
        const t2 = document.createElement('div');
        t2.className = 'd';
        t2.textContent = detail;
        text.append(t1, t2);
        box.append(icon, text);
        shadow.append(style, box);
        document.documentElement.appendChild(host);
        timer = setTimeout(() => {
          box.classList.add('out');
          setTimeout(() => { if (host) { host.remove(); host = null; } }, 300);
        }, 3200);
      } catch (_) { /* UI must never break the page */ }
    }

    return { show };
  })();

  function describeDecision(decision, method) {
    if (method === 'hidden') return 'Notice hidden, no consent given';
    if (decision === 'accept') return 'Accepted all categories';
    if (decision === 'custom') return 'Applied your category choices';
    return 'Rejected non-essential cookies';
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
        const box = overlayAncestor(el);
        if (!box || failedContainers.has(box) || !isVisible(box)) continue;
        if (box.querySelector('input[type="password"], input[type="email"], input[type="search"], textarea')) continue;
        if (!RW.CONSENT_STRONG_TEXT_RE.test((box.innerText || '').slice(0, 8000))) continue;
        if (box.getBoundingClientRect().height < 30) continue;
        const buttons = collectButtons(box);
        if (!buttons.length) continue;
        // Must look like a consent UI: an accept/reject answer, or a plain notice.
        const answers = buttons.some((b) => matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label) || matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label));
        if (!answers && !isNoticeOnly(box)) continue;
        return { container: box };
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

    async function settingsFlow(root, container, rule, categories) {
      const settingsBtn = (rule && firstVisible(root, rule.settings)) ||
        collectButtons(container).find((b) => RW.CONSENT_SETTINGS_RE.test(b.label) && !matchesAny(RW.CONSENT_ACCEPT_PATTERNS, b.label) && !matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label));
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
        collectButtons(container).find((b) => matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label));
      if (direct) return press(direct.el || direct) ? 'reject' : null;
      if (await settingsFlow(root, container, rule, { necessary: true, functional: false, analytics: false, marketing: false })) {
        await sleep(300);
        return 'reject';
      }
      // A second-layer preference dialog may now show a reject button.
      const later = collectButtons(document.body).find((b) => {
        if (!matchesAny(RW.CONSENT_REJECT_PATTERNS, b.label)) return false;
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

    async function decide(root, container, rule) {
      if (intent.decision === 'accept') return acceptFlow(root, container, rule);
      if (intent.decision === 'custom') {
        if (await settingsFlow(root, container, rule, intent.categories)) return 'custom';
        return rejectFlow(root, container, rule); // privacy-safe fallback
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
      send(A.CONSENT_HANDLED, { cmp: info.cmp, method: info.method, decision: info.decision });
      if (IS_TOP && config && config.showToastBadge) Toast.show('Cookie popup handled', `${describeDecision(info.decision, info.method)} · ${info.cmp}`);
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

    async function handleGeneric({ container }) {
      attempts++;
      const decision = await decide(document, container, null);
      if (decision) {
        finish({ cmp: 'Generic', method: 'heuristic', decision }, () => [container], []);
        return;
      }
      if (!CONSENT_HOST && intent.decision !== 'accept' && isNoticeOnly(container)) {
        forceHide(container);
        finish({ cmp: 'Generic', method: 'hidden', decision: 'reject' }, () => [container], []);
        return;
      }
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
        if (recentlyUsed()) return;
        const generic = detectGeneric();
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
      if (info.showToast) Toast.show('Cookie popup handled', `${describeDecision(info.decision, info.method)} · ${info.cmp}`);
    }

    return { start, followup, halt };
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
      send(A.AI_ADJUSTMENT_APPLIED, { id, signature: sig.signature, source });
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
      :host { all: initial; }
      .box { position: fixed; z-index: 2147483646; pointer-events: none; display: none; border-radius: 4px;
        border: 2px solid #E0975A; background: rgba(224,151,90,.16); transition: all .05s ease-out; }
      .tag { position: fixed; z-index: 2147483647; pointer-events: none; display: none; max-width: 60vw;
        padding: 3px 7px; border-radius: 6px; background: #E0975A; color: #1F1914;
        font: 500 11px/1.3 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bar { position: fixed; z-index: 2147483647; left: 50%; bottom: 18px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 6px; padding: 7px 7px 7px 14px; border-radius: 12px;
        background: rgba(31,25,20,.97); border: 1px solid rgba(196,173,150,.18); color: #F3E9DC;
        box-shadow: 0 16px 40px rgba(0,0,0,.45); font: 400 12.5px/1.3 ${FONT}; pointer-events: auto; white-space: nowrap; }
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
          saved ? `Saved for ${siteKey || location.hostname}. Manage them in settings.` : 'Hidden until you reload.');
      }
    }

    return { start };
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
    }
    return false;
  });

  async function boot() {
    const resp = await send(A.GET_EFFECTIVE_CONFIG);
    if (!resp || !resp.ok || !resp.config) return;
    config = resp.config;
    intent = resp.intent || null;
    if (!config.supported || config.tier === 'off') return;
    if (resp.hasCosmetics) send(A.APPLY_COSMETICS);
    if (intent) Consent.start(config.consentDepth);
    if (config.newsletter !== 'off') Optimiser.start();
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
