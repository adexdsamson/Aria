/**
 * Phase 17 / Plan 17-04 — Cloud STT wrapper + per-turn sensitivity gate.
 *
 * D-13: cloudTranscribe() wraps experimental_transcribe from ai@6 using
 *   openai.transcription('whisper-1'). Non-streaming (whisper-1 has no native
 *   streaming; 25 MB limit — a 30s 16kHz WAV utterance is ~960 KB, well within).
 *   Returns { text } on success, { error } on failure — NEVER throws.
 *
 * D-15: shouldUseCloud() is the per-turn fail-safe local gate. Order of checks:
 *   1. useCloudPref=false  → return false immediately (no classify call)
 *   2. classify() confidence < 0.6 → return false (classifier uncertain)
 *   3. any category !== 'none' → return false (sensitivity detected)
 *   4. All conditions pass → return true (safe for cloud)
 *
 *   classify() never throws (Stage-3 regex fallback) so this function is also
 *   structurally fail-safe. Sensitivity-flagged turns stay on-device REGARDLESS
 *   of cloud opt-in (D-15 hard requirement).
 *
 * No new npm dependencies — @ai-sdk/openai and ai are already installed.
 */
import { experimental_transcribe as transcribe } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { classify } from '../llm/sensitivityClassifier';
import { getFrontierKey } from '../secrets/safeStorage';

/**
 * Minimal subset of p-queue's interface required by shouldUseCloud.
 * Exported so tests can supply a simple stub without importing p-queue.
 */
export type PQueueLike = {
  add: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Transcribe an audio buffer using OpenAI Whisper STT (cloud path — D-13).
 *
 * Call this ONLY when shouldUseCloud() returned true for the current turn.
 *
 * @param audioBuffer - WAV/PCM audio bytes (Buffer from the local STT sidecar pipeline).
 * @param signal      - AbortSignal to cancel in-flight requests on barge-in.
 * @param getKey      - Optional injectable key getter (defaults to safeStorage OpenAI key).
 *                      Inject a stub in unit tests to bypass Electron safeStorage.
 * @returns { text } on success, { error } on API failure — never throws.
 */
export async function cloudTranscribe(
  audioBuffer: Buffer,
  signal: AbortSignal,
  getKey: () => Promise<string | null> = () => getFrontierKey({ provider: 'openai' }),
): Promise<{ text: string } | { error: string }> {
  const key = await getKey();
  if (!key) {
    return { error: 'no OpenAI frontier key configured' };
  }
  try {
    const client = createOpenAI({ apiKey: key });
    const result = await transcribe({
      model: client.transcription('whisper-1'),
      audio: audioBuffer,
      abortSignal: signal,
    });
    return { text: result.text };
  } catch (e) {
    return { error: (e as Error).message ?? String(e) };
  }
}

/**
 * Per-turn sensitivity gate for cloud audio routing (D-15).
 *
 * Returns false (use LOCAL) when:
 *   - useCloudPref is false (user has not enabled cloud audio)
 *   - classify() returns confidence < 0.6 (classifier uncertain)
 *   - any category in classify() result is not 'none' (sensitive content detected)
 *
 * Returns true ONLY when: useCloudPref=true AND confidence>=0.6 AND
 * all categories are 'none'.
 *
 * classify() never throws (Stage-3 regex fallback in sensitivityClassifier.ts),
 * so this function is structurally fail-safe — any unexpected error propagates
 * from classify() would also surface here, but classify guarantees it won't.
 *
 * @param context      - Text context for the current turn (last-N thread text).
 * @param queue        - p-queue instance (or compatible stub) for LLM call serialisation.
 * @param useCloudPref - Value of voice.useCloud KV setting (D-16 runtime gate).
 */
export async function shouldUseCloud(
  context: string,
  queue: PQueueLike,
  useCloudPref: boolean,
): Promise<boolean> {
  // Fast exit — never call classify if the user hasn't opted in.
  if (!useCloudPref) {
    return false;
  }

  const result = await classify(context, queue as Parameters<typeof classify>[1]);

  // Fail-safe: if classifier is uncertain, force local.
  if (result.confidence < 0.6) {
    return false;
  }

  // Any non-'none' category means sensitive content → force local.
  if (result.categories.some((c) => c !== 'none')) {
    return false;
  }

  return true;
}
