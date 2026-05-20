/**
 * Plan 08-04 Task 4 — verify-migration unit tests.
 *
 * Pure-function tests; no DB needed.
 */
import { describe, it, expect } from 'vitest';
import { verifyRowCounts, CRITICAL_TABLES } from './verify-migration';

describe('verifyRowCounts', () => {
  it('returns empty array when counts unchanged', () => {
    const before = Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10]));
    const after = { ...before };
    expect(verifyRowCounts(before, after, [128, 129, 130], {})).toEqual([]);
  });

  it('returns empty array when counts grow', () => {
    const before = Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10]));
    const after = Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 11]));
    expect(verifyRowCounts(before, after, [130], {})).toEqual([]);
  });

  it('flags drift when a critical-table row count drops without whitelist', () => {
    const before = { ...Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10])) };
    const after = { ...before, gmail_message: 5 };
    const drift = verifyRowCounts(before, after, [130], {});
    expect(drift).toHaveLength(1);
    expect(drift[0]).toEqual({ table: 'gmail_message', before: 10, after: 5 });
  });

  it('honors expectedDrops map (H-3 round 2 — map argument is the only supported path)', () => {
    const before = { ...Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10])) };
    const after = { ...before, gmail_message: 5 };
    // Migration 999 declares it drops gmail_message rows — silent allowed.
    const drift = verifyRowCounts(before, after, [999], { 999: ['gmail_message'] });
    expect(drift).toEqual([]);
  });

  it('expectedDrops scoped to a non-applied version is ignored', () => {
    const before = { ...Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10])) };
    const after = { ...before, calendar_event: 5 };
    // Whitelist is for a version that was NOT in appliedVersions → drift still flagged.
    const drift = verifyRowCounts(before, after, [130], { 999: ['calendar_event'] });
    expect(drift).toHaveLength(1);
    expect(drift[0]!.table).toBe('calendar_event');
  });

  it('flags multiple tables', () => {
    const before = { ...Object.fromEntries(CRITICAL_TABLES.map((t) => [t, 10])) };
    const after = { ...before, gmail_message: 5, send_log: 0 };
    const drift = verifyRowCounts(before, after, [130], {});
    expect(drift.map((d) => d.table).sort()).toEqual(['gmail_message', 'send_log']);
  });
});
