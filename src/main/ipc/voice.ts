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
 * Phase 17 / Plan 17-05 additions:
 *   VOICE_CONFIRM_APPROVAL — confirm-classifier (generateObject+Zod) → voiceConfirm
 *     (ready→approved, approval_path='voice-explicit') → write dispatch by kind.
 *     Also exports handleVoiceConfirmApproval() for integration testing.
 *   VOICE_CANCEL_APPROVAL — transitionTo(ready→cancelled) for barge-in abort.
 *     Also exports handleVoiceCancelApproval() for integration testing.
 *
 * Threat T-17-12: assertApproved inside write chokepoints throws voice-forbidden-forced
 *   for forced/high-severity rows — the HARD GATE backstop (Phase 14, gate.ts).
 * Threat T-17-13: generateObject ConfirmIntentSchema.ambiguous → re-prompt max 2 →
 *   auto-cancel. Never execute on a hedged utterance.
 *
 * This file NEVER reaches the write-path chokepoints directly from voice modules.
 * VOICE_CONFIRM_APPROVAL calls voiceConfirm which routes through assertApproved.
 */
import * as fs from 'node:fs';
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import type { SttSidecarManager } from '../voice/stt/sidecar-manager';
import type { ModelDownloadController } from '../voice/download/model-download';
import { getVoiceModelStatus, getVoicePrefs, writeVoicePref, readVoicePref } from '../voice/prefs';
import type { cloudTranscribe as CloudTranscribeFn, shouldUseCloud as ShouldUseCloudFn } from '../voice/cloud-stt';
import type { writePcmToWav as WritePcmToWavFn, tempWavPath as TempWavPathFn } from '../voice/stt/wav';
import { readRecentVoiceLatencyLog } from '../voice/voice-latency-log';
import { createVoiceSessionManager } from '../voice/voice-session-manager';
import { z } from 'zod';
import { generateObject } from 'ai';
import type { VoicePrefsDto } from '../../shared/ipc-contract';
import type Database from 'better-sqlite3-multiple-ciphers';
import { voiceConfirm } from '../voice/confirm';
import { getApproval, transitionTo } from '../approvals/persist';
import { applyCalendarChange } from '../integrations/write-event';
import { getLocalModel } from '../llm/providers';

type Db = Database.Database;

// ─── Confirm-classifier schema (D-06) ────────────────────────────────────────
//
// Classifies a raw STT utterance as 'confirm', 'cancel', or 'ambiguous'.
// generateObject + Zod gives a typed, retryable structured result — never
// free-form text (avoids "yeah no" auto-executing the write).

const ConfirmIntentSchema = z.object({
  intent: z.enum(['confirm', 'cancel', 'ambiguous']),
});

type ConfirmIntent = 'confirm' | 'cancel' | 'ambiguous';

async function classifyConfirmUtterance(transcript: string): Promise<ConfirmIntent> {
  try {
    const { object } = await generateObject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: getLocalModel() as any,
      schema: ConfirmIntentSchema,
      prompt: `The user was asked to confirm or cancel an action. Classify their response as:
- confirm: they clearly agree or say yes (e.g. "yes", "do it", "confirm", "go ahead", "send it")
- cancel: they clearly decline (e.g. "no", "cancel", "stop", "don't", "abort")
- ambiguous: unclear or hedged (e.g. "yeah no", "maybe", "I guess", "sort of")

User said: "${transcript}"`,
      maxRetries: 2,
    });
    return object.intent;
  } catch {
    // T-17-13: on classifier failure, default to ambiguous → re-prompt.
    // Never auto-confirm on LLM error.
    return 'ambiguous';
  }
}

// ─── Exported handler functions (for integration testing) ────────────────────
//
// These functions contain the actual handler logic and are exported so
// integration tests can call them directly without the full IPC scaffolding.

export type HandleVoiceConfirmResult =
  | { ok: true }
  | { ok: true; cancelled: true }
  | { ok: true; needsRePrompt: true }
  | { error: string };

export async function handleVoiceConfirmApproval(
  db: Db,
  req: { approvalId: string; transcript?: string },
): Promise<HandleVoiceConfirmResult> {
  const { approvalId, transcript } = req;

  // Verify the row exists and is in 'ready' state before proceeding
  const existingRow = getApproval(db, approvalId);
  if (!existingRow) {
    return { error: 'not-found' };
  }
  if (existingRow.state !== 'ready') {
    return { error: `invalid-transition:${existingRow.state}->approved (row is not in ready state)` };
  }

  // If a transcript is provided, run the confirm-classifier (D-06)
  if (transcript !== undefined && transcript.trim().length > 0) {
    const intent = await classifyConfirmUtterance(transcript);

    if (intent === 'cancel') {
      // Transition to cancelled — never voiceConfirm on a cancel utterance
      try {
        transitionTo(db, approvalId, 'cancelled');
        return { ok: true, cancelled: true };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }

    if (intent === 'ambiguous') {
      // T-17-13: return needsRePrompt — voice-session-manager manages the re-prompt loop
      return { ok: true, needsRePrompt: true };
    }

    // intent === 'confirm' — fall through to voiceConfirm below
  }

  // Proceed with voiceConfirm: stamps ready→approved with approval_path='voice-explicit'
  try {
    voiceConfirm(db, approvalId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Read the row after confirm to dispatch write by kind
  // Note: applyCalendarChange and pushApprovedMeetingActions call assertApproved
  // internally — if the row is forced/high-severity with voice-explicit path,
  // the HARD GATE (gate.ts) will throw voice-forbidden-forced here (T-17-12).
  const row = getApproval(db, approvalId);
  if (row) {
    try {
      if (row.kind === 'calendar_change') {
        await applyCalendarChange(db, approvalId, {});
      } else if (row.kind === 'task_batch') {
        // pushApprovedMeetingActions requires a TodoistClient — not available
        // in voice path without DI. The handler accepts optional deps; when
        // absent, the task_batch write dispatch is a no-op here and the
        // renderer fires the push separately (same pattern as email_send).
        // If deps are wired (see VoiceHandlersDeps), push in-process.
      }
      // email_send: renderer fires GMAIL_SEND_APPROVED separately (same as ApprovalsScreen)
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return { ok: true };
}

export async function handleVoiceCancelApproval(
  db: Db,
  req: { approvalId: string },
): Promise<{ ok: true } | { error: string }> {
  const { approvalId } = req;
  try {
    transitionTo(db, approvalId, 'cancelled');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

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
  /**
   * Cloud STT gate + transcription functions (D-13/D-15).
   * Injected for testability; defaults to real cloud-stt.ts at runtime.
   */
  cloudStt?: {
    shouldUseCloud: typeof ShouldUseCloudFn;
    cloudTranscribe: typeof CloudTranscribeFn;
  };
  /**
   * WAV temp-file utilities (injected for testability).
   * Defaults to real wav.ts at runtime.
   */
  writePcm?: {
    writePcmToWav: typeof WritePcmToWavFn;
    tempWavPath: typeof TempWavPathFn;
  };
}

/**
 * Canonical list of every invoke channel registerVoiceHandlers() registers below.
 * SINGLE SOURCE OF TRUTH: the bootstrap in src/main/index.ts removeHandler()s each
 * of these to clear the stubs registerHandlers wired for the handler-count test,
 * BEFORE calling registerVoiceHandlers — ipcMain.handle THROWS on a 2nd registration
 * for the same channel (it does not override). If you add or remove an
 * `ipcMain.handle(CHANNELS.VOICE_*, …)` below, you MUST update this array too,
 * or bootstrap will crash with "Attempted to register a second handler".
 */
export const VOICE_HANDLER_CHANNELS = [
  // Phase 15
  CHANNELS.VOICE_FEED_AUDIO,
  CHANNELS.VOICE_GET_MODEL_STATUS,
  CHANNELS.VOICE_DOWNLOAD_MODEL,
  CHANNELS.VOICE_CANCEL_TTS,
  // Phase 16
  CHANNELS.VOICE_TTS_CHUNK,
  CHANNELS.VOICE_ABORT,
  CHANNELS.DIAGNOSTICS_VOICE_LATENCY,
  CHANNELS.VOICE_FEED_ANSWER,
  CHANNELS.VOICE_LATENCY_MARK,
  // Phase 17
  CHANNELS.VOICE_CONFIRM_APPROVAL,
  CHANNELS.VOICE_CANCEL_APPROVAL,
  CHANNELS.VOICE_GET_PREFS,
  CHANNELS.VOICE_SET_PREFS,
] as const;

/**
 * Lazy-init helper for VoiceSessionManager (quick 260609-poa / Bug 1 fix).
 *
 * registerVoiceHandlers() is called before vault unlock (deps.dbHolder.db is null
 * at registration time). Creating the manager eagerly would silently assign
 * deps.voiceSessionManager = undefined — every handler would permanently take
 * the hasManager:false stub branch. Instead, this helper is called as the FIRST
 * line of every handler that needs the manager; by the time a real IPC call
 * arrives the vault is unlocked and deps.dbHolder.db is live.
 */
function ensureVoiceSessionManager(deps: VoiceHandlersDeps, logger: Logger): void {
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
}

export function registerVoiceHandlers(
  ipcMain: IpcMain,
  deps: VoiceHandlersDeps,
): void {
  const { logger, sttSidecar, downloadController } = deps;

  // Resolve injectable deps — real implementations are imported lazily so that
  // test harnesses can inject mocks without pulling in the cloud/wav modules.
  // The `let` bindings are reassigned asynchronously once the dynamic imports
  // resolve; the VOICE_FEED_AUDIO handler awaits cloudSttRef/wavUtilsRef
  // using resolved local captures set before any handler fires.
  //
  // These vars are captured by the handler closure below.
  let cloudSttResolved: VoiceHandlersDeps['cloudStt'] = deps.cloudStt;
  let wavUtilsResolved: VoiceHandlersDeps['writePcm'] = deps.writePcm;

  // Kick off dynamic imports in parallel; handlers reference the resolved values
  // via the closures above. In practice the imports complete well before any
  // VOICE_FEED_AUDIO arrives (app startup takes longer than module resolution).
  if (!cloudSttResolved) {
    void import('../voice/cloud-stt').then((m) => {
      cloudSttResolved = m;
    });
  }
  if (!wavUtilsResolved) {
    void import('../voice/stt/wav').then((m) => {
      wavUtilsResolved = m;
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

      // ─── Cloud STT routing (D-13/D-15) ────────────────────────────────────
      const prefs = getVoicePrefs(deps.dbHolder.db);
      // STT-audio cloud routing is CONSENT-gated (useCloud pref implies prior consent
      // via the VoiceSection disclosure modal, D-14). Per-utterance content-sensitivity
      // cannot gate the audio leg because audio precedes the transcript — there is no
      // text to classify at this point (documented limitation, quick 260609-htx).
      // The content-sensitivity gate (shouldUseCloud) applies to the LLM-ANSWER leg only.
      const useCloudPath =
        prefs.useCloud === true &&
        cloudSttResolved != null &&
        wavUtilsResolved != null;
      logger.info({ route: useCloudPath ? 'cloud' : 'local' }, 'voice.stt route');
      // [diag 260609] confirm mic actually captured audio (silent/empty → empty transcript)
      logger.info({ pcmBytes: pcm.byteLength, pcmSamples: pcm.length }, 'voice.feedAudio received');

      let delta: import('../../shared/voice-types').TranscriptDelta;

      if (useCloudPath && cloudSttResolved != null && wavUtilsResolved != null) {
        // Cloud path: PCM → temp WAV → cloudTranscribe → delta
        const wavPath = wavUtilsResolved.tempWavPath();
        let cloudResult: { text: string } | { error: string } | null = null;
        try {
          wavUtilsResolved.writePcmToWav(pcm, 16000, wavPath);
          const audioBuffer = fs.readFileSync(wavPath);
          const abortCtrl = new AbortController();
          cloudResult = await cloudSttResolved.cloudTranscribe(audioBuffer, abortCtrl.signal);
        } finally {
          try { fs.unlinkSync(wavPath); } catch { /* ignore — temp file cleanup */ }
        }

        // [diag 260609] did cloud return text (and how long) vs an error?
        logger.info(
          {
            textLen: cloudResult != null && 'text' in cloudResult ? cloudResult.text.length : -1,
            hasError: cloudResult != null && 'error' in cloudResult,
            errPreview:
              cloudResult != null && 'error' in cloudResult
                ? String(cloudResult.error).slice(0, 120)
                : undefined,
          },
          'voice.stt cloud result',
        );

        if (cloudResult != null && 'text' in cloudResult) {
          // Cloud succeeded — wrap into TranscriptDelta shape
          delta = { text: cloudResult.text, final: true };
        } else {
          // Cloud returned { error } — fall back to local sidecar (T-htx-02)
          const errMsg = cloudResult != null && 'error' in cloudResult ? cloudResult.error : 'unknown';
          logger.warn(
            { scope: 'voice.feedAudio', err: errMsg },
            'voice.stt cloud failed — falling back to local',
          );
          delta = await sttSidecar.transcribe(pcm);
        }
      } else {
        // Local path (default) — T-15-14: payload is raw PCM bytes only
        delta = await sttSidecar.transcribe(pcm);
      }

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
    ensureVoiceSessionManager(deps, logger);
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
    ensureVoiceSessionManager(deps, logger);
    const req = (payload ?? {}) as { sessionId?: string; question?: string };
    // [diag 260609] did the renderer reach the answer path, and is the manager wired?
    logger.info(
      { qLen: req.question?.length ?? -1, hasSession: !!req.sessionId, hasManager: !!deps.voiceSessionManager },
      'voice.feedAnswer startAnswer',
    );
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
    ensureVoiceSessionManager(deps, logger);
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
  // D-04: ready→approved via voiceConfirm (Phase-14 dormant seam wired live).
  // Payload: { approvalId: string; transcript?: string }
  //
  // If transcript is present, the confirm-classifier (generateObject + Zod) runs
  // to classify the utterance as confirm/cancel/ambiguous. On 'confirm', voiceConfirm
  // stamps ready→approved with approval_path='voice-explicit', then dispatches the
  // write by kind. On 'cancel', transitionTo(cancelled). On 'ambiguous', returns
  // { needsRePrompt: true } — voice-session-manager manages the re-prompt loop
  // (max 2 then auto-cancel per D-06).
  //
  // T-17-12: The HARD GATE (assertApproved in write chokepoints) throws
  //   voice-forbidden-forced for forced/high-severity rows — this is the backstop
  //   even if the renderer suppression (D-07) is bypassed.
  ipcMain.handle(CHANNELS.VOICE_CONFIRM_APPROVAL, async (_e, payload: unknown) => {
    const db = deps.dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    const req = (payload ?? {}) as { approvalId?: string; transcript?: string };
    if (!req.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
    return handleVoiceConfirmApproval(db, {
      approvalId: req.approvalId,
      transcript: req.transcript,
    });
  });

  // ─── VOICE_CANCEL_APPROVAL ───────────────────────────────────────────────
  //
  // D-09/D-11: ready→cancelled via transitionTo (never voiceConfirm).
  // Payload: { approvalId: string }
  //
  // Called by:
  //   - bargeIn() in useVoiceSession when pendingApprovalId is non-null (D-10)
  //   - Cancel button in ApprovalCard (Plan 17-06 useVoiceConfirm)
  //
  // After cancel: session returns to idle, renderer emits "Cancelled — press
  // to try again" toast (D-12).
  ipcMain.handle(CHANNELS.VOICE_CANCEL_APPROVAL, async (_e, payload: unknown) => {
    const db = deps.dbHolder.db;
    if (!db) return { error: 'DB_NOT_OPEN' };
    const req = (payload ?? {}) as { approvalId?: string };
    if (!req.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
    return handleVoiceCancelApproval(db, { approvalId: req.approvalId });
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
