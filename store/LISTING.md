# Chrome Web Store submission

Everything needed to publish Rockyweb. Text here is ready to paste into the developer dashboard.

## 1. Package

```bash
npm run package
```

Upload `dist/rockyweb-1.1.1.zip`. The script runs the verification checks first and leaves out Chrome's `_metadata` cache.

## 2. Store listing

**Name** (from the manifest): Rockyweb: Cookie Consent, Ad and Tracker Blocker

**Summary** (132 characters max, from the manifest): Answers cookie popups with your choices, blocks ads and learns trackers, with per-site modes so websites keep working.

**Category:** Privacy & Security

**Language:** English

**Homepage URL:** https://github.com/notfsx/rockyweb

**Support URL:** https://github.com/notfsx/rockyweb/issues

**Description:**

```
Rockyweb makes browsing quieter. Choose your preferences once and get on with it. It's named after Rocky, a British cocker spaniel who never let a stranger past the door.

COOKIE POPUPS, ANSWERED YOUR WAY
Pick once which cookies you allow (functional, analytics, marketing). Rockyweb answers cookie popups for you on every site, using the consent platform's own controls when it can (OneTrust, Cookiebot, Didomi, Usercentrics and more) and clicking the right buttons on dozens of others. Pages that were left unscrollable are fixed automatically.

ADS AND TRACKERS, BLOCKED
Known ad networks, analytics domains, session recorders and advertising pixels are blocked with Chrome's built-in request blocking. Rockyweb also learns: a third-party domain that follows you to three or more sites loses its cookies, or is blocked entirely in strict mode. Payment, login and captcha providers are never restricted, so checkouts and sign-ins keep working.

ONE SWITCH PER SITE
Every site gets a simple on/off switch and five modes: off, consent only, balanced (the default), strict, or your own custom mix. Something broken? Turn the site down a notch and carry on. The gear icon opens per-engine switches and an allow / cookies / block choice for every third-party domain on the page.

ON-DEVICE AI, FOR POWERFUL COMPUTERS (OPTIONAL, EXPERIMENTAL)
Off by default, and everything else works without it. If you turn it on in settings, Rockyweb uses Gemini Nano, the model Chrome runs on your computer, and keeps it loaded from the moment Chrome starts so answers come quickly. That keeps several gigabytes of memory busy and uses more battery, so it suits a desktop or a laptop on mains power, not a low-powered computer or light browsing. Optionally, Chrome can start when you sign in so the model is ready before you open a window.

QUIETLY OPTIMISED FOR EACH SITE (OPTIONAL, EXPERIMENTAL)
With on-device AI on, turn on automatic optimisation and Rockyweb uses Chrome's on-device AI for two small jobs. On articles you are reading, it can hide an unsolicited newsletter overlay that covers the story; on every other kind of page (shops, sign-in, checkout, search, apps) overlays are left as they are. And when a cookie banner is one Rockyweb's built-in rules do not recognise, it can find the button that refuses, following your cookie choices; buttons that accept, open settings, subscribe or pay are removed before the AI sees anything, so it can never pick them. It never interrupts you, every change is listed in the toolbar (overlays can be undone; a banner answer points you to the site's own cookie settings), and nothing leaves your device. Needs a computer that supports Chrome's built-in AI; while the model is still loading, overlays are simply left alone.

DESCRIBE A CHANGE, AND IT STAYS (EXPERIMENTAL)
Type what bothers you ("make the text bigger and hide the sticky header", "dark colours on this site") and Rockyweb shows the change live on the page before you confirm. It can hide parts of the page, unstick headers, resize text, narrow wide columns, change colours and fonts, stop animations and pause autoplaying video, going beyond the settings menus. Every change is saved for that site, listed in the toolbar with a switch and a delete button, and reapplied on your next visit, so you never describe the same change twice. A safety check skips any saved change that would hide the main content or a form you are using, and cookie notices, sign-in, payment and age checks are never touched.

PAGE FIXES, SUGGESTED OR AUTOMATIC (EXPERIMENTAL)
Rockyweb spots common annoyances (an "open in app" bar, a video that follows you down the page, a page that will not scroll, an oversized sticky header) and suggests a one-click fix. Switch to automatic and the sure ones are fixed as the page loads. Every fix can be undone, and a fix you dismiss is never suggested again.

LIGHT MODE
Uses less of your computer. Turns off on-device AI, page fixes, tracker learning and deep page scanning. Blocking, link cleaning and your site settings stay.

HIDE ANYTHING WITH A CLICK
Point at a banner, click, done. Rockyweb remembers it for that site. Undo is one key away.

PRIVATE BY DESIGN
Everything stays in your browser. No servers, no accounts, no analytics, no remote code. Want the same settings on another computer? Turn on Chrome sync in settings (off by default): your settings and saved page changes travel through your own Google account, while learned trackers, statistics and anything from Incognito stay on this computer.
```

## 3. Images (in this folder)

| Asset | File |
|---|---|
| Store icon, 128x128 | `store/icon-128.png` |
| Screenshots, 1280x800 (the Store takes at most 5) | `store/screenshots/1-cookie-banners.png`, `2-one-switch.png`, `3-hide-an-element.png`, `4-modes.png`, `5-trackers.png`, in that order |
| Small promo tile, 440x280 | `store/promo-small-440x280.png` |
| Marquee promo tile, 1400x560 | `store/promo-marquee-1400x560.png` |

Regenerate them with `npm run store:assets` after UI changes.

## 4. Privacy practices tab

**Single purpose:**

```
Rockyweb protects privacy while browsing: it answers cookie consent popups with the user's saved choices, blocks ads and trackers, and hides or restyles page elements the user selects or describes, with per-site controls.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `declarativeNetRequest` | Blocks ad and tracker requests, strips cookies from learned trackers and removes tracking parameters from links, using declarative rules evaluated by Chrome. |
| `scripting` | Applies the user's cookie choices through a consent platform's JavaScript API on the current page, and injects CSS that hides ads and elements the user picked, and applies the per-site page changes the user confirmed (hide, unstick, text size, colours, fonts). The CSS is built by the extension from a fixed list of operations; no page or model supplies code. |
| `storage` | Saves the user's settings, per-site choices, learned tracker domains and statistics locally. Only if the user turns on sync in settings (off by default), a copy of the settings, per-site choices and saved page changes is kept in `chrome.storage.sync` so Chrome can copy it to the user's other computers. |
| `webRequest` | Observes (never modifies) third-party requests to detect domains that set or send tracking cookies across sites, so they can be learned locally, and counts blocked requests for the toolbar badge. |
| `alarms` | Only while the user has turned on on-device AI with "keep the model loaded": a one-minute alarm restarts the service worker and reloads Chrome's on-device model if Chrome stopped them, so the model stays ready as the user asked. With AI off, the alarm is cleared. |
| Optional `background` (requested only from a switch the user turns on) | Lets Chrome start when the user signs in to their computer, so the on-device model the user turned on is loaded before they browse. Requested only from the settings page after the user turns on on-device AI, and removed when they turn it off. |
| Host permission `<all_urls>` | Cookie popups, ads and trackers appear on any website, so the content script, CSS injection and request rules must be able to run on every site the user visits. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension. The optional AI feature uses Chrome's built-in on-device model through the `LanguageModel` API; no model or code is fetched by the extension.

**Data usage:** Rockyweb does not collect or transmit user data. The optional on-device AI receives a few structural facts about one page overlay, or the heading and refusal-like button labels of one cookie banner, or, when the user describes a change, a short outline of the visible page parts (element kind, size, position and a few words of text), and runs entirely in Chrome on the user's device. The model only chooses from a fixed list of operations; it never writes selectors, CSS or script. Browsing-related data (third-party domains and the sites they were seen on) is processed and stored only on the user's device, to provide the tracker-learning feature. Optional sync, off by default and turned on by the user in settings, stores the user's settings, per-site choices and saved page changes in `chrome.storage.sync`, which Chrome copies between the user's own computers through their Google account; the developer has no server and never receives it. Learned trackers, statistics and anything changed in Incognito are never synced. If the dashboard's definitions lead you to declare it anyway, tick "Web history" and state that it never leaves the device. Then certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/notfsx/rockyweb/blob/main/PRIVACY.md (works once the repository is public).

## 5. Notes for the reviewer (optional field)

```
No login needed. A setup tab opens once after install: a short intro, then the general settings (default mode, cookie popup answer, how hard Rockyweb works), already at the defaults. Protection runs before setup is finished. On-device AI is off by default; on a computer that can run Chrome's model, setup shows its switch at the bottom, and turning it on there or under settings, AI, goes through an explanation of its memory and battery cost and a confirm step. Nothing downloads until that confirm is clicked. To test: open any news site with a cookie banner; Rockyweb answers it quietly; the toolbar badge and popup show what it did (an on-page confirmation can be turned on in settings). Click the toolbar icon for the per-site switch and modes; the gear icon shows advanced controls and "hide an element". "Describe a change" and page fixes need Chrome's built-in AI and only change how a page looks; each change is listed under "changes on this site" with a switch and a delete button. Settings live on the options page.
```

## 6. Before you submit

- [x] `npm run check`, `npm run test:e2e`, `npm run test:a11y` and `npm run test:upgrade` pass (2026-11-28, for 1.1.1)
- [x] `npm run test:nano` passes on a machine with Chrome's on-device AI (real model, all Rockyweb pages closed; 2026-11-20, see `tests/nano/results.md`)
- [x] Version in `extension/manifest.json` bumped for every new upload (1.1.1)
- [ ] Repository public, so the privacy policy URL opens
- [ ] Developer account has a verified contact email
