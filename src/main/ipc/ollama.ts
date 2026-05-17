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
import { CHANNELS, type DiagnosticsStatus } from '../../shared/ipc-contract';
import { probeOllama } from '../llm/ollamaProbe';
import { getActiveProvider, hasFrontierKey } from '../secrets/safeStorage';

export interface OllamaDeps {
  logger: Logger;
  dataDir: string;
}

export function registerOllamaHandlers(
  ipcMain: IpcMain,
  deps: OllamaDeps,
): void {
  const { dataDir } = deps;

  ipcMain.handle(CHANNELS.OLLAMA_STATUS, async () => probeOllama());

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
