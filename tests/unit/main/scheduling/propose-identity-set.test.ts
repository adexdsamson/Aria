import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { proposeCalendarChange } from '../../../../src/main/scheduling/propose';
import { upsertProviderAccount } from '../../../../src/main/integrations/microsoft/provider-account';
import type { Provider } from '../../../../src/shared/provider';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-propose-identity');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedEvent(db: Db): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO calendar_event
     (id, calendar_id, summary, location, start_at_utc, end_at_utc, start_date, end_date,
      start_timezone, attendees, status, recurring_id, updated_at, fetched_at,
      etag, i_cal_uid, sequence, organizer_email, organizer_self, recurrence_json,
      provider_key, account_id)
     VALUES ('ev-alias', 'primary', '3pm sync', NULL, '2026-05-18T15:00:00.000Z',
             '2026-05-18T16:00:00.000Z', NULL, NULL,
             'UTC', ?, 'confirmed', NULL, ?, ?,
             'etag-1', NULL, NULL, ?, 0, NULL,
             'microsoft', 'acct-1')`,
  ).run(
    JSON.stringify([{ email: 'user_contoso#EXT#@tenant.onmicrosoft.com' }]),
    now,
    now,
    'user_contoso#EXT#@tenant.onmicrosoft.com',
  );
}

function fakeProvider(): Provider {
  return {
    providerKey: 'microsoft',
    accountId: 'acct-1',
    accountEmail: 'user@contoso.com',
    capabilities: {
      recurrenceFormat: 'graph',
      supportsSendUpdates: true,
      mailLabelModel: 'outlook',
      mailSendReturnsId: true,
    },
    calendar: {
      listEventsDelta: vi.fn(),
      listEventsWindow: vi.fn(),
      getEvent: vi.fn(),
      patchEvent: vi.fn(),
      insertEvent: vi.fn(),
      eventInstances: vi.fn(),
      freeBusy: vi.fn().mockResolvedValue({ primary: [] }),
    },
  };
}

describe('proposeCalendarChange IdentitySet switch', () => {
  let db: Db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    closeDb(db);
  });

  it('accepts an Outlook organizer alias through provider_account.identity_set_json', async () => {
    upsertProviderAccount(db, {
      providerKey: 'microsoft',
      accountId: 'acct-1',
      displayEmail: 'user@contoso.com',
      status: 'ok',
      identitySet: {
        primaryEmail: 'user@contoso.com',
        aliases: ['user_contoso#EXT#@tenant.onmicrosoft.com'],
      },
      capabilitiesJson: '{"mail":true,"calendar":true}',
    });
    seedEvent(db);

    const result = await proposeCalendarChange('move my 3pm to Thursday', {
      db,
      providerKey: 'microsoft',
      accountId: 'acct-1',
      registryDeps: { createMicrosoftProvider: () => fakeProvider() },
      intentFn: async () => ({
        action: 'move',
        target: { eventRef: 'my 3pm' },
        when: { nlWhen: 'Thursday' },
      }),
      nowIso: '2026-05-18T12:00:00.000Z',
    });

    expect(result).toHaveProperty('approvalId');
    expect(result).not.toMatchObject({ refused: true });
  });
});
