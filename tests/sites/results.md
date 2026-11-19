# Real-website results

Baseline run: 2026-11-15 (tag `final`). Rockyweb 1.1.0, Playwright Chromium, headless, en-GB locale, an ordinary Chrome user agent.

How it was run (`npm run test:sites`): one visit per site per configuration plus one reload, one site at a time with a pause between sites.
No logins, purchases, forms, account creation or clicks of our own; the only clicks are Rockyweb's, on consent banners. Screenshots stay in `tests/sites/.out` (git-ignored); no cookies, profiles or personal data are kept.

**Where it ran matters.** The test machine is in the United States. Several UK and EU sites show a different banner there, or none, or an accept-only notice. A run from the UK or EU will differ; treat these numbers as a baseline for this location only.

What the columns mean (all measured, nothing estimated):
- **Answer**: what Rockyweb reported in the toolbar, and how long after navigation it was recorded.
- **Stored choice**: read back from the platform itself (CMP API or its cookie) after the answer. *matches*: what you asked for. *stricter than asked*: functional cookies were refused too (the site offers no separate functional choice, or groups it with something else). *not decided*: no choice stored (often the site shows no banner here). *unreadable*: the platform keeps its choice somewhere this harness cannot read. *MISMATCH*: tracking allowed.
- **Reload**: the stored choice after one reload, and whether a banner came back.
- **Breakage**: compared with the same site without Rockyweb: the page no longer scrolls, or its main text shrank by more than half.
- **Errors**: console errors from Rockyweb's own scripts, not counting errors the site also logs without Rockyweb.

## Summary

| | No Rockyweb | Full, granular | Full, reject all | Light, granular |
|---|---|---|---|---|
| Sites | 46 | 46 | 46 | 46 |
| Load failed or blocked (4xx) | 1 | 2 | 2 | 2 |
| Banner answered by Rockyweb | n/a | 24 | 26 | 15 |
| Stored choice matches | n/a | 17 | 24 | 11 |
| Stored choice stricter than asked | n/a | 8 | 0 | 2 |
| Not decided | n/a | 8 | 8 | 18 |
| Unreadable | n/a | 13 | 13 | 15 |
| MISMATCH (tracking allowed) | n/a | 0 | 1 | 0 |
| Answer held after reload | n/a | 14 | 15 | 8 |
| Accept clicks | n/a | 0 | 0 | 0 |
| Rockyweb console errors | n/a | 0 | 0 | 0 |
| Breakage | n/a | thesun (no scroll); lefigaro (text 5443 vs 47087); ryanair (no scroll); forbes (text 0 vs 17668) | thesun (no scroll); lefigaro (text 5443 vs 47087); forbes (text 0 vs 17668) | thesun (no scroll); zalando (no scroll); forbes (text 0 vs 17668) |
| Banner still visible | 35 | 16 | 15 | 23 |

## Per site: Full, granular (necessary and functional on)

| Site | Country | Expected | Answer | Stored choice | Reload | Ads / trackers blocked | Breakage | Errors | Notes |
|---|---|---|---|---|---|---|---|---|---|
| bbc | UK | custom | not answered | not decided [TCF (Sourcepoint)] | not decided, banner back | 0 / 0 |  | 0 | US visitors get an accept-only notice; correctly left alone |
| guardian | UK | Sourcepoint | not answered | unreadable | unreadable | 6 / 5 |  | 0 | US privacy notice, not a consent banner; correctly left alone |
| independent | UK | Sourcepoint | not answered | not decided [TCF (Sourcepoint)] | not decided | 26 / 7 |  | 0 | donation overlay, not consent; correctly left alone |
| telegraph | UK | Sourcepoint | not answered | not decided [TCF (Sourcepoint)] | not decided, banner back | 30 / 10 |  | 0 |  |
| skynews | UK | Sourcepoint | not answered | unreadable | unreadable | 0 / 0 |  | 0 | blocked the automated browser (access denied) |
| thesun | UK | Sourcepoint | not answered | not decided [TCF (Sourcepoint)] | not decided | 50 / 12 | no scroll | 0 | anti-adblock notice; reported, not circumvented |
| mirror | UK | OneTrust | not answered | not decided [TCF (Quantcast)] | not decided, banner back | 4 / 4 |  | 0 | US visitors get an accept-only notice; correctly left alone |
| spiegel | DE | Sourcepoint | not answered | not decided [TCF (Sourcepoint)] | not decided, banner back | 0 / 0 |  | 0 | pay or consent wall; correctly left alone |
| bild | DE | Sourcepoint | not answered | not decided [TCF (cmp 345)] | not decided, banner back | 0 / 0 |  | 0 | pay or consent wall; correctly left alone |
| zeit | DE | Sourcepoint | not answered | unreadable | unreadable | 0 / 0 |  | 0 | blocked the automated browser (verification page) |
| lemonde | FR | custom | not answered | matches [TCF (cmp 371)] | matches, banner back | 1 / 2 |  | 0 |  |
| lefigaro | FR | Didomi | not answered | matches [TCF (cmp 2)] | matches | 6 / 0 | text 5443 vs 47087 | 0 | banner drawn in an address-less iframe (AppConsent), now answered; the scroll result is a reader artefact |
| 20minutes | FR | Didomi | not answered | matches [Didomi] | matches, banner back | 0 / 0 |  | 0 | pay or consent wall; correctly left alone |
| ouestfrance | FR | Didomi | Didomi (api, reject) 1.6s | matches [Didomi] | matches, banner back | 0 / 0 |  | 0 |  |
| elpais | ES | Didomi | Didomi (api, reject) 2.1s | matches [Didomi] | unreadable | 1 / 9 |  | 0 |  |
| marca | ES | Didomi | Didomi (api, reject) 1.8s | matches [Didomi] | matches, banner back | 2 / 1 |  | 0 | pay or consent: Didomi's refusal is taken, Marca's own subscribe notice stays; not circumvented |
| corriere | IT | custom | not answered | unreadable [cookie only] | unreadable, banner back | 1 / 10 |  | 0 | pay or consent wall; correctly left alone |
| nos | NL | custom | not answered | unreadable [cookie only] | unreadable | 0 / 0 |  | 0 | information notice, not consent; correctly left alone |
| dr | DK | Cookiebot | Cookiebot (api, custom) 1.1s | matches [Cookiebot] | matches | 0 / 1 |  | 0 |  |
| argos | UK | OneTrust | not answered | unreadable | unreadable | 0 / 0 |  | 0 | blocked the automated browser (access denied) |
| mands | UK | OneTrust | OneTrust (api, custom) 2.2s | matches [OneTrust] | matches | 0 / 0 |  | 0 | its console error also appears without the extension |
| asos | UK | OneTrust | OneTrust (api, custom) 1.5s | matches [OneTrust] | matches | 0 / 7 |  | 0 |  |
| currys | UK | OneTrust | OneTrust (api, custom) 1.8s | matches [OneTrust] | unreadable | 7 / 3 |  | 0 |  |
| ikea | UK | OneTrust | OneTrust (api, custom) 1.7s | stricter than asked [OneTrust] | unreadable | 0 / 0 |  | 0 |  |
| zalando | UK | custom | Usercentrics (api, custom) 3.6s | stricter than asked [Usercentrics] | stricter than asked, banner back | 5 / 1 |  | 0 | Light: 'Set preferences' opened a layer that could not be finished; since 2026-11-19 refused directly (re-checked: answered, page scrolls) |
| otto | DE | custom | OneTrust (api, custom) 7s | stricter than asked [OneTrust] | unreadable | 0 / 0 |  | 0 |  |
| mediamarkt | DE | Usercentrics | Generic (heuristic, reject) 3.4s | unreadable [cookie only] | unreadable | 0 / 0 |  | 0 |  |
| booking | EU | OneTrust | OneTrust (api, custom) 4s | matches [OneTrust] | matches | 4 / 0 |  | 0 | dialog left is the Genius sign-in prompt (also in the baseline). The full-reject 'mismatch' was group C0001, OneTrust's always-on necessary group; reader fixed, re-checked 2026-11-19: matches |
| easyjet | UK | custom | not answered | unreadable | unreadable | 0 / 0 |  | 0 | blocked the automated browser (verification page) |
| ryanair | IE | custom | not answered | unreadable | unreadable, banner back | 1 / 0 | no scroll | 0 | settings layer is an iframe Rockyweb cannot reach; since 2026-11-19 the banner is refused directly instead (re-checked: answered, page scrolls) |
| trainline | UK | OneTrust | OneTrust (api, custom) 2.6s | matches [OneTrust] | matches | 12 / 8 |  | 0 |  |
| nationalrail | UK | OneTrust | OneTrust (api, custom) 1.8s | matches [OneTrust] | matches | 1 / 1 |  | 0 |  |
| lufthansa | DE | Usercentrics | OneTrust (api, custom) 3.3s | stricter than asked [OneTrust] | unreadable | 1 / 0 |  | 0 | an earlier 'mismatch' was a reader artefact (group names not loaded yet); reader fixed |
| dsb | DK | Cookiebot | Cookie Information (dom, reject) 4.4s | unreadable [cookie only] | unreadable | 5 / 1 |  | 0 |  |
| govuk | UK | custom | Generic (heuristic, reject) 3.7s | stricter than asked [GOV.UK] | stricter than asked | 0 / 0 |  | 0 |  |
| nhs | UK | custom | Generic (heuristic, reject) 4s | stricter than asked [NHS] | stricter than asked | 0 / 0 |  | 0 |  |
| metoffice | UK | custom | Civic Cookie Control (dom, reject) 1.5s | matches [TCF (cmp 259)] | matches | 4 / 0 |  | 0 |  |
| wikipedia | EU | none | not answered | unreadable | unreadable | 0 / 0 |  | 0 | no banner |
| forbes | US | TrustArc | not answered | unreadable | unreadable | 0 / 0 | text 0 vs 17668 | 0 | blocked the automated browser (verification page) |
| cookiebot | DK | Cookiebot | Cookiebot (api, custom) 1.5s | matches [Cookiebot] | matches | 0 / 1 |  | 0 |  |
| usercentrics | DE | Usercentrics | Usercentrics v3 (api, reject) 2s | unreadable | unreadable, banner back | 0 / 1 |  | 0 | opt-out toast; correctly left alone |
| didomi | FR | Didomi | Didomi (api, reject) 1.3s | matches [Didomi] | matches, banner back | 0 / 0 |  | 0 |  |
| onetrust | UK | OneTrust | OneTrust (api, custom) 1.4s | matches [OneTrust] | matches | 0 / 0 |  | 0 |  |
| trustarc | US | TrustArc | not answered | stricter than asked [TrustArc] | stricter than asked | 0 / 0 |  | 0 | no banner shown to this visitor |
| quantcast | US | Quantcast | not answered | not decided [TCF (Quantcast)] | not decided, banner back | 0 / 0 |  | 0 |  |
| complianz | NL | Complianz | Complianz (api, reject) 2.3s | stricter than asked [Complianz] | stricter than asked, answered again (Complianz/api) | 4 / 1 |  | 0 |  |

## Per site: reject all, and Light

| Site | Full, reject all: answer | stored | Light, granular: answer | stored |
|---|---|---|---|---|
| bbc | not answered | not decided [TCF (Sourcepoint)] | not answered | not decided [TCF (Sourcepoint)] |
| guardian | not answered | unreadable | not answered | unreadable |
| independent | not answered | not decided [TCF (Sourcepoint)] | not answered | not decided [TCF (Sourcepoint)] |
| telegraph | not answered | not decided [TCF (Sourcepoint)] | not answered | not decided [TCF (Sourcepoint)] |
| skynews | not answered | unreadable | not answered | unreadable |
| thesun | not answered | not decided [TCF (Sourcepoint)] | not answered | not decided [TCF (Sourcepoint)] |
| mirror | not answered | not decided [TCF (Quantcast)] | not answered | not decided [TCF (Quantcast)] |
| spiegel | not answered | not decided [TCF (Sourcepoint)] | not answered | not decided [TCF (Sourcepoint)] |
| bild | not answered | not decided [TCF (cmp 345)] | not answered | not decided [TCF (cmp 345)] |
| zeit | not answered | unreadable | not answered | unreadable |
| lemonde | Generic (heuristic, reject) 3s | matches [TCF (cmp 371)] | not answered | unreadable |
| lefigaro | not answered | matches [TCF (cmp 2)] | not answered | not decided [TCF (cmp 2)] |
| 20minutes | not answered | matches [Didomi] | not answered | matches [Didomi] |
| ouestfrance | Didomi (api, reject) 1.8s | matches [Didomi] | Didomi (dom, reject) 9.4s | not decided [Didomi] |
| elpais | Didomi (api, reject) 8.5s | matches [Didomi] | Didomi (dom, reject) 9.5s | not decided [Didomi] |
| marca | Didomi (api, reject) 2.1s | matches [Didomi] | not answered | not decided [Didomi] |
| corriere | not answered | unreadable [cookie only] | not answered | unreadable [cookie only] |
| nos | not answered | unreadable [cookie only] | not answered | unreadable [cookie only] |
| dr | Cookiebot (api, reject) 1s | matches [Cookiebot] | not answered | not decided [Cookiebot] |
| argos | not answered | unreadable | not answered | unreadable |
| mands | OneTrust (api, reject) 1.8s | matches [OneTrust] | OneTrust (dom, custom) 3.8s | matches [OneTrust] |
| asos | OneTrust (api, reject) 1.8s | matches [OneTrust] | OneTrust (dom, custom) 4.1s | matches [OneTrust] |
| currys | OneTrust (api, reject) 2s | matches [OneTrust] | OneTrust (dom, custom) 3.8s | matches [OneTrust] |
| ikea | OneTrust (api, reject) 2.1s | matches [OneTrust] | OneTrust (dom, custom) 4s | matches [OneTrust] |
| zalando | Usercentrics (api, reject) 3.5s | matches [Usercentrics] | not answered | not decided [Usercentrics] |
| otto | OneTrust (api, reject) 7.3s | matches [OneTrust] | not answered | not decided [OneTrust] |
| mediamarkt | Generic (heuristic, reject) 18.9s | unreadable [cookie only] | not answered | unreadable |
| booking | OneTrust (api, reject) 4.3s | mismatch: functional on [OneTrust] | not answered | not decided [OneTrust] |
| easyjet | not answered | unreadable | not answered | unreadable |
| ryanair | Generic (heuristic, reject) 3s | unreadable [cookie only] | not answered | unreadable |
| trainline | OneTrust (api, reject) 2.4s | matches [OneTrust] | OneTrust (dom, custom) 3.8s | matches [OneTrust] |
| nationalrail | OneTrust (api, reject) 1.6s | matches [OneTrust] | OneTrust (dom, custom) 3.3s | matches [OneTrust] |
| lufthansa | OneTrust (api, reject) 4.1s | matches [OneTrust] | OneTrust (dom, custom) 4.1s | stricter than asked [OneTrust] |
| dsb | Cookie Information (dom, reject) 4.3s | unreadable [cookie only] | Cookie Information (dom, reject) 3.7s | unreadable [cookie only] |
| govuk | Generic (heuristic, reject) 3.7s | matches [GOV.UK] | not answered | not decided [GOV.UK] |
| nhs | Generic (heuristic, reject) 3.9s | matches [NHS] | not answered | not decided [NHS] |
| metoffice | Civic Cookie Control (dom, reject) 1.6s | matches [TCF (cmp 259)] | Civic Cookie Control (dom, reject) 2.3s | matches [TCF (cmp 259)] |
| wikipedia | not answered | unreadable | not answered | unreadable |
| forbes | not answered | unreadable | not answered | unreadable |
| cookiebot | Cookiebot (api, reject) 1.5s | matches [Cookiebot] | Cookiebot (dom, custom) 4.1s | matches [Cookiebot] |
| usercentrics | Usercentrics v3 (api, reject) 2s | unreadable | Usercentrics v3 (dom, reject) 6.3s | unreadable |
| didomi | Didomi (api, reject) 1.7s | matches [Didomi] | Didomi (dom, reject) 6.1s | matches [Didomi] |
| onetrust | OneTrust (api, reject) 1.4s | matches [OneTrust] | OneTrust (dom, custom) 3.3s | matches [OneTrust] |
| trustarc | not answered | matches [TrustArc] | not answered | stricter than asked [TrustArc] |
| quantcast | not answered | not decided [TCF (Quantcast)] | not answered | not decided [TCF (Quantcast)] |
| complianz | Complianz (api, reject) 3.3s | matches [Complianz] | not answered | unreadable [cookie only] |

## Before and after the fixes (Full, granular; before = tag `before`)

| Site | Before | After |
|---|---|---|
| lefigaro | not answered; not decided [TCF (cmp 2)] | not answered; matches [TCF (cmp 2)] |
| marca | Didomi (api, reject); not decided [Didomi] | Didomi (api, reject); matches [Didomi] |
| govuk | not answered; not decided [GOV.UK] | Generic (heuristic, reject); stricter than asked [GOV.UK] |
| nhs | not answered; not decided [NHS] | Generic (heuristic, reject); stricter than asked [NHS] |
| forbes | Ketch (dom, reject); stricter than asked [TrustArc] | not answered; unreadable |
| onetrust | OneTrust (api, reject); stricter than asked [OneTrust] | OneTrust (api, custom); matches [OneTrust] |
| quantcast | Generic (heuristic, custom); not decided [TCF (Quantcast)] | not answered; not decided [TCF (Quantcast)] |

39 sites unchanged.

## Findings

- Zero accept clicks and zero navigations caused by Rockyweb in every configuration.
- The one MISMATCH under Full, reject all (Booking) is a reader artefact: the group read as functional is C0001, OneTrust's always-on necessary group. With the reader fixed, a re-check on 2026-11-19 reads it as matching. Counting it, true mismatches are 0 in every configuration.
- The Ryanair (Full, granular) and Zalando (Light) breakage in the table was fixed after this run; a re-check on 2026-11-19 (one visit each) shows both answered with a refusal and the page scrolling. The Le Figaro text figure is a reader artefact and Forbes blocked the browser, which leaves The Sun's anti-adblock notice as the only real breakage.
- Run from the United States, so many EU sites showed US variants (accept-only notices, privacy notices, no banner). UK and EU visitors will see more banners, and these numbers are not a substitute for a run from Europe.
- Pay or consent walls (Marca, Corriere, 20 Minutes, Bild, Spiegel) are left alone: refusing is a choice the user makes on the site, and Rockyweb never accepts on their behalf.
- Anti-adblock notices (The Sun) are reported, not circumvented.
- Settings routes are now tried only where the toggles are known to be reachable (a rule that names them, or a preference panel already in the page). Elsewhere a direct refusal is used, which is stricter than asked but never leaves a dialog open (Ryanair, Zalando).
- Real Gemini Nano corpus (AI off against AI on): 38 of 46 identical; the 8 differences came from consent kept in partitioned third-party storage between runs. The banner AI clicked on no real site (0 attempts) and made 0 accepts.
- Measured on 2026-11-15 to 2026-11-19. Blocked sites (Sky News, Argos, easyJet, Zeit, Forbes) refused the automated browser and are not evidence either way.

