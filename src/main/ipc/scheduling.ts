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
import {
  proposeCalendarChange,
  type ProposeDeps,
  type ProposeOutcome,
} from '../scheduling/propose';
import type { CalendarClient } from '../integrations/google/calendar';
import {
  createCalendarClient,
} from '../integrations/google/calendar';
import { getOAuth2Client } from '../integrations/google/auth';
import { logCalendarAction } from '../scheduling/audit';
import { getApproval, transitionTo } from '../approvals/persist';

export interface SchedulingDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Override the CalendarClient builder (tests / E2E). */
  buildCalendarClient?: () => Promise<CalendarClient>;
  /** Override the propose orchestrator deps (tests / E2E). */
  proposeOverrides?: Partial<ProposeDeps>;
  /** User email for self-only gate; defaults to the connected calendar email. */
  getUserEmail?: () => Promise<string>;
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

  // ─── Plan 04-03 propose pipeline ──────────────────────────────────────
  async function buildClient(): Promise<CalendarClient> {
    if (deps.buildCalendarClient) return deps.buildCalendarClient();
    const auth = getOAuth2Client('calendar');
    if (!auth) throw new Error('calendar-not-connected');
    return createCalendarClient(auth);
  }

  async function runPropose(
    nl: string,
    extra: Partial<ProposeDeps> = {},
  ): Promise<ProposeOutcome | { error: string }> {
    const db = dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    try {
      const client = await buildClient();
      const userEmail = deps.getUserEmail
        ? await deps.getUserEmail()
        : 'user@local';
      return await proposeCalendarChange(nl, {
        db,
        client,
        userEmail,
        ...(deps.proposeOverrides ?? {}),
        ...extra,
      });
    } catch (err) {
      logger.warn({
        event: 'scheduling.propose.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  ipcMain.handle(CHANNELS.SCHEDULING_PROPOSE, async (_e, req: unknown) => {
    const r = (req ?? {}) as { nl?: string };
    if (typeof r.nl !== 'string' || !r.nl.trim()) {
      return { error: 'INVALID_REQUEST' };
    }
    return runPropose(r.nl);
  });

  ipcMain.handle(CHANNELS.SCHEDULING_CONFIRM_TARGET, async (_e, req: unknown) => {
    const r = (req ?? {}) as { nl?: string; eventId?: string };
    if (typeof r.nl !== 'string' || typeof r.eventId !== 'string') {
      return { error: 'INVALID_REQUEST' };
    }
    return runPropose(r.nl, { resolveDeps: { forceEventId: r.eventId } });
  });

  ipcMain.handle(CHANNELS.SCHEDULING_OVERRIDE, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    const r = (req ?? {}) as { approvalId?: string; reason?: string };
    if (typeof r.approvalId !== 'string' || typeof r.reason !== 'string') {
      return { error: 'INVALID_REQUEST' };
    }
    try {
      const row = getApproval(db, r.approvalId);
      if (!row) return { error: 'NOT_FOUND' };
      const existing = row.rule_overrides_json
        ? (JSON.parse(row.rule_overrides_json) as Array<{ reason: string; ts: string }>)
        : [];
      existing.push({ reason: r.reason, ts: new Date().toISOString() });
      const overridesJson = JSON.stringify(existing);
      // Patch via transitionTo no-op (state→state would fail; use direct prepared
      // statement bounded to rule_overrides_json column).
      db.prepare(
        `UPDATE approval SET rule_overrides_json = ?, updated_at = ? WHERE id = ?`,
      ).run(overridesJson, new Date().toISOString(), r.approvalId);
      logCalendarAction(db, {
        approval_id: r.approvalId,
        phase: 'override',
        event_id: row.calendar_event_id,
        recurring_scope: row.recurring_scope,
        rule_overrides_json: overridesJson,
      });
      return { ok: true as const };
    } catch (err) {
      logger.warn({
        event: 'scheduling.override.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Reference to keep transitionTo import live for future use.
  void transitionTo;

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
