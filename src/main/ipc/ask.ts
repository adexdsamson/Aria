/**
 * ASK_ARIA IPC handler (Plan 04 Task 2 — thin wrapper after Plan 17-02 extraction).
 *
 * The routing logic (router.classify, LOCAL/FRONTIER paths, frontier fallback,
 * routing-log writes) now lives in src/main/rag/ask-service.ts → performAsk().
 * This handler is responsible only for:
 *   1. Entitlement gate (assertEntitled — must stay here per T-17-04)
 *   2. Payload parse
 *   3. Constructing AskServiceDeps from the DI AskDeps struct
 *   4. Delegating to performAsk()
 *
 * AskDeps interface is preserved UNCHANGED so ask.spec.ts passes unmodified.
 *
 * Never logs the raw prompt — only `prompt_hash` + decision metadata (via ask-service).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { generateText } from 'ai';
import {
  CHANNELS,
  type AskRequest,
  type AskResponse,
  type IpcError,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { LLMRouter } from '../llm/router';
import { probeOllama } from '../llm/ollamaProbe';
import {
  getLocalModel,
  getFrontierModel,
  defaultModelIdFor,
} from '../llm/providers';
import { classifySensitivity } from '../llm/classifier';
import {
  getActiveProvider,
  hasFrontierKey,
} from '../secrets/safeStorage';
import { assertEntitled, EntitlementError } from '../entitlement/gate';
import { performAsk } from '../rag/ask-service';

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

export function registerAskHandlers(ipcMain: IpcMain, deps: AskDeps): void {
  const { logger, dbHolder } = deps;
  const router =
    deps.router ??
    new LLMRouter({
      getActiveProviderFn: getActiveProvider,
      hasFrontierKeyFn: hasFrontierKey,
      classifierFn: classifySensitivity,
      ollamaReachableFn: async () => (await probeOllama()).reachable,
    });
  const localModelFactory = deps.getLocalModelFn ?? getLocalModel;
  const frontierModelFactory = deps.getFrontierModelFn ?? getFrontierModel;
  const gen = deps.generateTextFn ?? generateText;

  ipcMain.handle(
    CHANNELS.ASK_ARIA,
    async (_event, payload: unknown): Promise<AskResponse | IpcError> => {
      // ENTITLEMENT GATE — must be first non-comment statement of the handler.
      // Static-grep ratchet: tests/static/single-entitlement-gate-site.test.ts
      const _db_for_gate = dbHolder.db;
      if (_db_for_gate) {
        try {
          await assertEntitled(_db_for_gate, 'rag_ask');
        } catch (e) {
          if (e instanceof EntitlementError) {
            return { error: `entitlement-${e.code}` };
          }
          throw e;
        }
      }
      const req = (payload ?? {}) as Partial<AskRequest>;
      const prompt = typeof req.prompt === 'string' ? req.prompt : '';
      const source = (req.source ?? undefined) as AskRequest['source'] | undefined;
      const startedAt = performance.now();

      return performAsk(
        {
          logger,
          router,
          localModelFactory: localModelFactory as typeof getLocalModel,
          frontierModelFactory: frontierModelFactory as typeof getFrontierModel,
          gen: gen as typeof generateText,
          dbGetter: () => dbHolder.db,
        },
        prompt,
        source,
        startedAt,
      );
    },
  );
}

// Silence unused-warning for default model id (kept for handler call sites above).
void defaultModelIdFor;
