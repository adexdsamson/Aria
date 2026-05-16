/**
 * Secrets IPC handlers (Plan 03 Task 1).
 *
 * Wires SECRETS_* channels declared in `src/shared/ipc-contract.ts` to the
 * safeStorage-backed secrets module. NEVER reads the raw key back to the
 * renderer — `secretsHasFrontierKey` returns only a boolean.
 *
 * Error shape: `{ error: <reason> }` where reason is one of
 * 'not-ready' | 'not-available' | 'basic_text' | 'decrypt-failed' | 'no-key-for-provider' | 'unknown'.
 *
 * The raw `key` field is logged ONLY as `{ provider }` — never the key value.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type ProviderId } from '../../shared/ipc-contract';
import {
  setFrontierKey,
  hasFrontierKey,
  clearFrontierKey,
  getActiveProvider,
  setActiveProvider,
  SafeStorageUnavailableError,
} from '../secrets/safeStorage';

export interface SecretsDeps {
  logger: Logger;
  dataDir: string;
}

function mapError(e: unknown): { error: string } {
  if (e instanceof SafeStorageUnavailableError) return { error: e.reason };
  if (e instanceof Error) return { error: e.message };
  return { error: 'unknown' };
}

export function registerSecretsHandlers(
  ipcMain: IpcMain,
  deps: SecretsDeps,
): void {
  const { logger } = deps;

  ipcMain.handle(CHANNELS.SECRETS_SET_FRONTIER_KEY, async (_e, req: unknown) => {
    const r = req as { provider?: ProviderId; key?: string };
    if (!r?.provider || typeof r.key !== 'string') return { error: 'bad-request' };
    try {
      await setFrontierKey({ provider: r.provider, key: r.key });
      logger.info({ event: 'secrets.set', provider: r.provider });
      return { ok: true };
    } catch (e) {
      logger.warn({ event: 'secrets.set.failed', provider: r.provider });
      return mapError(e);
    }
  });

  ipcMain.handle(CHANNELS.SECRETS_HAS_FRONTIER_KEY, async (_e, req: unknown) => {
    const r = req as { provider?: ProviderId };
    if (!r?.provider) return { error: 'bad-request' };
    try {
      const present = await hasFrontierKey({ provider: r.provider });
      return { present, has: present };
    } catch (e) {
      return mapError(e);
    }
  });

  ipcMain.handle(CHANNELS.SECRETS_CLEAR_FRONTIER_KEY, async (_e, req: unknown) => {
    const r = req as { provider?: ProviderId };
    if (!r?.provider) return { error: 'bad-request' };
    try {
      await clearFrontierKey({ provider: r.provider });
      logger.info({ event: 'secrets.cleared', provider: r.provider });
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  });

  ipcMain.handle(CHANNELS.SECRETS_GET_ACTIVE_PROVIDER, async () => {
    try {
      const provider = await getActiveProvider();
      return { provider };
    } catch (e) {
      return mapError(e);
    }
  });

  ipcMain.handle(CHANNELS.SECRETS_SET_ACTIVE_PROVIDER, async (_e, req: unknown) => {
    const r = req as { provider?: ProviderId | null };
    try {
      await setActiveProvider(r?.provider ?? null);
      logger.info({ event: 'secrets.active-provider.set', provider: r?.provider ?? null });
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  });
}
