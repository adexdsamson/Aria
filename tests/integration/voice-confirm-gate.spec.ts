/**
 * Phase 14 SC2 + SC4 integration tests — voice-confirm gate contract.
 *
 * SC2 (failing-then-passing gate test — D-12):
 *   - A forced/high-severity row confirmed via voiceConfirm MUST trigger the
 *     named 'voice-forbidden-forced' error code from assertApproved — the
 *     SPECIFIC code, NOT the generic 'forced-explicit-missing'.
 *   - TWO-STATE EXPECTATION (failing-then-passing): This test FAILS before
 *     Task 1's named branch lands in gate.ts (the forced voice-explicit row
 *     would throw the generic 'forced-explicit-missing' code); PASSES after.
 *   - A low/med non-forced row with approval_path='voice-explicit' PASSES
 *     assertApproved (companion passing case).
 *
 * SC4 (same-transition + unchanged-adapter test — D-12):
 *   - voiceConfirm fires the SAME ready→approved edge the Approvals UI fires.
 *   - After voiceConfirm, sendApprovedEmail runs its unchanged first-line
 *     assertApproved at send.ts:146 (D-05/D-06: same edge by construction).
 *   - For a low/med email_send: send adapter reaches the stubbed Gmail client.
 *   - For a forced email_send: send adapter's assertApproved throws
 *     'voice-forbidden-forced' before reaching the client.
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTempUserDataDir } from '../setup';
import { openDb, closeDb, type Db } from '../../src/main/db/connect';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { insertApproval } from '../../src/main/approvals/persist';
import { assertApproved, ApprovalGateError } from '../../src/main/approvals/gate';
import { voiceConfirm } from '../../src/main/voice/confirm';
import { sendApprovedEmail } from '../../src/main/integrations/send';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/db/migrations');

// ─── Test DB factory ──────────────────────────────────────────────────────────

function makeTestDb(): Db {
  const dataDir = createTempUserDataDir('aria-voice-gate-int');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

// ─── SC2: failing-then-passing gate test ─────────────────────────────────────

describe('SC2 — voice-forbidden-forced gate (D-12)', () => {
  let db: Db;

  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => { closeDb(db); });

  it('throws the SPECIFIC voice-forbidden-forced code for a forced (category=financial) voice-explicit row', () => {
    // TWO-STATE EXPECTATION:
    // BEFORE Task 1 (gate.ts named branch): this test FAILS — assertApproved
    //   would throw code='forced-explicit-missing' (the generic branch).
    // AFTER Task 1 (gate.ts named branch): this test PASSES — the named
    //   branch fires first, throwing code='voice-forbidden-forced'.

    // Seed a forced (financial category) ready row
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'med',
      categories_json: JSON.stringify(['financial']),
    });

    // voiceConfirm transitions ready→approved with approval_path='voice-explicit'
    voiceConfirm(db, approvalId);

    // assertApproved MUST throw the SPECIFIC named code, NOT 'forced-explicit-missing'
    // A toBe('forced-explicit-missing') assertion here is FORBIDDEN (plan requirement)
    let caughtError: unknown;
    try {
      assertApproved(db, approvalId);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    expect((caughtError as ApprovalGateError).code).toBe('voice-forbidden-forced');
  });

  it('throws voice-forbidden-forced for a severity=high voice-explicit row', () => {
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'high',
      categories_json: JSON.stringify([]),
    });

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

  it('passes assertApproved for a low/med non-forced voice-explicit row (companion passing case)', () => {
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify(['general']),
    });

    voiceConfirm(db, approvalId);

    // assertApproved MUST return without throwing for low/med non-forced
    expect(() => assertApproved(db, approvalId)).not.toThrow();
  });

  it('still passes assertApproved for a forced row with approval_path=explicit (existing behavior unchanged)', () => {
    // Verify the existing generic branch is unaffected — explicit path still passes
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'high',
      categories_json: JSON.stringify(['financial']),
    });

    // Transition via the UI path (explicit)
    db.prepare(
      `UPDATE approval SET state = 'approved', approval_path = 'explicit', updated_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), approvalId);

    // Should NOT throw — explicit path satisfies the forced requirement
    expect(() => assertApproved(db, approvalId)).not.toThrow();
  });

  it('still throws forced-explicit-missing for a forced row with approval_path=silent (generic branch intact)', () => {
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'high',
      categories_json: JSON.stringify([]),
    });

    // Simulate a silent-path approval (not voice)
    db.prepare(
      `UPDATE approval SET state = 'approved', approval_path = 'silent', updated_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), approvalId);

    let caughtError: unknown;
    try {
      assertApproved(db, approvalId);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    // Generic code — NOT the voice-specific one
    expect((caughtError as ApprovalGateError).code).toBe('forced-explicit-missing');
  });
});

// ─── SC4: same-transition + unchanged-adapter test ───────────────────────────

describe('SC4 — voiceConfirm fires UI-identical transition; send adapter assertApproved unchanged (D-12)', () => {
  let db: Db;

  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => { closeDb(db); });

  it('voiceConfirm then sendApprovedEmail: low/med non-forced row reaches the stubbed Gmail client (assertApproved runs + passes)', async () => {
    // Seed a low/med email_send ready row
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'low',
      categories_json: JSON.stringify([]),
      recipients_json: JSON.stringify(['test@example.com']),
      subject: 'Test Subject',
      body_edited: 'Test body',
      // provider_key=null → supportsLegacyGoogleOverride returns true (default google)
    });

    // voiceConfirm fires the SAME ready→approved edge the UI fires (D-05)
    voiceConfirm(db, approvalId);

    // Verify state after voiceConfirm
    const row = db
      .prepare('SELECT state, approval_path FROM approval WHERE id = ?')
      .get(approvalId) as { state: string; approval_path: string };
    expect(row.state).toBe('approved');
    expect(row.approval_path).toBe('voice-explicit');

    // Call sendApprovedEmail with a stubbed buildGmailClient
    // The stub records the call — if assertApproved at send.ts:146 passes,
    // the flow reaches the client (proving assertApproved ran + succeeded).
    const fakeSend = vi.fn(async () => ({
      data: { id: 'fake-msg-id-1' },
    }));
    const fakeGmailClient = {
      users: {
        messages: {
          send: fakeSend,
        },
      },
    };

    const result = await sendApprovedEmail(db, approvalId, {
      buildGmailClient: vi.fn(async () => fakeGmailClient as never),
    });

    // The flow reached the client — assertApproved at send.ts:146 PASSED
    expect(result.ok).toBe(true);
    expect(fakeSend).toHaveBeenCalledTimes(1);
  });

  it('voiceConfirm then sendApprovedEmail: forced (financial) row is REJECTED at send adapter assertApproved with voice-forbidden-forced', async () => {
    // Seed a forced (financial) email_send ready row
    const approvalId = insertApproval(db, {
      kind: 'email_send',
      state: 'ready',
      severity: 'med',
      categories_json: JSON.stringify(['financial']),
      recipients_json: JSON.stringify(['boss@example.com']),
      subject: 'Q3 financials',
      body_edited: 'See attached',
    });

    // voiceConfirm transitions to approved with voice-explicit
    voiceConfirm(db, approvalId);

    // sendApprovedEmail's assertApproved (send.ts:146) MUST reject this row
    const fakeSend = vi.fn();

    let caughtError: unknown;
    try {
      await sendApprovedEmail(db, approvalId, {
        buildGmailClient: vi.fn(async () => ({ users: { messages: { send: fakeSend } } }) as never),
      });
    } catch (err) {
      caughtError = err;
    }

    // Gate holds — the SPECIFIC voice-forbidden-forced code is thrown
    expect(caughtError).toBeInstanceOf(ApprovalGateError);
    expect((caughtError as ApprovalGateError).code).toBe('voice-forbidden-forced');

    // The Gmail client was never reached — the gate blocked at send.ts:146
    expect(fakeSend).not.toHaveBeenCalled();
  });
});
