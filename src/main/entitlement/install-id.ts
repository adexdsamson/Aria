/**
 * Plan 08.1-02 Task 2 — Install ID provider.
 *
 * `install_id` is a stable UUIDv4 generated once on first launch and persisted
 * to the OS keychain via Electron `safeStorage`. It MUST survive:
 *   - DB wipe (so trial-reset by deleting aria.db is defeated)
 *   - App reinstall (so trial-reset by uninstall+reinstall is defeated)
 *
 * It does NOT survive a wipe of the OS keychain — that defeat is accepted
 * (documented in RESEARCH §8 threat model).
 *
 * Storage:
 *   - Primary: `<userData>/install-id.enc` (safeStorage.encryptString output)
 *   - Linux basic_text fallback: `<userData>/install-id.txt` (plaintext +
 *     warning log line). Mirrors the Phase-1 vault pattern.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { app, safeStorage } from 'electron';
import type { Logger } from 'pino';

export interface InstallIdDeps {
  dataDir?: string;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — override Electron safeStorage. */
  safeStorageImpl?: Pick<
    typeof safeStorage,
    'isEncryptionAvailable' | 'encryptString' | 'decryptString'
  >;
}

const ENC_FILE = 'install-id.enc';
const TXT_FILE = 'install-id.txt';

function resolveDataDir(deps: InstallIdDeps): string {
  if (deps.dataDir) return deps.dataDir;
  // app.getPath('userData') asserts app is ready; callers must invoke after
  // `app.whenReady()`. The bootstrap call site in src/main/index.ts satisfies
  // this. Tests inject `dataDir` directly.
  return app.getPath('userData');
}

function uuid(): string {
  return crypto.randomUUID();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Returns the persistent install_id, generating + persisting on first call.
 *
 * Idempotent within a process AND across restarts as long as the OS keychain
 * is intact.
 */
export async function getOrCreateInstallId(
  deps: InstallIdDeps = {},
): Promise<string> {
  const dir = resolveDataDir(deps);
  const ss = deps.safeStorageImpl ?? safeStorage;
  const logger = deps.logger;
  const encPath = path.join(dir, ENC_FILE);
  const txtPath = path.join(dir, TXT_FILE);

  const available = (() => {
    try {
      return ss.isEncryptionAvailable();
    } catch {
      return false;
    }
  })();

  // Read existing — encrypted path first
  if (available && fs.existsSync(encPath)) {
    try {
      const buf = fs.readFileSync(encPath);
      const id = ss.decryptString(buf);
      if (UUID_RE.test(id)) return id;
      logger?.warn(
        { scope: 'install-id', event: 'malformed' },
        'install-id.enc decrypted to non-UUID; regenerating',
      );
    } catch (err) {
      logger?.warn(
        { scope: 'install-id', err: (err as Error).message },
        'install-id.enc decrypt failed; regenerating',
      );
    }
  }

  // Plaintext fallback read (only honored when safeStorage unavailable)
  if (!available && fs.existsSync(txtPath)) {
    try {
      const id = fs.readFileSync(txtPath, 'utf8').trim();
      if (UUID_RE.test(id)) return id;
    } catch {
      /* fallthrough — regenerate */
    }
  }

  // Generate + persist
  const id = uuid();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  if (available) {
    const enc = ss.encryptString(id);
    fs.writeFileSync(encPath, enc);
  } else {
    logger?.warn(
      { scope: 'install-id', event: 'plaintext-fallback' },
      'safeStorage unavailable (Linux basic_text); writing install-id as plaintext',
    );
    fs.writeFileSync(txtPath, id, { encoding: 'utf8' });
  }
  return id;
}
