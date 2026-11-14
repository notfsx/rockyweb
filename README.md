# Rockyweb

A Manifest V3 Chrome extension that answers cookie popups with your choices, blocks ads and trackers, and lets you hide anything on a page with a click. Named after Rocky, a cocker spaniel.

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
npm run store:assets   # regenerate the store screenshots and promo tiles (needs Playwright)
```

To install Playwright: `npm i -D playwright`, then `npx playwright install chromium`.

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
