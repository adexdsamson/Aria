/**
 * Phase 17 / Plan 17-04 — TDD tests for cloud-stt.ts (RED phase).
 *
 * Tests:
 *   shouldUseCloud() — fail-safe local behaviour (D-15):
 *     - returns false when useCloudPref is false (never calls classify)
 *     - returns false when classify confidence < 0.6
 *     - returns false when any category is non-'none' (even with high confidence)
 *     - returns true when confidence >= 0.6 AND all categories === 'none'
 *
 *   cloudTranscribe() — never-throws wrapper around experimental_transcribe (D-13):
 *     - returns { text } on success
 *     - returns { error } when transcribe throws (never re-throws)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the module under test.
// ---------------------------------------------------------------------------

const mockClassify = vi.fn();
vi.mock('../../../../src/main/llm/sensitivityClassifier', () => ({
  classify: mockClassify,
}));

const mockTranscribe = vi.fn();
vi.mock('ai', () => ({
  experimental_transcribe: mockTranscribe,
}));

const mockTranscription = vi.fn((_model: string) => ({ modelId: _model }));
const mockCreateOpenAI = vi.fn(() => ({ transcription: mockTranscription }));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

// Lazy import after mocks are set up
async function getModule() {
  const mod = await import('../../../../src/main/voice/cloud-stt');
  return mod;
}

// Minimal PQueueLike stub
function makeQueue() {
  return {
    add: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  };
}

// ---------------------------------------------------------------------------
// shouldUseCloud()
// ---------------------------------------------------------------------------

describe('shouldUseCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false immediately when useCloudPref is false (no classify call)', async () => {
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('some context', makeQueue(), false);
    expect(result).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('returns false when classify confidence is below 0.6 (e.g. 0.3)', async () => {
    mockClassify.mockResolvedValue({
      categories: ['none'],
      severity: 'low',
      confidence: 0.3,
      rationale: 'low confidence',
    });
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('context text', makeQueue(), true);
    expect(result).toBe(false);
  });

  it('returns false when categories include a sensitive label (pii), even with high confidence', async () => {
    mockClassify.mockResolvedValue({
      categories: ['pii'],
      severity: 'med',
      confidence: 0.9,
      rationale: 'has PII',
    });
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('my SSN is 123-45-6789', makeQueue(), true);
    expect(result).toBe(false);
  });

  it('returns false when categories include financial (non-none) with confidence >= 0.6', async () => {
    mockClassify.mockResolvedValue({
      categories: ['financial'],
      severity: 'med',
      confidence: 0.85,
      rationale: 'financial discussion',
    });
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('revenue discussion', makeQueue(), true);
    expect(result).toBe(false);
  });

  it('returns true when useCloudPref=true AND confidence >= 0.6 AND all categories are none', async () => {
    mockClassify.mockResolvedValue({
      categories: ['none'],
      severity: 'low',
      confidence: 0.85,
      rationale: 'no sensitivity detected',
    });
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('what is my next meeting?', makeQueue(), true);
    expect(result).toBe(true);
  });

  it('returns false when confidence is exactly at the boundary (0.6 passes)', async () => {
    mockClassify.mockResolvedValue({
      categories: ['none'],
      severity: 'low',
      confidence: 0.6,
      rationale: 'exactly at threshold',
    });
    const { shouldUseCloud } = await getModule();
    const result = await shouldUseCloud('meeting query', makeQueue(), true);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cloudTranscribe()
// ---------------------------------------------------------------------------

describe('cloudTranscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { error: "no OpenAI frontier key configured" } when key getter resolves null', async () => {
    const { cloudTranscribe } = await getModule();
    const result = await cloudTranscribe(
      Buffer.from([1, 2, 3]),
      new AbortController().signal,
      () => Promise.resolve(null),
    );
    expect(result).toEqual({ error: 'no OpenAI frontier key configured' });
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('returns { text } on successful transcription', async () => {
    mockTranscribe.mockResolvedValue({ text: 'hello world' });
    const { cloudTranscribe } = await getModule();
    const result = await cloudTranscribe(
      Buffer.from([1, 2, 3]),
      new AbortController().signal,
      () => Promise.resolve('sk-test'),
    );
    expect(result).toEqual({ text: 'hello world' });
  });

  it('returns { error } when experimental_transcribe throws (never re-throws)', async () => {
    mockTranscribe.mockRejectedValue(new Error('OpenAI API error'));
    const { cloudTranscribe } = await getModule();
    const result = await cloudTranscribe(
      Buffer.from([1, 2, 3]),
      new AbortController().signal,
      () => Promise.resolve('sk-test'),
    );
    expect(result).toEqual({ error: 'OpenAI API error' });
  });

  it('never throws even when transcribe rejects with a non-Error', async () => {
    mockTranscribe.mockRejectedValue('network timeout');
    const { cloudTranscribe } = await getModule();
    // Should not throw
    await expect(
      cloudTranscribe(
        Buffer.from([]),
        new AbortController().signal,
        () => Promise.resolve('sk-test'),
      ),
    ).resolves.toHaveProperty('error');
  });
});
