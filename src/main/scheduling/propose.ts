/**
 * Plan 04-03 Task 3 — proposeCalendarChange orchestrator.
 *
 * Flow:
 *   1. parseIntent(nl)            — throws IntentRefusedError on cancel/parse fail.
 *   2. resolveTarget(intent, db)  — throws NeedsClarificationError on ambiguity.
 *   3. assertSelfOnly(event)      — throws SelfOnlyGateError on multi-attendee.
 *   4. client.freebusyQuery       — single batched call ±14d.
 *   5. loadActiveRules(db).
 *   6. detectConflictsAndAlternatives — pure function (04-02).
 *   7. insertApproval kind='calendar_change' state='ready' with all *_json
 *      payload columns + before_json (etag, parentId, recurrence, startUtc)
 *      so applyCalendarChange chokepoint has everything it needs.
 *   8. logCalendarAction phase='proposed'.
 *
 * Errors translated to ProposeRefusal / ProposeClarification result types so
 * the renderer never receives raw exception strings.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { CalendarClient } from '../integrations/google/calendar';
import type { ProviderKey } from '../../shared/provider';
import { ProviderRegistry, type ProviderRegistryDeps } from '../integrations/registry';
import { getProviderAccount } from '../integrations/microsoft/provider-account';
import { parseIntent, IntentRefusedError, type Intent, type ParseIntentDeps } from './intent';
import {
  resolveTarget,
  NeedsClarificationError,
  type ResolvedTarget,
  type ResolveDeps,
} from './resolver';
import { assertSelfOnly, SelfOnlyGateError, type IdentitySet } from './self-only-gate';
import { loadActiveRules } from './rules';
import {
  detectConflictsAndAlternatives,
  type ConflictReport,
  type AlternativeSlot,
} from './conflict';
import { insertApproval } from '../approvals/persist';
import { transitionTo } from '../approvals/persist';
import { logCalendarAction } from './audit';

type Db = Database.Database;
type CalendarProviderKey = Extract<ProviderKey, 'google' | 'microsoft'>;

export interface ProposeResult {
  approvalId: string;
  primaryFeasible: boolean;
  conflicts: ConflictReport[];
  alternatives: AlternativeSlot[];
  warnings: string[];
}
export interface ProposeClarification {
  needsClarification: true;
  candidates: Array<{ eventId: string; summary: string; startUtc: string }>;
}
export interface ProposeRefusal {
  refused: true;
  code: 'cancel-not-in-v1' | 'multi-attendee' | 'no-match' | 'parse-failed';
  message: string;
  /** Dev-only — populated when ARIA_DEBUG=1. Helps diagnose model output / cache mismatch during UAT. */
  debug?: {
    intent?: unknown;
    candidates?: Array<{ id: string; summary: string; startUtc: string | null }>;
    gate?: {
      code: string;
      userEmail: string;
      organizer: unknown;
      attendees: unknown;
    };
  };
}

export type ProposeOutcome = ProposeResult | ProposeClarification | ProposeRefusal;

export interface ProposeDeps {
  db: Db;
  /** Pre-built CalendarClient or factory; tests inject a fake. */
  client?: CalendarClient;
  userEmail?: string;
  providerKey?: CalendarProviderKey;
  accountId?: string;
  identitySet?: IdentitySet;
  registry?: ProviderRegistry;
  registryDeps?: ProviderRegistryDeps;
  /** Hand off to parseIntent. */
  parseIntentDeps?: ParseIntentDeps;
  /** Hand off to resolveTarget — used for confirmTarget short-circuit. */
  resolveDeps?: ResolveDeps;
  /** Override "now" for deterministic tests. */
  nowIso?: string;
  /**
   * Test seam — replaces parseIntent entirely with a deterministic Intent or
   * a thrown error. When set, the NL string is ignored.
   */
  intentFn?: (nl: string) => Promise<Intent>;
}

interface FreeBusyClient {
  freebusyQuery(args: { timeMin: string; timeMax: string; calendarIds: string[] }): Promise<{
    calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
  }>;
}

function fallbackIdentity(userEmail: string | undefined): IdentitySet {
  const email = userEmail ?? 'user@local';
  return { primaryEmail: email, aliases: [email] };
}

function resolveAccountIdentity(deps: ProposeDeps): IdentitySet {
  if (deps.identitySet) return deps.identitySet;
  if (deps.providerKey && deps.accountId) {
    const account = getProviderAccount(deps.db, deps.providerKey, deps.accountId);
    if (!account) {
      throw new Error(`unknown account: ${deps.providerKey}:${deps.accountId}`);
    }
    return account.identitySet ?? {
      primaryEmail: account.displayEmail,
      aliases: [],
    };
  }
  return fallbackIdentity(deps.userEmail);
}

function primaryEmailOf(identitySet: IdentitySet): string {
  return identitySet.primaryEmail;
}

function resolveCalendarClient(deps: ProposeDeps): FreeBusyClient {
  if (deps.providerKey && deps.accountId) {
    const registry = deps.registry ?? new ProviderRegistry(deps.db, deps.registryDeps);
    const provider = registry.get(deps.providerKey, deps.accountId);
    if (!provider.calendar) {
      throw new Error(`calendar-not-available:${deps.providerKey}:${deps.accountId}`);
    }
    return {
      async freebusyQuery(args) {
        const calendars = await provider.calendar!.freeBusy({
          startDateTime: args.timeMin,
          endDateTime: args.timeMax,
          calendarIds: args.calendarIds,
        });
        return {
          calendars: Object.fromEntries(
            Object.entries(calendars).map(([id, busy]) => [id, { busy }]),
          ),
        };
      },
    };
  }
  if (!deps.client) {
    throw new Error('calendar-client-required');
  }
  return deps.client;
}

function refused(
  code: ProposeRefusal['code'],
  message: string,
  debug?: ProposeRefusal['debug'],
): ProposeRefusal {
  const r: ProposeRefusal = { refused: true, code, message };
  if (process.env.ARIA_DEBUG === '1' && debug) r.debug = debug;
  return r;
}

function snapshotCandidates(db: Db, limit = 20): Array<{ id: string; summary: string; startUtc: string | null }> {
  try {
    const rows = db
      .prepare(
        'SELECT id, summary, start_at_utc FROM calendar_event ORDER BY start_at_utc DESC LIMIT ?',
      )
      .all(limit) as Array<{ id: string; summary: string; start_at_utc: string | null }>;
    return rows.map((r) => ({ id: r.id, summary: r.summary, startUtc: r.start_at_utc }));
  } catch {
    return [];
  }
}

export async function proposeCalendarChange(
  nl: string,
  deps: ProposeDeps,
): Promise<ProposeOutcome> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const identitySet = resolveAccountIdentity(deps);
  const userEmail = primaryEmailOf(identitySet);
  const client = resolveCalendarClient(deps);

  // 1. Intent
  let intent: Intent;
  try {
    intent = deps.intentFn
      ? await deps.intentFn(nl)
      : await parseIntent(nl, { nowIso, ...(deps.parseIntentDeps ?? {}) });
  } catch (err) {
    if (err instanceof IntentRefusedError) {
      if (err.code === 'cancel-not-in-v1') {
        return refused(
          'cancel-not-in-v1',
          "Cancel commands aren't supported in v1 — please cancel in Google Calendar.",
        );
      }
      return refused('parse-failed', `Sorry, I couldn't parse that command: ${err.message}`);
    }
    return refused(
      'parse-failed',
      `Unexpected error parsing command: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Resolve target
  let target: ResolvedTarget;
  try {
    target = await resolveTarget(intent, deps.db, deps.client ?? null, userEmail, {
      nowIso,
      ...(deps.resolveDeps ?? {}),
    });
  } catch (err) {
    if (err instanceof NeedsClarificationError) {
      if (err.code === 'no-match') {
        return refused(
          'no-match',
          `I couldn't find an event matching "${intent.target?.eventRef ?? ''}".`,
          { intent, candidates: snapshotCandidates(deps.db) },
        );
      }
      return { needsClarification: true, candidates: err.candidates };
    }
    throw err;
  }

  // 3. Self-only gate
  try {
    assertSelfOnly(target.event, identitySet);
  } catch (err) {
    if (err instanceof SelfOnlyGateError) {
      return refused(
        'multi-attendee',
        err.code === 'multi-attendee'
          ? 'Multi-attendee calendar changes are coming in v1.x — please do this one in Google Calendar.'
          : 'This event has no organizer Aria can verify; please edit it in Google Calendar.',
        {
          intent,
          candidates: [
            {
              id: target.event.id,
              summary: target.event.summary ?? '(no title)',
              startUtc: target.event.startUtc,
            },
          ],
          gate: {
            code: err.code,
            userEmail,
            organizer: target.event.organizer ?? null,
            attendees: target.event.attendees ?? null,
          },
        } as ProposeRefusal['debug'] & { gate?: unknown },
      );
    }
    throw err;
  }

  // 4. Freebusy ±14d around the proposed change
  const proposedStartMs = Date.parse(target.proposedChange.startUtc);
  const fbStart = new Date(proposedStartMs - 14 * 24 * 60 * 60 * 1000).toISOString();
  const fbEnd = new Date(proposedStartMs + 14 * 24 * 60 * 60 * 1000).toISOString();
  const fb = await client.freebusyQuery({
    timeMin: fbStart,
    timeMax: fbEnd,
    calendarIds: ['primary'],
  });
  const primary = fb.calendars.primary ?? { busy: [] };
  // Exclude the target event's own window from busy so it doesn't self-conflict.
  const busyIntervals = primary.busy
    .map((b) => ({ startUtc: b.start, endUtc: b.end }))
    .filter(
      (b) =>
        !(b.startUtc === target.event.startUtc && b.endUtc === target.event.endUtc),
    );

  // 5. Rules + 6. Conflict detect
  const rules = loadActiveRules(deps.db);
  const detect = detectConflictsAndAlternatives({
    target: {
      startUtc: target.proposedChange.startUtc,
      endUtc: target.proposedChange.endUtc,
      eventId: target.eventId,
      isHighValue: target.isHighValue,
    },
    rules,
    busyIntervals,
  });

  // 7. Persist approval row (state='ready' — skip 'pending'→'generating' for
  // calendar_change since we never have a long-running draft).
  const beforeJson = JSON.stringify({
    summary: target.event.summary,
    startUtc: target.event.startUtc,
    endUtc: target.event.endUtc,
    parentId: target.parentId,
    recurrence: target.event.recurrence,
    etag: target.event.etag,
    isRecurring: target.isRecurring,
    attendees: target.event.attendees,
    organizer: target.event.organizer,
  });
  const afterJson = JSON.stringify({
    startUtc: target.proposedChange.startUtc,
    endUtc: target.proposedChange.endUtc,
  });
  const conflictsJson = JSON.stringify(detect.conflicts);
  const alternativesJson = JSON.stringify(detect.alternatives);

  const approvalId = insertApproval(deps.db, {
    kind: 'calendar_change',
    state: 'pending',
    approval_path: 'explicit',
    calendar_event_id: target.eventId,
    calendar_action: intent.action === 'create' ? 'create' : intent.action === 'find-time' ? 'find-time' : 'move',
    recurring_scope: target.isRecurring ? 'this' : null,
    before_json: beforeJson,
    after_json: afterJson,
    conflicts_json: conflictsJson,
    alternatives_json: alternativesJson,
    provider_key: deps.providerKey ?? null,
    account_id: deps.accountId ?? null,
  });
  // Transition pending → generating → ready (state machine demands this path).
  transitionTo(deps.db, approvalId, 'generating');
  transitionTo(deps.db, approvalId, 'ready');

  logCalendarAction(deps.db, {
    approval_id: approvalId,
    phase: 'proposed',
    event_id: target.eventId,
    recurring_scope: target.isRecurring ? 'this' : null,
    before_json: beforeJson,
    after_json: afterJson,
  });

  return {
    approvalId,
    primaryFeasible: detect.primaryFeasible,
    conflicts: detect.conflicts,
    alternatives: detect.alternatives,
    warnings: detect.warnings,
  };
}
