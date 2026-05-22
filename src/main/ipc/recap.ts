/**
 * Plan 08-02 Task 6 — Recap IPC handlers.
 *
 * Channels:
 *   RECAP_LIST          — paginated recap rows
 *   RECAP_GET           — canonical for one iso_week
 *   RECAP_REGENERATE    — calls generateWeeklyRecap (idempotent on iso_week)
 *   RECAP_SAVE_EDITS    — zod-validated canonical upsert
 *   RECAP_FINALIZE      — stamps finalized_at + emits section diffs
 *   RECAP_EXPORT_DOCX   — Buffer → dialog.showSaveDialog → filesystem
 *   RECAP_EXPORT_PDF    — Buffer → dialog.showSaveDialog → filesystem
 *   RECAP_LIST_AUDIT    — paginated readActionAuditWindow for UI inspection
 *
 * Cron bootstrap: when `scheduler` is provided, registers the Monday-08:00
 * recap cron at startup (mirrors insights handler bootstrap).
 */
import { dialog, type IpcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  CHANNELS,
  type RecapCanonicalDto,
  type RecapRowDto,
  type RecapActionAuditRowDto,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { LLMRouter } from '../llm/router';
import { probeOllama } from '../llm/ollamaProbe';
import { getActiveProvider, hasFrontierKey } from '../secrets/safeStorage';
import { classifySensitivity } from '../llm/classifier';
import { RecapCanonicalSchema, type RecapCanonical, type RecapSectionKey } from '../recap/schema';
import {
  saveWeeklyRecap,
  getWeeklyRecap,
  listWeeklyRecaps,
  finalizeRecap,
} from '../recap/persist';
import { generateWeeklyRecap } from '../recap/generate';
import { scheduleWeeklyRecap } from '../recap/schedule';
import { readActionAuditWindow } from '../recap/audit-view';
import { exportRecapDocx } from '../recap/export/docx';
import { exportRecapPdf } from '../recap/export/pdf';

type Db = Database.Database;

export interface RecapHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  router?: LLMRouter;
  scheduler?: SchedulerHandle;
  userTzFn?: () => string;
}

function defaultUserTz(): string {
  try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function toRecapRowDto(r: ReturnType<typeof getWeeklyRecap>): RecapRowDto | null {
  if (!r) return null;
  return {
    id: r.id,
    isoWeek: r.isoWeek,
    weekStartYmd: r.weekStartYmd,
    generatedAt: r.generatedAt,
    finalizedAt: r.finalizedAt,
    canonical: r.canonical as unknown as RecapCanonicalDto,
  };
}

function isoWeekToMondaySundayIso(weekStartYmd: string): { fromIso: string; toIso: string } {
  // weekStartYmd is the Monday YMD. Window covers Mon 00:00 → Sun 23:59:59.
  const [y, m, d] = weekStartYmd.split('-').map(Number);
  const mon = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const sun = new Date(Date.UTC(y, m - 1, d + 6, 23, 59, 59, 999));
  return { fromIso: mon.toISOString(), toIso: sun.toISOString() };
}

export function registerRecapHandlers(ipcMain: IpcMain, deps: RecapHandlerDeps): void {
  const { logger, dbHolder } = deps;
  const userTzFn = deps.userTzFn ?? defaultUserTz;
  const router = deps.router ?? new LLMRouter({
    getActiveProviderFn: getActiveProvider,
    hasFrontierKeyFn: hasFrontierKey,
    classifierFn: classifySensitivity,
    ollamaReachableFn: async () => (await probeOllama()).reachable,
  });

  function db(): Db | null { return dbHolder.db; }

  // Cron bootstrap.
  if (deps.scheduler) {
    try {
      const tz = userTzFn();
      scheduleWeeklyRecap(
        '0 8 * * 1',
        tz,
        async (isoWeek) => {
          const d = db();
          if (!d) return;
          // Compute the previous Monday's YMD relative to the firing instant.
          const now = new Date();
          const dayMs = 24 * 60 * 60 * 1000;
          // Anchor to the most recent Monday before today (this week's Monday is "today" when firing).
          const prevMon = new Date(now.getTime() - 7 * dayMs);
          const ymd = `${prevMon.getUTCFullYear()}-${String(prevMon.getUTCMonth() + 1).padStart(2, '0')}-${String(prevMon.getUTCDate()).padStart(2, '0')}`;
          const { fromIso, toIso } = isoWeekToMondaySundayIso(ymd);
          await generateWeeklyRecap(d, {
            isoWeek,
            weekStartYmd: ymd,
            fromIso,
            toIso,
            router,
            logger,
          });
        },
        { scheduler: deps.scheduler, logger, dbHolder },
      );
    } catch (err) {
      logger.warn({ scope: 'recap-bootstrap', err: (err as Error).message }, 'failed to register recap cron');
    }
  }

  ipcMain.handle(CHANNELS.RECAP_LIST, async (_e, req?: unknown) => {
    const r = (req as { limit?: number } | undefined) ?? {};
    const d = db(); if (!d) return { error: 'db-locked' };
    try {
      const rows = listWeeklyRecaps(d, { limit: r.limit }).map(toRecapRowDto).filter((x): x is RecapRowDto => x !== null);
      return { rows };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RECAP_GET, async (_e, req: { isoWeek: string }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    const row = getWeeklyRecap(d, req.isoWeek);
    return { recap: toRecapRowDto(row) };
  });

  ipcMain.handle(CHANNELS.RECAP_REGENERATE, async (_e, req: { isoWeek: string; weekStartYmd: string }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    try {
      const { fromIso, toIso } = isoWeekToMondaySundayIso(req.weekStartYmd);
      const res = await generateWeeklyRecap(d, {
        isoWeek: req.isoWeek,
        weekStartYmd: req.weekStartYmd,
        fromIso, toIso,
        router, logger,
      });
      return { ok: true, recap: toRecapRowDto(res.recap), hallucinationDetected: res.hallucinationDetected };
    } catch (err) {
      logger.warn({ scope: 'recap-regenerate', err: (err as Error).message }, 'regenerate failed');
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RECAP_SAVE_EDITS, async (_e, req: { canonical: unknown }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    const parsed = RecapCanonicalSchema.safeParse(req.canonical);
    if (!parsed.success) {
      return { error: 'INVALID_CANONICAL', issues: parsed.error.issues };
    }
    try {
      const recap = saveWeeklyRecap(d, {
        isoWeek: parsed.data.isoWeek,
        weekStartYmd: parsed.data.weekStartYmd,
        canonical: parsed.data,
      });
      return { ok: true, recap: toRecapRowDto(recap) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(CHANNELS.RECAP_FINALIZE, async (_e, req: {
    isoWeek: string;
    sectionEdits: Array<{ sectionKey: RecapSectionKey; beforeText: string; afterText: string; category?: string | null }>;
  }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    try {
      const res = finalizeRecap(d, { isoWeek: req.isoWeek, sectionEdits: req.sectionEdits ?? [] });
      return { ok: true, ...res };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  async function exportToFile(buf: Buffer, defaultName: string, ext: 'docx' | 'pdf'): Promise<{ ok: true; path: string } | { error: string }> {
    const res = await dialog.showSaveDialog({
      title: `Export recap as ${ext.toUpperCase()}`,
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return { error: 'CANCELLED' };
    await fs.writeFile(res.filePath, buf);
    return { ok: true, path: res.filePath };
  }

  ipcMain.handle(CHANNELS.RECAP_EXPORT_DOCX, async (_e, req: { isoWeek: string }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    const row = getWeeklyRecap(d, req.isoWeek);
    if (!row) return { error: 'recap-not-found' };
    try {
      const buf = await exportRecapDocx(row.canonical as RecapCanonical);
      const safeName = `aria-recap-${row.isoWeek}.docx`;
      return await exportToFile(buf, path.join('.', safeName), 'docx');
    } catch (err) {
      logger.warn({ scope: 'recap-export-docx', err: (err as Error).message }, 'docx export failed');
      return { error: 'EXPORT_FAILED' };
    }
  });

  ipcMain.handle(CHANNELS.RECAP_EXPORT_PDF, async (_e, req: { isoWeek: string }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    const row = getWeeklyRecap(d, req.isoWeek);
    if (!row) return { error: 'recap-not-found' };
    try {
      const buf = await exportRecapPdf(row.canonical as RecapCanonical);
      const safeName = `aria-recap-${row.isoWeek}.pdf`;
      return await exportToFile(buf, path.join('.', safeName), 'pdf');
    } catch (err) {
      logger.warn({ scope: 'recap-export-pdf', err: (err as Error).message }, 'pdf export failed');
      return { error: 'EXPORT_FAILED' };
    }
  });

  ipcMain.handle(CHANNELS.RECAP_LIST_AUDIT, async (_e, req?: { fromIso?: string; toIso?: string; limit?: number }) => {
    const d = db(); if (!d) return { error: 'db-locked' };
    try {
      const rows = readActionAuditWindow(d, req ?? {});
      const dto: RecapActionAuditRowDto[] = rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        occurredAt: r.occurredAt,
        provider: r.provider,
        resource: r.resource,
        approvalId: r.approvalId,
        payload: r.payload,
        outcome: r.outcome,
      }));
      return { rows: dto };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}
