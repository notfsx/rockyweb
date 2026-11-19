// Loads the extension's classic shared scripts into Node and returns globalThis.RockyShared.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(here, '..', 'extension');
const require = createRequire(import.meta.url);

export function loadShared() {
  for (const f of [
    'shared/constants.js',
    'shared/domain.js',
    'shared/filter-lists.js',
    'shared/config.js',
    'shared/rules-compiler.js',
    'shared/cosmetic-lists.js',
    'shared/ai-policy.js',
    'shared/page-edits.js',
    'engines/consent-rules.js',
    'engines/ai-broker.js'
  ]) {
    require(path.join(EXT_DIR, f));
  }
  return globalThis.RockyShared;
}
