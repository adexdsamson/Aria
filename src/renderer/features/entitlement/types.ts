/**
 * Plan 08.1-03 — Renderer-side mirror of the EntitlementState union from
 * `src/main/entitlement/state.ts`. The IPC contract types `state` as
 * `unknown`; this file is the renderer's typed view of the same shape.
 *
 * If `src/main/entitlement/state.ts` evolves, update this file in lockstep.
 */

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

/** Mirrors `isLocked` in src/main/entitlement/state.ts. */
export function isLocked(state: EntitlementState | null): boolean {
  if (!state) return false;
  if (state.kind === 'trial-locked' || state.kind === 'pro-locked') return true;
  if (state.kind === 'clock-skew-warn') return isLocked(state.underlyingState);
  return false;
}

/** Unwraps a clock-skew-warn wrapper to its underlying base state. */
export function baseState(
  state: EntitlementState,
): Exclude<EntitlementState, ClockSkewWarnState> {
  if (state.kind === 'clock-skew-warn') return state.underlyingState;
  return state;
}
