import type Database from 'better-sqlite3-multiple-ciphers';
import { assertApproved } from '../approvals/gate';
import { assertEntitled } from '../entitlement/gate';
import { getApproval, transitionTo } from '../approvals/persist';
import { logCalendarAction } from '../scheduling/audit';
import { computeRecurringWrite, type RecurringScope } from './google/recurrence';
import {
  EtagMismatchError,
  InvalidInstanceIdError,
  type CalendarClient,
} from './google/calendar';
import type { CalendarCapability, CanonicalEvent, ProviderKey } from '../../shared/provider';
import { ProviderRegistry, type ProviderRegistryDeps } from './registry';

type Db = Database.Database;

export interface ApplyCalendarChangeDeps {
  buildCalendarClient?: () => Promise<CalendarClient>;
  registry?: Pick<ProviderRegistry, 'get'>;
  registryDeps?: ProviderRegistryDeps;
}

export interface ApplyCalendarChangeResult {
  ok: true;
  eventId?: string;
}

interface ParsedBefore {
  parentId?: string;
  recurrence?: string[];
  etag?: string;
  startUtc: string;
}

function parseBefore(row: { before_json: string | null }): ParsedBefore {
  if (!row.before_json) {
    throw new Error('apply-calendar-change: approval.before_json is required');
  }
  const obj = JSON.parse(row.before_json) as ParsedBefore;
  if (!obj.startUtc) {
    throw new Error('apply-calendar-change: before_json must include startUtc');
  }
  return obj;
}

function resolveRegistry(db: Db, deps: ApplyCalendarChangeDeps): Pick<ProviderRegistry, 'get'> {
  return deps.registry ?? new ProviderRegistry(db, deps.registryDeps);
}

function asProviderKey(key: string | null): ProviderKey {
  if (key === 'microsoft') return 'microsoft';
  return 'google';
}

function supportsLegacyGoogleOverride(row: { provider_key: string | null }): boolean {
  return (row.provider_key ?? 'google') === 'google';
}

type CalendarWriter = Pick<CalendarCapability, 'patchEvent' | 'insertEvent'>;

async function buildInjectedGoogleCalendarWriter(
  deps: ApplyCalendarChangeDeps,
): Promise<CalendarWriter> {
  if (!deps.buildCalendarClient) {
    throw new Error('apply-calendar-change: buildCalendarClient missing');
  }
  const client = await deps.buildCalendarClient();
  return {
    async patchEvent(args) {
      const result = await client.patchEvent({
        eventId: args.externalId,
        requestBody: args.event as Record<string, unknown>,
        ifMatch: args.ifMatch,
        sendUpdates: args.sendUpdates ?? 'none',
      });
      return { externalId: result.id, etag: result.etag };
    },
    async insertEvent(args) {
      const result = await client.insertEvent({
        requestBody: args.event as Record<string, unknown>,
        sendUpdates: args.sendUpdates ?? 'none',
      });
      return { externalId: result.id, etag: result.etag };
    },
  };
}

export async function applyCalendarChange(
  db: Db,
  approvalId: string,
  deps: ApplyCalendarChangeDeps = {},
): Promise<ApplyCalendarChangeResult> {
  await assertEntitled(db, 'calendar_change');
  assertApproved(db, approvalId);

  const row = getApproval(db, approvalId);
  if (!row) {
    throw new Error(`approval-not-found:${approvalId}`);
  }
  if (row.kind !== 'calendar_change') {
    throw new Error(`apply-calendar-change: approval ${approvalId} kind=${row.kind}, expected 'calendar_change'`);
  }

  const providerKey = asProviderKey(row.provider_key);
  let calendar: CalendarWriter;
  if (deps.buildCalendarClient && supportsLegacyGoogleOverride(row)) {
    calendar = await buildInjectedGoogleCalendarWriter(deps);
  } else {
    const accountId = row.account_id;
    if (!accountId) {
      throw new Error(`apply-calendar-change: approval ${approvalId} missing account_id`);
    }

    const provider = resolveRegistry(db, deps).get(providerKey, accountId);
    if (!provider.calendar) {
      throw new Error(`apply-calendar-change: provider ${providerKey}:${accountId} has no calendar capability`);
    }
    calendar = provider.calendar;
  }

  const scope = (row.recurring_scope ?? 'this') as RecurringScope;
  const eventId = row.calendar_event_id;
  if (!eventId) {
    throw new Error('apply-calendar-change: approval.calendar_event_id is required');
  }

  const before = parseBefore(row);
  const isRecurring =
    Boolean(before.parentId) || (Array.isArray(before.recurrence) && before.recurrence.length > 0);
  if (scope === 'this' && isRecurring && !eventId.includes('_')) {
    throw new InvalidInstanceIdError(`scope='this' requires an instance event id (containing '_'); got ${eventId}`);
  }
  const change = row.after_json ? (JSON.parse(row.after_json) as Record<string, unknown>) : {};

  let plan;
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

  logCalendarAction(db, {
    approval_id: approvalId,
    phase: 'pre_write',
    event_id: eventId,
    recurring_scope: scope,
    before_json: row.before_json,
    after_json: row.after_json,
    rule_overrides_json: row.rule_overrides_json,
  });

  let lastEventId: string | undefined;
  let lastEtag: string | undefined;
  const completed: Array<{ kind: 'patch' | 'insert'; id?: string; body: Record<string, unknown>; etag?: string }> = [];

  try {
    for (const op of plan.ops) {
      if (op.kind === 'patch') {
        const res = await calendar.patchEvent({
          externalId: op.id,
          event: op.body as Partial<CanonicalEvent>,
          ifMatch: op.etag,
          sendUpdates: 'none',
        });
        lastEventId = res.externalId;
        lastEtag = res.etag;
        completed.push(op);
      } else {
        const res = await calendar.insertEvent({
          event: op.body as Partial<CanonicalEvent>,
          sendUpdates: 'none',
        });
        lastEventId = res.externalId;
        lastEtag = res.etag;
        completed.push(op);
      }
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

    if (plan.rollback && completed.length > 0 && completed.length < plan.ops.length) {
      try {
        for (const op of plan.rollback()) {
          if (op.kind === 'patch') {
            await calendar.patchEvent({
              externalId: op.id,
              event: op.body as Partial<CanonicalEvent>,
              sendUpdates: 'none',
            });
          } else {
            await calendar.insertEvent({
              event: op.body as Partial<CanonicalEvent>,
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

    throw err;
  }

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
