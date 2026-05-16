import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMain } from 'electron';
import { registerHandlers, STUB_RESPONSE } from '../../../../src/main/ipc';
import { CHANNELS } from '../../../../src/shared/ipc-contract';

type Handler = (event: unknown, payload: unknown) => Promise<unknown> | unknown;

function makeFakeIpcMain(): {
  ipcMain: IpcMain;
  handlers: Map<string, Handler>;
} {
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

describe('registerHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers exactly one handler per CHANNELS entry', () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any });
    const expected = Object.keys(CHANNELS).length;
    expect(handlers.size).toBe(expected);
    for (const channel of Object.values(CHANNELS)) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('every stub handler resolves to { error: "NOT_IMPLEMENTED" }', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerHandlers(ipcMain, { logger: makeFakeLogger() as any });
    for (const [, handler] of handlers) {
      const result = await handler({}, { sample: 'payload' });
      expect(result).toEqual({ error: 'NOT_IMPLEMENTED' });
    }
    expect(STUB_RESPONSE).toEqual({ error: 'NOT_IMPLEMENTED' });
  });

  it('logs ipc.enter and ipc.exit with redacted payload', async () => {
    const { ipcMain, handlers } = makeFakeIpcMain();
    const logger = makeFakeLogger();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerHandlers(ipcMain, { logger: logger as any });
    const askHandler = handlers.get(CHANNELS.ASK_ARIA);
    expect(askHandler).toBeTypeOf('function');
    await askHandler!({}, { prompt: 'email me at foo@bar.com', source: 'generic' });
    // Two info calls minimum: enter + exit
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
