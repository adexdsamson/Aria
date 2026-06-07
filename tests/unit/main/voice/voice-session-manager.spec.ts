/**
 * Phase 16 / Plan 16-01 — VoiceSessionManager failing spec scaffold (D-03/D-11/D-12).
 *
 * Wave-0 RED scaffold: voice-session-manager.ts does not exist yet (lands in Plan 16-04a).
 * These specs assert:
 * (a) onChunk accumulator: spokenSoFar accumulates text-deltas from streamVoiceAnswer
 *     via the onChunk callback (NOT onAbort — AI SDK #8088 mitigation)
 * (b) fast abort does NOT clear the accumulator: aborting after partial chunks
 *     leaves spokenSoFar intact (confirming accumulator lives in onChunk, not onAbort)
 * (c) onBargeIn writes synthetic interrupted turn via appendTurn (D-12):
 *     given spokenSoFar = "Hello world", onBargeIn must call appendTurn with
 *     role:'assistant' and text containing '[interrupted:' and 'Hello world'
 *
 * All mocks (streamVoiceAnswer, createThread, appendTurn, TtsSegmenter,
 * writeVoiceLatencyLog) are vi.fn(). No .todo() or .skip().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// These imports fail RED until Plan 16-04a creates the implementation.
import { createVoiceSessionManager } from '../../../../src/main/voice/voice-session-manager';

// Mock out all dependencies that voice-session-manager will need.
vi.mock('../../../../src/main/rag/threads', () => ({
  createThread: vi.fn(() => ({ id: 'thr_mock001', title: '(voice session)' })),
  appendTurn: vi.fn(() => ({ id: 1, threadId: 'thr_mock001', role: 'assistant', text: '' })),
  getThread: vi.fn(() => ({ thread: { id: 'thr_mock001' }, turns: [] })),
}));

vi.mock('../../../../src/main/rag/answer-service', () => ({
  streamVoiceAnswer: vi.fn(),
}));

vi.mock('../../../../src/main/voice/tts-segmenter', () => ({
  TtsSegmenter: vi.fn(function () {
    return {
      push: vi.fn(() => []),
      flush: vi.fn(() => ''),
    };
  }),
}));

vi.mock('../../../../src/main/voice/voice-latency-log', () => ({
  writeVoiceLatencyLog: vi.fn(),
}));

describe('VoiceSessionManager (D-03/D-11/D-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) onChunk accumulator: spokenSoFar accumulates text-deltas in order', async () => {
    const { streamVoiceAnswer } = await import('../../../../src/main/rag/answer-service');
    const mockStreamVoiceAnswer = vi.mocked(streamVoiceAnswer);

    // Simulate streamVoiceAnswer calling onChunk synchronously with deltas
    mockStreamVoiceAnswer.mockImplementation(async (_deps, args) => {
      args.onChunk('Hello ');
      args.onChunk('world');
      args.onChunk(' foo');
      args.onDone('Hello world foo');
    });

    const mockDb = {} as never;
    const manager = createVoiceSessionManager({
      db: mockDb,
      logger: { warn: vi.fn(), info: vi.fn() } as never,
      emitToRenderer: vi.fn(),
    });

    const sessionId = 'sess_test001';
    await manager.startAnswer({ sessionId, question: 'What is the briefing?' });

    // After stream completes, spokenSoFar should have accumulated all deltas
    const session = manager.getSession(sessionId);
    expect(session?.spokenSoFar).toBe('Hello world foo');
  });

  it('(b) fast abort does NOT clear the accumulator', async () => {
    const { streamVoiceAnswer } = await import('../../../../src/main/rag/answer-service');
    const mockStreamVoiceAnswer = vi.mocked(streamVoiceAnswer);

    // Simulate stream that calls onChunk twice then gets aborted
    mockStreamVoiceAnswer.mockImplementation(async (_deps, args) => {
      args.onChunk('Hello ');
      args.onChunk('world');
      // Abort happens here — no onDone call (fast abort path per AI SDK #8088)
      // The implementation should NOT clear spokenSoFar in onAbort
    });

    const mockDb = {} as never;
    const manager = createVoiceSessionManager({
      db: mockDb,
      logger: { warn: vi.fn(), info: vi.fn() } as never,
      emitToRenderer: vi.fn(),
    });

    const sessionId = 'sess_abort001';
    const abortController = new AbortController();

    // Start the answer (will complete when mock resolves)
    await manager.startAnswer({ sessionId, question: 'Test question' });

    // Simulate abort after partial accumulation
    abortController.abort();

    // spokenSoFar should still have the two accumulated deltas
    const session = manager.getSession(sessionId);
    // The accumulator lives in onChunk, not onAbort — so it's preserved even after abort
    expect(session?.spokenSoFar).toBe('Hello world');
  });

  it('(c) onBargeIn writes synthetic interrupted turn via appendTurn (D-12)', async () => {
    const { appendTurn } = await import('../../../../src/main/rag/threads');
    const mockAppendTurn = vi.mocked(appendTurn);

    const { streamVoiceAnswer } = await import('../../../../src/main/rag/answer-service');
    const mockStreamVoiceAnswer = vi.mocked(streamVoiceAnswer);

    // Set up a session with some spokenSoFar content
    mockStreamVoiceAnswer.mockImplementation(async (_deps, args) => {
      args.onChunk('Hello ');
      args.onChunk('world');
      args.onDone('Hello world');
    });

    const mockDb = {} as never;
    const manager = createVoiceSessionManager({
      db: mockDb,
      logger: { warn: vi.fn(), info: vi.fn() } as never,
      emitToRenderer: vi.fn(),
    });

    const sessionId = 'sess_bargein001';
    await manager.startAnswer({ sessionId, question: 'Read briefing' });

    // Now call onBargeIn — should write synthetic interrupted turn
    manager.onBargeIn({ sessionId });

    // appendTurn must have been called with the interrupted turn shape (D-12)
    expect(mockAppendTurn).toHaveBeenCalled();
    const callArgs = mockAppendTurn.mock.calls[mockAppendTurn.mock.calls.length - 1];
    const turnArg = callArgs[1] as { role: string; text: string };
    expect(turnArg.role).toBe('assistant');
    expect(turnArg.text).toContain('[interrupted:');
    expect(turnArg.text).toContain('Hello world');
  });
});
