# Contributing to Rockyweb

Thank you for helping. Bug reports, site breakage reports, cookie banner rules and fixes are all welcome.

## Reporting a site that breaks, or a banner Rockyweb misses

Use the issue templates. Give the page address, the mode shown in the toolbar popup, and what you expected. Please leave out anything personal: no cookies, account pages or screenshots showing your details. Results depend on where you are, so say which country you browsed from.

## Setting up

```bash
npm install
```

```bash
npx playwright install chromium
```

No build step is needed to run the extension: load the `extension` folder from `chrome://extensions` with developer mode on.

## Before you open a pull request

```bash
npm run check          # static checks and unit tests
```

```bash
npm run test:e2e       # both browser suites
```

Add a test with every fix: a unit test in `tests/*.test.mjs` for pure logic, or a fixture page and a check in `tests/e2e/` for behaviour in the browser. A fixture should fail without the fix.

## House rules

- **Writing:** British English in all user-facing text. No em or en dashes anywhere (`npm run verify` checks shipped files). Keep comments short and about why, not what.
- **Privacy:** no network requests of our own, no analytics, no remote code, no new permissions without a strong reason written in `store/LISTING.md`.
- **Cookie consent:** Rockyweb must never accept on the user's behalf. A new rule or wording change needs a fixture where the wrong button is also present.
- **On-device AI:** the model only ever chooses from fixed outcomes. It never writes code, CSS, selectors or URLs, and every answer is validated again. Page-derived text sent to it is treated as untrusted data. New AI behaviour needs a fixture that tries to steer it (see the "injected" banner and the page edit checks).
- **Page changes:** every change must be listed in the popup and reversible. Never hide the main content, the page itself, or a form in use. Never touch paywalls, anti-adblock notices, sign-in or payment.

## Layout

See the "Layout" section of [README.md](README.md).
