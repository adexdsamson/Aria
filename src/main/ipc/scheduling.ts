/**
 * Plan 04-02 Task 1 — scheduling rules IPC handlers.
 *
 * Wires SCHEDULING_RULES_GET / SCHEDULING_RULES_SET. SET re-validates the
 * incoming payload via RulesSchema.safeParse (renderer is untrusted) and
 * returns `{error: 'INVALID_RULES', issues}` on failure so the form can
 * surface Zod issues under the advanced-JSON drawer.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { RulesSchema } from '../../shared/scheduling-rules';
import { getRules, setRules, getUpdatedAt } from '../scheduling/rules';

export interface SchedulingDeps {
  logger: Logger;
  dbHolder: DbHolder;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

export function registerSchedulingHandlers(
  ipcMain: IpcMain,
  deps: SchedulingDeps,
): void {
  const { logger, dbHolder } = deps;

  ipcMain.handle(CHANNELS.SCHEDULING_RULES_GET, async () => {
    const db = dbHolder.db;
    if (!db) return notReady();
    try {
      const rules = getRules(db);
      return {
        rules,
        timeZone: rules.timeZone,
        updatedAt: getUpdatedAt(db),
      };
    } catch (err) {
      logger.warn({
        event: 'scheduling.rules.get.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.SCHEDULING_RULES_SET, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as { rules?: unknown };
    const parsed = RulesSchema.safeParse(r.rules);
    if (!parsed.success) {
      return { error: 'INVALID_RULES' as const, issues: parsed.error.issues };
    }
    try {
      setRules(db, parsed.data);
      logger.info({ event: 'scheduling.rules.set', timeZone: parsed.data.timeZone });
      return { ok: true as const };
    } catch (err) {
      logger.warn({
        event: 'scheduling.rules.set.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
