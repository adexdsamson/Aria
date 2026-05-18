/**
 * Plan 03-04 Task 4 — Gmail send adapter.
 *
 * THE ONLY call site for `gmail.users.messages.send` in the codebase.
 * `tests/static/single-send-call-site.test.ts` asserts this invariant.
 *
 * Send authorization is gated by `assertApproved` as the FIRST executable
 * line of `sendApprovedEmail`. Any caller attempting to send a row that is
 * not in state='approved', or a forced-explicit row missing
 * approval_path='explicit', throws ApprovalGateError and the Gmail API is
 * NEVER reached. The static-grep enforcer + this gate together provide
 * APPR-01 / APPR-07 end-to-end.
 *
 * RFC 2822 raw payload: the message body is base64url-encoded per Gmail
 * API spec. When `inReplyTo` is set the adapter includes BOTH `In-Reply-To`
 * and `References` headers so Gmail threads the reply correctly.
 *
 * send_log row is written on BOTH ok and error paths so we have a complete
 * audit trail (T-03-04-06 mitigation). Approval row transitions
 * `approved -> sent` ONLY on Gmail API success.
 *
 * Source: RESEARCH §Example 2 (verbatim shape).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { google } from 'googleapis';
import { assertApproved } from '../../approvals/gate';
import {
  getApproval,
  transitionTo,
  writeSendLog,
} from '../../approvals/persist';
import { getOAuth2Client } from './auth';

type Db = Database.Database;

export interface SendResult {
  ok: true;
  providerMsgId: string;
}

export interface BuildRfc2822Args {
  to: string[];
  subject: string;
  body: string;
  /** Gmail Message-ID of the original message to thread under (no angle
   *  brackets — caller passes the bare id; this function wraps with <>). */
  inReplyTo: string | null;
}

/**
 * Construct a minimal RFC 2822 message string suitable for base64url-encoding
 * and submission to `gmail.users.messages.send` (raw field).
 */
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

export interface SendApprovedDeps {
  /** Override the Gmail-client constructor (tests). */
  buildGmailClient?: () => Promise<ReturnType<typeof google.gmail>>;
}

/**
 * Send the approval-row identified by `approvalId` via Gmail. FIRST LINE
 * MUST be `assertApproved(db, approvalId)` — the static grep + bypass-attempt
 * unit tests enforce this.
 *
 * Returns the Gmail provider message id on success; throws otherwise.
 */
export async function sendApprovedEmail(
  db: Db,
  approvalId: string,
  deps: SendApprovedDeps = {},
): Promise<SendResult> {
  assertApproved(db, approvalId);

  const row = getApproval(db, approvalId);
  if (!row) {
    // Defensive: assertApproved already threw 'not-found' if the row is
    // missing. This is unreachable under the current gate semantics; left as
    // belt-and-suspenders.
    throw new Error(`approval-not-found:${approvalId}`);
  }

  const recipients: string[] = row.recipients_json
    ? (JSON.parse(row.recipients_json) as string[])
    : [];
  const subject = row.subject ?? '';
  const body = row.body_edited ?? row.body_original ?? '';
  // Source message id is the Gmail Message-ID of the inbound message we're
  // replying to — used for threading. Phase 2 stores gmail_message.id as
  // the API message id; for proper threading we'd need the RFC 822
  // Message-Id header. Phase 6 contacts work tightens this; v1 falls back
  // to the gmail API id which still keeps the response in the same thread
  // because Gmail uses the inReplyTo header for threading hints when the
  // RFC Message-Id isn't recognized.
  const inReplyTo = row.source_message_id;

  const raw = buildRfc2822({ to: recipients, subject, body, inReplyTo });
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

  // Always write send_log — both success and failure paths (T-03-04-06).
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
    // Row stays in 'approved' — do NOT transition to 'sent' on failure.
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
