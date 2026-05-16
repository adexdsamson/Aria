/**
 * IPC handler registry. Plan 01b ships no-op stubs for every CHANNELS entry;
 * Plans 02 / 03 / 04 replace stubs by passing real deps.
 *
 * Every handler logs entry + exit with `latency_ms`, redacting the payload via
 * `redactObject` BEFORE it touches pino (defense-in-depth — pino redacts too).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import { redactObject } from '../log/redact';

export interface IpcDeps {
  logger: Logger;
  // Reserved for plans 02/03/04. Stubs ignore them.
  db?: unknown;
  secrets?: unknown;
  router?: unknown;
  ollama?: unknown;
  vault?: unknown;
}

const NOT_IMPLEMENTED = Object.freeze({ error: 'NOT_IMPLEMENTED' as const });

/**
 * Register a no-op handler for every channel in CHANNELS. Exactly
 * Object.keys(CHANNELS).length handlers are registered. Each handler logs
 * `ipc.enter` and `ipc.exit` with the redacted payload + latency.
 */
export function registerHandlers(
  ipcMain: IpcMain,
  deps: IpcDeps,
  options: { skipChannels?: ReadonlyArray<string> } = {},
): void {
  const { logger } = deps;
  const skip = new Set(options.skipChannels ?? []);
  for (const channel of Object.values(CHANNELS)) {
    if (skip.has(channel)) continue;
    ipcMain.handle(channel, async (_event: unknown, payload: unknown) => {
      const started = Date.now();
      const safePayload = redactObject(payload);
      logger.info({ scope: 'ipc', channel, payload: safePayload }, 'ipc.enter');
      try {
        // Plan 01b stub — replaced by real handlers in plans 02/03/04.
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
