/**
 * IPC handler registry (Plan 04 wave 5).
 *
 * `registerHandlers` wires every Phase-1 handler-registration function in
 * order:
 *   1. registerOnboardingHandlers   (Plan 02)
 *   2. registerBackupHandlers       (Plan 02)
 *   3. registerSecretsHandlers      (Plan 03)
 *   4. registerOllamaHandlers       (Plan 03)
 *   5. registerAskHandlers          (Plan 04)
 *   6. registerDiagnosticsHandlers  (Plan 04)
 *
 * All six handler-registration functions now own their channels. No no-op
 * stubs remain.
 *
 * Every handler logs entry + exit with `latency_ms`, redacting the payload via
 * `redactObject` BEFORE it touches pino (defense-in-depth — pino redacts too).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import {
  registerOnboardingHandlers,
  createDbHolder,
  type DbHolder,
} from './onboarding';
import { registerBackupHandlers } from './backup';
import { registerSecretsHandlers } from './secrets';
import { registerOllamaHandlers } from './ollama';
import { registerAskHandlers } from './ask';
import { registerDiagnosticsHandlers } from './diagnostics';
import { registerGmailHandlers } from './gmail';
import { registerCalendarHandlers } from './calendar';
import { registerNewsHandlers } from './news';
import { registerBriefingHandlers } from './briefing';
import { registerApprovalsHandlers } from './approvals';
import { registerClassifyHandlers } from './classify';
import { registerTriageHandlers } from './triage';
import { registerDraftingHandlers } from './drafting';
import { registerGmailSendHandlers } from './gmail-send';
import { registerSchedulingHandlers } from './scheduling';
import { registerMicrosoftHandlers } from './microsoft';
import { registerProviderAccountHandlers } from './provider-accounts';
import { registerTranscriptHandlers } from './transcripts';
import { registerTodoistHandlers } from './todoist';
import { registerTasksHandlers } from './tasks';
import { registerRagHandlers } from './rag';
import { registerInsightsHandlers } from './insights';
import { registerRecapHandlers } from './recap';
import { registerScheduler, type SchedulerHandle } from '../lifecycle/scheduler';
import {
  startSyncOrchestrator,
  stopSyncOrchestrator,
  type SyncOrchestrator,
} from '../integrations/sync-orchestrator';

export interface IpcDeps {
  logger: Logger;
  dataDir: string;
  dbHolder?: DbHolder;
  scheduler?: SchedulerHandle;
  secrets?: unknown;
  router?: unknown;
  ollama?: unknown;
  vault?: unknown;
  db?: unknown;
}

const NOT_IMPLEMENTED = Object.freeze({ error: 'NOT_IMPLEMENTED' as const });

/**
 * Wire every Phase-1 handler-registration function. `options.skipChannels`
 * lets callers (e.g. tests, main/index.ts during transition) suppress
 * specific registrations.
 */
export function registerHandlers(
  ipcMain: IpcMain,
  deps: IpcDeps,
  options: { skipChannels?: ReadonlyArray<string> } = {},
): void {
  const { logger } = deps;
  const dataDir = deps.dataDir;
  const dbHolder = deps.dbHolder ?? createDbHolder();
  const skip = new Set(options.skipChannels ?? []);
  let syncOrchestrator: SyncOrchestrator | null = null;

  const onboardingChannels = [
    CHANNELS.ONBOARDING_GEN_MNEMONIC,
    CHANNELS.ONBOARDING_CONFIRM,
    CHANNELS.ONBOARDING_SEAL,
    CHANNELS.ONBOARDING_UNLOCK,
    CHANNELS.ONBOARDING_STATUS,
  ];
  if (dataDir && !onboardingChannels.every((c) => skip.has(c))) {
    registerOnboardingHandlers(ipcMain, {
      logger,
      dataDir,
      dbHolder,
      onDbReady: (db) => {
        stopSyncOrchestrator(syncOrchestrator);
        syncOrchestrator = startSyncOrchestrator({
          db,
          scheduler: getScheduler(),
          logger,
        });
      },
    });
    onboardingChannels.forEach((c) => skip.add(c));
  }

  const backupChannels = [CHANNELS.BACKUP_CREATE, CHANNELS.BACKUP_RESTORE];
  if (dataDir && !backupChannels.every((c) => skip.has(c))) {
    registerBackupHandlers(ipcMain, { logger, dataDir, dbHolder });
    backupChannels.forEach((c) => skip.add(c));
  }

  const secretsChannels = [
    CHANNELS.SECRETS_SET_FRONTIER_KEY,
    CHANNELS.SECRETS_HAS_FRONTIER_KEY,
    CHANNELS.SECRETS_CLEAR_FRONTIER_KEY,
    CHANNELS.SECRETS_GET_ACTIVE_PROVIDER,
    CHANNELS.SECRETS_SET_ACTIVE_PROVIDER,
  ];
  if (dataDir && !secretsChannels.every((c) => skip.has(c))) {
    registerSecretsHandlers(ipcMain, { logger, dataDir });
    secretsChannels.forEach((c) => skip.add(c));
  }

  const ollamaChannels = [
    CHANNELS.OLLAMA_STATUS,
    CHANNELS.OLLAMA_GET_ACTIVE_MODEL,
    CHANNELS.OLLAMA_SET_ACTIVE_MODEL,
    CHANNELS.DIAGNOSTICS_STATUS,
  ];
  if (dataDir && !ollamaChannels.every((c) => skip.has(c))) {
    registerOllamaHandlers(ipcMain, { logger, dataDir });
    ollamaChannels.forEach((c) => skip.add(c));
  }

  if (!skip.has(CHANNELS.ASK_ARIA)) {
    registerAskHandlers(ipcMain, { logger, dbHolder });
    skip.add(CHANNELS.ASK_ARIA);
  }

  if (!skip.has(CHANNELS.DIAGNOSTICS_ROUTING_LOG)) {
    registerDiagnosticsHandlers(ipcMain, { logger, dbHolder });
    skip.add(CHANNELS.DIAGNOSTICS_ROUTING_LOG);
  }

  // Shared scheduler for both Gmail (5-min cron) and Calendar (15-min cron).
  // Constructed lazily so callers that omit `deps.scheduler` still get a
  // single SchedulerHandle wired into both registrations (the queue's
  // concurrency=1 invariant requires one queue per process).
  let sharedScheduler: SchedulerHandle | undefined = deps.scheduler;
  function getScheduler(): SchedulerHandle {
    if (!sharedScheduler) sharedScheduler = registerScheduler(logger);
    return sharedScheduler;
  }

  const gmailChannels = [
    CHANNELS.GMAIL_CONNECT,
    CHANNELS.GMAIL_STATUS,
    CHANNELS.GMAIL_DISCONNECT,
    CHANNELS.GMAIL_FORCE_SYNC,
  ];
  if (!gmailChannels.every((c) => skip.has(c))) {
    registerGmailHandlers(ipcMain, { logger, dbHolder, scheduler: getScheduler() });
    gmailChannels.forEach((c) => skip.add(c));
  }

  const calendarChannels = [
    CHANNELS.CALENDAR_CONNECT,
    CHANNELS.CALENDAR_STATUS,
    CHANNELS.CALENDAR_DISCONNECT,
    CHANNELS.CALENDAR_FORCE_SYNC,
    CHANNELS.CALENDAR_LIST_EVENTS_RANGE,
  ];
  if (!calendarChannels.every((c) => skip.has(c))) {
    registerCalendarHandlers(ipcMain, { logger, dbHolder, scheduler: getScheduler() });
    calendarChannels.forEach((c) => skip.add(c));
  }

  const microsoftChannels = [
    CHANNELS.MICROSOFT_CONNECT,
    CHANNELS.MICROSOFT_STATUS,
    CHANNELS.MICROSOFT_DISCONNECT,
    CHANNELS.MICROSOFT_FORCE_SYNC,
  ];
  if (!microsoftChannels.every((c) => skip.has(c))) {
    registerMicrosoftHandlers(ipcMain, { logger, dbHolder, scheduler: getScheduler() });
    microsoftChannels.forEach((c) => skip.add(c));
  }

  const providerAccountChannels = [
    CHANNELS.PROVIDER_ACCOUNTS_LIST,
    CHANNELS.PROVIDER_ACCOUNT_UPDATE,
    CHANNELS.PROVIDER_ACCOUNT_DISCONNECT,
  ];
  if (!providerAccountChannels.every((c) => skip.has(c))) {
    registerProviderAccountHandlers(ipcMain, { logger, dbHolder });
    providerAccountChannels.forEach((c) => skip.add(c));
  }

  const todoistChannels = [
    CHANNELS.TODOIST_CONNECT_TOKEN,
    CHANNELS.TODOIST_STATUS,
    CHANNELS.TODOIST_DISCONNECT,
    CHANNELS.TODOIST_FORCE_SYNC,
    CHANNELS.TODOIST_PUSH_APPROVED_ACTIONS,
  ];
  if (!todoistChannels.every((c) => skip.has(c))) {
    registerTodoistHandlers(ipcMain, { logger, dbHolder });
    todoistChannels.forEach((c) => skip.add(c));
  }

  const tasksChannels = [CHANNELS.TASKS_LIST];
  if (!tasksChannels.every((c) => skip.has(c))) {
    registerTasksHandlers(ipcMain, { logger, dbHolder });
    tasksChannels.forEach((c) => skip.add(c));
  }

  const newsChannels = [
    CHANNELS.NEWS_LIST_SOURCES,
    CHANNELS.NEWS_ADD_RSS,
    CHANNELS.NEWS_REMOVE_SOURCE,
    CHANNELS.NEWS_SET_BUNDLE,
  ];
  if (!newsChannels.every((c) => skip.has(c))) {
    registerNewsHandlers(ipcMain, { logger, dbHolder });
    newsChannels.forEach((c) => skip.add(c));
  }

  const briefingChannels = [
    CHANNELS.BRIEFING_TODAY,
    CHANNELS.BRIEFING_GENERATE_NOW,
    CHANNELS.BRIEFING_DISMISS_NEWS_ITEM,
    CHANNELS.BRIEFING_HISTORY,
    CHANNELS.BRIEFING_GET_SETTINGS,
    CHANNELS.BRIEFING_SET_SETTINGS,
  ];
  if (!briefingChannels.every((c) => skip.has(c))) {
    registerBriefingHandlers(ipcMain, { logger, dbHolder, scheduler: getScheduler() });
    briefingChannels.forEach((c) => skip.add(c));
  }

  const approvalsChannels = [
    CHANNELS.APPROVALS_LIST,
    CHANNELS.APPROVALS_APPROVE,
    CHANNELS.APPROVALS_REJECT,
    CHANNELS.APPROVALS_SNOOZE,
    CHANNELS.APPROVALS_BATCH_APPROVE,
  ];
  if (!approvalsChannels.every((c) => skip.has(c))) {
    registerApprovalsHandlers(ipcMain, { logger, dbHolder });
    approvalsChannels.forEach((c) => skip.add(c));
  }

  const classifyChannels = [CHANNELS.CLASSIFY, CHANNELS.ROUTING_LOG_QUERY];
  if (!classifyChannels.every((c) => skip.has(c))) {
    registerClassifyHandlers(ipcMain, {
      logger,
      dbHolder,
      scheduler: getScheduler(),
    });
    classifyChannels.forEach((c) => skip.add(c));
  }

  const triageChannels = [
    CHANNELS.TRIAGE_SUMMARIZE_THREAD,
    CHANNELS.TRIAGE_GET_FOR_MESSAGE,
  ];
  if (!triageChannels.every((c) => skip.has(c))) {
    registerTriageHandlers(ipcMain, {
      logger,
      dbHolder,
      scheduler: getScheduler(),
    });
    triageChannels.forEach((c) => skip.add(c));
  }

  const draftingChannels = [CHANNELS.DRAFTING_REPLY_TO_MESSAGE];
  if (!draftingChannels.every((c) => skip.has(c))) {
    registerDraftingHandlers(ipcMain, {
      logger,
      dbHolder,
      scheduler: getScheduler(),
    });
    draftingChannels.forEach((c) => skip.add(c));
  }

  const gmailSendChannels = [CHANNELS.GMAIL_SEND_APPROVED];
  if (!gmailSendChannels.every((c) => skip.has(c))) {
    registerGmailSendHandlers(ipcMain, { logger, dbHolder });
    gmailSendChannels.forEach((c) => skip.add(c));
  }

  const schedulingChannels = [
    CHANNELS.SCHEDULING_RULES_GET,
    CHANNELS.SCHEDULING_RULES_SET,
    CHANNELS.SCHEDULING_PROPOSE,
    CHANNELS.SCHEDULING_CONFIRM_TARGET,
    CHANNELS.SCHEDULING_OVERRIDE,
  ];
  if (!schedulingChannels.every((c) => skip.has(c))) {
    registerSchedulingHandlers(ipcMain, {
      logger,
      dbHolder,
      getUserEmail: async (): Promise<string> => {
        const db = dbHolder.db;
        if (!db) return 'user@local';
        // Migration 014 dropped the legacy calendar_account base table;
        // calendar_account_view projects rows from provider_account where
        // capabilities_json.calendar = 1.
        let row: { email?: string } | undefined;
        try {
          row = db
            .prepare('SELECT email FROM calendar_account_view LIMIT 1')
            .get() as { email?: string } | undefined;
        } catch {
          row = undefined;
        }
        return row?.email ?? 'user@local';
      },
    });
    schedulingChannels.forEach((c) => skip.add(c));
  }

  // Plan 07-02 + 07-03 RAG channels.
  const ragChannels = [
    CHANNELS.RAG_INDEX_STATUS,
    CHANNELS.RAG_BACKFILL_STATUS,
    CHANNELS.RAG_BACKFILL_START,
    CHANNELS.RAG_BACKFILL_SKIP,
    CHANNELS.RAG_WIPE_ACCOUNT,
    CHANNELS.RAG_ASK,
    CHANNELS.RAG_THREAD_LIST,
    CHANNELS.RAG_THREAD_GET,
    CHANNELS.RAG_THREAD_CREATE,
    CHANNELS.RAG_THREAD_DELETE,
    CHANNELS.RAG_OPEN_SOURCE,
    CHANNELS.RAG_ACCOUNT_CHUNK_COUNTS,
  ];
  if (!ragChannels.every((c) => skip.has(c))) {
    registerRagHandlers(ipcMain, { logger, dbHolder });
    ragChannels.forEach((c) => skip.add(c));
  }

  // Plan 08-01 Insights channels (Phase 8 Stream 1).
  const insightsChannels = [
    CHANNELS.INSIGHTS_LATEST,
    CHANNELS.INSIGHTS_RECOMPUTE,
  ];
  if (!insightsChannels.every((c) => skip.has(c))) {
    registerInsightsHandlers(ipcMain, { logger, dbHolder, scheduler: deps.scheduler });
    insightsChannels.forEach((c) => skip.add(c));
  }

  // Plan 08-02 Recap channels (Phase 8 Stream 2).
  const recapChannels = [
    CHANNELS.RECAP_LIST,
    CHANNELS.RECAP_GET,
    CHANNELS.RECAP_REGENERATE,
    CHANNELS.RECAP_SAVE_EDITS,
    CHANNELS.RECAP_FINALIZE,
    CHANNELS.RECAP_EXPORT_DOCX,
    CHANNELS.RECAP_EXPORT_PDF,
    CHANNELS.RECAP_LIST_AUDIT,
  ];
  if (!recapChannels.every((c) => skip.has(c))) {
    registerRecapHandlers(ipcMain, { logger, dbHolder, scheduler: deps.scheduler });
    recapChannels.forEach((c) => skip.add(c));
  }

  const transcriptChannels = [
    CHANNELS.TRANSCRIPT_INGEST,
    CHANNELS.TRANSCRIPT_GET_NOTE,
    CHANNELS.TRANSCRIPT_LIST_NOTES,
    CHANNELS.TRANSCRIPT_LINK_EVENT,
    CHANNELS.TRANSCRIPT_GET_REVIEW,
  ];
  if (!transcriptChannels.every((c) => skip.has(c))) {
    registerTranscriptHandlers(ipcMain, { logger, dbHolder });
    transcriptChannels.forEach((c) => skip.add(c));
  }
}

/**
 * Legacy stub-shape export kept for back-compat with the Plan 03 wave-4
 * tests. Plan 04 has no remaining stubs; this is only the legacy literal.
 */
export const STUB_RESPONSE = NOT_IMPLEMENTED;
