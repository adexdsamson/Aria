/**
 * registerHandlers behavior tests (updated by Plan 03 wave 4).
 *
 * After Plan 03 wiring, registerHandlers owns:
 *   - 5 onboarding channels (real handlers from Plan 02)
 *   - 2 backup channels    (real handlers from Plan 02)
 *   - 5 secrets channels   (real handlers from Plan 03)
 *   - 2 ollama/diagnostics channels (real handlers from Plan 03)
 *
 * Only ASK_ARIA + DIAGNOSTICS_ROUTING_LOG remain as no-op stubs. Plan 04
 * (wave 5) replaces those two with real handlers.
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

describe('registerHandlers (Plan 03 wave 4)', () => {
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

  it('ASK_ARIA + DIAGNOSTICS_ROUTING_LOG are still NOT_IMPLEMENTED stubs', async () => {
    const { registerHandlers, STUB_RESPONSE } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any, dataDir });
    for (const ch of [CHANNELS.ASK_ARIA, CHANNELS.DIAGNOSTICS_ROUTING_LOG]) {
      const h = handlers.get(ch)!;
      const res = await h({}, { sample: 'payload' });
      expect(res).toEqual({ error: 'NOT_IMPLEMENTED' });
    }
    expect(STUB_RESPONSE).toEqual({ error: 'NOT_IMPLEMENTED' });
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

  it('logs ipc.enter and ipc.exit with redacted payload for stub channels', async () => {
    const { registerHandlers } = await import('../../../../src/main/ipc');
    const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
    const { ipcMain, handlers } = makeFakeIpcMain();
    const logger = makeFakeLogger();
    registerHandlers(ipcMain, { logger: logger as any, dataDir });
    const askHandler = handlers.get(CHANNELS.ASK_ARIA);
    expect(askHandler).toBeTypeOf('function');
    await askHandler!({}, { prompt: 'email me at foo@bar.com', source: 'generic' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    const enterArgs = logger.info.mock.calls[0]![0] as {
      channel: string;
      payload: { prompt: string };
    };
    expect(enterArgs.channel).toBe(CHANNELS.ASK_ARIA);
    expect(enterArgs.payload.prompt).toContain('[REDACTED]');
    expect(enterArgs.payload.prompt).not.toContain('foo@bar.com');
  });
});
