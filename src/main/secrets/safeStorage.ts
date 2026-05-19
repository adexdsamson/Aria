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
import type Database from 'better-sqlite3-multiple-ciphers';

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
  providerTokens?: Record<string, string>;
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

function ensureProviderTokens(data: SecretsFile): Record<string, string> {
  if (!data.providerTokens) data.providerTokens = {};
  return data.providerTokens;
}

function isLegacyGoogleTokenKey(key: string): key is `google:${GoogleTokenKind}` {
  return key === 'google:gmail' || key === 'google:calendar';
}

function legacyKindFromProviderTokenKey(key: `google:${GoogleTokenKind}`): GoogleTokenKind {
  return key.split(':', 2)[1] as GoogleTokenKind;
}

function tryParseGoogleTokenBlob(
  blob: string,
): { refreshToken: string; email: string } | null {
  try {
    const parsed = JSON.parse(blob) as Partial<{ refreshToken: string; email: string }>;
    if (
      typeof parsed.refreshToken === 'string' &&
      parsed.refreshToken.length > 0 &&
      typeof parsed.email === 'string' &&
      parsed.email.length > 0
    ) {
      return { refreshToken: parsed.refreshToken, email: parsed.email };
    }
  } catch {
    // Non-JSON blobs are fine for non-Google providers.
  }
  return null;
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

// ========================================================================
// Plan 05-01: providerTokens namespace (opaque per-provider secret blobs)
// ========================================================================

/**
 * Store an opaque provider token blob under `${providerKey}:${accountId}`.
 *
 * For Google legacy singleton keys (`google:gmail` / `google:calendar`), this
 * also write-throughs to the existing `googleTokens` subtree when the blob is
 * JSON shaped like `{ refreshToken, email }`, preserving the old read path.
 */
export function setProviderTokens(
  key: string,
  blob: string,
  opts: { mirrorLegacyGoogle?: boolean } = {},
): void {
  assertSafeStorageReady();
  const mirrorLegacyGoogle = opts.mirrorLegacyGoogle ?? true;
  const data = readFile();
  const encrypted = safeStorage.encryptString(blob).toString('base64');
  ensureProviderTokens(data)[key] = encrypted;

  if (mirrorLegacyGoogle && key.startsWith('google:') && isLegacyGoogleTokenKey(key)) {
    const legacy = tryParseGoogleTokenBlob(blob);
    if (legacy) {
      const kind = legacyKindFromProviderTokenKey(key);
      if (!data.googleTokens) data.googleTokens = {};
      data.googleTokens[kind] = {
        refreshTokenEnc: safeStorage.encryptString(legacy.refreshToken).toString('base64'),
        email: legacy.email,
      };
    }
  }

  writeFileAtomic(data);
}

export function migrateLegacyGoogleTokensToProviderTokens(): { migrated: string[] } {
  assertSafeStorageReady();
  const data = readFile();
  const providerTokens = ensureProviderTokens(data);
  const migrated: string[] = [];
  for (const kind of ['gmail', 'calendar'] as const) {
    const key = `google:${kind}`;
    if (providerTokens[key]) continue;
    const entry = data.googleTokens?.[kind];
    if (!entry) continue;
    const refreshToken = safeStorage.decryptString(Buffer.from(entry.refreshTokenEnc, 'base64'));
    providerTokens[key] = safeStorage
      .encryptString(JSON.stringify({ refreshToken, email: entry.email }))
      .toString('base64');
    migrated.push(key);
  }
  if (migrated.length > 0) {
    writeFileAtomic(data);
  }
  return { migrated };
}

/**
 * Read a provider token blob by `${providerKey}:${accountId}`. For legacy
 * Google singleton keys, synthesize the blob from `googleTokens` when the
 * new namespace is empty.
 */
export function getProviderTokens(key: string): string | null {
  assertSafeStorageReady();
  const data = readFile();
  const blob = data.providerTokens?.[key];
  if (blob !== undefined) {
    try {
      return safeStorage.decryptString(Buffer.from(blob, 'base64'));
    } catch {
      throw new SafeStorageUnavailableError('decrypt-failed');
    }
  }

  if (key.startsWith('google:') && isLegacyGoogleTokenKey(key)) {
    const kind = legacyKindFromProviderTokenKey(key);
    const entry = data.googleTokens?.[kind];
    if (!entry) return null;
    return JSON.stringify({
      refreshToken: safeStorage.decryptString(Buffer.from(entry.refreshTokenEnc, 'base64')),
      email: entry.email,
    });
  }

  return null;
}

/**
 * Remove a provider token blob. For legacy Google singleton keys, clears the
 * mirrored `googleTokens` subtree as well so old callers observe the delete.
 */
export function clearProviderTokens(key: string): void {
  const data = readFile();
  if (data.providerTokens) delete data.providerTokens[key];

  if (key.startsWith('google:') && isLegacyGoogleTokenKey(key)) {
    const kind = legacyKindFromProviderTokenKey(key);
    if (data.googleTokens) delete data.googleTokens[kind];
  }

  writeFileAtomic(data);
}

/**
 * Enumerate all provider token keys, including legacy Google singleton keys
 * synthesized from `googleTokens`.
 */
export function listProviderTokenKeys(): string[] {
  const data = readFile();
  const keys = new Set<string>(Object.keys(data.providerTokens ?? {}));
  if (data.googleTokens?.gmail) keys.add('google:gmail');
  if (data.googleTokens?.calendar) keys.add('google:calendar');
  return [...keys].sort();
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

export interface LegacyGoogleDropResult {
  droppedCount: number;
  failedCount: number;
  skippedCount: number;
  reason?: 'basic_text-backend';
  failures: Array<{ accountId: string; reason: string }>;
  accountIds: string[];
}

export function getSafeStorageBackend(): string {
  const getBackend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
  return typeof getBackend === 'function' ? getBackend.call(safeStorage) : 'unknown';
}

export function runDropLegacyGoogleKeyringPerAccount(db: Database.Database): LegacyGoogleDropResult {
  const accountIds = listGoogleProviderAccountIds(db);
  if (getSafeStorageBackend() === 'basic_text') {
    return {
      droppedCount: 0,
      failedCount: 0,
      skippedCount: accountIds.length,
      reason: 'basic_text-backend',
      failures: [],
      accountIds,
    };
  }

  const results = accountIds.map((accountId) => dropLegacyGoogleEntry(accountId));
  const failures = results
    .filter((result) => !result.dropped && result.reason !== 'no-legacy-entry')
    .map((result) => ({ accountId: result.accountId, reason: result.reason ?? 'unknown' }));
  for (const failure of failures) {
    try {
      db.prepare(
        `UPDATE provider_account
            SET last_error = @message,
                last_error_at = @ts
          WHERE provider_key = 'google'
            AND account_id = @accountId`,
      ).run({
        accountId: failure.accountId,
        message: `Legacy keyring entry retained - ${failure.reason}`,
        ts: new Date().toISOString(),
      });
    } catch {
      /* best effort: retaining both entries is the safety behavior. */
    }
  }
  return {
    droppedCount: results.filter((result) => result.dropped).length,
    failedCount: failures.length,
    skippedCount: 0,
    failures,
    accountIds,
  };
}

function listGoogleProviderAccountIds(db: Database.Database): string[] {
  try {
    const rows = db.prepare(
      `SELECT account_id AS accountId
         FROM provider_account
        WHERE provider_key = 'google'
        ORDER BY account_id ASC`,
    ).all() as Array<{ accountId: string }>;
    return rows.map((row) => row.accountId);
  } catch {
    return [];
  }
}

function dropLegacyGoogleEntry(accountId: string): { accountId: string; dropped: boolean; reason?: string } {
  assertSafeStorageReady();
  const data = readFile();
  const legacyKinds = (['gmail', 'calendar'] as const).filter(
    (kind) => data.googleTokens?.[kind]?.email === accountId,
  );
  if (legacyKinds.length === 0) return { accountId, dropped: false, reason: 'no-legacy-entry' };

  const verified = legacyKinds.some((kind) => {
    const blob = data.providerTokens?.[`google:${kind}`];
    if (!blob) return false;
    try {
      const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(blob, 'base64'))) as {
        email?: string;
        refreshToken?: string;
      };
      return parsed.email === accountId && Boolean(parsed.refreshToken);
    } catch {
      return false;
    }
  });
  if (!verified) return { accountId, dropped: false, reason: 'new-provider-token-verification-failed' };

  if (data.googleTokens) {
    for (const kind of legacyKinds) delete data.googleTokens[kind];
  }
  writeFileAtomic(data);
  return { accountId, dropped: true };
}
