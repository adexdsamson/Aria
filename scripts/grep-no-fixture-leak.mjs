#!/usr/bin/env node
/**
 * Plan 08-04 Task 8 (M-3 round 2) — fixture-leak guard.
 *
 * The deliberately-failing migration `tests/fixtures/999_force_fail.sql`
 * is consumed only by the Phase-8 happy-path E2E Step 9 under
 * `ARIA_E2E_FORCE_MIGRATION_FAIL=true`. It MUST NEVER be referenced by
 * `src/main/db/migrations/embedded.ts` — otherwise a packaged production
 * build would include it in the runner queue and crash every user on
 * first launch.
 *
 * Exits non-zero if `999_force_fail` appears anywhere under
 * `src/main/db/migrations/`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd(), 'src/main/db/migrations');

const violations = [];
for (const entry of readdirSync(ROOT)) {
  if (!entry.endsWith('.ts') && !entry.endsWith('.sql')) continue;
  const full = join(ROOT, entry);
  const text = readFileSync(full, 'utf8');
  if (text.includes('999_force_fail')) {
    violations.push(relative(process.cwd(), full));
  }
}

if (violations.length > 0) {
  console.error('FAIL — fixture leak: 999_force_fail referenced in prod migration tree:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('OK — 999_force_fail fixture is not referenced from src/main/db/migrations/.');
