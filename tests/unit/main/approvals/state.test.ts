/**
 * Plan 03-01 Task 1 — Approval state machine.
 */
import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  type ApprovalState,
} from '../../../../src/main/approvals/state';

describe('approvals/state assertTransition', () => {
  it.each<[ApprovalState, ApprovalState]>([
    ['pending', 'generating'],
    ['generating', 'ready'],
    ['generating', 'interrupted'],
    ['ready', 'approved'],
    ['ready', 'rejected'],
    ['ready', 'snoozed'],
    ['snoozed', 'ready'],
    ['interrupted', 'generating'],
    ['approved', 'sent'],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each<[ApprovalState, ApprovalState]>([
    ['pending', 'sent'],
    ['ready', 'sent'],
    ['generating', 'approved'],
    ['sent', 'approved'],
    ['sent', 'ready'],
    ['rejected', 'approved'],
    ['rejected', 'ready'],
    ['pending', 'approved'],
    ['approved', 'ready'],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(/invalid-transition/);
  });
});
