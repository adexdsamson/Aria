/**
 * Phase 16 / Plan 16-01 — voice-latency-log failing spec scaffold (D-06).
 *
 * Wave-0 RED scaffold: voice-latency-log.ts does not exist yet (lands in Plan 16-02).
 * These specs assert the D-06 write function contract:
 * - writeVoiceLatencyLog is a no-op when ARIA_DEBUG !== '1' (zero overhead in prod)
 * - when ARIA_DEBUG='1', inserts a row into voice_latency_log
 * - readRecentVoiceLatencyLog returns rows ordered by id desc
 *
 * Uses an in-memory better-sqlite3-multiple-ciphers database with migration 136 DDL inline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
// These imports fail RED until Plan 16-02 creates the implementation.
import {
  writeVoiceLatencyLog,
  readRecentVoiceLatencyLog,
} from '../../../../src/main/voice/voice-latency-log';

const MIGRATION_136_SQL = `
CREATE TABLE IF NOT EXISTS voice_latency_log (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id              TEXT    NOT NULL,
  t_stt_done              INTEGER NOT NULL,
  t_llm_first_token       INTEGER,
  t_first_sentence_ready  INTEGER,
  t_kokoro_synth_start    INTEGER,
  t_first_audio_out       INTEGER,
  recorded_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_latency_session
  ON voice_latency_log(session_id);
`;

function makeDb() {
  const db = new Database(':memory:');
  db.exec(MIGRATION_136_SQL);
  return db;
}

describe('voice-latency-log (D-06)', () => {
  let db: ReturnType<typeof makeDb>;
  const originalEnv = process.env['ARIA_DEBUG'];

  beforeEach(() => {
    db = makeDb();
    delete process.env['ARIA_DEBUG'];
  });

  afterEach(() => {
    db.close();
    if (originalEnv === undefined) {
      delete process.env['ARIA_DEBUG'];
    } else {
      process.env['ARIA_DEBUG'] = originalEnv;
    }
  });

  it('writeVoiceLatencyLog is a no-op when ARIA_DEBUG is not set', () => {
    writeVoiceLatencyLog(db, {
      session_id: 'test-session-1',
      t_stt_done: 100,
      t_llm_first_token: 200,
    });

    const rows = db.prepare('SELECT * FROM voice_latency_log').all();
    expect(rows).toHaveLength(0);
  });

  it('writeVoiceLatencyLog inserts a row when ARIA_DEBUG=1', () => {
    process.env['ARIA_DEBUG'] = '1';

    writeVoiceLatencyLog(db, {
      session_id: 'test-session-2',
      t_stt_done: 150,
      t_llm_first_token: 350,
      t_first_sentence_ready: 520,
      t_kokoro_synth_start: null,
      t_first_audio_out: null,
    });

    const rows = db.prepare('SELECT * FROM voice_latency_log').all() as Array<{
      session_id: string;
      t_stt_done: number;
      t_llm_first_token: number | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('test-session-2');
    expect(rows[0].t_stt_done).toBe(150);
    expect(rows[0].t_llm_first_token).toBe(350);
  });

  it('readRecentVoiceLatencyLog returns rows ordered by id desc (most recent first)', () => {
    process.env['ARIA_DEBUG'] = '1';

    writeVoiceLatencyLog(db, { session_id: 'sess-A', t_stt_done: 100 });
    writeVoiceLatencyLog(db, { session_id: 'sess-B', t_stt_done: 200 });
    writeVoiceLatencyLog(db, { session_id: 'sess-C', t_stt_done: 300 });

    const rows = readRecentVoiceLatencyLog(db, 10) as Array<{ session_id: string }>;
    expect(rows).toHaveLength(3);
    // Most recent (sess-C, highest id) should be first
    expect(rows[0].session_id).toBe('sess-C');
    expect(rows[2].session_id).toBe('sess-A');
  });

  it('readRecentVoiceLatencyLog respects the limit parameter', () => {
    process.env['ARIA_DEBUG'] = '1';

    writeVoiceLatencyLog(db, { session_id: 'sess-1', t_stt_done: 100 });
    writeVoiceLatencyLog(db, { session_id: 'sess-2', t_stt_done: 200 });
    writeVoiceLatencyLog(db, { session_id: 'sess-3', t_stt_done: 300 });

    const rows = readRecentVoiceLatencyLog(db, 2);
    expect(rows).toHaveLength(2);
  });
});
