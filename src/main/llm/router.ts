/**
 * LLM Router (Plan 04 Task 1).
 *
 * `LLMRouter.classify({ prompt, source })` returns a deterministic
 * RoutingDecision describing whether the call goes LOCAL (Ollama) or FRONTIER
 * (Anthropic / OpenAI / Google) and the verbatim reason string that gets
 * persisted to routing_log.
 *
 * Decision tree (top→bottom; first match wins):
 *   0. mode === NONE (no provider)   → throw NoLlmProviderError; caller must
 *                                       surface `no-llm-provider` to the user.
 *   1. source unset/empty            → LOCAL, reason 'fail-closed-source-unset' (LLM-04)
 *      (but if local is unreachable AND frontier configured, redirect to
 *       FRONTIER with reason 'fail-closed-source-unset:frontier-only' so the
 *       call doesn't dead-end on a missing local model.)
 *   2. classifier flags PII          → LOCAL — unless mode === FRONTIER_ONLY
 *                                       (Ollama unreachable). In FRONTIER_ONLY
 *                                       we deliberately route PII to the
 *                                       configured Frontier provider rather
 *                                       than fail; reason
 *                                       'pii-pattern-matched:<names>:frontier-only'.
 *   3. source ∈ user-data-tags       → LOCAL — same FRONTIER_ONLY override as
 *                                       rule 2; reason
 *                                       'user-data-source:<tag>:frontier-only'.
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
  getActiveLocalModelId,
  OllamaUnavailableError,
  FrontierUnavailableError,
} from './providers';

export { OllamaUnavailableError, FrontierUnavailableError };

/**
 * Thrown by LLMRouter.classify when neither Ollama nor a configured Frontier
 * provider is available (UAT Gap 8 — mode === 'NONE'). The IPC layer turns
 * this into a structured `{ error: 'no-llm-provider' }` payload.
 */
export class NoLlmProviderError extends Error {
  readonly code = 'no-llm-provider';
  constructor() {
    super('no-llm-provider');
    this.name = 'NoLlmProviderError';
  }
}

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
  /**
   * Returns true when the local Ollama daemon is reachable. Defaults to
   * `() => Promise.resolve(true)` for back-compat with existing tests; the
   * IPC layer wires it to `probeOllama().reachable` so FRONTIER_ONLY / NONE
   * modes (UAT Gap 8) can be detected.
   */
  ollamaReachableFn?: () => Promise<boolean>;
  /** Sensitivity classifier (default uses regex hard-rules). */
  classifierFn?: (prompt: string) => ClassifierResult;
  /**
   * Override the local model id (tests). When set, takes precedence over
   * `localModelIdFn`. When neither is set, the router re-resolves the active
   * id via `getActiveLocalModelId()` on every classify() call so a user who
   * changes the model in Settings sees the new id immediately (no router
   * reconstruction).
   */
  localModelId?: string;
  /** Override the per-call local-model-id resolver (tests). */
  localModelIdFn?: () => string;
}

export class LLMRouter {
  private readonly getActive: LLMRouterDeps['getActiveProviderFn'];
  private readonly hasKey: LLMRouterDeps['hasFrontierKeyFn'];
  private readonly ollamaReachable: NonNullable<LLMRouterDeps['ollamaReachableFn']>;
  private readonly classify_: NonNullable<LLMRouterDeps['classifierFn']>;
  private readonly localModelIdFn: () => string;

  constructor(deps: LLMRouterDeps) {
    this.getActive = deps.getActiveProviderFn;
    this.hasKey = deps.hasFrontierKeyFn;
    this.ollamaReachable = deps.ollamaReachableFn ?? (async () => true);
    this.classify_ = deps.classifierFn ?? classifySensitivity;
    if (deps.localModelId !== undefined) {
      const pinned = deps.localModelId;
      this.localModelIdFn = () => pinned;
    } else if (deps.localModelIdFn) {
      this.localModelIdFn = deps.localModelIdFn;
    } else {
      // Re-resolve each call so live Settings changes take effect without
      // reconstructing the router.
      this.localModelIdFn = () => {
        try {
          return getActiveLocalModelId();
        } catch {
          return DEFAULT_LOCAL_MODEL;
        }
      };
    }
  }

  /**
   * Resolve the available provider mode for this request. Mirrors the
   * `DIAGNOSTICS_STATUS.mode` four-way predicate (UAT Gap 8).
   */
  private async resolveMode(): Promise<{
    mode: 'HYBRID' | 'LOCAL_ONLY' | 'FRONTIER_ONLY' | 'NONE';
    activeProvider: ProviderId | null;
  }> {
    const local = await this.ollamaReachable();
    const active = await this.getActive();
    const frontierConfigured = active ? await this.hasKey({ provider: active }) : false;
    const mode = local && frontierConfigured
      ? 'HYBRID'
      : local
        ? 'LOCAL_ONLY'
        : frontierConfigured
          ? 'FRONTIER_ONLY'
          : 'NONE';
    return { mode, activeProvider: frontierConfigured ? active : null };
  }

  async classify(input: ClassifyInput): Promise<RoutingDecision> {
    const { prompt } = input;
    const source = input.source;

    const { mode, activeProvider } = await this.resolveMode();

    // 0. NONE — no provider at all. Fail fast; caller surfaces no-llm-provider.
    if (mode === 'NONE') {
      throw new NoLlmProviderError();
    }

    // 1. Fail-closed on missing source (LLM-04).
    if (source === undefined || source === null || source === '') {
      if (mode === 'FRONTIER_ONLY' && activeProvider) {
        return this.frontierDecision(
          activeProvider,
          'fail-closed-source-unset:frontier-only',
        );
      }
      return this.localDecision('fail-closed-source-unset');
    }

    // 2. PII hard-rules (LLM-01).
    const cls = this.classify_(prompt);
    if (cls.sensitive) {
      const reason = `pii-pattern-matched:${cls.matched.join(',')}`;
      if (mode === 'FRONTIER_ONLY' && activeProvider) {
        return this.frontierDecision(activeProvider, `${reason}:frontier-only`);
      }
      return this.localDecision(reason);
    }

    // 3. User-data sources always route LOCAL (D-05).
    if (USER_DATA_SOURCES.has(String(source))) {
      const reason = `user-data-source:${source}`;
      if (mode === 'FRONTIER_ONLY' && activeProvider) {
        return this.frontierDecision(activeProvider, `${reason}:frontier-only`);
      }
      return this.localDecision(reason);
    }

    // 4. Generic + frontier active + key present → FRONTIER.
    if (source === 'generic' && activeProvider) {
      return this.frontierDecision(activeProvider, 'generic-source-frontier-active');
    }

    // 5. FRONTIER_ONLY catch-all for any remaining source values (e.g. custom
    //    string tags that don't match user-data-tags or 'generic').
    if (mode === 'FRONTIER_ONLY' && activeProvider) {
      return this.frontierDecision(activeProvider, `${source}:frontier-only`);
    }

    // 6. Fallback LOCAL (D-10 / LLM-05).
    return this.localDecision('frontier-not-configured');
  }

  private localDecision(reason: string): RoutingDecision {
    return {
      route: 'LOCAL',
      reason,
      model: this.localModelIdFn(),
      provider: 'ollama',
    };
  }

  private frontierDecision(provider: ProviderId, reason: string): RoutingDecision {
    return {
      route: 'FRONTIER',
      reason,
      model: defaultModelIdFor(provider),
      provider,
    };
  }
}
