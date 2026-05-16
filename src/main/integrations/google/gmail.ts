/**
 * Plan 02-01 — GmailClient interface + googleapis-backed implementation.
 *
 * Wraps the four googleapis Gmail v1 surfaces the sync engine consumes:
 *   - users.history.list      (incremental change stream)
 *   - users.messages.list     (full backfill query)
 *   - users.messages.get      (per-message metadata fetch)
 *   - users.getProfile        (current historyId + emailAddress)
 *
 * Error translation (the whole reason this wrapper exists):
 *   - 404 / errors[0].reason === 'notFound' on history.list  → HistoryInvalidatedError
 *   - invalid_grant on any call (response.data.error / errors[0].reason /
 *     401 + invalid_grant in message) → TokenInvalidError({reason})
 *
 * `reason` derivation:
 *   - error_description includes 'revoked' AND NOT 'expired or revoked'  → 'revoked'
 *   - otherwise → 'expired'
 *
 * The H2 case in the plan is the test-mode 7d-expiry payload:
 *   { error:'invalid_grant', error_description:'Token has been expired or revoked.' }
 *   This MUST map to reason:'expired' (test-mode 7d clock is not user revocation).
 *   Only an unambiguous 'revoked' (without 'expired or') yields reason:'revoked'.
 */
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { TokenInvalidError } from './auth';

export class HistoryInvalidatedError extends Error {
  override readonly name = 'HistoryInvalidatedError';
}

export interface GmailMessageMetadata {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    headers?: { name: string; value: string }[];
  };
}

export interface HistoryEntry {
  id?: string;
  messagesAdded?: { message: { id: string; threadId: string } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: unknown[];
  labelsRemoved?: unknown[];
}

export interface ListHistoryResult {
  history: HistoryEntry[];
  historyId: string;
}

export interface ListMessagesResult {
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
  historyId: string;
}

export interface GmailClient {
  listHistory(opts: { startHistoryId: string }): Promise<ListHistoryResult>;
  listMessages(opts: { q?: string; pageToken?: string }): Promise<ListMessagesResult>;
  getMessageMetadata(id: string): Promise<GmailMessageMetadata>;
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
}

interface GoogleErrorShape {
  code?: number;
  message?: string;
  errors?: { reason?: string; message?: string }[];
  response?: {
    status?: number;
    data?: {
      error?: string;
      error_description?: string;
    };
  };
}

/**
 * Inspect a googleapis error and, if it carries an `invalid_grant` signal,
 * throw a domain TokenInvalidError. Otherwise leave the error alone.
 *
 * Detection covers the three observable shapes:
 *   1. response.data.error === 'invalid_grant' (google-auth-library refresh-token path)
 *   2. errors[0].reason === 'invalid_grant' (legacy googleapis shape)
 *   3. code/status 401 + /invalid_grant/i in message (fallback)
 */
function maybeThrowTokenInvalid(err: unknown): never | void {
  const e = err as GoogleErrorShape;
  const dataError = e.response?.data?.error;
  const reasons = e.errors?.map((x) => x.reason).filter(Boolean) ?? [];
  const code = e.code ?? e.response?.status;
  const message = e.message ?? '';

  const hasInvalidGrant =
    dataError === 'invalid_grant' ||
    reasons.includes('invalid_grant') ||
    (code === 401 && /invalid_grant/i.test(message));

  if (!hasInvalidGrant) return;

  const desc = e.response?.data?.error_description ?? '';
  // 'revoked' wins only when the description is unambiguous about revocation
  // (i.e. NOT the test-mode 7d 'expired or revoked' phrasing).
  const explicitlyRevoked =
    /revoked/i.test(desc) && !/expired or revoked/i.test(desc);
  const reason: 'expired' | 'revoked' = explicitlyRevoked ? 'revoked' : 'expired';
  throw new TokenInvalidError({ reason, message: desc || `invalid_grant (${reason})` });
}

function isNotFound(err: unknown): boolean {
  const e = err as GoogleErrorShape;
  const code = e.code ?? e.response?.status;
  if (code === 404) return true;
  const reasons = e.errors?.map((x) => x.reason) ?? [];
  return reasons.includes('notFound');
}

/**
 * googleapis-backed GmailClient. All errors are translated to domain types
 * BEFORE escaping this layer so the sync engine only ever sees:
 *   HistoryInvalidatedError | TokenInvalidError | (other unexpected)
 */
export function createGmailClient(oauth2Client: OAuth2Client): GmailClient {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  return {
    async listHistory({ startHistoryId }) {
      try {
        const res = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded'],
        });
        return {
          history: (res.data.history ?? []) as HistoryEntry[],
          // history.list returns the NEW current historyId in `historyId`.
          historyId: String(res.data.historyId ?? startHistoryId),
        };
      } catch (err) {
        if (isNotFound(err)) {
          throw new HistoryInvalidatedError(
            'history.list returned notFound — historyId is older than Gmail\'s retention window',
          );
        }
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async listMessages({ q, pageToken }) {
      try {
        const res = await gmail.users.messages.list({
          userId: 'me',
          q,
          pageToken,
        });
        return {
          messages: (res.data.messages ?? []) as { id: string; threadId: string }[],
          nextPageToken: res.data.nextPageToken ?? undefined,
          historyId: String(res.data.resultSizeEstimate ?? ''),
        };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async getMessageMetadata(id) {
      try {
        const res = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        return res.data as GmailMessageMetadata;
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },

    async getProfile() {
      try {
        const res = await gmail.users.getProfile({ userId: 'me' });
        if (!res.data.emailAddress) {
          throw new Error('getProfile returned no emailAddress');
        }
        return {
          emailAddress: res.data.emailAddress,
          historyId: String(res.data.historyId ?? ''),
        };
      } catch (err) {
        maybeThrowTokenInvalid(err);
        throw err;
      }
    },
  };
}

// Re-export so consumers only need a single import surface.
export { TokenInvalidError } from './auth';
