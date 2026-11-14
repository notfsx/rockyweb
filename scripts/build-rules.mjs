#!/usr/bin/env node
// Generates extension/rules/*.json from extension/shared/filter-lists.js.
import fs from 'node:fs';
import path from 'node:path';
import { loadShared, EXT_DIR } from './load-shared.mjs';

const RW = loadShared();
const { PRIORITY } = RW;

function domainRules(domains) {
  return [...new Set(domains)].sort().map((domain) => ({
    priority: PRIORITY.STATIC,
    action: { type: 'block' },
    condition: { requestDomains: [domain], domainType: 'thirdParty' }
  }));
}

function surrogateRules(ruleset) {
  return RW.SURROGATES.filter((s) => s.ruleset === ruleset).map((s) => ({
    priority: PRIORITY.STATIC_SURROGATE,
    action: { type: 'redirect', redirect: { extensionPath: s.path } },
    condition: { urlFilter: s.urlFilter, resourceTypes: ['script'], domainType: 'thirdParty' }
  }));
}

function withIds(rules) {
  return rules.map((r, i) => Object.assign({ id: i + 1 }, r));
}

// Guard rails: lists must not overlap or contain breakage-guarded domains.
const problems = [];
const overlap = RW.AD_DOMAINS.filter((d) => RW.TRACKER_DOMAINS.includes(d));
if (overlap.length) problems.push(`AD/TRACKER overlap: ${overlap.join(', ')}`);
for (const d of [...RW.AD_DOMAINS, ...RW.TRACKER_DOMAINS, ...RW.STRICT_EXTRA_DOMAINS]) {
  if (!RW.isValidDomain(d)) problems.push(`invalid domain: ${d}`);
  if (RW.NEVER_RESTRICT.includes(RW.baseDomain(d)) && !/^adservice\.google\.com$/.test(d)) problems.push(`breakage-guarded domain in block list: ${d}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const out = {
  ads: withIds([...domainRules(RW.AD_DOMAINS), ...surrogateRules('ads')]),
  trackers: withIds([...domainRules(RW.TRACKER_DOMAINS), ...surrogateRules('trackers')])
};

fs.mkdirSync(path.join(EXT_DIR, 'rules'), { recursive: true });
for (const [name, rules] of Object.entries(out)) {
  const file = path.join(EXT_DIR, 'rules', `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rules, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${rules.length} rules)`);
}
