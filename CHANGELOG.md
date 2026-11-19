# Changelog

## 1.1.0 (not yet published)

### New

- **Page changes.** "Describe a change" can now change how a page looks, not only settings: hide, keep in place, text size, width, line spacing, colours, font, stop animations, let the page scroll, stop videos playing by themselves. Shown live on the page before you apply, saved per website, applied again on every visit, and never asked twice. Every change is listed under "changes on this site" in the popup and "page changes" in settings, with on, off and delete.
- **Page fixes.** Rockyweb notices app download bars, floating video players, tall headers that follow you, promotional bars fixed to the screen and pages that will not scroll, and suggests a fix (or applies the obvious ones in automatic mode). Never on cookie notices, sign-in, payment, paywalls or anti-adblock messages.
- **Automatic optimisation** with Chrome's on-device model (Gemini Nano), off by default: hides unsolicited newsletter overlays on articles, and answers cookie banners no rule recognises, only ever with a refusal.
- **Light mode** for slower computers.
- **Welcome page** on a fresh install: what already works without setup, and, only when this computer can run Chrome's on-device model, an offer to download it. Nothing downloads until you click.
- Settings in the toolbar popup open from a gear button, and the settings page is split into pages.

### Changed

- The corner note after a cookie banner is one quiet line in Rockyweb's own style ("rockyweb  cookies refused · OneTrust"), and no longer names a "Generic" platform.
- "Describe a change" can point at more of the page: named blocks such as comments, newsletter boxes, related stories and sidebars built from plain boxes, including ones further down the page.
- When the on-device model gives an answer Rockyweb cannot use, the popup asks once more before reporting it. If Chrome is still loading the model after starting, the popup says so instead of "took too long".
- "Describe a change" checks the model's answer against your words before showing it. A hide aimed at a part of the page your request does not mention (the chat button when you asked about a sign-in box) is moved to the part that matches, or dropped with a note. Common slips are corrected: "smaller" never makes text bigger, "black and white" gives grey, animations are stopped instead of videos paused, and something that follows you down the page is kept in place.
- A model answer that runs on is cut off after 12 seconds and asked once more, instead of holding the popup for half a minute.
- The on-device model runs with less randomness (temperature 0.3, top-K 3), since every answer is a pick from a fixed list. A Chrome that does not allow it gets its own defaults.
- The popup's cookie line names the consent platform as it is written ("cookies · OneTrust"), and says "cookie popup" when the platform is unknown.

### Fixed

- Cookie banners: refusals worded as "Reject analytics cookies", "No, thanks" and similar are found; buttons named as accepts in their attributes are never pressed; banners drawn in an address-less frame are answered; a settings layer that cannot be finished is closed and the banner refused, never left open; banners you opened yourself are left alone.
- The toolbar no longer loses a cookie answer when Chrome restarts the service worker during a page load.
- The element picker, page load delay and several Incognito and upgrade cases.

## 1.0.0

First version: cookie popups answered with your choices, ad and tracker blocking, tracker learning, per-site modes and the element picker.
