/**
 * WA-07 — whatsapp-retention.ts spec.
 *
 * Asserts:
 *   1. extractText() returns null for media message types (image, audio, video,
 *      document, sticker) — no row written for these.
 *   2. runNow() deletes rows with sent_at < now-30d and keeps newer rows.
 *
 * This spec RED-fails until Plan 20-05 (retention.ts) lands.
 * Run: npx vitest run tests/unit/main/whatsapp/whatsapp-retention.spec.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

// Module under test — does not exist yet; RED-fails until Plan 20-05 lands.
import { extractText, startWhatsAppRetention } from '../../../../src/main/whatsapp/retention';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/** Minimal Baileys proto message shapes for extractText tests */
const mediaMessages = [
  { imageMessage: { caption: 'photo caption' } },
  { audioMessage: {} },
  { videoMessage: { caption: 'video caption' } },
  { documentMessage: { title: 'document.pdf' } },
  { stickerMessage: {} },
];

const textMessages = [
  { conversation: 'Hello world' },
  { extendedTextMessage: { text: 'Extended text' } },
];

describe('retention.ts — extractText (WA-07)', () => {
  it('extractText is exported', () => {
    expect(typeof extractText).toBe('function');
  });

  it('extractText returns null for imageMessage', () => {
    expect(extractText({ message: { imageMessage: { caption: 'photo' } } } as never)).toBeNull();
  });

  it('extractText returns null for audioMessage', () => {
    expect(extractText({ message: { audioMessage: {} } } as never)).toBeNull();
  });

  it('extractText returns null for videoMessage', () => {
    expect(extractText({ message: { videoMessage: { caption: 'vid' } } } as never)).toBeNull();
  });

  it('extractText returns null for documentMessage', () => {
    expect(extractText({ message: { documentMessage: { title: 'doc.pdf' } } } as never)).toBeNull();
  });

  it('extractText returns null for stickerMessage', () => {
    expect(extractText({ message: { stickerMessage: {} } } as never)).toBeNull();
  });

  it('extractText returns the text for conversation messages', () => {
    const result = extractText({ message: { conversation: 'Hello world' } } as never);
    expect(result).toBe('Hello world');
  });

  it('extractText returns the text for extendedTextMessage', () => {
    const result = extractText({ message: { extendedTextMessage: { text: 'Extended' } } } as never);
    expect(result).toBe('Extended');
  });

  it('extractText returns null for messages with no message property', () => {
    expect(extractText({} as never)).toBeNull();
  });
});

describe('retention.ts — runNow() 30-day sweep (WA-07)', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-retention');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    // Seed a tracked group
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('test-group@g.us', 'Test Group', 3, 1);
  });

  it('startWhatsAppRetention is exported', () => {
    expect(typeof startWhatsAppRetention).toBe('function');
  });

  it('runNow() deletes rows older than 30 days', () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Insert one old row and one recent row
    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-group@g.us', 'sender@s.whatsapp.net', 'old-wa-id-1', thirtyOneDaysAgo, 'Old message');
    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-group@g.us', 'sender@s.whatsapp.net', 'new-wa-id-1', twoDaysAgo, 'Recent message');

    const loggerMock = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
    const { runNow } = startWhatsAppRetention({ db, logger: loggerMock as never, scheduler: null as never, dbHolder: null as never });
    runNow();

    const remaining = db.prepare('SELECT wa_id FROM whatsapp_message').all() as { wa_id: string }[];
    const ids = remaining.map((r) => r.wa_id);
    expect(ids).not.toContain('old-wa-id-1');
    expect(ids).toContain('new-wa-id-1');
  });

  it('runNow() does not delete rows newer than 30 days', () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-group@g.us', 'sender@s.whatsapp.net', 'new-wa-id-2', oneDayAgo, 'Fresh message');

    const loggerMock = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
    const { runNow } = startWhatsAppRetention({ db, logger: loggerMock as never, scheduler: null as never, dbHolder: null as never });
    runNow();

    const remaining = db.prepare('SELECT wa_id FROM whatsapp_message').all() as { wa_id: string }[];
    expect(remaining.map((r) => r.wa_id)).toContain('new-wa-id-2');
  });
});
