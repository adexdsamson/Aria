/**
 * Onboarding + unlock IPC handlers (Plan 02 Task 3a).
 *
 * Registers the `ONBOARDING_*` channels declared in src/shared/ipc-contract.ts.
 * Plan 03 (wave 4) wires `registerOnboardingHandlers` into `registerHandlers`
 * by passing real deps; in this worktree wave we wire it from main/index.ts
 * alongside the stub registry (see deviation note in Plan 02 SUMMARY).
 *
 * The mnemonic generated in step 1 lives ONLY in this module's closure as
 * `pendingMnemonic` until seal — never on disk, never in logs. The renderer
 * sees the words once for one-time display, then drops its local copy.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { CHANNELS } from '../../shared/ipc-contract';
import {
  generateMnemonic,
  validateMnemonic,
  pickConfirmPositions,
} from '../vault/mnemonic';
import {
  sealVault,
  unlockVault,
  isVaultPresent,
  VaultUnlockError,
  VaultTamperedError,
  VaultMissingError,
} from '../vault/unlock';
import { deriveDbKey } from '../vault/derive';
import { openDb, closeDb, type Db } from '../db/connect';

export interface DbHolder {
  db: Db | null;
  isOpen: boolean;
  set(db: Db): void;
  close(): void;
}

/** Default mutable holder shared across IPC modules (Plan 03 reads/writes too). */
export function createDbHolder(): DbHolder {
  const holder: DbHolder = {
    db: null,
    get isOpen(): boolean {
      return holder.db !== null;
    },
    set(db: Db): void {
      holder.db = db;
    },
    close(): void {
      if (holder.db) {
        try {
          closeDb(holder.db);
        } catch {
          /* ignore */
        }
        holder.db = null;
      }
    },
  } as DbHolder;
  return holder;
}

export interface OnboardingDeps {
  logger: Logger;
  dataDir: string;
  dbHolder: DbHolder;
}

/**
 * In-process state. The mnemonic generated in step 1 stays here until
 * onboardingSeal or process exit. NOT exported and NOT logged.
 */
let pendingMnemonic: string | null = null;
let pendingPositions: [number, number, number] | null = null;

function vaultPathOf(dataDir: string): string {
  return path.join(dataDir, 'vault.json');
}

/**
 * Test-only escape hatch: when `ARIA_E2E === '1'`, expose the current
 * `pendingMnemonic` so Playwright can submit correct 3-word answers.
 * The hatch is intentionally gated by an env var so a production binary
 * cannot leak the mnemonic to the renderer.
 */
const ARIA_E2E_CHANNEL = 'aria:onboarding:__e2e_get_pending__';

export function registerOnboardingHandlers(
  ipcMain: IpcMain,
  deps: OnboardingDeps,
): void {
  const { logger, dataDir, dbHolder } = deps;

  ipcMain.handle(CHANNELS.ONBOARDING_GEN_MNEMONIC, async () => {
    pendingMnemonic = generateMnemonic();
    pendingPositions = pickConfirmPositions();
    logger.info({ event: 'onboarding.mnemonic.generated' });
    return {
      mnemonic: pendingMnemonic,
      positions: pendingPositions,
    };
  });

  ipcMain.handle(CHANNELS.ONBOARDING_CONFIRM, async (_e, req: unknown) => {
    const r = req as { positions?: number[]; answers?: string[] };
    if (!pendingMnemonic) return { ok: false, error: 'NO_PENDING_MNEMONIC' };
    const positions = r?.positions ?? pendingPositions ?? [];
    const answers = r?.answers ?? [];
    if (positions.length !== 3 || answers.length !== 3) return { ok: false };
    const words = pendingMnemonic.split(' ');
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const p = positions[i]!;
      const ans = (answers[i] ?? '').trim().toLowerCase();
      if (words[p] !== ans) ok = false;
    }
    if (!ok) {
      // Re-roll positions on failure so the user gets a different challenge.
      pendingPositions = pickConfirmPositions();
      logger.warn({ event: 'onboarding.confirm.failed' });
      return { ok: false, positions: pendingPositions };
    }
    logger.info({ event: 'onboarding.confirm.ok' });
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.ONBOARDING_SEAL, async (_e, req: unknown) => {
    const r = req as { dailyPassword?: string; passphrase?: string };
    const dailyPassword = r?.dailyPassword ?? r?.passphrase ?? '';
    if (!pendingMnemonic) return { error: 'NO_PENDING_MNEMONIC' };
    if (typeof dailyPassword !== 'string' || dailyPassword.length < 8) {
      return { error: 'PASSWORD_TOO_SHORT' };
    }
    const appSalt = crypto.randomBytes(16);
    sealVault(dailyPassword, pendingMnemonic, vaultPathOf(dataDir), appSalt);
    const dbKey = await deriveDbKey(pendingMnemonic, appSalt);
    try {
      dbHolder.close();
      const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: true });
      dbHolder.set(db);
      logger.info({ event: 'onboarding.sealed' });
      return { ok: true };
    } finally {
      pendingMnemonic = null;
      pendingPositions = null;
      dbKey.fill(0);
    }
  });

  ipcMain.handle(CHANNELS.ONBOARDING_UNLOCK, async (_e, req: unknown) => {
    const r = req as { dailyPassword?: string; passphrase?: string };
    const dailyPassword = r?.dailyPassword ?? r?.passphrase ?? '';
    try {
      const { mnemonic, appSalt } = unlockVault(dailyPassword, vaultPathOf(dataDir));
      const dbKey = await deriveDbKey(mnemonic, appSalt);
      try {
        dbHolder.close();
        const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: true });
        dbHolder.set(db);
        logger.info({ event: 'onboarding.unlocked' });
        return { ok: true };
      } finally {
        dbKey.fill(0);
      }
    } catch (err) {
      if (err instanceof VaultUnlockError) {
        logger.warn({ event: 'vault.unlock.failed' });
        return { ok: false, error: 'VAULT_UNLOCK_FAILED' };
      }
      if (err instanceof VaultTamperedError) {
        logger.warn({ event: 'vault.tampered' });
        return { ok: false, error: 'VAULT_TAMPERED' };
      }
      if (err instanceof VaultMissingError) {
        return { ok: false, error: 'VAULT_MISSING' };
      }
      logger.warn({ event: 'onboarding.unlock.error' });
      return { ok: false, error: 'UNKNOWN' };
    }
  });

  ipcMain.handle(CHANNELS.ONBOARDING_STATUS, async () => {
    return {
      vaultPresent: isVaultPresent(vaultPathOf(dataDir)),
      dbOpen: dbHolder.isOpen,
      // Backwards-compatible shape from ipc-contract.OnboardingStatus.
      sealed: isVaultPresent(vaultPathOf(dataDir)),
      unlocked: dbHolder.isOpen,
    };
  });

  // E2E hook — gated by env var so production cannot expose the mnemonic.
  if (process.env.ARIA_E2E === '1') {
    ipcMain.handle(ARIA_E2E_CHANNEL, async () => ({
      pendingMnemonic,
      pendingPositions,
    }));
  }
}

/** Test-only helper: clear in-memory state between tests. */
export function _resetOnboardingForTests(): void {
  pendingMnemonic = null;
  pendingPositions = null;
}

// Re-export the validator so the renderer-side restore form can sanity-check
// the user's 12-word input before invoking the BACKUP_RESTORE handler.
export { validateMnemonic };
