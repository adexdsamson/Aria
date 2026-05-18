/**
 * Plan 03-04 Task 3 — Drafting agent (few-shot, production voice).
 *
 * `draftReply(db, sourceMessage)` creates an `approval` row in state='ready'
 * with the generated draft body in `body_original`. NEVER sends — sending is
 * the exclusive domain of `src/main/integrations/google/send.ts` and the
 * `assertApproved` gate (Plan 03-01).
 *
 * Crash-recovery invariant (RESEARCH §Pattern 2):
 *   pending → generating  (BEFORE any LLM call)
 *   generating → ready    (after success)
 *
 * If the LLM call throws, the row stays in `generating` so the next-launch
 * `reapInterruptedOnStartup` sweep converts it to `interrupted`. The drafting
 * agent NEVER directly marks a row failed.
 *
 * Sensitivity routing: the agent dispatches via Plan 03-02's `dispatchHybrid`
 * so HR / legal / financial≥med drafts stay LOCAL, PII drafts go through the
 * tokenize+rehydrate hybrid path, and everything else can go frontier. The
 * classifier columns (`categories_json`, `severity`, `confidence`,
 * `classifier_rationale`, `routed`, `classifier_version`) are frozen onto
 * the approval row at `ready` time.
 *
 * Voice exemplars are fetched via `voiceCorpus.fetchExemplars`, which excludes
 * any IDs in `voice_match_holdout` so the few-shot pool never includes the
 * spike's held-out set.
 *
 * Per the Plan 03-04 Task 2 checkpoint decision (`few-shot-production`),
 * `approval.beta_voice` is left at its default 0. The column is declared by
 * migration 009 unconditionally — only a different checkpoint decision would
 * flip it to 1.
 */
import * as crypto from 'node:crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import { insertApproval, transitionTo } from '../approvals/persist';
import { fetchExemplars, type VoiceExemplar } from './voiceCorpus';
import {
  dispatchHybrid,
  type HybridDispatchResult,
} from '../llm/router';

type Db = Database.Database;
type PQueueLike = InstanceType<typeof PQueueImport>;

// =============================================================================
// Schemas / Types
// =============================================================================

export const DraftSchema = z.object({
  subject: z.string().max(200),
  body: z.string().max(5000),
});
export type Draft = z.infer<typeof DraftSchema>;

/** Shape of a `gmail_message` row consumed by the drafting agent. */
export interface GmailMessageRow {
  id: string;
  thread_id: string;
  from_addr: string;
  subject: string;
  snippet: string;
  received_at: string;
}

export interface DraftReplyDeps {
  /** PQueue from the shared scheduler. */
  queue: PQueueLike;
  /** Run the LOCAL Ollama model on a prompt; returns DraftSchema-shaped JSON
   *  (as parsed object). Injected to keep the drafting agent testable. */
  runLocal: (prompt: string) => Promise<Draft>;
  /** Run the active FRONTIER provider on a prompt; returns DraftSchema-shaped JSON. */
  runFrontier: (prompt: string) => Promise<Draft>;
  /** Override exemplar fetcher (tests). */
  fetchExemplarsFn?: (db: Db, source: { subject: string; snippet: string }) => VoiceExemplar[];
}

// =============================================================================
// Few-shot prompt builder
// =============================================================================

export function buildFewShotPrompt(
  exemplars: VoiceExemplar[],
  source: GmailMessageRow,
): string {
  const lines: string[] = [
    'You are drafting a reply in the user\'s voice. Below are recent sent emails',
    'illustrating their tone, length, sign-off style, and formality. Match these.',
    '',
    'Return strict JSON with fields: { "subject": string, "body": string }.',
    'The subject MUST be "Re: <original subject>" unless that is already present.',
    '',
    '--- Voice exemplars (most recent first) ---',
  ];
  for (const ex of exemplars) {
    lines.push(`[${ex.received_at}] subject: ${ex.subject}`);
    lines.push(ex.snippet);
    lines.push('---');
  }
  lines.push('');
  lines.push('--- Incoming message to reply to ---');
  lines.push(`from: ${source.from_addr}`);
  lines.push(`subject: ${source.subject}`);
  lines.push(`received: ${source.received_at}`);
  lines.push('');
  lines.push(source.snippet);
  lines.push('');
  lines.push('--- Draft your reply now (JSON only) ---');
  return lines.join('\n');
}

// =============================================================================
// Reply-target extraction
// =============================================================================

function replyRecipients(from: string): string[] {
  // Extract email out of "Name <addr@host>" or fall back to the raw string.
  const m = from.match(/<([^>]+)>/);
  return [m ? m[1]! : from];
}

function replySubject(subject: string): string {
  const s = (subject ?? '').trim();
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

// =============================================================================
// draftReply
// =============================================================================

export interface DraftReplyResult {
  approvalId: string;
  routed: HybridDispatchResult['routed'];
}

/**
 * Build a draft reply for `sourceMessage`, insert an approval row, and leave
 * it in state='ready' with classifier columns populated.
 *
 * Steps (RESEARCH §Pattern 2 crash-recovery invariant honored):
 *   1. insert row in state='pending'
 *   2. transitionTo 'generating' BEFORE the LLM call
 *   3. fetch exemplars (excluding voice_match_holdout)
 *   4. dispatchHybrid for routing + tokenize/rehydrate on hybrid path
 *   5. parse DraftSchema
 *   6. transitionTo 'ready' with classifier columns + body
 *
 * If steps 3-5 throw, the row stays in 'generating' so the next-launch sweep
 * picks it up as 'interrupted' (Pattern 2). This function does NOT swallow
 * the exception — callers (the IPC handler) decide whether to surface or log.
 */
export async function draftReply(
  db: Db,
  sourceMessage: GmailMessageRow,
  deps: DraftReplyDeps,
): Promise<DraftReplyResult> {
  const recipients = replyRecipients(sourceMessage.from_addr);
  const subject = replySubject(sourceMessage.subject);

  const id = insertApproval(db, {
    kind: 'email_send',
    source_message_id: sourceMessage.id,
    recipients_json: JSON.stringify(recipients),
    subject,
    approval_path: 'explicit',
  });
  // Pattern 2: 'generating' BEFORE the LLM call so a mid-call crash leaves a
  // recoverable row.
  transitionTo(db, id, 'generating');

  const fetcher = deps.fetchExemplarsFn ?? ((d, s) => fetchExemplars(d, s));
  const exemplars = fetcher(db, {
    subject: sourceMessage.subject,
    snippet: sourceMessage.snippet,
  });
  const prompt = buildFewShotPrompt(exemplars, sourceMessage);

  // Wrap the per-route generators so dispatchHybrid sees `string -> string`
  // (the router's surface). Each generator returns the draft JSON as a string
  // so dispatchHybrid can run its tokenize/rehydrate pipeline on the hybrid
  // path (rehydrate substitutes PII tokens back into the JSON before we parse).
  const result = await dispatchHybrid({
    approvalId: id,
    prompt,
    queue: deps.queue,
    runLocal: async (p) => {
      const d = await deps.runLocal(p);
      return JSON.stringify(DraftSchema.parse(d));
    },
    runFrontier: async (p) => {
      const d = await deps.runFrontier(p);
      return JSON.stringify(DraftSchema.parse(d));
    },
  });

  // On the hybrid path `result.text` is the rehydrated JSON; on local/frontier
  // paths it is the raw JSON. Parsing it gives us the final draft.
  const rehydratedDraft = DraftSchema.parse(JSON.parse(result.text));

  const cls = result.classifier;
  transitionTo(db, id, 'ready', {
    body_original: rehydratedDraft.body,
    subject: rehydratedDraft.subject,
    categories_json: JSON.stringify(cls.categories),
    severity: cls.severity,
    confidence: cls.confidence,
    classifier_rationale: cls.rationale,
    classifier_version: result.classifier_version,
    routed: result.routed,
  });

  return { approvalId: id, routed: result.routed };
}
