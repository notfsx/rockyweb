# Privacy benchmarks (measured 2026-11-20)

How much tracking Rockyweb stops on real websites and on public blocking tests, with Rockyweb off (baseline), in Balanced (the default) and in Strict. Every number on this page was **measured** in these runs unless it says otherwise. Raw output stays in `tests/sites/.out/` (not committed).

## How it was measured

- **Browser:** Playwright's Chromium 159, headless, a new profile per configuration, an ordinary Chrome user agent, `en-GB`. Baseline has no extension; Balanced and Strict load `extension/` and set the default mode.
- **Real websites:** `node tests/sites/run-sites.mjs --configs=baseline,balanced,strict` over the 46 UK and EU sites in `tests/sites/corpus.json`. Browse only: one visit per site per configuration, one site at a time, no logins, purchases or forms, and no clicks except Rockyweb's own answer to a cookie banner. Rockyweb answers banners with its default choices (necessary and functional in Balanced, reject all in Strict); the baseline leaves banners unanswered, as a user who ignores them would.
- **Ground truth for "tracker":** DuckDuckGo's Tracker Radar data (the TDS v6 extension list, CC BY-NC-SA 4.0, fetched into `tests/sites/.data/`, not committed). A request counts as a tracker when its domain, or a parent domain, is in that list's trackers. Third party means a different site and a different owner (Tracker Radar's entity data), so `bbc.co.uk` loading `bbci.co.uk` is first party.
- **Where it ran:** the test machine is in the United States. Several UK and EU sites show a different banner there, or none, so a run from the UK or EU will load different trackers (see `tests/sites/results.md`).
- **What each page records** (`tests/sites/privacy-metrics.mjs`):
  - third-party requests that loaded, and those Chrome reported blocked by an extension (`ERR_BLOCKED_BY_CLIENT`);
  - tracker requests and distinct tracker domains;
  - cookies the visit added: third-party cookies from tracker domains, and first-party analytics and ad cookies (`_ga`, `_fbp`, `_gcl_au` and similar);
  - fingerprinting: tracker scripts Tracker Radar scores 2 or 3 for fingerprinting, and scripts a probe saw reading a canvas, the WebGL renderer, an audio fingerprint or measuring many fonts;
  - link parameters: each site is opened with `utm_source`, `utm_medium`, `fbclid` and `gclid` added, and the final address is checked.
- **Public tests** (`tests/sites/run-benchmarks.mjs`):
  - adblock-tester.com: its own score out of 100, read from the page after 30 s.
  - d3ward's "toolz" ad block test: the hosted page now only says "Project Archived", so its host list (131 hosts in 6 groups, from the project's repository) was requested from a local page, counting a host as blocked when Chrome reported it blocked by an extension.
  - Not run: Cover Your Tracks (EFF) needs a click on its start button, which the browse-only rule does not allow. privacytests.org publishes results for whole browsers, not extensions, and runs its own harness; there is nothing an extension can be scored on there without running that harness, which was not done.

## Results on 43 real websites

43 of the 46 sites loaded in every configuration (zeit.de answered 403 to the test browser every time, otto.de 404 once and forbes.com 403 once). Final lists, second run, measured 2026-11-20:

| Measure (one visit per site and configuration) | No extension | Balanced | Strict |
|---|---|---|---|
| Third-party requests that loaded, median per page | 42 | 41 | 26 |
| Third-party requests that loaded, all 43 pages | 8,594 | 2,307 | 2,208 |
| Third-party requests blocked | 0 | 231 | 204 |
| Third-party requests swapped for a harmless stand-in script | 0 | 13 | 44 |
| Tracker requests that loaded, median per page | 13 | 5 | 2 |
| Tracker requests that loaded, all pages | 6,628 | 616 | 468 |
| Distinct tracker domains loaded, median per page | 3 | 2 | 1 |
| Third-party cookies set by tracker domains, all pages | 660 | 21 | 17 |
| First-party analytics and ad cookies (`_ga`, `_fbp` and similar), all pages | 60 | 28 | 16 |
| Tracker scripts Tracker Radar scores for fingerprinting (2 or 3) that loaded, all pages | 476 | 287 | 235 |
| Scripts the probe saw reading canvas, WebGL renderer, audio or many fonts, all pages | 23 | 18 | 18 |
| Pages that kept `utm_source`, `fbclid` or `gclid` in the address | 38 of 43 | 0 | 0 |
| Accept buttons pressed | 0 | 0 | 0 |

Read with care:
- Most of the drop from "no extension" comes from answering the cookie banner as well as from blocking: without an answer, many sites load their full advertising stack. The baseline is what a person who ignores banners gets.
- The Tracker Radar fingerprinting row counts scripts by their owner's score, not proof that each one fingerprinted. Which of the 235 left in Strict did what was not broken down.
- The probe saw 18 scripts reading canvas, WebGL or audio in both modes. In Strict they were mostly bot protection: Cloudflare Turnstile, AWS WAF, DataDome, and obfuscated scripts on the sites' own addresses of the kind Akamai's bot manager uses (our reading of the addresses). Sites use these to tell people from bots, and blocking them can lock people out. Two were `html-load.com` and one Adobe Launch. Rockyweb does not alter canvas, WebGL or audio, so a script allowed to load can still read them.

### First run, and what changed between the runs

The first run (same day, same sites) used the earlier lists and counted a request swapped for a stand-in script as loaded, which overstated what got through:

| Measure | Balanced, first run | Balanced, final | Strict, first run | Strict, final |
|---|---|---|---|---|
| Tracker requests that loaded, median per page | 6 | 5 | 6 | 2 |
| Tracker requests that loaded, all pages | 850 | 616 | 737 | 468 |
| Third-party cookies set by tracker domains | 55 | 21 | 61 | 17 |
| First-party analytics and ad cookies | 30 | 28 | 20 | 16 |

Between the runs:
- `tests/sites/privacy-metrics.mjs` counts a request redirected to the extension's stand-in script separately (checked with `node tests/sites/check-standins.mjs`: Google Tag Manager in Strict is swapped, not loaded).
- Balanced now blocks session recorders (Hotjar, Clarity, FullStory, Mouseflow, Smartlook, Lucky Orange, Inspectlet, Crazy Egg) and advertising conversion pixels (Bing, LinkedIn, Pinterest, Reddit, Snapchat, TikTok, X, Yahoo), which used to be in Strict only. They only track, so blocking them does not break pages.
- Both modes block the ad exchanges, verification services and audience trackers the first run saw setting cookies in Strict: TripleLift, Rubicon (1rx.io), AdMixer, StackAdapt, the Ozone Project, Unruly, DoubleVerify, RTB House, Brand Metrics, Playwire, Permutive's newer domains, Nielsen, Gemius, Dotmetrics, Parse.ly and others (the full list is in `extension/shared/filter-lists.js`).
- The Balanced column of the first run started 14 s before the last list change, so it used a list between the two.

## Public tests

| Test | No extension | Balanced | Strict |
|---|---|---|---|
| adblock-tester.com score, earlier lists | 41 | 51 | 61 |
| adblock-tester.com score, final lists | 41 (not re-run) | **58** | **61** |
| d3ward host list, earlier lists | 0 of 131 | 18 of 131 | 43 of 131 |
| d3ward host list, final lists | 0 of 131 | **84 of 131** | **84 of 131** |

d3ward by group, final lists: ads 16 of 20, analytics 29 of 30, social 20 of 20, mixed 19 of 20, error trackers 0 of 6, phone makers' telemetry 0 of 35.

## What Rockyweb still lets through, and why

Fixed in this round: the gaps above (session recorders and pixels in Balanced, ad exchanges in both modes).

Left alone on purpose:
- **Tag managers** (Google Tag Manager in Balanced, Adobe Launch and Tealium in both modes). Sites load menus, video and checkout code through them. Google Publisher Tags (both modes) and, in Strict, Google Tag Manager are swapped for stand-ins. adblock-tester counts Google Analytics in Balanced as a miss for this reason.
- **Error and performance monitoring** (Sentry, Bugsnag, New Relic, Dynatrace, Akamai mPulse, Cloudflare Web Analytics). adblock-tester counts Sentry and Bugsnag as misses, and d3ward's six error trackers are all allowed. These report crashes and slowness to the site; blocking them breaks nothing visible but leaves the site blind to its own bugs. A candidate for Strict, not done in this round.
- **Content and features:** CDNs and fonts (jsDelivr, unpkg, Cloudflare, Google Fonts), video players and embeds (YouTube, Vimeo, Google's video ad SDK), paywalls and comments (Piano and Tinypass, Viafoura), consent tools (Didomi, InMobi), recommendations (Salesforce), sign-in and chat (HubSpot on the consent vendors' own sites). Tracker Radar lists some of them because of their owners.
- **Anti-adblock re-insertion** (`html-load.com`, `html-load.cc`): it exists to put ads back for people who block them, and blocking it tends to bring up "turn off your ad blocker" walls (our judgement, not measured here), so it is left alone.
- **Image banners on the same site.** adblock-tester's Flash, GIF and image banners are files with "ad" in the path on its own domain. Rockyweb blocks by host, not by words in a path, so it does not catch these; its cosmetic rules hide many ad slots instead.
- **Phone makers' telemetry** (35 of d3ward's hosts: Xiaomi, Huawei, OnePlus, Samsung, Apple) is sent by phone software, not by web pages, so a Chrome extension is the wrong tool for it.

Not fixed, listed:
- `newsroom.bi` (Marfeel's analytics) still set cookies on 4 pages in Strict. It arrived on the same pages as Marfeel's site code (`mrf.io`), which some publishers need, so it needs a breakage check before blocking.
- thesun.co.uk could not be scrolled in Strict in both runs, with no banner showing (once in Balanced too). Not investigated further in this round.
- Fingerprinting by scripts that are allowed to load (see above).

## What was not verified

- One run per configuration per day, from one location (the United States). Sites change their advertising from visit to visit, so single numbers move between runs; the first run's Strict median of 6 against the final 2 includes the list change, the stand-in correction and that noise.
- Cover Your Tracks and privacytests.org were not run (see "How it was measured").
- The public tests ran in headless Chromium. adblock-tester's own page says some of its checks are unreliable ("unable to check" on several lines).
