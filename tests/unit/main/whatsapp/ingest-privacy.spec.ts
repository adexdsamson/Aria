/**
 * R-WA06 / Gates 7/8/9 — CRITICAL privacy-filter integration spec.
 *
 * Asserts the three-line filter in ingest.ts (RESEARCH.md Pattern 3):
 *   Line 1 (gate 8): type !== 'notify' → drop (batch/history never persisted)
 *   Line 2 (gate 9): !jid.endsWith('@g.us') → drop (1:1 DMs never persisted)
 *   Line 3: !isTracked(jid) → drop (untracked groups never persisted)
 *
 * Privacy invariants (all must hold):
 *   A. A 1:1 @s.whatsapp.net message → ZERO rows in whatsapp_message
 *   B. An untracked @g.us message → ZERO rows in whatsapp_message
 *   C. A tracked @g.us message → exactly 1 row in whatsapp_message
 *   D. A type:'append' batch (not 'notify') → ZERO rows written
 *   E. The body text of untracked/DM messages must NEVER appear in any
 *      logger call (gate 9 — no pre-filter log of sensitive content)
 *
 * This spec RED-fails until Plan 20-05 (ingest.ts) lands.
 * Run: npx vitest run tests/unit/main/whatsapp/ingest-privacy.spec.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

// The module under test — does not exist yet; RED-fails until Plan 20-05 lands.
import { createIngestHandler } from '../../../../src/main/whatsapp/ingest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/** Build a minimal Baileys proto message structure. */
function makeMsg(opts: {
  jid: string;
  waId: string;
  body: string;
  fromMe?: boolean;
}): {
  key: { remoteJid: string; id: string; fromMe: boolean };
  message: { conversation: string };
  messageTimestamp: number;
} {
  return {
    key: { remoteJid: opts.jid, id: opts.waId, fromMe: opts.fromMe ?? false },
    message: { conversation: opts.body },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

describe('ingest.ts — privacy filter (gates 7/8/9, R-WA06)', () => {
  let db: ReturnType<typeof openDb>;
  let dataDir: string;
  let loggerSpy: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-ingest-privacy');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    loggerSpy = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    // Seed a tracked group and an untracked group
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('tracked-group@g.us', 'Tracked Group', 5, 1);
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('untracked-group@g.us', 'Untracked Group', 3, 0);
  });

  it('ingest module exports createIngestHandler', () => {
    expect(typeof createIngestHandler).toBe('function');
  });

  it('(A) 1:1 DM (@s.whatsapp.net) produces ZERO rows in whatsapp_message', async () => {
    const dmBody = 'SENSITIVE_DM_BODY_' + crypto.randomBytes(4).toString('hex');
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'contact@s.whatsapp.net', waId: 'wa-id-dm-1', body: dmBody })],
      type: 'notify',
    });

    const rows = db.prepare('SELECT * FROM whatsapp_message').all();
    expect(rows).toHaveLength(0);
  });

  it('(B) untracked @g.us message produces ZERO rows in whatsapp_message', async () => {
    const untrackedBody = 'UNTRACKED_BODY_' + crypto.randomBytes(4).toString('hex');
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'untracked-group@g.us', waId: 'wa-id-untracked-1', body: untrackedBody })],
      type: 'notify',
    });

    const rows = db.prepare('SELECT * FROM whatsapp_message').all();
    expect(rows).toHaveLength(0);
  });

  it('(C) tracked @g.us message produces exactly 1 row in whatsapp_message', async () => {
    const trackedBody = 'Hello tracked group';
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'tracked-group@g.us', waId: 'wa-id-tracked-1', body: trackedBody })],
      type: 'notify',
    });

    const rows = db.prepare('SELECT * FROM whatsapp_message').all() as { body_text: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body_text).toBe(trackedBody);
  });

  it('(D) type:append batch produces ZERO rows (line 1 gate)', async () => {
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'tracked-group@g.us', waId: 'wa-id-append-1', body: 'append msg' })],
      type: 'append',
    });

    const rows = db.prepare('SELECT * FROM whatsapp_message').all();
    expect(rows).toHaveLength(0);
  });

  it('(E) body text of 1:1 DM never appears in any logger call (gate 9)', async () => {
    const dmBody = 'SENSITIVE_DM_GATE9_' + crypto.randomBytes(4).toString('hex');
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'contact@s.whatsapp.net', waId: 'wa-id-dm-gate9', body: dmBody })],
      type: 'notify',
    });

    // Check all logger methods: none should have seen the body text
    const allCalls = [
      ...loggerSpy.warn.mock.calls,
      ...loggerSpy.info.mock.calls,
      ...loggerSpy.debug.mock.calls,
      ...loggerSpy.error.mock.calls,
    ];
    const allCallsStr = JSON.stringify(allCalls);
    expect(allCallsStr).not.toContain(dmBody);
  });

  it('(E) body text of untracked group message never appears in any logger call (gate 9)', async () => {
    const untrackedBody = 'UNTRACKED_GATE9_' + crypto.randomBytes(4).toString('hex');
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [makeMsg({ jid: 'untracked-group@g.us', waId: 'wa-id-untracked-gate9', body: untrackedBody })],
      type: 'notify',
    });

    const allCalls = [
      ...loggerSpy.warn.mock.calls,
      ...loggerSpy.info.mock.calls,
      ...loggerSpy.debug.mock.calls,
      ...loggerSpy.error.mock.calls,
    ];
    const allCallsStr = JSON.stringify(allCalls);
    expect(allCallsStr).not.toContain(untrackedBody);
  });

  it('mixed batch: tracked rows saved, DM and untracked dropped (combined filter)', async () => {
    const handler = createIngestHandler({ db, logger: loggerSpy as never });

    await handler({
      messages: [
        makeMsg({ jid: 'contact@s.whatsapp.net', waId: 'dm-1', body: 'DM message' }),
        makeMsg({ jid: 'untracked-group@g.us', waId: 'ug-1', body: 'Untracked group message' }),
        makeMsg({ jid: 'tracked-group@g.us', waId: 'tg-1', body: 'Tracked group message' }),
      ],
      type: 'notify',
    });

    const rows = db.prepare('SELECT * FROM whatsapp_message').all() as { body_text: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body_text).toBe('Tracked group message');
  });
});
