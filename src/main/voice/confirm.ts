/**
 * Phase 14 — Dormant headless voice-confirm trust seam.
 *
 * `voiceConfirm` is the load-bearing trust decision for voice-driven approval.
 * It is DORMANT in Phase 14 — zero callers this phase. It exists so the
 * contract is fixed up front, following the `writeSendLog` precedent
 * (`src/main/approvals/persist.ts:281`). The first caller ships in Phase 17
 * when audio is wired.
 *
 * Contract guarantees:
 * - Routes exclusively through `transitionTo` (transactional + assertTransition-
 *   validated + ALLOWED_PATCH_COLS-restricted). NEVER writes approval.state or
 *   approval_path via raw SQL.
 * - Stamps `approval_path='voice-explicit'` — the distinguishable path value
 *   that the `assertApproved` gate rejects for forced/high-severity rows
 *   (see gate.ts D-02 'voice-forbidden-forced' branch).
 * - Signature frozen at exactly (db, approvalId): void — two args, no read-back
 *   payload type (deferred to Phase 17 / VOICE-05/08/09/11; defining it before
 *   a resolver exists invites a fictional schema, a known Aria failure mode).
 * - Performs the same ready→approved edge the UI fires
 *   (ipc/approvals.ts:199) — SC4 true by construction (D-05/D-06).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { transitionTo } from '../approvals/persist';

type Db = Database.Database;

/**
 * Transition a ready approval row to approved with approval_path='voice-explicit'.
 *
 * This is the SAME ready→approved edge the Approvals UI fires. The gate
 * (`assertApproved`) will subsequently reject the row if it is forced/high-
 * severity, throwing 'voice-forbidden-forced' (D-02). Low/med non-forced rows
 * pass through cleanly.
 *
 * @param db - The open SQLite database connection.
 * @param approvalId - The UUID of the approval row to confirm.
 */
export function voiceConfirm(db: Db, approvalId: string): void {
  transitionTo(db, approvalId, 'approved', { approval_path: 'voice-explicit' });
}
