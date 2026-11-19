# Changelog

## 1.1.0 (not yet published)

### New

- **Page changes.** "Describe a change" can now change how a page looks, not only settings: hide, keep in place, text size, width, line spacing, colours, font, stop animations, let the page scroll, stop videos playing by themselves. Shown live on the page before you apply, saved per website, applied again on every visit, and never asked twice. Every change is listed under "changes on this site" in the popup and "page changes" in settings, with on, off and delete.
- **Page fixes.** Rockyweb notices app download bars, floating video players, tall headers that follow you, promotional bars fixed to the screen and pages that will not scroll, and suggests a fix (or applies the obvious ones in automatic mode). Never on cookie notices, sign-in, payment, paywalls or anti-adblock messages.
- **Automatic optimisation** with Chrome's on-device model (Gemini Nano), off by default: hides unsolicited newsletter overlays on articles, and answers cookie banners no rule recognises, only ever with a refusal.
- **Light mode** for slower computers.
- Settings in the toolbar popup open from a gear button, and the settings page is split into pages.

### Fixed

- Cookie banners: refusals worded as "Reject analytics cookies", "No, thanks" and similar are found; buttons named as accepts in their attributes are never pressed; banners drawn in an address-less frame are answered; a settings layer that cannot be finished is closed and the banner refused, never left open; banners you opened yourself are left alone.
- The toolbar no longer loses a cookie answer when Chrome restarts the service worker during a page load.
- The element picker, page load delay and several Incognito and upgrade cases.

## 1.0.0

First version: cookie popups answered with your choices, ad and tracker blocking, tracker learning, per-site modes and the element picker.
