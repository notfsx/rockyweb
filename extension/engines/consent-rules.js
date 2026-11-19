// Cookie banner rules for known consent platforms plus multilingual button patterns.
// Rule fields: detect (banner is showing), reject/accept/settings/save (buttons), hide, scrollClasses,
// shadowHost (selectors resolve in its open shadow root), api (try the platform API first).
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  const CONSENT_RULES = [
    {
      id: 'onetrust', name: 'OneTrust', api: true,
      detect: ['#onetrust-banner-sdk', '#onetrust-pc-sdk'],
      reject: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', 'button.ot-pc-refuse-all-handler'],
      accept: ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'],
      settings: ['#onetrust-pc-btn-handler', '.ot-sdk-show-settings'],
      save: ['.save-preference-btn-handler', '#onetrust-pc-sdk .ot-pc-footer button.save-preference-btn-handler'],
      toggleScope: '#onetrust-pc-sdk',
      hide: ['#onetrust-consent-sdk .onetrust-pc-dark-filter', '#onetrust-banner-sdk', '#onetrust-pc-sdk'],
      scrollClasses: ['ot-overflow-hidden']
    },
    {
      id: 'cookiebot', name: 'Cookiebot', api: true,
      detect: ['#CybotCookiebotDialog'],
      reject: ['#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
      accept: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept'],
      settings: ['#CybotCookiebotDialogBodyLevelButtonCustomize', '#CybotCookiebotDialogNavDetails'],
      save: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection', '#CybotCookiebotDialogBodyButtonAcceptSelected'],
      toggleScope: '#CybotCookiebotDialog',
      hide: ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay'],
      scrollClasses: ['CybotCookiebotDialogActive']
    },
    {
      id: 'didomi', name: 'Didomi', api: true,
      detect: ['#didomi-notice', '#didomi-popup .didomi-popup-container', '.didomi-popup-notice'],
      reject: ['#didomi-notice-disagree-button', '.didomi-continue-without-agreeing', '#didomi-popup .didomi-button-standard[aria-label*="Disagree" i]'],
      accept: ['#didomi-notice-agree-button'],
      settings: ['#didomi-notice-learn-more-button'],
      save: ['.didomi-consent-popup-actions .didomi-button-highlight', '#didomi-consent-popup .didomi-components-button--color'],
      hide: ['#didomi-host'],
      scrollClasses: ['didomi-popup-open', 'didomi-popup-open-ios']
    },
    {
      id: 'usercentrics', name: 'Usercentrics', api: true,
      shadowHost: '#usercentrics-root',
      detect: ['[data-testid="uc-default-banner"]', '[data-testid="uc-banner-content"]', '#uc-center-container', '[data-testid="uc-center-container"]'],
      reject: ['[data-testid="uc-deny-all-button"]', 'button[data-action-type="deny"]'],
      accept: ['[data-testid="uc-accept-all-button"]', 'button[data-action-type="accept"]'],
      settings: ['[data-testid="uc-more-button"]', 'button[data-action-type="more"]'],
      save: ['[data-testid="uc-save-button"]', 'button[data-action-type="save"]'],
      hide: ['#usercentrics-root'],
      scrollClasses: ['overflowHidden']
    },
    {
      id: 'usercentrics3', name: 'Usercentrics v3', api: true,
      shadowHost: '#usercentrics-cmp-ui',
      detect: ['#uc-main-dialog', '.cmp-wrapper', '[role="dialog"]'],
      reject: ['#deny', 'button.deny', '[data-action-type="deny"]'],
      accept: ['#accept', 'button.accept', '[data-action-type="accept"]'],
      settings: ['#more', 'button.more'],
      save: ['#save', 'button.save'],
      hide: ['#usercentrics-cmp-ui']
    },
    {
      id: 'quantcast', name: 'Quantcast Choice',
      detect: ['.qc-cmp2-container .qc-cmp2-summary-buttons', '#qc-cmp2-ui'],
      reject: ['.qc-cmp2-summary-buttons button[mode="secondary"]:not([aria-label*="option" i])', '.qc-cmp2-header-links button:first-child'],
      accept: ['.qc-cmp2-summary-buttons button[mode="primary"]'],
      settings: ['.qc-cmp2-summary-buttons button[aria-label*="option" i]'],
      save: ['.qc-cmp2-footer button[mode="primary"]'],
      hide: ['#qc-cmp2-container', '.qc-cmp2-container'],
      scrollClasses: ['qc-cmp-ui-showing', 'qc-cmp2-container-shown']
    },
    {
      id: 'trustarc', name: 'TrustArc',
      detect: ['#truste-consent-track', '#truste-consent-content', '.truste_overlay'],
      reject: ['#truste-consent-required', '.truste-button2[data-choice="decline"]'],
      accept: ['#truste-consent-button'],
      settings: ['#truste-show-consent'],
      hide: ['#truste-consent-track', '.truste_overlay', '.truste_box_overlay'],
      scrollClasses: ['truste-noscroll']
    },
    {
      id: 'sourcepoint', name: 'Sourcepoint',
      detect: ['div[id^="sp_message_container_"]'],
      hide: ['div[id^="sp_message_container_"]'],
      scrollClasses: ['sp-message-open'],
      frameOnly: false,
      containerOnly: true // buttons live inside a cross-origin iframe handled by the frame engine
    },
    {
      id: 'fundingchoices', name: 'Google Funding Choices',
      detect: ['.fc-consent-root .fc-dialog', '.fc-consent-root'],
      reject: ['.fc-cta-do-not-consent', '.fc-button.fc-cta-do-not-consent'],
      accept: ['.fc-cta-consent'],
      settings: ['.fc-cta-manage-options'],
      save: ['.fc-confirm-choices'],
      toggleScope: '.fc-consent-root',
      hide: ['.fc-consent-root'],
      scrollClasses: ['fc-ab-root']
    },
    {
      id: 'cookieyes', name: 'CookieYes',
      detect: ['.cky-consent-container:not(.cky-hide)', '.cky-modal.cky-modal-open'],
      reject: ['.cky-btn-reject'],
      accept: ['.cky-btn-accept'],
      settings: ['.cky-btn-customize'],
      save: ['.cky-btn-preferences'],
      toggleScope: '.cky-modal',
      hide: ['.cky-consent-container', '.cky-overlay', '.cky-modal'],
      scrollClasses: ['cky-modal-open']
    },
    {
      id: 'complianz', name: 'Complianz', api: true,
      detect: ['.cmplz-cookiebanner:not(.cmplz-hidden)', '#cmplz-cookiebanner-container .cmplz-show'],
      reject: ['.cmplz-btn.cmplz-deny', '.cmplz-deny'],
      accept: ['.cmplz-btn.cmplz-accept', '.cmplz-accept'],
      settings: ['.cmplz-btn.cmplz-view-preferences'],
      save: ['.cmplz-btn.cmplz-save-preferences'],
      toggleScope: '.cmplz-cookiebanner',
      hide: ['.cmplz-cookiebanner', '#cmplz-cookiebanner-container'],
      scrollClasses: ['cmplz-blocked-content-container']
    },
    {
      id: 'osano', name: 'Osano',
      detect: ['.osano-cm-dialog:not(.osano-cm-dialog--hidden)'],
      reject: ['.osano-cm-denyAll', '.osano-cm-button--type_denyAll', '.osano-cm-deny'],
      accept: ['.osano-cm-accept-all', '.osano-cm-button--type_accept'],
      settings: ['.osano-cm-manage', '.osano-cm-button--type_manage'],
      save: ['.osano-cm-save', '.osano-cm-button--type_save'],
      hide: ['.osano-cm-window'],
      scrollClasses: ['osano-cm-no-scroll']
    },
    {
      id: 'termly', name: 'Termly',
      detect: ['[data-tid="banner-decline"]', '#termly-code-snippet-support [role="alertdialog"]'],
      reject: ['[data-tid="banner-decline"]'],
      accept: ['[data-tid="banner-accept"]'],
      settings: ['[data-tid="banner-manage"]'],
      hide: ['#termly-code-snippet-support']
    },
    {
      id: 'iubenda', name: 'iubenda',
      detect: ['#iubenda-cs-banner'],
      reject: ['.iubenda-cs-reject-btn'],
      accept: ['.iubenda-cs-accept-btn'],
      settings: ['.iubenda-cs-customize-btn'],
      hide: ['#iubenda-cs-banner'],
      scrollClasses: ['iubenda-cs-overlay']
    },
    {
      id: 'axeptio', name: 'Axeptio',
      detect: ['#axeptio_overlay .axeptio_widget', '#axeptio_main_button'],
      reject: ['#axeptio_btn_dismiss'],
      accept: ['#axeptio_btn_acceptAll'],
      settings: ['#axeptio_btn_configure'],
      hide: ['#axeptio_overlay']
    },
    {
      id: 'klaro', name: 'Klaro', api: true,
      detect: ['.klaro .cookie-notice:not(.cookie-notice-hidden)', '.klaro .cookie-modal'],
      reject: ['.klaro .cn-decline', '.klaro .cm-btn-decline'],
      accept: ['.klaro .cm-btn-accept-all', '.klaro .cm-btn-success'],
      settings: ['.klaro .cn-learn-more'],
      save: ['.klaro .cm-btn-accept'],
      hide: ['.klaro']
    },
    {
      id: 'borlabs', name: 'Borlabs',
      detect: ['#BorlabsCookieBox ._brlbs-block-content', '#BorlabsCookieBox .brlbs-cmpnt-dialog'],
      reject: ['a._brlbs-refuse-btn', '._brlbs-refuse-btn a', '[data-cookie-refuse]', '.brlbs-btn-accept-only-essential'],
      accept: ['._brlbs-btn-accept-all', '[data-cookie-accept-all]', '.brlbs-btn-accept-all'],
      settings: ['[data-cookie-individual]'],
      hide: ['#BorlabsCookieBox']
    },
    {
      id: 'cookiefirst', name: 'CookieFirst', api: true,
      detect: ['.cookiefirst-root [data-cookiefirst-widget]', '.cookiefirst-root'],
      reject: ['[data-cookiefirst-action="reject"]'],
      accept: ['[data-cookiefirst-action="accept"]'],
      settings: ['[data-cookiefirst-action="adjust"]'],
      save: ['[data-cookiefirst-action="save"]'],
      hide: ['.cookiefirst-root']
    },
    {
      id: 'cookiescript', name: 'CookieScript', api: true,
      detect: ['#cookiescript_injected'],
      reject: ['#cookiescript_reject'],
      accept: ['#cookiescript_accept'],
      settings: ['#cookiescript_manage'],
      save: ['#cookiescript_save'],
      hide: ['#cookiescript_injected', '#cookiescript_injected_wrapper']
    },
    {
      id: 'consentmanager', name: 'consentmanager',
      detect: ['#cmpbox', '#cmpwrapper'],
      reject: ['.cmpboxbtnno', 'a.cmpboxbtn.cmpboxbtnno', '.cmpboxbtnreject'],
      accept: ['.cmpboxbtnyes'],
      settings: ['.cmpboxbtncustom'],
      save: ['.cmpboxbtnsave', '.cmpboxbtnyescustomchoices'],
      hide: ['#cmpbox', '#cmpbox2', '#cmpwrapper'],
      scrollClasses: ['cmpnoscroll']
    },
    {
      id: 'shopify', name: 'Shopify', api: true,
      detect: ['#shopify-pc__banner'],
      reject: ['#shopify-pc__banner__btn-decline'],
      accept: ['#shopify-pc__banner__btn-accept'],
      settings: ['#shopify-pc__banner__btn-manage-prefs'],
      hide: ['#shopify-pc__banner', '#shopify-pc__prefs']
    },
    {
      id: 'ketch', name: 'Ketch',
      detect: ['#lanyard_root [role="dialog"]', '#lanyard_root #ketch-banner'],
      reject: ['#lanyard_root button[aria-label*="Reject" i]', '#ketch-banner-button-secondary'],
      accept: ['#ketch-banner-button-primary'],
      hide: ['#lanyard_root']
    },
    {
      id: 'cookienotice', name: 'Cookie Notice',
      detect: ['#cookie-notice.cookie-notice-visible', '#cookie-notice'],
      reject: ['#cn-refuse-cookie'],
      accept: ['#cn-accept-cookie'],
      hide: ['#cookie-notice']
    },
    {
      id: 'cookielawinfo', name: 'CookieLawInfo',
      detect: ['#cookie-law-info-bar'],
      reject: ['#cookie_action_close_header_reject', '.cli_action_button[data-cli_action="reject"]'],
      accept: ['#cookie_action_close_header', '#wt-cli-accept-all-btn'],
      settings: ['.cli_settings_button'],
      hide: ['#cookie-law-info-bar', '.cli-modal-backdrop'],
      scrollClasses: ['cli-modal-open', 'cli-barmodal-open']
    },
    {
      id: 'moove', name: 'Moove GDPR',
      detect: ['#moove_gdpr_cookie_info_bar:not(.moove-gdpr-info-bar-hidden)'],
      reject: ['.moove-gdpr-infobar-reject-btn'],
      accept: ['.moove-gdpr-infobar-allow-all'],
      hide: ['#moove_gdpr_cookie_info_bar']
    },
    {
      id: 'civic', name: 'Civic Cookie Control',
      detect: ['#ccc #ccc-notify', '#ccc-overlay', '#ccc #ccc-module'],
      reject: ['#ccc-reject-settings', '#ccc-notify-reject'],
      accept: ['#ccc-notify-accept', '#ccc-recommended-settings'],
      settings: ['.ccc-notify-link'],
      hide: ['#ccc']
    },
    {
      id: 'tarteaucitron', name: 'tarteaucitron',
      detect: ['#tarteaucitronRoot #tarteaucitronAlertBig', '#tarteaucitronRoot #tarteaucitron[style*="block"]'],
      reject: ['#tarteaucitronAllDenied2', '#tarteaucitronAllDenied'],
      accept: ['#tarteaucitronPersonalize2', '#tarteaucitronAllAllowed'],
      hide: ['#tarteaucitronRoot']
    },
    {
      id: 'evidon', name: 'Evidon',
      detect: ['#_evidon_banner', '#_evidon-banner'],
      reject: ['#_evidon-decline-button', '#evidon-banner-decline-button'],
      accept: ['#_evidon-accept-button', '#evidon-banner-acceptbutton'],
      hide: ['#_evidon_banner', '#_evidon-banner', '#_evidon-background']
    },
    {
      id: 'trustcommander', name: 'TrustCommander',
      detect: ['#tc-privacy-wrapper', '#popin_tc_privacy'],
      reject: ['#popin_tc_privacy_button_2', '#privacy-cat-modal-refuse-all'],
      accept: ['#popin_tc_privacy_button_3', '#popin_tc_privacy_button'],
      hide: ['#tc-privacy-wrapper', '#footer_tc_privacy', '#popin_tc_privacy']
    },
    {
      id: 'wix', name: 'Wix',
      detect: ['[data-hook="consent-banner-root"]'],
      reject: ['[data-hook="consent-banner-decline-button"]'],
      accept: ['[data-hook="consent-banner-apply-button"]'],
      settings: ['[data-hook="consent-banner-settings-button"]'],
      hide: ['[data-hook="consent-banner-root"]']
    },
    {
      id: 'squarespace', name: 'Squarespace',
      detect: ['.sqs-cookie-banner-v2', '.gdpr-cookie-banner'],
      reject: ['.sqs-cookie-banner-v2-decline', '.sqs-cookie-banner-v2-cta[data-action="decline"]'],
      accept: ['.sqs-cookie-banner-v2-accept'],
      hide: ['.sqs-cookie-banner-v2', '.gdpr-cookie-banner']
    },
    {
      id: 'hubspot', name: 'HubSpot',
      detect: ['#hs-eu-cookie-confirmation'],
      reject: ['#hs-eu-decline-button'],
      accept: ['#hs-eu-confirmation-button'],
      settings: ['#hs-eu-cookie-settings-button'],
      hide: ['#hs-eu-cookie-confirmation']
    },
    {
      id: 'amazon', name: 'Amazon',
      detect: ['#sp-cc'],
      reject: ['#sp-cc-rejectall-link', 'input#sp-cc-rejectall-link'],
      accept: ['#sp-cc-accept'],
      hide: ['#sp-cc']
    },
    {
      id: 'youtube', name: 'YouTube',
      detect: ['ytd-consent-bump-v2-lightbox tp-yt-paper-dialog', 'ytm-consent-bump-v2-renderer'],
      reject: ['ytd-consent-bump-v2-lightbox button[aria-label^="Reject" i]', 'ytm-consent-bump-v2-renderer button[aria-label^="Reject" i]'],
      accept: ['ytd-consent-bump-v2-lightbox button[aria-label^="Accept" i]'],
      hide: ['ytd-consent-bump-v2-lightbox', 'tp-yt-iron-overlay-backdrop']
    },
    {
      id: 'cookieinformation', name: 'Cookie Information',
      detect: ['#coiOverlay[style*="block"]', '#coiOverlay:not([aria-hidden="true"]) #coi-banner-wrapper'],
      reject: ['#declineButton', '.coi-banner__decline', '#coiPage-1 .coi-banner__decline'],
      accept: ['.coi-banner__accept'],
      hide: ['#coiOverlay'],
      scrollClasses: ['noScroll']
    }
  ];

  const CONSENT_FRAME_HOST_RE = /(^|\.)(privacy-mgmt\.com|sp-prod\.net|sourcepoint\.com|consent\.[a-z0-9-]+\.[a-z.]+|cmp\.[a-z0-9-]+\.[a-z.]+|trustarc\.com|consentmanager\.net|consent\.google\.[a-z.]+|consent\.youtube\.com|fundingchoicesmessages\.google\.com|quantcast\.com|cookielaw\.org|onetrust\.com)$/i;

  const REJECT_PATTERNS = [
    /^(reject|decline|deny|refuse|disagree|disallow|object)( all| everything| all cookies| cookies| optional cookies| non[- ]essential cookies| additional cookies| non[- ]necessary cookies| unnecessary cookies)?( and close| & close)?$/,
    /^(i )?(do not|don't) (accept|agree|consent)$/,
    /^(only|use|accept|allow) (only )?(strictly )?(necessary|essential|required|technical)( cookies)?( only)?$/,
    /^(necessary|essential|required|strictly necessary)( cookies)? only$/,
    /^only allow (essential|necessary|required) cookies$/,
    /^decline optional cookies$/,
    /^continue without (accepting|agreeing|consent|consenting)$/,
    /^(reject|decline|refuse|deny) (analytics|marketing|advertising|tracking|statistics|performance)( cookies)?$/,
    /^no,? thanks( you)?$/,
    /^no,? i (do not|don't) (accept|agree|consent)$/,
    /^(alle |optionale )?(cookies )?ablehnen( und schließen)?$/,
    /^nur (technisch )?(notwendige|erforderliche|essenzielle|essentielle)( cookies)?( (akzeptieren|zulassen|verwenden|erlauben))?$/,
    /^(alles |tout )?refuser( tout| tous les cookies| les cookies| et fermer)?$/,
    /^continuer sans accepter$/,
    /^je refuse$/,
    /^rechazar( todo| todas| todas las cookies| cookies)?$/,
    /^(solo|sólo) (las )?(necesarias|esenciales)$/,
    /^rifiuta( tutto| tutti| i cookie)?$/,
    /^(continua|prosegui) senza accettare$/,
    /^(solo|accetta solo) (i )?(necessari|essenziali)$/,
    /^(alles |alle cookies )?weigeren$/,
    /^alleen (noodzakelijke|functionele|essentiële) cookies( accepteren)?$/,
    /^afwijzen$/,
    /^(rejeitar|recusar)( tudo| todos)?$/,
    /^odrzuć( wszystkie)?$/,
    /^nie zgadzam się$/,
    /^(avvisa|neka|afvis|avvis|avslå)( alla| alle)?$/,
    /^(endast|kun|bare) (nödvändiga|nødvendige)( cookies)?$/,
    /^hylkää( kaikki)?$/,
    /^odmítnout( vše)?$/,
    /^elutasít(om|ás)?( mind)?$/
  ];

  const ACCEPT_PATTERNS = [
    /^(accept|allow|agree)( all| all cookies| cookies| and close| & close| and continue| to all)?$/,
    /^(yes,? )?i (accept|agree)$/,
    /^(ok|okay|got it|i understand|understood)$/,
    /^(alle )?(akzeptieren|zustimmen|annehmen|erlauben)$/,
    /^alle cookies (akzeptieren|zulassen|erlauben)$/,
    /^(tout )?accepter( et fermer| tout)?$/,
    /^aceptar( todo| todas| cookies| todas las cookies)?$/,
    /^accetta( tutto| tutti)?$/,
    /^(alles )?accepteren$/,
    /^aceitar( tudo| todos)?$/,
    /^akceptuj( wszystkie)?$/,
    /^(acceptera|godkänn|accepter|godta)( alla| alle)?$/
  ];

  const SETTINGS_RE = /(manage|customi[sz]e|settings|preferences|more options|options|choices|configure|einstellungen|anpassen|paramètres|personnaliser|configurar|preferencias|impostazioni|personalizza|instellingen|voorkeuren|ustawienia|inställningar|indstillinger|innstillinger)/;
  const SAVE_PATTERNS = [
    /^(save|confirm|submit|apply)( (my |your )?(choices|choice|preferences|settings|selection|consent))?( and (close|exit|continue))?$/,
    /^(allow|accept) (selection|selected|current selection|my selection)$/,
    /^(auswahl|einstellungen) (speichern|bestätigen|erlauben)$/,
    /^speichern$/,
    /^(enregistrer|valider|confirmer)( mes choix| et fermer| la sélection)?$/,
    /^guardar( y salir| preferencias| configuración| cambios)?$/,
    /^(salva|conferma)( le scelte| impostazioni| selezione)?$/,
    /^(opslaan|bevestigen)( keuze| voorkeuren| instellingen)?$/,
    /^(spara|gem|lagre)( val| valg| inställningar| indstillinger)?$/
  ];
  const NOTICE_DISMISS_RE = /^(ok|okay|got it|close|dismiss|understood|i understand|continue|x|×|✕)$/;

  const COOKIE_TEXT_RE = /(cookie|consent|gdpr|ccpa|tracking technolog|personal data|your privacy|privacy (policy|settings|preferences|choices)|datenschutz|einwilligung|consentement|traceurs|galletas|privacidad|consenso|toestemming|samtycke|samtykke|zgod|souhlas|evästeet)/i;

  // Stricter wording required before an unknown overlay counts as a consent banner.
  const STRONG_COOKIE_TEXT_RE = /(cookie|consent|gdpr|ccpa|tracking technolog|einwilligung|consentement|traceurs|galletas|consenso|toestemming|samtycke|samtykke|zgod|souhlas|evästeet)/i;

  const CATEGORY_PATTERNS = {
    necessary: /(strictly necessary|necessary|essential|required|technical|notwendig|erforderlich|essenziell|nécessaire|necesari|necessari|noodzakelijk|nødvendige|nödvändiga)/i,
    marketing: /(marketing|advertis|targeting|\bads\b|personali[sz]ed ad|social media|retarget|werbung|publicit|publicidad|pubblicit|reclame|annonc)/i,
    analytics: /(analytic|statistic|performance|measure|audience|statistik|mesure|análisis|analisi|prestaties|statistiques|estadístic)/i,
    functional: /(functional|preference|personali[sz]ation|comfort|funktional|präferenz|fonctionn|preferenc|funzional|voorkeur)/i
  };

  // Classes CMPs (and generic modal libraries) add to <html>/<body> to stop scrolling.
  const SCROLL_LOCK_CLASSES = [
    'sp-message-open', 'didomi-popup-open', 'didomi-popup-open-ios', 'qc-cmp-ui-showing',
    'qc-cmp2-container-shown', 'ot-overflow-hidden', 'cky-modal-open', 'cli-modal-open',
    'cli-barmodal-open', 'truste-noscroll', 'cmpnoscroll', 'osano-cm-no-scroll', 'CybotCookiebotDialogActive',
    'cookie-consent-active', 'cookie-banner-open', 'cookies-not-accepted', 'has-cookie-banner',
    'consent-modal-open', 'cmp-popup-open', 'tc-modal-open', 'gdpr-open', 'no-scroll', 'noscroll',
    'scroll-lock', 'disable-scroll', 'overflow-hidden', 'fc-ab-root', 'iubenda-cs-overlay', 'noScroll'
  ];

  Object.assign(RW, {
    CONSENT_RULES,
    CONSENT_FRAME_HOST_RE,
    CONSENT_REJECT_PATTERNS: REJECT_PATTERNS,
    CONSENT_ACCEPT_PATTERNS: ACCEPT_PATTERNS,
    CONSENT_SETTINGS_RE: SETTINGS_RE,
    CONSENT_SAVE_PATTERNS: SAVE_PATTERNS,
    CONSENT_NOTICE_DISMISS_RE: NOTICE_DISMISS_RE,
    CONSENT_COOKIE_TEXT_RE: COOKIE_TEXT_RE,
    CONSENT_STRONG_TEXT_RE: STRONG_COOKIE_TEXT_RE,
    CONSENT_CATEGORY_PATTERNS: CATEGORY_PATTERNS,
    SCROLL_LOCK_CLASSES
  });

  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
