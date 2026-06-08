/**
 * Ask service (Plan 17-02 — D-02 extraction).
 *
 * Extracted from ipc/ask.ts so that VoiceIntentRouter can call performAsk()
 * in-process without re-crossing the preload bridge (SC1/VOICE-09/D-02).
 *
 * The entitlement gate (assertEntitled) is NOT included — it stays in the
 * ipc/ask.ts IPC handler. performAsk() is the pure routing + generation + log
 * function callable from any main-process context.
 *
 * Flow:
 *   1. router.classify({ prompt, source }) → RoutingDecision
 *   2. Acquire model (LOCAL → localModelFactory; FRONTIER → frontierModelFactory)
 *   3. gen({ model, prompt }) from ai@^6
 *   4. On FRONTIER failure, transparently fall back to LOCAL with reason
 *      'frontier-unavailable:<class>' (LLM-05)
 *   5. writeRoutingLog one row with prompt_hash (never raw prompt) (LLM-03)
 *   6. Return { answer, route, reason, latency_ms } or { error }
 */
import { generateText } from 'ai';
import type { Logger } from 'pino';
import { LLMRouter, NoLlmProviderError, type RoutingDecision } from '../llm/router';
import {
  getLocalModel,
  getFrontierModel,
  OllamaUnavailableError,
  FrontierUnavailableError,
  DEFAULT_LOCAL_MODEL,
} from '../llm/providers';
import {
  writeRoutingLog,
  hashPrompt,
  type RoutingLogInput,
} from '../llm/routingLog';
import type { AskResponse, IpcError, Route } from '../../shared/ipc-contract';
import type { Database } from 'better-sqlite3-multiple-ciphers';

// Re-export for consumers that previously imported from ask.ts.
export { classifyFrontierError };

export interface AskServiceDeps {
  logger: Logger;
  /** The constructed (or injected) router instance. */
  router: LLMRouter;
  /** Factory for the LOCAL model. Defaults to getLocalModel() for production. */
  localModelFactory: typeof getLocalModel;
  /** Factory for the FRONTIER model. Defaults to getFrontierModel() for production. */
  frontierModelFactory: typeof getFrontierModel;
  /** generateText function from ai@^6. Overridable for tests. */
  gen: typeof generateText;
  /**
   * Lazy accessor for the open database. Called inside performAsk at routing-log
   * write time — keeps the lazy-open pattern from the original ipc handler.
   * Returns null when the vault is sealed (routing log silently skipped).
   */
  dbGetter: () => Database | null;
  /**
   * Optional override for writeRoutingLog. Used by tests to verify log calls
   * without a real DB. Production leaves this undefined and the service calls
   * writeRoutingLog directly via dbGetter.
   */
  writeRoutingLogFn?: (entry: RoutingLogInput) => void;
}

function classifyFrontierError(err: unknown): 'network' | 'auth' | 'rate-limited-or-down' {
  if (err instanceof FrontierUnavailableError) return err.classification;
  if (err && typeof err === 'object') {
    const e = err as {
      name?: string;
      statusCode?: number;
      status?: number;
      code?: string;
      cause?: { code?: string };
    };
    const code = e.code ?? e.cause?.code;
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      return 'network';
    }
    const status = e.statusCode ?? e.status;
    if (typeof status === 'number') {
      if (status === 401 || status === 403) return 'auth';
      if (status === 429 || status >= 500) return 'rate-limited-or-down';
      if (status >= 400 && status < 500) return 'auth';
    }
  }
  return 'rate-limited-or-down';
}

/**
 * Core ask routing + generation logic.
 *
 * Callers supply:
 *   - deps: AskServiceDeps (router, model factories, gen fn, db accessor)
 *   - prompt: the user question string
 *   - source: the SourceTag from the request (undefined = omitted)
 *   - startedAt: performance.now() timestamp captured BEFORE calling this fn
 *
 * Returns AskResponse on success or IpcError on failure.
 * The entitlement gate is the caller's responsibility.
 */
export async function performAsk(
  deps: AskServiceDeps,
  prompt: string,
  source: string | undefined,
  startedAt: number,
): Promise<AskResponse | IpcError> {
  const { logger, router, localModelFactory, frontierModelFactory, gen, dbGetter } = deps;

  const promptHashValue = hashPrompt(prompt);

  // Build a writeLog helper that uses either the injected fn or the real DB.
  const writeLog = (entry: Omit<RoutingLogInput, 'prompt_hash'>): void => {
    if (deps.writeRoutingLogFn) {
      deps.writeRoutingLogFn({ ...entry, prompt_hash: promptHashValue });
      return;
    }
    const db = dbGetter();
    if (!db) return;
    try {
      writeRoutingLog(db, { ...entry, prompt_hash: promptHashValue });
    } catch (e) {
      logger.warn({ event: 'ask.routing-log.write-failed', err: (e as Error).message });
    }
  };

  // Step 1: classify
  let decision: RoutingDecision;
  try {
    decision = await router.classify({ prompt, source });
  } catch (e) {
    if (e instanceof NoLlmProviderError) {
      logger.warn({ event: 'ask.classify.no-provider' });
      return { error: 'no-llm-provider' };
    }
    logger.warn({ event: 'ask.classify.failed', err: (e as Error).message });
    return { error: 'router-failed' };
  }

  // Step 2: LOCAL path
  if (decision.route === 'LOCAL') {
    try {
      const model = localModelFactory();
      const result = await gen({ model: model as Parameters<typeof gen>[0]['model'], prompt });
      const latency_ms = Math.round(performance.now() - startedAt);
      writeLog({
        ts: new Date().toISOString(),
        route: 'LOCAL',
        reason: decision.reason,
        source: String(source ?? ''),
        model: decision.model || DEFAULT_LOCAL_MODEL,
        latency_ms,
        ok: 1,
      });
      logger.info({ event: 'ask.ok', route: 'LOCAL', reason: decision.reason, latency_ms });
      return {
        answer: result.text,
        route: 'LOCAL',
        reason: decision.reason,
        latency_ms,
      };
    } catch (e) {
      const latency_ms = Math.round(performance.now() - startedAt);
      const reason =
        e instanceof OllamaUnavailableError
          ? 'ollama-unreachable'
          : `local-failed:${(e as Error).message ?? 'unknown'}`;
      writeLog({
        ts: new Date().toISOString(),
        route: 'LOCAL',
        reason,
        source: String(source ?? ''),
        model: decision.model || DEFAULT_LOCAL_MODEL,
        latency_ms,
        ok: 0,
      });
      logger.warn({ event: 'ask.local.failed', reason, latency_ms });
      return { error: reason };
    }
  }

  // Step 3: FRONTIER path with LOCAL fallback (LLM-05)
  const frontierProvider = decision.provider as Exclude<RoutingDecision['provider'], 'ollama'>;
  try {
    const model = await frontierModelFactory(frontierProvider);
    const result = await gen({ model: model as Parameters<typeof gen>[0]['model'], prompt });
    const latency_ms = Math.round(performance.now() - startedAt);
    writeLog({
      ts: new Date().toISOString(),
      route: 'FRONTIER',
      reason: decision.reason,
      source: String(source ?? ''),
      model: decision.model,
      latency_ms,
      ok: 1,
    });
    logger.info({ event: 'ask.ok', route: 'FRONTIER', reason: decision.reason, latency_ms });
    return {
      answer: result.text,
      route: 'FRONTIER',
      reason: decision.reason,
      latency_ms,
    };
  } catch (e) {
    const cls = classifyFrontierError(e);
    const fallbackReason = `frontier-unavailable:${cls}`;
    logger.warn({ event: 'ask.frontier.failed', classification: cls });
    // Fall back to LOCAL
    try {
      const model = localModelFactory();
      const result = await gen({ model: model as Parameters<typeof gen>[0]['model'], prompt });
      const latency_ms = Math.round(performance.now() - startedAt);
      writeLog({
        ts: new Date().toISOString(),
        route: 'LOCAL' as Route,
        reason: fallbackReason,
        source: String(source ?? ''),
        model: DEFAULT_LOCAL_MODEL,
        latency_ms,
        ok: 1,
      });
      logger.info({ event: 'ask.fallback.ok', reason: fallbackReason, latency_ms });
      return {
        answer: result.text,
        route: 'LOCAL',
        reason: fallbackReason,
        latency_ms,
      };
    } catch (e2) {
      const latency_ms = Math.round(performance.now() - startedAt);
      const reason =
        e2 instanceof OllamaUnavailableError
          ? 'ollama-unreachable-after-frontier-failure'
          : fallbackReason;
      writeLog({
        ts: new Date().toISOString(),
        route: 'LOCAL',
        reason,
        source: String(source ?? ''),
        model: DEFAULT_LOCAL_MODEL,
        latency_ms,
        ok: 0,
      });
      logger.warn({ event: 'ask.fallback.failed', reason, latency_ms });
      return { error: reason };
    }
  }
}
