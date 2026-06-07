/**
 * Phase 16 / Plan 16-02 Task 2 — D-06 Voice latency log writer + reader.
 *
 * Mirrors src/main/llm/routingLog.ts structure exactly:
 *   - Module-level INSERT_SQL and SELECT_RECENT_SQL constants
 *   - writeVoiceLatencyLog gated behind ARIA_DEBUG=1 (zero overhead in production)
 *   - readRecentVoiceLatencyLog with safeLimit clamping [1, 1000]
 *
 * Table DDL lives in migration 136 (136_voice_latency_log.sql).
 * Zero dependency on Electron or ai — pure better-sqlite3 utility.
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface VoiceLatencyInput {
  session_id: string;
  /** ms from session start: STT complete timestamp. Required. */
  t_stt_done: number;
  /** ms: first streamText token received. */
  t_llm_first_token?: number | null;
  /** ms: first TTS chunk dispatched to renderer. */
  t_first_sentence_ready?: number | null;
  /** ms: Kokoro generate() called. */
  t_kokoro_synth_start?: number | null;
  /** ms: AudioBufferSourceNode.start() called. */
  t_first_audio_out?: number | null;
}

export interface VoiceLatencyRow {
  id: number;
  session_id: string;
  t_stt_done: number;
  t_llm_first_token: number | null;
  t_first_sentence_ready: number | null;
  t_kokoro_synth_start: number | null;
  t_first_audio_out: number | null;
  recorded_at: string;
}

const INSERT_SQL = `
  INSERT INTO voice_latency_log
    (session_id, t_stt_done, t_llm_first_token, t_first_sentence_ready,
     t_kokoro_synth_start, t_first_audio_out)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const SELECT_RECENT_SQL = `
  SELECT id, session_id, t_stt_done, t_llm_first_token, t_first_sentence_ready,
         t_kokoro_synth_start, t_first_audio_out, recorded_at
  FROM voice_latency_log
  ORDER BY id DESC
  LIMIT ?
`;

/**
 * Write a voice latency record. No-op when ARIA_DEBUG !== '1' — zero overhead
 * in production builds. When ARIA_DEBUG=1, inserts one row into voice_latency_log.
 */
export function writeVoiceLatencyLog(db: Db, e: VoiceLatencyInput): void {
  if (process.env['ARIA_DEBUG'] !== '1') return;
  db.prepare(INSERT_SQL).run(
    e.session_id,
    e.t_stt_done,
    e.t_llm_first_token ?? null,
    e.t_first_sentence_ready ?? null,
    e.t_kokoro_synth_start ?? null,
    e.t_first_audio_out ?? null,
  );
}

/**
 * Read the most-recent voice latency rows, ordered by id DESC.
 * Limit is clamped to [1, 1000] to prevent runaway queries.
 */
export function readRecentVoiceLatencyLog(db: Db, limit = 100): VoiceLatencyRow[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  return db.prepare(SELECT_RECENT_SQL).all(safeLimit) as VoiceLatencyRow[];
}
