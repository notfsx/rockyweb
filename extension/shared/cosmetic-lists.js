// Element hiding selectors: safe (balanced), aggressive (strict) and per-site.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const GENERIC_SAFE = [
    'ins.adsbygoogle',
    'div[id^="div-gpt-ad"]',
    'div[id^="google_ads_iframe"]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="amazon-adsystem.com"]',
    'a[href^="https://ad.doubleclick.net/"]',
    'amp-ad',
    'amp-embed[type="taboola"]',
    'amp-embed[type="outbrain"]',
    'div[id^="taboola-"]',
    '.trc_related_container',
    '.OUTBRAIN',
    '.ob-widget',
    '.adthrive-ad',
    '.ezoic-ad',
    'span[id^="ezoic-pub-ad-placeholder"]',
    '.mgid-wrapper',
    'div[id^="mgid_"]',
    'div[id^="rcjsload"]',
    '.revcontent-wrap',
    '.zergnet-widget',
    'div[id^="zergnet-widget"]',
    '.carbonads',
    '#carbonads',
    '.adsbox.adsbygoogle',
    'div[data-google-query-id]',
    'div[aria-label="Advertisement"][class*="ad"]'
  ];

  const AGGRESSIVE = [
    // generic ad containers
    '.ad-container', '.ad-wrapper', '.ad-banner', '.ad-slot', '.ad-unit', '.advertisement',
    '.advertisment', '.ad-placeholder', '.sponsored-content', '.sponsor-banner',
    '[id^="dfp-ad-"]', '[id^="ad-slot-"]', '[class^="ad-container"]', '[data-ad-unit]',
    '[data-ad-slot]:not(ins)', '[data-testid="ad-container"]', 'aside[aria-label="advertisement" i]',
    // social share / follow widgets
    '.addthis_toolbox', '.addthis-smartlayers', '#at4-share', '#at-share-dock', '.at-share-dock',
    '.sharethis-inline-share-buttons', '.st-sticky-share-buttons', '#st-1', '.a2a_floating_style',
    'iframe[src*="facebook.com/plugins/like"]', 'iframe[src*="facebook.com/plugins/page"]', '.fb-like',
    // newsletter / lead-capture overlays
    '.sumome-react-wysiwyg-popup-container', '.sumo-overlay', '.optinmonster-overlay',
    '.om-holder', '[id^="om-"][class*="om-holder"]', '.privy-popup-container', '#privy-container',
    '[class*="newsletter-popup"]', '[id*="newsletter-popup"]', '[class*="newsletter-modal"]',
    '[id*="newsletter-modal"]', '.klaviyo-form[role="dialog"]', '.wisepops-root',
    '.justuno-popup', '#hellobar-bar', '.poptin-popup',
    // push-notification prompts
    '#onesignal-slidedown-container', '#onesignal-bell-container', '#onesignal-popover-container',
    '.pushcrew-chrome-style-notification', '#pushengage-opt-in', '.pe-popup-container'
  ];

  const SITE_SPECIFIC = {
    'youtube.com': [
      'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer',
      'ytd-display-ad-renderer', 'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer',
      'ytd-banner-promo-renderer', '#masthead-ad', '#player-ads', 'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)'
    ],
    'reddit.com': ['shreddit-ad-post', 'shreddit-comments-page-ad', '.promotedlink', 'faceplate-tracker[noun="ad"]'],
    'twitter.com': ['div[data-testid="placementTracking"]'],
    'x.com': ['div[data-testid="placementTracking"]'],
    'linkedin.com': ['.ad-banner-container', 'section.ad-banner-container'],
    'stackoverflow.com': ['.js-zone-container', '#hireme', '.s-sidebarwidget--yellow.everyonelovesstackoverflow'],
    'stackexchange.com': ['.js-zone-container'],
    'cnn.com': ['.ad-feedback-link-container', '.ad-slot-header', '.ad-slot-dynamic'],
    'theguardian.com': ['.ad-slot-container', '.top-banner-ad-container', 'aside.ad-slot-container'],
    'forbes.com': ['.fbs-ad--top-wrapper', '.fbs-ad--progressive', '.ad-rail'],
    'nytimes.com': ['div[data-testid="StandardAd"]', '#top-wrapper[class*="ad"]', '.ad.top-wrapper'],
    'yahoo.com': ['.gemini-ad', '[data-content="Advertisement"]', '#ad-lrec', '#ad-lrec2'],
    'bing.com': ['li.b_ad', '.b_adBottom', '.b_adTop'],
    'duckduckgo.com': ['li[data-layout="ad"]', '.badge--ad-wrap']
  };

  function buildCosmeticSelectors(cfg, hostname) {
    if (!cfg || cfg.tier === 'off') return [];
    const out = [];
    if (cfg.cosmeticFiltering) {
      out.push(...GENERIC_SAFE);
      if (cfg.aggressiveFiltering) out.push(...AGGRESSIVE);
      for (const [domain, sels] of Object.entries(SITE_SPECIFIC)) {
        if (RW.hostMatchesDomain(hostname || cfg.hostname, domain)) out.push(...sels);
      }
    }
    // Elements hidden with the picker apply in every mode except off.
    for (const s of cfg.customCosmeticSelectors || []) if (RW.isValidSelector(s)) out.push(s.trim());
    return [...new Set(out)];
  }

  // One rule per selector so an unsupported selector only drops itself.
  function buildCosmeticCss(selectors) {
    return selectors.map((s) => `${s} { display: none !important; }`).join('\n');
  }

  Object.assign(RW, { COSMETIC_GENERIC_SAFE: GENERIC_SAFE, COSMETIC_AGGRESSIVE: AGGRESSIVE, COSMETIC_SITE_SPECIFIC: SITE_SPECIFIC, buildCosmeticSelectors, buildCosmeticCss });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
