-- Migration 136: voice_latency_log table for D-06 per-stage latency telemetry.
--
-- Records per-turn timing offsets (ms from session start) for the four stages
-- defined in VOICE-03 SC2: STT complete, LLM first token, first TTS chunk
-- dispatched, Kokoro synth start, and first audio output. Debug-only: rows
-- are only written when ARIA_DEBUG=1 (via writeVoiceLatencyLog in
-- src/main/voice/voice-latency-log.ts). Zero overhead in production.
--
-- The t_kokoro_synth_start and t_first_audio_out columns are populated by the
-- renderer via the VOICE_LATENCY_MARK IPC channel (fire-and-forget).
--
-- Mirrors routing_log DDL shape (migration 001).

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
