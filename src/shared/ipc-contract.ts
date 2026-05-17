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
  // Plan 02-03 News sources
  NEWS_LIST_SOURCES: 'aria:news:list-sources',
  NEWS_ADD_RSS: 'aria:news:add-rss',
  NEWS_REMOVE_SOURCE: 'aria:news:remove-source',
  NEWS_SET_BUNDLE: 'aria:news:set-bundle',
  // Plan 02-04 Briefing engine
  BRIEFING_TODAY: 'aria:briefing:today',
  BRIEFING_GENERATE_NOW: 'aria:briefing:generate-now',
  BRIEFING_DISMISS_NEWS_ITEM: 'aria:briefing:dismiss-news-item',
  BRIEFING_HISTORY: 'aria:briefing:history',
  BRIEFING_GET_SETTINGS: 'aria:briefing:get-settings',
  BRIEFING_SET_SETTINGS: 'aria:briefing:set-settings',
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

/**
 * Plan 02-03 — News source row shape persisted in the `news_source` table
 * (migration 004). One row per source the user wants the briefing engine to
 * consider. `kind` discriminates:
 *   - 'hn'     — Hacker News top-stories firehose; url/title/country/sector all null
 *   - 'rss'    — User-added RSS URL; url required, title optional
 *   - 'bundle' — Curated country/sector feed; country + sector + url all set
 *
 * `enabled` is reserved for future toggles; v1 always inserts 1 and the
 * renderer's Remove action DELETEs the row outright.
 */
export interface NewsSourceRow {
  id: number;
  kind: 'hn' | 'rss' | 'bundle';
  country: string | null;
  sector: string | null;
  url: string | null;
  title: string | null;
  enabled: 0 | 1;
  added_at: string;
}

/**
 * Plan 02-04 — Briefing payload returned by BRIEFING_TODAY.
 *
 * Sections are capped at top-3 by the LLM Zod schema. `errors[section]` carries
 * a per-section warning when that source failed (BRIEF-06 graceful degrade).
 *
 * `emailEmptyStateReason='no-important-label'` is the B4 SC2 fallback flag —
 * set ONLY when the account has unread mail in the last 24h but none flagged
 * IMPORTANT by Gmail. NOT an error; documented Phase-2 limitation (Phase 3's
 * sensitivity router replaces it).
 */
export interface BriefingItem {
  id: string;
  title: string;
  why: string;
}

export interface BriefingNewsItem extends BriefingItem {
  url: string;
  sourceKind: 'hn' | 'rss' | 'bundle';
  dismissed: boolean;
}

export interface BriefingPayload {
  date: string;
  generatedAt: string;
  tz: string;
  calendar: BriefingItem[];
  email: BriefingItem[];
  news: BriefingNewsItem[];
  errors: { calendar?: string; email?: string; news?: string };
  emailEmptyStateReason?: 'no-important-label';
  route: Route;
  reason: string;
  model: string;
}

export interface BriefingSummary {
  date: string;
  generatedAt: string;
  route: Route;
  ok: number;
}

export interface BriefingSettings {
  time: string; // 'HH:00' whole-hour
  tz: string;
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

  newsListSources(): Promise<{ sources: NewsSourceRow[] } | IpcError>;
  newsAddRss(req: { url: string; title?: string }): Promise<{ ok: true; id: number } | { ok: false; error: string } | IpcError>;
  newsRemoveSource(req: { id: number }): Promise<{ ok: boolean } | IpcError>;
  newsSetBundle(req: { country: string; sectors: string[] }): Promise<{ ok: boolean } | IpcError>;

  briefingToday(req?: { date?: string }): Promise<BriefingPayload | { error: string; lastOkDate?: string } | IpcError>;
  briefingGenerateNow(): Promise<{ ok: boolean; date?: string; error?: string } | IpcError>;
  briefingDismissNewsItem(req: { date: string; urlHash: string }): Promise<{ ok: true } | IpcError>;
  briefingHistory(req?: { limit?: number }): Promise<{ entries: BriefingSummary[] } | IpcError>;
  briefingGetSettings(): Promise<BriefingSettings | IpcError>;
  briefingSetSettings(req: BriefingSettings): Promise<{ ok: true } | IpcError>;
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
  NEWS_LIST_SOURCES: 'newsListSources',
  NEWS_ADD_RSS: 'newsAddRss',
  NEWS_REMOVE_SOURCE: 'newsRemoveSource',
  NEWS_SET_BUNDLE: 'newsSetBundle',
  BRIEFING_TODAY: 'briefingToday',
  BRIEFING_GENERATE_NOW: 'briefingGenerateNow',
  BRIEFING_DISMISS_NEWS_ITEM: 'briefingDismissNewsItem',
  BRIEFING_HISTORY: 'briefingHistory',
  BRIEFING_GET_SETTINGS: 'briefingGetSettings',
  BRIEFING_SET_SETTINGS: 'briefingSetSettings',
} as const;
