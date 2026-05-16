/**
 * DIAGNOSTICS_ROUTING_LOG IPC handler (Plan 04 Task 2).
 *
 * Returns the most recent `limit` rows (default 100) from the routing_log
 * table, newest first. Read-only (D-07).
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type IpcError, type RoutingLogEntry } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { readRecentRoutingLog } from '../llm/routingLog';

export interface DiagnosticsDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

export function registerDiagnosticsHandlers(
  ipcMain: IpcMain,
  deps: DiagnosticsDeps,
): void {
  const { logger, dbHolder } = deps;
  ipcMain.handle(
    CHANNELS.DIAGNOSTICS_ROUTING_LOG,
    async (_event, payload: unknown): Promise<RoutingLogEntry[] | IpcError> => {
      const req = (payload ?? {}) as { limit?: number };
      const limit = typeof req.limit === 'number' && req.limit > 0 ? req.limit : 100;
      const db = dbHolder.db;
      if (!db) {
        logger.warn({ event: 'diagnostics.routing-log.no-db' });
        return [];
      }
      try {
        return readRecentRoutingLog(db, limit);
      } catch (e) {
        logger.warn({ event: 'diagnostics.routing-log.read-failed', err: (e as Error).message });
        return { error: 'read-failed' };
      }
    },
  );
}
