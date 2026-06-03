/**
 * Phase 15 / Plan 15-06 — Renderer Kokoro-82M TTS playback hook.
 *
 * Implements D-18 (CONTEXT.md): stand up the REAL kokoro-js (Kokoro-82M)
 * playback path in the renderer. The trigger is a minimal utterance (a fixed
 * confirmation or echo of the transcript) — NOT briefing/answer content.
 *
 * Device strategy (RESEARCH §Pattern 3):
 *   1. If navigator.gpu is present → try device:'webgpu' (fp32)
 *   2. If webgpu load throws → fall back to device:'wasm' (q8)
 *   3. If hasWebGpu is false (probe result) → skip directly to wasm
 *
 * Signals for the half-duplex gate:
 *   - onPlaybackStart fires BEFORE source.start() (sets micGated=true in caller)
 *   - onPlaybackEnd fires AFTER the buffer ends (triggers ~800ms cooldown in caller)
 *
 * KokoroTTS + AudioContext are injectable for unit testing — pass them via the
 * options object. In production, omit them and the real APIs are used.
 *
 * Exports:
 *   createKokoroPlayer(options)  — factory (testable, no React)
 *   useKokoroPlayer(options)     — React hook wrapper
 */

import { useRef, useCallback } from 'react';

// ─── public types ─────────────────────────────────────────────────────────────

/** Shape of a kokoro-js TTS instance (subset we use). */
export interface KokoroTtsInstance {
  generate(
    text: string,
    options?: { voice?: string }
  ): Promise<{ audio: Float32Array; sampling_rate: number }> | { audio: Float32Array; sampling_rate: number };
}

/** Injectable factory matching KokoroTTS.from_pretrained signature. */
export type KokoroFactory = (
  model: string,
  options: { device: 'webgpu' | 'wasm'; dtype?: string }
) => Promise<KokoroTtsInstance>;

export interface KokoroPlayerOptions {
  /**
   * Injected factory for unit tests. In production, omit and the
   * real `KokoroTTS.from_pretrained` is used (lazy import).
   */
  kokoroFactory?: KokoroFactory;

  /**
   * Injected AudioContext constructor for unit tests.
   * In production, omit and `new AudioContext()` is used.
   */
  audioContextFactory?: () => AudioContext;

  /**
   * Whether navigator.gpu is available (webgpu device probe).
   * Omit to read `typeof navigator.gpu !== 'undefined'` at init time.
   */
  hasWebGpu?: boolean;

  /**
   * Called immediately before source.start() — the half-duplex gate
   * uses this to set micGated=true and transition to 'speaking'.
   */
  onPlaybackStart?: () => void;

  /**
   * Called after the AudioBufferSourceNode fires 'ended' — the gate
   * uses this to schedule the ~800ms cooldown then release micGated.
   */
  onPlaybackEnd?: () => void;

  /** Default voice to use. Kokoro ships 'af_heart' as the first-party voice. */
  defaultVoice?: string;
}

export interface KokoroPlayerHandle {
  /**
   * Load the Kokoro-82M ONNX model.
   * First call triggers the ~160 MB lazy HF download.
   * Subsequent calls are no-ops (model cached in a ref).
   */
  init(): Promise<void>;

  /**
   * Synthesize and play `text` through an AudioBufferSourceNode.
   * Fires onPlaybackStart before play, onPlaybackEnd after the buffer ends.
   * Resolves when playback is complete (or if speak is called without init).
   */
  speak(text: string): Promise<void>;

  /** True once init() has completed successfully. */
  readonly ready: boolean;
}

// ─── model ID ─────────────────────────────────────────────────────────────────

/**
 * The pinned Kokoro-82M ONNX model from Hugging Face.
 * T-15-19: fetched from onnx-community/Kokoro-82M over HTTPS by transformers.js.
 */
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// ─── factory ─────────────────────────────────────────────────────────────────

/**
 * createKokoroPlayer — pure factory, no React hooks, fully unit-testable.
 */
export function createKokoroPlayer(options: KokoroPlayerOptions = {}): KokoroPlayerHandle {
  const {
    kokoroFactory,
    audioContextFactory,
    hasWebGpu,
    onPlaybackStart,
    onPlaybackEnd,
    defaultVoice = 'af_heart',
  } = options;

  let ttsInstance: KokoroTtsInstance | null = null;
  let audioCtx: AudioContext | null = null;
  let _ready = false;

  async function loadTts(): Promise<KokoroTtsInstance> {
    // Resolve the factory: injected (test) or the real kokoro-js (production)
    let factory: KokoroFactory;
    if (kokoroFactory) {
      factory = kokoroFactory;
    } else {
      // Lazy import of kokoro-js — ~160 MB ONNX download on first call
      const { KokoroTTS } = await import('kokoro-js');
      factory = KokoroTTS.from_pretrained as KokoroFactory;
    }

    // Probe GPU availability
    const gpuAvailable = hasWebGpu !== undefined
      ? hasWebGpu
      : typeof navigator !== 'undefined' && typeof (navigator as { gpu?: unknown }).gpu !== 'undefined';

    if (gpuAvailable) {
      // Try webgpu first (fp32 quality, hardware acceleration)
      try {
        return await factory(KOKORO_MODEL_ID, { device: 'webgpu', dtype: 'fp32' });
      } catch {
        // WebGPU failed (unsupported GPU, driver issue, etc.) — fall through to wasm
      }
    }

    // wasm fallback (q8 quant, ~same quality, cross-platform)
    return factory(KOKORO_MODEL_ID, { device: 'wasm', dtype: 'q8' });
  }

  function getAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = audioContextFactory
        ? audioContextFactory()
        : new AudioContext();
    }
    return audioCtx;
  }

  return {
    get ready() {
      return _ready;
    },

    async init(): Promise<void> {
      if (ttsInstance) return; // already initialized
      ttsInstance = await loadTts();
      _ready = true;
    },

    async speak(text: string): Promise<void> {
      if (!ttsInstance) {
        // Not initialized — silently skip rather than crash
        return;
      }

      const ctx = getAudioContext();

      // Generate audio — kokoro-js returns { audio: Float32Array, sampling_rate: number }
      const result = await Promise.resolve(ttsInstance.generate(text, { voice: defaultVoice }));
      const { audio, sampling_rate } = result;

      // Create an AudioBuffer from the Float32Array
      // Cast to Float32Array<ArrayBuffer> — kokoro-js returns a plain Float32Array;
      // the ArrayBufferLike generic is structural so this cast is safe at runtime.
      const buffer = ctx.createBuffer(1, audio.length, sampling_rate);
      buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);

      // Signal the half-duplex gate before we start playing (D-13)
      onPlaybackStart?.();

      // Play through an AudioBufferSourceNode
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      // Resolve the returned promise when the buffer ends, firing onPlaybackEnd
      await new Promise<void>((resolve) => {
        source.onended = () => {
          onPlaybackEnd?.();
          resolve();
        };
        source.start();
      });
    },
  };
}

// ─── React hook wrapper ───────────────────────────────────────────────────────

/**
 * useKokoroPlayer — React hook wrapping createKokoroPlayer.
 *
 * Keeps the TTS instance in a stable ref across re-renders.
 * Options (callbacks) are also stabilized via a ref so they can change
 * without recreating the player.
 */
export function useKokoroPlayer(options: KokoroPlayerOptions = {}): KokoroPlayerHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const playerRef = useRef<KokoroPlayerHandle | null>(null);

  if (!playerRef.current) {
    playerRef.current = createKokoroPlayer({
      kokoroFactory: options.kokoroFactory,
      audioContextFactory: options.audioContextFactory,
      hasWebGpu: options.hasWebGpu,
      defaultVoice: options.defaultVoice,
      // Stable callback wrappers that always call the current option value
      onPlaybackStart: () => optionsRef.current.onPlaybackStart?.(),
      onPlaybackEnd: () => optionsRef.current.onPlaybackEnd?.(),
    });
  }

  const init = useCallback(() => playerRef.current!.init(), []);
  const speak = useCallback((text: string) => playerRef.current!.speak(text), []);

  return {
    get ready() { return playerRef.current!.ready; },
    init,
    speak,
  };
}
