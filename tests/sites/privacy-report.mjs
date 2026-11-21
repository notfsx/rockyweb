#!/usr/bin/env node
// Summarises a privacy run (run-sites.mjs with --configs=baseline,balanced,strict, and
// run-benchmarks.mjs) into markdown tables on stdout.
// usage: node tests/sites/privacy-report.mjs <tag>
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const TAG = process.argv[2];
if (!TAG) throw new Error('usage: privacy-report.mjs <tag>');
const DIR = path.join(HERE, '.out', TAG);
const read = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : null);
const CONFIGS = ['baseline', 'balanced', 'strict'];
const runs = Object.fromEntries(CONFIGS.map((c) => [c, read(`${c}.json`)]).filter(([, v]) => v));

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const sum = (a) => a.reduce((n, x) => n + x, 0);
const ok = (r) => r.privacy && !r.privacy.error && !r.loadError && r.status && r.status < 400;
// Only sites that loaded in every config, so the columns compare like with like.
const ids = Object.values(runs)[0].filter(ok).map((r) => r.id).filter((id) => Object.values(runs).every((rs) => rs.some((r) => r.id === id && ok(r))));
const pick = (c) => ids.map((id) => runs[c].find((r) => r.id === id).privacy);

const rows = [
  ['Third-party requests loaded, median per page', (p) => median(p.map((x) => x.thirdParty.loaded))],
  ['Third-party requests loaded, all pages', (p) => sum(p.map((x) => x.thirdParty.loaded))],
  ['Third-party requests blocked by the extension', (p) => sum(p.map((x) => x.thirdParty.blocked))],
  ['Third-party requests swapped for a harmless stand-in script', (p) => sum(p.map((x) => x.thirdParty.standIn || 0))],
  ['Tracker requests loaded (DuckDuckGo list), median per page', (p) => median(p.map((x) => x.trackers.loaded))],
  ['Tracker requests loaded, all pages', (p) => sum(p.map((x) => x.trackers.loaded))],
  ['Distinct tracker domains loaded, median per page', (p) => median(p.map((x) => x.trackers.domainsLoaded.length))],
  ['Third-party cookies from tracker domains, all pages', (p) => sum(p.map((x) => x.cookies.trackerThirdParty))],
  ['First-party analytics and ad cookies (_ga, _fbp and similar), all pages', (p) => sum(p.map((x) => x.cookies.firstPartyTracking))],
  ['Tracker scripts with a fingerprinting score of 2 or 3 loaded, all pages', (p) => sum(p.map((x) => x.fingerprinting.trackerScriptsLoaded))],
  ['Scripts seen reading canvas, WebGL renderer, audio or many fonts, all pages', (p) => sum(p.map((x) => x.fingerprinting.probeScripts))],
  ['Pages that kept utm_source, fbclid or gclid in the address', (p) => p.filter((x) => x.linkParams.kept.length).length]
];

const cfgs = Object.keys(runs);
const out = [];
out.push(`Sites that loaded in every configuration: ${ids.length} (${ids.join(', ')}).`, '');
out.push(`| Measure (measured, one visit per site) | ${cfgs.join(' | ')} |`, `|---|${cfgs.map(() => '---').join('|')}|`);
for (const [label, fn] of rows) out.push(`| ${label} | ${cfgs.map((c) => fn(pick(c))).join(' | ')} |`);
const td = read('tracker-data.json');
if (td) out.push('', `Tracker list: ${td.source}, fetched ${td.fetched}.`);

const bench = read('bench/bench.json');
if (bench) {
  out.push('', '| Test page | ' + cfgs.join(' | ') + ' |', `|---|${cfgs.map(() => '---').join('|')}|`);
  for (const id of [...new Set(bench.map((b) => b.id))]) {
    out.push(`| ${id} | ${cfgs.map((c) => { const b = bench.find((x) => x.id === id && x.config === c); return !b ? 'not run' : b.error ? `error: ${b.error.slice(0, 60)}` : `${b.score || 'score not read'} (${b.blockedRequests} blocked)`; }).join(' | ')} |`);
  }
}

// Per site, the trackers still loaded in strict, to turn into fixes or listed limitations.
if (runs.strict) {
  out.push('', '| Site | Tracker domains still loaded in strict |', '|---|---|');
  for (const id of ids) {
    const d = runs.strict.find((r) => r.id === id).privacy.trackers.domainsLoaded;
    if (d.length) out.push(`| ${id} | ${d.join(', ')} |`);
  }
}
console.log(out.join('\n'));
