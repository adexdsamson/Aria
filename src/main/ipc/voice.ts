/**
 * Phase 15 / Plan 15-05 Task 1 — Voice IPC handlers.
 *
 * Mirrors src/main/ipc/entitlement.ts EXACTLY in shape:
 *   - VoiceHandlersDeps DI struct with logger, dbHolder, sttSidecar,
 *     downloadController, and optional emitToRenderer sink
 *   - registerVoiceHandlers(ipcMain, deps) registers four invoke channels
 *   - All handlers return { ok: true, … } | { ok: false, error } envelope
 *
 * Four invoke channels (renderer → main):
 *   VOICE_FEED_AUDIO    — PCM ArrayBuffer → sidecar.transcribe → push delta + state
 *   VOICE_GET_MODEL_STATUS — returns VoiceModelStatus; db-null tolerant
 *   VOICE_DOWNLOAD_MODEL   — triggers first-run download via controller.start()
 *   VOICE_CANCEL_TTS       — acks TTS cancel (TTS playback lives in renderer)
 *
 * db-null tolerance: VOICE_GET_MODEL_STATUS calls getVoiceModelStatus(db) which
 * returns the safe default when db is null (pre-unlock vault). feedAudio throws
 * only if the sidecar throws — it does not depend on db.
 *
 * This file NEVER reaches the write-path chokepoints. Ratchet B
 * (chokepoint-caller-allow-list.spec.ts) covers all of src/main and stays green.
 *
 * Threat T-15-14: PCM payload is forwarded as raw bytes to the sidecar only —
 * never eval'd, never used as a path or shell arg (sidecar args are app-controlled).
 * Threat T-15-16: No chokepoint imports (sendApprovedEmail / applyCalendarChange /
 * pushApprovedMeetingActions) anywhere in this file.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SttSidecarManager } from '../voice/stt/sidecar-manager';
import type { ModelDownloadController } from '../voice/download/model-download';
import { getVoiceModelStatus, getVoicePrefs, writeVoicePref, readVoicePref } from '../voice/prefs';
import { readRecentVoiceLatencyLog } from '../voice/voice-latency-log';
import { createVoiceSessionManager } from '../voice/voice-session-manager';
import { z } from 'zod';
import type { VoicePrefsDto } from '../../shared/ipc-contract';

/**
 * Zod schema for VOICE_SET_PREFS payload (T-17-10: strict() rejects unknown keys;
 * bounds prevent tampered speed values).
 */
const VoicePrefsPatchSchema = z
  .object({
    speed: z.number().min(0.5).max(2).optional(),
    voiceId: z.string().max(100).optional(),
    useCloud: z.boolean().optional(),
  })
  .strict();

export interface VoiceHandlersDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** The STT sidecar manager (Plan 15-02). */
  sttSidecar: SttSidecarManager;
  /** The model download controller (Plan 15-03). */
  downloadController: ModelDownloadController;
  /** Push event sink — the bootstrap wires this to mainWindow.webContents.send. */
  emitToRenderer?: (channel: string, payload?: unknown) => void;
  // Phase 16 / Plan 16-01 additions (real implementations land in 16-04a):
  /** Map of sessionId → AbortController for active streaming turns (D-02/D-03). */
  sessionAbortControllers?: Map<string, AbortController>;
  /** Voice session manager for streaming cascade and barge-in (D-03/D-11/D-12). */
  voiceSessionManager?: {
    startAnswer(args: { sessionId: string; question: string }): Promise<void>;
    onBargeIn(args: { sessionId: string }): void;
    /** WARNING 2 fix: store renderer timing marks into VoiceSession for latency log. */
    markLatency(args: {
      sessionId: string;
      mark: 'kokoro_synth_start' | 'first_audio_out';
      t: number;
    }): void;
  };
}

export function registerVoiceHandlers(
  ipcMain: IpcMain,
  deps: VoiceHandlersDeps,
): void {
  const { logger, sttSidecar, downloadController } = deps;

  // Phase 16 / Plan 16-04a: Wire the real VoiceSessionManager if not already provided.
  // Creates the manager from available deps (db, emitToRenderer, sessionAbortControllers)
  // so VOICE_ABORT, VOICE_FEED_ANSWER, and VOICE_LATENCY_MARK resolve to real implementations.
  if (!deps.voiceSessionManager && deps.dbHolder.db && deps.emitToRenderer) {
    const abortControllers: Map<string, AbortController> =
      deps.sessionAbortControllers ?? new Map();
    // Re-assign the shared map so VOICE_ABORT can find the controllers too.
    if (!deps.sessionAbortControllers) {
      deps.sessionAbortControllers = abortControllers;
    }
    deps.voiceSessionManager = createVoiceSessionManager({
      db: deps.dbHolder.db,
      logger,
      emitToRenderer: deps.emitToRenderer,
      sessionAbortControllers: abortControllers,
    });
  }

  // ─── VOICE_FEED_AUDIO ────────────────────────────────────────────────────
  //
  // Renderer sends a PCM ArrayBuffer (Int16Array.buffer). We reconstruct the
  // Int16Array, forward to sttSidecar.transcribe, then push the transcript
  // delta and voice-state transitions back to the renderer.
  //
  // State machine for a single feed-audio round-trip:
  //   (renderer arrives) → emit listening → emit processing
  //   → sidecar.transcribe →
  //   → emit VOICE_TRANSCRIPT_DELTA → emit idle
  ipcMain.handle(CHANNELS.VOICE_FEED_AUDIO, async (_e, payload: unknown) => {
    try {
      // Reconstruct Int16Array from the ArrayBuffer transferred over IPC.
      // Renderer sends pcm.buffer (ArrayBuffer); ipcMain delivers it as a
      // Buffer or ArrayBuffer depending on the Electron version.
      let pcm: Int16Array;
      if (payload instanceof Int16Array) {
        pcm = payload;
      } else if (payload instanceof ArrayBuffer) {
        pcm = new Int16Array(payload);
      } else if (Buffer.isBuffer(payload)) {
        pcm = new Int16Array(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength / 2,
        );
      } else {
        // Fallback: wrap whatever we got into an empty array (best-effort)
        pcm = new Int16Array(0);
      }

      // Emit listening → processing transitions
      deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'listening' });
      deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'processing' });

      // Forward to sidecar — T-15-14: payload is raw PCM bytes only
      const delta = await sttSidecar.transcribe(pcm);

      // Push transcript back to renderer
      deps.emitToRenderer?.(CHANNELS.VOICE_TRANSCRIPT_DELTA, delta);

      // Return to idle
      deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'idle' });

      return { ok: true, delta };
    } catch (err) {
      logger.warn(
        { scope: 'voice.feedAudio', err: (err as Error).message },
        'feedAudio handler threw',
      );
      deps.emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { state: 'error' });
      return { ok: false, error: (err as Error).message };
    }
  });

  // ─── VOICE_GET_MODEL_STATUS ──────────────────────────────────────────────
  //
  // Returns the current VoiceModelStatus. db-null tolerant — getVoiceModelStatus
  // returns the safe default { ready: false, path: null, state: 0 } when
  // db is null (vault sealed / pre-unlock). Safe to call at any time.
  ipcMain.handle(CHANNELS.VOICE_GET_MODEL_STATUS, async () => {
    try {
      const status = getVoiceModelStatus(deps.dbHolder.db);
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ─── VOICE_DOWNLOAD_MODEL ────────────────────────────────────────────────
  //
  // Triggers the first-run model download. Progress is pushed asynchronously
  // via emitToRenderer(VOICE_MODEL_PROGRESS, …) from inside the download
  // controller (Plan 15-03). Returns immediately after starting.
  ipcMain.handle(CHANNELS.VOICE_DOWNLOAD_MODEL, async () => {
    try {
      await downloadController.start();
      return { ok: true };
    } catch (err) {
      logger.warn(
        { scope: 'voice.downloadModel', err: (err as Error).message },
        'downloadModel handler threw',
      );
      return { ok: false, error: (err as Error).message };
    }
  });

  // ─── VOICE_CANCEL_TTS ────────────────────────────────────────────────────
  //
  // TTS playback lives entirely in the renderer (kokoro-js / useKokoroPlayer).
  // This handler acks the cancel intent so the renderer can gate the half-duplex
  // mic signal. Currently a pure ack; Phase 17 may add write-side state.
  ipcMain.handle(CHANNELS.VOICE_CANCEL_TTS, async () => {
    return { ok: true };
  });

  // ─── Phase 16 / Plan 16-01 stub handlers ─────────────────────────────────
  //
  // Five new channels added in Wave 0. All five must be registered here so the
  // handler-count invariant (Object.keys(CHANNELS).length === handlers.size) stays
  // green. Real implementations land in 16-04a (VOICE_ABORT/VOICE_FEED_ANSWER/
  // VOICE_LATENCY_MARK full wiring) and 16-02 (DIAGNOSTICS_VOICE_LATENCY reader).
  //
  // db-null safety: none of these five channels are added to the db-null skip-set.
  // abort/latency channels are read-only or no-op (safe pre-unlock);
  // voiceFeedAnswer stubs out to { ok: true } when voiceSessionManager is absent.

  // ─── VOICE_TTS_CHUNK ─────────────────────────────────────────────────────
  //
  // D-05: push channel — main pushes text chunks TO renderer via webContents.send.
  // ipcMain.handle is a no-op stub to satisfy the handler-count invariant;
  // the real push direction is emitToRenderer(VOICE_TTS_CHUNK, ...) in the
  // voice-session-manager streaming loop (Plan 16-04a).
  ipcMain.handle(CHANNELS.VOICE_TTS_CHUNK, async () => {
    return { ok: true };
  });

  // ─── VOICE_ABORT ─────────────────────────────────────────────────────────
  //
  // D-02: renderer fires this one-way after AudioBufferSourceNode.stop().
  // Main aborts the streamText AbortController for the session (~40ms, races
  // independently of renderer audio cancel ~5ms). NOT awaited by renderer.
  // Also calls voiceSessionManager.onBargeIn for D-12 synthetic turn write.
  ipcMain.handle(CHANNELS.VOICE_ABORT, async (_e, payload: unknown) => {
    const req = (payload ?? {}) as { sessionId?: string };
    if (req.sessionId) {
      deps.sessionAbortControllers?.get(req.sessionId)?.abort();
      if (req.sessionId && deps.voiceSessionManager) {
        deps.voiceSessionManager.onBargeIn({ sessionId: req.sessionId });
      }
    }
    return { ok: true as const };
  });

  // ─── DIAGNOSTICS_VOICE_LATENCY ───────────────────────────────────────────
  //
  // D-06: read voice_latency_log rows. Debug-only; ARIA_DEBUG=1 required for
  // any rows to exist. Mirrors DIAGNOSTICS_ROUTING_LOG handler shape exactly.
  ipcMain.handle(CHANNELS.DIAGNOSTICS_VOICE_LATENCY, async (_e, payload: unknown) => {
    const req = (payload ?? {}) as { limit?: number };
    const limit = typeof req.limit === 'number' && req.limit > 0 ? req.limit : 100;
    const db = deps.dbHolder.db;
    if (!db) {
      return [];
    }
    try {
      return readRecentVoiceLatencyLog(db, limit);
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // ─── VOICE_FEED_ANSWER ───────────────────────────────────────────────────
  //
  // D-05: renderer sends the STT transcript to trigger the main-process streaming
  // cascade (hybridRetrieve → streamText → D-04 segmenter → TTS chunk push).
  // Stub returns { ok: true } until 16-04a wires the real VoiceSessionManager.
  ipcMain.handle(CHANNELS.VOICE_FEED_ANSWER, async (_e, payload: unknown) => {
    const req = (payload ?? {}) as { sessionId?: string; question?: string };
    if (req.sessionId && req.question && deps.voiceSessionManager) {
      await deps.voiceSessionManager.startAnswer({
        sessionId: req.sessionId,
        question: req.question,
      });
    }
    return { ok: true as const };
  });

  // ─── VOICE_LATENCY_MARK ──────────────────────────────────────────────────
  //
  // D-06 / SC2 / WARNING 2 fix: renderer fires this fire-and-forget channel
  // to report t_kokoro_synth_start and t_first_audio_out timing marks into
  // the in-memory VoiceSession. Upgraded from no-op stub (16-01) to real
  // wiring: delegates to voiceSessionManager.markLatency so all four t_*
  // columns are populated when writeVoiceLatencyLog fires on stream completion.
  ipcMain.handle(CHANNELS.VOICE_LATENCY_MARK, async (_e, payload: unknown) => {
    const req = (payload ?? {}) as {
      sessionId?: string;
      mark?: 'kokoro_synth_start' | 'first_audio_out';
      t?: number;
    };
    if (req.sessionId && req.mark && typeof req.t === 'number') {
      deps.voiceSessionManager?.markLatency({
        sessionId: req.sessionId,
        mark: req.mark,
        t: req.t,
      });
    }
    return undefined;
  });

  // ─── Phase 17 / Plan 17-01 stubs ─────────────────────────────────────────
  //
  // Four new channels added in Wave 0. All four must be registered here so the
  // handler-count invariant (Object.keys(CHANNELS).length === handlers.size) stays
  // green. Real implementations land in Plans 17-04 (VOICE_GET/SET_PREFS) and
  // 17-05 (VOICE_CONFIRM/CANCEL_APPROVAL).

  // ─── VOICE_CONFIRM_APPROVAL ──────────────────────────────────────────────
  //
  // D-04: ready→approved via voiceConfirm (Phase-14 dormant seam).
  // Stub returns { error: 'NOT_IMPLEMENTED' } until Plan 17-05 wires the real
  // voiceConfirm dispatch.
  ipcMain.handle(CHANNELS.VOICE_CONFIRM_APPROVAL, async () => {
    return { error: 'NOT_IMPLEMENTED' };
  });

  // ─── VOICE_CANCEL_APPROVAL ───────────────────────────────────────────────
  //
  // D-09/D-11: ready→cancelled via transitionTo.
  // Stub returns { error: 'NOT_IMPLEMENTED' } until Plan 17-05 wires the real
  // transitionTo(db, id, 'cancelled') call.
  ipcMain.handle(CHANNELS.VOICE_CANCEL_APPROVAL, async () => {
    return { error: 'NOT_IMPLEMENTED' };
  });

  // ─── VOICE_GET_PREFS ─────────────────────────────────────────────────────
  //
  // D-16: read voice prefs (speed / voiceId / useCloud).
  // Returns VOICE_PREF_DEFAULTS when db is null (pre-unlock); db-null tolerant.
  // Mirrors BG_GET_PREFS handler pattern from src/main/ipc/background.ts.
  ipcMain.handle(CHANNELS.VOICE_GET_PREFS, (): VoicePrefsDto => {
    return getVoicePrefs(deps.dbHolder.db);
  });

  // ─── VOICE_SET_PREFS ─────────────────────────────────────────────────────
  //
  // D-16: write voice prefs (speed / voiceId / useCloud).
  // Validates payload via VoicePrefsPatchSchema.strict() before writing (T-17-10).
  // Returns updated VoicePrefsDto on success, { error } on failure.
  //
  // D-14 consent audit: when useCloud is first set to true AND
  // voice.cloudAudio.consented is not already '1', record consent in settings KV:
  //   voice.cloudAudio.consented = '1'
  //   voice.cloudAudio.consentedAt = ISO timestamp
  // NOTE: D-14 consent recorded in settings KV only — action_audit_log is a VIEW
  // (not a table) defined in migration 129, so direct INSERT would fail at runtime.
  ipcMain.handle(CHANNELS.VOICE_SET_PREFS, async (_event, payload: unknown) => {
    const db = deps.dbHolder.db;
    if (!db) {
      return { error: 'db-locked' };
    }
    const parsed = VoicePrefsPatchSchema.safeParse(payload);
    if (!parsed.success) {
      return { error: 'invalid-payload' };
    }
    try {
      const patch = parsed.data;
      if (patch.speed !== undefined) {
        writeVoicePref(db, 'speed', String(patch.speed));
      }
      if (patch.voiceId !== undefined) {
        writeVoicePref(db, 'voiceId', patch.voiceId);
      }
      if (patch.useCloud !== undefined) {
        writeVoicePref(db, 'useCloud', patch.useCloud ? '1' : '0');
        // D-14: record cloud audio consent on first opt-in.
        // action_audit_log is a VIEW (not a table) — INSERT would fail at runtime.
        // Consent audit uses settings KV only: voice.cloudAudio.consented + consentedAt.
        if (patch.useCloud && readVoicePref(db, 'cloudAudio.consented') !== '1') {
          writeVoicePref(db, 'cloudAudio.consented', '1');
          writeVoicePref(db, 'cloudAudio.consentedAt', new Date().toISOString());
        }
      }
      return getVoicePrefs(db);
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
}
