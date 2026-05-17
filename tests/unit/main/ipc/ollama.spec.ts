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

  // ── OLLAMA_GET_ACTIVE_MODEL / OLLAMA_SET_ACTIVE_MODEL ──────────────────────

  it('OLLAMA_GET_ACTIVE_MODEL returns source=default when nothing persisted', async () => {
    const { ipc, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const am = (await invoke(CHANNELS.OLLAMA_GET_ACTIVE_MODEL, undefined)) as any;
    expect(am.source).toBe('default');
    expect(typeof am.modelId).toBe('string');
    expect(am.modelId.length).toBeGreaterThan(0);
  });

  it('OLLAMA_GET_ACTIVE_MODEL returns source=persisted after set', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, true);
    secrets.setOllamaModelId('llama3.1:8b');
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const am = (await invoke(CHANNELS.OLLAMA_GET_ACTIVE_MODEL, undefined)) as any;
    expect(am.source).toBe('persisted');
    expect(am.modelId).toBe('llama3.1:8b');
  });

  it('OLLAMA_SET_ACTIVE_MODEL accepts a model in the tags list and persists it', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const res = (await invoke(CHANNELS.OLLAMA_SET_ACTIVE_MODEL, {
      modelId: 'llama3.1:8b',
    })) as any;
    expect(res.ok).toBe(true);
    expect(res.modelId).toBe('llama3.1:8b');
    expect(secrets.getOllamaModelId()).toBe('llama3.1:8b');
  });

  it('OLLAMA_SET_ACTIVE_MODEL rejects model-not-installed when missing from tags', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const res = (await invoke(CHANNELS.OLLAMA_SET_ACTIVE_MODEL, {
      modelId: 'dolphin3:not-installed',
    })) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('model-not-installed');
    expect(secrets.getOllamaModelId()).toBeNull();
  });

  it('OLLAMA_SET_ACTIVE_MODEL rejects ollama-unreachable when probe fails', async () => {
    const { ipc, secrets, CHANNELS } = await setupModules(dataDir, false);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const res = (await invoke(CHANNELS.OLLAMA_SET_ACTIVE_MODEL, {
      modelId: 'llama3.1:8b',
    })) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-unreachable');
    expect(secrets.getOllamaModelId()).toBeNull();
  });

  it('OLLAMA_SET_ACTIVE_MODEL rejects invalid-model-id for empty payload', async () => {
    const { ipc, CHANNELS } = await setupModules(dataDir, true);
    const { ipcMain, invoke } = makeStubIpcMain();
    ipc.registerOllamaHandlers(ipcMain as any, { logger, dataDir });
    const res = (await invoke(CHANNELS.OLLAMA_SET_ACTIVE_MODEL, { modelId: '   ' })) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid-model-id');
  });
});
