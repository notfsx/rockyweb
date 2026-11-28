# Rockyweb privacy policy

Effective 28 November 2026.

Rockyweb is a browser extension that answers cookie popups, blocks ads and trackers, and hides page elements you choose. It is built so that nothing about you or your browsing leaves your device. The one exception is optional and off by default: if you turn on Chrome sync in Rockyweb, your settings and page changes are copied to your other computers through your own Google account (see below).

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
| How many times you have used each input box (a number up to 99, for three boxes) | To shorten the example text once you know the box | `chrome.storage.local`; not synced, not exported |
| Page fixes suggested for the open page, and edits a page check skipped | To show them in the toolbar | `chrome.storage.session` with the tab's other activity |
| Automatic optimisation memory: per website, a short fingerprint of an overlay (tool name, class names, field count) and whether it was hidden or undone; for a cookie banner, a fingerprint of its refusal-like button labels and the label that was clicked | To avoid asking the model again, to click the same button next time, and to honour your undo | `chrome.storage.local`; decisions expire after 7 days, undos after 30 |

You can see, export, reset or delete all of it from the settings page (data, reset everything). Removing the extension deletes it too.

## Chrome sync (optional, off by default)

If you turn on "sync with Chrome" (settings, data), Rockyweb saves a copy of some of your data in `chrome.storage.sync`. Chrome then copies it, through the Google account you are signed in to Chrome with, to your other computers where Rockyweb is installed and sync is on. Google handles that copy under its own terms; Rockyweb never sees it on any server, because it has none. If you are not signed in to Chrome, or Chrome sync is off, the copy stays on this computer.

What is copied:

- your protection mode and custom settings, including your cookie choices;
- your choice for page changes and page fixes;
- websites you gave their own mode, domain choices or hidden elements;
- page changes and page fixes you saved, with what you asked for in your own words.

What is never copied: trackers Rockyweb learned (and the websites they were seen on), statistics, per-tab activity, the automatic optimisation memory, whether automatic optimisation is on, and anything you changed in an Incognito window. A random device code (16 letters and numbers, not linked to you) is stored with the copy so each computer can ignore its own changes.

The copy is limited to about 96 KB, below Chrome's limit. If your data is larger, the websites changed longest ago are left out of the copy (they stay on this computer) and the settings page says how many. Turning sync off stops copying; "remove the synced copy" also deletes the copy from your Google account, without touching what is on this computer.

## On-device AI (optional, off by default)

If you turn on on-device AI (settings, AI), Rockyweb uses Chrome's built-in model (Gemini Nano), which runs entirely on your device. While it is on, Rockyweb keeps the model loaded in Chrome, which uses memory and battery on your computer but sends nothing anywhere. Chrome downloads and stores the model; Rockyweb starts that download only after you choose to. It is asked about the following only:

- **An overlay on an article.** It receives a few facts about that one overlay (page type, position, number of fields, whether you interacted with it, and a short heading from the page).
- **A cookie banner no built-in rule recognised.** It receives the banner's heading, the page language, how many buttons it has, and the labels of the buttons that might refuse cookies. Buttons that accept, open settings, save, subscribe, pay, sign in or leave the page are removed before the model sees anything, so it can never pick one. It answers with one of those buttons or "leave it".

When you use **describe a change** (toolbar, gear) with page changes allowed, the model also receives an outline of the open page: up to 30 notable elements (for example "fixed bottom bar, 9% of screen"), each with a short label of at most 60 characters copied from the page, and your request. It answers with changes from a fixed list (hide, keep in place, text size, width, line spacing, colours, font, stop animations, let the page scroll, stop videos playing by themselves) and element numbers from that outline. It never writes code, CSS or selectors: Rockyweb builds those itself, checks them, and never hides the main content, the page itself or a form you are using.

**Page fixes** (settings, protection) are found by local rules, not the model. Only when page fixes are set to automatic and automatic optimisation is on, the model is asked about the less obvious ones, with the kind of fix, its position, its size on screen and a short label from the page. Page fixes never touch cookie notices, sign-in, payment, paywalls or anti-adblock messages.

It never receives what you typed into the page, form values, passwords, cookies, page addresses or your browsing history. Nothing is sent to Rockyweb or anyone else. Automatic optimisation and page fixes never run in Incognito or in Light mode, and "describe a change" is not offered there.

## What Rockyweb does not do

- It makes no network requests of its own. There is no server. (Chrome sync, if you turn it on, is Chrome's own service.)
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
| (no permission) Chrome's built-in AI | Optional on-device AI: automatic optimisation and "describe a change". The `LanguageModel` API needs no extension permission. |
| `alarms` | Only with on-device AI on and "keep the model loaded": a one-minute alarm that reloads the model if Chrome stopped it. |
| `background` (optional, only if you turn on "start Chrome when you sign in") | Lets Chrome start when you sign in to your computer, so the model is ready. Removed when you turn on-device AI off. |
| `storage` | Saving your settings and the data listed above on your device, and, only if you turn sync on, a copy of your settings in Chrome sync. |

## Changes

If this policy changes, the new version will be published with the extension update that needs it, with a new effective date.

## Contact

Questions or requests can be sent through the support link on Rockyweb's Chrome Web Store listing.
