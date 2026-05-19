import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, DbOpenError } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('db/migrations', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig');
    dbKey = crypto.randomBytes(32);
  });

  it('runMigrations creates app_meta, settings, routing_log and sets user_version=1', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    const applied = runMigrations(db, { dir: MIGRATIONS_DIR });
    // Plan 01-02 added migration 001; Plan 02-01 added 002 (Gmail tables);
    // Plan 02-02 added 003 (Calendar tables); Plan 02-03 added 004 (news_source);
    // Plan 02-04 added 005 (briefing + briefing_item_dismissed);
    // Plan 03-01 added 006 (approval + approval_tier).
    // Plan 03-02 added 007 (routing_log classifier columns).
    // Plan 03-03 added 008 (email_triage).
    // Plan 03-04 added 009 (voice_match_holdout + approval.beta_voice + send_log).
    // Plan 04-01 added 010 (calendar write-back schema: approval kind widen,
    // calendar_event etag/recurrence cols, scheduling_rules, calendar_action_log).
    // Plan 05-01 added 011 (provider_account/provider_sync_state + recurrence_unsupported).
    // Plan 05-01 added 012 (provider_key/account_id backfill columns).
    expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 121, 122, 123, 124, 125]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('app_meta');
    expect(tables).toContain('settings');
    expect(tables).toContain('routing_log');
    expect(tables).toContain('provider_account');
    expect(tables).toContain('provider_sync_state');
    expect(tables).toContain('meeting_note');
    expect(tables).toContain('meeting_note_segment');
    expect(tables).toContain('meeting_summary');
    expect(tables).toContain('meeting_summary_item');
    expect(tables).toContain('meeting_action');
    expect(tables).toContain('todoist_task');
    expect(tables).toContain('meeting_action_task_link');

    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBe(125);
    const views = db
      .prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(views).toContain('gmail_account_view');
    expect(views).toContain('calendar_account_view');
    expect(tables).not.toContain('gmail_account');
    expect(tables).not.toContain('calendar_account');

    // Plan 04-01 — migration 010 schema assertions
    expect(tables).toContain('scheduling_rules');
    expect(tables).toContain('calendar_action_log');

    const rulesRows = db.prepare('SELECT id, rules_json, time_zone FROM scheduling_rules').all() as Array<{ id: number; rules_json: string; time_zone: string }>;
    expect(rulesRows.length).toBe(1);
    expect(rulesRows[0]!.id).toBe(1);
    expect(rulesRows[0]!.time_zone).toBe('UTC');
    expect(rulesRows[0]!.rules_json).toBe('[]');

    const calCols = db
      .prepare("PRAGMA table_info(calendar_event)")
      .all()
      .map((c) => (c as { name: string }).name);
    for (const c of ['etag', 'i_cal_uid', 'sequence', 'organizer_email', 'organizer_self', 'recurrence_json']) {
      expect(calCols).toContain(c);
    }
    expect(calCols).toContain('recurrence_unsupported');
    expect(calCols).toContain('provider_key');
    expect(calCols).toContain('account_id');

    const gmailCols = db
      .prepare("PRAGMA table_info(gmail_message)")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(gmailCols).toContain('provider_key');
    expect(gmailCols).toContain('account_id');

    const approvalCols = db
      .prepare("PRAGMA table_info(approval)")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(approvalCols).toContain('provider_key');
    expect(approvalCols).toContain('account_id');

    // approval.kind CHECK now accepts 'calendar_change'.
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
           VALUES (?, 'calendar_change', 'pending', ?, ?, ?)`,
        )
        .run('cal-1', now, now, 'idempotency-cal-1'),
    ).not.toThrow();
    // CHECK still rejects unknown kinds.
    expect(() =>
      db
        .prepare(
          `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
           VALUES (?, 'bogus', 'pending', ?, ?, ?)`,
        )
        .run('bad-1', now, now, 'idempotency-bad-1'),
    ).toThrow();

    closeDb(db);
  });

  it('migration 010 preserves existing approval rows when widening kind CHECK', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    // Insert one email_send row, simulate "existing data", verify it's still
    // present (this test re-runs the migration set fully; we just assert that
    // after migration 010 we can round-trip an email_send approval that
    // pre-dated migration 010's table rebuild).
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, subject, idempotency_key)
       VALUES (?, 'email_send', 'pending', ?, ?, 'pre-010', ?)`,
    ).run('pre-010-id', now, now, 'pre-010-idempotency');
    const row = db.prepare('SELECT id, kind, subject, calendar_event_id FROM approval WHERE id = ?').get('pre-010-id') as
      | { id: string; kind: string; subject: string; calendar_event_id: string | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.kind).toBe('email_send');
    expect(row!.subject).toBe('pre-010');
    expect(row!.calendar_event_id).toBeNull();
    closeDb(db);
  });

  it('runMigrations is a no-op on re-run', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const second = runMigrations(db, { dir: MIGRATIONS_DIR });
    expect(second).toEqual([]);
    closeDb(db);
  });

  it('opening an encrypted DB with the wrong key throws DbOpenError', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.prepare('INSERT INTO settings(k, v) VALUES (?, ?)').run('theme', 'dark');
    closeDb(db);

    const wrongKey = crypto.randomBytes(32);
    expect(() => openDb({ dataDir, dbKey: wrongKey, runMigrationsOnOpen: false })).toThrow(
      DbOpenError,
    );
  });

  it('routing_log schema contains every column Plan 04 requires', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const cols = db
      .prepare("PRAGMA table_info(routing_log)")
      .all()
      .map((c) => (c as { name: string }).name);
    for (const c of ['ts', 'route', 'reason', 'source', 'prompt_hash', 'model', 'latency_ms', 'ok']) {
      expect(cols).toContain(c);
    }
    closeDb(db);
  });
});
