// Filter data: block lists, breakage guards, entity groups and script surrogates.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  // Ad networks, exchanges and ad servers, blocked in Balanced and Strict.
  const AD_DOMAINS = [
    '2mdn.net', '33across.com', '360yield.com', 'a-ads.com', 'adcolony.com', 'adform.net',
    'adformdsp.net', 'adgrx.com', 'adhigh.net', 'adition.com', 'adkernel.com', 'adnxs-simple.com',
    'adnxs.com', 'adroll.com', 'adsafeprotected.com', 'adservice.google.com', 'adskeeper.co.uk',
    'adsrvr.org', 'adsterra.com', 'adtechus.com', 'advertising.com', 'adzerk.net', 'amazon-adsystem.com',
    'betweendigital.com', 'bidswitch.net', 'buysellads.com', 'carbonads.net', 'casalemedia.com',
    'connatix.com', 'contextweb.com', 'criteo.com', 'criteo.net', 'districtm.io', 'doubleclick.net',
    'emxdgt.com', 'exoclick.com', 'exosrv.com', 'googleadservices.com', 'googlesyndication.com',
    'googletagservices.com', 'gumgum.com', 'hilltopads.net', 'improvedigital.com', 'indexww.com',
    'juicyads.com', 'lijit.com', 'media.net', 'mgid.com', 'moatads.com', 'mookie1.com', 'onetag-sys.com',
    'openx.net', 'outbrain.com', 'popads.net', 'popcash.net', 'propellerads.com', 'pubmatic.com',
    'revcontent.com', 'richaudience.com', 'rubiconproject.com', 'seedtag.com', 'serving-sys.com',
    'sharethrough.com', 'smaato.net', 'smartadserver.com', 'sonobi.com', 'springserve.com',
    'spotx.tv', 'spotxchange.com', 'taboola.com', 'teads.tv', 'tremorhub.com', 'triplelift.com',
    'undertone.com', 'yieldlab.net', 'yieldmo.com', 'zedo.com', 'zergnet.com'
  ];

  // Known cross-site analytics / data-broker endpoints, blocked in Balanced and Strict.
  const TRACKER_DOMAINS = [
    'agkn.com', 'bidr.io', 'bluekai.com', 'bounceexchange.com', 'chartbeat.com', 'chartbeat.net',
    'crwdcntrl.net', 'cxense.com', 'demdex.net', 'dotomi.com', 'everesttech.net', 'exelator.com',
    'eyeota.net', 'google-analytics.com', 'histats.com', 'id5-sync.com', 'intentiq.com', 'krxd.net',
    'liadm.com', 'mathtag.com', 'mc.yandex.com', 'mc.yandex.ru', 'ml314.com', 'nr-data.net',
    'omtrdc.net', 'permutive.com', 'pippio.com', 'quantcount.com', 'quantserve.com', 'rlcdn.com',
    'scorecardresearch.com', 'statcounter.com', 'tapad.com', 'zeotap.com'
  ];

  const STRICT_EXTRA_DOMAINS = [
    'addthis.com', 'addtoany.com', 'ads-twitter.com', 'ads.linkedin.com', 'amplitude.com',
    'analytics.tiktok.com', 'analytics.twitter.com', 'bat.bing.com', 'cdn.segment.com', 'clarity.ms',
    'connect.facebook.net', 'crazyegg.com', 'ct.pinterest.com', 'fullstory.com', 'getsitecontrol.com',
    'googletagmanager.com', 'heapanalytics.com', 'hellobar.com', 'hotjar.com', 'hotjar.io',
    'inspectlet.com', 'justuno.com', 'luckyorange.com', 'luckyorange.net', 'mixpanel.com',
    'mouseflow.com', 'mxpnl.com', 'onesignal.com', 'opmnstr.com', 'optinmonster.com', 'poptin.com',
    'privy.com', 'pushcrew.com', 'pushengage.com', 'q.quora.com', 'sc-static.net', 'segment.io',
    'sharethis.com', 'smartlook.com', 'snap.licdn.com', 'static.ads-twitter.com', 'subscribers.com',
    'sumo.com', 'sumome.com', 'tr.snapchat.com', 'wisepops.com'
  ];

  const URL_TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
    'utm_cid', 'utm_reader', 'utm_referrer', 'utm_social', 'utm_social-type', 'utm_brand',
    'utm_place', 'utm_pubreferrer', 'utm_swu', 'utm_viz_id', 'utm_campaignid', 'utm_source_platform',
    'utm_creative_format', 'utm_marketing_tactic',
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
    'igshid', 'li_fat_id', 'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc',
    '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', 'wickedid',
    'rb_clickid', 's_cid', '_openstat', 'epik', 'irclickid', 'srsltid'
  ];

  const NEVER_RESTRICT = [
    '3dsecure.io', 'adyen.com', 'affirm.com', 'afterpay.com', 'apple.com', 'arkoselabs.com',
    'auth0.com', 'braintree-api.com', 'braintreegateway.com', 'cardinalcommerce.com', 'cdn-apple.com',
    'checkout.com', 'cloudflare.com', 'duosecurity.com', 'funcaptcha.com', 'google.com',
    'hcaptcha.com', 'id.me', 'klarna.com', 'klarnaservices.com', 'live.com', 'login.gov',
    'microsoft.com', 'microsoftonline.com', 'okta.com', 'oktacdn.com', 'onelogin.com', 'paypal.com',
    'paypalobjects.com', 'recaptcha.net', 'shop.app', 'shopify.com', 'squareup.com', 'stripe.com',
    'stripe.network', 'stripecdn.com', 'adyencheckout.com', 'paddle.com', 'chargebee.com'
  ];

  const COOKIE_BLOCK_CAP = [
    'akamaihd.net', 'akamaized.net', 'amazonaws.com', 'azureedge.net', 'bootstrapcdn.com',
    'brightcove.net', 'cloudinary.com', 'disqus.com', 'disquscdn.com', 'fastly.net', 'fbcdn.net',
    'fontawesome.com', 'githubusercontent.com', 'googleapis.com', 'googleusercontent.com', 'gravatar.com',
    'gstatic.com', 'imgix.net', 'intercom.io', 'intercomcdn.com', 'jquery.com', 'jsdelivr.net',
    'jwpcdn.com', 'jwplayer.com', 'jwplatform.com', 'mapbox.com', 'sentry-cdn.com', 'sentry.io',
    'squarespace-cdn.com', 'twimg.com', 'typekit.net', 'unpkg.com', 'vimeo.com', 'vimeocdn.com',
    'wistia.com', 'wistia.net', 'wixstatic.com', 'wp.com', 'youtube-nocookie.com', 'youtube.com',
    'ytimg.com', 'zendesk.com', 'zdassets.com', 'hubspot.com', 'hsforms.net', 'tiktokcdn.com',
    'spotify.com', 'scdn.co', 'soundcloud.com', 'sndcdn.com', 'twitch.tv', 'ttvnw.net'
  ];

  // Domains that belong to the same organisation are treated as first party to each other.
  const ENTITY_GROUPS = [
    ['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'youtube.com', 'ytimg.com',
      'googlevideo.com', 'ggpht.com', 'youtube-nocookie.com', 'google.co.uk', 'google.de', 'google.fr',
      'blogger.com', 'blogspot.com', 'withgoogle.com'],
    ['facebook.com', 'fbcdn.net', 'facebook.net', 'instagram.com', 'cdninstagram.com', 'whatsapp.com',
      'whatsapp.net', 'messenger.com', 'threads.net', 'meta.com'],
    ['twitter.com', 'x.com', 'twimg.com', 't.co'],
    ['microsoft.com', 'live.com', 'bing.com', 'msn.com', 'office.com', 'microsoftonline.com', 'azure.com',
      'sharepoint.com', 'skype.com', 'outlook.com', 'windows.net', 'office.net', 'msauth.net', 'linkedin.com',
      'licdn.com', 'xbox.com', 'github.com', 'githubusercontent.com', 'githubassets.com'],
    ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca',
      'amazon.co.jp', 'amazon.in', 'media-amazon.com', 'ssl-images-amazon.com', 'amazonaws.com',
      'primevideo.com', 'audible.com', 'twitch.tv', 'ttvnw.net', 'jtvnw.net'],
    ['apple.com', 'icloud.com', 'cdn-apple.com', 'mzstatic.com', 'apple-cloudkit.com'],
    ['reddit.com', 'redditstatic.com', 'redditmedia.com', 'redd.it'],
    ['wikipedia.org', 'wikimedia.org', 'wikidata.org', 'wiktionary.org', 'mediawiki.org'],
    ['yahoo.com', 'yimg.com', 'aol.com', 'yahoo.net'],
    ['netflix.com', 'nflxext.com', 'nflximg.net', 'nflxvideo.net', 'nflxso.net'],
    ['ebay.com', 'ebaystatic.com', 'ebayimg.com', 'ebay.co.uk', 'ebay.de'],
    ['pinterest.com', 'pinimg.com'],
    ['tiktok.com', 'tiktokcdn.com', 'ttwstatic.com', 'tiktokv.com', 'byteoversea.com'],
    ['spotify.com', 'scdn.co', 'spotifycdn.com'],
    ['shopify.com', 'myshopify.com', 'shopifycdn.com', 'shopifysvc.com', 'shop.app'],
    ['wordpress.com', 'wp.com', 'gravatar.com', 'wordpress.org'],
    ['nytimes.com', 'nyt.com'],
    ['bbc.co.uk', 'bbc.com', 'bbci.co.uk'],
    ['cnn.com', 'cnn.io', 'turner.com'],
    ['dropbox.com', 'dropboxstatic.com', 'dropboxusercontent.com'],
    ['zoom.us', 'zoom.com'],
    ['slack.com', 'slack-edge.com', 'slack-imgs.com'],
    ['discord.com', 'discordapp.com', 'discordapp.net', 'discord.gg'],
    ['steampowered.com', 'steamcommunity.com', 'steamstatic.com'],
    ['paypal.com', 'paypalobjects.com', 'braintreegateway.com', 'venmo.com'],
    ['stripe.com', 'stripe.network', 'stripecdn.com'],
    ['adobe.com', 'adobelogin.com', 'typekit.net', 'adobedtm.com', 'behance.net'],
    ['atlassian.com', 'atlassian.net', 'atl-paas.net', 'bitbucket.org', 'trello.com'],
    ['salesforce.com', 'force.com', 'salesforceliveagent.com', 'sfdcstatic.com']
  ];

  // Infrastructure cookies that carry no cross-site identity (load balancers, bot management).
  const BENIGN_COOKIE_NAMES = [
    '__cf_bm', 'cf_clearance', '__cfruid', '_cfuvid', '__cflb', 'cf_chl_2', 'cf_chl_prog',
    'awsalb', 'awsalbcors', 'awselb', 'awselbcors', 'arraffinity', 'arraffinitysamesite',
    'jsessionid', 'phpsessid', 'asp.net_sessionid', 'ak_bmsc', 'bm_sv', 'bm_sz', 'bm_mi',
    '__host-next-auth.csrf-token', 'csrftoken', 'xsrf-token', '_csrf', 'route', 'serverid',
    'incap_ses', 'visid_incap', 'nlbi', '__ddg1', '__ddg2', 'datadome', 'sticky'
  ];

  const SURROGATES = [
    { urlFilter: '||google-analytics.com/analytics.js', path: '/surrogates/google-analytics.js', ruleset: 'trackers' },
    { urlFilter: '||google-analytics.com/ga.js', path: '/surrogates/google-analytics.js', ruleset: 'trackers' },
    { urlFilter: '||googletagservices.com/tag/js/gpt.js', path: '/surrogates/googletag-gpt.js', ruleset: 'ads' },
    { urlFilter: '||securepubads.g.doubleclick.net/tag/js/gpt.js', path: '/surrogates/googletag-gpt.js', ruleset: 'ads' },
    { urlFilter: '||pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', path: '/surrogates/adsbygoogle.js', ruleset: 'ads' },
    { urlFilter: '||googletagmanager.com/gtm.js', path: '/surrogates/googletagmanager-gtm.js', ruleset: 'strict' },
    { urlFilter: '||googletagmanager.com/gtag/js', path: '/surrogates/googletagmanager-gtm.js', ruleset: 'strict' }
  ];

  const AD_SET = new Set(AD_DOMAINS);
  const TRACKER_SET = new Set(TRACKER_DOMAINS);
  const STRICT_SET = new Set(STRICT_EXTRA_DOMAINS);
  const NEVER_SET = new Set(NEVER_RESTRICT);
  const CAP_SET = new Set(COOKIE_BLOCK_CAP);
  const BENIGN_COOKIE_SET = new Set(BENIGN_COOKIE_NAMES);
  const ENTITY_INDEX = new Map();
  ENTITY_GROUPS.forEach((group, i) => group.forEach((d) => {
    if (!ENTITY_INDEX.has(d)) ENTITY_INDEX.set(d, i);
  }));

  function isNeverRestrict(host) { return RW.hostInSet(host, NEVER_SET); }
  function isCookieBlockCapped(host) { return RW.hostInSet(host, CAP_SET); }
  function isListedAd(host) { return RW.hostInSet(host, AD_SET); }
  function isListedTracker(host) { return RW.hostInSet(host, TRACKER_SET); }
  function isStrictExtra(host) { return RW.hostInSet(host, STRICT_SET); }

  function sameEntity(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const ia = ENTITY_INDEX.get(a);
    return ia !== undefined && ia === ENTITY_INDEX.get(b);
  }

  function isBenignCookieName(name) {
    if (typeof name !== 'string') return true;
    const n = name.trim().toLowerCase();
    if (BENIGN_COOKIE_SET.has(n)) return true;
    // Prefix families (Incapsula, Akamai) carry suffixes.
    return n.startsWith('incap_ses_') || n.startsWith('visid_incap_') || n.startsWith('nlbi_');
  }

  Object.assign(RW, {
    AD_DOMAINS,
    TRACKER_DOMAINS,
    STRICT_EXTRA_DOMAINS,
    URL_TRACKING_PARAMS,
    NEVER_RESTRICT,
    COOKIE_BLOCK_CAP,
    ENTITY_GROUPS,
    BENIGN_COOKIE_NAMES,
    SURROGATES,
    isNeverRestrict,
    isCookieBlockCapped,
    isListedAd,
    isListedTracker,
    isStrictExtra,
    sameEntity,
    isBenignCookieName
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
