# Changelog

## 1.1.1

### Changed

- **On-device AI is a deliberate opt-in.** One switch under settings, AI, off by default. Turning it on explains the memory and battery cost and needs a confirm; the model downloads only from that click. While it is on, Rockyweb keeps the model loaded so answers come in seconds, and can optionally start Chrome when you sign in.
- **First-run setup** replaces the welcome page: a short intro, then the general settings for every website (default mode, cookie popup answer, how hard Rockyweb works), already at the defaults. On a computer that can run Chrome's model, the AI switch sits at the bottom, off. Protection runs before setup is finished, and nothing is saved until done.
- Light mode greys out the AI switches and page fixes in settings, and its info text says what it turns off.
- The popup's error state shows Rocky with his dropped tennis ball.

### Fixed

- "Describe a change" no longer shows "Not supported: a protection change you did not ask for" next to a good page change. The unasked change is still removed.
- When "describe a change" finds nothing it can do, it says so plainly instead of "That does not seem to ask for any change".

## 1.1.0

### New

- **Page changes.** "Describe a change" can now change how a page looks, not only settings: hide, keep in place, text size, width, line spacing, colours, font, stop animations, let the page scroll, stop videos playing by themselves. Shown live on the page before you apply, saved per website, applied again on every visit, and never asked twice. Every change is listed under "changes on this site" in the popup and "page changes" in settings, with on, off and delete.
- **Page fixes.** Rockyweb notices app download bars, floating video players, tall headers that follow you, promotional bars fixed to the screen and pages that will not scroll, and suggests a fix (or applies the obvious ones in automatic mode). Never on cookie notices, sign-in, payment, paywalls or anti-adblock messages.
- **Automatic optimisation** with Chrome's on-device model (Gemini Nano), off by default: hides unsolicited newsletter overlays on articles, and answers cookie banners no rule recognises, only ever with a refusal.
- **Light mode** for slower computers.
- **Welcome page** on a fresh install: what already works without setup, and, only when this computer can run Chrome's on-device model, an offer to download it. Nothing downloads until you click.
- Settings in the toolbar popup open from a gear button, and the settings page is split into pages.
- **Sync with Chrome**, off by default (settings, data): your settings, per-site modes and saved page changes follow you to your other computers through Chrome sync. Learned trackers, statistics and anything changed in Incognito are never synced. Changes made on two computers are merged per setting, per site and per page change, and the newer one wins.
- Every AI feature (automatic optimisation, describe a change, page fixes and the welcome page's AI offer) carries a small "experimental" label.
- In Protection, the facts under each mode ("annoyances: shown") are buttons: click one to change it, and the mode becomes custom.
- A link to the source code on GitHub, on the welcome page and in settings, about.

### Changed

- The corner note after a cookie banner is one quiet line in Rockyweb's own style ("rockyweb  cookies refused · OneTrust"), and no longer names a "Generic" platform.
- "Describe a change" can point at more of the page: named blocks such as comments, newsletter boxes, related stories and sidebars built from plain boxes, including ones further down the page.
- When the on-device model gives an answer Rockyweb cannot use, the popup asks once more before reporting it.
- Loading the on-device model: the service worker now loads it once and never cuts the load short, so closing the popup or trying again no longer starts the load from the beginning. On our test laptop the first answer after a Chrome start came after 336 s instead of 1430 s (measured). After each "describe a change" Rockyweb keeps the model loaded for 10 minutes, so the next request within that time answers in seconds. While Chrome loads, the popup says how long it has been loading and that you can close it.
- Blocking in Balanced also covers session recorders (Hotjar, Microsoft Clarity, FullStory, Mouseflow and similar) and advertising conversion pixels (Bing, LinkedIn, Pinterest, Reddit, Snapchat, TikTok, X and Yahoo). These only track, so blocking them does not break pages. Tag managers, Facebook's SDK and share buttons stay in Strict. Balanced and Strict also block more ad exchanges and audience trackers that were seen loading on real news sites (TripleLift, Ozone, StackAdapt, Permutive and others).
- "Describe a change" checks the model's answer against your words before showing it. A hide aimed at a part of the page your request does not mention (the chat button when you asked about a sign-in box) is moved to the part that matches, or dropped with a note. Common slips are corrected: "smaller" never makes text bigger, "black and white" gives grey, animations are stopped instead of videos paused, and something that follows you down the page is kept in place.
- A model answer that runs on is cut off after 12 seconds and asked once more, instead of holding the popup for half a minute.
- The on-device model runs with less randomness (temperature 0.3, top-K 3), since every answer is a pick from a fixed list. A Chrome that does not allow it gets its own defaults.
- Long setting descriptions show one short line; the rest is behind an "i" button that opens on hover, focus, tap or click and is read by screen readers.
- Example text in input boxes is fainter: after you have used a box once it shows a short hint instead of the full example, and after twice nothing.
- One type scale for the popup, settings, welcome page and the on-page note, with no one-off font sizes.
- The popup's cookie line names the consent platform as it is written ("cookies · OneTrust"), and says "cookie popup" when the platform is unknown.

### Fixed

- Cookie banners: refusals worded as "Reject analytics cookies", "No, thanks" and similar are found; buttons named as accepts in their attributes are never pressed; banners drawn in an address-less frame are answered; a settings layer that cannot be finished is closed and the banner refused, never left open; banners you opened yourself are left alone.
- The toolbar no longer loses a cookie answer when Chrome restarts the service worker during a page load.
- The element picker, page load delay and several Incognito and upgrade cases.
- "Describe a change" no longer adds a protection change (a mode, ad blocking or cookie popups) to a request that says nothing about protection. The preview showed it and nothing applied without your confirmation, but it was not what you asked for.
- A page change described after a long model load no longer loses its target: the page outline is read again.

## 1.0.0

First version: cookie popups answered with your choices, ad and tracker blocking, tracker learning, per-site modes and the element picker.
