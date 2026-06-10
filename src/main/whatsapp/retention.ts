/**
 * Plan 20-05 — 30-day rolling retention sweep at 03:30 (D-14).
 *
 * Mirrors sweep-cron.ts shape exactly:
 *   CRON_KEY const, WhatsAppRetentionDeps + WhatsAppRetentionHandle interfaces,
 *   runSweep() function, startWhatsAppRetention() factory.
 *
 * Cron time: '30 3 * * *' (03:30) — must NOT share the 03:00 socket-recycle
 * minute (D-14 addendum).
 *
 * Deletes whatsapp_message WHERE sent_at < now-30d. FK ON DELETE CASCADE in
 * migration 138 means group deletion also removes messages, but this sweep
 * only targets old messages directly.
 *
 * Also exports extractText() — the text-only whitelist used by ingest.ts
 * (WA-07: images/audio/video/document/sticker return null → no row stored).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import nodeCron, { type ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';

type Db = Database.Database;

// ─── extractText — WA-07 text-only whitelist ─────────────────────────────────

/**
 * Minimal Baileys message shape for text extraction.
 * Only the `message` field is needed; all other fields are ignored.
 */
interface WaMessageForText {
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: { caption?: string | null } | null;
    videoMessage?: { caption?: string | null } | null;
    documentMessage?: unknown;
    audioMessage?: unknown;
    stickerMessage?: unknown;
    [key: string]: unknown;
  } | null;
}

/**
 * Extract the text content from a Baileys proto message.
 *
 * Returns null for any media message type (image, audio, video, document,
 * sticker) — even if they have a caption. Only plain-text message types
 * (conversation, extendedTextMessage) return text.
 *
 * WA-07: media blobs are NEVER stored. Only text is persisted.
 *
 * Exported here so ingest.ts can import it from a single location.
 */
export function extractText(msg: WaMessageForText): string | null {
  const m = msg?.message;
  if (!m) return null;

  // Media types — always null (WA-07 text-only gate).
  if (
    m.imageMessage != null ||
    m.audioMessage != null ||
    m.videoMessage != null ||
    m.documentMessage != null ||
    m.stickerMessage != null
  ) {
    return null;
  }

  // Plain text types.
  if (typeof m.conversation === 'string' && m.conversation.length > 0) {
    return m.conversation;
  }
  if (
    m.extendedTextMessage &&
    typeof m.extendedTextMessage.text === 'string' &&
    m.extendedTextMessage.text.length > 0
  ) {
    return m.extendedTextMessage.text;
  }

  return null;
}

// ─── Retention sweep ──────────────────────────────────────────────────────────

const CRON_KEY = 'whatsapp-retention-sweep';

export interface WhatsAppRetentionDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>;
  /** Override cron expression for tests. Defaults to '30 3 * * *'. */
  cron?: string;
  /**
   * Register the cron task with scheduler.cronRegistry so the
   * no-bare-cron-schedule ratchet passes.
   * Optional for backwards compatibility with tests that pass null.
   */
  scheduler: SchedulerHandle | null;
  /** Seal-guard hook (mirrors sweep-cron.ts BG-04 pattern). */
  dbHolder: Pick<DbHolder, 'db'> | null;
}

export interface WhatsAppRetentionHandle {
  stop(): void;
  /** Run the sweep immediately (useful for tests and bootPoll catchup). */
  runNow(): number;
}

/**
 * Delete whatsapp_message rows with sent_at older than 30 days.
 * Returns the count of deleted rows.
 */
function runSweep(db: Db, logger: Pick<Logger, 'info'>): number {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare<[string]>(
    `DELETE FROM whatsapp_message WHERE sent_at < ?`,
  );
  const result = stmt.run(cutoff);
  logger.info({
    scope: 'whatsapp-retention',
    event: 'sweep',
    deleted: result.changes,
    cutoff,
  });
  return result.changes;
}

/**
 * Start the WhatsApp retention sweep cron at 03:30 (D-14).
 *
 * Mirrors startTombstoneSweep() from sweep-cron.ts exactly, with:
 *   - cron time '30 3 * * *' (NOT 03:00 — must not collide with socket recycle)
 *   - DELETE whatsapp_message (not knowledge_files)
 *   - CRON_KEY = 'whatsapp-retention-sweep'
 */
export function startWhatsAppRetention(deps: WhatsAppRetentionDeps): WhatsAppRetentionHandle {
  const { db, logger } = deps;
  const cronExpr = deps.cron ?? '30 3 * * *';

  const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
    // Seal-guard (mirrors sweep-cron.ts 67-77 BG-04 pattern).
    const dbRef = deps.dbHolder?.db;
    if (deps.dbHolder && !dbRef) {
      pendingCatchup.add(CRON_KEY);
      trayBus.setBadge();
      return;
    }
    runSweep(db, logger);
  });

  // Register with scheduler.cronRegistry so the no-bare-cron-schedule ratchet
  // passes and powerMonitor suspend/resume can find the task.
  if (deps.scheduler) {
    deps.scheduler.cronRegistry.set(CRON_KEY, task);
  }

  return {
    stop() {
      task.stop();
      if (deps.scheduler) deps.scheduler.cronRegistry.delete(CRON_KEY);
    },
    runNow() {
      return runSweep(db, logger);
    },
  };
}
