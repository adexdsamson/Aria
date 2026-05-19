import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { ApprovalGateError } from '../../../../src/main/approvals/gate';
import { getApproval, insertApproval, transitionTo } from '../../../../src/main/approvals/persist';
import { applyCalendarChange } from '../../../../src/main/integrations/write-event';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-unified-write-event');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedApprovedCalendarChange(
  db: Db,
  overrides: Partial<{ providerKey: 'google' | 'microsoft'; accountId: string; scope: 'this' | 'future' | 'all' }> = {},
): string {
  const id = insertApproval(db, {
    kind: 'calendar_change',
    calendar_event_id: 'evt-weekly-parent-1',
    calendar_action: 'move',
    recurring_scope: overrides.scope ?? 'all',
    before_json: JSON.stringify({
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
      startUtc: '2026-05-26T15:00:00.000Z',
      etag: '"old-etag"',
    }),
    after_json: JSON.stringify({ summary: 'Renamed standup' }),
    provider_key: overrides.providerKey ?? 'microsoft',
    account_id: overrides.accountId ?? 'acct-1',
  });
  transitionTo(db, id, 'generating');
  transitionTo(db, id, 'ready');
  transitionTo(db, id, 'approved', { approval_path: 'explicit' });
  return id;
}

function makeRegistry(opts: {
  patchOk?: boolean;
  patchError?: Error;
  insertOk?: boolean;
} = {}) {
  const patchOk = opts.patchOk ?? true;
  const insertOk = opts.insertOk ?? true;
  const patchEvent = vi.fn(async () => {
    if (!patchOk) throw opts.patchError ?? new Error('patch-failed');
    return { externalId: 'evt-patched-1', etag: '"new-etag-1"' };
  });
  const insertEvent = vi.fn(async () => {
    if (!insertOk) throw new Error('insert-failed');
    return { externalId: 'evt-inserted-1', etag: '"new-etag-2"' };
  });
  const mockProvider = {
    providerKey: 'microsoft' as const,
    accountId: 'acct-1',
    accountEmail: 'user@example.com',
    capabilities: {
      recurrenceFormat: 'graph' as const,
      supportsSendUpdates: true,
      mailLabelModel: 'outlook' as const,
      mailSendReturnsId: true,
    },
    mail: undefined,
    calendar: {
      listEventsDelta: vi.fn() as never,
      listEventsWindow: vi.fn() as never,
      getEvent: vi.fn() as never,
      patchEvent,
      insertEvent,
      eventInstances: vi.fn() as never,
      freeBusy: vi.fn() as never,
    },
  } as const;
  return {
    get: vi.fn(() => mockProvider as never),
    patchEvent,
    insertEvent,
  };
}

describe('unified write-event chokepoint', () => {
  let db!: Db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) closeDb(db);
  });

  it('rejects before provider dispatch when the row is not approved', async () => {
    const id = insertApproval(db, {
      kind: 'calendar_change',
      calendar_event_id: 'evt-weekly-parent-1',
      calendar_action: 'move',
      recurring_scope: 'all',
      before_json: JSON.stringify({
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
        startUtc: '2026-05-26T15:00:00.000Z',
      }),
      after_json: JSON.stringify({ summary: 'Draft change' }),
      provider_key: 'microsoft',
      account_id: 'acct-1',
    });
    const registry = makeRegistry();

    await expect(applyCalendarChange(db, id, { registry })).rejects.toBeInstanceOf(ApprovalGateError);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('calls provider.calendar.patchEvent only after approval and then marks sent', async () => {
    const id = seedApprovedCalendarChange(db);
    const registry = makeRegistry();
    registry.patchEvent.mockImplementationOnce(async () => {
      expect(getApproval(db, id)?.state).toBe('approved');
      return { externalId: 'evt-patched-1', etag: '"new-etag-1"' };
    });

    const result = await applyCalendarChange(db, id, { registry });

    expect(result).toEqual({ ok: true, eventId: 'evt-patched-1' });
    expect(registry.patchEvent).toHaveBeenCalledTimes(1);
    expect(getApproval(db, id)?.state).toBe('sent');

    const audits = db
      .prepare(
        `SELECT phase, google_error, google_etag FROM calendar_action_log
         WHERE approval_id = ? ORDER BY id ASC`,
      )
      .all(id) as Array<{ phase: string; google_error: string | null; google_etag: string | null }>;
    expect(audits.map((r) => r.phase)).toEqual(['pre_write', 'post_write']);
    expect(audits[1]!.google_etag).toBe('"new-etag-1"');
  });

  it('leaves the approval approved when the provider write fails', async () => {
    const id = seedApprovedCalendarChange(db);
    const registry = makeRegistry({
      patchOk: false,
      patchError: new Error('provider-calendar-failed'),
    });
    registry.patchEvent.mockImplementationOnce(async () => {
      expect(getApproval(db, id)?.state).toBe('approved');
      throw new Error('provider-calendar-failed');
    });

    await expect(applyCalendarChange(db, id, { registry })).rejects.toThrow(/provider-calendar-failed/);

    expect(registry.patchEvent).toHaveBeenCalledTimes(1);
    expect(getApproval(db, id)?.state).toBe('approved');

    const audits = db
      .prepare(
        `SELECT phase, google_error FROM calendar_action_log
         WHERE approval_id = ? ORDER BY id ASC`,
      )
      .all(id) as Array<{ phase: string; google_error: string | null }>;
    expect(audits.map((r) => r.phase)).toEqual(['pre_write', 'failed']);
    expect(audits[1]!.google_error).toContain('provider-calendar-failed');
  });
});
