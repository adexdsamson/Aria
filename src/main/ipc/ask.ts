/**
 * ASK_ARIA IPC handler (Plan 04 Task 2).
 *
 * Flow:
 *   1. router.classify({ prompt, source }) → RoutingDecision
 *   2. Acquire model (LOCAL → getLocalModel; FRONTIER → getFrontierModel)
 *   3. generateText({ model, prompt }) from ai@^6
 *   4. On FRONTIER failure, transparently fall back to LOCAL with reason
 *      'frontier-unavailable:<class>' (LLM-05)
 *   5. writeRoutingLog one row with prompt_hash (never raw prompt) (LLM-03)
 *   6. Return { answer, route, reason, latency_ms }
 *
 * Never logs the raw prompt — only `prompt_hash` + decision metadata.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { generateText } from 'ai';
import {
  CHANNELS,
  type AskRequest,
  type AskResponse,
  type IpcError,
  type Route,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { LLMRouter, type RoutingDecision } from '../llm/router';
import {
  getLocalModel,
  getFrontierModel,
  OllamaUnavailableError,
  FrontierUnavailableError,
  DEFAULT_LOCAL_MODEL,
  defaultModelIdFor,
} from '../llm/providers';
import { classifySensitivity } from '../llm/classifier';
import {
  getActiveProvider,
  hasFrontierKey,
} from '../secrets/safeStorage';
import {
  writeRoutingLog,
  hashPrompt,
  type RoutingLogInput,
} from '../llm/routingLog';

export interface AskDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Override for tests; otherwise constructs the default router. */
  router?: LLMRouter;
  /** Override for tests; otherwise uses providers.getLocalModel. */
  getLocalModelFn?: typeof getLocalModel;
  /** Override for tests; otherwise uses providers.getFrontierModel. */
  getFrontierModelFn?: typeof getFrontierModel;
  /** Override generateText for tests (otherwise imports ai@^6). */
  generateTextFn?: typeof generateText;
}

function classifyFrontierError(err: unknown): 'network' | 'auth' | 'rate-limited-or-down' {
  if (err instanceof FrontierUnavailableError) return err.classification;
  if (err && typeof err === 'object') {
    const e = err as { name?: string; statusCode?: number; status?: number; code?: string; cause?: { code?: string } };
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

export function registerAskHandlers(ipcMain: IpcMain, deps: AskDeps): void {
  const { logger, dbHolder } = deps;
  const router =
    deps.router ??
    new LLMRouter({
      getActiveProviderFn: getActiveProvider,
      hasFrontierKeyFn: hasFrontierKey,
      classifierFn: classifySensitivity,
    });
  const localModelFactory = deps.getLocalModelFn ?? getLocalModel;
  const frontierModelFactory = deps.getFrontierModelFn ?? getFrontierModel;
  const gen = deps.generateTextFn ?? generateText;

  ipcMain.handle(
    CHANNELS.ASK_ARIA,
    async (_event, payload: unknown): Promise<AskResponse | IpcError> => {
      const req = (payload ?? {}) as Partial<AskRequest>;
      const prompt = typeof req.prompt === 'string' ? req.prompt : '';
      const source = (req.source ?? undefined) as AskRequest['source'] | undefined;

      const promptHashValue = hashPrompt(prompt);
      const startedAt = performance.now();

      let decision: RoutingDecision;
      try {
        decision = await router.classify({ prompt, source });
      } catch (e) {
        logger.warn({ event: 'ask.classify.failed', err: (e as Error).message });
        return { error: 'router-failed' };
      }

      const db = dbHolder.db;
      const writeLog = (entry: Omit<RoutingLogInput, 'prompt_hash'>): void => {
        if (!db) return;
        try {
          writeRoutingLog(db, { ...entry, prompt_hash: promptHashValue });
        } catch (e) {
          logger.warn({ event: 'ask.routing-log.write-failed', err: (e as Error).message });
        }
      };

      // --- LOCAL path ---
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

      // --- FRONTIER path with LOCAL fallback (LLM-05) ---
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
          const reason = e2 instanceof OllamaUnavailableError
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
    },
  );
}

// Silence unused-warning for default model id (kept for handler call sites above).
void defaultModelIdFor;
