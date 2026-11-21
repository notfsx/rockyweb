// Filter data: block lists, breakage guards, entity groups and script surrogates.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  // Ad networks, exchanges and ad servers, blocked in Balanced and Strict.
  const AD_DOMAINS = [
    '1rx.io', '2mdn.net', '33across.com', '360yield.com', '3lift.com', 'a-ads.com', 'a-mo.net',
    'a-mx.com', 'ad-delivery.net', 'adcolony.com', 'adform.net', 'adformdsp.net', 'adfox.yandex.ru',
    'adgrx.com', 'adhigh.net', 'adition.com', 'adkernel.com', 'adnxs-simple.com', 'adnxs.com',
    'adroll.com', 'ads.tiktok.com', 'ads.youtube.com', 'adsafeprotected.com', 'adservice.google.com',
    'adskeeper.co.uk', 'adsrvr.org', 'adsterra.com', 'adtechus.com', 'advertising.com', 'adzerk.net',
    'amazon-adsystem.com', 'ay.delivery', 'betweendigital.com', 'bidswitch.net', 'brandmetrics.com',
    'buysellads.com', 'carbonads.net', 'casalemedia.com', 'confiant-integrations.net', 'connatix.com',
    'contextweb.com', 'creativecdn.com', 'criteo.com', 'criteo.net', 'districtm.io', 'doubleclick.net',
    'doubleverify.com', 'dv.tech', 'emxdgt.com', 'exoclick.com', 'exosrv.com', 'googleadservices.com',
    'googlesyndication.com', 'googletagservices.com', 'gumgum.com', 'hilltopads.net',
    'improvedigital.com', 'indexww.com', 'intergi.com', 'intergient.com', 'juicyads.com', 'lijit.com',
    'mantis-intelligence.com', 'media.net', 'mgid.com', 'moatads.com', 'mookie1.com',
    'offerwall.yandex.net', 'onetag-sys.com', 'openx.net', 'outbrain.com', 'pbstck.com', 'playwire.com',
    'popads.net', 'popcash.net', 'propellerads.com', 'pubmatic.com', 'rapidedge.io', 'revcontent.com',
    'richaudience.com', 'rubiconproject.com', 'seedtag.com', 'serving-sys.com', 'sharethrough.com',
    'smaato.net', 'smartadserver.com', 'sonobi.com', 'spotx.tv', 'spotxchange.com', 'springserve.com',
    'stackadapt.com', 'taboola.com', 'teads.tv', 'the-ozone-project.com', 'tremorhub.com',
    'triplelift.com', 'undertone.com', 'unityads.unity3d.com', 'unrulymedia.com',
    'webcontentassessor.com', 'yieldlab.net', 'yieldmo.com', 'zedo.com', 'zergnet.com'
  ];

  // Known cross-site analytics and data-broker endpoints, session recorders and ad conversion pixels,
  // blocked in Balanced and Strict. Blocking them does not break pages.
  const TRACKER_DOMAINS = [
    'adfstat.yandex.ru', 'ads-api.tiktok.com', 'ads-api.twitter.com', 'ads-sg.tiktok.com',
    'ads-twitter.com', 'ads.linkedin.com', 'ads.pinterest.com', 'ads.yahoo.com', 'adtech.yahooinc.com',
    'agkn.com', 'an.facebook.com', 'analytics-sg.tiktok.com', 'analytics.pinterest.com',
    'analytics.pointdrive.linkedin.com', 'analytics.query.yahoo.com', 'analytics.tiktok.com',
    'analytics.twitter.com', 'analytics.yahoo.com', 'anonm.io', 'anonymised.io', 'appmetrica.yandex.ru',
    'bat.bing.com', 'bidr.io', 'bluekai.com', 'bounceexchange.com', 'business-api.tiktok.com',
    'chartbeat.com', 'chartbeat.net', 'clarity.ms', 'click.googleanalytics.com', 'crazyegg.com',
    'crwdcntrl.net', 'ct.pinterest.com', 'cxense.com', 'demdex.net', 'dotmetrics.net', 'dotomi.com',
    'events.reddit.com', 'events.redditmedia.com', 'everesttech.net', 'exelator.com', 'eyeota.net',
    'freshmarketer.com', 'fullstory.com', 'gemini.yahoo.com', 'gemius.pl', 'geo.yahoo.com',
    'google-analytics.com', 'histats.com', 'hotjar.com', 'hotjar.io', 'hs-analytics.net',
    'id5-sync.com', 'imrworldwide.com', 'inspectlet.com', 'intentiq.com', 'krxd.net', 'liadm.com',
    'log.byteoversea.com', 'log.fc.yahoo.com', 'log.pinterest.com', 'luckyorange.com',
    'luckyorange.net', 'mathtag.com', 'mc.yandex.com', 'mc.yandex.ru', 'metrika.yandex.ru', 'ml314.com',
    'mouseflow.com', 'nr-data.net', 'omtrdc.net', 'opecloud.com', 'optable.co', 'parsely.com',
    'partnerads.ysm.yahoo.com', 'permutive.app', 'permutive.com', 'pippio.com', 'pixel.facebook.com',
    'prmutv.co', 'quantcount.com', 'quantserve.com', 'rlcdn.com', 'rqtrk.eu', 'sc-static.net',
    'scorecardresearch.com', 'smartlook.com', 'snap.licdn.com', 'statcounter.com',
    'static.ads-twitter.com', 'stats.wp.com', 'tapad.com', 'tr.snapchat.com', 'treasuredata.com',
    'trk.pinterest.com', 'udc.yahoo.com', 'udcm.yahoo.com', 'zeotap.com', 'zi-scripts.com'
  ];

  // Strict only: tag managers, social SDKs, product analytics, share widgets and pop-up tools,
  // which some sites need to work.
  const STRICT_EXTRA_DOMAINS = [
    'addthis.com', 'addtoany.com', 'amplitude.com', 'cdn.segment.com', 'connect.facebook.net',
    'getsitecontrol.com', 'googletagmanager.com', 'heapanalytics.com', 'hellobar.com', 'justuno.com',
    'mixpanel.com', 'mxpnl.com', 'onesignal.com', 'opmnstr.com', 'optinmonster.com', 'poptin.com',
    'privy.com', 'pushcrew.com', 'pushengage.com', 'q.quora.com', 'segment.io', 'sharethis.com',
    'subscribers.com', 'sumo.com', 'sumome.com', 'wisepops.com'
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
