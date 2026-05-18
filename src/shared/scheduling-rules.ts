/**
 * Plan 04-02 Task 1 — shared RulesSchema (Zod) + Rules type + DEFAULT_RULES.
 *
 * Shared between the main process (authoritative validator at the IPC
 * boundary) and the renderer (UX-level validation + advanced-JSON parsing
 * before the Save button fires). Time-zone field carries the canonical
 * IANA zone for day-of-week + HH:mm interpretation in the conflict
 * detector.
 *
 * RESEARCH Q1 RESOLVED: Google Calendar v3 settings does not expose
 * working-hours; the optional `workingHours` field here is the
 * user-configured fallback the conflict detector consults when
 * workingHoursPerDay is undefined.
 */
import { z } from 'zod';

const HHMM = /^\d{2}:\d{2}$/;

const DayEnum = z.union([
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.literal('all'),
]);

export const RulesSchema = z.object({
  focusBlocks: z.array(
    z.object({
      day: DayEnum,
      start: z.string().regex(HHMM),
      end: z.string().regex(HHMM),
      label: z.string().max(60).optional(),
    }),
  ),
  buffers: z.object({
    beforeMin: z.number().int().min(0).max(120),
    afterMin: z.number().int().min(0).max(120),
  }),
  noMeetingWindows: z.array(
    z.object({
      day: DayEnum,
      start: z.string().regex(HHMM),
      end: z.string().regex(HHMM),
      label: z.string().max(60),
    }),
  ),
  primeTimeWindows: z.array(
    z.object({
      day: DayEnum,
      start: z.string().regex(HHMM),
      end: z.string().regex(HHMM),
    }),
  ),
  timeZone: z.string().min(1),
  workingHours: z
    .object({
      start: z.string().regex(HHMM),
      end: z.string().regex(HHMM),
      weekdays: z.array(z.number().int().min(0).max(6)),
    })
    .optional(),
});

export type Rules = z.infer<typeof RulesSchema>;

export const DEFAULT_RULES: Rules = {
  focusBlocks: [],
  buffers: { beforeMin: 0, afterMin: 0 },
  noMeetingWindows: [],
  primeTimeWindows: [],
  timeZone: 'UTC',
};

export type Day = z.infer<typeof DayEnum>;
