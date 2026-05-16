/**
 * Frontier-key secrets layer backed by Electron `safeStorage` (Plan 03 Task 1).
 *
 * Storage shape on disk (`<userData>/secrets.json`):
 *   {
 *     v: 1,
 *     providers: { anthropic?: <base64-encrypted>, openai?: <b64>, google?: <b64> },
 *     activeProvider: 'anthropic' | 'openai' | 'google' | null
 *   }
 *
 * Hard guarantees:
 *   - Raw key text NEVER hits disk in plaintext (only safeStorage.encryptString
 *     output, base64-encoded).
 *   - Raw key text NEVER appears in any log line emitted by this module.
 *   - `setFrontierKey` refuses to run before `app.isReady()` (Windows DPAPI
 *     pre-ready returns garbage — Pitfall 3 in 01-RESEARCH.md).
 *   - `setFrontierKey` refuses to run when `safeStorage.isEncryptionAvailable()`
 *     is false OR when the Linux backend is `basic_text` (Pitfall 4). Refusing
 *     is the correct behavior — silently storing in plaintext violates D-09.
 *
 * Threat mitigations: T-01-03-01, T-01-03-02, T-01-03-03, T-01-03-05.
 */
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProviderId } from '../../shared/ipc-contract';

export type SafeStorageReason =
  | 'not-ready'
  | 'not-available'
  | 'basic_text'
  | 'decrypt-failed';

export class SafeStorageUnavailableError extends Error {
  readonly reason: SafeStorageReason;
  constructor(reason: SafeStorageReason) {
    super(`safeStorage unavailable: ${reason}`);
    this.name = 'SafeStorageUnavailableError';
    this.reason = reason;
  }
}

interface SecretsFile {
  v: 1;
  providers: Partial<Record<ProviderId, string>>;
  activeProvider: ProviderId | null;
}

const SECRETS_FILE = 'secrets.json';

function secretsPath(): string {
  return path.join(app.getPath('userData'), SECRETS_FILE);
}

function emptyFile(): SecretsFile {
  return { v: 1, providers: {}, activeProvider: null };
}

function readFile(): SecretsFile {
  const p = secretsPath();
  if (!fs.existsSync(p)) return emptyFile();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as SecretsFile;
    if (parsed.v !== 1) return emptyFile();
    if (!parsed.providers) parsed.providers = {};
    if (parsed.activeProvider === undefined) parsed.activeProvider = null;
    return parsed;
  } catch {
    // Corrupt file — fall back to empty (preserves availability; user can re-add).
    return emptyFile();
  }
}

function writeFileAtomic(data: SecretsFile): void {
  const p = secretsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function assertSafeStorageReady(): void {
  if (!app.isReady()) {
    throw new SafeStorageUnavailableError('not-ready');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageUnavailableError('not-available');
  }
  // Linux basic_text backend → refuse. Other backends (gnome_libsecret,
  // kwallet5/6, kwallet, keychain on macOS, dpapi on Windows) are acceptable.
  const getBackend = (safeStorage as { getSelectedStorageBackend?: () => string })
    .getSelectedStorageBackend;
  if (typeof getBackend === 'function') {
    const backend = getBackend.call(safeStorage);
    if (backend === 'basic_text') {
      throw new SafeStorageUnavailableError('basic_text');
    }
  }
}

export async function setFrontierKey(opts: {
  provider: ProviderId;
  key: string;
}): Promise<void> {
  assertSafeStorageReady();
  const { provider, key } = opts;
  const encrypted = safeStorage.encryptString(key).toString('base64');
  const data = readFile();
  data.providers[provider] = encrypted;
  writeFileAtomic(data);
}

export async function getFrontierKey(opts: {
  provider: ProviderId;
}): Promise<string | null> {
  assertSafeStorageReady();
  const data = readFile();
  const blob = data.providers[opts.provider];
  if (!blob) return null;
  try {
    const buf = Buffer.from(blob, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    throw new SafeStorageUnavailableError('decrypt-failed');
  }
}

export async function hasFrontierKey(opts: {
  provider: ProviderId;
}): Promise<boolean> {
  const data = readFile();
  return Boolean(data.providers[opts.provider]);
}

export async function clearFrontierKey(opts: {
  provider: ProviderId;
}): Promise<void> {
  const data = readFile();
  delete data.providers[opts.provider];
  if (data.activeProvider === opts.provider) {
    data.activeProvider = null;
  }
  writeFileAtomic(data);
}

export async function getActiveProvider(): Promise<ProviderId | null> {
  return readFile().activeProvider;
}

export async function setActiveProvider(
  provider: ProviderId | null,
): Promise<void> {
  const data = readFile();
  if (provider !== null && !data.providers[provider]) {
    throw new Error('no-key-for-provider');
  }
  data.activeProvider = provider;
  writeFileAtomic(data);
}
