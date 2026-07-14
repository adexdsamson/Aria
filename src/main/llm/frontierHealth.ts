/**
 * Frontier health state (session-scoped, in-memory).
 *
 * The Status page needs to know whether the frontier key ACTUALLY works, not
 * merely that a key is stored. Two things write here:
 *   - the on-demand FRONTIER_VERIFY handler (source: 'verify')
 *   - every real frontier ask in ask-service (source: 'usage')
 * so the Status row reflects the last known-good/known-bad result without any
 * background polling or extra API calls. Read by DIAGNOSTICS_STATUS.
 *
 * Deliberately NOT persisted: a stale "verified 3 days ago" is misleading, and
 * a fresh session should re-verify. `checkedAt` is set by the caller (main
 * process) so this module stays free of clock access for testability.
 */
import type { FrontierErrorClass } from './providers';
import type { ProviderId } from '../../shared/ipc-contract';

export interface FrontierHealth {
  ok: boolean;
  /** classification when ok === false (auth / model-not-found / …) */
  reason?: FrontierErrorClass;
  /** ISO timestamp of the check */
  checkedAt: string;
  provider: ProviderId;
  /** 'verify' = explicit key check; 'usage' = observed from a real frontier call */
  source: 'verify' | 'usage';
}

let last: FrontierHealth | null = null;

export function recordFrontierHealth(h: FrontierHealth): void {
  last = h;
}

export function getFrontierHealth(): FrontierHealth | null {
  return last;
}

/** Test-only: clear the recorded health between tests. */
export function _resetFrontierHealthForTests(): void {
  last = null;
}
