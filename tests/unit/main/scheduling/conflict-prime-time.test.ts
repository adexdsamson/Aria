/**
 * Plan 04-02 Task 2 — prime-time bonus gated on isHighValue.
 *
 * Setup: target requested at 15:00 UTC. Busy 15:00–16:00 forces a search.
 * Prime-time window 17:00–18:00 (same Wed). Without prime bonus, ranking
 * is pure proximity → 16:00 ranks above 17:00. With isHighValue=true the
 * +5min prime bonus tilts 17:00 above 16:30 (15min farther but inside
 * prime time).
 */
import { describe, it, expect } from 'vitest';
import { detectConflictsAndAlternatives } from '../../../../src/main/scheduling/conflict';
import { DEFAULT_RULES, type Rules } from '../../../../src/shared/scheduling-rules';

const REQUEST_START = '2026-05-20T15:00:00.000Z';
const REQUEST_END = '2026-05-20T15:30:00.000Z';

function rules(): Rules {
  // Prime-time window covers 16:00–17:00 so it overlaps the first viable
  // alternatives after the 15:00–16:00 busy block. This keeps prime-time
  // candidates inside the first-3-viable pool.
  return {
    ...DEFAULT_RULES,
    timeZone: 'UTC',
    primeTimeWindows: [{ day: 'wed', start: '16:00', end: '17:00' }],
  };
}

const busy = [
  { startUtc: '2026-05-20T15:00:00.000Z', endUtc: '2026-05-20T16:00:00.000Z' },
];

describe('detectConflictsAndAlternatives — prime-time bonus', () => {
  it('low-value event: prime-time bonus is NOT applied to score', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: REQUEST_START, endUtc: REQUEST_END, isHighValue: false },
      rules: rules(),
      busyIntervals: busy,
    });
    expect(res.alternatives.length).toBeGreaterThan(0);
    // The bonus must NOT show up in any score. score = -|distance| - bufferPenalty.
    for (const alt of res.alternatives) {
      const requestedMs = Date.parse(REQUEST_START);
      const distance = Math.abs(Date.parse(alt.startUtc) - requestedMs);
      expect(alt.score).toBe(-distance - alt.bufferPenalty);
    }
    // Closest-in-time wins for low-value (proximity-only).
    expect(res.alternatives[0].startUtc).toBe('2026-05-20T16:00:00.000Z');
  });

  it('high-value event: prime-time bonus IS applied to score', () => {
    const res = detectConflictsAndAlternatives({
      target: { startUtc: REQUEST_START, endUtc: REQUEST_END, isHighValue: true },
      rules: rules(),
      busyIntervals: busy,
    });
    // 16:00, 16:15, 16:30 all fall inside the 16:00–17:00 prime-time window.
    expect(res.alternatives.length).toBeGreaterThan(0);
    const requestedMs = Date.parse(REQUEST_START);
    for (const alt of res.alternatives) {
      expect(alt.primeTimeMatched).toBe(true);
      const distance = Math.abs(Date.parse(alt.startUtc) - requestedMs);
      // bonus = 5*60*1000 ms
      expect(alt.score).toBe(-distance + 5 * 60 * 1000 - alt.bufferPenalty);
    }
  });
});
