/**
 * Plan 04-01 — recurrence-write planner.
 *
 * Pure-functional module that, given a desired change scope (this / future /
 * all), an event snapshot, and a partial change object, produces a list of
 * Google Calendar write operations the chokepoint (write-event.ts) will
 * execute in order.
 *
 * Reference: 04-RESEARCH.md §Pattern 3 (this/future/all matrix) and §Pitfalls
 * 2, 3, 4 (instance ID drift, parent-vs-instance, UNTIL split rollback).
 *
 * Three scopes:
 *
 *   scope='this'   → single PATCH on the instance event id. Caller MUST pass
 *                    the instance id (which contains an underscore, per Google
 *                    convention `<parentId>_<RFC3339Z>`). Wrapper-level guard
 *                    in write-event.ts throws InvalidInstanceIdError when the
 *                    id is missing the separator.
 *
 *   scope='all'    → single PATCH on the parent (series) event id, applying
 *                    the change to every instance.
 *
 *   scope='future' → "split" the series: PATCH the parent's RRULE with an
 *                    UNTIL clause that ends the day BEFORE the change instance,
 *                    then INSERT a brand-new event whose RRULE has UNTIL
 *                    cleared. Returns a rollback() callback that produces an
 *                    ops list to restore the original parent RRULE if the
 *                    INSERT fails (Pitfall 4).
 *
 * sendUpdates is hard-coded to 'none' here — APPR-02 self-only v1 (Phase 4
 * CONTEXT). The write-event.ts chokepoint also enforces this via static grep.
 */
import { RRule } from 'rrule';

export type RecurringScope = 'this' | 'future' | 'all';

export interface RecurringWriteEvent {
  /** Either an instance id (`<parent>_<dtZ>`) or a parent/series id. */
  id: string;
  /** Parent series id when `id` itself is an instance. Required for
   *  scope='future' (we need to PATCH the parent's RRULE). */
  parentId?: string;
  /** RFC 5545 RRULE strings on the parent event. */
  recurrence?: string[];
  etag?: string;
  /** UTC ISO-8601 start of the (instance) event the user is modifying. */
  startUtc: string;
}

export interface RecurringWriteChange {
  startUtc?: string;
  endUtc?: string;
  summary?: string;
  location?: string;
  description?: string;
}

export interface RecurringWriteOpPatch {
  kind: 'patch';
  id: string;
  etag?: string;
  body: Record<string, unknown>;
  sendUpdates: 'none';
}
export interface RecurringWriteOpInsert {
  kind: 'insert';
  body: Record<string, unknown>;
  sendUpdates: 'none';
}
export type RecurringWriteOp = RecurringWriteOpPatch | RecurringWriteOpInsert;

export interface RecurringWritePlan {
  ops: RecurringWriteOp[];
  /** Returns ops to restore original state if a later op fails. Only set
   *  for scope='future' (Pitfall 4). */
  rollback?: () => RecurringWriteOp[];
}

export interface ComputeRecurringWriteInput {
  scope: RecurringScope;
  event: RecurringWriteEvent;
  change: RecurringWriteChange;
}

/**
 * Build the body fragment to send to Google. We map our domain change shape
 * to Calendar v3's nested {start, end} fields when timestamps are present.
 */
function changeToBody(change: RecurringWriteChange): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (change.startUtc) body.start = { dateTime: change.startUtc };
  if (change.endUtc) body.end = { dateTime: change.endUtc };
  if (change.summary !== undefined) body.summary = change.summary;
  if (change.location !== undefined) body.location = change.location;
  if (change.description !== undefined) body.description = change.description;
  return body;
}

/**
 * Compute UNTIL for the "future" split: the boundary is the instant just
 * BEFORE the modified instance's start, so the prior instances remain on the
 * original series. We use a 1-second backstep then format as UTC basic-ISO
 * RFC 5545 `YYYYMMDDTHHMMSSZ`.
 */
function rfc5545UntilBefore(startUtc: string): Date {
  const d = new Date(startUtc);
  d.setUTCSeconds(d.getUTCSeconds() - 1);
  return d;
}

/**
 * Plan the write operations for the requested scope. Throws Error if a
 * required field is missing for the given scope (e.g. parentId for 'future').
 */
export function computeRecurringWrite(
  input: ComputeRecurringWriteInput,
): RecurringWritePlan {
  const { scope, event, change } = input;
  const body = changeToBody(change);

  if (scope === 'this') {
    // The caller is responsible for ensuring event.id is an instance id; the
    // write-event.ts chokepoint guards this with InvalidInstanceIdError.
    return {
      ops: [
        {
          kind: 'patch',
          id: event.id,
          etag: event.etag,
          body,
          sendUpdates: 'none',
        },
      ],
    };
  }

  if (scope === 'all') {
    // 'all' modifies the entire series. We expect parentId when the caller
    // passed an instance id; otherwise event.id IS the series id.
    const targetId = event.parentId ?? event.id;
    return {
      ops: [
        {
          kind: 'patch',
          id: targetId,
          etag: event.etag,
          body,
          sendUpdates: 'none',
        },
      ],
    };
  }

  // scope === 'future'
  const parentId = event.parentId ?? event.id;
  const rrules = event.recurrence ?? [];
  const rruleString = rrules.find((s) => s.startsWith('RRULE:'));
  if (!rruleString) {
    throw new Error('computeRecurringWrite: scope=future requires event.recurrence with an RRULE');
  }

  // Parse parent RRULE, set UNTIL just before the modified instance.
  const original = RRule.fromString(rruleString);
  const until = rfc5545UntilBefore(event.startUtc);
  const truncated = new RRule({ ...original.options, until });
  const truncatedString = truncated.toString();

  // New series starts at the modified instance time, original RRULE without
  // UNTIL (clear it so the new series continues indefinitely / per original
  // count cadence). We keep the same FREQ/INTERVAL/BYDAY.
  const cleared = new RRule({ ...original.options, until: null as unknown as Date });
  const newSeriesString = cleared.toString();

  const newSeriesBody: Record<string, unknown> = {
    ...body,
    start: body.start ?? { dateTime: change.startUtc ?? event.startUtc },
    recurrence: [newSeriesString],
  };
  if (body.end) newSeriesBody.end = body.end;

  const ops: RecurringWriteOp[] = [
    {
      kind: 'patch',
      id: parentId,
      etag: event.etag,
      body: { recurrence: [truncatedString] },
      sendUpdates: 'none',
    },
    {
      kind: 'insert',
      body: newSeriesBody,
      sendUpdates: 'none',
    },
  ];

  // Rollback restores the original parent RRULE. Used by the chokepoint when
  // the INSERT fails after the parent PATCH succeeded (Pitfall 4).
  const rollback = (): RecurringWriteOp[] => [
    {
      kind: 'patch',
      id: parentId,
      // No etag — we accept any etag during rollback (compensating action).
      body: { recurrence: [rruleString] },
      sendUpdates: 'none',
    },
  ];

  return { ops, rollback };
}
