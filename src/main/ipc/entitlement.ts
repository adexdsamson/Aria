/**
 * Plan 08.1-02 Task 12 — Entitlement IPC handlers.
 *
 * Five channels (5 invoke handlers) + one push event (ENTITLEMENT_STATE_CHANGED)
 * consumed by Plan 08.1-03's paywall UX.
 */
import type { IpcMain, BrowserWindow } from 'electron';
import { shell } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { EntitlementService } from '../entitlement/service';
import { LicenseServerClient } from '../entitlement/license-server-client';
import {
  EntitlementActivateRequest,
  type EntitlementActivateResponse,
} from '../../shared/ipc-contract';

export interface EntitlementHandlersDeps {
  logger: Logger;
  dbHolder: DbHolder;
  service: EntitlementService;
  client?: LicenseServerClient;
  /** Test seam — override shell.openExternal */
  openExternal?: (url: string) => Promise<void>;
  /** Push event sink — the bootstrap wires this to mainWindow.webContents.send. */
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}

export function registerEntitlementHandlers(
  ipcMain: IpcMain,
  deps: EntitlementHandlersDeps,
): void {
  const { logger, service } = deps;
  const client = deps.client ?? new LicenseServerClient();
  const openExternal =
    deps.openExternal ?? ((url: string) => shell.openExternal(url));

  ipcMain.handle(CHANNELS.ENTITLEMENT_GET_STATE, async () => {
    try {
      return { ok: true, state: await service.getCurrentState() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    CHANNELS.ENTITLEMENT_ACTIVATE,
    async (_e, payload: unknown): Promise<EntitlementActivateResponse> => {
      const parsed = EntitlementActivateRequest.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: { code: 'bad-request' } };
      }
      try {
        const state = await service.activate(parsed.data.license_key);
        deps.emitToRenderer?.(CHANNELS.ENTITLEMENT_STATE_CHANGED, { state });
        return { ok: true, state };
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'activate-failed';
        const message = (err as Error).message;
        logger.warn(
          { scope: 'entitlement', event: 'activate.fail', code },
          'activate failed',
        );
        return { ok: false, error: { code, message } };
      }
    },
  );

  ipcMain.handle(CHANNELS.ENTITLEMENT_OPEN_CHECKOUT, async () => {
    // Stripe checkout URL baked at build time via env. We do NOT construct
    // the URL client-side from a price ID — the URL must be a real Stripe
    // Payment Link / Checkout Session URL chosen at release time.
    const url = process.env['ARIA_STRIPE_CHECKOUT_URL'] ?? '';
    if (!url) {
      return { ok: false, error: 'no-checkout-url' };
    }
    await openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.ENTITLEMENT_OPEN_PORTAL, async () => {
    try {
      const row = deps.dbHolder.db
        ?.prepare(`SELECT jwt FROM entitlement WHERE id = 1`)
        .get() as { jwt: string | null } | undefined;
      const jwt = row?.jwt;
      if (!jwt) return { ok: false, error: 'no-jwt' };
      const { url } = await client.getPortalUrl(jwt);
      await openExternal(url);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: (err as { code?: string }).code ?? (err as Error).message,
      };
    }
  });

  ipcMain.handle(CHANNELS.ENTITLEMENT_REFRESH_NOW, async () => {
    try {
      const state = await service.refresh();
      deps.emitToRenderer?.(CHANNELS.ENTITLEMENT_STATE_CHANGED, { state });
      return { ok: true, state };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/**
 * Convenience factory wiring the renderer push sink to a BrowserWindow.
 */
export function makeRendererEmitter(
  win: BrowserWindow | null,
): (channel: string, payload?: unknown) => void {
  return (channel, payload) => {
    try {
      win?.webContents?.send(channel, payload);
    } catch {
      /* renderer may be torn down */
    }
  };
}
