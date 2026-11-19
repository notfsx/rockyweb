# Rockyweb privacy policy

Effective 19 November 2026.

Rockyweb is a browser extension that answers cookie popups, blocks ads and trackers, and hides page elements you choose. It is built so that nothing about you or your browsing leaves your device.

## What Rockyweb stores, and where

Everything is stored in your browser with Chrome's extension storage. Nothing is sent to the developer or to anyone else.

| Data | Why | Where |
|---|---|---|
| Your settings (protection mode, cookie choices, switches) | To apply your choices | `chrome.storage.local` on your device |
| Websites you gave their own mode, domain choices or hidden elements | To remember per-site settings | `chrome.storage.local` |
| Third-party domains seen tracking you, and the websites they were seen on (at most 12 per domain) | To learn which domains follow you between sites | `chrome.storage.local` |
| Counts of popups handled, ads blocked and trackers stopped | To show you statistics | `chrome.storage.local` |
| Per-tab activity for the open page (third-party domains, counts, automatic adjustments) | To show the popup's numbers, domain list and undo | `chrome.storage.session`, cleared when the browser closes; never written for private tabs |
| Page changes: what you asked for in your own words (at most 200 characters), the changes Rockyweb made from it (for example "hide" plus a CSS selector it generated, or a text size), and the settings it changed with their earlier values; page fixes you applied or that were applied for you | To apply them again on your next visit, to list them in the toolbar and on the settings page, and to switch them off or delete them | `chrome.storage.local`; at most 30 per website, kept until you delete them, included in the export |
| Page fixes suggested for the open page, and edits a page check skipped | To show them in the toolbar | `chrome.storage.session` with the tab's other activity |
| Automatic optimisation memory: per website, a short fingerprint of an overlay (tool name, class names, field count) and whether it was hidden or undone; for a cookie banner, a fingerprint of its refusal-like button labels and the label that was clicked | To avoid asking the model again, to click the same button next time, and to honour your undo | `chrome.storage.local`; decisions expire after 7 days, undos after 30 |

You can see, export, reset or delete all of it from the settings page (data, reset everything). Removing the extension deletes it too.

## On-device AI (optional, off by default)

If you turn on automatic optimisation, Rockyweb uses Chrome's built-in model (Gemini Nano), which runs entirely on your device. Chrome downloads and stores the model; Rockyweb starts that download only after you choose to. It is asked about the following only:

- **An overlay on an article.** It receives a few facts about that one overlay (page type, position, number of fields, whether you interacted with it, and a short heading from the page).
- **A cookie banner no built-in rule recognised.** It receives the banner's heading, the page language, how many buttons it has, and the labels of the buttons that might refuse cookies. Buttons that accept, open settings, save, subscribe, pay, sign in or leave the page are removed before the model sees anything, so it can never pick one. It answers with one of those buttons or "leave it".

When you use **describe a change** (toolbar, gear) with page changes allowed, the model also receives an outline of the open page: up to 30 notable elements (for example "fixed bottom bar, 9% of screen"), each with a short label of at most 60 characters copied from the page, and your request. It answers with changes from a fixed list (hide, keep in place, text size, width, line spacing, colours, font, stop animations, let the page scroll, stop videos playing by themselves) and element numbers from that outline. It never writes code, CSS or selectors: Rockyweb builds those itself, checks them, and never hides the main content, the page itself or a form you are using.

**Page fixes** (settings, protection) are found by local rules, not the model. Only when page fixes are set to automatic and automatic optimisation is on, the model is asked about the less obvious ones, with the kind of fix, its position, its size on screen and a short label from the page. Page fixes never touch cookie notices, sign-in, payment, paywalls or anti-adblock messages.

It never receives what you typed into the page, form values, passwords, cookies, page addresses or your browsing history. Nothing is sent to Rockyweb or anyone else. Automatic optimisation and page fixes never run in Incognito or in Light mode, and "describe a change" is not offered there.

## What Rockyweb does not do

- It makes no network requests of its own. There is no server.
- It has no analytics, telemetry, crash reporting or advertising.
- It does not sell, share or transfer any data.
- It does not load or run remote code.
- It does not read page content beyond what is needed to find and answer cookie popups, hide the elements you choose, apply element hiding rules and page changes, find page fixes, and build the page outline when you describe a change.

## Permissions

| Permission | Used for |
|---|---|
| Access to all websites | Answering cookie popups, hiding ads and the elements you pick, and blocking trackers works on any site you visit. |
| `declarativeNetRequest` | Blocking ad and tracker requests, removing tracking cookies and tracking parameters, with rules evaluated by Chrome itself. |
| `webRequest` (observe only) | Noticing which third-party domains set or send tracking cookies, so trackers can be learned locally. Requests are never modified or delayed through this permission. |
| `scripting` | Applying your cookie choices through a consent platform's own controls, and injecting element hiding and page change styles. |
| (no permission) Chrome's built-in AI | Optional automatic optimisation and "describe a change". The `LanguageModel` API needs no extension permission. |
| `storage` | Saving your settings and the data listed above on your device. |

## Changes

If this policy changes, the new version will be published with the extension update that needs it, with a new effective date.

## Contact

Questions or requests can be sent through the support link on Rockyweb's Chrome Web Store listing.
