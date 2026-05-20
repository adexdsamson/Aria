/**
 * Plan 08-03 Task 3 — approval signal source (EMIT-AFTER-EXTERNAL-WRITE).
 *
 * Per the B-3 round-2 decision (REVIEWS.md), approval signals are emitted as a
 * SEPARATE atomic INSERT AFTER both:
 *   1. transitionTo('approved') has committed inside its own SQLite txn, AND
 *   2. the external HTTPS write (applyCalendarChange / gmailSendApproved) has
 *      returned successfully.
 *
 * Sequence in the approval IPC handler:
 *   db.transaction(() => transitionTo(db, id, 'approved', patch))();   // 1
 *   const result = await applyCalendarChange(db, id, deps);            // 2
 *   if (result.ok) {
 *     emitApprovalAccept(db, ...);                                     // 3
 *   } else {
 *     // Phase 4 followup re-transition to 'failed'; NO signal emitted.
 *   }
 *
 * This shape MUST NOT wrap the state transition + signal write in one
 * db.transaction() — better-sqlite3 is synchronous and cannot hold a write
 * lock across an async HTTPS call.
 *
 * Threat T-08-22 mitigation: signal write is gated on external success. Tests
 * 5 (signal AFTER external success) and 5b (NO signal on external throw)
 * pin this contract.
 *
 * MEMORY cross-ref: project_aria_approve_silent_failure — the Phase 4
 * architectural followup (transitionTo('failed') on external throw) is NOT
 * owned by Stream 3; this module only asserts no orphan signals.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { writeSignal } from '../signal-log';
import type { ApprovalKind } from '../../approvals/persist';

type Db = Database.Database;

export type ApprovalEditCategory =
  | 'length-shorter'
  | 'length-longer'
  | 'tone'
  | 'factual'
  | 'recipient'
  | 'other';

export interface ApprovalEditPayload {
  approvalKind: ApprovalKind;
  hasEdits: boolean;
  editCategory?: ApprovalEditCategory;
  /** Char-length deltas — numbers safe under redaction. */
  bodyLenBefore?: number;
  bodyLenAfter?: number;
}

export interface ApprovalRejectPayload {
  approvalKind: ApprovalKind;
  reason: string | null;
}

export interface ApprovalAcceptPayload {
  approvalKind: ApprovalKind;
  /** Approval id (no PII). */
  approvalId: string;
}

/**
 * Emit when the user approves a draft (and the external API write later
 * succeeds). The handler MUST call this AFTER awaiting external write success.
 */
export function emitApprovalEdit(db: Db, payload: ApprovalEditPayload): void {
  writeSignal(db, { source: 'approval', kind: 'approval.edit', payload: payload as unknown as Record<string, unknown> });
}

export function emitApprovalReject(db: Db, payload: ApprovalRejectPayload): void {
  writeSignal(db, { source: 'approval', kind: 'approval.reject', payload: payload as unknown as Record<string, unknown> });
}

export function emitApprovalAccept(db: Db, payload: ApprovalAcceptPayload): void {
  writeSignal(db, { source: 'approval', kind: 'approval.accept', payload: payload as unknown as Record<string, unknown> });
}

/**
 * Categorize body-edit shape into a small enum the aggregator can roll up. Pure
 * function — operates only on lengths and string structure, no content
 * inspection beyond simple shape tests.
 */
export function categorizeBodyEdit(
  before: string | null | undefined,
  after: string | null | undefined,
): ApprovalEditCategory | undefined {
  if (before == null || after == null) return undefined;
  if (before === after) return undefined;
  const db = before.length;
  const da = after.length;
  // 20%+ shrink → length-shorter
  if (da <= db * 0.8) return 'length-shorter';
  if (da >= db * 1.2) return 'length-longer';
  return 'tone';
}
