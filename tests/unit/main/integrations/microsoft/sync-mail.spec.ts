import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { createTempUserDataDir } from '../../../../setup';
import { openDb, closeDb } from '../../../../../src/main/db/connect';
import { registerScheduler } from '../../../../../src/main/lifecycle/scheduler';

function makeClient() {
  const get = vi.fn(async () => ({
    value: [
      {
        id: 'msg-1',
        conversationId: 'thread-1',
        subject: 'Hello from Outlook',
        from: { emailAddress: { address: 'sender@contoso.com' } },
        receivedDateTime: '2026-05-18T09:00:00.000Z',
        bodyPreview: 'Preview text',
        categories: ['Inbox'],
        isRead: false,
        importance: 'high',
      },
    ],
    '@odata.deltaLink': 'delta-link-1',
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

describe('microsoft sync-mail', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-microsoft-sync-mail');
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

  it('persists Outlook mail rows and the delta cursor', async () => {
    const db = openDb({ dataDir, dbKey });
    const scheduler = registerScheduler({ info: vi.fn() } as any);
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES (?, 'microsoft', ?, 'ok', ?)`,
    ).run('acct-1', 'user@contoso.com', '{"mail":true,"calendar":true}');
    db.prepare(
      `INSERT INTO provider_sync_state (provider_key, account_id, resource, cursor, last_sync_at, last_error)
       VALUES ('microsoft', ?, 'mail', NULL, NULL, NULL)`,
    ).run('acct-1');

    const { tickMail } = await import('../../../../../src/main/integrations/microsoft/sync-mail');
    await tickMail({
      db,
      accountId: 'acct-1',
      client: makeClient() as any,
      scheduler,
      logger: { info: vi.fn(), warn: vi.fn() } as any,
      now: () => new Date('2026-05-18T10:00:00.000Z'),
    });

    const row = db
      .prepare(
        `SELECT id, thread_id as threadId, from_addr as fromAddr, provider_key as providerKey, account_id as accountId, subject
           FROM gmail_message
          WHERE id = 'msg-1'`,
      )
      .get() as { id: string; threadId: string; fromAddr: string; providerKey: string; accountId: string; subject: string } | undefined;
    expect(row).toMatchObject({
      id: 'msg-1',
      threadId: 'thread-1',
      fromAddr: 'sender@contoso.com',
      providerKey: 'microsoft',
      accountId: 'acct-1',
      subject: 'Hello from Outlook',
    });

    const syncState = db
      .prepare(
        `SELECT cursor, last_sync_at as lastSyncAt
           FROM provider_sync_state
          WHERE provider_key = 'microsoft' AND account_id = ? AND resource = 'mail'`,
      )
      .get('acct-1') as { cursor: string; lastSyncAt: string } | undefined;
    expect(syncState?.cursor).toBe('delta-link-1');
    expect(syncState?.lastSyncAt).toBe('2026-05-18T10:00:00.000Z');

    closeDb(db);
  });
});
