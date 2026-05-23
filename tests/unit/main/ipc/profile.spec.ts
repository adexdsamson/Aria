/**
 * IPC handler tests for PROFILE_GET / PROFILE_SET. Stub ipcMain captures
 * handlers and we invoke them directly — same pattern as secrets.spec.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createTempUserDataDir } from '../../../setup';
import { registerProfileHandlers } from '../../../../src/main/ipc/profile';
import { CHANNELS } from '../../../../src/shared/ipc-contract';
import { profilePathOf, readProfile } from '../../../../src/main/profile/store';
import * as fs from 'node:fs';

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

describe('registerProfileHandlers', () => {
  let dataDir: string;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-profile-ipc');
  });

  it('PROFILE_GET returns { displayName: null } when profile.json is missing', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_GET, undefined)).toEqual({ displayName: null });
  });

  it('PROFILE_SET writes profile.json and PROFILE_GET reads it back', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_SET, { displayName: 'Adex' })).toEqual({ ok: true });
    expect(await invoke(CHANNELS.PROFILE_GET, undefined)).toEqual({ displayName: 'Adex' });
    expect(readProfile(dataDir)).toEqual({ displayName: 'Adex' });
  });

  it('PROFILE_SET trims whitespace before persisting', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_SET, { displayName: '  Adex  ' })).toEqual({ ok: true });
    expect(await invoke(CHANNELS.PROFILE_GET, undefined)).toEqual({ displayName: 'Adex' });
  });

  it('PROFILE_SET rejects empty displayName', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_SET, { displayName: '' })).toEqual({
      ok: false,
      error: 'INVALID_DISPLAY_NAME',
    });
    expect(fs.existsSync(profilePathOf(dataDir))).toBe(false);
  });

  it('PROFILE_SET rejects whitespace-only displayName', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_SET, { displayName: '   ' })).toEqual({
      ok: false,
      error: 'INVALID_DISPLAY_NAME',
    });
  });

  it('PROFILE_SET rejects non-string displayName', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    expect(await invoke(CHANNELS.PROFILE_SET, { displayName: 42 })).toEqual({
      ok: false,
      error: 'INVALID_DISPLAY_NAME',
    });
  });

  it('PROFILE_SET overwrites a previous value', async () => {
    const { ipcMain, invoke } = makeStubIpcMain();
    registerProfileHandlers(ipcMain as never, { logger, dataDir });
    await invoke(CHANNELS.PROFILE_SET, { displayName: 'Adex' });
    await invoke(CHANNELS.PROFILE_SET, { displayName: 'Jordan' });
    expect(await invoke(CHANNELS.PROFILE_GET, undefined)).toEqual({ displayName: 'Jordan' });
  });
});
