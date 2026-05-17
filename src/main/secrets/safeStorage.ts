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

/**
 * Plan 02-01: Google OAuth refresh tokens live in a separate `googleTokens`
 * subtree on the SAME secrets.json file. Refresh token is encrypted via
 * safeStorage.encryptString and base64-encoded — exactly the same discipline
 * as `providers`. The plaintext refresh token NEVER hits disk and NEVER
 * appears in SQLCipher rows (T-02-01-01).
 */
export type GoogleTokenKind = 'gmail' | 'calendar';

interface GoogleTokenEntry {
  refreshTokenEnc: string;
  email: string;
}

interface SecretsFile {
  v: 1;
  providers: Partial<Record<ProviderId, string>>;
  activeProvider: ProviderId | null;
  googleTokens?: Partial<Record<GoogleTokenKind, GoogleTokenEntry>>;
  /**
   * User-selected Ollama model id (e.g. 'dolphin3:latest', 'llama3.1:8b-instruct-q4_K_M').
   * NOT a secret — co-located here only to avoid introducing a second settings
   * store. `null` / absent → fall back to providers.DEFAULT_LOCAL_MODEL.
   */
  ollamaModelId?: string | null;
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

// ============================================================================
// Plan 02-01: Google OAuth refresh-token storage (googleTokens subtree)
// ============================================================================

export interface SetGoogleTokensInput {
  kind: GoogleTokenKind;
  refreshToken: string;
  email: string;
}

/**
 * Persist a Google OAuth refresh token + the user's email for the given kind
 * ('gmail' | 'calendar'). The refresh token is encrypted via safeStorage and
 * base64-encoded before write. Phase-1 fields (`providers`, `activeProvider`)
 * are preserved untouched (T-01-03 isolation discipline).
 */
export function setGoogleTokens(input: SetGoogleTokensInput): void {
  assertSafeStorageReady();
  const { kind, refreshToken, email } = input;
  if (!refreshToken) {
    throw new Error('setGoogleTokens: refreshToken is empty');
  }
  const encrypted = safeStorage.encryptString(refreshToken).toString('base64');
  const data = readFile();
  if (!data.googleTokens) data.googleTokens = {};
  data.googleTokens[kind] = { refreshTokenEnc: encrypted, email };
  writeFileAtomic(data);
}

export interface GoogleTokens {
  refreshToken: string;
  email: string;
}

/**
 * Read + decrypt the persisted refresh token for the given kind. Returns null
 * when no entry exists. Throws SafeStorageUnavailableError(decrypt-failed) on
 * corrupted ciphertext or when the OS keychain rejects the decrypt.
 */
export function getGoogleTokens(kind: GoogleTokenKind): GoogleTokens | null {
  assertSafeStorageReady();
  const data = readFile();
  const entry = data.googleTokens?.[kind];
  if (!entry) return null;
  try {
    const buf = Buffer.from(entry.refreshTokenEnc, 'base64');
    const refreshToken = safeStorage.decryptString(buf);
    return { refreshToken, email: entry.email };
  } catch {
    throw new SafeStorageUnavailableError('decrypt-failed');
  }
}

// ============================================================================
// Ollama active-model id (non-secret; persisted alongside frontier keys to
// avoid a second settings store). Plaintext on disk by design — the model id
// itself carries no privilege. See providers.getLocalModel().
// ============================================================================

/**
 * Read the persisted Ollama model id (or null when unset). Returns null on
 * missing file / corrupt file / missing field — callers must fall back to
 * providers.DEFAULT_LOCAL_MODEL in that case. Sync because providers.getLocalModel
 * is sync at every call site.
 */
export function getOllamaModelId(): string | null {
  const data = readFile();
  const v = data.ollamaModelId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Persist the Ollama model id. Pass null to clear. Other secrets-file fields
 * (providers / activeProvider / googleTokens) are preserved untouched.
 */
export function setOllamaModelId(modelId: string | null): void {
  const data = readFile();
  data.ollamaModelId = modelId && modelId.length > 0 ? modelId : null;
  writeFileAtomic(data);
}

/**
 * Remove the persisted Google tokens for the given kind. Leaves OTHER kinds
 * (e.g. calendar when clearing gmail) and Phase-1 `providers` / `activeProvider`
 * untouched.
 */
export function clearGoogleTokens(kind: GoogleTokenKind): void {
  const data = readFile();
  if (data.googleTokens && data.googleTokens[kind]) {
    delete data.googleTokens[kind];
  }
  writeFileAtomic(data);
}
