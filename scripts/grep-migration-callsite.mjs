#!/usr/bin/env node
/**
 * Plan 08-04 Task 4a — static grep ratchet enforcing the single-call-site
 * invariant for the migration runner.
 *
 * After B-1 round 2 the only allowed invocations of the raw migration
 * function across the codebase are:
 *   - the definition itself in src/main/db/migrations/runner.ts
 *   - the wrapper in src/main/release/backup-hook.ts (which the boot path
 *     calls via runMigrationsWithBackup)
 *
 * Everything else (onboarding seal/unlock, backup-restore, restore.ts)
 * MUST flow through `runMigrationsWithBackup`. Bare `runMigrations(db)`
 * calls anywhere else recreate the recursion hazard that round 2 caught.
 *
 * Self-test: adding `runMigrations(db);` to any file under src/main/ipc/
 * causes this script to exit non-zero with a clear diagnostic.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

const ALLOWED_FILES = new Set([
  // Definition
  resolve(process.cwd(), 'src/main/db/migrations/runner.ts').replaceAll('\\', '/'),
  // Single sanctioned wrapper
  resolve(process.cwd(), 'src/main/release/backup-hook.ts').replaceAll('\\', '/'),
  // Plan 08-04 Task 4a back-compat path: openDb retains a default-true
  // runMigrationsOnOpen branch so unit tests that call openDb({ dataDir,
  // dbKey }) directly still see a migrated schema. All production callers
  // (onboarding seal/unlock, backup-restore, restore.ts, main/index.ts)
  // pass either 'deferred' or false and flow through runMigrationsWithBackup.
  resolve(process.cwd(), 'src/main/db/connect.ts').replaceAll('\\', '/'),
]);

// Match a bare invocation: `runMigrations(` followed by a non-`W` (so we
// don't false-positive on `runMigrationsWithBackup(`).
const CALL_RE = /\brunMigrations\s*\(/;
const WRAPPER_RE = /\brunMigrationsWithBackup\s*\(/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && /\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const normalized = file.replaceAll('\\', '/');
  if (ALLOWED_FILES.has(normalized)) continue;
  // Skip test files — they exercise the runner directly by design.
  if (/\.(test|spec)\.tsx?$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // Strip the `runMigrationsWithBackup(...)` segments first so the
    // remaining text only contains the disallowed bare-call shape.
    const stripped = line.replace(WRAPPER_RE, '');
    if (CALL_RE.test(stripped)) {
      violations.push({ file: relative(process.cwd(), file), line: i + 1, text: line.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error('FAIL — bare runMigrations(...) call outside allowed files:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error('\nAll callers must invoke runMigrationsWithBackup(...) from src/main/release/backup-hook.ts.');
  process.exit(1);
}

console.log('OK — runMigrations call-site invariant intact.');
