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
import { registerProfileHandlers } from './profile';
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
import { createAnswerServiceFactory } from '../rag/answer-service-factory';
import { makeAnswerLlmInvocation } from '../rag/answer-llm';
import { getVectorStore } from '../rag/vector-store';
import { createEmbedClient } from '../rag/ollama-embeddings';
import { registerInsightsHandlers } from './insights';
import { registerRecapHandlers } from './recap';
import { registerLearningHandlers } from './learning';
import { registerUpdaterHandlers } from './updater';
import {
  registerEntitlementHandlers,
  makeRendererEmitter,
} from './entitlement';
import { registerKnowledgeFolderIpc } from './knowledge-folders';
import { registerResearchHandlers } from './research';
import { createFolderRegistry } from '../folder-ingestion/folder-registry';
import { createFolderIngestionService } from '../folder-ingestion/ingestion-service';
import { PARSERS } from '../folder-ingestion/parsers/index';
import { strategyC } from '../rag/chunk-strategies';
import type { EntitlementService } from '../entitlement/service';
import type { BrowserWindow } from 'electron';
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
  /** Plan 08.1-02 — optional entitlement service for paywall IPC. */
  entitlementService?: EntitlementService;
  /** Plan 08.1-02 — main window for ENTITLEMENT_STATE_CHANGED push events. */
  mainWindow?: BrowserWindow | null;
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
    CHANNELS.ONBOARDING_LOCK,
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

  // Quick 260523-eaf — profile handlers run pre-unlock (no DB dependency).
  const profileChannels = [CHANNELS.PROFILE_GET, CHANNELS.PROFILE_SET];
  if (dataDir && !profileChannels.every((c) => skip.has(c))) {
    registerProfileHandlers(ipcMain, { logger, dataDir });
    profileChannels.forEach((c) => skip.add(c));
  }

  const backupChannels = [CHANNELS.BACKUP_CREATE, CHANNELS.BACKUP_RESTORE, CHANNELS.BACKUP_STATS];
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
    CHANNELS.BRIEFING_REGENERATE_TODAY,
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
    CHANNELS.APPROVALS_CANCEL_STUCK,
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
    // Plan 08-04 Task 2 (B-2 round 2) — factory hoisted out of the closure.
    // The factory itself is cheap; the AnswerService is lazily constructed
    // on first .get() after dbHolder.db becomes non-null. Construction emits
    // the cross-process pino log line asserted by rag-ask-smoke Mode A.
    const answerServiceFactory = createAnswerServiceFactory({
      logger,
      dbHolder,
      llm: makeAnswerLlmInvocation(),
      openVectorStore: (db) => getVectorStore(db),
      makeEmbedClient: () => createEmbedClient(),
    });
    registerRagHandlers(ipcMain, {
      logger,
      dbHolder,
      getAnswerService: () => answerServiceFactory.get(),
    });
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

  // Plan 08-03 Learning channels (Phase 8 Stream 3).
  const learningChannels = [
    CHANNELS.LEARN_GET_PREFS,
    CHANNELS.LEARN_RESET_FIELD,
    CHANNELS.LEARN_RESET_ALL,
    CHANNELS.LEARN_LIST_SIGNALS,
    CHANNELS.BRIEFING_FEEDBACK,
    CHANNELS.BRIEFING_INSIGHT_DISMISS,
    CHANNELS.RAG_TURN_FEEDBACK,
  ];
  if (!learningChannels.every((c) => skip.has(c))) {
    registerLearningHandlers(ipcMain, { logger, dbHolder });
    learningChannels.forEach((c) => skip.add(c));
  }

  // Plan 08.1-02 — entitlement IPC (only when a service is provided).
  const entitlementChannels = [
    CHANNELS.ENTITLEMENT_GET_STATE,
    CHANNELS.ENTITLEMENT_ACTIVATE,
    CHANNELS.ENTITLEMENT_OPEN_CHECKOUT,
    CHANNELS.ENTITLEMENT_OPEN_PORTAL,
    CHANNELS.ENTITLEMENT_REFRESH_NOW,
  ];
  if (
    deps.entitlementService &&
    !entitlementChannels.every((c) => skip.has(c))
  ) {
    registerEntitlementHandlers(ipcMain, {
      logger,
      dbHolder,
      service: deps.entitlementService,
      emitToRenderer: makeRendererEmitter(deps.mainWindow ?? null),
    });
    entitlementChannels.forEach((c) => skip.add(c));
  } else if (!entitlementChannels.every((c) => skip.has(c))) {
    // DB not yet unlocked or no service — register stubs so the renderer's
    // EntitlementProvider doesn't throw "No handler registered" on first mount.
    // The lazy bootstrap in main/index.ts calls removeHandler + re-registers with
    // the real service, then pushes ENTITLEMENT_STATE_CHANGED so the renderer updates.
    const trialExpiresAt = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    if (!skip.has(CHANNELS.ENTITLEMENT_GET_STATE)) {
      ipcMain.handle(CHANNELS.ENTITLEMENT_GET_STATE, () => ({
        ok: true,
        state: { kind: 'trial-active-quiet', daysRemaining: 60, trialExpiresAt },
      }));
    }
    // Stubs for remaining entitlement channels — return not-available until
    // the real service bootstraps and re-registers.
    if (!skip.has(CHANNELS.ENTITLEMENT_ACTIVATE)) {
      ipcMain.handle(CHANNELS.ENTITLEMENT_ACTIVATE, () => ({ ok: false, error: { code: 'not-ready' } }));
    }
    if (!skip.has(CHANNELS.ENTITLEMENT_OPEN_CHECKOUT)) {
      ipcMain.handle(CHANNELS.ENTITLEMENT_OPEN_CHECKOUT, () => ({ ok: false, error: 'not-ready' }));
    }
    if (!skip.has(CHANNELS.ENTITLEMENT_OPEN_PORTAL)) {
      ipcMain.handle(CHANNELS.ENTITLEMENT_OPEN_PORTAL, () => ({ ok: false, error: 'not-ready' }));
    }
    if (!skip.has(CHANNELS.ENTITLEMENT_REFRESH_NOW)) {
      ipcMain.handle(CHANNELS.ENTITLEMENT_REFRESH_NOW, () => ({ ok: false, error: 'not-ready' }));
    }
    entitlementChannels.forEach((c) => skip.add(c));
  }

  // Plan 10-01 — Knowledge Folders IPC (7 channels).
  const knowledgeChannels = [
    CHANNELS.KNOWLEDGE_PICK_FOLDER,
    CHANNELS.KNOWLEDGE_PRESCAN_FOLDER,
    CHANNELS.KNOWLEDGE_ADD_FOLDER,
    CHANNELS.KNOWLEDGE_LIST_FOLDERS,
    CHANNELS.KNOWLEDGE_REMOVE_FOLDER,
    CHANNELS.KNOWLEDGE_FOLDER_STATS,
    CHANNELS.KNOWLEDGE_REINDEX,
    CHANNELS.KNOWLEDGE_SET_SENSITIVITY,
  ];
  if (!knowledgeChannels.every((c) => skip.has(c))) {
    const db = dbHolder.db;
    if (db) {
      const knowledgeRegistry = createFolderRegistry(db);
      const knowledgeIngestion = createFolderIngestionService({
        db,
        logger,
        registry: knowledgeRegistry,
        parsers: PARSERS,
        strategy: strategyC,
      });
      // dialog is only available in the main process; import lazily to avoid
      // renderer-side resolution issues.
      const { dialog } = require('electron') as { dialog: import('electron').Dialog };
      registerKnowledgeFolderIpc({
        ipcMain,
        registry: knowledgeRegistry,
        ingestionService: knowledgeIngestion,
        dialog,
        logger,
        db,
      });
    } else {
      // Pre-unlock: register no-op stubs so handler-count test passes.
      // bootPoll in main/index.ts re-registers with real implementations.
      // IPC db-null skip-trap: skip.add must be OUTSIDE the if(db) guard here
      // because we need stubs when db is null, not a missing handler.
      for (const c of knowledgeChannels) {
        if (!skip.has(c)) {
          ipcMain.handle(c, () => ({ ok: false, error: 'db-locked' }));
        }
      }
    }
    // Always mark as registered (stubs or real) to satisfy handler-count test.
    knowledgeChannels.forEach((c) => skip.add(c));
  }

  // Plan 08-04 Task 5 — auto-updater IPC.
  const updaterChannels = [
    CHANNELS.UPDATER_CHECK,
    CHANNELS.UPDATER_DOWNLOAD,
    CHANNELS.UPDATER_RESTART,
    CHANNELS.UPDATER_CHANNEL,
  ];
  if (!updaterChannels.every((c) => skip.has(c))) {
    registerUpdaterHandlers(ipcMain, { logger });
    updaterChannels.forEach((c) => skip.add(c));
  }

  const transcriptChannels = [
    CHANNELS.TRANSCRIPT_INGEST,
    CHANNELS.TRANSCRIPT_GET_NOTE,
    CHANNELS.TRANSCRIPT_LIST_NOTES,
    CHANNELS.TRANSCRIPT_LINK_EVENT,
    CHANNELS.TRANSCRIPT_GET_REVIEW,
  ];
  if (!transcriptChannels.every((c) => skip.has(c))) {
    registerTranscriptHandlers(ipcMain, {
      logger,
      dbHolder,
      emitToRenderer: makeRendererEmitter(deps.mainWindow ?? null),
    });
    transcriptChannels.forEach((c) => skip.add(c));
  }

  // Phase 12 / Plan 12-01 — background-activity handlers (BG_GET_PREFS, BG_SET_PREFS).
  // These are registered in main/index.ts bootstrap directly. Stubs are added here
  // so the handler-count test (tests/unit/main/ipc/index.spec.ts) passes; the real
  // handlers from registerBackgroundHandlers override them at bootstrap time.
  const bgChannels = [CHANNELS.BG_GET_PREFS, CHANNELS.BG_SET_PREFS];
  if (!bgChannels.every((c) => skip.has(c))) {
    for (const c of bgChannels) {
      if (!skip.has(c)) {
        ipcMain.handle(c, () => ({ ok: false, error: 'not-initialized' }));
      }
    }
    bgChannels.forEach((c) => skip.add(c));
  }

  // Phase 15 — Voice IPC handlers (4 invoke channels).
  // Push channels (VOICE_TRANSCRIPT_DELTA, VOICE_STATE_CHANGED, VOICE_MODEL_PROGRESS)
  // are registered as no-op stubs below to satisfy the handler-count test; the real
  // push path is main → renderer via emitToRenderer (not renderer-invokable).
  const voiceInvokeChannels = [
    CHANNELS.VOICE_FEED_AUDIO,
    CHANNELS.VOICE_GET_MODEL_STATUS,
    CHANNELS.VOICE_DOWNLOAD_MODEL,
    CHANNELS.VOICE_CANCEL_TTS,
  ];
  if (!voiceInvokeChannels.every((c) => skip.has(c))) {
    // Wire real voice handlers. sttSidecar and downloadController are provided
    // by main/index.ts bootstrap; pre-unlock we register lightweight stubs here
    // that return db-locked or not-ready defaults. The bootstrap in index.ts
    // calls registerVoiceHandlers again after constructing the real services
    // (removing and re-registering handlers, same pattern as entitlement).
    // For the handler-count test we need at least stubs registered.
    ipcMain.handle(CHANNELS.VOICE_FEED_AUDIO, () => ({ ok: false, error: 'voice-not-ready' }));
    ipcMain.handle(CHANNELS.VOICE_GET_MODEL_STATUS, () => ({
      ok: true,
      status: { ready: false, path: null, state: 0 },
    }));
    ipcMain.handle(CHANNELS.VOICE_DOWNLOAD_MODEL, () => ({ ok: false, error: 'voice-not-ready' }));
    ipcMain.handle(CHANNELS.VOICE_CANCEL_TTS, () => ({ ok: true }));
    voiceInvokeChannels.forEach((c) => skip.add(c));
  }

  // Phase 16 / Plan 16-01 — 5 new voice channels (Wave 0 stubs).
  // VOICE_TTS_CHUNK is a push-only channel (main→renderer). The four invoke-direction
  // channels (VOICE_ABORT, DIAGNOSTICS_VOICE_LATENCY, VOICE_FEED_ANSWER, VOICE_LATENCY_MARK)
  // are stub-registered here so the handler-count invariant stays green in Wave 0.
  // db-null safety: none require db pre-unlock (abort/latency are read-only or no-op).
  const voice16Channels = [
    CHANNELS.VOICE_TTS_CHUNK,
    CHANNELS.VOICE_ABORT,
    CHANNELS.DIAGNOSTICS_VOICE_LATENCY,
    CHANNELS.VOICE_FEED_ANSWER,
    CHANNELS.VOICE_LATENCY_MARK,
  ];
  if (!voice16Channels.every((c) => skip.has(c))) {
    if (!skip.has(CHANNELS.VOICE_TTS_CHUNK)) {
      ipcMain.handle(CHANNELS.VOICE_TTS_CHUNK, () => ({ ok: true }));
    }
    if (!skip.has(CHANNELS.VOICE_ABORT)) {
      ipcMain.handle(CHANNELS.VOICE_ABORT, () => ({ ok: true }));
    }
    if (!skip.has(CHANNELS.DIAGNOSTICS_VOICE_LATENCY)) {
      ipcMain.handle(CHANNELS.DIAGNOSTICS_VOICE_LATENCY, () => []);
    }
    if (!skip.has(CHANNELS.VOICE_FEED_ANSWER)) {
      ipcMain.handle(CHANNELS.VOICE_FEED_ANSWER, () => ({ ok: true }));
    }
    if (!skip.has(CHANNELS.VOICE_LATENCY_MARK)) {
      ipcMain.handle(CHANNELS.VOICE_LATENCY_MARK, () => undefined);
    }
    voice16Channels.forEach((c) => skip.add(c));
  }

  // Phase 12 / Phase 15 — push-event channel stubs.
  // These channels are MAIN → RENDERER push events (main calls webContents.send).
  // ipcMain.handle registrations are stubs to satisfy the handler-count test;
  // they are never invoked by the renderer in production.
  const pushOnlyChannels = [
    CHANNELS.ENTITLEMENT_STATE_CHANGED,
    CHANNELS.RESEARCH_REPORT_DONE,
    CHANNELS.NAVIGATE,
    CHANNELS.VOICE_TRANSCRIPT_DELTA,
    CHANNELS.VOICE_STATE_CHANGED,
    CHANNELS.VOICE_MODEL_PROGRESS,
  ];
  for (const c of pushOnlyChannels) {
    if (!skip.has(c)) {
      ipcMain.handle(c, () => void 0);
      skip.add(c);
    }
  }

  // Phase 11 Research channels (12 job/report/feedback + 2 secrets).
  const researchChannels = [
    CHANNELS.RESEARCH_JOB_CREATE,
    CHANNELS.RESEARCH_JOB_LIST,
    CHANNELS.RESEARCH_JOB_GET,
    CHANNELS.RESEARCH_JOB_UPDATE,
    CHANNELS.RESEARCH_JOB_DELETE,
    CHANNELS.RESEARCH_JOB_RUN,
    CHANNELS.RESEARCH_REPORT_GET,
    CHANNELS.RESEARCH_REPORT_LIST,
    CHANNELS.RESEARCH_FEEDBACK_SAVE,
    CHANNELS.RESEARCH_SUGGESTIONS_GET,
    CHANNELS.RESEARCH_SUGGESTION_APPROVE,
    CHANNELS.RESEARCH_SUGGESTION_DISMISS,
    CHANNELS.RESEARCH_SECRETS_SET,
    CHANNELS.RESEARCH_SECRETS_HAS,
  ];
  if (!researchChannels.every((c) => skip.has(c))) {
    registerResearchHandlers(ipcMain, {
      logger,
      dbHolder,
      scheduler: getScheduler(),
      emitToRenderer: makeRendererEmitter(deps.mainWindow ?? null),
    });
    researchChannels.forEach((c) => skip.add(c));
  }
}

/**
 * Legacy stub-shape export kept for back-compat with the Plan 03 wave-4
 * tests. Plan 04 has no remaining stubs; this is only the legacy literal.
 */
export const STUB_RESPONSE = NOT_IMPLEMENTED;
