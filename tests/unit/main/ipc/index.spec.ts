/**
 * registerHandlers behavior tests (updated by Plan 04 wave 5).
 *
 * After Plan 04 wiring, registerHandlers owns all channels with real handlers:
 *   - 5 onboarding channels         (Plan 02)
 *   - 2 backup channels             (Plan 02)
 *   - 5 secrets channels            (Plan 03)
 *   - 2 ollama/diagnostics channels (Plan 03)
 *   - 1 ASK_ARIA                    (Plan 04)
 *   - 1 DIAGNOSTICS_ROUTING_LOG     (Plan 04)
 *
 * No no-op stubs remain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMain } from 'electron';
import { createTempUserDataDir } from '../../../setup';

type Handler = (event: unknown, payload: unknown) => Promise<unknown> | unknown;

function makeFakeIpcMain(): { ipcMain: IpcMain; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    }),
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

function makeFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

describe('registerHandlers (Plan 04 wave 5)', { timeout: 30_000 }, () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-ipc-index');
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
      dialog: {
        showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
      },
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('registers exactly one handler per CHANNELS entry', async () => {
    const { registerHandlers } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any, dataDir });
    const expected = Object.keys(CHANNELS).length;
    expect(handlers.size).toBe(expected);
    for (const channel of Object.values(CHANNELS)) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('ASK_ARIA + DIAGNOSTICS_ROUTING_LOG are wired to real handlers (Plan 04)', async () => {
    const { registerHandlers } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any, dataDir });
    // DIAGNOSTICS_ROUTING_LOG with no DB attached returns [] not NOT_IMPLEMENTED.
    const diagRes = await handlers.get(CHANNELS.DIAGNOSTICS_ROUTING_LOG)!({}, { limit: 5 });
    expect(diagRes).toEqual([]);
    // ASK_ARIA handler is registered (we don't invoke it here — that would
    // require a real model / network. The full path is covered by
    // tests/unit/main/ipc/ask.spec.ts and ask-local-handler.spec.ts).
    expect(typeof handlers.get(CHANNELS.ASK_ARIA)).toBe('function');
  });

  it('secrets + ollama channels are wired to real handlers (not stubs)', async () => {
    const { registerHandlers } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any, dataDir });

    const setRes = await handlers.get(CHANNELS.SECRETS_SET_FRONTIER_KEY)!(
      {},
      { provider: 'anthropic', key: 'sk-ant-real' },
    );
    expect(setRes).toEqual({ ok: true });

    const hasRes = (await handlers.get(CHANNELS.SECRETS_HAS_FRONTIER_KEY)!(
      {},
      { provider: 'anthropic' },
    )) as { present: boolean };
    expect(hasRes.present).toBe(true);
  });

  it('all six handler-registration functions register exactly one handler per CHANNELS entry', async () => {
    const { registerHandlers } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any, dataDir });
    expect(handlers.size).toBe(Object.keys(CHANNELS).length);
  });
});
