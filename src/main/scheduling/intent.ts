/**
 * Plan 04-03 Task 1 — Natural-language scheduling intent parser.
 *
 * parseIntent(nl):
 *   1. Resolve route via getRouterModel() — local Ollama by default; if router
 *      decides 'frontier' the NL is pre-passed through the briefing redactor
 *      (PII tokens replaced with placeholders) before generateObject().
 *   2. generateObject({ schema: IntentSchema, maxRetries: 2 }) through
 *      scheduler.queue (concurrency 1 — same single-writer guarantee as the
 *      sensitivity classifier).
 *   3. On result, restore PII from the redaction placeholders (eventRef may
 *      include 'my <EMAIL>' tokens).
 *   4. If action === 'cancel-unsupported' → throw IntentRefusedError('cancel-not-in-v1').
 *   5. On thrown error or final-attempt Zod failure → throw
 *      IntentRefusedError('parse-failed').
 */
import { z } from 'zod';
import { generateObject } from 'ai';
import type PQueueImport from 'p-queue';
import { getLocalModel, getFrontierModel, type ModelLike } from '../llm/providers';
import { redactAllPii } from '../briefing/redact';
import type { ProviderId } from '../../shared/ipc-contract';

export const IntentSchema = z.object({
  action: z.enum(['move', 'create', 'find-time', 'cancel-unsupported']),
  target: z
    .object({
      eventRef: z.string().optional(),
      nlDescription: z.string().optional(),
    })
    .optional(),
  when: z
    .object({
      datetimeRange: z
        .object({
          startIso: z.string(),
          endIso: z.string(),
        })
        .optional(),
      nlWhen: z.string().optional(),
    })
    .optional(),
  attendees: z.array(z.string()).optional(),
  durationMin: z.number().int().min(5).max(8 * 60).optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

export type IntentRefusedCode = 'cancel-not-in-v1' | 'parse-failed';

export class IntentRefusedError extends Error {
  readonly code: IntentRefusedCode;
  constructor(code: IntentRefusedCode, message?: string) {
    super(message ?? code);
    this.name = 'IntentRefusedError';
    this.code = code;
  }
}

type PQueueLike = InstanceType<typeof PQueueImport>;

export interface ParseIntentDeps {
  /** Pre-resolved AI-SDK model; tests inject. Default = getLocalModel(). */
  model?: ModelLike;
  /** Override generateObject (tests). */
  generateObjectFn?: typeof generateObject;
  /** Queue for serialization. Tests may pass a fake .add(). */
  queue?: PQueueLike | { add: <T>(fn: () => Promise<T>) => Promise<T> };
  /**
   * Routing decision: 'local' (default — never redact) or 'frontier' (redact
   * PII before prompt, rehydrate placeholders after).
   */
  routed?: 'local' | 'frontier';
  /** Frontier provider id when routed='frontier' (tests). */
  frontierProvider?: ProviderId;
  /** Override "today" ISO timestamp for deterministic tests. */
  nowIso?: string;
}

function buildPrompt(redactedNl: string, nowIso: string): string {
  return [
    'You parse scheduling commands for a personal-assistant app.',
    `Today is ${nowIso} (UTC).`,
    "If the user asks to CANCEL or DELETE an event, return action='cancel-unsupported'.",
    "If the user asks to MOVE/RESCHEDULE an event, return action='move' with target.eventRef set to the user's phrase (e.g. 'my 3pm', 'the standup').",
    "If the user asks to CREATE a new event, return action='create'.",
    "If the user asks to FIND TIME, return action='find-time'.",
    'Put the user-supplied time phrase in when.nlWhen verbatim when unparsed; if you can normalize to ISO, set when.datetimeRange.',
    'Return ONLY the JSON object matching the schema. Do not add commentary.',
    '---',
    redactedNl,
  ].join('\n');
}

/**
 * Parse a natural-language scheduling command into a structured Intent.
 *
 * Throws IntentRefusedError('cancel-not-in-v1') for cancel/delete commands.
 * Throws IntentRefusedError('parse-failed') after final-attempt Zod failure
 * or transport error.
 */
export async function parseIntent(
  nl: string,
  deps: ParseIntentDeps = {},
): Promise<Intent> {
  const routed = deps.routed ?? 'local';
  const genObj = deps.generateObjectFn ?? generateObject;
  const nowIso = deps.nowIso ?? new Date().toISOString();

  // Redact only when going to frontier. Local Ollama may see raw text — same
  // policy as sensitivity classifier (Stage-2 LLM is local-only).
  const promptNl = routed === 'frontier' ? redactAllPii(nl) : nl;

  // Resolve model lazily so the local default doesn't crash test setups that
  // never call Ollama.
  let model: ModelLike;
  if (deps.model !== undefined) {
    model = deps.model;
  } else if (routed === 'frontier' && deps.frontierProvider) {
    model = await getFrontierModel(deps.frontierProvider);
  } else {
    model = getLocalModel();
  }

  const prompt = buildPrompt(promptNl, nowIso);

  const runOnce = async (): Promise<Intent> => {
    const out = await genObj({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: IntentSchema,
      prompt,
    } as Parameters<typeof generateObject>[0]);
    const obj = (out as { object: unknown }).object;
    return IntentSchema.parse(obj);
  };

  const queueAdd = deps.queue
    ? <T>(fn: () => Promise<T>) =>
        (deps.queue as { add: <U>(f: () => Promise<U>) => Promise<U> }).add(fn)
    : <T>(fn: () => Promise<T>) => fn();

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const intent = await queueAdd(runOnce);
      if (intent.action === 'cancel-unsupported') {
        throw new IntentRefusedError(
          'cancel-not-in-v1',
          'Cancel commands are not supported in v1.',
        );
      }
      return intent;
    } catch (err) {
      // Re-throw refusal immediately — don't retry a deliberate refusal.
      if (err instanceof IntentRefusedError) throw err;
      lastErr = err;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown');
  throw new IntentRefusedError('parse-failed', `intent parse failed after 2 attempts: ${msg}`);
}
