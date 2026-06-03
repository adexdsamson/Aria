/**
 * Phase 15 / Plan 15-06 — useKokoroPlayer TDD spec
 *
 * Tests the Kokoro-82M renderer playback hook (webgpu→wasm fallback).
 * KokoroTTS + AudioContext are injected/mocked — no real ONNX model.
 *
 * Acceptance criteria:
 *   - init() tries device:'webgpu' first, falls back to device:'wasm' on failure
 *   - speak(text) fires onPlaybackStart before audio, onPlaybackEnd after end
 *   - speak() plays via AudioBufferSourceNode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKokoroPlayer } from './useKokoroPlayer';

// ─── mock AudioContext + AudioBuffer + AudioBufferSourceNode ─────────────────

function makeFakeAudioBuffer(): AudioBuffer {
  return {
    sampleRate: 24000,
    length: 1000,
    duration: 1000 / 24000,
    numberOfChannels: 1,
    getChannelData: vi.fn(() => new Float32Array(1000)),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

class FakeAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly connected: AudioNode[] = [];

  connect(dest: AudioNode): typeof dest {
    this.connected.push(dest);
    return dest;
  }
  start(): void {
    // no-op by default; tests drive onended manually
  }
  stop(): void {}
}

class FakeAudioContext {
  readonly destination = {} as AudioDestinationNode;
  private _sourceNode: FakeAudioBufferSourceNode | null = null;

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    void channels; void length; void sampleRate;
    return makeFakeAudioBuffer();
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    this._sourceNode = new FakeAudioBufferSourceNode();
    return this._sourceNode;
  }

  /** Expose the last created source node for test assertions. */
  get lastSourceNode(): FakeAudioBufferSourceNode | null {
    return this._sourceNode;
  }
}

// ─── mock KokoroTTS factory ──────────────────────────────────────────────────

function makeKokoroFactory(
  opts: { webgpuFails?: boolean } = {}
) {
  const { webgpuFails = false } = opts;

  const mockGenerate = vi.fn(() => {
    // Returns a Float32Array that can be played
    return {
      audio: new Float32Array(24000), // 1 second at 24 kHz
      sampling_rate: 24000,
    };
  });

  const mockTts = { generate: mockGenerate };

  const fromPretrained = vi.fn(async (_model: string, options: { device: string }) => {
    if (webgpuFails && options.device === 'webgpu') {
      throw new Error('WebGPU not available');
    }
    return mockTts;
  });

  return { fromPretrained, mockGenerate, mockTts };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('createKokoroPlayer', () => {
  let fakeCtx: FakeAudioContext;

  beforeEach(() => {
    fakeCtx = new FakeAudioContext();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('init() uses webgpu device when navigator.gpu is present', async () => {
    const { fromPretrained } = makeKokoroFactory();

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: true,
    });

    await player.init();

    expect(fromPretrained).toHaveBeenCalledWith(
      expect.stringContaining('Kokoro-82M'),
      expect.objectContaining({ device: 'webgpu' })
    );
  });

  it('init() uses wasm device when navigator.gpu is absent', async () => {
    const { fromPretrained } = makeKokoroFactory();

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: false,
    });

    await player.init();

    expect(fromPretrained).toHaveBeenCalledWith(
      expect.stringContaining('Kokoro-82M'),
      expect.objectContaining({ device: 'wasm' })
    );
  });

  it('init() falls back to wasm when webgpu load throws', async () => {
    const { fromPretrained } = makeKokoroFactory({ webgpuFails: true });

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: true,
    });

    await player.init();

    // First call (webgpu) fails, second call (wasm) succeeds
    expect(fromPretrained).toHaveBeenCalledTimes(2);
    expect(fromPretrained).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Kokoro-82M'),
      expect.objectContaining({ device: 'webgpu' })
    );
    expect(fromPretrained).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('Kokoro-82M'),
      expect.objectContaining({ device: 'wasm' })
    );
  });

  it('speak() fires onPlaybackStart before audio starts', async () => {
    const { fromPretrained } = makeKokoroFactory();
    const onPlaybackStart = vi.fn();
    const onPlaybackEnd = vi.fn();

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: false,
      onPlaybackStart,
      onPlaybackEnd,
    });

    await player.init();

    // Start speaking — don't await yet; let the microtasks (generate) run first
    const speakPromise = player.speak('Hello');

    // Flush the pending generate() microtask so createBufferSource is called
    await Promise.resolve();
    await Promise.resolve();

    // Now the source node exists
    const sourceNode = fakeCtx.lastSourceNode;
    expect(sourceNode).not.toBeNull();

    // onPlaybackStart must have fired (before source.start())
    expect(onPlaybackStart).toHaveBeenCalledTimes(1);

    // Simulate audio ending by triggering the source node's onended
    sourceNode!.onended?.();

    await speakPromise;

    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });

  it('speak() fires onPlaybackEnd after audio ends', async () => {
    const { fromPretrained } = makeKokoroFactory();
    const onPlaybackStart = vi.fn();
    const onPlaybackEnd = vi.fn();

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: false,
      onPlaybackStart,
      onPlaybackEnd,
    });

    await player.init();

    const speakPromise = player.speak('test utterance');

    // Flush microtasks so generate() resolves and createBufferSource() is called
    await Promise.resolve();
    await Promise.resolve();

    const sourceNode = fakeCtx.lastSourceNode;
    sourceNode!.onended?.();

    await speakPromise;

    // onPlaybackEnd fires AFTER onPlaybackStart
    const startOrder = onPlaybackStart.mock.invocationCallOrder[0];
    const endOrder = onPlaybackEnd.mock.invocationCallOrder[0];
    expect(endOrder).toBeGreaterThan(startOrder);
  });

  it('speak() connects AudioBufferSourceNode to AudioContext destination', async () => {
    const { fromPretrained } = makeKokoroFactory();

    const player = createKokoroPlayer({
      kokoroFactory: fromPretrained,
      audioContextFactory: () => fakeCtx as unknown as AudioContext,
      hasWebGpu: false,
    });

    await player.init();

    const speakPromise = player.speak('test');

    // Flush microtasks so generate() resolves and createBufferSource() is called
    await Promise.resolve();
    await Promise.resolve();

    const sourceNode = fakeCtx.lastSourceNode;
    sourceNode!.onended?.();
    await speakPromise;

    expect(sourceNode!.connected).toContain(fakeCtx.destination);
  });
});
