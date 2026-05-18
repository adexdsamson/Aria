/**
 * Plan 03-04 Task 4 — sendApprovedEmail unit tests.
 *
 * Asserts the assertApproved gate is the FIRST executable line, the
 * forced-explicit (APPR-07) bypass case throws, the success path writes
 * send_log + transitions to 'sent', and the failure path writes send_log
 * + preserves 'approved' state. Also asserts the In-Reply-To + References
 * headers are present in the RFC 2822 payload for threading.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../../src/main/db/connect';
import { runMigrations } from '../../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../../setup';
import {
  insertApproval,
  transitionTo,
} from '../../../../../src/main/approvals/persist';
import {
  sendApprovedEmail,
  buildRfc2822,
} from '../../../../../src/main/integrations/google/send';
import { ApprovalGateError } from '../../../../../src/main/approvals/gate';

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../../src/main/db/migrations',
);

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-send');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedReady(
  db: Db,
  opts: {
    severity?: 'low' | 'med' | 'high';
    categories?: string[];
    body?: string;
    subject?: string;
    sourceMessageId?: string;
  } = {},
): string {
  const id = insertApproval(db, {
    kind: 'email_send',
    source_message_id: opts.sourceMessageId ?? 'incoming-msg-1',
    recipients_json: JSON.stringify(['alice@example.com']),
    subject: opts.subject ?? 'Re: Project sync',
    severity: opts.severity ?? null,
    categories_json: opts.categories ? JSON.stringify(opts.categories) : null,
  });
  transitionTo(db, id, 'generating');
  transitionTo(db, id, 'ready', {
    body_original: opts.body ?? 'Tuesday works for me.',
  });
  return id;
}

function makeMockGmail(opts: { ok: boolean; msgId?: string; error?: string }) {
  const send = vi.fn(async () => {
    if (!opts.ok) {
      throw new Error(opts.error ?? 'gmail-api-failed');
    }
    return { data: { id: opts.msgId ?? 'mock-msg-id' } };
  });
  return {
    send,
    client: {
      users: { messages: { send } },
    },
  };
}

describe('sendApprovedEmail', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it("throws code='not-found' on unknown approvalId (proves assertApproved is first line)", async () => {
    const mock = makeMockGmail({ ok: true });
    await expect(
      sendApprovedEmail(db, 'no-such-id', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildGmailClient: async () => mock.client as any,
      }),
    ).rejects.toBeInstanceOf(ApprovalGateError);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("throws code='not-approved' on ready (not approved) row", async () => {
    const id = seedReady(db);
    const mock = makeMockGmail({ ok: true });
    try {
      await sendApprovedEmail(db, id, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildGmailClient: async () => mock.client as any,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalGateError);
      expect((err as ApprovalGateError).code).toBe('not-approved');
    }
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("approved + Gmail success → writes send_log(ok=1), transitions to 'sent'", async () => {
    const id = seedReady(db);
    transitionTo(db, id, 'approved', { approval_path: 'explicit' });
    const mock = makeMockGmail({ ok: true, msgId: 'gmail-msg-42' });

    const result = await sendApprovedEmail(db, id, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildGmailClient: async () => mock.client as any,
    });

    expect(result).toEqual({ ok: true, providerMsgId: 'gmail-msg-42' });
    expect(mock.send).toHaveBeenCalledTimes(1);

    const row = db.prepare(`SELECT state, sent_at, send_log_id FROM approval WHERE id = ?`).get(id) as Record<string, unknown>;
    expect(row.state).toBe('sent');
    expect(row.sent_at).toBeTruthy();
    expect(row.send_log_id).toBeTruthy();

    const log = db.prepare(`SELECT * FROM send_log WHERE approval_id = ?`).get(id) as Record<string, unknown>;
    expect(log).toBeTruthy();
    expect(log.ok).toBe(1);
    expect(log.provider_msg_id).toBe('gmail-msg-42');
    expect(log.provider).toBe('gmail');
  });

  it('approved + Gmail failure → writes send_log(ok=0), preserves approved state, throws', async () => {
    const id = seedReady(db);
    transitionTo(db, id, 'approved', { approval_path: 'explicit' });
    const mock = makeMockGmail({ ok: false, error: 'recipient-bounced' });

    await expect(
      sendApprovedEmail(db, id, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildGmailClient: async () => mock.client as any,
      }),
    ).rejects.toThrow(/recipient-bounced/);

    const row = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(id) as { state: string };
    expect(row.state).toBe('approved');

    const log = db.prepare(`SELECT ok, error FROM send_log WHERE approval_id = ?`).get(id) as Record<string, unknown>;
    expect(log.ok).toBe(0);
    expect(String(log.error)).toMatch(/recipient-bounced/);
  });

  it("severity='high' + approval_path='silent' throws 'forced-explicit-missing' (APPR-07)", async () => {
    const id = seedReady(db, { severity: 'high' });
    // Move to 'approved' but force silent path — gate must trip.
    transitionTo(db, id, 'approved', { approval_path: 'silent' });
    const mock = makeMockGmail({ ok: true });

    try {
      await sendApprovedEmail(db, id, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildGmailClient: async () => mock.client as any,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalGateError);
      expect((err as ApprovalGateError).code).toBe('forced-explicit-missing');
    }
    expect(mock.send).not.toHaveBeenCalled();
  });

  it('buildRfc2822 includes In-Reply-To AND References headers when inReplyTo is set', () => {
    const raw = buildRfc2822({
      to: ['alice@example.com'],
      subject: 'Re: Project sync',
      body: 'Tuesday works.',
      inReplyTo: 'msg-12345',
    });
    expect(raw).toContain('In-Reply-To: <msg-12345>');
    expect(raw).toContain('References: <msg-12345>');
    expect(raw).toContain('To: alice@example.com');
    expect(raw).toContain('Subject: Re: Project sync');
    expect(raw).toContain('Tuesday works.');
  });

  it('buildRfc2822 omits threading headers when inReplyTo is null', () => {
    const raw = buildRfc2822({
      to: ['alice@example.com'],
      subject: 'New message',
      body: 'Hi.',
      inReplyTo: null,
    });
    expect(raw).not.toContain('In-Reply-To');
    expect(raw).not.toContain('References');
  });
});
