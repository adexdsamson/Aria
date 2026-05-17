/**
 * Ollama + Diagnostics IPC handlers (Plan 03 Task 2).
 *
 * OLLAMA_STATUS       → probeOllama()
 * DIAGNOSTICS_STATUS  → aggregate { ollama, frontierConfigured, activeProvider,
 *                                   mode, dataDir }; mode reflects which routing
 *                                   tier is available:
 *                                     HYBRID         — Ollama reachable AND a
 *                                                      frontier key configured
 *                                                      for the active provider.
 *                                     LOCAL_ONLY     — Ollama reachable, no
 *                                                      frontier key configured.
 *                                     FRONTIER_ONLY  — Ollama unreachable but
 *                                                      a frontier key IS
 *                                                      configured (UAT Gap 8).
 *                                     NONE           — neither available; all
 *                                                      LLM calls must fail
 *                                                      fast with `no-llm-
 *                                                      provider`.
 */
import { app, type IpcMain } from 'electron';
import type { Logger } from 'pino';
import {
  CHANNELS,
  type DiagnosticsStatus,
  type OllamaActiveModel,
  type OllamaSetActiveModelResult,
} from '../../shared/ipc-contract';
import { probeOllama } from '../llm/ollamaProbe';
import {
  getActiveProvider,
  getOllamaModelId,
  hasFrontierKey,
  setOllamaModelId,
} from '../secrets/safeStorage';
import { DEFAULT_LOCAL_MODEL } from '../llm/providers';

export interface OllamaDeps {
  logger: Logger;
  dataDir: string;
}

export function registerOllamaHandlers(
  ipcMain: IpcMain,
  deps: OllamaDeps,
): void {
  const { dataDir, logger } = deps;

  ipcMain.handle(CHANNELS.OLLAMA_STATUS, async () => probeOllama());

  // ── OLLAMA_GET_ACTIVE_MODEL ──────────────────────────────────────────────
  // Returns the resolved active model id plus provenance:
  //   - 'persisted' when secrets.json has ollamaModelId set
  //   - 'default' when nothing is persisted (falls back to DEFAULT_LOCAL_MODEL)
  //   - 'auto-picked' is set ONLY by the bootstrap auto-pick step; from this
  //     handler's POV that already-persisted choice reads back as 'persisted'.
  ipcMain.handle(
    CHANNELS.OLLAMA_GET_ACTIVE_MODEL,
    async (): Promise<OllamaActiveModel> => {
      let persisted: string | null = null;
      try {
        persisted = getOllamaModelId();
      } catch (err) {
        logger.warn(
          { scope: 'ollama', err: (err as Error).message },
          'get-active-model: secrets read failed; falling back to default',
        );
      }
      if (persisted) {
        return { modelId: persisted, source: 'persisted' };
      }
      return { modelId: DEFAULT_LOCAL_MODEL, source: 'default' };
    },
  );

  // ── OLLAMA_SET_ACTIVE_MODEL ──────────────────────────────────────────────
  // Validates that the requested model id appears in the current Ollama tags
  // list before persisting; rejects with `model-not-installed` otherwise.
  // Rejects unreachable Ollama with `ollama-unreachable` so the renderer can
  // surface the error inline without round-tripping a separate probe.
  ipcMain.handle(
    CHANNELS.OLLAMA_SET_ACTIVE_MODEL,
    async (_e, payload: unknown): Promise<OllamaSetActiveModelResult> => {
      const req = (payload ?? {}) as { modelId?: unknown };
      const modelId = typeof req.modelId === 'string' ? req.modelId.trim() : '';
      if (!modelId) {
        return { ok: false, error: 'invalid-model-id' };
      }
      const status = await probeOllama();
      if (!status.reachable) {
        return { ok: false, error: 'ollama-unreachable' };
      }
      if (!status.models.includes(modelId)) {
        return { ok: false, error: 'model-not-installed' };
      }
      try {
        setOllamaModelId(modelId);
        logger.info(
          { scope: 'ollama', event: 'set-active-model', modelId },
          'active Ollama model updated',
        );
        return { ok: true, modelId };
      } catch (err) {
        logger.warn(
          { scope: 'ollama', err: (err as Error).message },
          'set-active-model: persist failed',
        );
        return { ok: false, error: 'persist-failed' };
      }
    },
  );

  ipcMain.handle(CHANNELS.DIAGNOSTICS_STATUS, async (): Promise<DiagnosticsStatus> => {
    const ollama = await probeOllama();
    let activeProvider = null as Awaited<ReturnType<typeof getActiveProvider>>;
    let frontierConfigured = false;
    try {
      activeProvider = await getActiveProvider();
      if (activeProvider) {
        frontierConfigured = await hasFrontierKey({ provider: activeProvider });
      }
    } catch {
      frontierConfigured = false;
    }
    const mode: DiagnosticsStatus['mode'] =
      ollama.reachable && frontierConfigured
        ? 'HYBRID'
        : ollama.reachable
          ? 'LOCAL_ONLY'
          : frontierConfigured
            ? 'FRONTIER_ONLY'
            : 'NONE';
    // Prefer Electron app.getPath when available (tests mock it); fall back to deps.dataDir.
    let resolvedDataDir = dataDir;
    try {
      resolvedDataDir = app.getPath('userData');
    } catch {
      /* in non-electron test contexts, keep deps.dataDir */
    }
    return {
      ollama,
      frontierConfigured,
      activeProvider,
      mode,
      dataDir: resolvedDataDir,
    };
  });
}
