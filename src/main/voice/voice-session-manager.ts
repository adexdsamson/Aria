/**
 * Phase 16 / Plan 16-04a — VoiceSessionManager.
 *
 * Orchestrates the main-process streaming cascade for each voice turn:
 *   1. Creates a RAG thread on first voice turn (D-11 thread persistence).
 *   2. Creates a TtsSegmenter + AbortController per turn.
 *   3. Calls streamVoiceAnswer whose onChunk feeds TtsSegmenter → VOICE_TTS_CHUNK push.
 *   4. spokenSoFar accumulates in onChunk (NOT onAbort — AI SDK #8088 mitigation, D-03).
 *   5. onDone fires writeVoiceLatencyLog with all four t_* columns (D-06).
 *   6. onBargeIn writes a synthetic [interrupted: "..."] assistant turn via appendTurn
 *      BEFORE the next user turn (D-12).
 *   7. markLatency stores t_kokoro_synth_start / t_first_audio_out from renderer timing
 *      marks so DIAGNOSTICS_VOICE_LATENCY returns fully populated rows (WARNING 2 fix).
 *
 * Phase 17 / Plan 17-05 additions:
 *   8. Per-session repromptCount: tracks how many 'ambiguous' confirm utterances were
 *      returned. When repromptCount < 2, the caller gets { needsRePrompt: true } and
 *      re-arms the confirm STT turn with a condensed re-prompt TTS. At repromptCount >= 2,
 *      auto-cancels the pending approval via transitionTo(cancelled) and resets to idle
 *      with a toast (D-06/T-17-13).
 *
 * Zero write-chokepoint imports (D-13: no assertApproved / voiceConfirm /
 * sendApprovedEmail / applyCalendarChange / pushApprovedMeetingActions).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import { createThread, appendTurn } from '../rag/threads';
import { streamVoiceAnswer } from '../rag/answer-service';
import type { EmbedClient } from '../rag/hybrid-retrieval';
import type { VectorStore } from '../rag/vector-store';
import { TtsSegmenter } from './tts-segmenter';
import { writeVoiceLatencyLog } from './voice-latency-log';
import { CHANNELS } from '../../shared/ipc-contract';

type Db = Database.Database;

/**
 * Per-session state record stored in the in-memory sessions Map.
 * Persists until the next startAnswer call for the same sessionId (or app close).
 */
export interface VoiceSession {
  threadId: string;
  spokenSoFar: string;
  startMs: number;
  t_stt_done: number;
  t_llm_first_token: number | null;
  t_first_sentence_ready: number | null;
  t_kokoro_synth_start: number | null;
  t_first_audio_out: number | null;
  /**
   * Phase 17 / D-06: tracks how many 'ambiguous' confirm utterances have been
   * returned for the current awaiting-confirm sub-state. Reset when the pending
   * approval is confirmed or cancelled. Used by the re-prompt loop.
   */
  confirmRepromptCount: number;
}

export interface VoiceSessionManagerDeps {
  db: Db;
  logger?: Logger;
  embedClient?: EmbedClient;
  vectorStore?: VectorStore;
  emitToRenderer: (channel: string, payload?: unknown) => void;
  /** Map of sessionId → AbortController for active streaming turns (D-02/D-03). */
  sessionAbortControllers?: Map<string, AbortController>;
}

export interface VoiceSessionManager {
  startAnswer(args: { sessionId: string; question: string }): Promise<void>;
  onBargeIn(args: { sessionId: string }): void;
  markLatency(args: {
    sessionId: string;
    mark: 'kokoro_synth_start' | 'first_audio_out';
    t: number;
  }): void;
  /**
   * Phase 17 / D-06: Record an 'ambiguous' confirm utterance for the session.
   * Returns the updated repromptCount so the caller (VOICE_CONFIRM_APPROVAL
   * handler) can decide whether to re-prompt or auto-cancel.
   * Reset to 0 when the pending approval is confirmed or cancelled.
   */
  recordConfirmAmbiguous(sessionId: string): number;
  /**
   * Phase 17 / D-06: Reset the confirm re-prompt counter for the session
   * (called after a terminal confirm/cancel transition).
   */
  resetConfirmReprompt(sessionId: string): void;
  /** Exposed for testing — returns the current VoiceSession for a sessionId. */
  getSession(sessionId: string): VoiceSession | undefined;
}

/**
 * Factory function for VoiceSessionManager (DI pattern — mirrors createAnswerService).
 */
export function createVoiceSessionManager(
  deps: VoiceSessionManagerDeps,
): VoiceSessionManager {
  const { db, logger, emitToRenderer } = deps;

  /** In-memory Map keyed by sessionId. Sessions persist across turns for context. */
  const sessions = new Map<string, VoiceSession>();

  /** Shared AbortController map — can be the same map as deps.sessionAbortControllers. */
  const abortControllers: Map<string, AbortController> =
    deps.sessionAbortControllers ?? new Map();

  async function startAnswer(args: { sessionId: string; question: string }): Promise<void> {
    const { sessionId, question } = args;

    // D-11: look up or create session + RAG thread on first voice turn.
    let session = sessions.get(sessionId);
    if (!session) {
      const thread = createThread(db, { title: '(voice session)' });
      session = {
        threadId: thread.id,
        spokenSoFar: '',
        startMs: Date.now(),
        t_stt_done: 0,
        t_llm_first_token: null,
        t_first_sentence_ready: null,
        t_kokoro_synth_start: null,
        t_first_audio_out: null,
        confirmRepromptCount: 0,
      };
      sessions.set(sessionId, session);
    }

    // Record t_stt_done as time since session start (STT complete, question received).
    session.t_stt_done = Date.now() - session.startMs;

    // Reset per-turn timing fields when starting a new answer.
    session.t_llm_first_token = null;
    session.t_first_sentence_ready = null;
    session.spokenSoFar = '';

    // Create a new AbortController for this turn (D-02/D-03).
    const controller = new AbortController();
    abortControllers.set(sessionId, controller);

    // D-04: new TtsSegmenter instance per turn.
    const segmenter = new TtsSegmenter();

    // D-03: spokenSoFar accumulator lives here in onChunk (NOT in onAbort — AI SDK #8088).
    // The session.spokenSoFar ref is kept current so onBargeIn can access it at any time.

    const streamDeps = {
      db,
      embedClient: deps.embedClient as EmbedClient,
      vectorStore: deps.vectorStore as VectorStore,
      logger: deps.logger,
    };

    await streamVoiceAnswer(streamDeps, {
      question,
      threadId: session.threadId,
      signal: controller.signal,
      onChunk: (delta: string) => {
        // D-03: accumulate spokenSoFar synchronously per chunk.
        session!.spokenSoFar += delta;

        // D-04: feed segmenter; D-05: push each flushed chunk to renderer.
        const chunks = segmenter.push(delta);
        for (const chunk of chunks) {
          // Record first token timestamp.
          if (session!.t_llm_first_token === null) {
            session!.t_llm_first_token = Date.now() - session!.startMs;
          }
          // Record first sentence/chunk ready timestamp.
          if (session!.t_first_sentence_ready === null) {
            session!.t_first_sentence_ready = Date.now() - session!.startMs;
          }
          // D-05: push to renderer.
          emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, { text: chunk, sessionId });
        }
      },
      onDone: (fullText: string) => {
        // Flush any remaining text in the segmenter buffer.
        const remaining = segmenter.flush();
        if (remaining) {
          emitToRenderer(CHANNELS.VOICE_TTS_CHUNK, { text: remaining, sessionId });
        }
        // Keep session.spokenSoFar accurate (onDone receives full accumulated text).
        session!.spokenSoFar = fullText;

        // D-06: write latency log with all four t_* columns populated.
        writeVoiceLatencyLog(db, {
          session_id: sessionId,
          t_stt_done: session!.t_stt_done,
          t_llm_first_token: session!.t_llm_first_token,
          t_first_sentence_ready: session!.t_first_sentence_ready,
          t_kokoro_synth_start: session!.t_kokoro_synth_start,
          t_first_audio_out: session!.t_first_audio_out,
        });

        // Clean up the AbortController for this completed turn.
        abortControllers.delete(sessionId);
        // NOTE: session stays in Map for context across next voice turn (D-11).
      },
    }).catch((err: unknown) => {
      logger?.warn({ scope: 'voice.sessionManager', err: (err as Error).message }, 'streamVoiceAnswer.failed');
    });
  }

  function onBargeIn(args: { sessionId: string }): void {
    const { sessionId } = args;
    const session = sessions.get(sessionId);
    if (!session) return;

    // D-12: write synthetic interrupted assistant turn BEFORE next user turn.
    // This tells the LLM what Aria actually said (prevents hallucinating completed answer).
    appendTurn(db, {
      threadId: session.threadId,
      role: 'assistant',
      text: `[interrupted: "${session.spokenSoFar}…"]`,
      routing: { route: 'LOCAL', reason: 'voice-barge-in', sensitivity: 'none' },
    });
  }

  function markLatency(args: {
    sessionId: string;
    mark: 'kokoro_synth_start' | 'first_audio_out';
    t: number;
  }): void {
    const { sessionId, mark, t } = args;
    const session = sessions.get(sessionId);
    if (!session) return;

    // WARNING 2 fix: store renderer timing marks so all four t_* columns are populatable
    // when writeVoiceLatencyLog fires on stream completion.
    if (mark === 'kokoro_synth_start' && session.t_kokoro_synth_start === null) {
      session.t_kokoro_synth_start = t;
    } else if (mark === 'first_audio_out' && session.t_first_audio_out === null) {
      session.t_first_audio_out = t;
    }
  }

  function getSession(sessionId: string): VoiceSession | undefined {
    return sessions.get(sessionId);
  }

  /**
   * Phase 17 / D-06: Record an 'ambiguous' confirm utterance.
   * Increments the per-session counter and returns the new count.
   * The caller (VOICE_CONFIRM_APPROVAL) uses this to decide: re-prompt or auto-cancel.
   */
  function recordConfirmAmbiguous(sessionId: string): number {
    const session = sessions.get(sessionId);
    if (!session) {
      // Session not found — treat as max to trigger auto-cancel safely
      return 2;
    }
    session.confirmRepromptCount += 1;
    return session.confirmRepromptCount;
  }

  /**
   * Phase 17 / D-06: Reset the confirm re-prompt counter (called after terminal transition).
   */
  function resetConfirmReprompt(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      session.confirmRepromptCount = 0;
    }
  }

  return { startAnswer, onBargeIn, markLatency, getSession, recordConfirmAmbiguous, resetConfirmReprompt };
}
