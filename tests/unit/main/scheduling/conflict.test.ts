/**
 * Plan 04-02 Task 2 — conflict classification tests.
 *
 * One case per ConflictType. All tests use UTC ISO timestamps and the
 * rules.timeZone field for day-of-week / HH:mm mapping.
 */
import { describe, it, expect } from 'vitest';
import { detectConflictsAndAlternatives } from '../../../../src/main/scheduling/conflict';
import { DEFAULT_RULES, type Rules } from '../../../../src/shared/scheduling-rules';

// 2026-05-20 is a Wednesday. 10:00 UTC == 10:00 UTC in TZ='UTC'.
const TARGET_START = '2026-05-20T10:00:00.000Z';
const TARGET_END = '2026-05-20T11:00:00.000Z';

function baseRules(over: Partial<Rules> = {}): Rules {
  return { ...DEFAULT_RULES, timeZone: 'UTC', ...over };
}

describe('detectConflictsAndAlternatives — classification', () => {
  it('busy block → hard conflict, primaryFeasible=false', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: baseRules(),
      busyIntervals: [{ startUtc: TARGET_START, endUtc: TARGET_END }],
    });
    expect(res.primaryFeasible).toBe(false);
    expect(res.conflicts.some((c) => c.type === 'busy' && c.severity === 'hard')).toBe(true);
  });

  it('focus-block on matching day → hard conflict', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: baseRules({
        focusBlocks: [{ day: 'wed', start: '09:00', end: '11:00', label: 'Deep work' }],
      }),
      busyIntervals: [],
    });
    expect(res.primaryFeasible).toBe(false);
    const fb = res.conflicts.find((c) => c.type === 'focus-block');
    expect(fb).toBeDefined();
    expect(fb!.severity).toBe('hard');
    expect(fb!.label).toBe('Deep work');
  });

  it('no-meeting-window → hard conflict', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: baseRules({
        noMeetingWindows: [
          { day: 'all', start: '10:00', end: '11:00', label: 'Quiet hour' },
        ],
      }),
      busyIntervals: [],
    });
    expect(res.primaryFeasible).toBe(false);
    const nm = res.conflicts.find((c) => c.type === 'no-meeting-window');
    expect(nm).toBeDefined();
    expect(nm!.severity).toBe('hard');
    expect(nm!.label).toBe('Quiet hour');
  });

  it('outside-working-hours → hard conflict (per-day map provided)', () => {
    const res = detectConflictsAndAlternatives({
      target: {
        // Wed 03:00 UTC, before working hours (09:00–17:00)
        startUtc: '2026-05-20T03:00:00.000Z',
        endUtc: '2026-05-20T04:00:00.000Z',
        isHighValue: false,
      },
      rules: baseRules(),
      busyIntervals: [],
      workingHoursPerDay: {
        mon: { start: '09:00', end: '17:00' },
        tue: { start: '09:00', end: '17:00' },
        wed: { start: '09:00', end: '17:00' },
        thu: { start: '09:00', end: '17:00' },
        fri: { start: '09:00', end: '17:00' },
      },
    });
    expect(res.primaryFeasible).toBe(false);
    expect(res.conflicts.some((c) => c.type === 'outside-working-hours')).toBe(true);
  });

  it('buffer violation → soft conflict, primaryFeasible=true', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: baseRules({ buffers: { beforeMin: 15, afterMin: 0 } }),
      // adjacent meeting ending 5 min before target start = buffer violation
      busyIntervals: [
        {
          startUtc: '2026-05-20T09:00:00.000Z',
          endUtc: '2026-05-20T09:55:00.000Z',
        },
      ],
    });
    expect(res.primaryFeasible).toBe(true);
    const buf = res.conflicts.find((c) => c.type === 'buffer');
    expect(buf).toBeDefined();
    expect(buf!.severity).toBe('soft');
  });

  it('clean slot with no rules → primaryFeasible=true, no conflicts', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: baseRules(),
      busyIntervals: [],
    });
    expect(res.primaryFeasible).toBe(true);
    expect(res.conflicts).toHaveLength(0);
  });
});
