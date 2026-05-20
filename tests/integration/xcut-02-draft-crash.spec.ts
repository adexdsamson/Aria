/**
 * Plan 08-03 Task 6 — XCUT-02 crash persistence invariant.
 *
 * An approval row left in 'generating' state when the process exits MUST NOT
 * auto-transition to 'sent' on relaunch. The Phase 3 state machine's
 * reapInterruptedOnStartup converts 'generating' → 'interrupted' BEFORE any
 * IPC handler can be invoked.
 *
 * Stream 3 owns this test (per CONTEXT cross-cutting note) because the
 * learning signal log + approval chokepoint share the same persist module
 * under inspection. Implemented as a Vitest integration test against a real
 * SQLite + simulated process restart (open / close / reopen).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../setup';
import { reapInterruptedOnStartup } from '../../src/main/approvals/persist';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

describe('XCUT-02 — draft never auto-transitions to sent across simulated crash', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-xcut-02');
    dbKey = crypto.randomBytes(32);
  });

  it('Tests 1-6 (combined): generating draft survives crash, never auto-sent, no send_log row', () => {
    // 1. open db, seed an approval row in 'generating' state
    let db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const approvalId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, approval_path,
                              subject, body_original, idempotency_key)
       VALUES (?, 'email_send', 'generating', ?, ?, 'explicit', ?, ?, ?)`,
    ).run(
      approvalId,
      now,
      now,
      'Interrupted draft',
      'Half-written body...',
      crypto.randomUUID().replace(/-/g, '').toLowerCase(),
    );

    const seeded = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(approvalId) as { state: string };
    expect(seeded.state).toBe('generating');

    // 2. simulate process crash: close db without graceful state transition
    closeDb(db);

    // 3. relaunch: reopen + run the startup reap BEFORE any IPC could fire
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const reaped = reapInterruptedOnStartup(db);
    expect(reaped).toBeGreaterThanOrEqual(1);

    // 4. row state is 'interrupted' — NEVER 'sent'
    const after = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(approvalId) as { state: string };
    expect(after.state).toBe('interrupted');
    expect(after.state).not.toBe('sent');

    // 5. no send_log row for this draft
    const sendLogRows = db
      .prepare(`SELECT COUNT(*) AS c FROM send_log WHERE approval_id = ?`)
      .get(approvalId) as { c: number };
    expect(sendLogRows.c).toBe(0);

    // 6. no learning_signals row claiming an action for this approval
    //    (the EMIT-AFTER-EXTERNAL-WRITE contract from Task 3 must hold across
    //    a crash — no orphan signal can claim a send that never happened).
    const signals = db
      .prepare(
        `SELECT COUNT(*) AS c FROM learning_signals WHERE source='approval' AND payload_json LIKE ?`,
      )
      .get(`%${approvalId}%`) as { c: number };
    expect(signals.c).toBe(0);

    closeDb(db);
  });

  it('reapInterruptedOnStartup is idempotent across multiple relaunches', () => {
    let db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO approval (id, kind, state, created_at, updated_at, approval_path, idempotency_key)
       VALUES (?, 'email_send', 'generating', ?, ?, 'explicit', ?)`,
    ).run(id, now, now, crypto.randomUUID().replace(/-/g, ''));
    closeDb(db);

    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const first = reapInterruptedOnStartup(db);
    expect(first).toBeGreaterThanOrEqual(1);
    const second = reapInterruptedOnStartup(db);
    expect(second).toBe(0); // already 'interrupted'; no rows to convert
    closeDb(db);
  });
});
