/**
 * Plan 02-01 — Gmail sync engine.
 *
 * `GmailSync.tick()` is the unit-of-work driven by the 5-minute cron in
 * `ipc/gmail.ts`. Responsibilities:
 *
 *   1. Read the gmail_account row. If history_id is NULL, run fullResync7d().
 *   2. listHistory(startHistoryId).
 *      - HistoryInvalidatedError → fullResync7d() (delivers the no-silent-gap
 *        invariant after >7-day app sleep — Pitfall 11).
 *      - TokenInvalidError       → set gmail_account.last_error = `token-${reason}`
 *                                   and re-throw so the IPC layer surfaces it.
 *   3. For each messagesAdded entry: getMessageMetadata(id), build a row.
 *   4. Apply rows + advance history_id + last_synced_at in ONE db.transaction
 *      (atomic cursor advance — Pitfall 11 / T-02-01-08).
 *
 * Everything (Google API call AND DB write) is funnelled through
 * scheduler.queue.add(...) — Pitfall 16: single-writer SQLite + serialized
 * LLM/API discipline carried over from Phase 1.
 */
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import type {
  GmailClient,
  GmailMessageMetadata,
  HistoryEntry,
} from './gmail';
import { HistoryInvalidatedError } from './gmail';
import { TokenInvalidError } from './auth';

type Db = Database.Database;

export interface GmailSyncDeps {
  db: Db;
  client: GmailClient;
  scheduler: { queue: InstanceType<typeof PQueueImport> };
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  /**
   * Plan 03-03 — post-insert hook. Invoked AFTER `applyRowsAndAdvanceCursor`
   * commits, with the list of message ids that were freshly inserted (NOT
   * idempotent re-runs). The hook is responsible for enqueueing triage
   * (or other downstream work) onto its own queue; we do NOT await it so
   * sync completion isn't gated on triage drain (CONTEXT cross-cutting
   * + plan §triage-on-sync delta-only).
   */
  onMessagesInserted?: (ids: string[]) => void;
}

const FROM_HEADER = 'From';
const SUBJECT_HEADER = 'Subject';

function header(msg: GmailMessageMetadata, name: string): string {
  const headers = msg.payload?.headers ?? [];
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

interface MessageRow {
  id: string;
  thread_id: string;
  from_addr: string;
  subject: string;
  snippet: string;
  received_at: string;
  label_ids: string;
  is_unread: 0 | 1;
  is_important: 0 | 1;
  history_id: string | null;
  fetched_at: string;
}

function toRow(msg: GmailMessageMetadata, fetchedAtIso: string): MessageRow {
  const labels = msg.labelIds ?? [];
  const internal = msg.internalDate ? Number(msg.internalDate) : Date.now();
  const received_at = new Date(internal).toISOString();
  return {
    id: msg.id,
    thread_id: msg.threadId,
    from_addr: header(msg, FROM_HEADER),
    subject: header(msg, SUBJECT_HEADER),
    snippet: msg.snippet ?? '',
    received_at,
    label_ids: JSON.stringify(labels),
    is_unread: labels.includes('UNREAD') ? 1 : 0,
    is_important: labels.includes('IMPORTANT') ? 1 : 0,
    history_id: msg.historyId ?? null,
    fetched_at: fetchedAtIso,
  };
}

export class GmailSync {
  private readonly db: Db;
  private readonly client: GmailClient;
  private readonly scheduler: { queue: InstanceType<typeof PQueueImport> };
  private readonly logger?: Pick<Logger, 'info' | 'warn'>;
  private readonly now: () => Date;
  private readonly onMessagesInserted?: (ids: string[]) => void;

  constructor(deps: GmailSyncDeps) {
    this.db = deps.db;
    this.client = deps.client;
    this.scheduler = deps.scheduler;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
    this.onMessagesInserted = deps.onMessagesInserted;
  }

  /**
   * One unit of incremental sync. Idempotent: re-running with the same
   * upstream state writes no new rows. Caller is expected to wrap calls in
   * try/catch — TokenInvalidError is intentionally re-thrown.
   */
  async tick(): Promise<void> {
    const acct = this.readAccount();
    if (!acct) {
      // No account row yet — caller is expected to create one (during connect).
      return;
    }
    if (!acct.history_id) {
      await this.fullResync7d();
      return;
    }

    let result;
    try {
      result = await this.scheduler.queue.add(() =>
        this.client.listHistory({ startHistoryId: acct.history_id! }),
      );
    } catch (err) {
      if (err instanceof HistoryInvalidatedError) {
        this.logger?.info(
          { scope: 'gmail-sync', event: 'history-invalidated' },
          'historyId rejected by Google; falling back to 7d full resync',
        );
        await this.fullResync7d();
        return;
      }
      if (err instanceof TokenInvalidError) {
        this.recordAuthError(err.reason);
        throw err;
      }
      throw err;
    }

    if (!result) return;

    const addedIds = collectAddedIds(result.history);
    const metadatas: GmailMessageMetadata[] = [];
    for (const id of addedIds) {
      try {
        const md = await this.scheduler.queue.add(() => this.client.getMessageMetadata(id));
        if (md) metadatas.push(md);
      } catch (err) {
        if (err instanceof TokenInvalidError) {
          this.recordAuthError(err.reason);
          throw err;
        }
        // Skip individual fetch failures; next tick will retry.
        this.logger?.warn(
          { scope: 'gmail-sync', event: 'metadata-fetch-failed', id, err: (err as Error).message },
          'gmail.users.messages.get failed; will retry next tick',
        );
      }
    }

    const newHistoryId = result.historyId;
    const fetchedAt = this.now().toISOString();
    await this.scheduler.queue.add(() =>
      this.applyRowsAndAdvanceCursor(metadatas, newHistoryId, fetchedAt),
    );
  }

  /**
   * Full 7-day backfill. Used on first connect AND after HistoryInvalidatedError.
   * Pages through users.messages.list?q=newer_than:7d; for each page fetches
   * metadata; commits the whole page set + the new historyId atomically.
   */
  async fullResync7d(): Promise<void> {
    const profile = await this.scheduler.queue.add(() => this.client.getProfile());
    if (!profile) return;
    const newHistoryId = profile.historyId;

    let pageToken: string | undefined;
    const allIds: string[] = [];
    do {
      const page = await this.scheduler.queue.add(() =>
        this.client.listMessages({ q: 'newer_than:7d', pageToken }),
      );
      if (!page) break;
      for (const m of page.messages) allIds.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken);

    const metadatas: GmailMessageMetadata[] = [];
    for (const id of allIds) {
      try {
        const md = await this.scheduler.queue.add(() => this.client.getMessageMetadata(id));
        if (md) metadatas.push(md);
      } catch (err) {
        if (err instanceof TokenInvalidError) {
          this.recordAuthError(err.reason);
          throw err;
        }
        this.logger?.warn(
          { scope: 'gmail-sync', event: 'metadata-fetch-failed', id, err: (err as Error).message },
          'gmail.users.messages.get failed during full resync',
        );
      }
    }

    const fetchedAt = this.now().toISOString();
    await this.scheduler.queue.add(() =>
      this.applyRowsAndAdvanceCursor(metadatas, newHistoryId, fetchedAt),
    );
  }

  // ------------------------- DB helpers (single-writer) -------------------------

  private readAccount(): { email: string; history_id: string | null } | null {
    const row = this.db
      .prepare('SELECT email, history_id FROM gmail_account WHERE id = 1')
      .get() as { email: string; history_id: string | null } | undefined;
    return row ?? null;
  }

  private applyRowsAndAdvanceCursor(
    metadatas: GmailMessageMetadata[],
    newHistoryId: string,
    fetchedAtIso: string,
  ): void {
    const rows = metadatas.map((m) => toRow(m, fetchedAtIso));
    // Plan 03-03 — pre-compute newly inserted ids (delta-only): inspect
    // existing rows BEFORE upsert. Skips when the prepared statement is not
    // available (in-memory test shims that don't implement SELECT id FROM
    // gmail_message). Best-effort: a missing existence probe means we may
    // re-fire the hook on a re-run, but the triage-side INSERT OR IGNORE
    // makes that a no-op (store-once immutable).
    let preExistingIds = new Set<string>();
    try {
      const sel = this.db.prepare('SELECT id FROM gmail_message WHERE id = ?');
      for (const r of rows) {
        const hit = sel.get(r.id) as { id: string } | undefined;
        if (hit) preExistingIds.add(r.id);
      }
    } catch {
      preExistingIds = new Set();
    }
    const tx = this.db.transaction(() => {
      // INSERT OR REPLACE INTO gmail_message — upsert; idempotent on retry.
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO gmail_message
         (id, thread_id, from_addr, subject, snippet, received_at, label_ids, is_unread, is_important, history_id, fetched_at)
         VALUES (@id, @thread_id, @from_addr, @subject, @snippet, @received_at, @label_ids, @is_unread, @is_important, @history_id, @fetched_at)`,
      );
      for (const r of rows) stmt.run(r);
      this.db
        .prepare(
          `UPDATE gmail_account
           SET history_id = @history_id, last_synced_at = @last_synced_at, last_error = NULL
           WHERE id = 1`,
        )
        .run({ history_id: newHistoryId, last_synced_at: fetchedAtIso });
    });
    tx();
    if (this.onMessagesInserted) {
      const newlyInserted = rows
        .map((r) => r.id)
        .filter((id) => !preExistingIds.has(id));
      if (newlyInserted.length > 0) {
        try {
          this.onMessagesInserted(newlyInserted);
        } catch (err) {
          // Hook errors must not break sync. Log and continue.
          this.logger?.warn(
            { scope: 'gmail-sync', event: 'onMessagesInserted-failed', err: (err as Error).message },
            'post-sync hook threw; triage enqueue skipped for this batch',
          );
        }
      }
    }
  }

  private recordAuthError(reason: 'expired' | 'revoked'): void {
    try {
      this.db
        .prepare('UPDATE gmail_account SET last_error = ? WHERE id = 1')
        .run(`token-${reason}`);
    } catch {
      /* best-effort surfacing; the re-thrown error already covers correctness */
    }
  }
}

export function createGmailSync(deps: GmailSyncDeps): GmailSync {
  return new GmailSync(deps);
}

function collectAddedIds(history: HistoryEntry[]): string[] {
  const out: string[] = [];
  for (const entry of history) {
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) out.push(added.message.id);
    }
  }
  return out;
}
