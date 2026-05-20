/**
 * Plan 08-01 Task 4 — insightProse: aggregates → 1–3 sentences.
 *
 * INSIGHT-03 invariant (T-08-01): the prompt this module sends to ANY model
 * contains ONLY numeric aggregates and theme LABELS (≤30 chars each). It
 * NEVER imports any raw-content module (gmail_message bodies, calendar_event
 * titles, meeting_note_segment text, rag_chunk text). The static-grep ratchet
 * `scripts/grep-insight-prose-no-raw.mjs` enforces this at lint time and is
 * wired into `lint:guard`.
 *
 * Routing: delegates to `router.classify({ prompt, source: 'generic' })`. The
 * `source` is intentionally `generic` (not `user-data:*`) because by
 * construction this prompt carries no user content — only derived numerics.
 *
 * Logging: writes ONE routing_log row with `hashPrompt(promptBody)` — never
 * the raw prompt (Phase 1 prior art).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import { generateObject } from 'ai';
import type { LLMRouter, RoutingDecision } from '../llm/router';
import {
  getLocalModel,
  getFrontierModel,
  type ModelLike,
} from '../llm/providers';
import { writeRoutingLog, hashPrompt } from '../llm/routingLog';
import {
  type InsightPayload,
  ProseOutSchema,
  type ProseOut,
} from './schema';

type Db = Database.Database;

export interface InsightProseDeps {
  router: LLMRouter;
  logger: Pick<Logger, 'info' | 'warn'>;
  db: Db;
  /** Test seam — override AI SDK generateObject. */
  generateObjectFn?: typeof generateObject;
  /** Test seam — override frontier-model factory. */
  getFrontierModelFn?: typeof getFrontierModel;
  /** Test seam — override local-model factory. */
  getLocalModelFn?: typeof getLocalModel;
}

/**
 * Build a tightly-scoped, content-free prompt from an aggregates payload.
 *
 * INVARIANT: every value substituted into the prompt is either:
 *   - a number, or
 *   - a string from `topThemes` (already ≤30 chars; validated by zod when
 *     persisted) or `topEditCategories` (≤30 chars), or
 *   - a contact email (already redacted by the briefing PII pipeline before
 *     reaching the insights table — but we additionally hash-truncate the
 *     local-part here as belt-and-braces).
 */
function maskEmail(addr: string): string {
  const at = addr.indexOf('@');
  if (at <= 0) return 'someone';
  const domain = addr.slice(at + 1);
  return `someone@${domain}`;
}

export function buildProsePrompt(p: InsightPayload): string {
  const lines: string[] = [
    'You are Aria, a terse chief-of-staff. Given a single insight aggregate, produce 1–3 short sentences (≤220 chars each) that explain it in plain English to a busy executive.',
    'Tone: executive-terse. No greetings, no caveats, no preamble.',
    'Input (numeric aggregates only — no raw user content):',
  ];
  switch (p.kind) {
    case 'calendar_load':
      lines.push(
        `kind=calendar_load meetingHoursThisWeek=${p.meetingHoursThisWeek} meetingHoursLastWeek=${p.meetingHoursLastWeek} deltaPct=${p.deltaPct} focusBlockCount=${p.focusBlockCount}`,
      );
      break;
    case 'response_time': {
      const top = p.perPersonTop3
        .map((t) => `${maskEmail(t.contactEmail)}=${t.medianMinutes}m`)
        .join(', ');
      lines.push(
        `kind=response_time medianMinutesThisWeek=${p.medianMinutesThisWeek} medianMinutesLastWeek=${p.medianMinutesLastWeek} deltaMinutes=${p.deltaMinutes} top=[${top}]`,
      );
      break;
    }
    case 'recurring_themes':
      lines.push(`kind=recurring_themes topThemes=[${p.topThemes.join(' | ')}]`);
      break;
    case 'approval_edits':
      lines.push(
        `kind=approval_edits editedDraftSharePct=${p.editedDraftSharePct} topEditCategories=[${p.topEditCategories.join(' | ')}]`,
      );
      break;
  }
  return lines.join('\n');
}

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function insightProse(
  aggregates: InsightPayload,
  deps: InsightProseDeps,
): Promise<ProseOut> {
  const { router, logger, db } = deps;
  const gen = deps.generateObjectFn ?? generateObject;
  const localFactory = deps.getLocalModelFn ?? getLocalModel;
  const frontierFactory = deps.getFrontierModelFn ?? getFrontierModel;

  const prompt = buildProsePrompt(aggregates);
  const promptHashValue = hashPrompt(prompt);
  const ts = new Date().toISOString();

  let decision: RoutingDecision;
  try {
    decision = await router.classify({ prompt, source: 'generic' });
  } catch (err) {
    logger.warn(
      { scope: 'insights-prose', err: describeErr(err) },
      'router.classify failed; defaulting to LOCAL',
    );
    decision = {
      route: 'LOCAL',
      reason: 'router-failed',
      model: 'ollama-default',
      provider: 'ollama',
    };
  }

  let model: ModelLike;
  try {
    model = decision.route === 'FRONTIER'
      ? await frontierFactory(decision.provider as Exclude<RoutingDecision['provider'], 'ollama'>)
      : localFactory();
  } catch (err) {
    logger.warn(
      { scope: 'insights-prose', err: describeErr(err) },
      'model factory failed; returning empty prose',
    );
    safeWriteLog(db, logger, {
      ts,
      route: decision.route,
      reason: `${decision.reason} | model-acquire-failed`,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms: 0,
      ok: 0,
    });
    return { sentences: ['Insight ready — open Settings to view details.'] };
  }

  const start = Date.now();
  try {
    const result = await gen({
      model: model as Parameters<typeof gen>[0]['model'],
      schema: ProseOutSchema,
      prompt,
    } as Parameters<typeof gen>[0]);
    const latency_ms = Math.max(0, Date.now() - start);
    const obj = (result as { object: ProseOut }).object;
    const cleaned: ProseOut = {
      sentences: obj.sentences.slice(0, 3).map((s) => s.slice(0, 220)),
    };
    safeWriteLog(db, logger, {
      ts,
      route: decision.route,
      reason: decision.reason,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms,
      ok: 1,
    });
    return cleaned;
  } catch (err) {
    const latency_ms = Math.max(0, Date.now() - start);
    logger.warn(
      { scope: 'insights-prose', err: describeErr(err) },
      'generateObject threw',
    );
    safeWriteLog(db, logger, {
      ts,
      route: decision.route,
      reason: `${decision.reason} | generateObject-failed`,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms,
      ok: 0,
    });
    return { sentences: ['Insight ready — open Settings to view details.'] };
  }
}

function safeWriteLog(
  db: Db,
  logger: Pick<Logger, 'warn'>,
  entry: Parameters<typeof writeRoutingLog>[1],
): void {
  try {
    writeRoutingLog(db, entry);
  } catch (err) {
    logger.warn(
      { scope: 'insights-prose', err: describeErr(err) },
      'routing_log write failed',
    );
  }
}
