/**
 * IPC handler registry (Plan 03 wave 4).
 *
 * `registerHandlers` wires every Phase-1 handler-registration function in
 * order:
 *   1. registerOnboardingHandlers (Plan 02)
 *   2. registerBackupHandlers    (Plan 02)
 *   3. registerSecretsHandlers   (Plan 03)
 *   4. registerOllamaHandlers    (Plan 03)
 *
 * For channels not yet owned by real handlers (`ASK_ARIA`,
 * `DIAGNOSTICS_ROUTING_LOG`), a no-op stub is registered that returns
 * `{ error: 'NOT_IMPLEMENTED' }`. Plan 04 (wave 5) replaces those two stubs
 * with `registerAskHandlers` + `registerDiagnosticsHandlers`.
 *
 * Every handler logs entry + exit with `latency_ms`, redacting the payload via
 * `redactObject` BEFORE it touches pino (defense-in-depth — pino redacts too).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import { redactObject } from '../log/redact';
import {
  registerOnboardingHandlers,
  createDbHolder,
  type DbHolder,
} from './onboarding';
import { registerBackupHandlers } from './backup';
import { registerSecretsHandlers } from './secrets';
import { registerOllamaHandlers } from './ollama';

export interface IpcDeps {
  logger: Logger;
  dataDir: string;
  dbHolder?: DbHolder;
  // Reserved for plans 04+; ignored by the real handlers below.
  secrets?: unknown;
  router?: unknown;
  ollama?: unknown;
  vault?: unknown;
  // Legacy compatibility: tests may construct deps without dataDir/dbHolder.
  db?: unknown;
}

const NOT_IMPLEMENTED = Object.freeze({ error: 'NOT_IMPLEMENTED' as const });

/**
 * Channels that still ship as no-op stubs in this plan.  Plan 04 (wave 5) will
 * remove them from this list as `registerAskHandlers` and
 * `registerDiagnosticsHandlers` take ownership.
 */
const STUB_CHANNELS: ReadonlyArray<string> = [
  CHANNELS.ASK_ARIA,
  CHANNELS.DIAGNOSTICS_ROUTING_LOG,
] as const;

/**
 * Wire every Phase-1 handler-registration function and stub the remaining
 * channels. `options.skipChannels` lets callers (e.g. tests, main/index.ts
 * during transition) suppress specific registrations — wave 4 callers can
 * still pass the legacy skip-list and get the same behavior.
 */
export function registerHandlers(
  ipcMain: IpcMain,
  deps: IpcDeps,
  options: { skipChannels?: ReadonlyArray<string> } = {},
): void {
  const { logger } = deps;
  const dataDir = deps.dataDir;
  const dbHolder = deps.dbHolder ?? createDbHolder();
  const skip = new Set(options.skipChannels ?? []);

  // 1–4: real handler-registration functions. Each is guarded by skipChannels
  // so callers can opt out of any one (used by the transitional wiring in
  // main/index.ts and by tests that only want the stub registry).
  const onboardingChannels = [
    CHANNELS.ONBOARDING_GEN_MNEMONIC,
    CHANNELS.ONBOARDING_CONFIRM,
    CHANNELS.ONBOARDING_SEAL,
    CHANNELS.ONBOARDING_UNLOCK,
    CHANNELS.ONBOARDING_STATUS,
  ];
  if (dataDir && !onboardingChannels.every((c) => skip.has(c))) {
    registerOnboardingHandlers(ipcMain, { logger, dataDir, dbHolder });
    onboardingChannels.forEach((c) => skip.add(c));
  }

  const backupChannels = [CHANNELS.BACKUP_CREATE, CHANNELS.BACKUP_RESTORE];
  if (dataDir && !backupChannels.every((c) => skip.has(c))) {
    registerBackupHandlers(ipcMain, { logger, dataDir, dbHolder });
    backupChannels.forEach((c) => skip.add(c));
  }

  const secretsChannels = [
    CHANNELS.SECRETS_SET_FRONTIER_KEY,
    CHANNELS.SECRETS_HAS_FRONTIER_KEY,
    CHANNELS.SECRETS_CLEAR_FRONTIER_KEY,
    CHANNELS.SECRETS_GET_ACTIVE_PROVIDER,
    CHANNELS.SECRETS_SET_ACTIVE_PROVIDER,
  ];
  if (dataDir && !secretsChannels.every((c) => skip.has(c))) {
    registerSecretsHandlers(ipcMain, { logger, dataDir });
    secretsChannels.forEach((c) => skip.add(c));
  }

  const ollamaChannels = [CHANNELS.OLLAMA_STATUS, CHANNELS.DIAGNOSTICS_STATUS];
  if (dataDir && !ollamaChannels.every((c) => skip.has(c))) {
    registerOllamaHandlers(ipcMain, { logger, dataDir });
    ollamaChannels.forEach((c) => skip.add(c));
  }

  // Remaining channels → no-op stub. Limited to ASK_ARIA +
  // DIAGNOSTICS_ROUTING_LOG (Plan 04 territory) plus anything still in skip.
  for (const channel of Object.values(CHANNELS)) {
    if (skip.has(channel)) continue;
    if (!STUB_CHANNELS.includes(channel)) {
      // Defensive: every non-stub channel should have been covered above.
      // Skip silently rather than register a duplicate handler that would
      // throw on Electron's strict invoke-handler registry.
      continue;
    }
    ipcMain.handle(channel, async (_event: unknown, payload: unknown) => {
      const started = Date.now();
      const safePayload = redactObject(payload);
      logger.info({ scope: 'ipc', channel, payload: safePayload }, 'ipc.enter');
      try {
        return NOT_IMPLEMENTED;
      } finally {
        logger.info(
          { scope: 'ipc', channel, latency_ms: Date.now() - started },
          'ipc.exit',
        );
      }
    });
  }
}

/** Exported for tests that need to assert the stub return shape. */
export const STUB_RESPONSE = NOT_IMPLEMENTED;
