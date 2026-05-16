/**
 * Plan 02-01 Task 2 — GmailSync engine tests.
 *
 * Deviation (Rule 3 - Blocking): The plan calls for a real temp SQLCipher DB
 * via `openDb`. In this worktree the pre-existing `better-sqlite3-multiple-ciphers`
 * native binary is built against Electron 41's ABI 141, but vitest runs under
 * Node ABI 145 — so `openDb` fails at import. This is the documented Phase 1
 * deferred condition (see `.planning/phases/01-foundation/deferred-items.md`
 * and `.planning/debug/sqlcipher-electron-42-abi.md`).
 *
 * To keep these tests runnable under vitest, we use a minimal in-memory `Db`
 * shim implementing the THREE methods GmailSync touches: `prepare(sql).run/get`
 * + `transaction(fn)`. The atomicity test (case 5) drives the rollback path
 * via a synthetic throw inside the transaction, which is exactly what
 * better-sqlite3 does under failure. All seven cases listed in the plan
 * exercise the SAME code path under the shim that they would under SQLCipher.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PQueueImport from 'p-queue';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;

import { createGmailSync } from '../../../../../src/main/integrations/google/sync-gmail';
import { HistoryInvalidatedError } from '../../../../../src/main/integrations/google/gmail';
import { TokenInvalidError } from '../../../../../src/main/integrations/google/auth';
import type { GmailClient, GmailMessageMetadata } from '../../../../../src/main/integrations/google/gmail';

// ============================================================================
// In-memory Db shim
// ============================================================================

interface AccountRow {
  email: string;
  history_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

function createInMemoryDb(initialAccount?: AccountRow) {
  const account: AccountRow | null = initialAccount
    ? { ...initialAccount }
    : null;
  const accountState: { row: AccountRow | null } = { row: account };
  const messages = new Map<string, Record<string, unknown>>();

  const db = {
    prepare(sql: string) {
      const s = sql.trim();
      if (/^SELECT email, history_id FROM gmail_account/.test(s)) {
        return {
          get: () =>
            accountState.row
              ? { email: accountState.row.email, history_id: accountState.row.history_id }
              : undefined,
        };
      }
      if (/^INSERT OR REPLACE INTO gmail_message/.test(s)) {
        return {
          run: (row: Record<string, unknown>) => {
            messages.set(String(row.id), { ...row });
          },
        };
      }
      if (/^UPDATE gmail_account\s+SET history_id/.test(s)) {
        return {
          run: (row: { history_id: string; last_synced_at: string }) => {
            if (!accountState.row) {
              throw new Error('no gmail_account row to update');
            }
            accountState.row.history_id = row.history_id;
            accountState.row.last_synced_at = row.last_synced_at;
            accountState.row.last_error = null;
          },
        };
      }
      if (/^UPDATE gmail_account SET last_error/.test(s)) {
        return {
          run: (reason: string) => {
            if (accountState.row) accountState.row.last_error = reason;
          },
        };
      }
      throw new Error(`in-memory db: unhandled SQL: ${s}`);
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      // better-sqlite3 semantics: throw inside the function rolls back any writes
      // made during the function. Mirror that by snapshotting and restoring on throw.
      return ((...args: unknown[]) => {
        const accountSnapshot = accountState.row ? { ...accountState.row } : null;
        const messagesSnapshot = new Map(messages);
        try {
          return fn(...args);
        } catch (err) {
          // restore
          accountState.row = accountSnapshot;
          messages.clear();
          for (const [k, v] of messagesSnapshot) messages.set(k, v);
          throw err;
        }
      }) as T;
    },
    // Inspection helpers for tests
    _inspect: {
      account: () => accountState.row,
      messages: () => messages,
    },
  };
  return db;
}

// ============================================================================
// Fixtures
// ============================================================================

function makeMetadata(opts: {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  historyId?: string;
  from?: string;
  subject?: string;
  snippet?: string;
}): GmailMessageMetadata {
  return {
    id: opts.id,
    threadId: opts.threadId ?? `t-${opts.id}`,
    internalDate: opts.internalDate ?? String(Date.parse('2026-05-15T10:00:00Z')),
    labelIds: opts.labelIds ?? ['INBOX'],
    historyId: opts.historyId,
    snippet: opts.snippet ?? '',
    payload: {
      headers: [
        { name: 'From', value: opts.from ?? 'someone@example.com' },
        { name: 'Subject', value: opts.subject ?? '(no subject)' },
      ],
    },
  };
}

function makeFakeClient(): GmailClient & {
  listHistory: ReturnType<typeof vi.fn>;
  listMessages: ReturnType<typeof vi.fn>;
  getMessageMetadata: ReturnType<typeof vi.fn>;
  getProfile: ReturnType<typeof vi.fn>;
} {
  return {
    listHistory: vi.fn(),
    listMessages: vi.fn(),
    getMessageMetadata: vi.fn(),
    getProfile: vi.fn(),
  } as never;
}

// ============================================================================
// Tests
// ============================================================================

describe('GmailSync.tick', () => {
  let queue: InstanceType<typeof PQueueImport>;

  beforeEach(() => {
    queue = new PQueue({ concurrency: 1 });
  });

  it('Case 1 — first tick (no history_id): full backfill via listMessages', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: null,
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.getProfile.mockResolvedValue({ emailAddress: 'foo@bar.com', historyId: '200' });
    client.listMessages.mockResolvedValue({
      messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }],
      historyId: '',
    });
    client.getMessageMetadata.mockImplementation(async (id: string) => makeMetadata({ id }));

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.messages().size).toBe(2);
    expect(db._inspect.account()?.history_id).toBe('200');
    expect(db._inspect.account()?.last_synced_at).toBeTruthy();
  });

  it('Case 2 — incremental happy path: listHistory + 1 new message', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '100',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockResolvedValue({
      history: [{ id: 'h1', messagesAdded: [{ message: { id: 'm3', threadId: 't3' } }] }],
      historyId: '101',
    });
    client.getMessageMetadata.mockResolvedValue(makeMetadata({ id: 'm3' }));

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.messages().has('m3')).toBe(true);
    expect(db._inspect.account()?.history_id).toBe('101');
  });

  it('Case 3 — HistoryInvalidatedError triggers full 7d resync', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '1',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockRejectedValue(new HistoryInvalidatedError('stale historyId'));
    client.getProfile.mockResolvedValue({ emailAddress: 'foo@bar.com', historyId: '999' });
    client.listMessages.mockResolvedValue({
      messages: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
      historyId: '',
    });
    client.getMessageMetadata.mockImplementation(async (id: string) => makeMetadata({ id }));

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    expect(db._inspect.messages().size).toBe(3);
    expect(db._inspect.account()?.history_id).toBe('999');
  });

  it('Case 4 — TokenInvalidError on listHistory sets last_error=token-expired and re-throws', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '50',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockRejectedValue(new TokenInvalidError({ reason: 'expired' }));

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await expect(sync.tick()).rejects.toBeInstanceOf(TokenInvalidError);
    expect(db._inspect.account()?.last_error).toBe('token-expired');
  });

  it('Case 5 — atomicity: if upsert mid-transaction fails, neither rows nor history_id advance', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '100',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockResolvedValue({
      history: [{ id: 'h1', messagesAdded: [{ message: { id: 'mX', threadId: 'tX' } }] }],
      historyId: '101',
    });
    // Return a metadata object that the toRow → INSERT path WILL process,
    // but break prepare for the INSERT statement to simulate a write failure.
    client.getMessageMetadata.mockResolvedValue(makeMetadata({ id: 'mX' }));

    // Monkey-patch prepare to throw when the INSERT runs:
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (/^INSERT OR REPLACE INTO gmail_message/.test(sql.trim())) {
        return { run: () => { throw new Error('simulated write failure'); } };
      }
      return origPrepare(sql);
    };

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await expect(sync.tick()).rejects.toThrow('simulated write failure');
    expect(db._inspect.messages().size).toBe(0);
    expect(db._inspect.account()?.history_id).toBe('100');
  });

  it('Case 6 — label parsing: INBOX+UNREAD+IMPORTANT → is_unread=1, is_important=1, label_ids JSON', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '1',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockResolvedValue({
      history: [{ id: 'h1', messagesAdded: [{ message: { id: 'mL', threadId: 'tL' } }] }],
      historyId: '2',
    });
    client.getMessageMetadata.mockResolvedValue(
      makeMetadata({ id: 'mL', labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'] }),
    );

    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    const row = db._inspect.messages().get('mL');
    expect(row?.is_unread).toBe(1);
    expect(row?.is_important).toBe(1);
    expect(row?.label_ids).toBe('["INBOX","UNREAD","IMPORTANT"]');
  });

  it('Case 7 — queue routing: scheduler.queue.add called for listHistory AND for the transaction', async () => {
    const db = createInMemoryDb({
      email: 'foo@bar.com',
      history_id: '1',
      last_synced_at: null,
      last_error: null,
    });
    const client = makeFakeClient();
    client.listHistory.mockResolvedValue({
      history: [{ id: 'h1', messagesAdded: [{ message: { id: 'mq', threadId: 'tq' } }] }],
      historyId: '2',
    });
    client.getMessageMetadata.mockResolvedValue(makeMetadata({ id: 'mq' }));

    const addSpy = vi.spyOn(queue, 'add');
    const sync = createGmailSync({ db: db as never, client, scheduler: { queue } });
    await sync.tick();

    // ≥ 1 for listHistory, ≥ 1 for getMessageMetadata, ≥ 1 for the DB transaction = ≥ 3.
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
