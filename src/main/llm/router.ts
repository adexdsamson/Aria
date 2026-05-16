/**
 * LLM Router (Plan 04 Task 1).
 *
 * `LLMRouter.classify({ prompt, source })` returns a deterministic
 * RoutingDecision describing whether the call goes LOCAL (Ollama) or FRONTIER
 * (Anthropic / OpenAI / Google) and the verbatim reason string that gets
 * persisted to routing_log.
 *
 * Decision tree (top→bottom; first match wins):
 *   1. source unset/empty            → LOCAL, reason 'fail-closed-source-unset' (LLM-04)
 *   2. classifier flags PII          → LOCAL, reason 'pii-pattern-matched:<names>' (LLM-01)
 *   3. source ∈ user-data-tags       → LOCAL, reason 'user-data-source:<tag>' (D-05)
 *   4. source === 'generic' AND a
 *      frontier provider is active
 *      AND has a key                 → FRONTIER, reason 'generic-source-frontier-active'
 *   5. else                          → LOCAL, reason 'frontier-not-configured' (D-10 / LLM-05)
 *
 * The router does NOT execute the model — that's `src/main/ipc/ask.ts`. It
 * also doesn't write routing_log — that's the caller's job (so the caller can
 * record latency_ms / ok=0 paths).
 */
import type { ProviderId, Route, SourceTag } from '../../shared/ipc-contract';
import { classifySensitivity, type ClassifierResult } from './classifier';
import {
  DEFAULT_LOCAL_MODEL,
  defaultModelIdFor,
  OllamaUnavailableError,
  FrontierUnavailableError,
} from './providers';

export { OllamaUnavailableError, FrontierUnavailableError };

export interface RoutingDecision {
  route: Route;
  reason: string;
  model: string;
  provider: ProviderId | 'ollama';
}

export interface ClassifyInput {
  prompt: string;
  source?: SourceTag | string | null;
}

const USER_DATA_SOURCES: ReadonlySet<string> = new Set<string>([
  'user-email',
  'user-calendar',
  'user-transcript',
]);

export interface LLMRouterDeps {
  /** Returns the active provider id, or null when none is configured. */
  getActiveProviderFn: () => Promise<ProviderId | null>;
  /** Returns true when a key exists for the active provider. */
  hasFrontierKeyFn: (opts: { provider: ProviderId }) => Promise<boolean>;
  /** Sensitivity classifier (default uses regex hard-rules). */
  classifierFn?: (prompt: string) => ClassifierResult;
  /** Override the local model id (tests). */
  localModelId?: string;
}

export class LLMRouter {
  private readonly getActive: LLMRouterDeps['getActiveProviderFn'];
  private readonly hasKey: LLMRouterDeps['hasFrontierKeyFn'];
  private readonly classify_: NonNullable<LLMRouterDeps['classifierFn']>;
  private readonly localModelId: string;

  constructor(deps: LLMRouterDeps) {
    this.getActive = deps.getActiveProviderFn;
    this.hasKey = deps.hasFrontierKeyFn;
    this.classify_ = deps.classifierFn ?? classifySensitivity;
    this.localModelId = deps.localModelId ?? DEFAULT_LOCAL_MODEL;
  }

  async classify(input: ClassifyInput): Promise<RoutingDecision> {
    const { prompt } = input;
    const source = input.source;

    // 1. Fail-closed on missing source (LLM-04).
    if (source === undefined || source === null || source === '') {
      return this.localDecision('fail-closed-source-unset');
    }

    // 2. PII hard-rules (LLM-01).
    const cls = this.classify_(prompt);
    if (cls.sensitive) {
      return this.localDecision(`pii-pattern-matched:${cls.matched.join(',')}`);
    }

    // 3. User-data sources always route LOCAL (D-05).
    if (USER_DATA_SOURCES.has(String(source))) {
      return this.localDecision(`user-data-source:${source}`);
    }

    // 4. Generic + frontier active + key present → FRONTIER.
    if (source === 'generic') {
      const active = await this.getActive();
      if (active) {
        const present = await this.hasKey({ provider: active });
        if (present) {
          return {
            route: 'FRONTIER',
            reason: 'generic-source-frontier-active',
            model: defaultModelIdFor(active),
            provider: active,
          };
        }
      }
    }

    // 5. Fallback LOCAL (D-10 / LLM-05).
    return this.localDecision('frontier-not-configured');
  }

  private localDecision(reason: string): RoutingDecision {
    return {
      route: 'LOCAL',
      reason,
      model: this.localModelId,
      provider: 'ollama',
    };
  }
}
