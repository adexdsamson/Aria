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
import { listProviderAccounts } from '../integrations/microsoft/provider-account';
import type { ProviderAccountRow } from '../integrations/microsoft/types';

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

// ─── Plan 04-03 e2e harness state ──────────────────────────────────────────
interface E2eCalendarMock {
  /** Recorded patchEvent / insertEvent calls. */
  calls: Array<{ kind: 'patch' | 'insert'; args: unknown }>;
  /** patchEvent / insertEvent return value. */
  ok: boolean;
  /** Optional canned busy list for freebusyQuery. */
  busy: Array<{ start: string; end: string }>;
}
const e2eCal: E2eCalendarMock = { calls: [], ok: true, busy: [] };

const ARIA_E2E_SEED_CAL_EVENT = 'aria:scheduling:__e2e_seed_event__';
const ARIA_E2E_SET_CAL_MOCK = 'aria:scheduling:__e2e_set_mock__';
const ARIA_E2E_GET_CAL_CALLS = 'aria:scheduling:__e2e_get_calls__';
const ARIA_E2E_CLEAR_CAL_CALLS = 'aria:scheduling:__e2e_clear_calls__';
const ARIA_E2E_READ_AUDIT = 'aria:scheduling:__e2e_read_audit__';

export async function buildE2eCalendarClientForApproveDispatch(): Promise<CalendarClient> {
  return buildE2eCalendarClient();
}

function buildE2eCalendarClient(): CalendarClient {
  return {
    listEvents: async () => ({ items: [] }),
    listEventsWindow: async () => ({ items: [] }),
    getCalendarMetadata: async () => ({ email: 'e2e@example.com' }),
    patchEvent: async (args: { eventId: string }) => {
      e2eCal.calls.push({ kind: 'patch', args });
      if (!e2eCal.ok) throw new Error('e2e-mocked-failure');
      return { id: args.eventId, etag: 'etag-new' };
    },
    insertEvent: async (args: unknown) => {
      e2eCal.calls.push({ kind: 'insert', args });
      if (!e2eCal.ok) throw new Error('e2e-mocked-failure');
      return { id: 'new-event-id', etag: 'etag-new' };
    },
    eventsInstances: async () => [],
    freebusyQuery: async () => ({
      calendars: { primary: { busy: e2eCal.busy.slice() } },
    }),
    getCalendarSettings: async () => ({ timeZone: 'UTC' }),
  } as unknown as CalendarClient;
}

export function registerSchedulingHandlers(
  ipcMain: IpcMain,
  deps: SchedulingDeps,
): void {
  const { logger, dbHolder } = deps;

  // E2E harness gated by env var so production never exposes it.
  if (process.env.ARIA_E2E === '1') {
    ipcMain.handle(ARIA_E2E_SEED_CAL_EVENT, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return { error: 'DB_NOT_OPEN' };
      const r = (req ?? {}) as {
        id?: string;
        summary?: string;
        startUtc?: string;
        endUtc?: string;
        attendees?: Array<{ email: string }>;
        organizerEmail?: string;
        organizerSelf?: 0 | 1;
      };
      const id = r.id ?? `e2e-evt-${Date.now()}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO calendar_event
         (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
          start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
          etag, organizer_email, organizer_self)
         VALUES (?, 'primary', ?, NULL, ?, ?, NULL, NULL,
                 'UTC', ?, 'confirmed', NULL, ?, ?, 'etag-1', ?, ?)`,
      ).run(
        id,
        r.summary ?? '3pm sync',
        r.startUtc ?? '2026-05-18T15:00:00.000Z',
        r.endUtc ?? '2026-05-18T16:00:00.000Z',
        JSON.stringify(r.attendees ?? []),
        now,
        now,
        r.organizerEmail ?? 'me@example.com',
        r.organizerSelf ?? 1,
      );
      return { id };
    });
    ipcMain.handle(ARIA_E2E_SET_CAL_MOCK, async (_e, req: unknown) => {
      const r = (req ?? {}) as Partial<E2eCalendarMock>;
      e2eCal.ok = r.ok ?? true;
      e2eCal.busy = r.busy ?? [];
      e2eCal.calls = [];
      return { ok: true };
    });
    ipcMain.handle(ARIA_E2E_GET_CAL_CALLS, async () => ({ calls: e2eCal.calls.slice() }));
    ipcMain.handle(ARIA_E2E_CLEAR_CAL_CALLS, async () => {
      e2eCal.calls = [];
      return { ok: true };
    });
    ipcMain.handle(ARIA_E2E_READ_AUDIT, async (_e, req: unknown) => {
      const db = dbHolder.db;
      if (!db) return { error: 'DB_NOT_OPEN' };
      const r = (req ?? {}) as { approvalId?: string };
      if (!r.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
      const rows = db
        .prepare(
          `SELECT phase, event_id, recurring_scope FROM calendar_action_log
           WHERE approval_id = ? ORDER BY id ASC`,
        )
        .all(r.approvalId);
      return { rows };
    });
  }

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
    if (process.env.ARIA_E2E === '1') return buildE2eCalendarClient();
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
      const account = listProviderAccounts(db).find((row) => {
        if (row.providerKey !== 'google' && row.providerKey !== 'microsoft') return false;
        if (row.status !== 'ok') return false;
        if (!row.capabilitiesJson) return true;
        try {
          return Boolean((JSON.parse(row.capabilitiesJson) as { calendar?: boolean }).calendar);
        } catch {
          return true;
        }
      }) as (ProviderAccountRow & { providerKey: 'google' | 'microsoft' }) | undefined;
      const client = account ? undefined : await buildClient();
      const userEmail = account
        ? account.displayEmail
        : deps.getUserEmail
          ? await deps.getUserEmail()
          : 'user@local';
      return await proposeCalendarChange(nl, {
        db,
        client,
        userEmail,
        providerKey: account?.providerKey,
        accountId: account?.accountId,
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
