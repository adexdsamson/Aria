import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { google } from 'googleapis';
import { assertApproved } from '../approvals/gate';
import { assertEntitled } from '../entitlement/gate';
import { getApproval, transitionTo, writeSendLog } from '../approvals/persist';
import { ProviderRegistry, type ProviderRegistryDeps } from './registry';
import type { ProviderKey } from '../../shared/provider';
import { getOAuth2Client } from './google/auth';

type Db = Database.Database;

export interface SendApprovedDeps {
  buildGmailClient?: () => Promise<ReturnType<typeof google.gmail>>;
  registry?: Pick<ProviderRegistry, 'get'>;
  registryDeps?: ProviderRegistryDeps;
}

export interface SendResult {
  ok: true;
  providerMsgId: string;
}

function createIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '').toLowerCase();
}

function resolveRegistry(db: Db, deps: SendApprovedDeps): Pick<ProviderRegistry, 'get'> {
  return deps.registry ?? new ProviderRegistry(db, deps.registryDeps);
}

function asProviderKey(key: string | null): ProviderKey {
  if (key === 'microsoft') return 'microsoft';
  return 'google';
}

function supportsLegacyGoogleOverride(row: { provider_key: string | null }): boolean {
  return (row.provider_key ?? 'google') === 'google';
}

function parseRecipients(row: { recipients_json: string | null }): string[] {
  return row.recipients_json ? (JSON.parse(row.recipients_json) as string[]) : [];
}

export interface BuildRfc2822Args {
  to: string[];
  subject: string;
  body: string;
  inReplyTo: string | null;
}

export function buildRfc2822(args: BuildRfc2822Args): string {
  const lines: string[] = [];
  lines.push(`To: ${args.to.join(', ')}`);
  lines.push(`Subject: ${args.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 7bit');
  if (args.inReplyTo) {
    const ref = args.inReplyTo.startsWith('<')
      ? args.inReplyTo
      : `<${args.inReplyTo}>`;
    lines.push(`In-Reply-To: ${ref}`);
    lines.push(`References: ${ref}`);
  }
  lines.push('');
  lines.push(args.body);
  return lines.join('\r\n');
}

async function sendViaInjectedGmail(
  db: Db,
  approvalId: string,
  deps: SendApprovedDeps,
): Promise<SendResult> {
  const row = getApproval(db, approvalId);
  if (!row) {
    throw new Error(`approval-not-found:${approvalId}`);
  }

  const recipients = parseRecipients(row);
  const subject = row.subject ?? '';
  const body = row.body_edited ?? row.body_original ?? '';
  const raw = buildRfc2822({
    to: recipients,
    subject,
    body,
    inReplyTo: row.source_message_id,
  });
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');

  let providerMsgId: string | null = null;
  let sendErr: Error | null = null;
  try {
    const gmail = deps.buildGmailClient
      ? await deps.buildGmailClient()
      : await buildDefaultGmailClient();
    const apiResult = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });
    providerMsgId = (apiResult.data?.id ?? null) as string | null;
    if (!providerMsgId) {
      throw new Error('gmail-send-returned-no-id');
    }
  } catch (err) {
    sendErr = err instanceof Error ? err : new Error(String(err));
  }

  const logId = writeSendLog(db, {
    approvalId,
    ok: sendErr ? 0 : 1,
    providerMsgId: providerMsgId ?? undefined,
    error: sendErr?.message,
    recipients,
    subject,
    provider: 'gmail',
  });

  if (sendErr || !providerMsgId) {
    throw sendErr ?? new Error('gmail-send-failed');
  }

  transitionTo(db, approvalId, 'sent', {
    sent_at: new Date().toISOString(),
    send_log_id: logId,
  });

  return { ok: true, providerMsgId };
}

async function buildDefaultGmailClient(): Promise<ReturnType<typeof google.gmail>> {
  const auth = getOAuth2Client('gmail');
  if (!auth) {
    throw new Error('gmail-not-connected');
  }
  return google.gmail({ version: 'v1', auth });
}

export async function sendApprovedEmail(
  db: Db,
  approvalId: string,
  deps: SendApprovedDeps = {},
): Promise<SendResult> {
  await assertEntitled(db, 'email_send');
  assertApproved(db, approvalId);

  const row = getApproval(db, approvalId);
  if (!row) {
    throw new Error(`approval-not-found:${approvalId}`);
  }
  if (row.kind !== 'email_send') {
    throw new Error(`send-approved-email: approval ${approvalId} kind=${row.kind}, expected 'email_send'`);
  }

  if (deps.buildGmailClient && supportsLegacyGoogleOverride(row)) {
    return sendViaInjectedGmail(db, approvalId, deps);
  }

  const providerKey = asProviderKey(row.provider_key);
  const accountId = row.account_id;
  if (!accountId) {
    throw new Error(`send-approved-email: approval ${approvalId} missing account_id`);
  }
  const provider = resolveRegistry(db, deps).get(providerKey, accountId);
  if (!provider.mail) {
    throw new Error(`send-approved-email: provider ${providerKey}:${accountId} has no mail capability`);
  }

  const idempotencyKey = row.idempotency_key ?? createIdempotencyKey();
  const recipients = parseRecipients(row);
  const subject = row.subject ?? '';
  const bodyText = row.body_edited ?? row.body_original ?? '';

  transitionTo(db, approvalId, 'sending', {
    idempotency_key: idempotencyKey,
    last_error_message: null,
  });

  let providerMsgId: string | null = null;
  try {
    const result = await provider.mail.sendMessage(
      {
        to: recipients,
        subject,
        bodyText,
        inReplyToExternalId: row.source_message_id,
      },
      { idempotencyKey },
    );
    providerMsgId = result.externalId;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const logId = writeSendLog(db, {
      approvalId,
      ok: 0,
      providerMsgId: undefined,
      error: errMsg,
      recipients,
      subject,
      provider: provider.providerKey,
    });
    transitionTo(db, approvalId, 'failed', {
      last_error_message: errMsg,
      send_log_id: logId,
    });
    throw err;
  }

  if (!providerMsgId) {
    const err = new Error('send-approved-email: provider returned no message id');
    const logId = writeSendLog(db, {
      approvalId,
      ok: 0,
      error: err.message,
      recipients,
      subject,
      provider: provider.providerKey,
    });
    transitionTo(db, approvalId, 'failed', {
      last_error_message: err.message,
      send_log_id: logId,
    });
    throw err;
  }

  const logId = writeSendLog(db, {
    approvalId,
    ok: 1,
    providerMsgId,
    recipients,
    subject,
    provider: provider.providerKey,
  });

  transitionTo(db, approvalId, 'sent', {
    sent_at: new Date().toISOString(),
    send_log_id: logId,
    last_error_message: null,
  });

  return { ok: true, providerMsgId };
}

export interface RecoverInflightSendsResult {
  reconciledToSent: number;
  stuck: Array<{ id: string; reason: string; idempotency_key: string }>;
}

export async function recoverInflightSends(
  db: Db,
  deps: SendApprovedDeps = {},
  emitBannerIpc?: (payload: { count: number; ids: string[] }) => void,
): Promise<RecoverInflightSendsResult> {
  const rows = db
    .prepare(
      `SELECT id, idempotency_key, provider_key, account_id
         FROM approval
        WHERE state = 'sending'`,
    )
    .all() as Array<{
      id: string;
      idempotency_key: string;
      provider_key: 'google' | 'microsoft' | null;
      account_id: string | null;
    }>;

  const stuck: Array<{ id: string; reason: string; idempotency_key: string }> = [];
  let reconciledToSent = 0;
  const registry = resolveRegistry(db, deps);
  for (const row of rows) {
    if (!row.account_id) {
      transitionTo(db, row.id, 'needs-operator-decision', {
        last_error_message: `Aria could not verify send for missing account_id. Idempotency key: ${row.idempotency_key}`,
      });
      stuck.push({ id: row.id, reason: 'missing-account', idempotency_key: row.idempotency_key });
      continue;
    }

    try {
      const provider = registry.get(asProviderKey(row.provider_key), row.account_id);
      const found = await provider.mail?.findSentByIdempotencyKey(row.idempotency_key);
      if (found) {
        const logId = writeSendLog(db, {
          approvalId: row.id,
          ok: 1,
          providerMsgId: found,
          recipients: [],
          provider: provider.providerKey,
        });
        transitionTo(db, row.id, 'sent', {
          sent_at: new Date().toISOString(),
          send_log_id: logId,
          last_error_message: null,
        });
        reconciledToSent += 1;
        continue;
      }

      transitionTo(db, row.id, 'needs-operator-decision', {
        last_error_message: `Aria could not confirm whether this message was sent - please check your Sent folder. Idempotency key: ${row.idempotency_key}`,
      });
      stuck.push({ id: row.id, reason: 'not-found-in-sent', idempotency_key: row.idempotency_key });
    } catch (err) {
      transitionTo(db, row.id, 'needs-operator-decision', {
        last_error_message: `Aria could not verify send (${err instanceof Error ? err.message : String(err)}). Idempotency key: ${row.idempotency_key}`,
      });
      stuck.push({ id: row.id, reason: 'lookup-failed', idempotency_key: row.idempotency_key });
    }
  }

  if (stuck.length > 0 && emitBannerIpc) {
    emitBannerIpc({ count: stuck.length, ids: stuck.map((s) => s.id) });
  }

  return { reconciledToSent, stuck };
}
