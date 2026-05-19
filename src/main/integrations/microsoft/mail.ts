import { DeltaExpiredError, TokenInvalidError, TransientGraphError } from './errors';

export const MAIL_DELTA_SELECT = [
  'id',
  'conversationId',
  'internetMessageId',
  'subject',
  'from',
  'sender',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'replyTo',
  'receivedDateTime',
  'sentDateTime',
  'bodyPreview',
  'importance',
  'isRead',
  'isDraft',
  'hasAttachments',
  'webLink',
  'flag',
  'inferenceClassification',
  'parentFolderId',
  'categories',
] as const;

export interface MicrosoftMailItem {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  sender?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  bccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  replyTo?: Array<{ emailAddress?: { address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  importance?: string;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  flag?: { flagStatus?: string };
  inferenceClassification?: string;
  parentFolderId?: string;
  categories?: string[];
  '@removed'?: { reason?: string } | unknown;
}

export interface DeltaResult<T> {
  items: T[];
  tombstones: string[];
  cursor: string;
  hadFullResync: boolean;
}

export interface MicrosoftMailClient {
  graph: {
    api(path: string): {
      select(fields: string): {
        get(): Promise<unknown>;
      };
      header(key: string, value: string): {
        post(body: unknown): Promise<unknown>;
      };
      post(body: unknown): Promise<unknown>;
      get(): Promise<unknown>;
    };
  };
}

export interface MailDeltaOpts {
  cursor?: string | null;
  pageToken?: string | null;
}

function isGraphStatus(err: unknown, status: number): boolean {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return (e.status ?? e.statusCode ?? e.response?.status) === status;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function normalizeMailItem(item: MicrosoftMailItem, fetchedAtIso: string) {
  const fromAddr =
    item.from?.emailAddress?.address ??
    item.sender?.emailAddress?.address ??
    '';
  const threadId = item.conversationId ?? item.internetMessageId ?? item.id;
  const labels = toStringArray(item.categories);
  return {
    id: item.id,
    thread_id: threadId,
    from_addr: fromAddr,
    subject: item.subject ?? '',
    snippet: item.bodyPreview ?? '',
    received_at: item.receivedDateTime ?? item.sentDateTime ?? fetchedAtIso,
    label_ids: JSON.stringify(labels),
    is_unread: item.isRead ? 0 : 1,
    is_important: item.importance === 'high' || item.flag?.flagStatus === 'flagged' ? 1 : 0,
    history_id: null as string | null,
    fetched_at: fetchedAtIso,
  };
}

async function readPage(client: MicrosoftMailClient, path: string): Promise<{
  items: MicrosoftMailItem[];
  nextLink?: string;
  deltaLink?: string;
}> {
  try {
    const req = client.graph.api(path);
    const res = path.startsWith('/me/mailFolders/Inbox/messages/delta')
      ? await req.select(MAIL_DELTA_SELECT.join(',')).get()
      : await req.get();
    const body = res as {
      value?: MicrosoftMailItem[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    return {
      items: (body.value ?? []) as MicrosoftMailItem[],
      nextLink: body['@odata.nextLink'],
      deltaLink: body['@odata.deltaLink'],
    };
  } catch (err) {
    if (isGraphStatus(err, 410)) {
      throw new DeltaExpiredError('Microsoft mail delta cursor expired');
    }
    if (isGraphStatus(err, 401)) {
      throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft Graph returned 401' });
    }
    if (isGraphStatus(err, 429)) {
      throw new TransientGraphError('Microsoft Graph throttled mail delta');
    }
    throw err;
  }
}

export async function listMessagesDelta(
  client: MicrosoftMailClient,
  opts: MailDeltaOpts = {},
): Promise<DeltaResult<MicrosoftMailItem>> {
  const initial = opts.cursor ?? '/me/mailFolders/Inbox/messages/delta';
  const items: MicrosoftMailItem[] = [];
  const tombstones: string[] = [];
  let cursor = opts.cursor ?? initial;
  let pagePath = cursor;
  let hadFullResync = !opts.cursor;

  // Page through Graph's opaque delta links until we receive a deltaLink.
  // Cursor itself remains opaque to callers.
  while (true) {
    const page = await readPage(client, pagePath);
    for (const item of page.items) {
      if (item['@removed']) {
        tombstones.push(item.id);
      } else {
        items.push(item);
      }
    }
    if (page.deltaLink) {
      cursor = page.deltaLink;
      break;
    }
    if (!page.nextLink) {
      break;
    }
    pagePath = page.nextLink;
  }

  return { items, tombstones, cursor, hadFullResync };
}

export async function getMessage(client: MicrosoftMailClient, messageId: string): Promise<MicrosoftMailItem> {
  const res = await client.graph
    .api(`/me/messages/${encodeURIComponent(messageId)}`)
    .select(MAIL_DELTA_SELECT.join(',') + ',body')
    .get();
  return res as MicrosoftMailItem;
}

export async function sendMailViaGraph(
  client: MicrosoftMailClient,
  requestBody: Record<string, unknown>,
): Promise<{ ok: true }> {
  await client.graph.api('/me/sendMail').post(requestBody);
  return { ok: true };
}
