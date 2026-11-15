# Chrome Web Store submission

Everything needed to publish Rockyweb. Text here is ready to paste into the developer dashboard.

## 1. Package

```bash
npm run package
```

Upload `dist/rockyweb-1.1.0.zip`. The script runs the verification checks first and leaves out Chrome's `_metadata` cache.

## 2. Store listing

**Name** (from the manifest): Rockyweb: Cookie Consent, Ad and Tracker Blocker

**Summary** (132 characters max, from the manifest): Answers cookie popups with your choices, blocks ads and learns trackers, with per-site modes so websites keep working.

**Category:** Privacy & Security

**Language:** English

**Description:**

```
Rockyweb makes browsing quieter. Choose your preferences once and get on with it. It's named after Rocky, a British cocker spaniel who never let a stranger past the door.

COOKIE POPUPS, ANSWERED YOUR WAY
Pick once which cookies you allow (functional, analytics, marketing). Rockyweb answers cookie popups for you on every site, using the consent platform's own controls when it can (OneTrust, Cookiebot, Didomi, Usercentrics and more) and clicking the right buttons on dozens of others. Pages that were left unscrollable are fixed automatically.

ADS AND TRACKERS, BLOCKED
Known ad networks and analytics domains are blocked with Chrome's built-in request blocking. Rockyweb also learns: a third-party domain that follows you to three or more sites loses its cookies, or is blocked entirely in strict mode. Payment, login and captcha providers are never restricted, so checkouts and sign-ins keep working.

ONE SWITCH PER SITE
Every site gets a simple on/off switch and five modes: off, consent only, balanced (the default), strict, or your own custom mix. Something broken? Turn the site down a notch and carry on. The gear icon opens per-engine switches and an allow / cookies / block choice for every third-party domain on the page.

QUIETLY OPTIMISED FOR EACH SITE (OPTIONAL)
Turn on automatic optimisation once and Rockyweb uses Chrome's on-device AI on articles you are reading: it can hide an unsolicited newsletter overlay that covers the story. On every other kind of page (shops, sign-in, checkout, search, apps) the AI is never asked and overlays are left as they are. It never interrupts you, every change can be undone from the toolbar, and nothing leaves your device. Needs a computer that supports Chrome's built-in AI; the first article after Chrome starts can take a few minutes while Chrome loads the model, and until then overlays are simply left alone. Everything else works without it.

LIGHT MODE
Uses less of your computer. Blocking, link cleaning and your site settings stay; tracker learning, AI and deep page scanning pause.

HIDE ANYTHING WITH A CLICK
Point at a banner, click, done. Rockyweb remembers it for that site. Undo is one key away.

PRIVATE BY DESIGN
Everything stays in your browser. No servers, no accounts, no analytics, no remote code.
```

## 3. Images (in this folder)

| Asset | File |
|---|---|
| Store icon, 128x128 | `store/icon-128.png` |
| Screenshots, 1280x800 | `store/screenshots/1-cookie-popups.png` to `5-trackers.png` |
| Small promo tile, 440x280 | `store/promo-small-440x280.png` |
| Marquee promo tile, 1400x560 | `store/promo-marquee-1400x560.png` |

Regenerate them with `npm run store:assets` after UI changes.

## 4. Privacy practices tab

**Single purpose:**

```
Rockyweb protects privacy while browsing: it answers cookie consent popups with the user's saved choices, blocks ads and trackers, and hides page elements the user selects, with per-site controls.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `declarativeNetRequest` | Blocks ad and tracker requests, strips cookies from learned trackers and removes tracking parameters from links, using declarative rules evaluated by Chrome. |
| `scripting` | Applies the user's cookie choices through a consent platform's JavaScript API on the current page, and injects CSS that hides ads and elements the user picked. |
| `storage` | Saves the user's settings, per-site choices, learned tracker domains and statistics locally. |
| `webRequest` | Observes (never modifies) third-party requests to detect domains that set or send tracking cookies across sites, so they can be learned locally, and counts blocked requests for the toolbar badge. |
| Host permission `<all_urls>` | Cookie popups, ads and trackers appear on any website, so the content script, CSS injection and request rules must be able to run on every site the user visits. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension. The optional AI feature uses Chrome's built-in on-device model through the `LanguageModel` API; no model or code is fetched by the extension.

**Data usage:** Rockyweb does not collect or transmit user data. The optional on-device AI receives a few structural facts about one page overlay and runs entirely in Chrome on the user's device. Browsing-related data (third-party domains and the sites they were seen on) is processed and stored only on the user's device, to provide the tracker-learning feature. If the dashboard's definitions lead you to declare it anyway, tick "Web history" and state that it never leaves the device. Then certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** publish `PRIVACY.md` somewhere public (the repository is private), for example as a GitHub Pages page or a public gist, and paste that URL.

## 5. Notes for the reviewer (optional field)

```
No login needed. To test: open any news site with a cookie banner; Rockyweb answers it quietly; the toolbar badge and popup show what it did (an on-page confirmation can be turned on in settings). Click the toolbar icon for the per-site switch and modes; the gear icon shows advanced controls and "hide an element". Settings live on the options page.
```

## 6. Before you submit

- [x] `npm run check` and `npm run test:e2e` pass (2026-11-15, for 1.1.0)
- [x] `npm run test:nano` passes on a machine with Chrome's on-device AI (real model, all Rockyweb pages closed; 2026-11-15, see `tests/nano/results.md`)
- [ ] Version in `extension/manifest.json` bumped for every new upload
- [ ] Privacy policy published and linked
- [ ] Developer account has a verified contact email
