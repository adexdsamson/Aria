/**
 * Phase 15 / Plan 15-04 — Inline-Blob-URL AudioWorklet processor.
 *
 * DEPENDS ON: Plan 15-01 CSP fix (script-src blob: in both prodCspHeader and
 * devCspHeader in src/main/index.ts). Without that fix, audioWorklet.addModule
 * will fail silently in the packaged build. The csp-allows-blob.spec.ts ratchet
 * guards this invariant.
 *
 * D-19 (RESEARCH §Pattern 2): the worklet source is embedded as a template
 * literal and registered via an inline Blob URL — NOT a file:// URL — to
 * survive Electron's file-protocol restrictions.
 *
 * Resample strategy (D-19/D-20): the AudioContext is created at sampleRate 16000
 * by the calling hook (useMicCapture.ts Task 2). The worklet therefore receives
 * pre-downsampled 16 kHz input from the context and simply forwards the first
 * mono channel as a transferable ArrayBuffer. No in-worklet resampler is needed.
 */

/**
 * The AudioWorklet processor source, embedded as a template literal.
 *
 * Targets mono 16 kHz PCM (channel 0 of the first input). Each audio-process
 * quantum (~10 ms at 16 kHz) that contains live data is forwarded to the port
 * as a transferable ArrayBuffer — zero-copy across the worklet→main-thread
 * MessageChannel boundary.
 */
export const WORKLET_SOURCE = `
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length > 0) {
      // Transferable: the renderer main thread receives the underlying buffer
      // without a copy (required for PCM streaming to voiceFeedAudio IPC).
      const buf = ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.byteLength);
      this.port.postMessage({ pcm: buf }, [buf]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

/**
 * Create and register the inline-Blob-URL AudioWorklet processor.
 *
 * Steps:
 *  1. Wrap WORKLET_SOURCE in a Blob (application/javascript).
 *  2. Create a blob: URL via URL.createObjectURL.
 *  3. Call audioCtx.audioWorklet.addModule(blobUrl) — requires the Plan 15-01
 *     CSP script-src blob: allowance.
 *  4. Revoke the blob: URL immediately after addModule resolves (no leak).
 *  5. Construct and return an AudioWorkletNode('mic-processor') connected to ctx.
 *
 * @param audioCtx - AudioContext created at sampleRate 16000 (useMicCapture).
 * @returns Configured AudioWorkletNode ready for source → node → destination wiring.
 */
export async function setupWorklet(audioCtx: AudioContext): Promise<AudioWorkletNode> {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await audioCtx.audioWorklet.addModule(blobUrl);
  } finally {
    // Always revoke — even on addModule failure — to avoid blob: URL leaks.
    URL.revokeObjectURL(blobUrl);
  }

  return new AudioWorkletNode(audioCtx, 'mic-processor');
}
