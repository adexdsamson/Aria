/**
 * Phase 17 / Plan 17-01 Task 1 — 'cancelled' terminal state (D-11).
 *
 * Three assertions per the plan:
 *   1. assertTransition('ready', 'cancelled') does not throw
 *   2. assertTransition('cancelled', 'approved') throws with /invalid-transition/
 *   3. APPROVAL_STATES includes 'cancelled'
 */
import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  APPROVAL_STATES,
} from '../../../../src/main/approvals/state';

describe("approvals/state 'cancelled' terminal state (Phase 17 D-11)", () => {
  it("allows ready -> cancelled", () => {
    expect(() => assertTransition('ready', 'cancelled')).not.toThrow();
  });

  it("rejects cancelled -> approved (terminal, no exit)", () => {
    expect(() => assertTransition('cancelled', 'approved')).toThrow(
      /invalid-transition/,
    );
  });

  it("APPROVAL_STATES includes 'cancelled'", () => {
    expect(APPROVAL_STATES).toContain('cancelled');
  });
});
