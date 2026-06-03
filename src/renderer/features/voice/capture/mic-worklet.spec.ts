/**
 * Phase 15 / Plan 15-04 Task 1 — AudioWorklet Blob-URL registration (TDD RED).
 *
 * These tests MUST fail before mic-worklet.ts is implemented.
 *
 * Spec contract:
 *  - setupWorklet(ctx) creates a Blob with type 'application/javascript'
 *  - calls URL.createObjectURL with the Blob → returns a blob: URL
 *  - calls audioCtx.audioWorklet.addModule with the blob: URL
 *  - calls URL.revokeObjectURL after addModule resolves
 *  - returns an AudioWorkletNode
 *
 * The worklet source string must contain 'registerProcessor' and emit PCM as
 * transferable ArrayBuffers targeting 16 kHz mono (RESEARCH §Pattern 2, D-19).
 *
 * No real Web Audio runtime needed — all AudioContext surface is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── module under test ─────────────────────────────────────────────────────
import { setupWorklet, WORKLET_SOURCE } from './mic-worklet';

// ─── global Web API mocks ──────────────────────────────────────────────────
const FAKE_BLOB_URL = 'blob:http://localhost/test-worklet-abc123';

let blobConstructorArgs: [string[], BlobPropertyBag | undefined] | null = null;
let revokedUrls: string[] = [];

const mockAddModule = vi.fn().mockResolvedValue(undefined);

// AudioWorkletNode must be mocked as a class (vitest requires mockImplementation for `new`)
class MockAudioWorkletNode {
  ctx: unknown;
  processorName: string;
  port = { onmessage: null as unknown };
  constructor(ctx: unknown, processorName: string) {
    this.ctx = ctx;
    this.processorName = processorName;
  }
  connect = vi.fn();
}

beforeEach(() => {
  blobConstructorArgs = null;
  revokedUrls = [];
  mockAddModule.mockClear();

  // Blob mock: capture constructor args for assertion
  vi.stubGlobal('Blob', class MockBlob {
    type: string;
    constructor(parts: string[], opts?: BlobPropertyBag) {
      blobConstructorArgs = [parts, opts];
      this.type = opts?.type ?? '';
    }
  });

  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue(FAKE_BLOB_URL),
    revokeObjectURL: vi.fn((url: string) => { revokedUrls.push(url); }),
  });

  // AudioWorkletNode constructor mock — must be a class, not a plain fn with mockReturnValue
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('mic-worklet WORKLET_SOURCE', () => {
  it('contains registerProcessor call', () => {
    expect(WORKLET_SOURCE).toContain('registerProcessor');
  });

  it('contains MicProcessor class definition', () => {
    expect(WORKLET_SOURCE).toContain('MicProcessor');
  });

  it('contains port.postMessage for transferable PCM', () => {
    expect(WORKLET_SOURCE).toContain('port.postMessage');
  });

  it('targets mono channel (inputs[0][0] pattern)', () => {
    // The worklet must reference the first channel of the first input
    expect(WORKLET_SOURCE).toMatch(/inputs\[0\]/);
  });
});

describe('setupWorklet', () => {
  function makeMockCtx() {
    return {
      sampleRate: 16000,
      audioWorklet: {
        addModule: mockAddModule,
      },
    } as unknown as AudioContext;
  }

  it('creates a Blob with type application/javascript', async () => {
    const ctx = makeMockCtx();
    await setupWorklet(ctx);
    expect(blobConstructorArgs).not.toBeNull();
    expect(blobConstructorArgs![1]?.type).toBe('application/javascript');
  });

  it('calls URL.createObjectURL with the Blob', async () => {
    const ctx = makeMockCtx();
    await setupWorklet(ctx);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const arg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The arg should be the Blob instance (has a type property)
    expect(arg).toHaveProperty('type', 'application/javascript');
  });

  it('calls audioWorklet.addModule with the blob: URL', async () => {
    const ctx = makeMockCtx();
    await setupWorklet(ctx);
    expect(mockAddModule).toHaveBeenCalledOnce();
    expect(mockAddModule).toHaveBeenCalledWith(FAKE_BLOB_URL);
  });

  it('revokes the blob: URL after addModule resolves', async () => {
    const ctx = makeMockCtx();
    await setupWorklet(ctx);
    expect(revokedUrls).toContain(FAKE_BLOB_URL);
  });

  it('returns an AudioWorkletNode constructed with correct args', async () => {
    const ctx = makeMockCtx();
    const node = await setupWorklet(ctx);
    expect(node).toBeTruthy();
    // Verify the node is a MockAudioWorkletNode instance with the correct processorName
    expect((node as unknown as MockAudioWorkletNode).processorName).toBe('mic-processor');
  });
});
