import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../../setup';
import { openDb, closeDb } from '../../../../../src/main/db/connect';
import { registerScheduler } from '../../../../../src/main/lifecycle/scheduler';

function makeClient() {
  const get = vi.fn(async () => ({
    value: [
      {
        id: 'evt-1',
        subject: 'Team sync',
        start: { dateTime: '2026-05-18T12:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-05-18T12:30:00.000Z', timeZone: 'UTC' },
        location: { displayName: 'Room 1' },
        organizer: { emailAddress: { address: 'organizer@contoso.com' }, self: true },
        attendees: [{ emailAddress: { address: 'user@contoso.com' } }],
        categories: ['Work'],
        '@odata.etag': 'W/"etag-1"',
        lastModifiedDateTime: '2026-05-18T11:00:00.000Z',
        recurrence: [
          {
            pattern: { type: 'weekly', daysOfWeek: ['monday'], interval: 1 },
            range: { type: 'noEnd' },
          },
        ],
        seriesMasterId: 'series-1',
        iCalUId: 'ical-1',
      },
    ],
    '@odata.deltaLink': 'calendar-delta-1',
  }));
  return {
    graph: {
      api: vi.fn(() => ({
        select: vi.fn(() => ({ get })),
        get,
      })),
    },
  };
}

describe('microsoft sync-calendar', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-microsoft-sync-calendar');
    dbKey = crypto.randomBytes(32);
    vi.doMock('electron', async () => {
      const real = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...real,
        app: {
          isReady: () => true,
          whenReady: () => Promise.resolve(),
          getPath: () => dataDir,
        },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
          decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
          getSelectedStorageBackend: () => 'keychain',
        },
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('persists Outlook calendar rows and the delta cursor', async () => {
    const db = openDb({ dataDir, dbKey });
    const scheduler = registerScheduler({ info: vi.fn() } as any);
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES (?, 'microsoft', ?, 'ok', ?)`,
    ).run('acct-1', 'user@contoso.com', '{"mail":true,"calendar":true}');
    db.prepare(
      `INSERT INTO provider_sync_state (provider_key, account_id, resource, cursor, last_sync_at, last_error)
       VALUES ('microsoft', ?, 'calendar', NULL, NULL, NULL)`,
    ).run('acct-1');

    const { tickCalendar } = await import('../../../../../src/main/integrations/microsoft/sync-calendar');
    await tickCalendar({
      db,
      accountId: 'acct-1',
      client: makeClient() as any,
      scheduler,
      logger: { info: vi.fn(), warn: vi.fn() } as any,
      now: () => new Date('2026-05-18T10:00:00.000Z'),
    });

    const row = db
      .prepare(
        `SELECT id, summary, provider_key as providerKey, account_id as accountId,
                recurrence_unsupported as recurrenceUnsupported, recurrence_json as recurrenceJson
           FROM calendar_event
          WHERE id = 'evt-1'`,
      )
      .get() as
      | {
          id: string;
          summary: string;
          providerKey: string;
          accountId: string;
          recurrenceUnsupported: number;
          recurrenceJson: string | null;
        }
      | undefined;
    expect(row).toMatchObject({
      id: 'evt-1',
      summary: 'Team sync',
      providerKey: 'microsoft',
      accountId: 'acct-1',
      recurrenceUnsupported: 0,
    });
    expect(row?.recurrenceJson).toContain('RRULE:FREQ=WEEKLY');

    const syncState = db
      .prepare(
        `SELECT cursor, last_sync_at as lastSyncAt
           FROM provider_sync_state
          WHERE provider_key = 'microsoft' AND account_id = ? AND resource = 'calendar'`,
      )
      .get('acct-1') as { cursor: string; lastSyncAt: string } | undefined;
    expect(syncState?.cursor).toBe('calendar-delta-1');
    expect(syncState?.lastSyncAt).toBe('2026-05-18T10:00:00.000Z');

    closeDb(db);
  });
});
