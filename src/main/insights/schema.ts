/**
 * Phase 8 Stream 1 — Insight schema.
 *
 * Single source of truth for the `insights` table row shape AND the per-kind
 * payload validation schema. The payload schema is a zod discriminated union
 * so the prose generator and the briefing read path can both narrow on `kind`.
 *
 * INSIGHT-03 invariant: payloads contain ONLY numeric aggregates and theme
 * LABELS (≤30 chars). NEVER raw email bodies, calendar titles, transcript
 * segments, or any other unredacted user content. The static-grep ratchet
 * (`scripts/grep-insight-prose-no-raw.mjs`) enforces that prose.ts cannot
 * import raw-content tables.
 */
import { z } from 'zod';

export const INSIGHT_KINDS = [
  'calendar_load',
  'response_time',
  'recurring_themes',
  'approval_edits',
] as const;

export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * Persistent row shape in the `insights` table (migration 128).
 */
export interface InsightRow {
  id: number;
  kind: InsightKind;
  week_ymd: string;
  computed_at: string;
  payload_json: string;
  dismissed: 0 | 1;
}

// --- Per-kind payload schemas -----------------------------------------------

/** calendarLoadDelta — meeting-hours week-over-week. */
export const CalendarLoadPayload = z.object({
  kind: z.literal('calendar_load'),
  meetingHoursThisWeek: z.number().nonnegative(),
  meetingHoursLastWeek: z.number().nonnegative(),
  deltaPct: z.number(),
  focusBlockCount: z.number().int().nonnegative(),
});
export type CalendarLoadPayload = z.infer<typeof CalendarLoadPayload>;

/** responseTimeTrend — median minutes-to-reply trend + top contacts. */
export const ResponseTimePayload = z.object({
  kind: z.literal('response_time'),
  medianMinutesThisWeek: z.number().nonnegative(),
  medianMinutesLastWeek: z.number().nonnegative(),
  deltaMinutes: z.number(),
  perPersonTop3: z
    .array(
      z.object({
        contactEmail: z.string(),
        medianMinutes: z.number().nonnegative(),
      }),
    )
    .max(3),
});
export type ResponseTimePayload = z.infer<typeof ResponseTimePayload>;

/** recurringThemes — k-means cluster labels (≤30 chars each, no raw text). */
export const RecurringThemesPayload = z.object({
  kind: z.literal('recurring_themes'),
  topThemes: z.array(z.string().max(30)).max(8),
});
export type RecurringThemesPayload = z.infer<typeof RecurringThemesPayload>;

/** approvalEditPattern — share of drafts the user edited + top categories. */
export const ApprovalEditsPayload = z.object({
  kind: z.literal('approval_edits'),
  editedDraftSharePct: z.number().min(0).max(100),
  topEditCategories: z.array(z.string().max(30)).max(5),
});
export type ApprovalEditsPayload = z.infer<typeof ApprovalEditsPayload>;

export const InsightPayloadSchema = z.discriminatedUnion('kind', [
  CalendarLoadPayload,
  ResponseTimePayload,
  RecurringThemesPayload,
  ApprovalEditsPayload,
]);
export type InsightPayload = z.infer<typeof InsightPayloadSchema>;

/**
 * ProseOut — output of insightProse() (Task 4). 1–3 short sentences derived
 * exclusively from numeric aggregates and theme LABELS.
 */
export const ProseOutSchema = z.object({
  sentences: z.array(z.string().max(220)).min(1).max(3),
});
export type ProseOut = z.infer<typeof ProseOutSchema>;
