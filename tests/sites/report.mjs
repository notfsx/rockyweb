#!/usr/bin/env node
// Turns the JSON from run-sites.mjs into tests/sites/results.md.
// usage: node tests/sites/report.mjs [--tag=name] [--before=name]
// Hand-checked notes (from the local screenshots) live in tests/sites/notes.json.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const OUT_DIR = path.join(HERE, '.out');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const latest = () => fs.readdirSync(OUT_DIR).filter((d) => fs.existsSync(path.join(OUT_DIR, d, 'full-granular.json')))
  .sort((a, b) => fs.statSync(path.join(OUT_DIR, b)).mtimeMs - fs.statSync(path.join(OUT_DIR, a)).mtimeMs)[0];
const TAG = arg('tag', latest());
const BEFORE = arg('before', '');
const CONFIGS = ['baseline', 'full-granular', 'full-reject', 'light-granular'];
const LABEL = { baseline: 'No Rockyweb', 'full-granular': 'Full, granular', 'full-reject': 'Full, reject all', 'light-granular': 'Light, granular' };

const load = (tag, c) => {
  const f = path.join(OUT_DIR, tag, `${c}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const runs = Object.fromEntries(CONFIGS.map((c) => [c, load(TAG, c)]));
if (!runs['full-granular']) throw new Error(`no results in ${path.join(OUT_DIR, TAG)}`);
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8')).sites;
const notesFile = path.join(HERE, 'notes.json');
const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : { sites: {} };
const byId = (rows, id) => (rows || []).find((r) => r.id === id);
const when = new Date(fs.statSync(path.join(OUT_DIR, TAG, 'full-granular.json')).mtimeMs).toISOString().slice(0, 10);

// Errors also seen without Rockyweb on the same site are the site's own (extension probing and so on).
const ownErrors = (r) => {
  const base = byId(runs.baseline, r.id);
  const seen = new Set((base && base.errors) || []);
  return (r.errors || []).filter((e) => !seen.has(e));
};
// Breakage: the page scrolled or showed its text without Rockyweb but not with it.
const breakage = (r) => {
  const base = byId(runs.baseline, r.id);
  if (!base || base.error || r.error) return null;
  const out = [];
  if (base.scrolls === 'yes' && r.scrolls === 'NO') out.push('no scroll');
  const bt = base.metrics && base.metrics.mainTextLength;
  const rt = r.metrics && r.metrics.mainTextLength;
  if (bt > 500 && rt < bt * 0.5) out.push(`text ${rt} vs ${bt}`);
  return out.length ? out.join(', ') : null;
};
const answer = (r) => (r.error ? `error: ${r.error.slice(0, 40)}` : r.rockyweb ? `${r.rockyweb.cmp} (${r.rockyweb.method}, ${r.rockyweb.decision}) ${Math.round((r.handledMs || 0) / 100) / 10}s` : 'not answered');
const stored = (r) => (r.consent ? `${r.verdict}${r.consent.platform ? ` [${r.consent.platform}]` : ''}` : '');
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ');

function summary(c) {
  const rows = runs[c];
  if (!rows) return null;
  const n = (f) => rows.filter(f).length;
  return {
    sites: rows.length,
    loadFailed: n((r) => r.error || r.loadError || (r.status && r.status >= 400)),
    answered: n((r) => r.rockyweb),
    matches: n((r) => r.verdict === 'matches'),
    stricter: n((r) => r.verdict === 'stricter than asked'),
    notDecided: n((r) => r.verdict === 'not decided'),
    unreadable: n((r) => r.verdict === 'unreadable'),
    mismatch: n((r) => /mismatch/i.test(r.verdict || '')),
    reloadHeld: n((r) => r.rockyweb && r.afterReload && r.afterReload.verdict === r.verdict && !r.afterReload.banner),
    reloadAnsweredAgain: n((r) => r.afterReload && r.afterReload.answeredAgain),
    acceptClicks: rows.reduce((a, r) => a + ((r.acceptClicks || []).length), 0),
    rockywebErrors: rows.reduce((a, r) => a + ownErrors(r).length, 0),
    breakage: rows.filter((r) => breakage(r)).map((r) => `${r.id} (${breakage(r)})`),
    bannerLeft: n((r) => r.bannerAfter && r.bannerAfter !== 'eval failed')
  };
}

const L = [];
const p = (s = '') => L.push(s);
p('# Real-website results');
p();
p(`Baseline run: ${when} (tag \`${TAG}\`). Rockyweb 1.1.0, Playwright Chromium, headless, en-GB locale, an ordinary Chrome user agent.`);
p();
p('How it was run (`npm run test:sites`): one visit per site per configuration plus one reload, one site at a time with a pause between sites.');
p('No logins, purchases, forms, account creation or clicks of our own; the only clicks are Rockyweb\'s, on consent banners. Screenshots stay in `tests/sites/.out` (git-ignored); no cookies, profiles or personal data are kept.');
p();
p(`**Where it ran matters.** The test machine is in the United States. Several UK and EU sites show a different banner there, or none, or an accept-only notice. A run from the UK or EU will differ; treat these numbers as a baseline for this location only.`);
p();
p('What the columns mean (all measured, nothing estimated):');
p('- **Answer**: what Rockyweb reported in the toolbar, and how long after navigation it was recorded.');
p('- **Stored choice**: read back from the platform itself (CMP API or its cookie) after the answer. *matches*: what you asked for. *stricter than asked*: functional cookies were refused too (the site offers no separate functional choice, or groups it with something else). *not decided*: no choice stored (often the site shows no banner here). *unreadable*: the platform keeps its choice somewhere this harness cannot read. *MISMATCH*: tracking allowed.');
p('- **Reload**: the stored choice after one reload, and whether a banner came back.');
p('- **Breakage**: compared with the same site without Rockyweb: the page no longer scrolls, or its main text shrank by more than half.');
p('- **Errors**: console errors from Rockyweb\'s own scripts, not counting errors the site also logs without Rockyweb.');
p();
p('## Summary');
p();
p(`| | ${CONFIGS.map((c) => LABEL[c]).join(' | ')} |`);
p(`|---|${CONFIGS.map(() => '---').join('|')}|`);
const S = Object.fromEntries(CONFIGS.map((c) => [c, summary(c)]));
const row = (name, f) => p(`| ${name} | ${CONFIGS.map((c) => (S[c] ? cell(f(S[c], c)) : 'not run')).join(' | ')} |`);
row('Sites', (s) => s.sites);
row('Load failed or blocked (4xx)', (s) => s.loadFailed);
row('Banner answered by Rockyweb', (s, c) => (c === 'baseline' ? 'n/a' : s.answered));
row('Stored choice matches', (s, c) => (c === 'baseline' ? 'n/a' : s.matches));
row('Stored choice stricter than asked', (s, c) => (c === 'baseline' ? 'n/a' : s.stricter));
row('Not decided', (s, c) => (c === 'baseline' ? 'n/a' : s.notDecided));
row('Unreadable', (s, c) => (c === 'baseline' ? 'n/a' : s.unreadable));
row('MISMATCH (tracking allowed)', (s, c) => (c === 'baseline' ? 'n/a' : s.mismatch));
row('Answer held after reload', (s, c) => (c === 'baseline' ? 'n/a' : s.reloadHeld));
row('Accept clicks', (s, c) => (c === 'baseline' ? 'n/a' : s.acceptClicks));
row('Rockyweb console errors', (s, c) => (c === 'baseline' ? 'n/a' : s.rockywebErrors));
row('Breakage', (s, c) => (c === 'baseline' ? 'n/a' : s.breakage.length ? s.breakage.join('; ') : 'none'));
row('Banner still visible', (s) => s.bannerLeft);
p();

p('## Per site: Full, granular (necessary and functional on)');
p();
p('| Site | Country | Expected | Answer | Stored choice | Reload | Ads / trackers blocked | Breakage | Errors | Notes |');
p('|---|---|---|---|---|---|---|---|---|---|');
for (const site of corpus) {
  const r = byId(runs['full-granular'], site.id);
  if (!r) continue;
  const ar = r.afterReload;
  const reload = ar ? `${ar.verdict}${ar.banner ? ', banner back' : ''}${ar.answeredAgain ? `, answered again (${ar.answeredAgain})` : ''}` : '';
  const counts = r.counts ? `${r.counts.ads} / ${r.counts.trackers}` : '';
  const note = notes.sites[site.id] || (r.status >= 400 ? `HTTP ${r.status}` : '');
  p(`| ${site.id} | ${site.country} | ${cell(site.expectedCmp)} | ${cell(answer(r))} | ${cell(stored(r))} | ${cell(reload)} | ${counts} | ${cell(breakage(r) || '')} | ${ownErrors(r).length} | ${cell(note)} |`);
}
p();

p('## Per site: reject all, and Light');
p();
p('| Site | Full, reject all: answer | stored | Light, granular: answer | stored |');
p('|---|---|---|---|---|');
for (const site of corpus) {
  const a = byId(runs['full-reject'], site.id);
  const b = byId(runs['light-granular'], site.id);
  if (!a && !b) continue;
  p(`| ${site.id} | ${a ? cell(answer(a)) : 'not run'} | ${a ? cell(stored(a)) : ''} | ${b ? cell(answer(b)) : 'not run'} | ${b ? cell(stored(b)) : ''} |`);
}
p();

if (BEFORE) {
  const prev = load(BEFORE, 'full-granular');
  if (prev) {
    p(`## Before and after the fixes (Full, granular; before = tag \`${BEFORE}\`)`);
    p();
    p('| Site | Before | After |');
    p('|---|---|---|');
    let same = 0;
    for (const site of corpus) {
      const a = byId(prev, site.id);
      const b = byId(runs['full-granular'], site.id);
      if (!a || !b) continue;
      const x = `${answer(a).replace(/ [\d.]+s$/, '')}; ${stored(a)}`;
      const y = `${answer(b).replace(/ [\d.]+s$/, '')}; ${stored(b)}`;
      if (x === y) { same++; continue; }
      p(`| ${site.id} | ${cell(x)} | ${cell(y)} |`);
    }
    p();
    p(`${same} sites unchanged.`);
    p();
  }
}

if (notes.findings && notes.findings.length) {
  p('## Findings');
  p();
  for (const f of notes.findings) p(`- ${f}`);
  p();
}

fs.writeFileSync(path.join(HERE, 'results.md'), `${L.join('\n')}\n`);
console.log(`wrote ${path.join(HERE, 'results.md')} from ${TAG}${BEFORE ? ` (before: ${BEFORE})` : ''}`);
