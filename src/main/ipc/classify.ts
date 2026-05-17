/**
 * Plan 03-02 — `aria:classify` + `aria:routing-log:query` IPC handlers.
 *
 * `classify({text, approvalId?})` runs the two-stage sensitivity classifier and
 * returns the Zod-validated result (plus CLASSIFIER_VERSION) to the renderer.
 * The drafting agent (Plan 04) and the triage agent (Plan 03-03) call this
 * before any frontier dispatch.
 *
 * `routingLogQuery({...})` returns recent routing_log rows with classifier
 * columns, filtered by date range / route / source / category.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import {
  CHANNELS,
  type IpcError,
  type RoutingLogClassifiedRow,
  type SensitivityResultDto,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import {
  classify,
  CLASSIFIER_VERSION,
} from '../llm/sensitivityClassifier';
import { queryRoutingLog } from '../llm/routingLog';

export interface ClassifyDeps {
  logger: Logger;
  dbHolder: DbHolder;
  scheduler: SchedulerHandle;
}

export function registerClassifyHandlers(
  ipcMain: IpcMain,
  deps: ClassifyDeps,
): void {
  const { logger, dbHolder, scheduler } = deps;

  ipcMain.handle(
    CHANNELS.CLASSIFY,
    async (_event, payload: unknown): Promise<SensitivityResultDto | IpcError> => {
      const req = (payload ?? {}) as { text?: unknown };
      if (typeof req.text !== 'string' || req.text.length === 0) {
        return { error: 'classify:text-required' };
      }
      try {
        const result = await classify(req.text, scheduler.queue);
        return {
          ...result,
          classifier_version: CLASSIFIER_VERSION,
        };
      } catch (e) {
        // classify() never throws; this is defense in depth.
        logger.warn({
          event: 'classify.unexpected-throw',
          err: (e as Error).message,
        });
        return { error: 'classify:unexpected' };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.ROUTING_LOG_QUERY,
    async (
      _event,
      payload: unknown,
    ): Promise<{ rows: RoutingLogClassifiedRow[] } | IpcError> => {
      const req = (payload ?? {}) as {
        from?: string;
        to?: string;
        route?: 'LOCAL' | 'FRONTIER';
        source?: string;
        category?: string;
        limit?: number;
      };
      const db = dbHolder.db;
      if (!db) {
        return { rows: [] };
      }
      try {
        const rows = queryRoutingLog(db, req) as unknown as RoutingLogClassifiedRow[];
        return { rows };
      } catch (e) {
        logger.warn({
          event: 'routing-log.query-failed',
          err: (e as Error).message,
        });
        return { error: 'routing-log:read-failed' };
      }
    },
  );
}
