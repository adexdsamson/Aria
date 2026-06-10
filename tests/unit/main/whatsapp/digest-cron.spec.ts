/**
 * Plan 21-02 Task 1 — digest-cron.ts spec (Wave 0 RED stubs).
 *
 * Asserts digest-cron behavior before the implementation file exists.
 * All tests in this file are RED until Plan 21-03 creates
 * src/main/whatsapp/digest-cron.ts.
 *
 * Coverage:
 *   WA-08 / D-06   — runNow() writes a non-NULL summary_text digest row
 *   WA-10 / Pitfall 2 — generateText throws → row written with summary_text=NULL
 *   D-06 / Pitfall 3  — re-running runNow() on a NULL row overwrites (INSERT OR REPLACE)
 *   D-07.1             — dbHolder.db===null at cron tick → pendingCatchup.has('whatsapp-digest')
 *   D-09               — partial p-queue failure: grp1 succeeds, grp2 throws → mixed rows
 *
 * Run: npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { pendingCatchup } from '../../../../src/main/lifecycle/pendingCatchup';

// Module under test — does not exist yet; RED-fails until Plan 21-03 lands.
import { startWhatsAppDigest } from '../../../../src/main/whatsapp/digest-cron';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

const loggerMock = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
};

const MOCK_SUMMARY_TEXT =
  '### KEY POINTS\n- Point A\n### DECISIONS\n(nothing to report)\n### OPEN QUESTIONS\n(nothing to report)\n### MENTIONS\n(nothing to report)';

describe('WhatsApp digest cron', () => {
  let db: ReturnType<typeof openDb>;
  let mockGenerateText: ReturnType<typeof vi.fn>;
  let mockGetLocalModel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-digest-cron');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    // Seed a tracked group: grp1 with 3 messages (exceeds min-activity threshold)
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('grp1@g.us', 'Alpha', 5, 1);

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp1@g.us', 'alice@s.whatsapp.net', 'msg1', new Date().toISOString(), 'Hello world from sender');

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp1@g.us', 'bob@s.whatsapp.net', 'msg2', new Date().toISOString(), 'Another message here');

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp1@g.us', 'carol@s.whatsapp.net', 'msg3', new Date().toISOString(), 'Third message for threshold');

    // Seed a second tracked group: grp2 with 3 messages
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('grp2@g.us', 'Beta', 4, 1);

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp2@g.us', 'dave@s.whatsapp.net', 'msg4', new Date().toISOString(), 'Beta group message 1');

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp2@g.us', 'eve@s.whatsapp.net', 'msg5', new Date().toISOString(), 'Beta group message 2');

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('grp2@g.us', 'frank@s.whatsapp.net', 'msg6', new Date().toISOString(), 'Beta group message 3');

    // Clear pendingCatchup between tests to avoid cross-test pollution
    pendingCatchup.drain();

    mockGenerateText = vi.fn().mockResolvedValue({ text: MOCK_SUMMARY_TEXT });
    mockGetLocalModel = vi.fn().mockReturnValue({});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('runNow() writes a digest row with non-NULL summary_text for a tracked group (WA-08/D-06)', async () => {
    const handle = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: null as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    await handle.runNow();

    const row = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp1@g.us') as { summary_text: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.summary_text).not.toBeNull();
    expect(typeof row!.summary_text).toBe('string');
  });

  it('generateText throws → digest row written with summary_text=NULL (Ollama-down path WA-10/Pitfall 2)', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    mockGenerateText.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const handle = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: null as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    await handle.runNow();

    const row = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp1@g.us') as { summary_text: string | null } | undefined;

    // Row must exist (attempt was recorded) but summary_text=NULL
    expect(row).toBeDefined();
    expect(row!.summary_text).toBeNull();
  });

  it('re-running runNow() on a NULL row overwrites it with the new result (INSERT OR REPLACE) (D-06/Pitfall 3)', async () => {
    // First run: Ollama down → NULL row
    mockGenerateText.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    mockGenerateText.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const handle = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: null as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    await handle.runNow();

    const nullRow = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp1@g.us') as { summary_text: string | null } | undefined;
    expect(nullRow!.summary_text).toBeNull();

    // Second run: Ollama back up → INSERT OR REPLACE should overwrite the NULL row
    mockGenerateText.mockResolvedValue({ text: MOCK_SUMMARY_TEXT });

    await handle.runNow();

    const updatedRow = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp1@g.us') as { summary_text: string | null } | undefined;
    expect(updatedRow!.summary_text).not.toBeNull();
    expect(typeof updatedRow!.summary_text).toBe('string');
  });

  it('dbHolder.db===null at cron tick → pendingCatchup adds "whatsapp-digest" (D-07.1)', async () => {
    const dbHolder = { db: null };

    startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: dbHolder as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    // Manually simulate the cron tick by calling runNow with a null-db scenario.
    // The cron callback (not runNow) checks dbHolder; we test via the handle's
    // internal cron callback path. Since we can't fire the scheduled cron in tests,
    // we verify the seal-guard behavior by creating a handle with dbHolder.db=null
    // and observing that the implementation adds 'whatsapp-digest' to pendingCatchup
    // when dbHolder is provided but db is null.
    //
    // The implementation must check: if (deps.dbHolder && !deps.dbHolder.db) → pendingCatchup.add('whatsapp-digest')
    // We trigger this by calling a test-cron-tick helper or via the factory's internal tick.
    // Per the plan pattern, the cron callback is: () => { if (dbHolder && !dbHolder.db) { pendingCatchup.add(CRON_KEY); return; } ... }
    // We simulate by calling the handle's internal fire — which is exposed as runNow() on the dbHolder-null path.

    // Force the cron callback logic path: create a second handle where dbHolder.db is null
    // and simulate firing the cron tick through the exposed interface
    const dbHolderNull = { db: null as unknown };
    const handleWithNullDb = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: dbHolderNull as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    // Trigger cron-path behavior directly via the handle
    // The implementation should fire pendingCatchup.add('whatsapp-digest') when dbHolder.db===null
    if (typeof (handleWithNullDb as unknown as Record<string, unknown>).fireCronTick === 'function') {
      await (handleWithNullDb as unknown as { fireCronTick: () => Promise<void> }).fireCronTick();
    } else {
      // Alternative: the implementation exposes the cron path through a dedicated test seam
      // If not, calling runNow() with null dbHolder must still trigger the seal guard
      await handleWithNullDb.runNow();
    }

    expect(pendingCatchup.has('whatsapp-digest')).toBe(true);
  });

  it('multi-day: prior-day digest row exists → today digest is still written (CR-01 regression guard)', async () => {
    // Arrange: seed a PRIOR-DAY non-NULL digest row for grp1 (simulates day-1 success).
    // The old CTE would set watermark = MAX(m.sent_at) of ALL grp1 messages, matching
    // only the single newest message — below MIN_ACTIVITY → group silently skipped.
    // The fixed CTE derives the floor from last_date (yesterday), so today's messages
    // (sent_at = now) are all >= yesterday 'T00:00:00.000Z' and are correctly included.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    db.prepare(
      `INSERT INTO whatsapp_group_digest (jid, date, summary_text, generated_at, model_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('grp1@g.us', yesterday, 'Prior day summary', Date.now() - 86_400_000, 'llama3.1:8b');

    // Existing beforeEach already seeded grp1 with 3 fresh messages (sent_at = now = today).
    // No extra messages needed; the 3 seeded messages exceed MIN_ACTIVITY.

    const handle = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: null as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    await handle.runNow();

    const todayRow = db
      .prepare(`SELECT summary_text, date FROM whatsapp_group_digest WHERE jid = ? AND date = ?`)
      .get('grp1@g.us', today) as { summary_text: string | null; date: string } | undefined;

    // Today's digest row must exist with non-NULL summary_text.
    // Fails against the old CTE (group skipped because MAX(m.sent_at) watermark = latest
    // message, leaving <MIN_ACTIVITY messages after filter).
    expect(todayRow).toBeDefined();
    expect(todayRow!.summary_text).not.toBeNull();
    expect(typeof todayRow!.summary_text).toBe('string');
    expect(todayRow!.date).toBe(today);
  });

  it('partial p-queue failure: grp1 succeeds, grp2 generateText throws → grp1 row non-NULL, grp2 row NULL (D-09)', async () => {
    // First call resolves (for grp1), second call rejects (for grp2)
    mockGenerateText
      .mockResolvedValueOnce({ text: MOCK_SUMMARY_TEXT })
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const handle = startWhatsAppDigest({
      db,
      logger: loggerMock as never,
      cron: '0 5 * * *',
      scheduler: null as never,
      dbHolder: null as never,
      generateTextFn: mockGenerateText,
      getLocalModelFn: mockGetLocalModel,
    });

    await handle.runNow();

    const grp1Row = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp1@g.us') as { summary_text: string | null } | undefined;

    const grp2Row = db
      .prepare(`SELECT summary_text FROM whatsapp_group_digest WHERE jid = ?`)
      .get('grp2@g.us') as { summary_text: string | null } | undefined;

    // grp1 must have a non-NULL summary (succeeded)
    expect(grp1Row).toBeDefined();
    expect(grp1Row!.summary_text).not.toBeNull();

    // grp2 must have a NULL summary (failed) — partial failure preserved
    expect(grp2Row).toBeDefined();
    expect(grp2Row!.summary_text).toBeNull();
  });
});
