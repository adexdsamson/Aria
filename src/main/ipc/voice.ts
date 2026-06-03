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
import { getVoiceModelStatus } from '../voice/prefs';

export interface VoiceHandlersDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** The STT sidecar manager (Plan 15-02). */
  sttSidecar: SttSidecarManager;
  /** The model download controller (Plan 15-03). */
  downloadController: ModelDownloadController;
  /** Push event sink — the bootstrap wires this to mainWindow.webContents.send. */
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}

export function registerVoiceHandlers(
  ipcMain: IpcMain,
  deps: VoiceHandlersDeps,
): void {
  const { logger, sttSidecar, downloadController } = deps;

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
}
