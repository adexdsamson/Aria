/**
 * Plan 04-02 Task 2 — pure-function conflict detector + alternatives ranker.
 *
 * `detectConflictsAndAlternatives` is intentionally pure: caller pre-fetches
 * busyIntervals via freebusy.query (Plan 04-03 wires this) and optional
 * workingHoursPerDay from CalendarSettings; this function never touches DB or
 * Google APIs. Time-zone math relies on Intl.DateTimeFormat — never hand-rolled.
 *
 * Hard conflicts: busy / focus-block / no-meeting-window / outside-working-hours
 *   → primaryFeasible=false
 * Soft conflicts: buffer violation
 *   → primaryFeasible=true; conflict reported; bufferPenalty surfaces in
 *     alternative scoring
 *
 * Alternatives: 15-min step walk forward up to 14 days, skipping hard
 * conflicts + outside-working-hours; first 3 viable returned. Scoring:
 *   score = -|distanceFromRequestedMs|
 *           + (target.isHighValue && primeTimeMatched ? +5*60*1000 : 0)
 *           - bufferPenalty
 *
 * Working-hours resolution (RESEARCH Q1 RESOLVED):
 *   - if input.workingHoursPerDay → use it as authoritative
 *   - else if input.rules.workingHours → expand single-spec to per-day map
 *   - else → unrestricted + push 'working-hours-unavailable' warning
 */
import type { Rules, Day } from '../../shared/scheduling-rules';

export type ConflictType =
  | 'busy'
  | 'focus-block'
  | 'buffer'
  | 'no-meeting-window'
  | 'outside-working-hours';

export type ConflictSeverity = 'hard' | 'soft';

export interface ConflictReport {
  type: ConflictType;
  severity: ConflictSeverity;
  windowStartUtc: string;
  windowEndUtc: string;
  label?: string;
}

export interface AlternativeSlot {
  startUtc: string;
  endUtc: string;
  score: number;
  primeTimeMatched: boolean;
  bufferPenalty: number;
}

export interface DetectInput {
  target: {
    startUtc: string;
    endUtc: string;
    eventId?: string;
    isHighValue: boolean;
  };
  rules: Rules;
  busyIntervals: Array<{ startUtc: string; endUtc: string }>;
  workingHoursPerDay?: Record<string, { start: string; end: string }>;
}

export interface DetectResult {
  primaryFeasible: boolean;
  conflicts: ConflictReport[];
  alternatives: AlternativeSlot[];
  warnings: string[];
}

const DAY_NAMES: readonly Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRIME_TIME_BONUS_MS = 5 * 60 * 1000;
const STEP_MS = 15 * 60 * 1000;
const MAX_HORIZON_DAYS = 14;
const MAX_HORIZON_MS = MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000;
const MAX_ALTERNATIVES = 3;

interface LocalParts {
  weekday: Day;
  weekdayIdx: number; // 0=Sun..6=Sat
  hhmm: string;
  minutesOfDay: number;
}

function toLocalParts(utcIso: string, timeZone: string): LocalParts {
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const weekdayShort = (parts.find((p) => p.type === 'weekday')?.value ?? 'Sun').toLowerCase();
  const map: Record<string, { day: Day; idx: number }> = {
    sun: { day: 'sun', idx: 0 },
    mon: { day: 'mon', idx: 1 },
    tue: { day: 'tue', idx: 2 },
    wed: { day: 'wed', idx: 3 },
    thu: { day: 'thu', idx: 4 },
    fri: { day: 'fri', idx: 5 },
    sat: { day: 'sat', idx: 6 },
  };
  const lookup = map[weekdayShort.slice(0, 3)] ?? map.sun;
  let hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // Intl can return "24" at midnight in some locales — normalize.
  if (hh === '24') hh = '00';
  const hhPadded = hh.padStart(2, '0');
  const minutesOfDay = Number(hhPadded) * 60 + Number(mm);
  return {
    weekday: lookup.day,
    weekdayIdx: lookup.idx,
    hhmm: `${hhPadded}:${mm}`,
    minutesOfDay,
  };
}

function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function dayMatches(ruleDay: Day, actualDay: Day): boolean {
  return ruleDay === 'all' || ruleDay === actualDay;
}

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function expandWorkingHours(
  rules: Rules,
): Record<string, { start: string; end: string }> | undefined {
  if (!rules.workingHours) return undefined;
  const map: Record<string, { start: string; end: string }> = {};
  for (const dow of rules.workingHours.weekdays) {
    map[DAY_NAMES[dow]] = {
      start: rules.workingHours.start,
      end: rules.workingHours.end,
    };
  }
  return map;
}

/**
 * Check whether [startUtc, endUtc) violates any local-time window (focus
 * blocks, no-meeting windows, prime-time windows). For windows spanning
 * multi-day candidates we evaluate by start day only — v1 simplification
 * matched by every rule type in the schema.
 */
function checkWindowRules(
  startUtc: string,
  endUtc: string,
  rules: Rules,
): { conflicts: ConflictReport[]; primeTimeMatched: boolean } {
  const conflicts: ConflictReport[] = [];
  const startLocal = toLocalParts(startUtc, rules.timeZone);
  const endLocal = toLocalParts(endUtc, rules.timeZone);
  // Handle event ending past midnight by clamping to end-of-day for window
  // overlap checks (v1: focus block edge case is rare and the alternative
  // search will skip past it anyway).
  const endMin = endLocal.minutesOfDay > startLocal.minutesOfDay
    ? endLocal.minutesOfDay
    : 24 * 60;

  for (const fb of rules.focusBlocks) {
    if (!dayMatches(fb.day, startLocal.weekday)) continue;
    if (
      intervalsOverlap(
        startLocal.minutesOfDay,
        endMin,
        hhmmToMin(fb.start),
        hhmmToMin(fb.end),
      )
    ) {
      conflicts.push({
        type: 'focus-block',
        severity: 'hard',
        windowStartUtc: startUtc,
        windowEndUtc: endUtc,
        label: fb.label,
      });
    }
  }

  for (const nm of rules.noMeetingWindows) {
    if (!dayMatches(nm.day, startLocal.weekday)) continue;
    if (
      intervalsOverlap(
        startLocal.minutesOfDay,
        endMin,
        hhmmToMin(nm.start),
        hhmmToMin(nm.end),
      )
    ) {
      conflicts.push({
        type: 'no-meeting-window',
        severity: 'hard',
        windowStartUtc: startUtc,
        windowEndUtc: endUtc,
        label: nm.label,
      });
    }
  }

  let primeTimeMatched = false;
  for (const pt of rules.primeTimeWindows) {
    if (!dayMatches(pt.day, startLocal.weekday)) continue;
    if (
      intervalsOverlap(
        startLocal.minutesOfDay,
        endMin,
        hhmmToMin(pt.start),
        hhmmToMin(pt.end),
      )
    ) {
      primeTimeMatched = true;
      break;
    }
  }

  return { conflicts, primeTimeMatched };
}

function checkBusy(
  startUtc: string,
  endUtc: string,
  busy: DetectInput['busyIntervals'],
): ConflictReport[] {
  const s = Date.parse(startUtc);
  const e = Date.parse(endUtc);
  const out: ConflictReport[] = [];
  for (const b of busy) {
    const bs = Date.parse(b.startUtc);
    const be = Date.parse(b.endUtc);
    if (intervalsOverlap(s, e, bs, be)) {
      out.push({
        type: 'busy',
        severity: 'hard',
        windowStartUtc: b.startUtc,
        windowEndUtc: b.endUtc,
      });
    }
  }
  return out;
}

function checkWorkingHours(
  startUtc: string,
  endUtc: string,
  rules: Rules,
  workingHoursPerDay: Record<string, { start: string; end: string }> | undefined,
): ConflictReport | null {
  if (!workingHoursPerDay) return null;
  const local = toLocalParts(startUtc, rules.timeZone);
  const wh = workingHoursPerDay[local.weekday];
  if (!wh) {
    return {
      type: 'outside-working-hours',
      severity: 'hard',
      windowStartUtc: startUtc,
      windowEndUtc: endUtc,
    };
  }
  const startMin = hhmmToMin(local.hhmm);
  const endLocal = toLocalParts(endUtc, rules.timeZone);
  const endMin = endLocal.weekdayIdx === local.weekdayIdx
    ? hhmmToMin(endLocal.hhmm)
    : 24 * 60;
  const whStart = hhmmToMin(wh.start);
  const whEnd = hhmmToMin(wh.end);
  if (startMin < whStart || endMin > whEnd) {
    return {
      type: 'outside-working-hours',
      severity: 'hard',
      windowStartUtc: startUtc,
      windowEndUtc: endUtc,
    };
  }
  return null;
}

function computeBufferPenalty(
  startUtc: string,
  endUtc: string,
  busy: DetectInput['busyIntervals'],
  rules: Rules,
): { penaltyMs: number; conflict: ConflictReport | null } {
  if (rules.buffers.beforeMin === 0 && rules.buffers.afterMin === 0) {
    return { penaltyMs: 0, conflict: null };
  }
  const s = Date.parse(startUtc);
  const e = Date.parse(endUtc);
  let penaltyMs = 0;
  let earliestConflictBefore: { start: string; end: string } | null = null;
  let earliestConflictAfter: { start: string; end: string } | null = null;

  for (const b of busy) {
    const bs = Date.parse(b.startUtc);
    const be = Date.parse(b.endUtc);
    // Overlap is a HARD busy conflict — handled elsewhere. Skip here.
    if (intervalsOverlap(s, e, bs, be)) continue;
    if (be <= s) {
      const gap = s - be;
      const wantMs = rules.buffers.beforeMin * 60 * 1000;
      if (gap < wantMs) {
        penaltyMs += wantMs - gap;
        if (!earliestConflictBefore) {
          earliestConflictBefore = { start: b.startUtc, end: b.endUtc };
        }
      }
    } else if (bs >= e) {
      const gap = bs - e;
      const wantMs = rules.buffers.afterMin * 60 * 1000;
      if (gap < wantMs) {
        penaltyMs += wantMs - gap;
        if (!earliestConflictAfter) {
          earliestConflictAfter = { start: b.startUtc, end: b.endUtc };
        }
      }
    }
  }

  const violator = earliestConflictBefore ?? earliestConflictAfter;
  if (!violator) return { penaltyMs: 0, conflict: null };
  return {
    penaltyMs,
    conflict: {
      type: 'buffer',
      severity: 'soft',
      windowStartUtc: violator.start,
      windowEndUtc: violator.end,
    },
  };
}

function evaluateSlot(
  startUtc: string,
  endUtc: string,
  input: DetectInput,
  effectiveWorkingHours:
    | Record<string, { start: string; end: string }>
    | undefined,
): {
  hardConflicts: ConflictReport[];
  bufferConflict: ConflictReport | null;
  bufferPenaltyMs: number;
  primeTimeMatched: boolean;
} {
  const hardConflicts: ConflictReport[] = [];
  hardConflicts.push(...checkBusy(startUtc, endUtc, input.busyIntervals));
  const whConflict = checkWorkingHours(
    startUtc,
    endUtc,
    input.rules,
    effectiveWorkingHours,
  );
  if (whConflict) hardConflicts.push(whConflict);
  const window = checkWindowRules(startUtc, endUtc, input.rules);
  hardConflicts.push(...window.conflicts);
  const buffer = computeBufferPenalty(
    startUtc,
    endUtc,
    input.busyIntervals,
    input.rules,
  );
  return {
    hardConflicts,
    bufferConflict: buffer.conflict,
    bufferPenaltyMs: buffer.penaltyMs,
    primeTimeMatched: window.primeTimeMatched,
  };
}

export function detectConflictsAndAlternatives(input: DetectInput): DetectResult {
  const warnings: string[] = [];
  let effectiveWH = input.workingHoursPerDay;
  if (!effectiveWH) {
    const expanded = expandWorkingHours(input.rules);
    if (expanded) effectiveWH = expanded;
    else warnings.push('working-hours-unavailable');
  }

  const targetEval = evaluateSlot(
    input.target.startUtc,
    input.target.endUtc,
    input,
    effectiveWH,
  );

  const conflicts: ConflictReport[] = [...targetEval.hardConflicts];
  if (targetEval.bufferConflict) conflicts.push(targetEval.bufferConflict);
  const primaryFeasible = targetEval.hardConflicts.length === 0;

  // Search alternatives starting at target.startUtc and walking forward.
  const durationMs =
    Date.parse(input.target.endUtc) - Date.parse(input.target.startUtc);
  const requestedMs = Date.parse(input.target.startUtc);
  const horizonEnd = requestedMs + MAX_HORIZON_MS;
  // Round start to the next 15-minute boundary at or after requestedMs.
  let cursor = Math.ceil(requestedMs / STEP_MS) * STEP_MS;
  const alternatives: AlternativeSlot[] = [];

  while (cursor < horizonEnd && alternatives.length < MAX_ALTERNATIVES) {
    const slotStart = new Date(cursor).toISOString();
    const slotEnd = new Date(cursor + durationMs).toISOString();
    const ev = evaluateSlot(slotStart, slotEnd, input, effectiveWH);
    if (ev.hardConflicts.length === 0) {
      const distancePenalty = Math.abs(cursor - requestedMs);
      const primeBonus =
        input.target.isHighValue && ev.primeTimeMatched
          ? PRIME_TIME_BONUS_MS
          : 0;
      const score = -distancePenalty + primeBonus - ev.bufferPenaltyMs;
      alternatives.push({
        startUtc: slotStart,
        endUtc: slotEnd,
        score,
        primeTimeMatched: ev.primeTimeMatched,
        bufferPenalty: ev.bufferPenaltyMs,
      });
    }
    cursor += STEP_MS;
  }

  // Rank by score desc (highest = best). With prime-time disabled the
  // proximity-ascending ranking falls out from -|distance|.
  alternatives.sort((a, b) => b.score - a.score);

  return {
    primaryFeasible,
    conflicts,
    alternatives,
    warnings,
  };
}
