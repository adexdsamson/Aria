/**
 * Plan 08-04 Task 2 — concrete LlmInvocation impl.
 *
 * Phase 7 closure: implements the LlmInvocation interface required by
 * createAnswerService. Routes LOCAL vs FRONTIER via the existing
 * LLMRouter + provider factories. Parses the AI SDK 6 generateObject
 * result against a tight Zod schema (answer + integer-citation array).
 *
 * Logging hygiene: never log raw prompt or answer. Routing-log entries
 * are written by the AnswerService caller via writeRoutingLog.
 */
import { z } from 'zod';
import { generateObject } from 'ai';
import type { Route } from './answer-router';
import {
  getActiveLocalModelId,
  getLocalModel,
  getFrontierModel,
  OllamaUnavailableError,
  FrontierUnavailableError,
} from '../llm/providers';
import { getActiveProvider } from '../secrets/safeStorage';

/**
 * Schema for parsing LLM answers. The answer cap (8000 chars) matches the
 * Phase-3 sensitivity-classifier convention; citation indices are 1-based
 * and bounded to the top-K we ever feed the router (20).
 */
export const AnswerCitationsSchema = z.object({
  answer: z.string().max(8000),
  citations: z.array(z.number().int().min(1).max(20)).max(20),
});

export type AnswerCitations = z.infer<typeof AnswerCitationsSchema>;

export interface LlmInvocationDeps {
  /** Override generateObject for unit tests. */
  generateObjectFn?: typeof generateObject;
  /** Override model resolution for unit tests. */
  resolveLocalModel?: () => unknown;
  resolveFrontierModel?: () => Promise<unknown>;
}

/**
 * Build the concrete LlmInvocation passed to createAnswerService. Returns
 * `null` if the model returned no parseable object — the AnswerService
 * surfaces that as a refusal upstream.
 */
export function makeAnswerLlmInvocation(deps: LlmInvocationDeps = {}): {
  generate: (args: {
    prompt: string;
    route: Route;
    requestKey: string;
  }) => Promise<AnswerCitations | null>;
} {
  const genObj = deps.generateObjectFn ?? generateObject;
  const resolveLocal = deps.resolveLocalModel ?? (() => getLocalModel());
  const resolveFrontier =
    deps.resolveFrontierModel ??
    (async () => {
      const provider = await getActiveProvider();
      if (!provider) {
        throw new FrontierUnavailableError('auth', 'no-active-provider');
      }
      return getFrontierModel(provider);
    });

  return {
    async generate(args: {
      prompt: string;
      route: Route;
      requestKey: string;
    }): Promise<AnswerCitations | null> {
      const { prompt, route } = args;
      const model =
        route === 'LOCAL' ? resolveLocal() : await resolveFrontier();
      try {
        const result = (await genObj({
          model: model as Parameters<typeof generateObject>[0]['model'],
          schema: AnswerCitationsSchema,
          prompt,
        } as Parameters<typeof generateObject>[0])) as {
          object?: AnswerCitations;
        };
        if (!result || !result.object) return null;
        // Defensive parse — schema-on-output guarantees the shape even if the
        // SDK contract changes underneath us.
        return AnswerCitationsSchema.parse(result.object);
      } catch (err) {
        // Re-throw classified transport errors so the AnswerService can map
        // them to a RagErrorResult. Unknown errors propagate verbatim.
        if (
          err instanceof OllamaUnavailableError ||
          err instanceof FrontierUnavailableError
        ) {
          throw err;
        }
        throw err;
      }
    },
  };
}

// Re-export the model id helper for callers that need to stamp routing logs.
export { getActiveLocalModelId };
