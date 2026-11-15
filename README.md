# Rockyweb

A Manifest V3 Chrome extension that answers cookie popups with your choices, blocks ads and trackers, and lets you hide anything on a page with a click. Named after Rocky, a British cocker spaniel. Set your preferences once and get on with browsing.

The loadable extension is the **`extension/`** folder. Everything else is tooling and is not shipped.

## Install for testing

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. Pin Rockyweb to the toolbar.

Chrome 116 or newer. No build step is needed.

## Using it

- **Popup:** the site, an on/off switch, the protection mode (off, consent, balanced, strict) and live numbers.
- **Gear icon in the popup:** per-engine switches, cookie categories, an allow / cookies / block choice for every third-party domain, the element picker and a link to settings.
- **Element picker:** click to hide, arrow keys to widen or narrow, Ctrl+Z (Cmd+Z on Mac) to undo, Esc when done. Hidden elements are remembered per site.
- **Settings page:** default mode, cookie choices, custom mode, websites, learned trackers, hidden elements, and data (stats, export, import, reset).

## Automatic optimisation (optional, on-device AI)

Off by default. Turn on "automatically optimise protection for each site" on the settings page and Rockyweb quietly makes small, reversible, page-scoped adjustments where the right answer depends on context. The first one shipped: hiding an unsolicited newsletter overlay on an article, while leaving the same kind of form alone on account, login and checkout pages, when you opened it yourself, or while you are typing in it.

- **Model:** Chrome's built-in Gemini Nano through the `LanguageModel` API, run from the extension service worker (exposed there from Chrome 138, confirmed on Chrome 153). No cloud, accounts, keys or telemetry.
- **Only when needed:** cheap local rules first. The model is asked only about an overlay on an article that passed every rule and is still ambiguous; an ordinary page makes zero model calls.
- **Bounded authority:**
  - The model picks `hide_overlay` or `leave_unchanged` for one candidate ID, through a fixed JSON schema.
  - It never supplies selectors, code, URLs or network rules.
  - Low confidence, extra fields or anything stale are discarded.
  - The page is rechecked before anything is applied.
- **What the model sees:** compact signals (page type, position, field count, interaction state, a short heading treated as untrusted data). Never form values, passwords, cookies, URL query strings or history.
- **Memory:** a decision is remembered for that site and page type for 7 days, and an undo for 30 days. Both are invalidated when relevant settings change.
- **Undo:** the toolbar popup shows "automatic adjustments" with "undo" and "don't do this on this site". There are no on-page notifications.
- **Never** runs in Incognito or in Light mode, and never overrides your explicit choices (cookie categories, saved consent, site and domain choices, "newsletter prompts" set to hide or leave alone).
- **Describe a change** (popup, gear) is a separate, optional convenience: type a request, see a preview in Rockyweb's own terms, confirm, undo.

On a machine without Nano everything else works as before; the AI controls are greyed out with an explanation.

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

Everything stays in the browser (`chrome.storage.local` and `chrome.storage.session`). No servers, analytics or remote code. See [PRIVACY.md](PRIVACY.md).

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

To install Playwright: `npm i -D playwright`, then `npx playwright install chromium`.

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
- After every Chrome start, the first Gemini Nano inference took 4 to 11 minutes on the test laptop, with or without debugging. Until the model is warm the overlay is simply left alone: the first request times out after 20 s, and for the next 60 s requests are answered at once without waiting again. After that, decisions take about 1 s.
- While the model is loaded, Chrome's own model process holds about 5 GB of memory and 3 GB of video memory. Releasing Rockyweb's session does not unload it; Chrome decides when to.

## Real Gemini Nano: what was verified

Checked on 2026-11-15 on Windows 11, Chrome 157, RTX 3080 Laptop GPU, 47 GB RAM. Details and numbers: [tests/nano/results.md](tests/nano/results.md); raw report: `tests/nano/nano-report.json`.

- **Real Nano, measured:**
  - The service worker path with every Rockyweb page closed (`npm run test:nano` passes): article overlay hidden with exactly one model call, ordinary page zero calls, session released when idle, cold model times out cleanly and the next request within a minute is answered at once.
  - The same without a debugger on the worker: Chrome stopped the idle worker after 31 s three times, each next decision still hid the overlay (2.7 to 3.2 s from navigation), and memory stayed flat.
  - The cold start in a plain Chrome launch: 492 s for the first prompt, against 504 s with debugging, so the delay is Chrome loading the model, not the test setup.
  - "Describe a change" on 11 requests: 11 right in the final run, including "turn off ad blocking but keep blocking trackers" (only the ad blocking switch changes).
  - From navigation to hidden: 2.7 to 3.2 s, down from 4.3 to 5.7 s.
  - The paired fixtures, latency and memory (first round).
- **Real Incognito window, measured:** allowed in Incognito, a private window makes no AI requests, learns no trackers, leaves no tab record in `chrome.storage.session` and nothing in the export; a normal window in the same run does all of those.
- **Model double:** the 27 automatic optimisation, Light and consent browser checks, the settings download and availability states, and `npm run perf`.
- **No model at all:** the 20 core browser checks, and the greyed-out AI controls, both in Chromium where `LanguageModel` reports `unavailable`.
- Choices you make yourself in an Incognito window (for example a site's mode) are saved like any other choice. Rockyweb never learns from or records private browsing on its own.
