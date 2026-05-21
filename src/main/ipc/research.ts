/**
 * Phase 11 Plan 02 — Research IPC handlers.
 *
 * Registers all 12 research job/report/feedback channels plus 2 research
 * secrets channels. assertEntitled is called ONLY for research_create and
 * research_run — per the design spec and static ratchet enforcer.
 *
 * Static ratchet: tests/static/single-entitlement-gate-site.test.ts GATED_SITES
 * includes this file for 'research_create' and 'research_run'.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type ResearchJobDto, type ResearchReportDto, type ResearchReportSectionDto, type ResearchFeedbackDto } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { assertEntitled } from '../entitlement/gate';
import {
  createResearchJob,
  runResearchJob,
  scheduleResearchJob,
  cancelResearchJobSchedule,
} from '../services/ResearchService';
import { setProviderTokens, getProviderTokens } from '../secrets/safeStorage';

type Db = import('better-sqlite3-multiple-ciphers').Database;

export interface ResearchHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler?: SchedulerHandle;
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ResearchJobRow {
  id: string;
  title: string;
  goals: string;
  domains_json: string;
  status: string;
  schedule_interval: string;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ResearchReportRow {
  id: string;
  job_id: string;
  version: number;
  status: string;
  trigger: string;
  summary: string | null;
  confidence_score: number | null;
  error_message: string | null;
  generated_at: string | null;
}

interface ResearchReportSectionRow {
  id: string;
  report_id: string;
  section_type: string;
  ordinal: number;
  content_json: string;
}

interface ResearchFeedbackRow {
  id: string;
  report_id: string;
  section_id: string | null;
  thumb: number | null;
  note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapJob(row: ResearchJobRow): ResearchJobDto {
  let domains: string[] = [];
  try {
    domains = JSON.parse(row.domains_json) as string[];
  } catch {
    domains = [];
  }
  return {
    id: row.id,
    title: row.title,
    goals: row.goals,
    domains,
    status: row.status as ResearchJobDto['status'],
    scheduleInterval: row.schedule_interval as ResearchJobDto['scheduleInterval'],
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSection(row: ResearchReportSectionRow, feedback?: ResearchFeedbackDto | null): ResearchReportSectionDto {
  return {
    id: row.id,
    reportId: row.report_id,
    sectionType: row.section_type,
    ordinal: row.ordinal,
    contentJson: row.content_json,
    feedback,
  };
}

function mapFeedback(row: ResearchFeedbackRow): ResearchFeedbackDto {
  return {
    id: row.id,
    reportId: row.report_id,
    sectionId: row.section_id,
    thumb: row.thumb as 1 | -1 | null,
    note: row.note,
    createdAt: row.created_at,
  };
}

function loadReport(db: Db, reportId: string): ResearchReportDto | null {
  const reportRow = db
    .prepare(`SELECT id, job_id, version, status, trigger, summary, confidence_score, error_message, generated_at FROM research_report WHERE id = ?`)
    .get(reportId) as ResearchReportRow | undefined;
  if (!reportRow) return null;

  const sectionRows = db
    .prepare(`SELECT id, report_id, section_type, ordinal, content_json FROM research_report_section WHERE report_id = ? ORDER BY ordinal ASC`)
    .all(reportId) as ResearchReportSectionRow[];

  const feedbackRows = db
    .prepare(`SELECT id, report_id, section_id, thumb, note, created_at FROM research_feedback WHERE report_id = ?`)
    .all(reportId) as ResearchFeedbackRow[];
  const feedbackBySection = new Map<string | null, ResearchFeedbackDto>();
  for (const fb of feedbackRows) {
    feedbackBySection.set(fb.section_id, mapFeedback(fb));
  }

  const sections = sectionRows.map((s) => mapSection(s, feedbackBySection.get(s.id) ?? null));

  return {
    id: reportRow.id,
    jobId: reportRow.job_id,
    version: reportRow.version,
    status: reportRow.status as ResearchReportDto['status'],
    trigger: reportRow.trigger as ResearchReportDto['trigger'],
    summary: reportRow.summary,
    confidenceScore: reportRow.confidence_score,
    errorMessage: reportRow.error_message,
    generatedAt: reportRow.generated_at,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerResearchHandlers(
  ipcMain: IpcMain,
  deps: ResearchHandlerDeps,
): void {
  const { logger, dbHolder } = deps;

  // ── RESEARCH_JOB_CREATE ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_CREATE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      await assertEntitled(db, 'research_create');
      const input = req as { title: string; goals?: string; domains?: string[]; scheduleInterval?: 'none' | 'daily' | 'weekly' };
      const { id } = createResearchJob(db, input);
      if (input.scheduleInterval && input.scheduleInterval !== 'none' && deps.scheduler) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        scheduleResearchJob(id, input.scheduleInterval, tz, async () => {
          await runResearchJob(db, id, { logger, emitToRenderer: deps.emitToRenderer, scheduler: deps.scheduler }, { trigger: 'schedule' });
        }, { scheduler: deps.scheduler, logger });
      }
      const jobRow = db.prepare(`SELECT * FROM research_job WHERE id = ?`).get(id) as ResearchJobRow;
      return { job: mapJob(jobRow) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobCreate failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_JOB_LIST ────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_LIST, async () => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const rows = db.prepare(`SELECT * FROM research_job ORDER BY created_at DESC`).all() as ResearchJobRow[];
      return { jobs: rows.map(mapJob) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobList failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_JOB_GET ─────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_GET, async (_e, req: { id: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const row = db.prepare(`SELECT * FROM research_job WHERE id = ?`).get(req.id) as ResearchJobRow | undefined;
      return { job: row ? mapJob(row) : null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobGet failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_JOB_UPDATE ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_UPDATE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const input = req as { id: string; title?: string; goals?: string; domains?: string[]; scheduleInterval?: 'none' | 'daily' | 'weekly' };
      const now = new Date().toISOString();
      const existing = db.prepare(`SELECT * FROM research_job WHERE id = ?`).get(input.id) as ResearchJobRow | undefined;
      if (!existing) return { error: 'not-found' } as const;
      db.prepare(
        `UPDATE research_job SET title = COALESCE(?, title), goals = COALESCE(?, goals), domains_json = COALESCE(?, domains_json), schedule_interval = COALESCE(?, schedule_interval), updated_at = ? WHERE id = ?`,
      ).run(
        input.title ?? null,
        input.goals ?? null,
        input.domains != null ? JSON.stringify(input.domains) : null,
        input.scheduleInterval ?? null,
        now,
        input.id,
      );
      // If schedule changed, cancel old and register new
      if (input.scheduleInterval != null && input.scheduleInterval !== existing.schedule_interval && deps.scheduler) {
        cancelResearchJobSchedule(input.id, deps.scheduler);
        if (input.scheduleInterval !== 'none') {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          scheduleResearchJob(input.id, input.scheduleInterval, tz, async () => {
            await runResearchJob(db, input.id, { logger, emitToRenderer: deps.emitToRenderer, scheduler: deps.scheduler }, { trigger: 'schedule' });
          }, { scheduler: deps.scheduler, logger });
        }
      }
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobUpdate failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_JOB_DELETE ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_DELETE, async (_e, req: { id: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      if (deps.scheduler) cancelResearchJobSchedule(req.id, deps.scheduler);
      db.prepare(`DELETE FROM research_job WHERE id = ?`).run(req.id);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobDelete failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_JOB_RUN ─────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_JOB_RUN, async (_e, req: { jobId: string; feedbackContext?: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      await assertEntitled(db, 'research_run');
      void runResearchJob(
        db,
        req.jobId,
        { logger, emitToRenderer: deps.emitToRenderer, scheduler: deps.scheduler },
        { trigger: 'manual', feedbackContext: req.feedbackContext },
      ).catch((err) => {
        logger.warn({ scope: 'research', err: String(err) }, 'runResearchJob background failed');
      });
      return { ok: true as const, reportId: '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchJobRun failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_REPORT_GET ──────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_REPORT_GET, async (_e, req: { reportId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      return { report: loadReport(db, req.reportId) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchReportGet failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_REPORT_LIST ─────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_REPORT_LIST, async (_e, req: { jobId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const rows = db
        .prepare(`SELECT id FROM research_report WHERE job_id = ? ORDER BY version DESC`)
        .all(req.jobId) as { id: string }[];
      const reports: ResearchReportDto[] = [];
      for (const { id } of rows) {
        const r = loadReport(db, id);
        if (r) reports.push(r);
      }
      return { reports };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchReportList failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_FEEDBACK_SAVE ───────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_FEEDBACK_SAVE, async (_e, req: { reportId: string; sectionId: string | null; thumb: 1 | -1 | null; note: string | null }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO research_feedback (id, report_id, section_id, thumb, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, req.reportId, req.sectionId ?? null, req.thumb ?? null, req.note ?? null, now);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchFeedbackSave failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_SUGGESTIONS_GET ─────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_SUGGESTIONS_GET, async () => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const rows = db.prepare(`SELECT * FROM research_job WHERE status = 'draft' ORDER BY created_at DESC`).all() as ResearchJobRow[];
      return { jobs: rows.map(mapJob) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchSuggestionsGet failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_SUGGESTION_APPROVE ──────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_SUGGESTION_APPROVE, async (_e, req: { jobId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const now = new Date().toISOString();
      db.prepare(`UPDATE research_job SET status = 'done', updated_at = ? WHERE id = ?`).run(now, req.jobId);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchSuggestionApprove failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_SUGGESTION_DISMISS ──────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_SUGGESTION_DISMISS, async (_e, req: { jobId: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      db.prepare(`DELETE FROM research_job WHERE id = ?`).run(req.jobId);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchSuggestionDismiss failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_SECRETS_SET ─────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_SECRETS_SET, async (_e, req: { provider: 'brave' | 'exa'; key: string }) => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const storageKey = req.provider === 'brave' ? 'aria.research.braveApiKey' : 'aria.research.exaApiKey';
      setProviderTokens(storageKey, req.key);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchSecretsSet failed');
      return { error: msg } as const;
    }
  });

  // ── RESEARCH_SECRETS_HAS ─────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.RESEARCH_SECRETS_HAS, async () => {
    const db = dbHolder.db;
    if (!db) return { error: 'db-locked' } as const;
    try {
      const hasBrave = !!getProviderTokens('aria.research.braveApiKey');
      const hasExa = !!getProviderTokens('aria.research.exaApiKey');
      return { hasBrave, hasExa };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ scope: 'research', err: msg }, 'researchSecretsHas failed');
      return { error: msg } as const;
    }
  });
}
