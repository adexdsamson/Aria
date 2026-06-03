/**
 * Phase 15 — Voice I/O + Model Runtime shared DTOs.
 *
 * These plain interfaces and unions form the cross-boundary contract between
 * the renderer (AudioWorklet, PTT UI, HUD) and the main process (sidecar
 * manager, KV prefs, TTS gate). Renderer code NEVER imports from src/main;
 * this shared file is the seam.
 *
 * D-17: VoiceState includes 'speaking' so Phase 16's streaming spoken output
 * drops in without a redesign.
 */

/**
 * The mic/voice-pipeline state machine.
 *
 * Transitions (simplified):
 *   idle ─── PTT start ──→ listening
 *   listening ─── VAD end / keyup ──→ processing
 *   processing ─── transcript ready ──→ idle
 *   speaking (D-17 Phase 16 seam) ─── TTS end ──→ idle
 *   * ─── error ──→ error
 *   speaking / processing ─── D-13 gate ──→ muted-during-playback
 */
export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'               // D-17 — Phase 16 seam; present now so Phase 16 drops in
  | 'muted-during-playback'  // D-13 half-duplex gate active
  | 'error';

/**
 * Incremental transcript segment emitted by the STT sidecar.
 *
 * `final: true` marks the last segment for a turn; renderer should flush
 * any speculative display and persist the confirmed text.
 * `startMs` / `endMs` are optional wall-clock-relative ms offsets into the
 * captured audio buffer (whisper.cpp provides these in --output-json).
 */
export interface TranscriptDelta {
  text: string;
  final: boolean;
  startMs?: number;
  endMs?: number;
}

/**
 * Voice model readiness state persisted via settings(k,v) KV (D-08).
 *
 * `state` is a numeric enum:
 *   0 — absent (not yet downloaded)
 *   1 — ready (downloaded and verified)
 *   2 — downloading (in-progress)
 *
 * `path` is null when state ≠ 1 (no usable model on disk).
 */
export interface VoiceModelStatus {
  ready: boolean;
  path: string | null;
  state: 0 | 1 | 2;
}
