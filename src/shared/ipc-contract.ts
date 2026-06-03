/**
 * Single source-of-truth for the Aria IPC contract.
 *
 * Plans 02 / 03 / 04 import from this file ONLY — no string-literal IPC names
 * anywhere else. Channel constants are mirrored 1:1 by the preload bridge into
 * `window.aria` (camelCase method names).
 */
import type { VoiceState, TranscriptDelta, VoiceModelStatus } from './voice-types';

export const CHANNELS = {
  ASK_ARIA: 'aria:ask',
  ONBOARDING_GEN_MNEMONIC: 'aria:onboarding:gen-mnemonic',
  ONBOARDING_CONFIRM: 'aria:onboarding:confirm',
  ONBOARDING_SEAL: 'aria:onboarding:seal',
  ONBOARDING_UNLOCK: 'aria:onboarding:unlock',
  ONBOARDING_STATUS: 'aria:onboarding:status',
  ONBOARDING_LOCK: 'aria:onboarding:lock',
  SECRETS_SET_FRONTIER_KEY: 'aria:secrets:set',
  SECRETS_HAS_FRONTIER_KEY: 'aria:secrets:has',
  SECRETS_CLEAR_FRONTIER_KEY: 'aria:secrets:clear',
  SECRETS_GET_ACTIVE_PROVIDER: 'aria:secrets:get-provider',
  SECRETS_SET_ACTIVE_PROVIDER: 'aria:secrets:set-provider',
  OLLAMA_STATUS: 'aria:ollama:status',
  OLLAMA_GET_ACTIVE_MODEL: 'aria:ollama:get-active-model',
  OLLAMA_SET_ACTIVE_MODEL: 'aria:ollama:set-active-model',
  DIAGNOSTICS_ROUTING_LOG: 'aria:diagnostics:routing-log',
  DIAGNOSTICS_STATUS: 'aria:diagnostics:status',
  BACKUP_CREATE: 'aria:backup:create',
  BACKUP_RESTORE: 'aria:backup:restore',
  BACKUP_STATS: 'aria:backup:stats',
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
  CALENDAR_LIST_EVENTS_RANGE: 'aria:calendar:list-events-range',
  // Plan 05-01 Microsoft Outlook integration
  MICROSOFT_CONNECT: 'aria:microsoft:connect',
  MICROSOFT_STATUS: 'aria:microsoft:status',
  MICROSOFT_DISCONNECT: 'aria:microsoft:disconnect',
  MICROSOFT_FORCE_SYNC: 'aria:microsoft:force-sync',
  TODOIST_CONNECT_TOKEN: 'aria:todoist:connect-token',
  TODOIST_STATUS: 'aria:todoist:status',
  TODOIST_DISCONNECT: 'aria:todoist:disconnect',
  TODOIST_FORCE_SYNC: 'aria:todoist:force-sync',
  TODOIST_PUSH_APPROVED_ACTIONS: 'aria:todoist:push-approved-actions',
  TASKS_LIST: 'aria:tasks:list',
  PROVIDER_ACCOUNTS_LIST: 'aria:provider-accounts:list',
  PROVIDER_ACCOUNT_UPDATE: 'aria:provider-accounts:update',
  PROVIDER_ACCOUNT_DISCONNECT: 'aria:provider-accounts:disconnect',
  // Plan 02-03 News sources
  NEWS_LIST_SOURCES: 'aria:news:list-sources',
  NEWS_ADD_RSS: 'aria:news:add-rss',
  NEWS_REMOVE_SOURCE: 'aria:news:remove-source',
  NEWS_SET_BUNDLE: 'aria:news:set-bundle',
  // Plan 02-04 Briefing engine
  BRIEFING_TODAY: 'aria:briefing:today',
  BRIEFING_GENERATE_NOW: 'aria:briefing:generate-now',
  BRIEFING_REGENERATE_TODAY: 'aria:briefing:regenerate-today',
  BRIEFING_DISMISS_NEWS_ITEM: 'aria:briefing:dismiss-news-item',
  BRIEFING_HISTORY: 'aria:briefing:history',
  BRIEFING_GET_SETTINGS: 'aria:briefing:get-settings',
  BRIEFING_SET_SETTINGS: 'aria:briefing:set-settings',
  // Plan 03-01 Approval queue
  APPROVALS_LIST: 'aria:approvals:list',
  APPROVALS_APPROVE: 'aria:approvals:approve',
  APPROVALS_REJECT: 'aria:approvals:reject',
  APPROVALS_SNOOZE: 'aria:approvals:snooze',
  APPROVALS_BATCH_APPROVE: 'aria:approvals:batch-approve',
  APPROVALS_CANCEL_STUCK: 'aria:approvals:cancel-stuck',
  // Plan 03-02 sensitivity classifier + routing-log query
  CLASSIFY: 'aria:classify',
  ROUTING_LOG_QUERY: 'aria:routing-log:query',
  // Plan 03-03 email triage + on-demand thread summary
  TRIAGE_SUMMARIZE_THREAD: 'aria:triage:summarize-thread',
  TRIAGE_GET_FOR_MESSAGE: 'aria:triage:get-for-message',
  // Plan 03-04 drafting + Gmail send
  DRAFTING_REPLY_TO_MESSAGE: 'aria:drafting:reply-to-message',
  GMAIL_SEND_APPROVED: 'aria:gmail:send-approved',
  // Plan 04-02 scheduling rules CRUD
  SCHEDULING_RULES_GET: 'aria:scheduling:rules-get',
  SCHEDULING_RULES_SET: 'aria:scheduling:rules-set',
  // Plan 04-03 NL scheduling pipeline
  SCHEDULING_PROPOSE: 'aria:scheduling:propose',
  SCHEDULING_CONFIRM_TARGET: 'aria:scheduling:confirm-target',
  SCHEDULING_OVERRIDE: 'aria:scheduling:override',
  TRANSCRIPT_INGEST: 'aria:transcripts:ingest',
  TRANSCRIPT_GET_NOTE: 'aria:transcripts:get-note',
  TRANSCRIPT_LIST_NOTES: 'aria:transcripts:list-notes',
  TRANSCRIPT_LINK_EVENT: 'aria:transcripts:link-event',
  TRANSCRIPT_GET_REVIEW: 'aria:transcripts:get-review',
  // Plan 07-02 RAG index admin
  RAG_INDEX_STATUS: 'aria:rag:index-status',
  RAG_BACKFILL_STATUS: 'aria:rag:backfill-status',
  RAG_BACKFILL_START: 'aria:rag:backfill-start',
  RAG_BACKFILL_SKIP: 'aria:rag:backfill-skip',
  RAG_WIPE_ACCOUNT: 'aria:rag:wipe-account',
  // Plan 07-03 RAG Q&A surfaces
  RAG_ASK: 'aria:rag:ask',
  RAG_THREAD_LIST: 'aria:rag:thread-list',
  RAG_THREAD_GET: 'aria:rag:thread-get',
  RAG_THREAD_CREATE: 'aria:rag:thread-create',
  RAG_THREAD_DELETE: 'aria:rag:thread-delete',
  RAG_OPEN_SOURCE: 'aria:rag:open-source',
  RAG_ACCOUNT_CHUNK_COUNTS: 'aria:rag:account-chunk-counts',
  // Plan 08-01 Insights (Phase 8 Stream 1)
  INSIGHTS_LATEST: 'aria:insights:latest',
  INSIGHTS_RECOMPUTE: 'aria:insights:recompute',
  // Plan 08-02 Recap (Phase 8 Stream 2)
  RECAP_LIST: 'aria:recap:list',
  RECAP_GET: 'aria:recap:get',
  RECAP_REGENERATE: 'aria:recap:regenerate',
  RECAP_SAVE_EDITS: 'aria:recap:save-edits',
  RECAP_FINALIZE: 'aria:recap:finalize',
  RECAP_EXPORT_DOCX: 'aria:recap:export-docx',
  RECAP_EXPORT_PDF: 'aria:recap:export-pdf',
  RECAP_LIST_AUDIT: 'aria:recap:list-audit',
  // Plan 08-03 Learning (Phase 8 Stream 3)
  LEARN_GET_PREFS: 'aria:learn:get-prefs',
  LEARN_RESET_FIELD: 'aria:learn:reset-field',
  LEARN_RESET_ALL: 'aria:learn:reset-all',
  LEARN_LIST_SIGNALS: 'aria:learn:list-signals',
  BRIEFING_FEEDBACK: 'aria:briefing:feedback',
  BRIEFING_INSIGHT_DISMISS: 'aria:briefing:insight-dismiss',
  RAG_TURN_FEEDBACK: 'aria:rag:turn-feedback',
  // Plan 08-04 Task 5 — auto-updater
  UPDATER_CHECK: 'aria:updater:check',
  UPDATER_DOWNLOAD: 'aria:updater:download',
  UPDATER_RESTART: 'aria:updater:restart',
  UPDATER_CHANNEL: 'aria:updater:channel',
  // Plan 10-01/10-02 Knowledge Folders (8 channels; set-sensitivity added in 10-02)
  KNOWLEDGE_PICK_FOLDER: 'aria:knowledge:pick-folder',
  KNOWLEDGE_PRESCAN_FOLDER: 'aria:knowledge:prescan-folder',
  KNOWLEDGE_ADD_FOLDER: 'aria:knowledge:add-folder',
  KNOWLEDGE_LIST_FOLDERS: 'aria:knowledge:list-folders',
  KNOWLEDGE_REMOVE_FOLDER: 'aria:knowledge:remove-folder',
  KNOWLEDGE_FOLDER_STATS: 'aria:knowledge:folder-stats',
  KNOWLEDGE_REINDEX: 'aria:knowledge:reindex',
  KNOWLEDGE_SET_SENSITIVITY: 'aria:knowledge:set-sensitivity',
  // Plan 08.1-02 entitlement
  ENTITLEMENT_GET_STATE: 'aria:entitlement:get-state',
  ENTITLEMENT_ACTIVATE: 'aria:entitlement:activate',
  ENTITLEMENT_OPEN_CHECKOUT: 'aria:entitlement:open-checkout',
  ENTITLEMENT_OPEN_PORTAL: 'aria:entitlement:open-portal',
  ENTITLEMENT_REFRESH_NOW: 'aria:entitlement:refresh-now',
  ENTITLEMENT_STATE_CHANGED: 'aria:entitlement:state-changed', // event
  // Phase 11 Research
  RESEARCH_JOB_CREATE: 'aria:research:job-create',
  RESEARCH_JOB_LIST: 'aria:research:job-list',
  RESEARCH_JOB_GET: 'aria:research:job-get',
  RESEARCH_JOB_UPDATE: 'aria:research:job-update',
  RESEARCH_JOB_DELETE: 'aria:research:job-delete',
  RESEARCH_JOB_RUN: 'aria:research:job-run',
  RESEARCH_REPORT_GET: 'aria:research:report-get',
  RESEARCH_REPORT_LIST: 'aria:research:report-list',
  RESEARCH_FEEDBACK_SAVE: 'aria:research:feedback-save',
  RESEARCH_SUGGESTIONS_GET: 'aria:research:suggestions-get',
  RESEARCH_SUGGESTION_APPROVE: 'aria:research:suggestion-approve',
  RESEARCH_SUGGESTION_DISMISS: 'aria:research:suggestion-dismiss',
  // Push event (ipcRenderer.on):
  RESEARCH_REPORT_DONE: 'aria:research:report-done',
  // Research secrets
  RESEARCH_SECRETS_SET: 'aria:research:secrets-set',
  RESEARCH_SECRETS_HAS: 'aria:research:secrets-has',
  // Phase 12 Background activity (12-01)
  BG_GET_PREFS: 'aria:background:get-prefs',
  BG_SET_PREFS: 'aria:background:set-prefs',
  // Quick 260523-eaf — user profile (display name shown on UnlockScreen).
  // Stored in plaintext `profile.json` sibling to vault.json; readable pre-unlock.
  PROFILE_GET: 'aria:profile:get',
  PROFILE_SET: 'aria:profile:set',
  // Phase 12 / Plan 12-03 — renderer navigation push (owned by 12-03).
  // Main process sends this channel via webContents.send to route the renderer
  // to an allowlisted path (/briefing, /approvals). T-12-10: path is hardcoded
  // at the call site (no user-controlled value in the payload).
  NAVIGATE: 'aria:navigate',
  // Phase 15 — Voice I/O + Model Runtime (15-01)
  // Invoke channels (renderer → main):
  VOICE_FEED_AUDIO: 'aria:voice:feed-audio',        // PCM ArrayBuffer (D-19 transferable)
  VOICE_GET_MODEL_STATUS: 'aria:voice:model-status', // returns VoiceModelStatus
  VOICE_DOWNLOAD_MODEL: 'aria:voice:download-model', // trigger first-run download
  VOICE_CANCEL_TTS: 'aria:voice:cancel-tts',         // half-duplex gate: cancel in-flight TTS
  // Push channels (main → renderer via ipcRenderer.on):
  VOICE_TRANSCRIPT_DELTA: 'aria:voice:transcript-delta', // TranscriptDelta payload
  VOICE_STATE_CHANGED: 'aria:voice:state-changed',        // VoiceState payload
  VOICE_MODEL_PROGRESS: 'aria:voice:model-progress',      // { receivedBytes, totalBytes }
} as const;

// Plan 07-02 RAG DTOs --------------------------------------------------------

export interface RagIndexStatusDto {
  vectorBackend: 'sqlite-vec' | 'fallback';
  activeModelId: string;
  activeModelDim: number;
  rebuildInProgress: boolean;
  rebuildTargetModelId: string | null;
  rebuildProgressDone: number;
  rebuildProgressTotal: number;
  aliveChunkCount: number;
  dirtyChunkCount: number;
  perMinute: number;
  lastErrorKind?: string;
  lastErrorMessage?: string;
}

export interface RagBackfillStatusDto {
  state: 'pending' | 'in_progress' | 'done' | 'skipped';
  enqueuedBySourceKind: { email: number; event: number; note: number; action: number };
  dirtyRemaining: number;
  etaSecondsRemaining: number;
}

// Plan 03-03 triage DTOs ----------------------------------------------------

export type TriagePriority = 'urgent' | 'needs-you' | 'fyi' | 'archive';

export type TriageSignal =
  | 'from-vip'
  | 'thread-active'
  | 'deadline-mentioned'
  | 'money-amount'
  | 'awaiting-reply'
  | 'mention'
  | 'question-asked'
  | 'newsletter'
  | 'automated'
  | 'reply-needed'
  | 'attachment'
  | 'direct-to-me';

export interface TriageResultDto {
  priority: TriagePriority;
  signals: TriageSignal[];
  summary: string;
  classifier_version: string;
}

export interface ThreadSummaryDto {
  summary: string;
  decisions: string[];
  open_questions: string[];
  participants: string[];
}

export interface SummarizeThreadRequest {
  threadId: string;
}

export interface GetTriageForMessageRequest {
  messageId: string;
}

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

/**
 * Provenance for the active local-model id:
 *   - 'persisted'   — user picked this in Settings and we stored it.
 *   - 'auto-picked' — bootstrap saw a null persisted value and chose tags[0].
 *   - 'default'     — nothing persisted; falling back to DEFAULT_LOCAL_MODEL
 *                     (likely will 404 against Ollama if user pulled something
 *                     else — drives the Settings dropdown nudge).
 */
export type OllamaModelSource = 'persisted' | 'default' | 'auto-picked';

export interface OllamaActiveModel {
  modelId: string | null;
  source: OllamaModelSource;
}

export type OllamaSetActiveModelResult =
  | { ok: true; modelId: string }
  | { ok: false; error: string };

export interface DiagnosticsStatus {
  ollama: OllamaStatus;
  frontierConfigured: boolean;
  activeProvider: ProviderId | null;
  mode: 'LOCAL_ONLY' | 'HYBRID' | 'FRONTIER_ONLY' | 'NONE';
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
  /** Plan 03-04 — set true when a recent Gmail send was rejected with an
   *  unverified-app error (RESEARCH §Pitfall 9). Clears on the first
   *  successful send. The IntegrationsSection surfaces a persistent banner
   *  while this is true. */
  verificationPending?: boolean;
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
  /**
   * Plan 04-01 — true when the user previously connected Calendar under the
   * Phase 2 readonly-only scope set and has NOT yet granted the new
   * calendar.events write scope. Renderer shows a re-consent banner.
   */
  writeScopeMissing?: boolean;
}

/**
 * Plan 05-01 â€” Microsoft Outlook integration status payload.
 *
 * Mirrors Gmail/Calendar status so the renderer can reuse the same row
 * component shape. `status` and `tokenStatus` are intentionally separate:
 * `status` reflects the persisted provider_account row while `tokenStatus`
 * reflects the cached token/access state.
 */
export interface MicrosoftIntegrationStatus {
  connected: boolean;
  email?: string;
  displayName?: string;
  lastSyncedAt?: string;
  lastError?: string;
  tokenStatus: 'ok' | 'missing' | 'expired' | 'revoked';
  queueDepth: number;
}

export interface TodoistIntegrationStatus {
  connected: boolean;
  lastSyncedAt?: string;
  lastError?: string;
  tokenStatus: 'ok' | 'missing' | 'expired' | 'revoked';
  queueDepth: number;
}

export interface ProviderAccountDto {
  providerKey: 'google' | 'microsoft' | 'todoist';
  accountId: string;
  displayEmail: string;
  displayLabel?: string | null;
  displayColor?: string | null;
  status: 'ok' | 'degraded' | 'needs-auth' | 'disconnected';
  capabilitiesJson?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface TaskRowDto {
  id: string;
  remoteId: string | null;
  content: string;
  description: string | null;
  projectName: string | null;
  labels: string[];
  dueIso: string | null;
  priority: number;
  isCompleted: boolean;
  source: 'todoist' | 'aria';
  noteId: string | null;
  meetingActionId: string | null;
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
  provider_key?: 'google' | 'microsoft' | null;
  account_id?: string | null;
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
  openActions?: BriefingItem[];
  errors: { calendar?: string; email?: string; news?: string };
  emailEmptyStateReason?: 'no-important-label';
  route: Route;
  reason: string;
  model: string;
  /**
   * Plan 08-01 — "This week" insights section. Populated by the BRIEFING_TODAY
   * read path (NOT by runBriefing). One of:
   *   - { state: 'unlocked', rows: [...] } — up to 3 insight rows for current week
   *   - { state: 'locked', daysRemaining, blockedKinds } — 14d gate not yet met
   *   - undefined — empty-unlocked (between cron fires; section omitted)
   */
  thisWeekInsights?:
    | { state: 'unlocked'; rows: BriefingInsightRow[] }
    | { state: 'locked'; daysRemaining: number; blockedKinds: InsightKindDto[] };
}

/** Renderer-facing minimal shape for the "This week" cards. */
export interface BriefingInsightRow {
  id: number;
  kind: InsightKindDto;
  sentences: string[];
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
 * Plan 03-01 — Approval queue row payload exposed to the renderer.
 *
 * Mirrors `ApprovalRow` from `src/main/approvals/persist.ts` exactly. The
 * renderer never imports from `src/main`; this shape is the contract.
 */
export type ApprovalUiState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected'
  | 'snoozed'
  | 'interrupted'
  | 'sent'
  | 'sending'
  | 'failed'
  | 'needs-operator-decision';

export interface ApprovalRowDto {
  id: string;
  kind: 'email_send' | 'calendar_change' | 'task_batch';
  state: ApprovalUiState;
  created_at: string;
  updated_at: string;
  approval_path: 'explicit' | 'silent';
  source_message_id: string | null;
  recipients_json: string | null;
  subject: string | null;
  body_original: string | null;
  body_edited: string | null;
  classifier_version: string | null;
  categories_json: string | null;
  severity: 'low' | 'med' | 'high' | null;
  confidence: number | null;
  classifier_rationale: string | null;
  routed: 'local' | 'frontier' | 'hybrid' | null;
  triage_signals_json: string | null;
  triage_summary: string | null;
  rejection_reason: string | null;
  snooze_until: string | null;
  sent_at: string | null;
  send_log_id: number | null;
  /** Plan 03-04 migration 009 — set to 1 only when the Task 2 checkpoint
   *  selected `few-shot-beta`; default 0 under the locked Task 2 decision
   *  (`few-shot-production`). When 1, the ApprovalCard renders a beta badge. */
  beta_voice: 0 | 1;
  // Plan 04-01 / 04-03 — calendar_change payload (NULL when kind='email_send').
  calendar_event_id?: string | null;
  calendar_action?: 'move' | 'create' | 'find-time' | null;
  recurring_scope?: 'this' | 'future' | 'all' | null;
  before_json?: string | null;
  after_json?: string | null;
  conflicts_json?: string | null;
  alternatives_json?: string | null;
  rule_overrides_json?: string | null;
  provider_key?: 'google' | 'microsoft' | null;
  account_id?: string | null;
  idempotency_key?: string | null;
  last_error_message?: string | null;
  meeting_note_id?: string | null;
}

export interface CalendarEventDto {
  id: string;
  calendarId: string;
  summary: string;
  location: string | null;
  startAtUtc: string | null;
  endAtUtc: string | null;
  startDate: string | null;
  endDate: string | null;
  startTimezone: string | null;
  status: string;
  recurringId: string | null;
  recurrenceJson?: string | null;
  recurrenceUnsupported: boolean;
  webLink?: string | null;
  providerKey: 'google' | 'microsoft';
  accountId: string;
  accountDisplayEmail: string;
  accountDisplayLabel?: string | null;
  accountDisplayColor?: string | null;
}

export type TranscriptSourceKind = 'paste' | 'txt' | 'vtt' | 'srt' | 'json';

export interface TranscriptSegmentDto {
  start: number;
  end: number;
  speaker?: string | null;
  timestampSec?: number | null;
}

export interface TranscriptNoteDto {
  id: string;
  sourceKind: TranscriptSourceKind;
  title: string;
  normalizedText: string;
  ingestedAt: string;
  eventProviderKey: 'google' | 'microsoft' | null;
  eventAccountId: string | null;
  calendarEventId: string | null;
  linkConfidence: number | null;
  status: 'captured' | 'linked' | 'standalone';
  segments: TranscriptSegmentDto[];
}

export interface TranscriptLinkCandidateDto {
  providerKey: 'google' | 'microsoft';
  accountId: string;
  calendarEventId: string;
  summary: string;
  startUtc: string | null;
  score: number;
}

export interface MeetingActionDto {
  id: string;
  noteId: string;
  approvalId: string | null;
  text: string;
  owner: 'self' | 'follow-up' | 'unassigned';
  followUpWith?: string | null;
  dueIso?: string | null;
  dueRaw?: string | null;
  dueConfidence?: 'high' | 'med' | 'low' | null;
  priorityHint?: 'p1' | 'p2' | 'p3' | 'p4' | null;
  citationStart: number;
  citationEnd: number;
  confidence: number;
  status: 'draft' | 'approved' | 'rejected' | 'pushed' | 'failed';
  pushable: 0 | 1;
}

export interface MeetingSummaryItemDto {
  id: string;
  kind: 'topic' | 'decision' | 'follow_up' | 'open_question';
  text: string;
  citationStart: number;
  citationEnd: number;
  ordinal: number;
}

// Plan 04-03 — scheduling propose DTOs ------------------------------------

export interface ProposeConflictDto {
  type: 'busy' | 'focus-block' | 'buffer' | 'no-meeting-window' | 'outside-working-hours';
  severity: 'hard' | 'soft';
  windowStartUtc: string;
  windowEndUtc: string;
  label?: string;
}
export interface ProposeAlternativeDto {
  startUtc: string;
  endUtc: string;
  score: number;
  primeTimeMatched: boolean;
  bufferPenalty: number;
}
export interface ProposeResultDto {
  approvalId: string;
  primaryFeasible: boolean;
  conflicts: ProposeConflictDto[];
  alternatives: ProposeAlternativeDto[];
  warnings: string[];
}
export interface ProposeClarificationDto {
  needsClarification: true;
  candidates: Array<{ eventId: string; summary: string; startUtc: string }>;
}
export interface ProposeRefusalDto {
  refused: true;
  code: 'cancel-not-in-v1' | 'multi-attendee' | 'no-match' | 'parse-failed';
  message: string;
}
export type ProposeResponse =
  | ProposeResultDto
  | ProposeClarificationDto
  | ProposeRefusalDto
  | IpcError;

export interface SchedulingProposeRequest {
  nl: string;
}
export interface SchedulingConfirmTargetRequest {
  nl: string;
  eventId: string;
}
export interface SchedulingOverrideRequest {
  approvalId: string;
  reason: string;
}

// Plan 03-04 — drafting + send DTOs ----------------------------------------

export interface DraftReplyRequest {
  messageId: string;
}
export interface DraftReplyResponse {
  approvalId: string;
}

export interface SendApprovedRequest {
  approvalId: string;
}
export interface SendApprovedResult {
  ok: true;
  providerMsgId: string;
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
  onboardingLock(): Promise<{ ok: boolean } | IpcError>;

  secretsSetFrontierKey(req: { provider: ProviderId; key: string }): Promise<{ ok: boolean } | IpcError>;
  secretsHasFrontierKey(req: { provider: ProviderId }): Promise<{ present: boolean } | IpcError>;
  secretsClearFrontierKey(req: { provider: ProviderId }): Promise<{ ok: boolean } | IpcError>;
  secretsGetActiveProvider(): Promise<{ provider: ProviderId | null } | IpcError>;
  secretsSetActiveProvider(req: { provider: ProviderId }): Promise<{ ok: boolean } | IpcError>;

  ollamaStatus(): Promise<OllamaStatus | IpcError>;
  ollamaGetActiveModel(): Promise<OllamaActiveModel | IpcError>;
  ollamaSetActiveModel(req: { modelId: string }): Promise<OllamaSetActiveModelResult | IpcError>;

  diagnosticsRoutingLog(req?: { limit?: number }): Promise<RoutingLogEntry[] | IpcError>;
  diagnosticsStatus(): Promise<DiagnosticsStatus | IpcError>;

  backupCreate(req?: { destination?: string }): Promise<{ path: string } | IpcError>;
  backupRestore(req: { source: string; passphrase: string }): Promise<{ ok: boolean } | IpcError>;
  backupStats(): Promise<{ dbSizeBytes: number; lastBackupName: string | null; lastBackupAt: string | null; schemaVersion: number | null }>;

  gmailConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string } | IpcError>;
  gmailStatus(): Promise<GmailIntegrationStatus | IpcError>;
  gmailDisconnect(): Promise<{ ok: boolean } | IpcError>;
  gmailForceSync(): Promise<{ ok: boolean; error?: string } | IpcError>;

  calendarConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string } | IpcError>;
  calendarStatus(): Promise<CalendarIntegrationStatus | IpcError>;
  calendarDisconnect(): Promise<{ ok: boolean } | IpcError>;
  calendarForceSync(): Promise<{ ok: boolean; error?: string } | IpcError>;
  calendarListEventsRange(req: {
    startUtc: string;
    endUtc: string;
    accountIds?: string[];
  }): Promise<{ rows: CalendarEventDto[] } | IpcError>;

  microsoftConnect(): Promise<{ ok: true; email: string; displayName: string } | { ok: false; error: string } | IpcError>;
  microsoftStatus(): Promise<MicrosoftIntegrationStatus | IpcError>;
  microsoftDisconnect(): Promise<{ ok: boolean } | IpcError>;
  microsoftForceSync(): Promise<{ ok: boolean; error?: string } | IpcError>;
  providerAccountsList(): Promise<{ rows: ProviderAccountDto[] } | IpcError>;
  providerAccountUpdate(req: {
    providerKey: 'google' | 'microsoft' | 'todoist';
    accountId: string;
    displayLabel?: string | null;
    displayColor?: string | null;
  }): Promise<{ ok: true } | IpcError>;
  providerAccountDisconnect(req: {
    providerKey: 'google' | 'microsoft' | 'todoist';
    accountId: string;
  }): Promise<{ ok: true } | IpcError>;

  todoistConnectToken(req: { token: string }): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;
  todoistStatus(): Promise<TodoistIntegrationStatus | IpcError>;
  todoistDisconnect(): Promise<{ ok: true } | IpcError>;
  todoistForceSync(): Promise<{ ok: boolean; count?: number; error?: string } | IpcError>;
  todoistPushApprovedActions(req: { approvalId: string }): Promise<{ ok: true; pushed: number; skipped: number } | IpcError>;
  tasksList(req?: { source?: 'todoist' | 'aria' | 'all'; completed?: boolean }): Promise<{ rows: TaskRowDto[] } | IpcError>;

  newsListSources(): Promise<{ sources: NewsSourceRow[] } | IpcError>;
  newsAddRss(req: { url: string; title?: string }): Promise<{ ok: true; id: number } | { ok: false; error: string } | IpcError>;
  newsRemoveSource(req: { id: number }): Promise<{ ok: boolean } | IpcError>;
  newsSetBundle(req: { country: string; sectors: string[] }): Promise<{ ok: boolean } | IpcError>;

  briefingToday(req?: { date?: string }): Promise<BriefingPayload | { error: string; lastOkDate?: string } | IpcError>;
  briefingGenerateNow(): Promise<{ ok: boolean; date?: string; error?: string } | IpcError>;
  briefingRegenerateToday(): Promise<BriefingPayload | { ok: false; error: string } | IpcError>;
  briefingDismissNewsItem(req: { date: string; urlHash: string }): Promise<{ ok: true } | IpcError>;
  briefingHistory(req?: { limit?: number }): Promise<{ entries: BriefingSummary[] } | IpcError>;
  briefingGetSettings(): Promise<BriefingSettings | IpcError>;
  briefingSetSettings(req: BriefingSettings): Promise<{ ok: true } | IpcError>;

  approvalsList(req?: {
    states?: ApprovalUiState[];
    limit?: number;
  }): Promise<{ rows: ApprovalRowDto[] } | IpcError>;
  approvalsApprove(req: {
    id: string;
    edited?: { body?: string; subject?: string };
  }): Promise<{ ok: true } | IpcError>;
  approvalsReject(req: { id: string; reason?: string }): Promise<{ ok: true } | IpcError>;
  approvalsSnooze(req: { id: string; until: string }): Promise<{ ok: true } | IpcError>;
  approvalsBatchApprove(req: {
    ids: string[];
  }): Promise<{ ok: true; count: number } | IpcError>;
  approvalsCancelStuck(req: { id: string }): Promise<{ ok: true } | IpcError>;

  // Plan 03-02
  classify(req: { text: string; approvalId?: string }): Promise<SensitivityResultDto | IpcError>;
  routingLogQuery(req?: {
    from?: string;
    to?: string;
    route?: Route;
    source?: string;
    category?: string;
    limit?: number;
  }): Promise<{ rows: RoutingLogClassifiedRow[] } | IpcError>;

  // Plan 03-03
  triageSummarizeThread(
    req: SummarizeThreadRequest,
  ): Promise<ThreadSummaryDto | IpcError>;
  triageGetForMessage(
    req: GetTriageForMessageRequest,
  ): Promise<TriageResultDto | null | IpcError>;

  // Plan 03-04
  draftingReplyToMessage(
    req: DraftReplyRequest,
  ): Promise<DraftReplyResponse | IpcError>;
  gmailSendApproved(
    req: SendApprovedRequest,
  ): Promise<SendApprovedResult | IpcError>;

  // Plan 04-02
  schedulingRulesGet(): Promise<SchedulingRulesGetResponse | IpcError>;
  schedulingRulesSet(
    req: SchedulingRulesSetRequest,
  ): Promise<SchedulingRulesSetResponse | IpcError>;

  // Plan 04-03
  schedulingPropose(req: SchedulingProposeRequest): Promise<ProposeResponse>;
  schedulingConfirmTarget(req: SchedulingConfirmTargetRequest): Promise<ProposeResponse>;
  schedulingOverride(req: SchedulingOverrideRequest): Promise<{ ok: true } | IpcError>;

  transcriptIngest(req: {
    sourceKind: TranscriptSourceKind;
    text: string;
    title?: string;
  }): Promise<{
    noteId: string;
    linkedEvent: TranscriptLinkCandidateDto | null;
    candidates: TranscriptLinkCandidateDto[];
    taskBatchApprovalId?: string | null;
    actionCount?: number;
  } | IpcError>;
  transcriptGetNote(req: { noteId: string }): Promise<{ note: TranscriptNoteDto | null } | IpcError>;
  transcriptListNotes(): Promise<{ rows: Array<Omit<TranscriptNoteDto, 'normalizedText' | 'segments'>> } | IpcError>;
  transcriptLinkEvent(req: {
    noteId: string;
    providerKey: 'google' | 'microsoft';
    accountId: string;
    calendarEventId: string;
  }): Promise<{ ok: true } | IpcError>;
  transcriptGetReview(req: { noteId: string }): Promise<{
    note: TranscriptNoteDto | null;
    summaryItems: MeetingSummaryItemDto[];
    actions: MeetingActionDto[];
  } | IpcError>;

  // Plan 07-02 RAG admin
  ragIndexStatus(): Promise<RagIndexStatusDto | IpcError>;
  ragBackfillStatus(): Promise<RagBackfillStatusDto | IpcError>;
  ragBackfillStart(): Promise<{ enqueuedBySourceKind: { email: number; event: number; note: number; action: number } } | IpcError>;
  ragBackfillSkip(): Promise<{ ok: boolean } | IpcError>;
  ragWipeAccount(req: { providerKey: string; accountId: string }): Promise<{ deletedChunks: number } | IpcError>;

  // Plan 07-03 RAG Q&A
  ragAsk(req: RagAskRequest): Promise<RagAskResponse | IpcError>;
  ragThreadList(req?: { limit?: number; search?: string }): Promise<{ threads: RagThreadDto[] } | IpcError>;
  ragThreadGet(req: { threadId: string; lastN?: number }): Promise<{ thread: RagThreadDto; turns: RagTurnDto[] } | null | IpcError>;
  ragThreadCreate(req?: {
    title?: string;
    seedTurns?: Array<{ role: 'user' | 'assistant'; text: string; citations?: unknown; routing?: unknown }>;
  }): Promise<{ thread: RagThreadDto } | IpcError>;
  ragThreadDelete(req: { threadId: string }): Promise<{ ok: true } | IpcError>;
  ragOpenSource(req: {
    sourceKind: 'email' | 'event' | 'note' | 'action';
    sourceId: string;
    charStart: number;
    charEnd: number;
  }): Promise<{ ok: true } | IpcError>;
  ragAccountChunkCounts(): Promise<{ rows: Array<{ providerKey: string; accountId: string; count: number }> } | IpcError>;

  // Plan 08-01 Insights
  insightsLatest(): Promise<InsightsLatestResult | IpcError>;
  insightsRecompute(): Promise<{ ok: true; written: number; skipped: string[] } | { ok: false; error: string } | IpcError>;

  // Plan 08-02 Recap
  recapList(req?: { limit?: number }): Promise<{ rows: RecapRowDto[] } | IpcError>;
  recapGet(req: { isoWeek: string }): Promise<{ recap: RecapRowDto | null } | IpcError>;
  recapRegenerate(req: { isoWeek: string; weekStartYmd: string }): Promise<
    { ok: true; recap: RecapRowDto | null; hallucinationDetected: boolean } | { ok: false; error: string } | IpcError
  >;
  recapSaveEdits(req: { canonical: unknown }): Promise<{ ok: true; recap: RecapRowDto | null } | IpcError>;
  recapFinalize(req: {
    isoWeek: string;
    sectionEdits: Array<{ sectionKey: string; beforeText: string; afterText: string; category?: string | null }>;
  }): Promise<{ ok: true; recapId: number; editsWritten: number } | IpcError>;
  recapExportDocx(req: { isoWeek: string }): Promise<{ ok: true; path: string } | IpcError>;
  recapExportPdf(req: { isoWeek: string }): Promise<{ ok: true; path: string } | IpcError>;
  recapListAudit(req?: { fromIso?: string; toIso?: string; limit?: number }): Promise<{ rows: RecapActionAuditRowDto[] } | IpcError>;

  // Plan 08-03 Learning
  learnGetPrefs(): Promise<{ preferences: LearnedPreferencesDto; signalsCount: number; lastUpdatedAt: string | null } | IpcError>;
  learnResetField(req: { fieldPath: string }): Promise<{ ok: true } | IpcError>;
  learnResetAll(): Promise<{ ok: true } | IpcError>;
  learnListSignals(req?: {
    limit?: number;
    offset?: number;
    source?: 'approval' | 'briefing' | 'recap' | 'qa';
  }): Promise<{ rows: LearningSignalDto[] } | IpcError>;
  briefingFeedback(req: {
    briefingDate: string;
    sectionKey: string;
    thumb: -1 | 0 | 1;
  }): Promise<{ ok: true } | IpcError>;
  briefingInsightDismiss(req: { briefingDate: string; kind: string }): Promise<{ ok: true } | IpcError>;
  ragTurnFeedback(req: { turnId: string; thumb: -1 | 0 | 1 }): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;

  // Plan 10-01 Knowledge Folders
  knowledgePickFolder(): Promise<{ path: string } | { canceled: true } | IpcError>;
  knowledgePrescanFolder(req: { path: string }): Promise<{ fileCount: number; totalBytes: number; exceedsThreshold: boolean } | IpcError>;
  knowledgeAddFolder(req: { path: string; label: string; sensitivity: 'general' | 'sensitive' }): Promise<{ folderId: string } | IpcError>;
  knowledgeListFolders(): Promise<{ folders: KnowledgeFolderDto[] } | IpcError>;
  knowledgeRemoveFolder(req: { folderId: string }): Promise<{ ok: true } | IpcError>;
  knowledgeFolderStats(req: { folderId: string }): Promise<KnowledgeFolderStatsDto | IpcError>;
  knowledgeReindex(req: { folderId: string }): Promise<{ ok: true } | IpcError>;
  knowledgeSetSensitivity(req: { folderId: string; sensitivity: 'general' | 'sensitive' }): Promise<{ ok: true; folderUpdated: number; chunksUpdated: number } | IpcError>;

  // Plan 08-04 Task 5 — auto-updater
  updaterCheck(): Promise<{ ok: true; info: unknown | null; channel: string | null } | { error: string } | IpcError>;
  updaterDownload(): Promise<{ ok: true } | { error: string } | IpcError>;
  updaterRestart(): Promise<{ ok: true } | { error: string } | IpcError>;
  updaterChannel(): Promise<{ channel: string } | IpcError>;

  // Plan 08.1-02 — entitlement / paywall
  entitlementGetState(): Promise<{ ok: true; state: unknown } | { ok: false; error: string } | IpcError>;
  entitlementActivate(req: { license_key: string }): Promise<
    | { ok: true; state: unknown }
    | { ok: false; error: { code: string; message?: string } }
    | IpcError
  >;
  entitlementOpenCheckout(): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;
  entitlementOpenPortal(): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;
  entitlementRefreshNow(): Promise<{ ok: true; state: unknown } | { ok: false; error: string } | IpcError>;
  /**
   * Renderer-side subscription helper — registered in preload as a true
   * `ipcRenderer.on` listener rather than `invoke`. The build-time auto-mapper
   * still wires this name; preload patches it to register a listener.
   */
  entitlementOnStateChanged(): Promise<{ ok: true } | IpcError>;

  // Phase 11 Research
  researchJobCreate(req: unknown): Promise<{ job: ResearchJobDto } | IpcError>;
  researchJobList(req: unknown): Promise<{ jobs: ResearchJobDto[] } | IpcError>;
  researchJobGet(req: { id: string }): Promise<{ job: ResearchJobDto | null } | IpcError>;
  researchJobUpdate(req: unknown): Promise<{ ok: true } | IpcError>;
  researchJobDelete(req: { id: string }): Promise<{ ok: true } | IpcError>;
  researchJobRun(req: { jobId: string; feedbackContext?: string }): Promise<{ ok: true; reportId: string } | IpcError>;
  researchReportGet(req: { reportId: string }): Promise<{ report: ResearchReportDto | null } | IpcError>;
  researchReportList(req: { jobId: string }): Promise<{ reports: ResearchReportDto[] } | IpcError>;
  researchFeedbackSave(req: { reportId: string; sectionId: string | null; thumb: 1 | -1 | null; note: string | null }): Promise<{ ok: true } | IpcError>;
  researchSuggestionsGet(req: unknown): Promise<{ jobs: ResearchJobDto[] } | IpcError>;
  researchSuggestionApprove(req: { jobId: string }): Promise<{ ok: true } | IpcError>;
  researchSuggestionDismiss(req: { jobId: string }): Promise<{ ok: true } | IpcError>;
  /** Push event — registered via ipcRenderer.on, not invoke. */
  researchReportDone(): Promise<{ ok: true } | IpcError>;
  researchSecretsSet(req: { provider: 'brave' | 'exa'; key: string }): Promise<{ ok: true } | IpcError>;
  researchSecretsHas(req: unknown): Promise<{ hasBrave: boolean; hasExa: boolean } | IpcError>;

  // Phase 12 Background activity (12-01)
  backgroundGetPrefs(): Promise<BackgroundPrefsDto | IpcError>;
  backgroundSetPrefs(req: BackgroundPrefsPatchDto): Promise<BackgroundPrefsDto | IpcError>;

  // Quick 260523-eaf — user profile (UnlockScreen personalization).
  profileGet(): Promise<{ displayName: string | null } | IpcError>;
  profileSet(req: { displayName: string }): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;

  /** Subscription helper — wraps ipcRenderer.on for RESEARCH_REPORT_DONE. */
  onResearchReportDone?: (cb: (payload: { jobId: string; reportId: string }) => void) => () => void;

  /**
   * Phase 12 / Plan 12-03 — renderer-side navigate subscription.
   * Main process sends aria:navigate with an allowlisted path string.
   * Renderer subscribes via this helper and routes programmatically.
   * Returns an unsubscribe function. Allowlist enforced in App.tsx.
   */
  onNavigate?: (cb: (path: string) => void) => () => void;

  // Phase 15 / Plan 15-01 — Voice I/O + Model Runtime
  // Invoke methods (auto-mapped by the buildApi() loop via CHANNEL_METHODS):
  voiceFeedAudio(audioBuffer: ArrayBuffer): Promise<{ ok: true } | IpcError>;
  voiceGetModelStatus(): Promise<VoiceModelStatus | IpcError>;
  voiceDownloadModel(): Promise<{ ok: true } | { ok: false; error: string } | IpcError>;
  voiceCancelTts(): Promise<{ ok: true } | IpcError>;

  /**
   * Subscription helpers for push channels (ipcRenderer.on, not invoke).
   * Registered in preload as real listeners; each returns an unsubscribe fn.
   */
  onVoiceTranscript?: (cb: (delta: TranscriptDelta) => void) => () => void;
  onVoiceState?: (cb: (state: VoiceState) => void) => () => void;
  onVoiceModelProgress?: (cb: (progress: { receivedBytes: number; totalBytes: number }) => void) => () => void;
}

// Plan 08-03 Learning DTOs --------------------------------------------------

export interface LearnedPreferencesDto {
  voice: { terseness: number; formality: number };
  briefing: { sectionOrder: string[] };
  scheduling: { preferredMeetingLength: number };
  triage: { vipDomains: string[] };
}

export interface LearningSignalDto {
  id: number;
  source: 'approval' | 'briefing' | 'recap' | 'qa';
  kind: string;
  payload: unknown;
  occurredAt: string;
}

// Plan 08-02 Recap DTOs -----------------------------------------------------

export type RecapKindDto = 'email_send' | 'calendar_change' | 'task_pushed' | 'approval_declined';

export interface RecapActionAuditRowDto {
  kind: RecapKindDto;
  /** Stable id `${kind}:${row_id}`. */
  id: string;
  occurredAt: string;
  provider: string | null;
  resource: string;
  approvalId: string | null;
  payload: unknown;
  outcome: string;
}

/** Mirrors RecapCanonical (zod-validated). Renderer treats it as opaque JSON. */
export type RecapCanonicalDto = {
  isoWeek: string;
  weekStartYmd: string;
  meetings: { heading: string; blocks: Array<{ kind: string; text?: string; items?: string[] }> };
  actions: { heading: string; blocks: Array<{ kind: string; text?: string; items?: string[] }> };
  wins: { heading: string; blocks: Array<{ kind: string; text?: string; items?: string[] }> };
  upcoming: { heading: string; blocks: Array<{ kind: string; text?: string; items?: string[] }> };
  whatAriaDid: {
    heading: string;
    narrative: string;
    auditRowRefs: string[];
    blocks: Array<{ kind: string; text?: string; items?: string[] }>;
  };
};

export interface RecapRowDto {
  id: number;
  isoWeek: string;
  weekStartYmd: string;
  generatedAt: string;
  finalizedAt: string | null;
  canonical: RecapCanonicalDto;
}

// Plan 08-01 Insights DTOs --------------------------------------------------

export type InsightKindDto =
  | 'calendar_load'
  | 'response_time'
  | 'recurring_themes'
  | 'approval_edits';

export interface InsightRowDto {
  id: number;
  kind: InsightKindDto;
  weekYmd: string;
  computedAt: string;
  /** Parsed payload_json — shape depends on `kind`. */
  payload: unknown;
  /** Convenience: top sentences from payload.sentences, capped at 3. */
  sentences: string[];
  dismissed: boolean;
}

export interface InsightsUnlockedResult {
  state: 'unlocked';
  weekYmd: string;
  rows: InsightRowDto[];
}

export interface InsightsLockedResult {
  state: 'locked';
  daysRemaining: number;
  blockedKinds: InsightKindDto[];
}

export interface InsightsEmptyResult {
  state: 'empty-unlocked';
  weekYmd: string;
}

export type InsightsLatestResult =
  | InsightsUnlockedResult
  | InsightsLockedResult
  | InsightsEmptyResult;

// Plan 07-03 RAG Q&A DTOs ---------------------------------------------------

export interface RagCitationDto {
  index: number;
  sourceKind: 'email' | 'event' | 'note' | 'action';
  sourceId: string;
  title: string;
  snippet: string;
  charStart: number;
  charEnd: number;
  occurredAt?: string;
  accountChip?: {
    provider: 'google' | 'microsoft';
    email: string;
    disconnected?: boolean;
  };
}

export interface RagRoutingDto {
  route: Route;
  modelId: string;
  sensitivity: string;
  reason: string;
  directoryStale?: boolean;
}

export interface RagAnswerResultDto {
  kind: 'answer';
  text: string;
  citations: RagCitationDto[];
  routing: RagRoutingDto;
  threadId: string;
  turnId: string;
}

export interface RagRefusalResultDto {
  kind: 'refusal';
  text: string; // verbatim: "I couldn't find anything in your data about that."
  threadId: string;
  turnId: string;
}

export interface RagErrorResultDto {
  kind: 'error';
  text: string;
  detail?: string;
}

export interface RagDisambiguationResultDto {
  kind: 'disambiguation';
  candidates: Array<{
    personId: string;
    displayName: string;
    canonicalEmail: string | null;
    recentContext: string;
  }>;
  threadId: string;
}

export type RagAskResponse =
  | RagAnswerResultDto
  | RagRefusalResultDto
  | RagErrorResultDto
  | RagDisambiguationResultDto;

export interface RagAskRequest {
  question: string;
  threadId?: string;
  accountFilter?: Array<{ providerKey: string; accountId: string }>;
  forcePersonId?: string;
  transient?: boolean;
}

export interface RagThreadDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface RagTurnDto {
  id: string;
  threadId: string;
  ord: number;
  role: 'user' | 'assistant';
  text: string;
  citations: RagCitationDto[] | null;
  routing: RagRoutingDto | null;
  createdAt: string;
}

// Plan 04-02 — scheduling rules DTOs ---------------------------------------

export interface SchedulingRulesGetResponse {
  rules: unknown; // shape mirrors RulesSchema; renderer re-parses
  timeZone: string;
  updatedAt: string | null;
}

export interface SchedulingRulesSetRequest {
  rules: unknown; // validated server-side via RulesSchema.safeParse
}

export type SchedulingRulesSetResponse =
  | { ok: true }
  | { error: 'INVALID_RULES'; issues: unknown }
  | { error: string };

/**
 * Plan 03-02 — DTOs exposed across the renderer/main boundary.
 */
export type SensitivityCategoryDto =
  | 'financial'
  | 'legal'
  | 'hr'
  | 'pii'
  | 'urgent'
  | 'none';

export interface SensitivityResultDto {
  categories: SensitivityCategoryDto[];
  severity: 'low' | 'med' | 'high';
  confidence: number;
  rationale: string;
  classifier_version: string;
}

export interface RoutingLogClassifiedRow extends RoutingLogEntry {
  categories_json: string | null;
  severity: 'low' | 'med' | 'high' | null;
  classifier_rationale: string | null;
  classifier_version: string | null;
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
  ONBOARDING_LOCK: 'onboardingLock',
  SECRETS_SET_FRONTIER_KEY: 'secretsSetFrontierKey',
  SECRETS_HAS_FRONTIER_KEY: 'secretsHasFrontierKey',
  SECRETS_CLEAR_FRONTIER_KEY: 'secretsClearFrontierKey',
  SECRETS_GET_ACTIVE_PROVIDER: 'secretsGetActiveProvider',
  SECRETS_SET_ACTIVE_PROVIDER: 'secretsSetActiveProvider',
  OLLAMA_STATUS: 'ollamaStatus',
  OLLAMA_GET_ACTIVE_MODEL: 'ollamaGetActiveModel',
  OLLAMA_SET_ACTIVE_MODEL: 'ollamaSetActiveModel',
  DIAGNOSTICS_ROUTING_LOG: 'diagnosticsRoutingLog',
  DIAGNOSTICS_STATUS: 'diagnosticsStatus',
  BACKUP_CREATE: 'backupCreate',
  BACKUP_RESTORE: 'backupRestore',
  BACKUP_STATS: 'backupStats',
  GMAIL_CONNECT: 'gmailConnect',
  GMAIL_STATUS: 'gmailStatus',
  GMAIL_DISCONNECT: 'gmailDisconnect',
  GMAIL_FORCE_SYNC: 'gmailForceSync',
  CALENDAR_CONNECT: 'calendarConnect',
  CALENDAR_STATUS: 'calendarStatus',
  CALENDAR_DISCONNECT: 'calendarDisconnect',
  CALENDAR_FORCE_SYNC: 'calendarForceSync',
  CALENDAR_LIST_EVENTS_RANGE: 'calendarListEventsRange',
  MICROSOFT_CONNECT: 'microsoftConnect',
  MICROSOFT_STATUS: 'microsoftStatus',
  MICROSOFT_DISCONNECT: 'microsoftDisconnect',
  MICROSOFT_FORCE_SYNC: 'microsoftForceSync',
  TODOIST_CONNECT_TOKEN: 'todoistConnectToken',
  TODOIST_STATUS: 'todoistStatus',
  TODOIST_DISCONNECT: 'todoistDisconnect',
  TODOIST_FORCE_SYNC: 'todoistForceSync',
  TODOIST_PUSH_APPROVED_ACTIONS: 'todoistPushApprovedActions',
  TASKS_LIST: 'tasksList',
  PROVIDER_ACCOUNTS_LIST: 'providerAccountsList',
  PROVIDER_ACCOUNT_UPDATE: 'providerAccountUpdate',
  PROVIDER_ACCOUNT_DISCONNECT: 'providerAccountDisconnect',
  NEWS_LIST_SOURCES: 'newsListSources',
  NEWS_ADD_RSS: 'newsAddRss',
  NEWS_REMOVE_SOURCE: 'newsRemoveSource',
  NEWS_SET_BUNDLE: 'newsSetBundle',
  BRIEFING_TODAY: 'briefingToday',
  BRIEFING_GENERATE_NOW: 'briefingGenerateNow',
  BRIEFING_REGENERATE_TODAY: 'briefingRegenerateToday',
  BRIEFING_DISMISS_NEWS_ITEM: 'briefingDismissNewsItem',
  BRIEFING_HISTORY: 'briefingHistory',
  BRIEFING_GET_SETTINGS: 'briefingGetSettings',
  BRIEFING_SET_SETTINGS: 'briefingSetSettings',
  APPROVALS_LIST: 'approvalsList',
  APPROVALS_APPROVE: 'approvalsApprove',
  APPROVALS_REJECT: 'approvalsReject',
  APPROVALS_SNOOZE: 'approvalsSnooze',
  APPROVALS_BATCH_APPROVE: 'approvalsBatchApprove',
  APPROVALS_CANCEL_STUCK: 'approvalsCancelStuck',
  CLASSIFY: 'classify',
  ROUTING_LOG_QUERY: 'routingLogQuery',
  TRIAGE_SUMMARIZE_THREAD: 'triageSummarizeThread',
  TRIAGE_GET_FOR_MESSAGE: 'triageGetForMessage',
  DRAFTING_REPLY_TO_MESSAGE: 'draftingReplyToMessage',
  GMAIL_SEND_APPROVED: 'gmailSendApproved',
  SCHEDULING_RULES_GET: 'schedulingRulesGet',
  SCHEDULING_RULES_SET: 'schedulingRulesSet',
  SCHEDULING_PROPOSE: 'schedulingPropose',
  SCHEDULING_CONFIRM_TARGET: 'schedulingConfirmTarget',
  SCHEDULING_OVERRIDE: 'schedulingOverride',
  TRANSCRIPT_INGEST: 'transcriptIngest',
  TRANSCRIPT_GET_NOTE: 'transcriptGetNote',
  TRANSCRIPT_LIST_NOTES: 'transcriptListNotes',
  TRANSCRIPT_LINK_EVENT: 'transcriptLinkEvent',
  TRANSCRIPT_GET_REVIEW: 'transcriptGetReview',
  RAG_INDEX_STATUS: 'ragIndexStatus',
  RAG_BACKFILL_STATUS: 'ragBackfillStatus',
  RAG_BACKFILL_START: 'ragBackfillStart',
  RAG_BACKFILL_SKIP: 'ragBackfillSkip',
  RAG_WIPE_ACCOUNT: 'ragWipeAccount',
  RAG_ASK: 'ragAsk',
  RAG_THREAD_LIST: 'ragThreadList',
  RAG_THREAD_GET: 'ragThreadGet',
  RAG_THREAD_CREATE: 'ragThreadCreate',
  RAG_THREAD_DELETE: 'ragThreadDelete',
  RAG_OPEN_SOURCE: 'ragOpenSource',
  RAG_ACCOUNT_CHUNK_COUNTS: 'ragAccountChunkCounts',
  INSIGHTS_LATEST: 'insightsLatest',
  INSIGHTS_RECOMPUTE: 'insightsRecompute',
  RECAP_LIST: 'recapList',
  RECAP_GET: 'recapGet',
  RECAP_REGENERATE: 'recapRegenerate',
  RECAP_SAVE_EDITS: 'recapSaveEdits',
  RECAP_FINALIZE: 'recapFinalize',
  RECAP_EXPORT_DOCX: 'recapExportDocx',
  RECAP_EXPORT_PDF: 'recapExportPdf',
  RECAP_LIST_AUDIT: 'recapListAudit',
  LEARN_GET_PREFS: 'learnGetPrefs',
  LEARN_RESET_FIELD: 'learnResetField',
  LEARN_RESET_ALL: 'learnResetAll',
  LEARN_LIST_SIGNALS: 'learnListSignals',
  BRIEFING_FEEDBACK: 'briefingFeedback',
  BRIEFING_INSIGHT_DISMISS: 'briefingInsightDismiss',
  RAG_TURN_FEEDBACK: 'ragTurnFeedback',
  UPDATER_CHECK: 'updaterCheck',
  UPDATER_DOWNLOAD: 'updaterDownload',
  UPDATER_RESTART: 'updaterRestart',
  UPDATER_CHANNEL: 'updaterChannel',
  KNOWLEDGE_PICK_FOLDER: 'knowledgePickFolder',
  KNOWLEDGE_PRESCAN_FOLDER: 'knowledgePrescanFolder',
  KNOWLEDGE_ADD_FOLDER: 'knowledgeAddFolder',
  KNOWLEDGE_LIST_FOLDERS: 'knowledgeListFolders',
  KNOWLEDGE_REMOVE_FOLDER: 'knowledgeRemoveFolder',
  KNOWLEDGE_FOLDER_STATS: 'knowledgeFolderStats',
  KNOWLEDGE_REINDEX: 'knowledgeReindex',
  KNOWLEDGE_SET_SENSITIVITY: 'knowledgeSetSensitivity',
  ENTITLEMENT_GET_STATE: 'entitlementGetState',
  ENTITLEMENT_ACTIVATE: 'entitlementActivate',
  ENTITLEMENT_OPEN_CHECKOUT: 'entitlementOpenCheckout',
  ENTITLEMENT_OPEN_PORTAL: 'entitlementOpenPortal',
  ENTITLEMENT_REFRESH_NOW: 'entitlementRefreshNow',
  ENTITLEMENT_STATE_CHANGED: 'entitlementOnStateChanged',
  // Phase 11 Research
  RESEARCH_JOB_CREATE: 'researchJobCreate',
  RESEARCH_JOB_LIST: 'researchJobList',
  RESEARCH_JOB_GET: 'researchJobGet',
  RESEARCH_JOB_UPDATE: 'researchJobUpdate',
  RESEARCH_JOB_DELETE: 'researchJobDelete',
  RESEARCH_JOB_RUN: 'researchJobRun',
  RESEARCH_REPORT_GET: 'researchReportGet',
  RESEARCH_REPORT_LIST: 'researchReportList',
  RESEARCH_FEEDBACK_SAVE: 'researchFeedbackSave',
  RESEARCH_SUGGESTIONS_GET: 'researchSuggestionsGet',
  RESEARCH_SUGGESTION_APPROVE: 'researchSuggestionApprove',
  RESEARCH_SUGGESTION_DISMISS: 'researchSuggestionDismiss',
  RESEARCH_REPORT_DONE: 'researchReportDone',
  RESEARCH_SECRETS_SET: 'researchSecretsSet',
  RESEARCH_SECRETS_HAS: 'researchSecretsHas',
  // Phase 12 Background activity (12-01)
  BG_GET_PREFS: 'backgroundGetPrefs',
  BG_SET_PREFS: 'backgroundSetPrefs',
  // Quick 260523-eaf — user profile.
  PROFILE_GET: 'profileGet',
  PROFILE_SET: 'profileSet',
  // Phase 12 / Plan 12-03 — push-only navigate channel. Overridden in preload
  // with a real ipcRenderer.on subscription (like ENTITLEMENT_STATE_CHANGED).
  NAVIGATE: 'onNavigate',
  // Phase 15 — Voice channels. Invoke methods auto-mapped by buildApi();
  // push channels overridden in preload with real ipcRenderer.on listeners.
  VOICE_FEED_AUDIO: 'voiceFeedAudio',
  VOICE_GET_MODEL_STATUS: 'voiceGetModelStatus',
  VOICE_DOWNLOAD_MODEL: 'voiceDownloadModel',
  VOICE_CANCEL_TTS: 'voiceCancelTts',
  VOICE_TRANSCRIPT_DELTA: 'onVoiceTranscript',
  VOICE_STATE_CHANGED: 'onVoiceState',
  VOICE_MODEL_PROGRESS: 'onVoiceModelProgress',
} as const;

// ---------------------------------------------------------------------------
// Plan 10-01 Knowledge Folders DTOs -------------------------------------------

export interface KnowledgeFolderDto {
  id: string;
  path: string;
  label: string;
  sensitivity: 'general' | 'sensitive';
  status: 'active' | 'paused' | 'error';
  fileCount: number;
  bytesIndexed: number;
  lastScanAt: string | null;
  lastError: string | null;
}

export interface KnowledgeFolderStatsDto {
  fileCount: number;
  bytesIndexed: number;
  indexedCount: number;
  errorCount: number;
  pendingCount: number;
  tombstonedCount: number;
  lastScanAt: string | null;
}

// Plan 08.1-02 entitlement IPC DTOs
// ---------------------------------------------------------------------------

import { z as _z_ent } from 'zod';

export const EntitlementActivateRequest = _z_ent.object({
  license_key: _z_ent.string().min(1),
});
export type EntitlementActivateRequest = _z_ent.infer<
  typeof EntitlementActivateRequest
>;

export const EntitlementActivateResponse = _z_ent.union([
  _z_ent.object({
    ok: _z_ent.literal(true),
    state: _z_ent.unknown(),
  }),
  _z_ent.object({
    ok: _z_ent.literal(false),
    error: _z_ent.object({
      code: _z_ent.string(),
      message: _z_ent.string().optional(),
    }),
  }),
]);
export type EntitlementActivateResponse = _z_ent.infer<
  typeof EntitlementActivateResponse
>;

// ---------------------------------------------------------------------------
// Phase 11 Research DTOs
// ---------------------------------------------------------------------------

export interface ResearchJobDto {
  id: string;
  title: string;
  goals: string;
  domains: string[];         // parsed from domains_json column
  status: 'draft' | 'running' | 'done' | 'failed';
  scheduleInterval: 'none' | 'daily' | 'weekly';
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchReportDto {
  id: string;
  jobId: string;
  version: number;
  status: 'generating' | 'done' | 'failed';
  trigger: 'manual' | 'schedule' | 'feedback_rerun';
  summary: string | null;
  confidenceScore: number | null;
  errorMessage: string | null;
  generatedAt: string | null;
  sections: ResearchReportSectionDto[];
}

export interface ResearchReportSectionDto {
  id: string;
  reportId: string;
  sectionType: string;         // 'findings' | 'sources' | 'metrics'
  ordinal: number;
  contentJson: string;         // raw JSON, parsed in renderer
  feedback?: ResearchFeedbackDto | null;
}

export interface ResearchFeedbackDto {
  id: string;
  reportId: string;
  sectionId: string | null;    // null = whole-report
  thumb: 1 | -1 | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Phase 12 Background activity DTOs (12-01)
// ---------------------------------------------------------------------------

/**
 * Full background-activity preference shape. `firstCloseToastShown` is
 * main-process-internal (used by 12-03 to gate the one-time toast); it is
 * returned by BG_GET_PREFS for completeness but cannot be set from the
 * renderer (omitted from BackgroundPrefsPatchDto).
 */
export interface BackgroundPrefsDto {
  autoLaunch: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  firstCloseToastShown: boolean;
}

/** Renderer-supplied partial patch. All keys optional; extra keys rejected
 *  by the Zod schema in registerBackgroundHandlers. */
export interface BackgroundPrefsPatchDto {
  autoLaunch?: boolean;
  closeToTray?: boolean;
  notificationsEnabled?: boolean;
}
