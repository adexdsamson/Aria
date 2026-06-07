/**
 * Phase 16 / Plan 16-01 — useReadAloudQueue failing spec scaffold (D-05/D-07).
 *
 * Wave-0 RED scaffold: useReadAloudQueue.ts does not exist yet (lands in Plan 16-03).
 * These specs assert the D-05 queue ordering + cancel contract:
 * (a) enqueue() resolves speak() calls in order (in-order promise-chain queue)
 * (b) cancel() calls player.cancel() and resets the queue
 * (c) enqueue after cancel works normally
 *
 * Uses mocked KokoroPlayerHandle with vi.fn() speak (resolves immediately) and cancel.
 * No .todo() or .skip().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// This import fails RED until Plan 16-03 creates the implementation.
import { useReadAloudQueue } from '../../../../src/renderer/features/voice/useReadAloudQueue';
import type { KokoroPlayerHandle } from '../../../../src/renderer/features/voice/tts/useKokoroPlayer';

function makeMockPlayer(): KokoroPlayerHandle & { cancelMock: ReturnType<typeof vi.fn> } {
  const cancelMock = vi.fn();
  const speakMock = vi.fn((_text: string, _opts?: { speed?: number }) => Promise.resolve());

  return {
    get ready() { return true; },
    init: vi.fn(() => Promise.resolve()),
    speak: speakMock,
    cancel: cancelMock,
  } as unknown as KokoroPlayerHandle & { cancelMock: ReturnType<typeof vi.fn> };
}

describe('useReadAloudQueue (D-05/D-07)', () => {
  let player: ReturnType<typeof makeMockPlayer>;

  beforeEach(() => {
    player = makeMockPlayer();
    vi.clearAllMocks();
  });

  it('(a) enqueue() resolves speak() calls in order', async () => {
    const calls: string[] = [];

    // Mock speak to record call order
    (player.speak as ReturnType<typeof vi.fn>).mockImplementation(
      async (text: string) => {
        calls.push(text);
      }
    );

    const { result } = renderHook(() =>
      useReadAloudQueue(player as unknown as KokoroPlayerHandle, 1.0)
    );

    act(() => {
      result.current.enqueue('first chunk');
      result.current.enqueue('second chunk');
      result.current.enqueue('third chunk');
    });

    // Wait for all enqueued promises to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(calls).toEqual(['first chunk', 'second chunk', 'third chunk']);
    expect(player.speak).toHaveBeenCalledTimes(3);
  });

  it('(b) cancel() calls player.cancel() and resets the queue', async () => {
    const { result } = renderHook(() =>
      useReadAloudQueue(player as unknown as KokoroPlayerHandle, 1.0)
    );

    act(() => {
      result.current.enqueue('chunk one');
      result.current.cancel();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(player.cancel).toHaveBeenCalledTimes(1);

    // After cancel, queue should be reset (no pending speaks from before cancel)
    // New enqueue after cancel should work independently
    const callsAfterCancel: string[] = [];
    (player.speak as ReturnType<typeof vi.fn>).mockImplementation(
      async (text: string) => {
        callsAfterCancel.push(text);
      }
    );

    act(() => {
      result.current.enqueue('post-cancel chunk');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(callsAfterCancel).toEqual(['post-cancel chunk']);
  });

  it('(c) enqueue after cancel works normally', async () => {
    const calls: string[] = [];
    (player.speak as ReturnType<typeof vi.fn>).mockImplementation(
      async (text: string) => {
        calls.push(text);
      }
    );

    const { result } = renderHook(() =>
      useReadAloudQueue(player as unknown as KokoroPlayerHandle, 1.0)
    );

    // Cancel first
    act(() => {
      result.current.cancel();
    });

    // Then enqueue new items
    act(() => {
      result.current.enqueue('after-cancel-1');
      result.current.enqueue('after-cancel-2');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Both items should be spoken in order
    expect(calls).toEqual(['after-cancel-1', 'after-cancel-2']);
  });

  it('passes speed option to player.speak()', async () => {
    const { result } = renderHook(() =>
      useReadAloudQueue(player as unknown as KokoroPlayerHandle, 1.5)
    );

    act(() => {
      result.current.enqueue('speed test');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(player.speak).toHaveBeenCalledWith('speed test', { speed: 1.5 });
  });
});
