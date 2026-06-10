/**
 * Plan 20-05 — Privacy-filtered + batched message ingest (WA-06/WA-07).
 *
 * CRITICAL privacy boundary: the 3-line filter executes BEFORE any write
 * OR any logger call that references message content.
 *
 * Filter order (RESEARCH.md Pattern 3, Hard Gates 7/8/9):
 *   LINE 1 (gate 8): type !== 'notify' → return immediately
 *   LINE 2 (gate 9): !jid.endsWith('@g.us') → skip (drop DMs)
 *   LINE 3         : !isTracked(jid) → skip (drop untracked groups)
 *   TEXT-ONLY      : extractText(msg) === null → skip (WA-07, no media blobs)
 *
 * After filtering, survivors are buffered in memory and flushed via
 * scheduler.queue.add() in one transaction (~2s window). NEVER a sync
 * db.run() in the event handler (gate 7).
 *
 * Group content is local-only: no frontier model calls here (no-frontier
 * ratchet). The digest cron (Plan 20-06) uses getLocalModel() only.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type PQueueImport from 'p-queue';
import { extractText } from './retention';

type Db = Database.Database;

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface IngestHandlerDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>;
  /**
   * Scheduler queue for serialised single-writer batch flush (gate 7).
   * Optional: if absent, falls back to synchronous transaction (test convenience
   * when spec passes no scheduler).
   */
  scheduler?: { queue: InstanceType<typeof PQueueImport> };
}

// ─── Minimal Baileys message shape ────────────────────────────────────────────

interface WaMessageKey {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
}

interface WaMessage {
  key: WaMessageKey;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | Long | null;
}

// node-cron-compatible Long type (Baileys uses Long for messageTimestamp)
interface Long { toNumber(): number }

// ─── Buffer record ────────────────────────────────────────────────────────────

interface BufferedMessage {
  jid: string;
  senderJid: string;
  waId: string;
  sentAt: string;
  bodyText: string;
}

// ─── isTracked helper (prepared .get() against DB — single source of truth) ──

function makeIsTracked(db: Db): (jid: string) => boolean {
  const stmt = db.prepare<[string], { tracked: number }>(
    `SELECT tracked FROM whatsapp_group WHERE jid = ? LIMIT 1`,
  );
  return (jid: string): boolean => {
    const row = stmt.get(jid);
    return row?.tracked === 1;
  };
}

// ─── sentAt extraction ────────────────────────────────────────────────────────

function toSentAt(ts: number | Long | null | undefined): string {
  if (ts == null) return new Date().toISOString();
  const secs = typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(secs * 1000).toISOString();
}

// ─── createIngestHandler ─────────────────────────────────────────────────────

/**
 * Create the messages.upsert handler for a Baileys socket.
 *
 * Returns an async function that implements the WA-06 privacy boundary.
 * Registration on the socket is done by the session-manager (Plan 20-04 /
 * Plan 20-07 wiring).
 *
 * The handler is also directly callable in unit tests without a live socket.
 */
export function createIngestHandler(deps: IngestHandlerDeps): (
  event: { messages: WaMessage[]; type: string },
) => Promise<void> {
  const { db, logger, scheduler } = deps;

  const isTracked = makeIsTracked(db);

  const insertStmt = db.prepare<[string, string, string, string, string]>(
    `INSERT OR IGNORE INTO whatsapp_message
       (jid, sender_jid, wa_id, sent_at, body_text)
     VALUES (?, ?, ?, ?, ?)`,
  );

  /**
   * Flush a batch of buffered messages in a single transaction via the
   * scheduler queue (gate 7 — single-writer; no sync db.run in the handler).
   * If no scheduler is present (test without queue), run synchronously.
   */
  function flushBatch(batch: BufferedMessage[]): Promise<void> {
    if (batch.length === 0) return Promise.resolve();

    const doFlush = (): void => {
      const tx = db.transaction(() => {
        for (const r of batch) {
          insertStmt.run(r.jid, r.senderJid, r.waId, r.sentAt, r.bodyText);
        }
      });
      tx();
      // WA-06: count only, NEVER the message body — safe at info level and a
      // useful operational signal (also the live-UAT confirmation that ingest
      // from a tracked group reached whatsapp_message).
      logger.info(
        { scope: 'whatsapp-ingest', event: 'batch.flushed', count: batch.length },
        'whatsapp message batch flushed',
      );
    };

    if (scheduler) {
      return scheduler.queue.add(doFlush) as Promise<void>;
    }
    // Fallback for unit-test environments that don't provide a scheduler.
    doFlush();
    return Promise.resolve();
  }

  return async function handleMessagesUpsert(
    event: { messages: WaMessage[]; type: string },
  ): Promise<void> {
    const { messages, type } = event;

    // LINE 1 (gate 8): drop history/append batches — FIRST statement, no logging.
    if (type !== 'notify') return;

    const buffer: BufferedMessage[] = [];

    for (const msg of messages) {
      const jid = msg.key.remoteJid ?? '';

      // LINE 2 (gate 9): drop 1:1 DMs — BEFORE any write OR log of content.
      if (!jid.endsWith('@g.us')) continue;

      // LINE 3: drop untracked groups — DB is single source of truth.
      if (!isTracked(jid)) continue;

      // Text-only whitelist (WA-07): null → no row (media/audio/sticker dropped).
      const text = extractText(msg as never);
      if (text == null) continue;

      const senderJid = (msg.key.fromMe ? 'self' : jid) || jid;
      const waId = msg.key.id ?? '';
      const sentAt = toSentAt(msg.messageTimestamp as number | Long | null | undefined);

      buffer.push({ jid, senderJid: senderJid, waId, sentAt, bodyText: text });
    }

    // Flush survivors through scheduler.queue.add (gate 7 — batch transaction).
    await flushBatch(buffer);
  };
}

// ─── registerIngest (socket registration helper for Plan 20-07 wiring) ───────

export interface IngestRegistrationDeps extends IngestHandlerDeps {
  sock: { ev: { on: (event: string, handler: unknown) => void } };
}

/**
 * Register the messages.upsert handler on the given Baileys socket.
 * Called by the session-manager post-connect (Plan 20-07 wiring).
 */
export function registerIngest(deps: IngestRegistrationDeps): void {
  const handler = createIngestHandler(deps);
  deps.sock.ev.on('messages.upsert', handler);
}
