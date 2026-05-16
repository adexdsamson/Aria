/**
 * Single source-of-truth for the Aria IPC contract.
 *
 * Plans 02 / 03 / 04 import from this file ONLY — no string-literal IPC names
 * anywhere else. Channel constants are mirrored 1:1 by the preload bridge into
 * `window.aria` (camelCase method names).
 */

export const CHANNELS = {
  ASK_ARIA: 'aria:ask',
  ONBOARDING_GEN_MNEMONIC: 'aria:onboarding:gen-mnemonic',
  ONBOARDING_CONFIRM: 'aria:onboarding:confirm',
  ONBOARDING_SEAL: 'aria:onboarding:seal',
  ONBOARDING_UNLOCK: 'aria:onboarding:unlock',
  ONBOARDING_STATUS: 'aria:onboarding:status',
  SECRETS_SET_FRONTIER_KEY: 'aria:secrets:set',
  SECRETS_HAS_FRONTIER_KEY: 'aria:secrets:has',
  SECRETS_CLEAR_FRONTIER_KEY: 'aria:secrets:clear',
  SECRETS_GET_ACTIVE_PROVIDER: 'aria:secrets:get-provider',
  SECRETS_SET_ACTIVE_PROVIDER: 'aria:secrets:set-provider',
  OLLAMA_STATUS: 'aria:ollama:status',
  DIAGNOSTICS_ROUTING_LOG: 'aria:diagnostics:routing-log',
  DIAGNOSTICS_STATUS: 'aria:diagnostics:status',
  BACKUP_CREATE: 'aria:backup:create',
  BACKUP_RESTORE: 'aria:backup:restore',
  // Plan 02-01 Gmail integration
  GMAIL_CONNECT: 'aria:gmail:connect',
  GMAIL_STATUS: 'aria:gmail:status',
  GMAIL_DISCONNECT: 'aria:gmail:disconnect',
  GMAIL_FORCE_SYNC: 'aria:gmail:force-sync',
  // Plan 02-02 Calendar integration
  CALENDAR_CONNECT: 'aria:calendar:connect',
  CALENDAR_STATUS: 'aria:calendar:status',
  CALENDAR_DISCONNECT: 'aria:calendar:disconnect',
  CALENDAR_FORCE_SYNC: 'aria:calendar:force-sync',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export type ProviderId = 'anthropic' | 'openai' | 'google';
export type SourceTag = 'user-email' | 'user-calendar' | 'user-transcript' | 'generic';
export type Route = 'LOCAL' | 'FRONTIER';

export interface AskRequest {
  prompt: string;
  source: SourceTag;
}

export interface AskResponse {
  answer: string;
  route: Route;
  reason: string;
  latency_ms: number;
}

export interface RoutingLogEntry {
  id: number;
  ts: string;
  route: Route;
  reason: string;
  source: SourceTag;
  prompt_hash: string;
  model: string;
  latency_ms: number;
  ok: number;
}

export interface OllamaStatus {
  reachable: boolean;
  version?: string;
  models: string[];
  error?: string;
}

export interface DiagnosticsStatus {
  ollama: OllamaStatus;
  frontierConfigured: boolean;
  activeProvider: ProviderId | null;
  mode: 'LOCAL_ONLY' | 'HYBRID';
  dataDir: string;
}

/** Onboarding payloads (concrete shapes finalized by Plan 03; permissive here). */
export interface MnemonicResult {
  mnemonic: string;
}
export interface OnboardingConfirmRequest {
  mnemonic: string;
}
export interface OnboardingSealRequest {
  mnemonic: string;
  passphrase?: string;
}
export interface OnboardingUnlockRequest {
  passphrase: string;
}
export interface OnboardingStatus {
  sealed: boolean;
  unlocked: boolean;
}

/**
 * Plan 02-01 — Gmail integration status payload returned by GMAIL_STATUS.
 *
 * `tokenStatus` drives the IntegrationsSection UI:
 *   - `missing`  — no row in gmail_account; render "Connect Gmail" button
 *   - `ok`       — connected, last_error is empty
 *   - `expired`  — last_error starts with `token-expired`; EMAIL-07 banner
 *                  (`Aria's access to Gmail has expired. Re-connect to resume
 *                   syncing. Calendar and other integrations are unaffected.`)
 *   - `revoked`  — last_error starts with `token-revoked`; EMAIL-07 banner
 *                  with the revoked variant copy
 *
 * `queueDepth` = scheduler.queue.size + scheduler.queue.pending — surfaced by
 * StatusPanel's IntegrationStatusRow.
 */
export interface GmailIntegrationStatus {
  connected: boolean;
  email?: string;
  lastSyncedAt?: string;
  lastError?: string;
  tokenStatus: 'ok' | 'missing' | 'expired' | 'revoked';
  queueDepth: number;
}

/**
 * Plan 02-02 — Calendar integration status payload. Mirrors GmailIntegrationStatus
 * field-for-field so the renderer can share the row component shape.
 */
export interface CalendarIntegrationStatus {
  connected: boolean;
  email?: string;
  lastSyncedAt?: string;
  lastError?: string;
  tokenStatus: 'ok' | 'missing' | 'expired' | 'revoked';
  queueDepth: number;
}

/**
 * Plan 02-02 — calendar_event row shape consumed by Plan 02-04's briefing
 * reader. Mirrors the migration 003 columns. EITHER `start_at_utc` (timed
 * events) OR `start_date` (YYYY-MM-DD all-day events) is set, never both;
 * the SQLite CHECK constraint enforces this server-side.
 */
export interface CalendarEventRow {
  id: string;
  calendar_id: string;
  summary: string;
  location: string | null;
  start_at_utc: string | null;
  end_at_utc: string | null;
  start_date: string | null;
  end_date: string | null;
  start_timezone: string | null;
  attendees: string;
  status: string;
  recurring_id: string | null;
  updated_at: string;
  fetched_at: string;
}

/** Standardized error envelope returned by stub handlers in Plan 01b. */
export interface IpcError {
  error: string;
}

/**
 * AriaApi mirrors CHANNELS 1:1 in camelCase. Plans 02/03/04 implement bodies;
 * Plan 01b ships no-op stubs that resolve `{ error: 'NOT_IMPLEMENTED' }`.
 */
export interface AriaApi {
  askAria(req: AskRequest): Promise<AskResponse | IpcError>;

  onboardingGenMnemonic(): Promise<MnemonicResult | IpcError>;
  onboardingConfirm(req: OnboardingConfirmRequest): Promise<{ ok: boolean } | IpcError>;
  onboardingSeal(req: OnboardingSealRequest): Promise<{ ok: boolean } | IpcError>;
  onboardingUnlock(req: OnboardingUnlockRequest): Promise<{ ok: boolean } | IpcError>;
  onboardingStatus(): Promise<OnboardingStatus | IpcError>;

  secretsSetFrontierKey(req: { provider: ProviderId; key: string }): Promise<{ ok: boolean } | IpcError>;
  secretsHasFrontierKey(req: { provider: ProviderId }): Promise<{ present: boolean } | IpcError>;
  secretsClearFrontierKey(req: { provider: ProviderId }): Promise<{ ok: boolean } | IpcError>;
  secretsGetActiveProvider(): Promise<{ provider: ProviderId | null } | IpcError>;
  secretsSetActiveProvider(req: { provider: ProviderId }): Promise<{ ok: boolean } | IpcError>;

  ollamaStatus(): Promise<OllamaStatus | IpcError>;

  diagnosticsRoutingLog(req?: { limit?: number }): Promise<RoutingLogEntry[] | IpcError>;
  diagnosticsStatus(): Promise<DiagnosticsStatus | IpcError>;

  backupCreate(req?: { destination?: string }): Promise<{ path: string } | IpcError>;
  backupRestore(req: { source: string; passphrase: string }): Promise<{ ok: boolean } | IpcError>;

  gmailConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string } | IpcError>;
  gmailStatus(): Promise<GmailIntegrationStatus | IpcError>;
  gmailDisconnect(): Promise<{ ok: boolean } | IpcError>;
  gmailForceSync(): Promise<{ ok: boolean; error?: string } | IpcError>;

  calendarConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string } | IpcError>;
  calendarStatus(): Promise<CalendarIntegrationStatus | IpcError>;
  calendarDisconnect(): Promise<{ ok: boolean } | IpcError>;
  calendarForceSync(): Promise<{ ok: boolean; error?: string } | IpcError>;
}

/**
 * Mapping from CHANNELS key -> AriaApi method name (camelCase). Used by the
 * preload bridge to build the typed surface and by tests to assert the bridge
 * mirrors CHANNELS 1:1.
 */
export const CHANNEL_METHODS: Record<keyof typeof CHANNELS, keyof AriaApi> = {
  ASK_ARIA: 'askAria',
  ONBOARDING_GEN_MNEMONIC: 'onboardingGenMnemonic',
  ONBOARDING_CONFIRM: 'onboardingConfirm',
  ONBOARDING_SEAL: 'onboardingSeal',
  ONBOARDING_UNLOCK: 'onboardingUnlock',
  ONBOARDING_STATUS: 'onboardingStatus',
  SECRETS_SET_FRONTIER_KEY: 'secretsSetFrontierKey',
  SECRETS_HAS_FRONTIER_KEY: 'secretsHasFrontierKey',
  SECRETS_CLEAR_FRONTIER_KEY: 'secretsClearFrontierKey',
  SECRETS_GET_ACTIVE_PROVIDER: 'secretsGetActiveProvider',
  SECRETS_SET_ACTIVE_PROVIDER: 'secretsSetActiveProvider',
  OLLAMA_STATUS: 'ollamaStatus',
  DIAGNOSTICS_ROUTING_LOG: 'diagnosticsRoutingLog',
  DIAGNOSTICS_STATUS: 'diagnosticsStatus',
  BACKUP_CREATE: 'backupCreate',
  BACKUP_RESTORE: 'backupRestore',
  GMAIL_CONNECT: 'gmailConnect',
  GMAIL_STATUS: 'gmailStatus',
  GMAIL_DISCONNECT: 'gmailDisconnect',
  GMAIL_FORCE_SYNC: 'gmailForceSync',
  CALENDAR_CONNECT: 'calendarConnect',
  CALENDAR_STATUS: 'calendarStatus',
  CALENDAR_DISCONNECT: 'calendarDisconnect',
  CALENDAR_FORCE_SYNC: 'calendarForceSync',
} as const;
