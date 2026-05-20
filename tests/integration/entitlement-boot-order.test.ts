/**
 * Plan 08.1-02 Task 12 — entitlement boot-order integration test.
 *
 * Verifies that a write IPC invoked BEFORE EntitlementService.bootstrap()
 * completes is rejected by the gate. This is the security spine: a renderer
 * cannot race the bootstrap window.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { assertEntitled, EntitlementError } from '../../src/main/entitlement/gate';

const SCHEMA = `
CREATE TABLE entitlement (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  install_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  jwt TEXT,
  jwt_iat TEXT,
  jwt_exp TEXT,
  trial_started_at TEXT,
  trial_expires_at TEXT,
  license_key TEXT,
  last_verified_at TEXT NOT NULL,
  last_check_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE entitlement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  detail TEXT
);
`;

describe('entitlement boot-order', () => {
  it('write IPC before bootstrap completes is rejected with EntitlementError', async () => {
    // Simulates state AFTER migrations ran (entitlement table exists) but
    // BEFORE EntitlementService.bootstrap() inserted the singleton row.
    const db = new Database(':memory:') as unknown as Database.Database;
    db.exec(SCHEMA);
    try {
      await expect(assertEntitled(db, 'email_send')).rejects.toBeInstanceOf(
        EntitlementError,
      );
      await expect(
        assertEntitled(db, 'calendar_change'),
      ).rejects.toBeInstanceOf(EntitlementError);
      await expect(assertEntitled(db, 'task_push')).rejects.toBeInstanceOf(
        EntitlementError,
      );
      await expect(
        assertEntitled(db, 'briefing_generate'),
      ).rejects.toBeInstanceOf(EntitlementError);
      await expect(assertEntitled(db, 'rag_ask')).rejects.toBeInstanceOf(
        EntitlementError,
      );
    } finally {
      db.close();
    }
  });
});
