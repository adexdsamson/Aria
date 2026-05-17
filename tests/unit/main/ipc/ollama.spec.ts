/**
 * Unit tests for OLLAMA_STATUS + DIAGNOSTICS_STATUS handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTempUserDataDir } from '../../../setup';

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

function makeStubIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    invoke: (channel: string, payload?: unknown) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, payload);
    },
  };
}

async function setupModules(dataDir: string, reachable: boolean) {
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!reachable) {
        const e = new TypeError('fetch failed');
        (e as any).cause = { code: 'ECONNREFUSED' };
        throw e;
      }
      if (url.endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }), { status: 200 });
    }),
  );
  const ipc = await import('../../../../src/main/ipc/ollama');
  const secrets = await import('../../../../src/main/secrets/safeStorage');
  const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
  return { ipc, secrets, CHANNELS };
}

describe('registerOllamaHandlers', () => {
  let dataDir: string;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-ollama-ipc');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
    vi.unstubAllGlobals();
  });

  it('OLLAMA_STATUS returns reachable=true when fetch succeeds', async () => {
    const { ipc, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const status = (await invoke(CHANNELS.OLLAMA_STATUS, undefined)) as any;
    expect(status.reachable).toBe(true);
    expect(status.models).toContain('llama3.1:8b');
  });

  it('DIAGNOSTICS_STATUS returns LOCAL_ONLY when no provider is active', async () => {
    const { ipc, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const status = (await invoke(CHANNELS.DIAGNOSTICS_STATUS, undefined)) as any;
    expect(status.mode).toBe('LOCAL_ONLY');
    expect(status.frontierConfigured).toBe(false);
    expect(status.activeProvider).toBeNull();
    expect(typeof status.dataDir).toBe('string');
  });

  it('DIAGNOSTICS_STATUS returns HYBRID when Ollama reachable AND key set + active', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, true);
    await secrets.setFrontierKey({ provider: 'anthropic', key: 'sk-ant-test' });
    await secrets.setActiveProvider('anthropic');
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const status = (await invoke(CHANNELS.DIAGNOSTICS_STATUS, undefined)) as any;
    expect(status.mode).toBe('HYBRID');
    expect(status.frontierConfigured).toBe(true);
    expect(status.activeProvider).toBe('anthropic');
  });

  it('DIAGNOSTICS_STATUS returns FRONTIER_ONLY when Ollama unreachable but key set (UAT Gap 8)', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, false);
    await secrets.setFrontierKey({ provider: 'anthropic', key: 'sk-ant-test' });
    await secrets.setActiveProvider('anthropic');
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const status = (await invoke(CHANNELS.DIAGNOSTICS_STATUS, undefined)) as any;
    expect(status.mode).toBe('FRONTIER_ONLY');
    expect(status.ollama.reachable).toBe(false);
    expect(status.frontierConfigured).toBe(true);
  });

  it('DIAGNOSTICS_STATUS returns NONE when Ollama unreachable AND no key (UAT Gap 8)', async () => {
    const { ipc, CHANNELS } = await setupModules(dataDir, false);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const status = (await invoke(CHANNELS.DIAGNOSTICS_STATUS, undefined)) as any;
    expect(status.mode).toBe('NONE');
    expect(status.ollama.reachable).toBe(false);
    expect(status.frontierConfigured).toBe(false);
  });
});
