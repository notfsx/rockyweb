#!/usr/bin/env node
// Static checks: referenced files exist, message actions line up, rules are valid, no unsafe code.
import fs from 'node:fs';
import path from 'node:path';
import { loadShared, EXT_DIR } from './load-shared.mjs';

const RW = loadShared();
const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => fs.readFileSync(path.join(EXT_DIR, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(EXT_DIR, rel.replace(/^\//, '')));

// ------------------------------------------------------------ 1. referenced files
const manifest = JSON.parse(read('manifest.json'));
const refs = new Set();
Object.values(manifest.icons || {}).forEach((f) => refs.add(f));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((f) => refs.add(f));
refs.add(manifest.action.default_popup);
refs.add(manifest.options_ui.page);
refs.add(manifest.background.service_worker);
for (const cs of manifest.content_scripts) [...(cs.js || []), ...(cs.css || [])].forEach((f) => refs.add(f));
for (const r of manifest.declarative_net_request.rule_resources) refs.add(r.path);
for (const war of manifest.web_accessible_resources) war.resources.forEach((f) => refs.add(f));

for (const html of ['popup.html', 'options.html']) {
  const src = read(html);
  for (const m of src.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) refs.add(m[1]);
}
const bg = read('background.js');
const importBlock = /importScripts\(([\s\S]*?)\);/.exec(bg);
if (!importBlock) fail('background.js: importScripts() block not found');
else for (const m of importBlock[1].matchAll(/'([^']+)'/g)) refs.add(m[1]);

for (const f of refs) if (!exists(f)) fail(`missing referenced file: ${f}`);
notes.push(`${refs.size} referenced files exist`);

// popup's re-injection list must equal the manifest content script list
const popupSrc = read('popup.js');
const injMatch = /CONTENT_SCRIPT_FILES = \[([^\]]+)\]/.exec(popupSrc);
const injected = injMatch ? [...injMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (JSON.stringify(injected) !== JSON.stringify(manifest.content_scripts[0].js)) {
  fail(`popup.js CONTENT_SCRIPT_FILES ${JSON.stringify(injected)} != manifest content_scripts ${JSON.stringify(manifest.content_scripts[0].js)}`);
}

// surrogates referenced by rules must be web accessible
const war = new Set(manifest.web_accessible_resources.flatMap((w) => w.resources));
for (const s of RW.SURROGATES) {
  const rel = s.path.replace(/^\//, '');
  if (!exists(rel)) fail(`surrogate missing: ${rel}`);
  if (!war.has(rel)) fail(`surrogate not web accessible: ${rel}`);
}

// ------------------------------------------------------------ 2. message actions
const ACTIONS = RW.ACTIONS;
const actionKeys = new Set(Object.keys(ACTIONS));
const values = Object.values(ACTIONS);
if (new Set(values).size !== values.length) fail('duplicate action string values in RW.ACTIONS');

const files = {
  background: bg,
  content: read('content.js'),
  popup: popupSrc,
  options: read('options.js')
};
const used = new Set();
for (const [name, src] of Object.entries(files)) {
  for (const m of src.matchAll(/\bA\.([A-Z_]+)\b/g)) {
    used.add(m[1]);
    if (!actionKeys.has(m[1])) fail(`${name}.js references unknown action A.${m[1]}`);
  }
  // raw string actions are forbidden: everything must go through RW.ACTIONS
  for (const m of src.matchAll(/action\s*:\s*['"`]([^'"`]+)['"`]/g)) fail(`${name}.js uses raw action string '${m[1]}'`);
  for (const v of values) {
    if (new RegExp(`['"\`]${v}['"\`]`).test(src)) fail(`${name}.js hard-codes action value '${v}'`);
  }
}
for (const k of actionKeys) if (!used.has(k)) fail(`dead action: A.${k} is never used`);

const handledByBackground = new Set([...bg.matchAll(/\[A\.([A-Z_]+)\]\s*:/g)].map((m) => m[1]));
const handledByContent = new Set([...files.content.matchAll(/msg\.action === A\.([A-Z_]+)/g)].map((m) => m[1]));

// content -> background
const sentByContent = new Set([...files.content.matchAll(/\bsend\(A\.([A-Z_]+)/g)].map((m) => m[1]));
// popup/options -> background
const sentByPages = new Set();
for (const src of [files.popup, files.options]) {
  for (const m of src.matchAll(/\b(?:send|mutate|act)\(A\.([A-Z_]+)/g)) sentByPages.add(m[1]);
}
// anything -> content via chrome.tabs.sendMessage({ action: A.X })
const sentToContent = new Set();
for (const src of [files.popup, files.background]) {
  for (const m of src.matchAll(/action:\s*A\.([A-Z_]+)/g)) sentToContent.add(m[1]);
}

for (const k of [...sentByContent, ...sentByPages]) {
  if (!handledByBackground.has(k)) fail(`action A.${k} is sent to the background but has no handler`);
}
for (const k of sentToContent) {
  if (!handledByContent.has(k)) fail(`action A.${k} is sent to content scripts but content.js does not handle it`);
}
for (const k of handledByBackground) {
  if (!sentByContent.has(k) && !sentByPages.has(k)) fail(`background handles A.${k} but nothing sends it`);
}
for (const k of handledByContent) {
  if (!sentToContent.has(k)) fail(`content.js handles A.${k} but nothing sends it`);
}
// content-originated handlers must accept content senders, page actions must not
const handlerFrom = new Map([...bg.matchAll(/\[A\.([A-Z_]+)\]\s*:\s*\{\s*from:\s*\[([^\]]*)\]/g)].map((m) => [m[1], m[2]]));
for (const k of sentByContent) if (!/FROM_CONTENT/.test(handlerFrom.get(k) || '')) fail(`A.${k} is sent by content.js but its handler does not accept FROM_CONTENT`);
for (const k of sentByPages) if (!/FROM_PAGE/.test(handlerFrom.get(k) || '')) fail(`A.${k} is sent by an extension page but its handler does not accept FROM_PAGE`);
for (const [k, from] of handlerFrom) {
  if (/FROM_CONTENT/.test(from) && !sentByContent.has(k)) fail(`A.${k} accepts content-script senders without needing to (least privilege)`);
}
notes.push(`${actionKeys.size} actions: ${handledByBackground.size} handled by background, ${handledByContent.size} by content`);

// ------------------------------------------------------------ 3. rules
const ruleIdOk = (rules, label) => {
  const ids = new Set();
  for (const r of rules) {
    if (!Number.isInteger(r.id) || r.id < 1) fail(`${label}: bad id ${r.id}`);
    if (ids.has(r.id)) fail(`${label}: duplicate id ${r.id}`);
    ids.add(r.id);
    if (!Number.isInteger(r.priority) || r.priority < 1) fail(`${label}#${r.id}: bad priority`);
    const c = r.condition || {};
    for (const key of ['requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains']) {
      if (key in c) {
        if (!Array.isArray(c[key]) || c[key].length === 0) fail(`${label}#${r.id}: ${key} must be a non-empty array`);
        else for (const d of c[key]) if (!RW.isValidDomain(d)) fail(`${label}#${r.id}: invalid domain ${d}`);
      }
    }
    if (r.action.type === 'allowAllRequests' && !(c.resourceTypes || []).every((t) => t === 'main_frame' || t === 'sub_frame')) {
      fail(`${label}#${r.id}: allowAllRequests needs main_frame/sub_frame resourceTypes`);
    }
    if (r.action.type === 'redirect' && r.action.redirect.extensionPath && !exists(r.action.redirect.extensionPath)) {
      fail(`${label}#${r.id}: redirect target missing`);
    }
  }
};
for (const rr of manifest.declarative_net_request.rule_resources) {
  ruleIdOk(JSON.parse(read(rr.path)), rr.path);
}
// Compile a representative state and validate it too.
let s = RW.createDefaultState();
s = RW.setSiteTier(s, 'off.example', 'off', 1);
s = RW.setSiteTier(s, 'consent.example', 'consent_only', 1);
s = RW.setSiteTier(s, 'strict.example', 'strict', 1);
s = RW.setSiteCustomOption(s, 'custom.example', 'adBlockNetwork', false, 1);
s = RW.setDomainSlider(s, 'custom.example', 'tracker.example', 'cookie_block', 1);
for (const site of ['a.example', 'b.example', 'c.example']) RW.learnTracker(s, 'learned.example', site, 1);
s = RW.setTrackerGlobalOverride(s, 'manual.example', 'block', 1);
const dyn = RW.compileDynamicRules(s);
ruleIdOk(dyn, 'dynamic');
for (const re of RW.URL_STRIP_REGEXES) if (re.length > 200) fail(`URL strip regex too long: ${re}`);
notes.push(`dynamic compiler produced ${dyn.length} valid rules for the sample state`);

// ------------------------------------------------------------ 4. CMP names
for (const rule of RW.CONSENT_RULES) if (!RW.KNOWN_CMP_NAMES.includes(rule.name)) fail(`consent rule name not in KNOWN_CMP_NAMES: ${rule.name}`);
const mainWorld = read('engines/cmp-main-world.js');
for (const m of mainWorld.matchAll(/name:\s*'([^']+)'/g)) if (!RW.KNOWN_CMP_NAMES.includes(m[1])) fail(`MAIN-world handler name not in KNOWN_CMP_NAMES: ${m[1]}`);

// ------------------------------------------------------------ 5. code hygiene
const shipped = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(e.name)) shipped.push(p);
  }
})(EXT_DIR);
for (const p of shipped) {
  const rel = path.relative(EXT_DIR, p);
  const src = fs.readFileSync(p, 'utf8');
  if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(src)) fail(`${rel}: contains TODO/FIXME`);
  if (/\.js$/.test(rel)) {
    if (/\.innerHTML\s*[+]?=|\.outerHTML\s*=|insertAdjacentHTML\(|document\.write\(/.test(src)) fail(`${rel}: unsafe HTML sink`);
    if (/\beval\(|new Function\(/.test(src)) fail(`${rel}: dynamic code evaluation`);
  }
  if (/[\u2013\u2014]/.test(src)) fail(`${rel}: contains an en or em dash`);
}
notes.push(`${shipped.length} shipped files scanned`);

if (failures.length) {
  console.error(`✗ verification failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
for (const n of notes) console.log(`✓ ${n}`);
console.log('✓ verification passed');
