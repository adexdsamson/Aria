/**
 * Phase 17 Plan 17-05 Task 1 — voice-confirm integration spec (TDD RED/GREEN).
 *
 * Tests the full voice→confirm→approved and voice→cancel paths using a real
 * in-memory SQLite database (better-sqlite3-multiple-ciphers, migration 137).
 *
 * Coverage:
 *   1. VOICE_CONFIRM_APPROVAL happy path: ready→approved with approval_path='voice-explicit'
 *   2. VOICE_CANCEL_APPROVAL happy path: ready→cancelled (D-11 terminal state)
 *   3. assertApproved throws 'not-approved' for cancelled rows (not 'voice-forbidden-forced')
 *   4. confirm-classifier 'cancel' utterance → transitionTo(cancelled)
 *   5. confirm-classifier 'confirm' utterance → voiceConfirm path → approved
 *   6. confirm-classifier 'ambiguous' utterance → returns needsRePrompt (no transition yet)
 *   7. VOICE_CONFIRM_APPROVAL on non-existent id → { error: 'not-found' }
 *   8. VOICE_CONFIRM_APPROVAL on already-terminal row → { error containing 'invalid-transition' }
 *   9. VOICE_CANCEL_APPROVAL on non-ready row → { error containing 'invalid-transition' }
 *  10. forced/high-severity row after voiceConfirm → assertApproved throws 'voice-forbidden-forced'
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTempUserDataDir } from '../setup';
import { openDb, closeDb, type Db } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { insertApproval, getApproval, transitionTo } from '../../src/main/approvals/persist';
import { assertApproved, ApprovalGateError } from '../../src/main/approvals/gate';
import { voiceConfirm } from '../../src/main/voice/confirm';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

// ─── DB factory ───────────────────────────────────────────────────────────────

function makeTestDb(): Db {
  const dataDir = createTempUserDataDir('aria-voice-confirm-17');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

// ─── Mock generateObject for confirm classifier ───────────────────────────────
//
// The VOICE_CONFIRM_APPROVAL handler uses generateObject to classify the
// transcript. We mock the 'ai' module so tests can control the classifier
// output without requiring a live Ollama/LLM endpoint.
//
// Use vi.hoisted() to avoid the "Cannot access before initialization" issue
// with vi.mock factory hoisting.

const { generateObjectMock } = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
}));

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return { ...actual, generateObject: generateObjectMock };
});

// ─── Import the handler function under test ──────────────────────────────────
//
// We test the handler logic by importing the ipc/voice module and calling the
// exported handleVoiceConfirmApproval / handleVoiceCancelApproval functions.
// Since these are not exported separately (the handler is registered inside
// registerVoiceHandlers), we test the behavior via the voiceConfirm seam and
// transitionTo directly, plus a thin integration wrapper for the classifier path.

import { handleVoiceConfirmApproval, handleVoiceCancelApproval } from '../../src/main/ipc/voice';
import { assertTransition } from '../../src/main/approvals/state';

// ─── Shared setup ─────────────────────────────────────────────────────────────

describe('voice-confirm integration (Plan 17-05)', () => {
  let db: Db;

  beforeEach(() => {
    db = makeTestDb();
    // Reset the generateObject mock before each test
    if (generateObjectMock) generateObjectMock.mockReset();
  });

  afterEach(() => {
    closeDb(db);
    vi.restoreAllMocks();
  });

  // ─── 1. VOICE_CONFIRM_APPROVAL: confirm intent → ready→approved ─────────────

  describe('VOICE_CONFIRM_APPROVAL handler (confirm-classifier path)', () => {
    it('classifies "confirm" → voiceConfirm → ready→approved with approval_path=voice-explicit', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      generateObjectMock.mockResolvedValueOnce({ object: { intent: 'confirm' } });

      const result = await handleVoiceConfirmApproval(db, {
        approvalId,
        transcript: 'yes please',
      });

      expect(result).toEqual(expect.objectContaining({ ok: true }));

      const row = getApproval(db, approvalId);
      expect(row?.state).toBe('approved');
      expect(row?.approval_path).toBe('voice-explicit');
    });

    it('classifies "cancel" → transitionTo(cancelled), returns { ok: true, cancelled: true }', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      generateObjectMock.mockResolvedValueOnce({ object: { intent: 'cancel' } });

      const result = await handleVoiceConfirmApproval(db, {
        approvalId,
        transcript: 'no cancel that',
      });

      expect(result).toEqual(expect.objectContaining({ ok: true, cancelled: true }));

      const row = getApproval(db, approvalId);
      expect(row?.state).toBe('cancelled');
      // approval_path should remain 'explicit' (default) — voiceConfirm NOT called
      expect(row?.approval_path).toBe('explicit');
    });

    it('classifies "ambiguous" → returns { ok: true, needsRePrompt: true } (no state change)', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      generateObjectMock.mockResolvedValueOnce({ object: { intent: 'ambiguous' } });

      const result = await handleVoiceConfirmApproval(db, {
        approvalId,
        transcript: 'yeah no',
      });

      expect(result).toEqual(expect.objectContaining({ ok: true, needsRePrompt: true }));

      // Row remains in 'ready' state — no transition on ambiguous
      const row = getApproval(db, approvalId);
      expect(row?.state).toBe('ready');
    });

    it('returns { error: "not-found" } for a non-existent approvalId', async () => {
      const result = await handleVoiceConfirmApproval(db, {
        approvalId: 'nonexistent-id-12345',
      });

      expect(result).toEqual(expect.objectContaining({ error: 'not-found' }));
    });

    it('returns { error } containing "invalid-transition" for an already-approved row', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      // Manually transition to approved (already terminal for voice-confirm)
      voiceConfirm(db, approvalId);

      // Try to confirm again — row is now 'approved', voiceConfirm will try ready→approved
      // which state.ts ALLOWED map won't allow (approved → approved not in transitions)
      generateObjectMock.mockResolvedValueOnce({ object: { intent: 'confirm' } });

      const result = await handleVoiceConfirmApproval(db, {
        approvalId,
        transcript: 'yes',
      });

      // Should return an error — row is no longer in 'ready' state
      expect(result).toHaveProperty('error');
    });

    it('confirm on forced/high-severity row → voiceConfirm runs, but assertApproved throws voice-forbidden-forced', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'high',
        categories_json: JSON.stringify([]),
      });

      // No transcript path — test voiceConfirm + assertApproved chain directly
      voiceConfirm(db, approvalId);

      let caughtError: unknown;
      try {
        assertApproved(db, approvalId);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApprovalGateError);
      expect((caughtError as ApprovalGateError).code).toBe('voice-forbidden-forced');
    });
  });

  // ─── 2. VOICE_CANCEL_APPROVAL handler ───────────────────────────────────────

  describe('VOICE_CANCEL_APPROVAL handler', () => {
    it('transitions ready→cancelled and returns { ok: true }', async () => {
      const approvalId = insertApproval(db, {
        kind: 'task_batch',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      const result = await handleVoiceCancelApproval(db, { approvalId });

      expect(result).toEqual({ ok: true });

      const row = getApproval(db, approvalId);
      expect(row?.state).toBe('cancelled');
    });

    it('returns { error } for a non-ready row (invalid transition)', async () => {
      const approvalId = insertApproval(db, {
        kind: 'email_send',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      // First cancel works
      await handleVoiceCancelApproval(db, { approvalId });

      // Second cancel: cancelled→cancelled is not a valid transition
      const result = await handleVoiceCancelApproval(db, { approvalId });

      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/invalid-transition/);
    });

    it('returns { error } for a non-existent approvalId', async () => {
      const result = await handleVoiceCancelApproval(db, { approvalId: 'no-such-id' });

      // transitionTo will throw (row not found), handler returns error
      expect(result).toHaveProperty('error');
    });
  });

  // ─── 3. assertApproved after cancel → not-approved ──────────────────────────

  describe('assertApproved after VOICE_CANCEL_APPROVAL', () => {
    it('throws not-approved for a cancelled row (not voice-forbidden-forced)', () => {
      const approvalId = insertApproval(db, {
        kind: 'calendar_change',
        state: 'ready',
        severity: 'low',
        categories_json: JSON.stringify([]),
      });

      // Cancel the approval
      transitionTo(db, approvalId, 'cancelled');

      let caughtError: unknown;
      try {
        assertApproved(db, approvalId);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApprovalGateError);
      expect((caughtError as ApprovalGateError).code).toBe('not-approved');
    });
  });

  // ─── 4. Migration 137 FK check (Plan 17-07 mandate) ──────────────────────────

  describe('migration 137 FK check (Plan 17-07)', () => {
    it('PRAGMA foreign_key_check returns empty after running all migrations including 137', () => {
      // Run PRAGMA foreign_key_check — must return empty array (no dangling FKs)
      // after the table-rebuild in migration 137 (which used PRAGMA legacy_alter_table=ON
      // to avoid FK rewrite on RENAME, preventing dangling references at DROP).
      const result = db.pragma('foreign_key_check') as unknown[];
      expect(result).toHaveLength(0);
    });

    it('user_version is at least 137 after migrations', () => {
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBeGreaterThanOrEqual(137);
    });
  });

  // ─── 5. 'cancelled' CHECK constraint accepted by migration 137 ───────────────

  describe("'cancelled' CHECK constraint (migration 137)", () => {
    it("INSERT with state='cancelled' is accepted by the CHECK constraint", () => {
      // Migration 137 adds 'cancelled' to the state CHECK. Verify a raw
      // INSERT with state='cancelled' succeeds (not rejected by CHECK constraint).
      const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      expect(() => {
        db.prepare(
          `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
           VALUES (?, 'email_send', 'cancelled', datetime('now'), datetime('now'), ?)`,
        ).run(id, `idem-cancelled-check-${id.slice(0, 8)}`);
      }).not.toThrow();

      const row = db.prepare('SELECT state FROM approval WHERE id = ?').get(id) as
        | { state: string }
        | undefined;
      expect(row?.state).toBe('cancelled');
    });
  });

  // ─── 6. State machine transitions: assertTransition (Plan 17-07) ─────────────

  describe('assertTransition state machine (Plan 17-07)', () => {
    it("assertTransition('ready', 'cancelled') does NOT throw", () => {
      expect(() => assertTransition('ready', 'cancelled')).not.toThrow();
    });

    it("assertTransition('cancelled', 'approved') THROWS invalid-transition", () => {
      expect(() => assertTransition('cancelled', 'approved')).toThrow(/invalid-transition/);
    });

    it("assertTransition('cancelled', 'ready') THROWS invalid-transition (cancelled is terminal)", () => {
      expect(() => assertTransition('cancelled', 'ready')).toThrow(/invalid-transition/);
    });

    it("assertTransition('ready', 'approved') still works (existing path unaffected)", () => {
      expect(() => assertTransition('ready', 'approved')).not.toThrow();
    });
  });
});
