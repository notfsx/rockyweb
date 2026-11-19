# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue. On GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Include the Rockyweb version, the Chrome version, and the steps or page that show the problem. You will get a reply within a week.

Please do not include cookies, passwords or other personal data in a report. A minimal page that reproduces the problem is ideal.

## Supported versions

Only the latest version published on the Chrome Web Store, and the default branch, receive fixes.

## What counts

Anything that lets a web page, another extension or an imported settings file:

- make Rockyweb accept cookies, or click anything other than a refusal, on your behalf;
- read your settings, learned trackers or browsing activity;
- run code in Rockyweb's pages or service worker, or inject CSS or script through Rockyweb;
- steer the on-device model into an action outside its fixed list, or into hiding a page's main content;
- send data anywhere (Rockyweb makes no network requests of its own).

## Design notes for reviewers

- The model never writes code, CSS, selectors or URLs. It chooses from fixed operations and from ids in an outline Rockyweb built; everything it returns is validated again before use. See `extension/shared/ai-policy.js` and `extension/shared/page-edits.js`.
- Messages are checked by sender: content scripts and extension pages can only call the handlers meant for them (`HANDLERS` in `extension/background.js`), and `npm run verify` checks that every action lines up.
- Imported settings pass through `normalizeState()` in `extension/shared/config.js`; nothing is used unchecked.
- No remote code: `content_security_policy` allows only the extension's own scripts.
