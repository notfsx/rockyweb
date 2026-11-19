// Applies consent through a platform's own JS API. Injected into the page (MAIN world) by the service worker,
// so the function must be self-contained. Only acts when the user has not answered yet.
self.rockywebCmpMainWorld = function rockywebCmpMainWorld(intent) {
  'use strict';
  const cats = (intent && intent.categories) || { necessary: true, functional: false, analytics: false, marketing: false };
  const allOff = !cats.functional && !cats.analytics && !cats.marketing;
  const allOn = !!(cats.functional && cats.analytics && cats.marketing);
  const w = window;

  const MARKETING_RE = /market|advert|target|\bads?\b|personali[sz]ed ad|social|retarget|remarketing|werbung|publicit|publicidad|pubblicit|reclame/i;
  const ANALYTICS_RE = /analytic|statistic|performance|measure|audience|insight|statistik|mesure|análisis|analisi|prestaties/i;
  const FUNCTIONAL_RE = /functional|preference|personali[sz]ation|comfort|funktional|präferenz|fonctionn|preferenc|funzional|voorkeur/i;
  const NECESSARY_RE = /necessary|essential|strictly|required|technical|notwendig|essenziell|nécessaire|necesari|necessari|noodzakelijk/i;

  function classify(text) {
    const t = String(text || '');
    if (NECESSARY_RE.test(t)) return 'necessary';
    if (MARKETING_RE.test(t)) return 'marketing';
    if (ANALYTICS_RE.test(t)) return 'analytics';
    if (FUNCTIONAL_RE.test(t)) return 'functional';
    return 'unknown';
  }
  // The name decides; descriptions often say "necessary" in groups that are not.
  const classifyNamed = (name, description) => {
    const c = classify(name);
    return c !== 'unknown' ? c : classify(description);
  };
  const wants = (category) => category === 'necessary' || (category !== 'unknown' && !!cats[category]);
  const baseDecision = allOff ? 'reject' : allOn ? 'accept' : 'custom';
  const decisionLabel = (downgraded) => (downgraded ? 'reject' : baseDecision);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cookieHas = (re) => { try { return re.test(document.cookie); } catch (_) { return false; } };

  const handlers = [
    {
      name: 'OneTrust',
      ready: () => !!(w.OneTrust && typeof w.OneTrust.RejectAll === 'function' && typeof w.OneTrust.AllowAll === 'function'),
      needed: () => (typeof w.OneTrust.IsAlertBoxClosed === 'function' ? !w.OneTrust.IsAlertBoxClosed() : !cookieHas(/OptanonAlertBoxClosed=/)),
      apply: async () => {
        if (allOn) { w.OneTrust.AllowAll(); return decisionLabel(); }
        w.OneTrust.RejectAll();
        if (allOff || typeof w.OneTrust.UpdateConsent !== 'function') return decisionLabel(!allOff);
        let groups = [];
        try { groups = (w.OneTrust.GetDomainData() || {}).Groups || []; } catch (_) { groups = []; }
        let granted = 0;
        for (const g of groups) {
          const id = g && (g.CustomGroupId || g.OptanonGroupId);
          if (!id || id === 'C0001') continue;
          const cat = classifyNamed(g.GroupName, g.GroupDescription);
          if (cat !== 'necessary' && cat !== 'unknown' && cats[cat]) {
            try { w.OneTrust.UpdateConsent('Category', `${id}:1`); granted++; } catch (_) { /* keep rejected */ }
          }
        }
        return granted ? 'custom' : 'reject';
      }
    },
    {
      name: 'Cookiebot',
      ready: () => {
        const cb = w.Cookiebot || w.CookieConsent;
        return !!(cb && typeof cb.submitCustomConsent === 'function');
      },
      needed: () => !(w.Cookiebot || w.CookieConsent).hasResponse,
      apply: async () => {
        const cb = w.Cookiebot || w.CookieConsent;
        cb.submitCustomConsent(!!cats.functional, !!cats.analytics, !!cats.marketing);
        try { if (typeof cb.hide === 'function') cb.hide(); } catch (_) { /* banner hidden by DOM engine */ }
        return decisionLabel();
      }
    },
    {
      name: 'Didomi',
      ready: () => !!(w.Didomi && typeof w.Didomi.setUserDisagreeToAll === 'function' && typeof w.Didomi.setUserAgreeToAll === 'function'),
      needed: () => (typeof w.Didomi.shouldConsentBeCollected === 'function' ? !!w.Didomi.shouldConsentBeCollected() : true),
      apply: async () => {
        if (allOn) { w.Didomi.setUserAgreeToAll(); return 'accept'; }
        // Didomi's per-purpose API varies by SDK version, so mixed choices become reject.
        w.Didomi.setUserDisagreeToAll();
        return 'reject';
      }
    },
    {
      name: 'Usercentrics',
      ready: () => !!(w.UC_UI && typeof w.UC_UI.denyAllConsents === 'function' &&
        (typeof w.UC_UI.isInitialized !== 'function' || w.UC_UI.isInitialized())),
      needed: async () => (typeof w.UC_UI.isConsentRequired === 'function' ? !!(await w.UC_UI.isConsentRequired()) : true),
      apply: async () => {
        if (allOn) { await w.UC_UI.acceptAllConsents(); }
        else {
          await w.UC_UI.denyAllConsents();
          if (!allOff && typeof w.UC_UI.getServicesBaseInfo === 'function' && typeof w.UC_UI.acceptServices === 'function') {
            const services = (await w.UC_UI.getServicesBaseInfo()) || [];
            const ids = services.filter((s) => s && s.id && wants(classifyNamed(s.categorySlug, s.name)) && classify(s.categorySlug || '') !== 'necessary').map((s) => s.id);
            if (ids.length) await w.UC_UI.acceptServices(ids);
          }
        }
        try { if (typeof w.UC_UI.closeCMP === 'function') await w.UC_UI.closeCMP(); } catch (_) { /* ignore */ }
        return decisionLabel();
      }
    },
    {
      name: 'Usercentrics v3',
      ready: () => !!(w.__ucCmp && typeof w.__ucCmp.denyAllConsents === 'function'),
      needed: async () => (typeof w.__ucCmp.isConsentRequired === 'function' ? !!(await w.__ucCmp.isConsentRequired()) : true),
      apply: async () => {
        if (allOn && typeof w.__ucCmp.acceptAllConsents === 'function') await w.__ucCmp.acceptAllConsents();
        else await w.__ucCmp.denyAllConsents();
        if (typeof w.__ucCmp.saveConsents === 'function') await w.__ucCmp.saveConsents();
        try { if (typeof w.__ucCmp.closeCmp === 'function') await w.__ucCmp.closeCmp(); } catch (_) { /* ignore */ }
        return allOn ? 'accept' : 'reject';
      }
    },
    {
      name: 'Klaro',
      ready: () => !!(w.klaro && typeof w.klaro.getManager === 'function' && w.klaro.getManager()),
      needed: () => !w.klaro.getManager().confirmed,
      apply: async () => {
        const m = w.klaro.getManager();
        const services = (m.config && (m.config.services || m.config.apps)) || [];
        let granted = 0;
        for (const s of services) {
          if (!s || !s.name || s.required) continue;
          const cat = classifyNamed((s.purposes || []).join(' '), s.name);
          const on = cat !== 'unknown' && wants(cat);
          if (on) granted++;
          m.updateConsent(s.name, on);
        }
        m.saveAndApplyConsents();
        return granted === 0 ? 'reject' : allOn ? 'accept' : 'custom';
      }
    },
    {
      name: 'Complianz',
      ready: () => typeof w.cmplz_deny_all === 'function' || typeof w.cmplz_set_category === 'function',
      needed: () => !cookieHas(/cmplz_banner-status=dismissed/),
      apply: async () => {
        if (allOn && typeof w.cmplz_accept_all === 'function') { w.cmplz_accept_all(); return 'accept'; }
        // Without deny_all nothing would be submitted, so let the button rules answer instead.
        if (typeof w.cmplz_deny_all !== 'function') return null;
        w.cmplz_deny_all();
        if (allOff) return 'reject';
        if (typeof w.cmplz_set_category !== 'function') return 'reject';
        if (cats.functional) w.cmplz_set_category('preferences');
        if (cats.analytics) w.cmplz_set_category('statistics');
        if (cats.marketing) w.cmplz_set_category('marketing');
        return 'custom';
      }
    },
    {
      name: 'CookieFirst',
      ready: () => !!(w.CookieFirst && typeof w.CookieFirst.declineAllCategories === 'function'),
      needed: () => !w.CookieFirst.consent,
      apply: async () => {
        if (allOn && typeof w.CookieFirst.acceptAllCategories === 'function') { w.CookieFirst.acceptAllCategories(); return 'accept'; }
        if (!allOff && typeof w.CookieFirst.updateConsent === 'function') {
          w.CookieFirst.updateConsent({ necessary: true, functional: !!cats.functional, performance: !!cats.analytics, advertising: !!cats.marketing });
          return decisionLabel();
        }
        w.CookieFirst.declineAllCategories();
        return 'reject';
      }
    },
    {
      name: 'CookieScript',
      ready: () => !!(w.CookieScript && w.CookieScript.instance && typeof w.CookieScript.instance.rejectAll === 'function'),
      needed: () => {
        const st = typeof w.CookieScript.instance.currentState === 'function' ? w.CookieScript.instance.currentState() : null;
        return !(st && (st.action === 'accept' || st.action === 'reject'));
      },
      apply: async () => {
        const inst = w.CookieScript.instance;
        if (allOn && typeof inst.acceptAll === 'function') { inst.acceptAll(); return 'accept'; }
        if (!allOff && typeof inst.acceptAction === 'function') {
          const list = [];
          if (cats.functional) list.push('functionality');
          if (cats.analytics) list.push('performance');
          if (cats.marketing) list.push('targeting');
          inst.acceptAction(list);
          return decisionLabel();
        }
        inst.rejectAll();
        return 'reject';
      }
    },
    {
      name: 'Shopify',
      ready: () => !!(w.Shopify && w.Shopify.customerPrivacy && typeof w.Shopify.customerPrivacy.setTrackingConsent === 'function'),
      needed: () => (typeof w.Shopify.customerPrivacy.shouldShowBanner === 'function' ? !!w.Shopify.customerPrivacy.shouldShowBanner() : true),
      apply: () => new Promise((resolve) => {
        const done = () => resolve(decisionLabel());
        try {
          w.Shopify.customerPrivacy.setTrackingConsent({
            analytics: !!cats.analytics,
            marketing: !!cats.marketing,
            preferences: !!cats.functional,
            sale_of_data: false
          }, done);
        } catch (_) { resolve(null); return; }
        setTimeout(done, 1500);
      })
    }
  ];

  // One quick attempt. Returns a plain object when no platform is present so the page's load event is
  // never held up; the service worker calls again until its deadline.
  for (const h of handlers) {
    let ready = false;
    try { ready = !!h.ready(); } catch (_) { ready = false; }
    if (!ready) continue;
    return (async () => {
      let needed = true;
      try { needed = await h.needed(); } catch (_) { needed = true; }
      if (!needed) return { handled: false, cmp: h.name, reason: 'already_decided' };
      try {
        const decision = await Promise.race([h.apply(), sleep(4000).then(() => null)]);
        if (decision) return { handled: true, cmp: h.name, method: 'api', decision };
      } catch (_) { /* fall through */ }
      return { handled: false, cmp: h.name, reason: 'api_error' };
    })();
  }
  return { handled: false, reason: 'not_found' };
};
