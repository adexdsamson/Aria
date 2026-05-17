/**
 * Plan 03-02 — Two-stage sensitivity classifier.
 *
 * Stage 1: existing `classifySensitivity()` regex hard-rules (email/ssn/phone/
 *           currency/bearer/oauth-code) produces `matched: string[]`.
 * Stage 2: `generateObject` against the local Ollama model with a Zod schema
 *           that enriches the regex hit list with `{ categories, severity,
 *           confidence, rationale }`. Up to 2 attempts.
 * Stage 3: regex-fallback synthesis on Stage-2 failure — never throws; returns
 *           a deterministic result with `confidence=0.5`.
 *
 * All Stage-2 LLM dispatches go through `scheduler.queue` (p-queue concurrency
 * 1) per CONTEXT §cross-cutting + RESEARCH §Standard Stack.
 *
 * v1: regex-only redaction; PERSON/ORG NER deferred per RESEARCH §OQ-1.
 * Compensating control: HR/legal/financial≥med routes entirely local in
 * router.ts.
 */
import { z } from 'zod';
import { generateObject } from 'ai';
import type PQueueImport from 'p-queue';
import { classifySensitivity } from './classifier';
import { getLocalModel, type ModelLike } from './providers';

export const SensitivitySchema = z.object({
  categories: z
    .array(z.enum(['financial', 'legal', 'hr', 'pii', 'urgent', 'none']))
    .min(1),
  severity: z.enum(['low', 'med', 'high']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
});

export type SensitivityCategory =
  | 'financial'
  | 'legal'
  | 'hr'
  | 'pii'
  | 'urgent'
  | 'none';

export type SensitivityResult = z.infer<typeof SensitivitySchema>;

export const CLASSIFIER_VERSION = 'v1-llama3.1-8b-q4-2026-05';

export interface ClassifyOptions {
  /** Injected model (tests). Defaults to `getLocalModel()`. */
  model?: ModelLike;
  /**
   * Override the generateObject implementation (tests). Default is the real
   * AI-SDK 6 `generateObject`. Signature mirrors the partial we use.
   */
  generateObjectFn?: typeof generateObject;
}

type PQueueLike = InstanceType<typeof PQueueImport>;

function buildClassifierPrompt(text: string, matched: string[]): string {
  const hints = matched.length > 0
    ? `Regex prefilter matched: ${matched.join(', ')}.`
    : 'Regex prefilter matched nothing.';
  return [
    'You are a sensitivity classifier for an executive personal-assistant app.',
    'Classify the following text. Multi-label categories allowed. Pick severity for the most serious category present. Confidence 0-1.',
    'Categories: financial (money decisions, contracts, deals), legal (legal advice, disputes, NDAs), hr (hiring, firing, comp, employee issues), pii (personally identifying info: email, phone, ssn, etc), urgent (deadline/escalation language), none.',
    hints,
    'Return rationale ≤200 chars.',
    '---',
    text,
  ].join('\n');
}

/**
 * Classify `text`. Never throws — on LLM failure synthesizes a deterministic
 * result from the regex prefilter (Stage 3).
 */
export async function classify(
  text: string,
  queue: PQueueLike,
  opts: ClassifyOptions = {},
): Promise<SensitivityResult> {
  const regex = classifySensitivity(text);
  const model = opts.model ?? getLocalModel();
  const genObj = opts.generateObjectFn ?? generateObject;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const queued = queue.add(async () => {
        const r = await genObj({
          model: model as Parameters<typeof generateObject>[0]['model'],
          schema: SensitivitySchema,
          prompt: buildClassifierPrompt(text, regex.matched),
        } as Parameters<typeof generateObject>[0]);
        return (r as { object: SensitivityResult }).object;
      });
      const out = (await queued) as SensitivityResult | undefined;
      if (out) {
        return SensitivitySchema.parse(out);
      }
    } catch (err) {
      lastErr = err;
    }
  }

  // Stage 3: regex-fallback synthesis. Fail-closed to "sensitive" when regex
  // matched anything; else 'none'/'low'. NEVER throws.
  const sensitive = regex.matched.length > 0;
  const errStr = lastErr instanceof Error ? lastErr.message : String(lastErr ?? '');
  return {
    categories: sensitive ? ['pii'] : ['none'],
    severity: sensitive ? 'high' : 'low',
    confidence: 0.5,
    rationale: `LLM unavailable (${errStr || 'no-result'}); regex-only: ${regex.matched.join(',')}`,
  };
}
