/**
 * IPC handler tests for SECRETS_* channels. Uses a stub ipcMain that captures
 * registered handlers, then invokes them directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTempUserDataDir } from '../../../setup';

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

function makeStubIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: (channel: string, h: Handler) => {
        handlers.set(channel, h);
      },
      removeHandler: (channel: string) => {
        handlers.delete(channel);
      },
    },
    invoke: (channel: string, payload?: unknown) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, payload);
    },
  };
}

async function freshModules(dataDir: string) {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => dataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
      getSelectedStorageBackend: () => 'keychain',
    },
  }));
  const ipc = await import('../../../../src/main/ipc/secrets');
  const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
  return { ipc, CHANNELS };
}

describe('registerSecretsHandlers', () => {
  let dataDir: string;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-secrets-ipc');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('handles set → has → get-active → set-active → clear round-trip', async () => {
    const { ipc, CHANNELS } = await freshModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerSecretsHandlers(ipcMain as any, { logger, dataDir });

    expect(await invoke(CHANNELS.SECRETS_SET_FRONTIER_KEY, { provider: 'anthropic', key: 'sk-ant-x' })).toEqual({ ok: true });
    expect(await invoke(CHANNELS.SECRETS_HAS_FRONTIER_KEY, { provider: 'anthropic' })).toMatchObject({ present: true });
    expect(await invoke(CHANNELS.SECRETS_SET_ACTIVE_PROVIDER, { provider: 'anthropic' })).toEqual({ ok: true });
    expect(await invoke(CHANNELS.SECRETS_GET_ACTIVE_PROVIDER, undefined)).toEqual({ provider: 'anthropic' });
    expect(await invoke(CHANNELS.SECRETS_CLEAR_FRONTIER_KEY, { provider: 'anthropic' })).toEqual({ ok: true });
    expect(await invoke(CHANNELS.SECRETS_HAS_FRONTIER_KEY, { provider: 'anthropic' })).toMatchObject({ present: false });
  });

  it('returns { error: "bad-request" } on missing provider', async () => {
    const { ipc, CHANNELS } = await freshModules(dataDir);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerSecretsHandlers(ipcMain as any, { logger, dataDir });
    expect(await invoke(CHANNELS.SECRETS_SET_FRONTIER_KEY, {})).toEqual({ error: 'bad-request' });
  });

  it('surfaces basic_text refusal as { error: "basic_text" }', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { isReady: () => true, whenReady: () => Promise.resolve(), getPath: () => dataDir },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
        getSelectedStorageBackend: () => 'basic_text',
      },
    }));
    const ipc = await import('../../../../src/main/ipc/secrets');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerSecretsHandlers(ipcMain as any, { logger, dataDir });
    expect(await invoke(CHANNELS.SECRETS_SET_FRONTIER_KEY, { provider: 'anthropic', key: 'x' })).toEqual({ error: 'basic_text' });
  });
});
