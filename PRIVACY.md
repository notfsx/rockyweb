# Rockyweb privacy policy

Effective 14 November 2026.

Rockyweb is a browser extension that answers cookie popups, blocks ads and trackers, and hides page elements you choose. It is built so that nothing about you or your browsing leaves your device.

## What Rockyweb stores, and where

Everything is stored in your browser with Chrome's extension storage. Nothing is sent to the developer or to anyone else.

| Data | Why | Where |
|---|---|---|
| Your settings (protection mode, cookie choices, switches) | To apply your choices | `chrome.storage.local` on your device |
| Websites you gave their own mode, domain choices or hidden elements | To remember per-site settings | `chrome.storage.local` |
| Third-party domains seen tracking you, and the websites they were seen on (at most 12 per domain) | To learn which domains follow you between sites | `chrome.storage.local` |
| Counts of popups handled, ads blocked and trackers stopped | To show you statistics | `chrome.storage.local` |
| Per-tab activity for the open page (third-party domains, counts) | To show the popup's numbers and domain list | `chrome.storage.session`, cleared when the browser closes |

You can see, export, reset or delete all of it from the settings page (data, reset everything). Removing the extension deletes it too.

## What Rockyweb does not do

- It makes no network requests of its own. There is no server.
- It has no analytics, telemetry, crash reporting or advertising.
- It does not sell, share or transfer any data.
- It does not load or run remote code.
- It does not read page content beyond what is needed to find and answer cookie popups, hide the elements you choose, and apply element hiding rules.

## Permissions

| Permission | Used for |
|---|---|
| Access to all websites | Answering cookie popups, hiding ads and the elements you pick, and blocking trackers works on any site you visit. |
| `declarativeNetRequest` | Blocking ad and tracker requests, removing tracking cookies and tracking parameters, with rules evaluated by Chrome itself. |
| `webRequest` (observe only) | Noticing which third-party domains set or send tracking cookies, so trackers can be learned locally. Requests are never modified or delayed through this permission. |
| `scripting` | Applying your cookie choices through a consent platform's own controls, and injecting element hiding styles. |
| `storage` | Saving your settings and the data listed above on your device. |

## Changes

If this policy changes, the new version will be published with the extension update that needs it, with a new effective date.

## Contact

Questions or requests can be sent through the support link on Rockyweb's Chrome Web Store listing.
