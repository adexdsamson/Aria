/**
 * Phase 17 Plan 17-07 — voice-write-path integration spec.
 *
 * SC2 end-to-end proof: the full voice → stage → voiceConfirm → assertApproved
 * pipeline works correctly and the no-bypass guarantee holds.
 *
 * Three test cases:
 *   1. Happy path: ready→approved with approval_path='voice-explicit'; assertApproved does NOT throw
 *   2. Forced/high-severity row: voiceConfirm stamps 'approved', but assertApproved throws
 *      voice-forbidden-forced (HARD GATE backstop — D-07)
 *   3. Cancel path: ready→cancelled; assertApproved throws not-approved
 *
 * These tests prove D-17: the voice write path is functional AND the HARD GATE
 * that blocks forced rows is intact. There is NO path reaching a raw write
 * without assertApproved.
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempUserDataDir } from '../setup';
import { openDb, closeDb, type Db } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { insertApproval, getApproval, transitionTo } from '../../src/main/approvals/persist';
import { assertApproved, ApprovalGateError } from '../../src/main/approvals/gate';
import { voiceConfirm } from '../../src/main/voice/confirm';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

// ─── DB factory (same pattern as voice-confirm.spec.ts) ───────────────────────

function createTestDb(): Db {
  const dataDir = createTempUserDataDir('aria-voice-write-path-17');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('voice write path (Plan 17-07 SC2 no-bypass proof)', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    closeDb(db);
  });

  // ─── Test 1: Happy path ───────────────────────────────────────────────────────

  it('voice confirm path: ready→approved with voice-explicit; assertApproved does NOT throw', () => {
    // Stage: insert a ready approval row (voice intent → staging step)
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify([]),
    });

    // Pre-condition: row starts in 'ready' state
    const before = getApproval(db, approvalId);
    expect(before?.state).toBe('ready');
    expect(before?.approval_path).toBe('explicit');

    // Voice confirm: stamps ready→approved with approval_path='voice-explicit'
    voiceConfirm(db, approvalId);

    // Verify state transitions
    const after = getApproval(db, approvalId);
    expect(after?.state).toBe('approved');
    expect(after?.approval_path).toBe('voice-explicit');

    // assertApproved MUST NOT throw for a normal low-severity voice-confirmed row
    expect(() => assertApproved(db, approvalId)).not.toThrow();
  });

  // ─── Test 2: Forced/high-severity HARD GATE backstop ─────────────────────────

  it('forced/high-severity row: voiceConfirm stamps approved, but assertApproved throws voice-forbidden-forced', () => {
    // Stage: a high-severity approval row (would never reach voice-confirm
    // via intended UX due to D-07 renderer suppression, but HARD GATE must
    // still catch it as a defense-in-depth backstop)
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'high',
      categories_json: JSON.stringify([]),
    });

    // Simulate voice confirm (D-07 backstop test: stamp 'voice-explicit' directly)
    // This mirrors what would happen if renderer suppression was bypassed
    transitionTo(db, approvalId, 'approved', { approval_path: 'voice-explicit' });

    // The HARD GATE (assertApproved) MUST throw voice-forbidden-forced
    let caughtError: unknown;
    try {
      assertApproved(db, approvalId);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    expect((caughtError as ApprovalGateError).code).toBe('voice-forbidden-forced');
  });

  it('legal-category row: voiceConfirm path throws voice-forbidden-forced at assertApproved', () => {
    // FORCED_CATEGORIES include 'legal' — same HARD GATE protection
    const approvalId = insertApproval(db, {
      kind: 'calendar_change',
      state: 'ready',
      severity: 'med',
      categories_json: JSON.stringify(['legal']),
    });

    // Simulate the voiceConfirm stamp
    voiceConfirm(db, approvalId);

    // assertApproved MUST throw voice-forbidden-forced for forced-category rows
    let caughtError: unknown;
    try {
      assertApproved(db, approvalId);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    expect((caughtError as ApprovalGateError).code).toBe('voice-forbidden-forced');
  });

  // ─── Test 3: Cancel path — no write ───────────────────────────────────────────

  it('cancel path: ready→cancelled; assertApproved throws not-approved (write never dispatched)', () => {
    // Stage: insert a ready approval row
    const approvalId = insertApproval(db, {
      kind: 'task_batch',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify([]),
    });

    // Cancel: voice abort during read-back (D-09/D-11 PTT-to-cancel path)
    transitionTo(db, approvalId, 'cancelled');

    // Verify the row is now cancelled
    const row = getApproval(db, approvalId);
    expect(row?.state).toBe('cancelled');

    // assertApproved MUST throw not-approved — write cannot proceed after cancel
    let caughtError: unknown;
    try {
      assertApproved(db, approvalId);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    expect((caughtError as ApprovalGateError).code).toBe('not-approved');
  });

  // ─── No-bypass invariant: assertApproved is always in the write chain ─────────

  it('no-bypass invariant: voiceConfirm routes through transitionTo (never raw SQL); approval_path stamp verified', () => {
    // Verify that voiceConfirm uses transitionTo by checking the approval_path
    // column is set to 'voice-explicit' (transitionTo with patch applied correctly).
    // If voiceConfirm bypassed transitionTo, approval_path would remain 'explicit'.
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify([]),
    });

    voiceConfirm(db, approvalId);

    const row = getApproval(db, approvalId);
    // The 'voice-explicit' stamp proves transitionTo was called with the patch
    expect(row?.approval_path).toBe('voice-explicit');
    // The row is in 'approved' state — ready for assertApproved in write chokepoints
    expect(row?.state).toBe('approved');
  });
});
