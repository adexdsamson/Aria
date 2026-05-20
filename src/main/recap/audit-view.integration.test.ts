/**
 * Plan 08-02 Task 1 — action_audit_log VIEW integration tests.
 *
 * Covers:
 *   • Test 1: send_log → email_send arm with parsed payload.
 *   • Test 2 (B-1): calendar_action_log phase filter — INCLUDES post_write/failed/override, EXCLUDES proposed/pre_write.
 *   • Test 2b (B-1): proposed-only seed → zero rows from calendar arm.
 *   • Test 3: meeting_action_task_link + todoist_task → task_pushed arm.
 *   • Test 4: approval(state='rejected') → approval_declined arm.
 *   • Test 5: ORDER BY occurred_at DESC + LIMIT.
 *   • Test 6 (B-2.1): per-arm count parity against base tables.
 *   • Test 6c (H-4): gmail + outlook send_log rows BOTH preserved with their provider values.
 *   • Test 7: weekly_recap schema columns.
 *   • Test 8: weekly_recap_section_edit schema columns.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import { readActionAuditWindow } from './audit-view';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-recap-audit-view');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedApproval(db: ReturnType<typeof freshDb>, id: string, state = 'pending', kind = 'email_send'): void {
  db.prepare(
    `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, kind, state, '2026-05-19T10:00:00.000Z', '2026-05-19T10:00:00.000Z', `idk-${id}`);
}

describe('action_audit_log VIEW', () => {
  let db: ReturnType<typeof freshDb>;

  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('Test 1: send_log → email_send arm with provider preserved', () => {
    seedApproval(db, 'ap-email-1');
    db.prepare(
      `INSERT INTO send_log (approval_id, ts, provider, recipients_json, subject, ok)
       VALUES ('ap-email-1', '2026-05-19T11:00:00.000Z', 'gmail', '["a@x.com"]', 'Hello', 1)`,
    ).run();
    const rows = readActionAuditWindow(db);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('email_send');
    expect(rows[0].provider).toBe('gmail');
    expect(rows[0].outcome).toBe('sent');
  });

  it('Test 2 (B-1): calendar_action_log filter — only post_write/failed/override', () => {
    seedApproval(db, 'ap-cal-1', 'approved', 'calendar_change');
    const phases = ['proposed', 'pre_write', 'post_write', 'failed', 'override'];
    for (const phase of phases) {
      db.prepare(
        `INSERT INTO calendar_action_log (approval_id, phase, event_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run('ap-cal-1', phase, `evt-${phase}`, `2026-05-19T1${phases.indexOf(phase)}:00:00.000Z`);
    }
    const rows = readActionAuditWindow(db).filter((r) => r.kind === 'calendar_change');
    expect(rows.length).toBe(3);
    const includedPhases = rows.map((r) => (r.payload as { phase: string }).phase).sort();
    expect(includedPhases).toEqual(['failed', 'override', 'post_write']);
  });

  it('Test 2b (B-1): proposed-only seed yields zero calendar rows', () => {
    seedApproval(db, 'ap-cal-2', 'approved', 'calendar_change');
    db.prepare(
      `INSERT INTO calendar_action_log (approval_id, phase, event_id, created_at)
       VALUES ('ap-cal-2', 'proposed', 'evt-p', '2026-05-19T10:00:00.000Z')`,
    ).run();
    const rows = readActionAuditWindow(db).filter((r) => r.kind === 'calendar_change');
    expect(rows.length).toBe(0);
  });

  it('Test 3: meeting_action_task_link + todoist_task → task_pushed', () => {
    // Seed a meeting_note + meeting_action + todoist_task + link row.
    db.prepare(
      `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at)
       VALUES ('mn1', 'paste', 'T', 'normalized', '2026-05-19T09:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO meeting_action (id, note_id, text, owner, citation_start, citation_end, created_at, updated_at)
       VALUES ('ma1', 'mn1', 'Follow up', 'self', 0, 5, '2026-05-19T09:00:00.000Z', '2026-05-19T09:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO todoist_task (id, remote_id, content, source, local_updated_at, project_name, is_completed)
       VALUES ('tt1', 'rem-1', 'Send recap', 'aria', '2026-05-19T10:00:00.000Z', 'Inbox', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO meeting_action_task_link (action_id, task_id, remote_id, idempotency_key, created_at)
       VALUES ('ma1', 'tt1', 'rem-1', 'idk-1', '2026-05-19T10:30:00.000Z')`,
    ).run();
    const rows = readActionAuditWindow(db).filter((r) => r.kind === 'task_pushed');
    expect(rows.length).toBe(1);
    expect((rows[0].payload as { content: string }).content).toBe('Send recap');
    expect(rows[0].outcome).toBe('pushed');
  });

  it('Test 4: approval(state=rejected) → approval_declined', () => {
    seedApproval(db, 'ap-reject-1', 'rejected');
    db.prepare(`UPDATE approval SET rejection_reason = 'tone wrong', subject = 'X' WHERE id = 'ap-reject-1'`).run();
    const rows = readActionAuditWindow(db).filter((r) => r.kind === 'approval_declined');
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe('declined');
  });

  it('Test 5: ORDER BY occurred_at DESC + LIMIT', () => {
    seedApproval(db, 'a1');
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO send_log (approval_id, ts, provider, recipients_json, ok)
         VALUES ('a1', ?, 'gmail', '[]', 1)`,
      ).run(`2026-05-19T1${i}:00:00.000Z`);
    }
    const rows = readActionAuditWindow(db, { limit: 3 });
    expect(rows.length).toBe(3);
    expect(rows[0].occurredAt > rows[1].occurredAt).toBe(true);
  });

  it('Test 6 (B-2.1): per-arm count parity', () => {
    seedApproval(db, 'a1');
    seedApproval(db, 'a2', 'rejected');
    db.prepare(
      `INSERT INTO send_log (approval_id, ts, provider, recipients_json, ok) VALUES ('a1', '2026-05-19T10:00:00Z', 'gmail', '[]', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO send_log (approval_id, ts, provider, recipients_json, ok) VALUES ('a1', '2026-05-19T11:00:00Z', 'outlook', '[]', 1)`,
    ).run();
    // Sanity: email_send count from base vs VIEW.
    const baseSend = (db.prepare(`SELECT COUNT(*) AS c FROM send_log`).get() as { c: number }).c;
    const viewSend = readActionAuditWindow(db).filter((r) => r.kind === 'email_send').length;
    expect(viewSend).toBe(baseSend);
    // approval_declined parity.
    const baseDeclined = (db.prepare(`SELECT COUNT(*) AS c FROM approval WHERE state='rejected'`).get() as { c: number }).c;
    const viewDeclined = readActionAuditWindow(db).filter((r) => r.kind === 'approval_declined').length;
    expect(viewDeclined).toBe(baseDeclined);
  });

  it('Test 6c (H-4): outlook + gmail send_log both preserved with their provider', () => {
    seedApproval(db, 'a-g');
    seedApproval(db, 'a-o');
    db.prepare(
      `INSERT INTO send_log (approval_id, ts, provider, recipients_json, subject, ok)
       VALUES ('a-g', '2026-05-19T10:00:00Z', 'gmail', '["alice@example.com"]', 'A', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO send_log (approval_id, ts, provider, recipients_json, subject, ok)
       VALUES ('a-o', '2026-05-19T11:00:00Z', 'outlook', '["bob@contoso.com"]', 'B', 1)`,
    ).run();
    const rows = readActionAuditWindow(db).filter((r) => r.kind === 'email_send');
    expect(rows.length).toBe(2);
    const providers = rows.map((r) => r.provider).sort();
    expect(providers).toEqual(['gmail', 'outlook']);
  });

  it('Test 7: weekly_recap table schema columns', () => {
    const cols = db.prepare(`PRAGMA table_info(weekly_recap)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['canonical_json', 'finalized_at', 'generated_at', 'id', 'iso_week', 'week_start_ymd']);
  });

  it('Test 8: weekly_recap_section_edit table schema columns', () => {
    const cols = db.prepare(`PRAGMA table_info(weekly_recap_section_edit)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['after_text', 'before_text', 'category', 'created_at', 'id', 'recap_id', 'section_key']);
  });
});
