/**
 * Plan 08-02 Task 2 — RecapCanonical zod schema.
 *
 * Single source of truth between TipTap editor and DOCX + PDF exporters
 * (research §Pitfall 7 — never round-trip via HTML).
 *
 * Closed shape: extra top-level sections are REJECTED by `.strict()` so a
 * future renderer can't silently introduce a section that the exporters drop.
 */
import { z } from 'zod';

export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paragraph'), text: z.string() }),
  z.object({ kind: z.literal('bullet_list'), items: z.array(z.string()) }),
  z.object({ kind: z.literal('numbered_list'), items: z.array(z.string()) }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const SectionSchema = z.object({
  heading: z.string(),
  blocks: z.array(BlockSchema),
}).strict();
export type Section = z.infer<typeof SectionSchema>;

export const WhatAriaDidSectionSchema = z.object({
  heading: z.string(),
  narrative: z.string(),
  auditRowRefs: z.array(z.string()),
  blocks: z.array(BlockSchema).default([]),
}).strict();
export type WhatAriaDidSection = z.infer<typeof WhatAriaDidSectionSchema>;

export const RecapCanonicalSchema = z.object({
  isoWeek: z.string(),
  weekStartYmd: z.string(),
  meetings: SectionSchema,
  actions: SectionSchema,
  wins: SectionSchema,
  upcoming: SectionSchema,
  whatAriaDid: WhatAriaDidSectionSchema,
}).strict();
export type RecapCanonical = z.infer<typeof RecapCanonicalSchema>;

export const RECAP_SECTION_KEYS = [
  'meetings',
  'actions',
  'wins',
  'upcoming',
  'whatAriaDid',
] as const;
export type RecapSectionKey = typeof RECAP_SECTION_KEYS[number];

/** Narrative LLM output schema — used by generate.ts PASS 1. */
export const NarrativeOutSchema = z.object({
  narrative: z.string(),
  actionRefs: z.array(z.string()),
});
export type NarrativeOut = z.infer<typeof NarrativeOutSchema>;

/** Section-prose LLM output schema (used for meetings/actions/wins/upcoming sections). */
export const SectionProseSchema = z.object({
  heading: z.string(),
  blocks: z.array(BlockSchema),
});
