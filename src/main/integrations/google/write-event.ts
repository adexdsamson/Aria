/**
 * Plan 04-01 Task 3 — Calendar write-back chokepoint.
 *
 * THE ONLY call site for Google Calendar `events.patch` / `events.insert`
 * outside of the CalendarClient wrapper (`calendar.ts`). The static-grep
 * test `tests/static/single-calendar-write-site.test.ts` asserts this
 * invariant; CI fails if a second site is added.
 *
 * Write authorization is gated by `assertApproved` as the FIRST executable
 * line of `applyCalendarChange`. Any caller attempting to apply a row that
 * is not in state='approved' throws ApprovalGateError and Google APIs are
 * NEVER reached (T-04-01-01 mitigation, mirrors send.ts).
 *
 * calendar_action_log rows are written on BOTH success and failure paths so
 * we always have a forensic trail (T-04-01-03). Approval row transitions
 * `approved -> sent` ONLY when every Google API op succeeds.
 *
 * sendUpdates is hard-coded to 'none' throughout this file — APPR-02
 * self-only v1. Defense-in-depth: the static-grep secondary regex asserts
 * `sendUpdates: 'all'` is NEVER present in this file (T-04-01-08).
 *
 * Recurring-event semantics: delegated entirely to `recurrence.ts`. For
 * scope='this' we additionally enforce that calendar_event_id contains an
 * underscore (instance id) BEFORE any API call (T-04-01-07 / Pitfall 3).
 *
 * Etag handling: a 412 response from `patch` translates (in calendar.ts) to
 * EtagMismatchError. We catch, write a `failed` audit row, leave approval
 * state unchanged, and rethrow so the consumer (Plan 04-03) can surface a
 * refresh prompt to the user (T-04-01-02).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { assertApproved } from '../../approvals/gate';
import { getApproval, transitionTo } from '../../approvals/persist';
import { logCalendarAction } from '../../scheduling/audit';
import {
  createCalendarClient,
  EtagMismatchError,
  InvalidInstanceIdError,
  type CalendarClient,
} from './calendar';
import { getOAuth2Client } from './auth';
import {
  computeRecurringWrite,
  type RecurringWriteOp,
  type RecurringWritePlan,
  type RecurringScope,
} from './recurrence';

type Db = Database.Database;

export interface ApplyCalendarChangeDeps {
  /** Override the CalendarClient constructor (tests). */
  buildCalendarClient?: () => Promise<CalendarClient>;
}

export interface ApplyCalendarChangeResult {
  ok: true;
  /** Provider event id of the most-recently-written op (for ops with an id). */
  eventId?: string;
}

interface ParsedBefore {
  parentId?: string;
  recurrence?: string[];
  etag?: string;
  startUtc: string;
}

function parseBefore(row: { before_json: string | null; calendar_event_id: string | null }): ParsedBefore {
  if (!row.before_json) {
    // Minimal shape — write-event.ts requires before_json so we can compute
    // recurrence ops + carry etag. Caller (planner) is responsible for
    // populating it on the approval row.
    throw new Error('apply-calendar-change: approval.before_json is required');
  }
  const obj = JSON.parse(row.before_json) as ParsedBefore;
  if (!obj.startUtc) {
    throw new Error('apply-calendar-change: before_json must include startUtc');
  }
  return obj;
}

/**
 * Apply the calendar-change approval identified by `approvalId`. FIRST LINE
 * MUST be `assertApproved(db, approvalId)` — the static grep + bypass-attempt
 * unit tests enforce this.
 */
export async function applyCalendarChange(
  db: Db,
  approvalId: string,
  deps: ApplyCalendarChangeDeps = {},
): Promise<ApplyCalendarChangeResult> {
  assertApproved(db, approvalId);

  const row = getApproval(db, approvalId);
  if (!row) {
    throw new Error(`approval-not-found:${approvalId}`);
  }
  if (row.kind !== 'calendar_change') {
    throw new Error(`apply-calendar-change: approval ${approvalId} kind=${row.kind}, expected 'calendar_change'`);
  }

  const scope = (row.recurring_scope ?? 'this') as RecurringScope;
  const eventId = row.calendar_event_id;
  if (!eventId) {
    throw new Error('apply-calendar-change: approval.calendar_event_id is required');
  }

  // Pitfall 3 — scope='this' must target an instance id (contains '_').
  if (scope === 'this' && !eventId.includes('_')) {
    throw new InvalidInstanceIdError(
      `scope='this' requires an instance event id (containing '_'); got ${eventId}`,
    );
  }

  const before = parseBefore(row);
  const change = row.after_json ? (JSON.parse(row.after_json) as Record<string, unknown>) : {};

  let plan: RecurringWritePlan;
  try {
    plan = computeRecurringWrite({
      scope,
      event: {
        id: eventId,
        parentId: before.parentId,
        recurrence: before.recurrence,
        etag: before.etag,
        startUtc: before.startUtc,
      },
      // The recurrence module only cares about a small subset; pass through.
      change: change as {
        startUtc?: string;
        endUtc?: string;
        summary?: string;
        location?: string;
        description?: string;
      },
    });
  } catch (err) {
    logCalendarAction(db, {
      approval_id: approvalId,
      phase: 'failed',
      event_id: eventId,
      recurring_scope: scope,
      before_json: row.before_json,
      after_json: row.after_json,
      rule_overrides_json: row.rule_overrides_json,
      google_error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // pre_write audit BEFORE any Google API call (T-04-01-03).
  logCalendarAction(db, {
    approval_id: approvalId,
    phase: 'pre_write',
    event_id: eventId,
    recurring_scope: scope,
    before_json: row.before_json,
    after_json: row.after_json,
    rule_overrides_json: row.rule_overrides_json,
  });

  const client = deps.buildCalendarClient
    ? await deps.buildCalendarClient()
    : await buildDefaultCalendarClient();

  let lastEventId: string | undefined;
  let lastEtag: string | undefined;
  const completed: RecurringWriteOp[] = [];

  try {
    for (const op of plan.ops) {
      if (op.kind === 'patch') {
        const res = await client.patchEvent({
          eventId: op.id,
          requestBody: op.body,
          ifMatch: op.etag,
          sendUpdates: 'none',
        });
        lastEventId = res.id;
        lastEtag = res.etag;
      } else {
        const res = await client.insertEvent({
          requestBody: op.body,
          sendUpdates: 'none',
        });
        lastEventId = res.id;
        lastEtag = res.etag;
      }
      completed.push(op);
    }
  } catch (err) {
    const errMsg = err instanceof EtagMismatchError
      ? `etag-mismatch: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);

    logCalendarAction(db, {
      approval_id: approvalId,
      phase: 'failed',
      event_id: eventId,
      recurring_scope: scope,
      before_json: row.before_json,
      after_json: row.after_json,
      rule_overrides_json: row.rule_overrides_json,
      google_error: errMsg,
    });

    // Best-effort rollback for scope='future' when the parent patch succeeded
    // but the new-series insert failed (Pitfall 4).
    if (plan.rollback && completed.length > 0 && completed.length < plan.ops.length) {
      try {
        const rollbackOps = plan.rollback();
        for (const op of rollbackOps) {
          if (op.kind === 'patch') {
            await client.patchEvent({
              eventId: op.id,
              requestBody: op.body,
              sendUpdates: 'none',
            });
          } else {
            await client.insertEvent({
              requestBody: op.body,
              sendUpdates: 'none',
            });
          }
        }
      } catch (rollbackErr) {
        logCalendarAction(db, {
          approval_id: approvalId,
          phase: 'failed',
          event_id: eventId,
          recurring_scope: scope,
          google_error: `rollback-failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        });
      }
    }

    // Row stays in 'approved' — do NOT transition to 'sent' on failure.
    throw err;
  }

  // post_write audit AFTER all Google API ops succeed.
  logCalendarAction(db, {
    approval_id: approvalId,
    phase: 'post_write',
    event_id: lastEventId ?? eventId,
    recurring_scope: scope,
    before_json: row.before_json,
    after_json: row.after_json,
    rule_overrides_json: row.rule_overrides_json,
    google_etag: lastEtag,
  });

  transitionTo(db, approvalId, 'sent', {
    sent_at: new Date().toISOString(),
  });

  return { ok: true, eventId: lastEventId ?? eventId };
}

async function buildDefaultCalendarClient(): Promise<CalendarClient> {
  const auth = getOAuth2Client('calendar');
  if (!auth) {
    throw new Error('calendar-not-connected');
  }
  return createCalendarClient(auth);
}
