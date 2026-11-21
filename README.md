# Rockyweb

A Manifest V3 Chrome extension that answers cookie popups with your choices, blocks ads and trackers, and lets you hide anything on a page with a click. Named after Rocky, a British cocker spaniel. Set your preferences once and get on with browsing.

The loadable extension is the **`extension/`** folder. Everything else is tooling and is not shipped.

## Install for testing

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. Pin Rockyweb to the toolbar.

Chrome 116 or newer. No build step is needed.

A fresh install opens a short welcome page (`options.html#welcome`): what already works without any setup, and, only when Chrome reports that this computer can run its on-device model, an offer to download it. Nothing downloads until you click. Updates never open it.

## Using it

- **Popup:** the site, an on/off switch, the protection mode (off, consent, balanced, strict) and live numbers.
- **Gear icon in the popup:** per-engine switches, cookie categories, an allow / cookies / block choice for every third-party domain, the element picker and a link to settings.
- **Element picker:** click to hide, arrow keys to widen or narrow, Ctrl+Z (Cmd+Z on Mac) to undo, Esc when done. Hidden elements are remembered per site.
- **Changes on this site (popup):** every page change you described and every page fix, each with on, off and delete.
- **Settings page:** default mode, cookie choices, custom mode, websites, learned trackers, page changes, and data (stats, export, import, reset).

## Automatic optimisation (optional, on-device AI)

Off by default. Turn on "automatically optimise protection for each site" on the settings page and Rockyweb quietly makes small, reversible, page-scoped adjustments where the right answer depends on context. Two are shipped:

- **Newsletter overlays:** hiding an unsolicited newsletter overlay on an article, while leaving the same kind of form alone on account, login and checkout pages, when you opened it yourself, or while you are typing in it.
- **Cookie banners no rule recognises:** only after the consent platform APIs, the button rules and the wording rules have all given up on a banner that still looks like consent, and only when your cookie choices refuse something. Rockyweb removes every button that accepts, opens settings, saves, subscribes, pays, signs in, postpones or leaves the page (in 14 languages, by label and by attributes), and the model may pick one of what is left as the refusal, or leave the banner. Rockyweb rechecks the page, clicks once, and verifies: the banner went away, the page did not navigate, and readable consent storage changed. A failed check is recorded and never retried on that site. A verified answer is remembered for the site by its button labels. Top frame only; never on a banner you opened yourself, in Light mode or in Incognito; per site, "don't answer cookie banners for me on this site" turns it off. A click cannot be undone, so the toolbar lists it and points to the site's own cookie settings link.

- **Model:** Chrome's built-in Gemini Nano through the `LanguageModel` API, run from the extension service worker (exposed there from Chrome 138, confirmed on Chrome 153). No cloud, accounts, keys or telemetry.
- **Only when needed:** cheap local rules first. The model is asked only about an overlay on an article that passed every rule and is still ambiguous; an ordinary page makes zero model calls.
- **Bounded authority:**
  - The model picks `hide_overlay` or `leave_unchanged` for one candidate ID, through a fixed JSON schema.
  - It never supplies selectors, code, URLs or network rules.
  - Low confidence, extra fields or anything stale are discarded.
  - The page is rechecked before anything is applied.
- **What the model sees:** compact signals (page type, position, field count, interaction state, a short heading treated as untrusted data). Never form values, passwords, cookies, URL query strings or history.
- **Memory:** a decision is remembered for that site and page type for 7 days, and an undo for 30 days. Both are invalidated when relevant settings change.
- **Undo:** the toolbar popup shows "automatic adjustments" with "undo" and "don't do this on this site" (for a cookie banner answer, which cannot be unclicked: "don't answer cookie banners for me on this site"). There are no on-page notifications.
- **Code switch:** `RW.AI_CONSENT_ENABLED` in `extension/shared/constants.js` turns the cookie banner part off entirely.
- **Never** runs in Incognito or in Light mode, and never overrides your explicit choices (cookie categories, saved consent, site and domain choices, "newsletter prompts" set to hide or leave alone).
- **Describe a change** (popup, gear) is separate and on request only: see [Page changes](#page-changes-describe-a-change-and-page-fixes).

On a machine without Nano everything else works as before; the AI controls are greyed out with an explanation.

## Page changes: describe a change, and page fixes

Beyond the switches in the popup, Rockyweb can change how a page looks, and remembers it for that website.

- **Describe a change** (popup, gear): type what you want, for example "hide the app banner and make the text bigger". Rockyweb builds an outline of the page (up to 30 notable elements, each with a number and a short label) and asks Gemini Nano on your device. The model answers with settings and with changes from a fixed list: hide, keep in place (stop following the page), text size, width, line spacing, colours (dark, grey, stronger, warm), font, stop animations, let the page scroll, and stop videos playing by themselves. The change is shown on the page straight away; nothing is saved until you press apply.
- **Saved per website:** an applied change is stored for that site and applied again on every visit. Asking for the same thing again on the same site finds the saved change instead of asking the model.
- **Reversible:** "changes on this site" in the popup, and "page changes" in settings, list every change with on, off and delete. Switching one off removes its styles at once and puts back any setting it changed, unless you have changed that setting since.
- **Page fixes:** local rules notice a bar asking you to install an app, a video player floating over the text, a header taking a large part of the screen as you scroll, a promotional bar fixed to the screen, or a page that will not scroll for no visible reason. Settings, protection, page fixes: off, suggest (default: listed in the popup, nothing changes until you apply) or automatic (the obvious ones are applied and listed; with automatic optimisation on, the model is asked about the rest). A fix you switch off or dismiss is not suggested again on that site for 30 days. Per site: "don't suggest page fixes on this site".
- **Safety:**
  - The model never writes CSS, selectors, scripts or URLs. It picks an operation and an element number; Rockyweb generates the selector and builds the CSS from fixed templates, with numbers clamped to fixed ranges.
  - Every stored change is validated again by the service worker (and on import). Selectors are single, end in a tag, id or class, and can never be the page itself.
  - On every visit the page is checked before a change stays: a change that would hide the main content, the page itself or a form you are using, or that matches more than 10 elements, is taken off that page and the popup says why.
  - Styles are added with `chrome.scripting.insertCSS` at user origin, so page styles cannot override them, and removed exactly.
  - Page fixes never touch cookie notices, sign-in, payment, paywalls, age checks or anti-adblock messages, and never run in Incognito or Light mode.
- **Turn it off:** settings, protection, "let AI change pages, not only settings" (describe a change then changes settings only), and page fixes off.

## Light mode

A global operating choice, separate from the per-site modes. Precedence (in `runtimeCapabilities()`): your explicit choices, then the site's mode, then Light, then automatic optimisation.

- **Kept:** declarative blocking, link cleaning, element hiding, your site settings, and explicit newsletter choices.
- **Paused:**
  - AI;
  - tracker learning and request header observation (only top-level navigations are observed);
  - the third-party domain list;
  - deep page scanning and retries.
- **Cookie popups:** answered only for the consent platforms Rockyweb recognises, with one API attempt and three checks per page; unknown banners are left alone.
- Switching on stops pending work in open tabs; switching off restores everything.

## Protection modes

| Mode | Cookie popups | Ads and known trackers | Learned trackers | Hide ads | Clean links |
|---|---|---|---|---|---|
| off | no | no | no | no | no |
| consent | your choices | no | no | no | no |
| balanced (default) | your choices | blocked | cookies stripped | yes | yes |
| strict | reject all | blocked, plus a stricter list | blocked | yes, plus annoyances | yes |
| custom | your mix | your mix | your mix | your mix | your mix |

Changing any single switch on a site makes that site custom, starting from what its mode had on.

## How it works

- **Settings:** `shared/config.js` holds `getEffectiveConfig(state, hostname)`, the one place that decides what runs on a site. Sites are keyed by registrable domain, so `shop.example.com` uses the `example.com` profile.
- **Network blocking:**
  - Static `declarativeNetRequest` rulesets (`rules/*.json`, built from `shared/filter-lists.js`).
  - Dynamic rules compiled from your settings by `shared/rules-compiler.js`. The priority ladder is at the top of that file.
  - Blocked analytics and ad scripts are swapped for harmless stand-ins (`surrogates/`) so pages that call them keep working.
- **Tracker learning:** the service worker watches third-party requests (observe only). A domain that sets or sends an identifying cookie on 3 or more sites is learned. Payment, login and captcha providers are never restricted; shared CDNs are at most cookie-stripped.
- **Cookie popups:** three layers, tried in order:
  1. The consent platform's own API, injected briefly into the page and retried from the service worker so page loads are never delayed.
  2. Button rules for about 35 platforms (`engines/consent-rules.js`).
  3. Wording-based detection in 14 languages for unknown banners.

  Pages left unscrollable afterwards are fixed. The engine never overrides a choice you already made on a site.
- **Element hiding:** CSS injected with `chrome.scripting.insertCSS` at user origin, so pages can't override it.

## Privacy

Everything stays in the browser (`chrome.storage.local` and `chrome.storage.session`). No servers, analytics or remote code. Optional sync (off by default) copies settings, per-site modes and saved page changes through `chrome.storage.sync`, within its quota, and never trackers, statistics or Incognito changes. See [PRIVACY.md](PRIVACY.md).

How much tracking it stops, measured on 43 real websites and two public tests with Rockyweb off, Balanced and Strict: [tests/sites/privacy.md](tests/sites/privacy.md). In short (measured 2026-11-20): tracker requests per page from a median of 13 to 5 in Balanced and 2 in Strict, third-party tracker cookies from 660 to 21 and 17 across the pages, and adblock-tester.com from 41 to 58 and 61.

## Development

```bash
npm test               # unit tests (node:test, no dependencies)
```

```bash
npm run verify         # static checks: referenced files, message actions, rule validity, code hygiene
```

```bash
npm run test:e2e       # end-to-end tests in Chromium (needs Playwright)
```

```bash
npm run test:upgrade   # install 1.0.0 with real choices, update in place to this version, check nothing was lost
```

```bash
npm run test:a11y      # axe-core on the popup and settings pages, plus a keyboard-only pass
```

```bash
npm run test:soak      # about 200 navigations with service worker restarts; looks for accepts, drift and leaks
```

```bash
npm run test:sites     # real UK and EU websites, browse only; writes tests/sites/results.md
```

`npm run test:sites` visits each site in `tests/sites/corpus.json` once per configuration plus one reload, one site at a time, and clicks nothing itself. Screenshots and raw results stay in `tests/sites/.out` (git-ignored). Results depend on where the machine is: the committed baseline was run from the United States.

To check a browser with no built-in AI at all, point `ROCKYWEB_CHROME` at an older Chrome (for example Chrome for Testing 116) and run `node tests/e2e/run-ai-absent.mjs`. The core suite runs the same way: `ROCKYWEB_CHROME=<path> node tests/e2e/run-e2e.mjs`.

```bash
npm run build          # regenerate rules/*.json and the icons (icons need Playwright)
```

```bash
npm run package        # verify, then build dist/rockyweb-<version>.zip for the Web Store
```

```bash
npm run perf           # compare Light, Full with AI off and Full with automatic optimisation
```

```bash
npm run test:nano      # real Gemini Nano on your own machine (see tests/nano/run-real-nano.mjs)
```

```bash
npm run store:assets   # regenerate the store screenshots and promo tiles (needs Playwright)
```

Playwright and axe-core are dev dependencies: run `npm install`, then `npx playwright install chromium`.

`npm run test:nano` loads `extension/` into your own Chrome through the debugging pipe, so no "Load unpacked" click is needed. Set `NANO_PROFILE` to keep its profile (and the multi-GB model) out of a synced folder such as OneDrive, and `NANO_DOWNLOAD=yes` to start the model download without asking.

Store submission text, permission justifications and image list: [store/LISTING.md](store/LISTING.md).

## Layout

```
extension/      the extension (manifest, background, content script, popup, options)
  shared/       settings, filter lists, rule compiler, element hiding lists
  engines/      cookie popup rules and the consent platform API engine
  surrogates/   stand-ins for blocked analytics and ad scripts
  rules/        static blocking rules (generated)
  ui/           theme, fonts and UI helpers
  icons/        icons (generated from assets/rocky-logo.webp)
assets/         logo source artwork (not shipped)
scripts/        build, verify, package and store image scripts
store/          Web Store listing text and images
tests/          unit tests and the end-to-end suite
```

## Known limitations

- The registrable domain uses a built-in list of common multi-part suffixes, not the full Public Suffix List.
- When a banner offers only reject or accept, "necessary and functional only" is answered with reject.
- Learned-tracker rules are scoped by the requesting frame, so a cross-site iframe follows its own site's settings.
- The stand-in scripts are web accessible, which lets a page detect that the extension is installed.
- The browser suites (`npm run test:e2e`) and `npm run perf` use a deterministic model double in place of `LanguageModel`. Real inference is covered by `npm run test:nano` (see below).
- After every Chrome start, Chrome loads Gemini Nano the first time something asks for it: 285 to 352 s on the test laptop in the latest runs (measured, three Chrome starts; 167 to 937 s in earlier rounds, and it depends on the hardware). "Describe a change" waits for it, says so, and the load goes on if you close the popup. Automatic optimisation leaves overlays alone until the model is ready (each request gives up after 20 s, later ones are answered at once while the load goes on).
- Chrome unloads the model about a minute and a half after the last session closes (measured once: 94 s), and drops it about 5 minutes after its last answer even with a session open (measured twice). Loading it again took 176 to 292 s. Rockyweb keeps a session for 10 minutes after each "describe a change" and asks it a tiny question every 4 minutes meanwhile: a request 5 and 9 minutes later answered in 5.1 and 3.7 s (measured once). After the 10 minutes, the next request waits for a reload. This relies on Chrome behaviour that is not documented. Rockyweb does not load the model when Chrome starts.
- While the model is loaded, Chrome's own model process holds about 5 GB of memory and 3 GB of video memory, and during the 10 minute keep Rockyweb's service worker stays running.
- Sync was checked with unit tests and a browser check that plays the part of a second computer by writing Chrome's sync storage directly. Two real computers signed in to one Google account were not tested, nor Chrome's own sync timing between them.

## Real Gemini Nano: what was verified

Checked on 2026-11-15 (third round up to 2026-11-19, loading as a user meets it on 2026-11-20) on Windows 11, Chrome 157, RTX 3080 Laptop GPU, 47 GB RAM. Details and numbers: [tests/nano/results.md](tests/nano/results.md); raw report: `tests/nano/nano-report.json`.

- **Real Nano, measured:**
  - "Describe a change" right after a Chrome start, as a user meets it (`tests/nano/user-flow.mjs`): first answer in 316.5 s on the first try, against 1430 s and 14 tries in the committed 1.1.0; the same request 5 and 9 minutes later in 5.1 and 3.7 s.
  - The service worker path with every Rockyweb page closed (`npm run test:nano` passes): article overlay hidden with exactly one model call, ordinary page zero calls, session released when idle, cold model times out cleanly and the next request within a minute is answered at once.
  - The same without a debugger on the worker: Chrome stopped the idle worker after 31 s three times, each next decision still hid the overlay (2.7 to 3.2 s from navigation), and memory stayed flat.
  - The cold start in a plain Chrome launch: 492 s for the first prompt, against 504 s with debugging, so the delay is Chrome loading the model, not the test setup.
  - "Describe a change" on 11 requests: 11 right in the final run, including "turn off ad blocking but keep blocking trackers" (only the ad blocking switch changes).
  - "Describe a change" on a wider set of 20 harder phrasings: 16 right; the 4 misses were no change or a near miss, each a preview to confirm.
  - Cookie banners no rule recognises, 21 fixtures: recall 10 of 10, precision 10 of 11 ("Skip for now" was clicked, not an accept; now filtered), 0 accept clicks, 0 navigations.
  - A 200-navigation soak: every page kind 40 of 40, 0 accepts, settle median 3.4 s, extension memory 32 to 49 MB.
  - 46 real UK and EU websites with the model warm: the banner AI never needed to act (0 attempts), 0 accepts.
  - From navigation to hidden: 2.7 to 3.2 s, down from 4.3 to 5.7 s.
  - The paired fixtures, latency and memory (first round).
- **Real Incognito window, measured:** allowed in Incognito, a private window makes no AI requests, learns no trackers, leaves no tab record in `chrome.storage.session` and nothing in the export; a normal window in the same run does all of those.
- **Model double:** the 47 automatic optimisation, Light and consent browser checks, the settings download and availability states, and `npm run perf`.
- **No model at all:** the 37 core browser checks and the greyed-out AI controls in Chromium where `LanguageModel` reports `unavailable`, and 5 checks in Chrome for Testing 116, which has no `LanguageModel` at all.
- Choices you make yourself in an Incognito window (for example a site's mode) are saved like any other choice, but never synced. Rockyweb never learns from or records private browsing on its own.
