/**
 * Plan 03-01 — Approval state machine.
 *
 * Server-authoritative typed state union + transition validator. Every
 * approval-state-changing IPC handler (and every internal write site) MUST
 * call `assertTransition(from, to)` before issuing the UPDATE, and the actual
 * UPDATE MUST run inside a single SQLite transaction so the check and the
 * write are atomic with respect to crashes.
 *
 * Source: RESEARCH Pattern 1 (verbatim).
 */
export type ApprovalState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected'
  | 'snoozed'
  | 'interrupted'
  | 'sent'
  | 'sending'
  | 'failed'
  | 'needs-operator-decision'
  | 'cancelled'; // Phase 17 D-11: voice-path abort (distinct from rejected = deliberate deny)

const ALLOWED: Record<ApprovalState, readonly ApprovalState[]> = {
  pending: ['generating'],
  generating: ['ready', 'interrupted'],
  ready: ['approved', 'rejected', 'snoozed', 'cancelled'], // 'cancelled' added Phase 17 D-11
  approved: ['sent', 'sending'],
  rejected: [],
  snoozed: ['ready'],
  interrupted: ['generating'],
  sent: [],
  sending: ['sent', 'failed', 'needs-operator-decision'],
  failed: ['needs-operator-decision'],
  'needs-operator-decision': [],
  cancelled: [], // Phase 17 D-11: terminal state — no further transitions
};

export function assertTransition(from: ApprovalState, to: ApprovalState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`invalid-transition:${from}->${to}`);
  }
}

export const APPROVAL_STATES: readonly ApprovalState[] = Object.keys(ALLOWED) as ApprovalState[];
