import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { ApprovalGateError } from '../../../../src/main/approvals/gate';
import { getApproval, insertApproval, transitionTo } from '../../../../src/main/approvals/persist';
import { recoverInflightSends, sendApprovedEmail } from '../../../../src/main/integrations/send';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-unified-send');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedApprovedEmail(db: Db, overrides: Partial<{ providerKey: 'google' | 'microsoft'; accountId: string }> = {}): string {
  const id = insertApproval(db, {
    kind: 'email_send',
    source_message_id: 'incoming-msg-1',
    recipients_json: JSON.stringify(['alice@example.com']),
    subject: 'Re: Project sync',
    body_original: 'Tuesday works for me.',
    provider_key: overrides.providerKey ?? 'microsoft',
    account_id: overrides.accountId ?? 'acct-1',
  });
  transitionTo(db, id, 'generating');
  transitionTo(db, id, 'ready', { body_original: 'Tuesday works for me.' });
  transitionTo(db, id, 'approved', { approval_path: 'explicit' });
  return id;
}

function makeRegistry(provider: {
  mail: {
    sendMessage?: ReturnType<typeof vi.fn>;
    findSentByIdempotencyKey?: ReturnType<typeof vi.fn>;
  };
}) {
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
    mail: {
      listMessagesDelta: vi.fn() as never,
      getMessage: vi.fn() as never,
      sendMessage: provider.mail.sendMessage ?? vi.fn(),
      findSentByIdempotencyKey: provider.mail.findSentByIdempotencyKey ?? vi.fn(),
    },
  } as const;
  return {
    get: vi.fn(() => mockProvider as never),
  };
}

describe('unified send chokepoint', () => {
  let db!: Db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) closeDb(db);
  });

  it('rejects before provider dispatch when the row is not approved', async () => {
    const id = insertApproval(db, {
      kind: 'email_send',
      source_message_id: 'incoming-msg-1',
      recipients_json: JSON.stringify(['alice@example.com']),
      subject: 'Draft',
      provider_key: 'microsoft',
      account_id: 'acct-1',
    });
    const registry = makeRegistry({
      mail: {
        sendMessage: vi.fn(),
        findSentByIdempotencyKey: vi.fn(),
      },
    });

    await expect(sendApprovedEmail(db, id, { registry })).rejects.toBeInstanceOf(ApprovalGateError);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('transitions to sending before dispatch and then to sent on success', async () => {
    const id = seedApprovedEmail(db);
    const sendMessage = vi.fn(async () => {
      expect(getApproval(db, id)?.state).toBe('sending');
      return { externalId: 'msg-123' };
    });
    const registry = makeRegistry({
      mail: {
        sendMessage,
        findSentByIdempotencyKey: vi.fn(),
      },
    });

    const result = await sendApprovedEmail(db, id, { registry });

    expect(result).toEqual({ ok: true, providerMsgId: 'msg-123' });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const row = getApproval(db, id);
    expect(row?.state).toBe('sent');
    expect(row?.last_error_message).toBeNull();

    const log = db.prepare('SELECT ok, provider_msg_id, provider FROM send_log WHERE approval_id = ?').get(id) as {
      ok: number;
      provider_msg_id: string | null;
      provider: string;
    };
    expect(log.ok).toBe(1);
    expect(log.provider_msg_id).toBe('msg-123');
    expect(log.provider).toBe('microsoft');
  });

  it('marks failed after a provider exception and keeps the approval recoverable', async () => {
    const id = seedApprovedEmail(db);
    const sendMessage = vi.fn(async () => {
      expect(getApproval(db, id)?.state).toBe('sending');
      throw new Error('provider-send-failed');
    });
    const registry = makeRegistry({
      mail: {
        sendMessage,
        findSentByIdempotencyKey: vi.fn(),
      },
    });

    await expect(sendApprovedEmail(db, id, { registry })).rejects.toThrow(/provider-send-failed/);

    const row = getApproval(db, id);
    expect(row?.state).toBe('failed');
    expect(row?.last_error_message).toContain('provider-send-failed');

    const log = db.prepare('SELECT ok, error FROM send_log WHERE approval_id = ?').get(id) as {
      ok: number;
      error: string | null;
    };
    expect(log.ok).toBe(0);
    expect(log.error).toContain('provider-send-failed');
  });

  it('recovers inflight sends from the provider sent-folder lookup', async () => {
    const foundId = seedApprovedEmail(db);
    const missingId = seedApprovedEmail(db, { accountId: 'acct-2' });

    transitionTo(db, foundId, 'sending');
    transitionTo(db, missingId, 'sending');

    const foundKey = getApproval(db, foundId)?.idempotency_key;
    expect(foundKey).toBeTruthy();

    const registry = {
      get: vi.fn(() => ({
        providerKey: 'microsoft' as const,
        accountId: 'acct-1',
        accountEmail: 'user@example.com',
        capabilities: {
          recurrenceFormat: 'graph' as const,
          supportsSendUpdates: true,
          mailLabelModel: 'outlook' as const,
          mailSendReturnsId: true,
        },
        mail: {
          listMessagesDelta: vi.fn() as never,
          getMessage: vi.fn() as never,
          sendMessage: vi.fn() as never,
          findSentByIdempotencyKey: vi.fn(async (key: string) => (key === foundKey ? 'sent-1' : null)),
        },
      } as const)),
    };
    const banner = vi.fn();

    const result = await recoverInflightSends(db, { registry }, banner);

    expect(result.reconciledToSent).toBe(1);
    expect(result.stuck).toHaveLength(1);
    expect(result.stuck[0]!.id).toBe(missingId);
    expect(banner).toHaveBeenCalledWith({ count: 1, ids: [missingId] });
    expect(getApproval(db, foundId)?.state).toBe('sent');
    expect(getApproval(db, missingId)?.state).toBe('needs-operator-decision');
  });
});
