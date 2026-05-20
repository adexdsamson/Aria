/**
 * Plan 08.1-02 Task 4 — Entitlement state machine.
 *
 * Pure (row, now) → EntitlementState. Zero I/O. The full taxonomy is RESEARCH
 * §9 (10 visible states).
 *
 * SECURITY: callers (gate.ts) MUST construct the row passed in here by
 * substituting fields from VERIFIED JWT claims (tier, trial_started_at,
 * trial_expires_at, jwt_iat, jwt_exp). The local DB row's `tier` column is
 * tamperable and MUST NOT drive the state computation directly.
 */

export interface EntitlementRow {
  install_id: string;
  /** From verified JWT claim — NOT raw row column when used in the gate. */
  tier: 'trial' | 'pro' | 'locked';
  jwt: string | null;
  /** ISO8601. */
  jwt_iat: string | null;
  /** ISO8601. */
  jwt_exp: string | null;
  /** ISO8601. */
  trial_started_at: string | null;
  /** ISO8601. */
  trial_expires_at: string | null;
  license_key: string | null;
  /** ISO8601 — last time we successfully called /v1/entitlement/refresh. */
  last_verified_at: string;
  last_check_error: string | null;
}

export type EntitlementStateKind =
  | 'trial-active-quiet'
  | 'trial-active-day50'
  | 'trial-active-day55'
  | 'trial-active-day59'
  | 'trial-expired-grace'
  | 'trial-locked'
  | 'pro-active'
  | 'pro-grace'
  | 'pro-locked'
  | 'clock-skew-warn';

export interface TrialActiveState {
  kind:
    | 'trial-active-quiet'
    | 'trial-active-day50'
    | 'trial-active-day55'
    | 'trial-active-day59';
  daysRemaining: number;
  trialExpiresAt: string;
}

export interface TrialExpiredGraceState {
  kind: 'trial-expired-grace';
  trialExpiresAt: string;
  hoursOfGraceRemaining: number;
}

export interface TrialLockedState {
  kind: 'trial-locked';
  trialExpiresAt: string;
}

export interface ProActiveState {
  kind: 'pro-active';
  subscriptionUntil: string;
}

export interface ProGraceState {
  kind: 'pro-grace';
  lastVerifiedAt: string;
  daysUntilLock: number;
}

export interface ProLockedState {
  kind: 'pro-locked';
  lastVerifiedAt: string;
}

export interface ClockSkewWarnState {
  kind: 'clock-skew-warn';
  skewDays: number;
  underlyingState: Exclude<EntitlementState, ClockSkewWarnState>;
}

export type EntitlementState =
  | TrialActiveState
  | TrialExpiredGraceState
  | TrialLockedState
  | ProActiveState
  | ProGraceState
  | ProLockedState
  | ClockSkewWarnState;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const SKEW_THRESHOLD_DAYS = 7;
const PRO_GRACE_LOCK_DAYS = 14;
const PRO_GRACE_BANNER_HOURS = 24;

function parseIso(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function daysRemaining(expiresMs: number, nowMs: number): number {
  return Math.ceil((expiresMs - nowMs) / MS_PER_DAY);
}

/**
 * Compute the entitlement state given a row (with JWT-derived overrides
 * already merged) and the current time.
 */
export function computeEntitlementState(
  row: EntitlementRow,
  now: Date,
): EntitlementState {
  const nowMs = now.getTime();

  // Clock-skew check is computed against jwt_iat (the only server-signed
  // timestamp available). If iat is more than 7 days ahead OR behind the
  // local clock, surface a warning — but still compute the underlying state
  // and wrap it. Skew NEVER causes a lock by itself.
  const iatMs = parseIso(row.jwt_iat);
  let skewDays: number | null = null;
  if (iatMs !== null) {
    const skewMs = iatMs - nowMs;
    const absSkewDays = Math.abs(skewMs) / MS_PER_DAY;
    if (absSkewDays > SKEW_THRESHOLD_DAYS) {
      skewDays = Math.round(skewMs / MS_PER_DAY);
    }
  }

  const baseState = computeBaseState(row, nowMs);

  if (skewDays !== null) {
    return {
      kind: 'clock-skew-warn',
      skewDays,
      underlyingState: baseState,
    };
  }
  return baseState;
}

function computeBaseState(
  row: EntitlementRow,
  nowMs: number,
): Exclude<EntitlementState, ClockSkewWarnState> {
  if (row.tier === 'trial') {
    const expiresMs = parseIso(row.trial_expires_at);
    if (expiresMs === null) {
      throw new Error(
        'computeEntitlementState: trial row missing trial_expires_at',
      );
    }
    const remaining = daysRemaining(expiresMs, nowMs);
    const trialExpiresAt = row.trial_expires_at as string;

    if (nowMs >= expiresMs) {
      // expired — within 24h grace or hard-locked?
      const graceEndMs = expiresMs + PRO_GRACE_BANNER_HOURS * MS_PER_HOUR;
      if (nowMs < graceEndMs) {
        return {
          kind: 'trial-expired-grace',
          trialExpiresAt,
          hoursOfGraceRemaining: Math.max(
            0,
            Math.ceil((graceEndMs - nowMs) / MS_PER_HOUR),
          ),
        };
      }
      return { kind: 'trial-locked', trialExpiresAt };
    }

    // active
    if (remaining > 10) {
      return { kind: 'trial-active-quiet', daysRemaining: remaining, trialExpiresAt };
    }
    if (remaining === 10) {
      return { kind: 'trial-active-day50', daysRemaining: remaining, trialExpiresAt };
    }
    if (remaining === 5) {
      return { kind: 'trial-active-day55', daysRemaining: remaining, trialExpiresAt };
    }
    if (remaining >= 1 && remaining <= 2) {
      return { kind: 'trial-active-day59', daysRemaining: remaining, trialExpiresAt };
    }
    // Other in-window values (3, 4, 6..9) — group with quiet (no special
    // banner) — preserves "quiet by default" UX outside the explicit beats.
    return { kind: 'trial-active-quiet', daysRemaining: remaining, trialExpiresAt };
  }

  if (row.tier === 'pro') {
    const lastVerifiedMs = parseIso(row.last_verified_at);
    if (lastVerifiedMs === null) {
      throw new Error(
        'computeEntitlementState: pro row missing last_verified_at',
      );
    }
    const expMs = parseIso(row.jwt_exp);
    const secondsSinceVerify = (nowMs - lastVerifiedMs) / 1000;
    const lockThresholdSec = PRO_GRACE_LOCK_DAYS * 86_400;
    const graceWindowOpenSec = PRO_GRACE_BANNER_HOURS * 3_600;

    if (secondsSinceVerify >= lockThresholdSec) {
      return {
        kind: 'pro-locked',
        lastVerifiedAt: row.last_verified_at,
      };
    }
    if (secondsSinceVerify >= graceWindowOpenSec) {
      const remainingMs = lockThresholdSec * 1000 - (nowMs - lastVerifiedMs);
      return {
        kind: 'pro-grace',
        lastVerifiedAt: row.last_verified_at,
        daysUntilLock: Math.max(0, Math.ceil(remainingMs / MS_PER_DAY)),
      };
    }
    // active. subscriptionUntil := jwt.exp (claim-side bound).
    return {
      kind: 'pro-active',
      subscriptionUntil: expMs !== null ? (row.jwt_exp as string) : row.last_verified_at,
    };
  }

  // tier === 'locked' (server told us we're done)
  return {
    kind: 'pro-locked',
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * Convenience: true if the action should be allowed under this state.
 * `trial-expired-grace` ALLOWS — per RESEARCH §9 grace shows full paywall on
 * next write but is not yet a hard lock. The gate enforces lock only for
 * `trial-locked` and `pro-locked` (mirrored here for use by paywall UX).
 */
export function isLocked(state: EntitlementState): boolean {
  if (state.kind === 'trial-locked' || state.kind === 'pro-locked') return true;
  if (state.kind === 'clock-skew-warn') return isLocked(state.underlyingState);
  return false;
}
