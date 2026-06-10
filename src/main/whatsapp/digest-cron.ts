/**
 * Plan 21-03 — 05:00 WhatsApp group digest cron (D-12).
 *
 * Mirrors src/main/whatsapp/retention.ts shape exactly:
 *   CRON_KEY const, WhatsAppDigestDeps + WhatsAppDigestHandle interfaces,
 *   runDigest() function, startWhatsAppDigest() factory.
 *
 * Cron time: '0 5 * * *' (05:00) — verified free slot (D-12).
 *
 * Calls getLocalModel() + generateText() for each tracked group.
 * NEVER imports getFrontierModel — SC3 no-frontier ratchet covers this
 * file by construction (lives under src/main/whatsapp/).
 *
 * Pitfall 2 (RESEARCH): getLocalModel() does NOT fail when Ollama is offline.
 * The try/catch wraps await generateText(), not getLocalModel(). Failed groups
 * write summary_text=NULL (WA-10).
 *
 * Pitfall 3 (RESEARCH): INSERT OR REPLACE (not INSERT OR IGNORE) so
 * Generate-now retry overwrites a prior NULL row (D-06/Pitfall 3).
 *
 * Pitfall 4 (RESEARCH): sent_at is stored as ISO 8601 strings despite INTEGER
 * column declaration. All window math uses ISO strings throughout (D-05).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import nodeCron, { type ScheduledTask } from 'node-cron';
import PQueueImport from 'p-queue';
import { generateText } from 'ai';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';
import { getLocalModel, DEFAULT_LOCAL_MODEL } from '../llm/providers';

type Db = Database.Database;

// p-queue v9 is ESM-only; when bundled to CJS by electron-vite, the default
// export lands on `.default`. Normalize at module load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PQueue: typeof PQueueImport = ((PQueueImport as any).default ?? PQueueImport) as typeof PQueueImport;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Must match CatchupChannel union value in pendingCatchup.ts (Plan 21-01). */
const CRON_KEY = 'whatsapp-digest';

const DEFAULT_CRON = '0 5 * * *';

/** Minimum messages in the window to run a digest. Groups below this are skipped (D-10). */
const MIN_ACTIVITY = 3;

/** Rolling window in days for message fetching (D-04). */
const WINDOW_DAYS = 3;

/** Maximum messages to send to the LLM per group (token budget, ~6k tokens). */
const MAX_MESSAGES = 150;

const DIGEST_SYSTEM_PROMPT = `You are Aria, an executive chief-of-staff AI.
Summarize the following WhatsApp group messages for your executive's morning briefing.
Be terse, factual, and executive-focused. Use exactly the section headers shown.
If a section has nothing to report, write only the header followed by "(nothing to report)".`;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface WhatsAppDigestDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>;
  /** Override cron expression for tests. Defaults to '0 5 * * *'. */
  cron?: string;
  /**
   * Register the cron task with scheduler.cronRegistry so the
   * no-bare-cron-schedule ratchet passes.
   * Optional for backwards compatibility with tests that pass null.
   */
  scheduler: SchedulerHandle | null;
  /** Seal-guard hook (mirrors retention.ts BG-04 pattern). */
  dbHolder: Pick<DbHolder, 'db'> | null;
  /** Override for tests; otherwise uses ai.generateText. */
  generateTextFn?: typeof generateText;
  /** Override for tests; otherwise uses providers.getLocalModel. */
  getLocalModelFn?: typeof getLocalModel;
  /** User's display name for heuristic @mentions in prompt (D-03). Defaults to ''. */
  userDisplayName?: string;
  /** Local part of creds.me.id for heuristic mention matching (D-03). Defaults to ''. */
  meJidLocalPart?: string;
}

export interface WhatsAppDigestHandle {
  stop(): void;
  /** Run the digest immediately (useful for tests and bootPoll catchup). */
  runNow(): Promise<void>;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface MessageRow {
  body_text: string;
  sent_at: string;
  sender_jid: string;
}

function buildGroupPrompt(
  messages: MessageRow[],
  groupName: string,
  date: string,
  userDisplayName: string,
  meJidLocalPart: string,
): string {
  const lines = messages.map((m) => `${m.sender_jid}: ${m.body_text}`).join('\n');
  const windowStart = messages.length > 0 ? messages[0].sent_at : '';
  const windowEnd = messages.length > 0 ? messages[messages.length - 1].sent_at : '';

  return [
    `GROUP: ${groupName}`,
    `DATE: ${date}`,
    `EXECUTIVE'S DISPLAY NAME: ${userDisplayName}`,
    `EXECUTIVE'S PHONE PART: ${meJidLocalPart}`,
    ``,
    `MESSAGES (${messages.length} messages, ${windowStart} to ${windowEnd}):`,
    lines,
    ``,
    `Produce a structured summary using ONLY these headers in this order:`,
    `### KEY POINTS`,
    `(2-4 bullet points of the most important topics discussed)`,
    ``,
    `### DECISIONS`,
    `(Explicit decisions made, or "(nothing to report)")`,
    ``,
    `### OPEN QUESTIONS`,
    `(Unresolved questions or action items needing the executive's input, or "(nothing to report)")`,
    ``,
    `### MENTIONS`,
    `(Any references to the executive by name or phone number, or "(nothing to report)")`,
  ].join('\n');
}

// ─── Core digest function ─────────────────────────────────────────────────────

/**
 * Run the digest loop for all tracked groups. Per-group errors write a NULL
 * row and do NOT throw to caller. runDigest() itself never throws.
 *
 * Uses ISO string comparisons throughout for sent_at (RESEARCH Pitfall 4/D-05).
 */
async function runDigest(deps: WhatsAppDigestDeps): Promise<void> {
  // Resolve the live db handle from the holder rather than using the connection
  // captured at first-unlock time. After BACKUP_RESTORE the holder is updated to
  // a new handle while deps.db still points to the closed connection.  Mirroring
  // the late-binding pattern used in retention.ts / closeToTrayReader (WR-02 fix).
  const db: Db = deps.dbHolder?.db ?? deps.db;
  const { logger } = deps;
  const localModelFactory = deps.getLocalModelFn ?? getLocalModel;
  const gen = deps.generateTextFn ?? generateText;
  const userDisplayName = deps.userDisplayName ?? '';
  const meJidLocalPart = deps.meJidLocalPart ?? '';

  try {
    // 1. Compute window (ISO string throughout — RESEARCH Pitfall 4 / D-05)
    const today = new Date().toISOString().slice(0, 10);
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // 2. Get tracked groups
    const trackedGroups = db
      .prepare<[]>(`SELECT jid, display_name FROM whatsapp_group WHERE tracked = 1`)
      .all() as Array<{ jid: string; display_name: string }>;

    if (trackedGroups.length === 0) {
      return;
    }

    // 3. Create p-queue with concurrency:1 to serialize per-group LLM calls (D-09)
    const queue = new PQueue({ concurrency: 1 });

    for (const group of trackedGroups) {
      const { jid, display_name: displayName } = group;

      queue.add(async () => {
        try {
          // 4a. Fetch messages in window using ISO string comparisons (Pitfall 4)
          //     Window floor = start-of-day of the most recent prior successful digest for
          //     this group (d.date < today, summary_text IS NOT NULL), converted to an ISO
          //     timestamp via || 'T00:00:00.000Z'.  Falls back to windowStart (WINDOW_DAYS
          //     ago) when no prior digest row exists.  The second AND m.sent_at >= ?
          //     (windowStart) is a hard cap so we never scan the entire message history on
          //     the very first run (D-04/D-05).
          //
          //     IMPORTANT: the prior CTE joined whatsapp_message × whatsapp_group_digest on
          //     jid and took MAX(m.sent_at), which collapsed to the group's latest message
          //     timestamp the moment any prior digest existed — causing all subsequent days
          //     to match ≤1 message, fall below MIN_ACTIVITY, and be skipped (CR-01 fix).
          //     The corrected CTE subqueries only whatsapp_group_digest so the watermark is
          //     the prior digest's *date*, not the latest message timestamp.
          //
          //     Bind params in order: jid, today, jid, windowStart, windowStart
          const messages = db
            .prepare<[string, string, string, string, string]>(
              `WITH last_digest AS (
                SELECT MAX(d.date) AS last_date
                FROM whatsapp_group_digest d
                WHERE d.jid = ?
                  AND d.summary_text IS NOT NULL
                  AND d.date < ?
              )
              SELECT m.jid, m.body_text, m.sent_at, m.sender_jid
              FROM whatsapp_message m
              WHERE m.jid = ?
                AND m.sent_at >= COALESCE(
                      (SELECT last_date || 'T00:00:00.000Z' FROM last_digest), ?)
                AND m.sent_at >= ?
              ORDER BY m.sent_at ASC
              LIMIT ${MAX_MESSAGES}`,
            )
            .all(jid, today, jid, windowStart, windowStart) as MessageRow[];

          // 4b. Skip if below min-activity threshold (D-10 sub-threshold omit)
          if (messages.length < MIN_ACTIVITY) {
            return;
          }

          // 4c. Get local model (synchronous — does NOT fail when Ollama is offline)
          const localModel = localModelFactory();

          // 4d. try/catch wraps await gen() — this is where Ollama-down fires (Pitfall 2)
          try {
            const { text } = await gen({
              model: localModel as Parameters<typeof gen>[0]['model'],
              system: DIGEST_SYSTEM_PROMPT,
              prompt: buildGroupPrompt(messages, displayName, today, userDisplayName, meJidLocalPart),
              temperature: 0,
            });

            // 4e. On success: INSERT OR REPLACE (D-06/Pitfall 3)
            db.prepare(
              `INSERT OR REPLACE INTO whatsapp_group_digest
                (jid, date, summary_text, generated_at, model_id)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(jid, today, text, Date.now(), DEFAULT_LOCAL_MODEL);
          } catch (err) {
            // Ollama down or model error — write NULL row to record the attempt (WA-10/Pitfall 2)
            logger.warn(
              { scope: 'whatsapp-digest', jid, err: (err as Error).message },
              'generateText failed for group — writing NULL digest row',
            );
            // INSERT OR REPLACE so retries can overwrite this NULL row (Pitfall 3)
            db.prepare(
              `INSERT OR REPLACE INTO whatsapp_group_digest
                (jid, date, summary_text, generated_at, model_id)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(jid, today, null, null, null);
          }
        } catch (outerErr) {
          // Catch any DB or preparation error for this group — log and continue
          logger.error(
            { scope: 'whatsapp-digest', jid, err: (outerErr as Error).message },
            'unexpected error processing group digest',
          );
        }
      });
    }

    // 5. Wait for all groups to finish
    await queue.onIdle();
  } catch (err) {
    // Outer catch: runDigest never throws to caller
    logger.error(
      { scope: 'whatsapp-digest', err: (err as Error).message },
      'runDigest outer error',
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Start the WhatsApp digest cron at 05:00 (D-12).
 *
 * Mirrors startWhatsAppRetention() from retention.ts exactly, with:
 *   - cron time '0 5 * * *' (free slot — verified via codebase grep)
 *   - CRON_KEY = 'whatsapp-digest'
 *   - runDigest() per-group LLM loop (instead of DELETE sweep)
 *   - runNow() returns Promise<void> (async, unlike retention's sync number)
 */
export function startWhatsAppDigest(deps: WhatsAppDigestDeps): WhatsAppDigestHandle {
  const cronExpr = deps.cron ?? DEFAULT_CRON;

  const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
    // Seal-guard (mirrors retention.ts lines 144-153 BG-04 pattern).
    const dbRef = deps.dbHolder?.db;
    if (deps.dbHolder && !dbRef) {
      pendingCatchup.add(CRON_KEY);
      trayBus.setBadge();
      return;
    }
    // Fire-and-forget; all errors are logged inside runDigest
    void runDigest(deps);
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
    runNow(): Promise<void> {
      // Seal-guard also applies on runNow() (D-07.1):
      // if dbHolder is provided and db is null, add to pendingCatchup and return.
      const dbRef = deps.dbHolder?.db;
      if (deps.dbHolder && !dbRef) {
        pendingCatchup.add(CRON_KEY);
        trayBus.setBadge();
        return Promise.resolve();
      }
      return runDigest(deps);
    },
  };
}
