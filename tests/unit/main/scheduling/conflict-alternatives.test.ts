/**
 * Plan 04-02 Task 2 — alternatives ranking by proximity.
 *
 * Requested 15:00 UTC slot on a clear day with one 15:00–16:00 busy event.
 * Expectation: alternatives skip the busy window and surface the three
 * nearest 15-min start times after the busy ends (16:00, 16:15, 16:30) —
 * or 15-min increments ranked by ascending distance from requested.
 */
import { describe, it, expect } from 'vitest';
import { detectConflictsAndAlternatives } from '../../../../src/main/scheduling/conflict';
import { DEFAULT_RULES, type Rules } from '../../../../src/shared/scheduling-rules';

const REQUEST_START = '2026-05-20T15:00:00.000Z';
const REQUEST_END = '2026-05-20T15:30:00.000Z';

function rules(): Rules {
  return { ...DEFAULT_RULES, timeZone: 'UTC' };
}

describe('detectConflictsAndAlternatives — alternatives', () => {
  it('returns up to 3 alternatives skipping a busy window', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: REQUEST_START, endUtc: REQUEST_END, isHighValue: false },
      rules: rules(),
      busyIntervals: [
        { startUtc: '2026-05-20T15:00:00.000Z', endUtc: '2026-05-20T16:00:00.000Z' },
      ],
    });
    expect(res.primaryFeasible).toBe(false);
    expect(res.alternatives).toHaveLength(3);
    // First viable 30-min slot starts at 16:00 (busy ends at 16:00, so a
    // slot starting at 16:00 with duration 30min is clear).
    const starts = res.alternatives.map((a) => a.startUtc);
    expect(starts[0]).toBe('2026-05-20T16:00:00.000Z');
    expect(starts).toContain('2026-05-20T16:15:00.000Z');
    expect(starts).toContain('2026-05-20T16:30:00.000Z');
  });

  it('returns alternatives ranked by ascending distance from requested time', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: REQUEST_START, endUtc: REQUEST_END, isHighValue: false },
      rules: rules(),
      busyIntervals: [
        { startUtc: '2026-05-20T15:00:00.000Z', endUtc: '2026-05-20T16:00:00.000Z' },
      ],
    });
    const requestedMs = Date.parse(REQUEST_START);
    const distances = res.alternatives.map((a) =>
      Math.abs(Date.parse(a.startUtc) - requestedMs),
    );
    // Sort by score desc == sort by distance asc when scores reduce to
    // -|distance|.
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });

  it('skips slots that hit hard conflicts (focus block in middle)', () => {
    // Wed 2026-05-20: focus block 16:00–17:00 should be skipped.
    const res = detectConflictsAndAlternatives({
      target: { startUtc: REQUEST_START, endUtc: REQUEST_END, isHighValue: false },
      rules: {
        ...rules(),
        focusBlocks: [{ day: 'wed', start: '16:00', end: '17:00' }],
      },
      busyIntervals: [
        { startUtc: '2026-05-20T15:00:00.000Z', endUtc: '2026-05-20T16:00:00.000Z' },
      ],
    });
    // No alternative may overlap [16:00, 17:00).
    for (const alt of res.alternatives) {
      const s = Date.parse(alt.startUtc);
      const e = Date.parse(alt.endUtc);
      const fbStart = Date.parse('2026-05-20T16:00:00.000Z');
      const fbEnd = Date.parse('2026-05-20T17:00:00.000Z');
      const overlaps = s < fbEnd && fbStart < e;
      expect(overlaps).toBe(false);
    }
  });
});
