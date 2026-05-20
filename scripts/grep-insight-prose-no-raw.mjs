#!/usr/bin/env node
/**
 * Static-grep ratchet for INSIGHT-03 (T-08-01).
 *
 * Asserts that `src/main/insights/prose.ts` never imports any module that
 * exposes raw user content, and never references raw-content column names
 * in string literals. The point is to make leaking raw email bodies / calendar
 * titles / transcript text into the insight-prose prompt impossible to merge.
 *
 * Wired into `package.json` → `lint:guard` and gated in `test:unit` (pretest).
 * Exits 1 with a clear diagnostic on any violation.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSE_PATH = resolve(__dirname, '..', 'src', 'main', 'insights', 'prose.ts');

const FORBIDDEN_IMPORT_FRAGMENTS = [
  // table/module path fragments → if prose.ts ever imports a module whose
  // path contains any of these, it has access to raw content. Block.
  'gmail_message',
  'gmail/',
  'calendar_event',
  'calendar/',
  'meeting_note',
  'meeting/',
  'meeting-note',
  'rag_chunk',
  'rag/',
  'transcripts',
  'transcript/',
  'briefing/redact', // would imply we're touching raw briefing payloads
];

// Column/field names that must NOT appear as string literals anywhere in
// prose.ts (used to assert no SQL query string sneaks raw content in).
const FORBIDDEN_LITERALS = [
  'body_original',
  'body_edited',
  'snippet',
  'transcript',
  'normalized_text',
  'meeting_note_segment',
  'rag_chunk',
];

const src = readFileSync(PROSE_PATH, 'utf8');
const violations = [];

// --- import scan ---
const importRe = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;
let m;
while ((m = importRe.exec(src)) !== null) {
  const spec = m[1];
  for (const frag of FORBIDDEN_IMPORT_FRAGMENTS) {
    if (spec.includes(frag)) {
      violations.push(`forbidden import from "${spec}" (matches "${frag}")`);
    }
  }
}

// --- literal scan ---
// Strip block + line comments first so we don't false-positive on documentation.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

for (const lit of FORBIDDEN_LITERALS) {
  const re = new RegExp(`['"\`][^'"\`]*\\b${lit}\\b[^'"\`]*['"\`]`);
  if (re.test(codeOnly)) {
    violations.push(`forbidden literal "${lit}" appears in a string in prose.ts`);
  }
}

if (violations.length > 0) {
  console.error('[grep-insight-prose-no-raw] FAIL — INSIGHT-03 invariant violated:');
  for (const v of violations) console.error('  - ' + v);
  console.error('prose.ts MUST only see numeric aggregates + cluster LABELS.');
  process.exit(1);
}

console.log('[grep-insight-prose-no-raw] OK — prose.ts contains no raw-content imports or literals.');
process.exit(0);
