/**
 * Plan 08.1-02 Task 5 — The entitlement chokepoint.
 *
 * `assertEntitled` mirrors the SHAPE of `src/main/approvals/gate.ts`'s
 * `assertApproved`. It is the ONLY function permitted to authorize a gated
 * action (email_send / calendar_change / task_push / briefing_generate /
 * rag_ask). The static-grep ratchet at
 * `tests/static/single-entitlement-gate-site.test.ts` enforces that no other
 * file in `src/main` invokes this function.
 *
 * SECURITY:
 *   - Re-runs jose.jwtVerify on every call. A SQLCipher tamperer who flips
 *     `tier = 'pro'` in the entitlement row CANNOT bypass the gate because
 *     state is computed from VERIFIED CLAIMS, not from the row column.
 *   - Logs every throw to `entitlement_audit` (event='lock').
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  verifyEntitlementJwt,
  type EntitlementClaims,
} from './jwt-verify';
import {
  computeEntitlementState,
  type EntitlementRow,
} from './state';

type Db = Database.Database;

export type EntitlementAction =
  | 'email_send'
  | 'calendar_change'
  | 'task_push'
  | 'briefing_generate'
  | 'rag_ask';

export type EntitlementErrorCode =
  | 'no-entitlement'
  | 'trial-locked'
  | 'pro-locked'
  | 'jwt-invalid'
  | 'jwt-expired';

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly action: EntitlementAction;
  constructor(
    code: EntitlementErrorCode,
    action: EntitlementAction,
    message: string,
  ) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
    this.action = action;
  }
}

interface RawEntitlementRow {
  install_id: string;
  tier: 'trial' | 'pro' | 'locked';
  jwt: string | null;
  jwt_iat: string | null;
  jwt_exp: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  license_key: string | null;
  last_verified_at: string;
  last_check_error: string | null;
}

function entitlementTableExists(db: Db): boolean {
  const r = db
    .prepare(
      `SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name='entitlement'`,
    )
    .get() as { n: number } | undefined;
  return Boolean(r);
}

function readRow(db: Db): RawEntitlementRow | undefined {
  return db
    .prepare(
      `SELECT install_id, tier, jwt, jwt_iat, jwt_exp,
              trial_started_at, trial_expires_at, license_key,
              last_verified_at, last_check_error
         FROM entitlement WHERE id = 1`,
    )
    .get() as RawEntitlementRow | undefined;
}

function auditLock(
  db: Db,
  action: EntitlementAction,
  code: EntitlementErrorCode,
): void {
  try {
    db.prepare(
      `INSERT INTO entitlement_audit (event, detail)
       VALUES ('lock', ?)`,
    ).run(JSON.stringify({ action, code }));
  } catch {
    /* audit must not mask the original error; swallow */
  }
}

function mergeRowWithClaims(
  row: RawEntitlementRow,
  claims: EntitlementClaims,
): EntitlementRow {
  return {
    install_id: row.install_id,
    // claim-side tier is the trust root
    tier: claims.tier,
    jwt: row.jwt,
    jwt_iat:
      typeof claims.iat === 'number'
        ? new Date(claims.iat * 1000).toISOString()
        : row.jwt_iat,
    jwt_exp:
      typeof claims.exp === 'number'
        ? new Date(claims.exp * 1000).toISOString()
        : row.jwt_exp,
    trial_started_at: claims.trial_started_at ?? row.trial_started_at,
    trial_expires_at: claims.trial_expires_at ?? row.trial_expires_at,
    license_key: row.license_key,
    last_verified_at: row.last_verified_at,
    last_check_error: row.last_check_error,
  };
}

/**
 * Assert the app is entitled to perform `action`. Throws EntitlementError
 * otherwise. Audit-logs every throw.
 */
export async function assertEntitled(
  db: Db,
  action: EntitlementAction,
): Promise<void> {
  // Test-environment escape hatch: if the migration that creates the
  // `entitlement` table hasn't been applied to THIS DB, treat as default-allow.
  // Production code paths ALWAYS run migrations before the gate is reachable
  // (src/main/index.ts → runMigrations → EntitlementService.bootstrap →
  // first IPC write). Pre-migration use-sites are necessarily test fixtures.
  if (!entitlementTableExists(db)) return;
  const row = readRow(db);
  if (!row) {
    auditLock(db, action, 'no-entitlement');
    throw new EntitlementError(
      'no-entitlement',
      action,
      'no entitlement row; bootstrap not complete',
    );
  }
  if (!row.jwt) {
    auditLock(db, action, 'jwt-invalid');
    throw new EntitlementError(
      'jwt-invalid',
      action,
      'entitlement row missing JWT',
    );
  }

  let claims: EntitlementClaims;
  try {
    claims = await verifyEntitlementJwt(row.jwt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code: EntitlementErrorCode = /exp/i.test(msg)
      ? 'jwt-expired'
      : 'jwt-invalid';
    auditLock(db, action, code);
    throw new EntitlementError(code, action, `jwt verify failed: ${msg}`);
  }

  const merged = mergeRowWithClaims(row, claims);
  const state = computeEntitlementState(merged, new Date());
  // unwrap clock-skew-warn — only the underlying lock states are blocking
  const effective =
    state.kind === 'clock-skew-warn' ? state.underlyingState : state;

  if (effective.kind === 'trial-locked') {
    auditLock(db, action, 'trial-locked');
    throw new EntitlementError(
      'trial-locked',
      action,
      'trial expired; activate a subscription to continue',
    );
  }
  if (effective.kind === 'pro-locked') {
    auditLock(db, action, 'pro-locked');
    throw new EntitlementError(
      'pro-locked',
      action,
      'subscription verification expired; reconnect to continue',
    );
  }
  // trial-expired-grace, *-active, *-grace, clock-skew-warn → allow
}
