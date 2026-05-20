/**
 * Plan 08-02 Task 3 — Weekly recap orchestrator.
 *
 * `generateWeeklyRecap` orchestrates:
 *   1. Gather: audit rows (Mon–Sun of the prior week) + calendar event count.
 *   2. Pass-1 LLM call: structured audit list → { narrative, actionRefs[] }.
 *   3. Pass-2 cross-validation: every actionRef must exist in the audit row IDs.
 *      If any reference is hallucinated, narrative is truncated and the flag
 *      `hallucinationDetected: true` is set on the result.
 *   4. Persist via `saveWeeklyRecap` (idempotent upsert on iso_week).
 *
 * Routing log: writes ONE row with source='recap-narrative' + prompt_hash.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import { generateObject } from 'ai';
import type { LLMRouter, RoutingDecision } from '../llm/router';
import { getLocalModel, getFrontierModel, type ModelLike } from '../llm/providers';
import { writeRoutingLog, hashPrompt } from '../llm/routingLog';
import {
  readActionAuditWindow,
  renderAuditRowLine,
  type ActionAuditRow,
} from './audit-view';
import {
  NarrativeOutSchema,
  type RecapCanonical,
} from './schema';
import { saveWeeklyRecap, type WeeklyRecapRow } from './persist';

type Db = Database.Database;

export interface GenerateWeeklyRecapArgs {
  isoWeek: string;
  weekStartYmd: string;
  /** Mon-of-week ISO timestamp (inclusive lower bound for audit window). */
  fromIso: string;
  /** Sun-of-week end ISO timestamp (inclusive upper bound). */
  toIso: string;
  router: LLMRouter;
  logger: Pick<Logger, 'info' | 'warn'>;
  now?: Date;
  /** Test seam — replace AI SDK generateObject. */
  generateObjectFn?: typeof generateObject;
  getFrontierModelFn?: typeof getFrontierModel;
  getLocalModelFn?: typeof getLocalModel;
}

export interface GenerateWeeklyRecapResult {
  recap: WeeklyRecapRow;
  hallucinationDetected: boolean;
  auditRowCount: number;
}

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Build a narrative prompt from a structured audit list. No raw PII — uses the deterministic line renderer. */
export function buildNarrativePrompt(rows: ActionAuditRow[]): string {
  const lines = [
    'You are Aria, a terse chief-of-staff. Given the structured list of actions you took for a user this week, write a 2–4 sentence narrative summarizing what was accomplished.',
    'Constraints:',
    "  • Only reference actions present in the list below — do NOT invent or extrapolate.",
    "  • Output `actionRefs[]` containing the EXACT row IDs from the list that your narrative references (a subset; can be empty).",
    "  • Tone: executive-terse. No greetings, no caveats.",
    '',
    'Structured audit list (id → summary):',
  ];
  for (const r of rows) {
    lines.push(`  [${r.id}] ${renderAuditRowLine(r)}`);
  }
  return lines.join('\n');
}

/**
 * Generate the weekly recap end-to-end.
 *
 * Returns a `RecapCanonical` whose `whatAriaDid` section contains:
 *   - narrative: LLM string (may be truncated if PASS-2 detects hallucination)
 *   - auditRowRefs: cross-validated subset of audit IDs
 *   - blocks: rendered list of audit rows (the trust anchor)
 */
export async function generateWeeklyRecap(
  db: Db,
  args: GenerateWeeklyRecapArgs,
): Promise<GenerateWeeklyRecapResult> {
  const { router, logger } = args;
  const gen = args.generateObjectFn ?? generateObject;
  const localFactory = args.getLocalModelFn ?? getLocalModel;
  const frontierFactory = args.getFrontierModelFn ?? getFrontierModel;

  // 1. Gather audit rows for the window.
  const auditRows = readActionAuditWindow(db, {
    fromIso: args.fromIso,
    toIso: args.toIso,
    limit: 500,
  });
  const validIds = new Set(auditRows.map((r) => r.id));

  // 2. PASS 1 — narrative LLM call.
  const prompt = buildNarrativePrompt(auditRows);
  const promptHashValue = hashPrompt(prompt);
  const ts = new Date().toISOString();

  let decision: RoutingDecision;
  try {
    decision = await router.classify({ prompt, source: 'generic' });
  } catch (err) {
    logger.warn({ scope: 'recap-narrative', err: describeErr(err) }, 'router.classify failed; defaulting to LOCAL');
    decision = { route: 'LOCAL', reason: 'router-failed', model: 'ollama-default', provider: 'ollama' };
  }

  let model: ModelLike | null = null;
  try {
    model = decision.route === 'FRONTIER'
      ? await frontierFactory(decision.provider as Exclude<RoutingDecision['provider'], 'ollama'>)
      : localFactory();
  } catch (err) {
    logger.warn({ scope: 'recap-narrative', err: describeErr(err) }, 'model factory failed; using empty narrative');
  }

  let narrative = '';
  let actionRefs: string[] = [];
  const start = Date.now();
  if (model) {
    try {
      const result = await gen({
        model: model as Parameters<typeof gen>[0]['model'],
        schema: NarrativeOutSchema,
        prompt,
      } as Parameters<typeof gen>[0]);
      const obj = (result as { object: { narrative: string; actionRefs: string[] } }).object;
      narrative = obj.narrative.slice(0, 2000);
      actionRefs = obj.actionRefs;
      try {
        writeRoutingLog(db, {
          ts,
          route: decision.route,
          reason: decision.reason,
          source: 'recap-narrative',
          prompt_hash: promptHashValue,
          model: decision.model,
          latency_ms: Math.max(0, Date.now() - start),
          ok: 1,
        });
      } catch { /* best-effort */ }
    } catch (err) {
      logger.warn({ scope: 'recap-narrative', err: describeErr(err) }, 'generateObject threw');
      try {
        writeRoutingLog(db, {
          ts,
          route: decision.route,
          reason: `${decision.reason} | generateObject-failed`,
          source: 'recap-narrative',
          prompt_hash: promptHashValue,
          model: decision.model,
          latency_ms: Math.max(0, Date.now() - start),
          ok: 0,
        });
      } catch { /* best-effort */ }
    }
  }

  // 3. PASS 2 — cross-validate every actionRef.
  let hallucinationDetected = false;
  const validatedRefs = actionRefs.filter((id) => validIds.has(id));
  if (validatedRefs.length < actionRefs.length) {
    hallucinationDetected = true;
    logger.warn(
      { scope: 'recap-narrative', dropped: actionRefs.length - validatedRefs.length },
      'narrative referenced audit IDs not in the audit list; truncating',
    );
    narrative = `${narrative.slice(0, 400)} [Aria: list above is the source of truth.]`;
  }

  // 4. Build canonical recap. Other sections are seeded empty here; the editor
  // is the surface where the user fills them in. The structured audit list is
  // rendered into whatAriaDid.blocks as bullet items deterministically.
  const auditBlocks = [{
    kind: 'bullet_list' as const,
    items: auditRows.map(renderAuditRowLine),
  }];

  const canonical: RecapCanonical = {
    isoWeek: args.isoWeek,
    weekStartYmd: args.weekStartYmd,
    meetings: { heading: 'Meetings held', blocks: [] },
    actions: { heading: 'Actions closed / open', blocks: [] },
    wins: { heading: 'Wins', blocks: [] },
    upcoming: { heading: "What's coming", blocks: [] },
    whatAriaDid: {
      heading: 'What Aria did this week',
      narrative,
      auditRowRefs: validatedRefs,
      blocks: auditBlocks,
    },
  };

  // 5. Persist.
  const recap = saveWeeklyRecap(db, {
    isoWeek: args.isoWeek,
    weekStartYmd: args.weekStartYmd,
    canonical,
    now: args.now,
  });

  logger.info(
    { scope: 'recap-generate', isoWeek: args.isoWeek, auditRows: auditRows.length, hallucinationDetected },
    'weekly recap generated',
  );

  return { recap, hallucinationDetected, auditRowCount: auditRows.length };
}
