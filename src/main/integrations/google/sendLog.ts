/**
 * Plan 03-04 Task 4 — Gmail send_log + verification-pending flag.
 *
 * `writeSendLog` lives in `src/main/approvals/persist.ts` (so the persist
 * surface remains the single owner of approval-adjacent SQL). This module
 * re-exports it for convenience and owns the in-process verification-pending
 * flag consumed by `IntegrationsSection` (RESEARCH §Pitfall 9).
 *
 * The verification-pending flag is process-local; it flips ON when a send
 * fails with an unverified-app-style error and clears on the first successful
 * send. Phase 8 (signing + release) replaces this with a persisted setting
 * once we're outside CASA verification.
 */

let verificationPending = false;

export function isVerificationPending(): boolean {
  return verificationPending;
}

export function setVerificationPending(): void {
  verificationPending = true;
}

export function clearVerificationPending(): void {
  verificationPending = false;
}

/** Test-only: reset the in-process flag between cases. */
export function _resetVerificationPendingForTests(): void {
  verificationPending = false;
}

export { writeSendLog } from '../../approvals/persist';
