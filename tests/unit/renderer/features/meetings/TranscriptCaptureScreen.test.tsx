import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptCaptureScreen } from '../../../../../src/renderer/features/meetings/TranscriptCaptureScreen';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('TranscriptCaptureScreen', () => {
  it('ingests pasted transcript and renders NoteView shell', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      transcriptIngest: vi.fn().mockResolvedValue({ noteId: 'note-1', linkedEvent: null, candidates: [] }),
      transcriptGetNote: vi.fn().mockResolvedValue({
        note: {
          id: 'note-1',
          sourceKind: 'paste',
          title: 'Board sync',
          normalizedText: 'Alice will send the deck.',
          ingestedAt: '2026-05-19T10:00:00.000Z',
          eventProviderKey: null,
          eventAccountId: null,
          calendarEventId: null,
          linkConfidence: null,
          status: 'standalone',
          segments: [{ start: 0, end: 25, speaker: 'Alice' }],
        },
      }),
    };
    const user = userEvent.setup();
    render(<TranscriptCaptureScreen />);

    await user.type(screen.getByTestId('transcript-title'), 'Board sync');
    await user.type(screen.getByTestId('transcript-text'), 'Alice will send the deck.');
    await user.click(screen.getByTestId('transcript-ingest'));

    await waitFor(() => {
      expect(screen.getByTestId('note-view-note-1')).toBeTruthy();
    });
    expect(screen.getByTestId('note-link-status').textContent).toContain('Standalone note');
  });
});
