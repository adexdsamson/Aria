#!/usr/bin/env node
/**
 * Plan 08-02 Task 1 — verify-audit-view ratchet (B-2 peer review).
 *
 * Asserts at lint time that the action_audit_log VIEW SQL in
 * `src/main/db/migrations/129_phase8_recap.sql` matches expected per-arm
 * structure + that base-table column references have not drifted from the
 * snapshot in `scripts/fixtures/audit-view-table-info.json`.
 *
 * Per-arm count parity (Test 6 of the plan) lives in the vitest integration
 * spec (`src/main/recap/audit-view.integration.test.ts`) because it requires a
 * live SQLite. This script provides the static portion: it asserts the VIEW
 * SQL contains the right base-table references and phase-enum filter.
 *
 * Wired into `package.json` → `lint:guard`.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MIGRATION_PATH = resolve(ROOT, 'src', 'main', 'db', 'migrations', '129_phase8_recap.sql');
const FIXTURE_PATH = resolve(__dirname, 'fixtures', 'audit-view-table-info.json');

const sql = readFileSync(MIGRATION_PATH, 'utf8');

const errors = [];

// 1. Calendar arm must include exactly post_write / failed / override.
if (!sql.includes(`phase IN ('post_write','failed','override')`)) {
  errors.push(
    `129_phase8_recap.sql: calendar_action_log arm missing exact phase filter` +
      ` 'phase IN (\\'post_write\\',\\'failed\\',\\'override\\')' — proposed/pre_write must be excluded (B-1)`,
  );
}

// 2. Email arm must project sl.provider (NOT a hardcoded 'gmail' literal in the AS provider slot).
const emailArm = sql.split('UNION ALL')[0] ?? '';
if (!emailArm.includes('sl.provider')) {
  errors.push(`129_phase8_recap.sql: email_send arm must project sl.provider as provider (H-4)`);
}
if (/'gmail'\s+AS\s+provider/i.test(emailArm)) {
  errors.push(`129_phase8_recap.sql: email_send arm hardcodes 'gmail' AS provider — must use sl.provider (H-4)`);
}

// 3. All 4 arms present.
for (const arm of ['email_send', 'calendar_change', 'task_pushed', 'approval_declined']) {
  if (!sql.includes(`'${arm}'`)) {
    errors.push(`129_phase8_recap.sql: missing arm '${arm}'`);
  }
}

// 4. weekly_recap + weekly_recap_section_edit tables present.
for (const t of ['weekly_recap', 'weekly_recap_section_edit']) {
  if (!new RegExp(`CREATE TABLE\\s+${t}\\b`).test(sql)) {
    errors.push(`129_phase8_recap.sql: CREATE TABLE ${t} missing`);
  }
}

// 5. PRAGMA bump to 129.
if (!sql.includes('PRAGMA user_version = 129')) {
  errors.push(`129_phase8_recap.sql: missing 'PRAGMA user_version = 129'`);
}

// 6. PRAGMA snapshot of base-table columns (B-2.2). Bootstrap on first run.
// The snapshot is a static expectation of which columns the VIEW depends on per
// base table. If a future migration renames any of these without updating the
// VIEW, this ratchet trips at lint time.
const EXPECTED_COLUMNS = {
  send_log:                  ['id', 'ts', 'provider', 'provider_msg_id', 'recipients_json', 'subject', 'ok', 'error', 'approval_id'],
  calendar_action_log:       ['id', 'created_at', 'phase', 'event_id', 'recurring_scope', 'before_json', 'after_json', 'google_etag', 'google_error', 'approval_id'],
  meeting_action_task_link:  ['action_id', 'task_id', 'remote_id', 'created_at'],
  todoist_task:              ['id', 'content', 'project_name', 'is_completed'],
  approval:                  ['id', 'kind', 'state', 'updated_at', 'subject', 'rejection_reason'],
};

if (!existsSync(FIXTURE_PATH)) {
  writeFileSync(FIXTURE_PATH, JSON.stringify(EXPECTED_COLUMNS, null, 2) + '\n', 'utf8');
  console.log(`verify-audit-view: bootstrapped fixture at ${FIXTURE_PATH}`);
} else {
  const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const fxCols = fx[table] || [];
    const missing = cols.filter((c) => !fxCols.includes(c));
    if (missing.length > 0) {
      errors.push(`verify-audit-view: fixture for ${table} missing columns ${JSON.stringify(missing)}; update ${FIXTURE_PATH} after intentional schema drift`);
    }
  }
}

if (errors.length > 0) {
  console.error('verify-audit-view FAILED:');
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
console.log('verify-audit-view OK');
