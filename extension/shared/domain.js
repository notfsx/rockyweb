// Hostname helpers. baseDomain() approximates the registrable domain with a small suffix list.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const MULTI_PART_SUFFIXES = new Set([
    // Country-code second-level registries
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'sch.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp',
    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
    'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
    'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
    'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'gov.in', 'edu.in',
    'co.za', 'org.za', 'gov.za', 'ac.za', 'web.za', 'net.za',
    'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
    'com.ar', 'org.ar', 'gob.ar', 'net.ar', 'edu.ar',
    'com.co', 'org.co', 'gov.co', 'net.co', 'edu.co',
    'com.pe', 'org.pe', 'gob.pe', 'com.ve', 'com.uy', 'com.py', 'com.bo', 'com.ec', 'com.gt',
    'com.tr', 'org.tr', 'gov.tr', 'net.tr', 'edu.tr', 'gen.tr', 'bel.tr', 'av.tr',
    'com.sg', 'org.sg', 'gov.sg', 'edu.sg', 'net.sg',
    'com.my', 'org.my', 'gov.my', 'net.my', 'edu.my',
    'co.id', 'or.id', 'go.id', 'ac.id', 'web.id',
    'co.th', 'or.th', 'go.th', 'ac.th', 'in.th',
    'com.ph', 'org.ph', 'gov.ph', 'net.ph',
    'com.vn', 'org.vn', 'gov.vn', 'net.vn', 'edu.vn',
    'com.pk', 'org.pk', 'gov.pk', 'net.pk', 'edu.pk',
    'co.il', 'org.il', 'gov.il', 'ac.il', 'net.il',
    'com.ua', 'org.ua', 'gov.ua', 'net.ua', 'in.ua', 'kiev.ua',
    'com.eg', 'com.sa', 'com.ng', 'com.gh', 'co.ke', 'or.ke', 'co.tz', 'co.ug', 'co.zw', 'co.ma',
    'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'waw.pl',
    'com.ru', 'org.ru', 'net.ru', 'msk.ru', 'spb.ru',
    'com.es', 'org.es', 'nom.es', 'gob.es', 'edu.es',
    'com.pt', 'org.pt', 'gov.pt',
    'com.gr', 'org.gr', 'gov.gr',
    'co.at', 'or.at', 'gv.at', 'ac.at',
    'com.cy', 'com.mt', 'com.ro', 'com.hr', 'co.hu', 'co.rs', 'com.ba',
    'qc.ca', 'on.ca', 'bc.ca', 'ab.ca',
    // Private-registry suffixes (each subdomain is a different site)
    'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'web.app',
    'firebaseapp.com', 'appspot.com', 'herokuapp.com', 'blogspot.com', 'cloudfront.net',
    'azurewebsites.net', 'azureedge.net', 'fly.dev', 'onrender.com', 'glitch.me', 'repl.co',
    'myshopify.com', 'wixsite.com', 'neocities.org', 'surge.sh', 'ngrok.io', 'ngrok-free.app',
    'translate.goog', 'amplifyapp.com', 'deno.dev', 'streamlit.app', 'hf.space'
  ]);

  const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
  const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

  function isIPv4(host) {
    return IPV4_RE.test(host);
  }

  function isIP(host) {
    return isIPv4(host) || (typeof host === 'string' && host.includes(':'));
  }

  function normalizeHost(host) {
    if (typeof host !== 'string') return '';
    let h = host.trim().toLowerCase();
    if (h.endsWith('.')) h = h.slice(0, -1);
    if (h.startsWith('[') || h.includes(':')) return h; // IPv6 literal, leave alone
    if (h.startsWith('www.') && h.split('.').length > 2) h = h.slice(4);
    return h;
  }

  function baseDomain(host) {
    const h = normalizeHost(host);
    if (!h || isIP(h) || !h.includes('.')) return h;
    const labels = h.split('.');
    if (labels.length <= 2) return h;
    const lastTwo = labels.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
    return lastTwo;
  }

  function hostFromUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isSupportedUrl(url) {
    return hostFromUrl(url) !== '';
  }

  // siteProfiles are keyed by registrable domain.
  function siteKeyForHost(host) {
    const h = normalizeHost(host);
    if (!h) return '';
    return baseDomain(h);
  }

  function siteKeyForUrl(url) {
    return siteKeyForHost(hostFromUrl(url));
  }

  function isValidDomain(domain) {
    if (typeof domain !== 'string') return false;
    const d = domain.trim().toLowerCase();
    if (!d || d.length > 253) return false;
    if (d === 'localhost' || isIPv4(d)) return true;
    const labels = d.split('.');
    if (labels.length < 2) return false;
    if (!labels.every((l) => LABEL_RE.test(l))) return false;
    return /[a-z]/.test(labels[labels.length - 1]);
  }

  function hostInSet(host, set) {
    let h = normalizeHost(host);
    if (!h || !set || set.size === 0) return false;
    if (set.has(h)) return true;
    let idx = h.indexOf('.');
    while (idx !== -1) {
      h = h.slice(idx + 1);
      if (set.has(h)) return true;
      idx = h.indexOf('.');
    }
    return false;
  }

  function matchInSet(host, set) {
    let h = normalizeHost(host);
    if (!h || !set) return '';
    if (set.has(h)) return h;
    let idx = h.indexOf('.');
    while (idx !== -1) {
      h = h.slice(idx + 1);
      if (set.has(h)) return h;
      idx = h.indexOf('.');
    }
    return '';
  }

  function hostMatchesDomain(host, domain) {
    const h = normalizeHost(host);
    const d = normalizeHost(domain);
    return !!h && !!d && (h === d || h.endsWith('.' + d));
  }

  Object.assign(RW, {
    MULTI_PART_SUFFIXES,
    isIP,
    isIPv4,
    normalizeHost,
    baseDomain,
    hostFromUrl,
    isSupportedUrl,
    siteKeyForHost,
    siteKeyForUrl,
    isValidDomain,
    hostInSet,
    matchInSet,
    hostMatchesDomain
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
