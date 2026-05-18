/**
 * Plan 04-02 Task 2 — TZ canonical invariant + working-hours warning.
 *
 * Same UTC instant interpreted under different rules.timeZone values
 * produces different focus-block hits because day-of-week + local HH:mm
 * shift.
 */
import { describe, it, expect } from 'vitest';
import { detectConflictsAndAlternatives } from '../../../../src/main/scheduling/conflict';
import { DEFAULT_RULES, type Rules } from '../../../../src/shared/scheduling-rules';

// 2026-05-20T03:00:00Z:
//   - America/Los_Angeles: Tue 20:00 (previous day, evening)
//   - America/New_York:    Tue 23:00 (previous day, late evening)
//   - Asia/Tokyo:           Wed 12:00 (next day, midday)
const TARGET_START = '2026-05-20T03:00:00.000Z';
const TARGET_END = '2026-05-20T04:00:00.000Z';

describe('detectConflictsAndAlternatives — TZ canonical', () => {
  it('rules.timeZone drives day-of-week mapping (LA vs Tokyo)', () => {
    // Tokyo: Wed 12:00–13:00 local. Focus block "wed 12:00–13:00" hits.
    const tokyo = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: {
        ...DEFAULT_RULES,
        timeZone: 'Asia/Tokyo',
        focusBlocks: [{ day: 'wed', start: '12:00', end: '13:00' }],
      },
      busyIntervals: [],
    });
    expect(tokyo.primaryFeasible).toBe(false);
    expect(tokyo.conflicts.some((c) => c.type === 'focus-block')).toBe(true);

    // Los Angeles: Tue 20:00–21:00 local. The same focus-block 'wed'
    // does NOT match because day-of-week is Tuesday.
    const la = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: {
        ...DEFAULT_RULES,
        timeZone: 'America/Los_Angeles',
        focusBlocks: [{ day: 'wed', start: '12:00', end: '13:00' }],
      },
      busyIntervals: [],
    });
    expect(la.primaryFeasible).toBe(true);
    expect(la.conflicts.some((c) => c.type === 'focus-block')).toBe(false);
  });

  it("workingHoursPerDay omitted → warnings includes 'working-hours-unavailable'", () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: TARGET_START, endUtc: TARGET_END, isHighValue: false },
      rules: { ...DEFAULT_RULES, timeZone: 'UTC' },
      busyIntervals: [],
    });
    expect(res.warnings).toContain('working-hours-unavailable');
  });

  it('rules.workingHours fallback used when workingHoursPerDay undefined → no warning', () => {
    const res = detectConflictsAndAlternatives({
      target: {
        // Wed 10:00 UTC, inside 09:00–17:00 working hours
        startUtc: '2026-05-20T10:00:00.000Z',
        endUtc: '2026-05-20T11:00:00.000Z',
        isHighValue: false,
      },
      rules: {
        ...DEFAULT_RULES,
        timeZone: 'UTC',
        workingHours: {
          start: '09:00',
          end: '17:00',
          weekdays: [1, 2, 3, 4, 5],
        },
      },
      busyIntervals: [],
    });
    expect(res.warnings).not.toContain('working-hours-unavailable');
    expect(res.primaryFeasible).toBe(true);
  });
});
