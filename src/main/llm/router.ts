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
import type PQueueImport from 'p-queue';
import {
  classify as classifySensitivityLLM,
  CLASSIFIER_VERSION,
  type SensitivityResult,
} from './sensitivityClassifier';
import {
  tokenizeForFrontier,
  rehydrate,
  disposeDraftTable,
} from './tokenize';

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

// =============================================================================
// Plan 03-02 — Hybrid routing layer on top of the sensitivity classifier.
// =============================================================================

/** Forced-local categories per CONTEXT.md `decisions §Sensitivity router design`. */
const FORCED_LOCAL_CATEGORIES = new Set<string>(['financial', 'legal', 'hr']);

/** Routed surface (matches approval.routed column + UI chip). */
export type RoutedLabel = 'local' | 'frontier' | 'hybrid';

export interface HybridRoutingDecision {
  /** Underlying classifier result (always populated; never throws). */
  classifier: SensitivityResult;
  /** Three-way routed label used by approval.routed + /routing-log + UI chip. */
  routed: RoutedLabel;
  /** Verbatim reason persisted to routing_log.reason. */
  reason: string;
  /** Classifier version stamped onto routing_log + approval row. */
  classifier_version: string;
}

export interface HybridRoutingInput {
  /** Stable id; if absent the caller is signalling a non-drafting classify-only call. */
  approvalId?: string;
  /** Raw prompt text the caller would otherwise send to the LLM. */
  prompt: string;
  /** PQueue from the shared scheduler. */
  queue: InstanceType<typeof PQueueImport>;
}

/**
 * Plan 03-02 hybrid routing decision (CONTEXT-locked rules):
 *
 *   1. categories ∩ {financial,legal,hr} ≠ ∅ AND severity ∈ {med,high}
 *      → routed='local' (Ollama only; never frontier).
 *   2. else if categories includes 'pii'
 *      → routed='hybrid' (caller MUST tokenize + frontier-dispatch + rehydrate).
 *   3. else
 *      → routed='frontier' (caller may dispatch raw prompt to frontier).
 *
 * Reason strings are deterministic and used verbatim by routing_log + tests.
 */
export async function decideHybridRoute(
  input: HybridRoutingInput,
): Promise<HybridRoutingDecision> {
  const cls = await classifySensitivityLLM(input.prompt, input.queue);
  const forced = cls.categories.some((c) => FORCED_LOCAL_CATEGORIES.has(c));
  const sevMedOrHigh = cls.severity === 'med' || cls.severity === 'high';

  if (forced && sevMedOrHigh) {
    const cats = cls.categories
      .filter((c) => FORCED_LOCAL_CATEGORIES.has(c))
      .join(',');
    return {
      classifier: cls,
      routed: 'local',
      reason: `forced-local:${cats}:${cls.severity}`,
      classifier_version: CLASSIFIER_VERSION,
    };
  }
  if (cls.categories.includes('pii')) {
    return {
      classifier: cls,
      routed: 'hybrid',
      reason: 'pii-tokenize-frontier',
      classifier_version: CLASSIFIER_VERSION,
    };
  }
  return {
    classifier: cls,
    routed: 'frontier',
    reason: 'no-sensitive-categories',
    classifier_version: CLASSIFIER_VERSION,
  };
}

export interface HybridDispatchInput extends HybridRoutingInput {
  approvalId: string;
  /** Run the LOCAL model on `prompt`. Caller injects to keep router pure. */
  runLocal: (prompt: string) => Promise<string>;
  /** Run the FRONTIER model on `prompt`. Tokenized when routed='hybrid'. */
  runFrontier: (prompt: string) => Promise<string>;
}

export interface HybridDispatchResult extends HybridRoutingDecision {
  /** Final (rehydrated, if hybrid) response text. */
  text: string;
}

/**
 * Plan 03-02 dispatch wrapper. Decides → tokenizes (if hybrid) → runs the
 * chosen provider → rehydrates → disposeDraftTable in a try/finally so token
 * tables don't leak on exception.
 *
 * On frontier-side failure during the hybrid path, falls back to a local run
 * (LLM-05 fail-closed) with reason 'frontier-unavailable:hybrid-fallback'.
 */
export async function dispatchHybrid(
  input: HybridDispatchInput,
): Promise<HybridDispatchResult> {
  const decision = await decideHybridRoute(input);
  if (decision.routed === 'local') {
    const text = await input.runLocal(input.prompt);
    return { ...decision, text };
  }
  if (decision.routed === 'frontier') {
    try {
      const text = await input.runFrontier(input.prompt);
      return { ...decision, text };
    } catch (e) {
      // LLM-05 fail-closed.
      const text = await input.runLocal(input.prompt);
      return {
        ...decision,
        routed: 'local',
        reason: `frontier-unavailable:fallback:${(e as Error).message ?? 'unknown'}`,
        text,
      };
    }
  }
  // routed === 'hybrid' — tokenize/rehydrate around the frontier call.
  const { prompt: tokenized } = tokenizeForFrontier(input.approvalId, input.prompt);
  try {
    let text: string;
    try {
      const frontierOut = await input.runFrontier(tokenized);
      text = rehydrate(input.approvalId, frontierOut);
    } catch (e) {
      // Frontier failed — fall back to LOCAL with the ORIGINAL prompt (not
      // tokenized; local is allowed to see raw user content).
      const localOut = await input.runLocal(input.prompt);
      return {
        ...decision,
        routed: 'local',
        reason: `frontier-unavailable:hybrid-fallback:${(e as Error).message ?? 'unknown'}`,
        text: localOut,
      };
    }
    return { ...decision, text };
  } finally {
    disposeDraftTable(input.approvalId);
  }
}

