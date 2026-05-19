import { z } from 'zod';
import { generateObject } from 'ai';
import type { Route } from '../../shared/ipc-contract';
import { chunkTranscriptForExtraction } from './chunk';
import { offsetCitation, validateCitation, type Citation } from './citations';
import { dedupeActions } from './dedupe-actions';

export type MeetingActionOwner = 'self' | 'follow-up' | 'unassigned';

export interface MeetingActionArtifact {
  text: string;
  owner: MeetingActionOwner;
  followUpWith?: string;
  dueHint?: { iso?: string; raw: string; confidence: 'high' | 'med' | 'low' };
  priorityHint?: 'p1' | 'p2' | 'p3' | 'p4';
  citation: Citation;
  confidence: number;
}

export interface MeetingSummaryArtifact {
  topicsCovered: Array<{ text: string; citation: Citation }>;
  decisions: Array<{ text: string; citation: Citation }>;
  followUps: Array<{ text: string; citation: Citation }>;
  openQuestions: Array<{ text: string; citation: Citation }>;
}

export interface MeetingExtractionResult {
  actions: MeetingActionArtifact[];
  summary: MeetingSummaryArtifact;
  route: Route;
  model: string;
  notes?: string;
}

const CitationSchema = z.object({ start: z.number().int(), end: z.number().int() });
const SummaryItemSchema = z.object({ text: z.string(), citation: CitationSchema });

export const MeetingExtractionSchema = z.object({
  actions: z.array(z.object({
    text: z.string(),
    owner: z.enum(['self', 'follow-up', 'unassigned']),
    followUpWith: z.string().optional(),
    dueHint: z.object({
      iso: z.string().optional(),
      raw: z.string(),
      confidence: z.enum(['high', 'med', 'low']),
    }).optional(),
    priorityHint: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
    citation: CitationSchema,
    confidence: z.number().min(0).max(1),
  })),
  summary: z.object({
    topicsCovered: z.array(SummaryItemSchema),
    decisions: z.array(SummaryItemSchema),
    followUps: z.array(SummaryItemSchema),
    openQuestions: z.array(SummaryItemSchema),
  }),
  notes: z.string().optional(),
});

type GenerateObjectLike = typeof generateObject;

export async function extractMeetingArtifacts(args: {
  normalizedText: string;
  meetingDateIso: string;
  route?: Route;
  modelName?: string;
  model?: unknown;
  generateObjectFn?: GenerateObjectLike;
}): Promise<MeetingExtractionResult> {
  const gen = args.generateObjectFn ?? generateObject;
  const chunks = chunkTranscriptForExtraction(args.normalizedText);
  const actions: MeetingActionArtifact[] = [];
  const summary: MeetingSummaryArtifact = {
    topicsCovered: [],
    decisions: [],
    followUps: [],
    openQuestions: [],
  };
  let notes: string | undefined;

  for (const chunk of chunks) {
    const result = await gen({
      model: args.model as Parameters<GenerateObjectLike>[0]['model'],
      schema: MeetingExtractionSchema,
      prompt: buildPrompt(chunk.text, args.meetingDateIso),
    } as Parameters<GenerateObjectLike>[0]);
    const object = (result as { object: z.infer<typeof MeetingExtractionSchema> }).object;
    for (const action of object.actions) {
      const citation = validateCitation(offsetCitation(action.citation, chunk.startOffset), args.normalizedText);
      if (!citation) continue;
      actions.push({ ...action, citation, confidence: action.confidence, owner: action.owner });
    }
    appendSummary(summary.topicsCovered, object.summary.topicsCovered, chunk.startOffset, args.normalizedText);
    appendSummary(summary.decisions, object.summary.decisions, chunk.startOffset, args.normalizedText);
    appendSummary(summary.followUps, object.summary.followUps, chunk.startOffset, args.normalizedText);
    appendSummary(summary.openQuestions, object.summary.openQuestions, chunk.startOffset, args.normalizedText);
    notes = notes ?? object.notes;
  }

  return {
    actions: dedupeActions(actions).map((action) => ({
      ...action,
      dueHint: action.dueHint ? resolveDueHint(action.dueHint, args.meetingDateIso) : undefined,
    })),
    summary,
    route: args.route ?? 'LOCAL',
    model: args.modelName ?? 'test-model',
    notes,
  };
}

function appendSummary(
  target: Array<{ text: string; citation: Citation }>,
  items: Array<{ text: string; citation: Citation }>,
  chunkStartOffset: number,
  normalizedText: string,
): void {
  for (const item of items) {
    const citation = validateCitation(offsetCitation(item.citation, chunkStartOffset), normalizedText);
    if (citation) target.push({ text: item.text, citation });
  }
}

function resolveDueHint(
  dueHint: NonNullable<MeetingActionArtifact['dueHint']>,
  meetingDateIso: string,
): NonNullable<MeetingActionArtifact['dueHint']> {
  if (dueHint.iso || dueHint.confidence !== 'high') return dueHint;
  const lowered = dueHint.raw.toLowerCase();
  const base = new Date(meetingDateIso);
  if (lowered.includes('tomorrow')) {
    base.setUTCDate(base.getUTCDate() + 1);
    return { ...dueHint, iso: base.toISOString().slice(0, 10) };
  }
  return dueHint;
}

function buildPrompt(text: string, meetingDateIso: string): string {
  return [
    'Extract cited meeting artifacts as JSON.',
    `Meeting date: ${meetingDateIso}`,
    'Every item must cite character offsets relative to this chunk.',
    text,
  ].join('\n\n');
}
