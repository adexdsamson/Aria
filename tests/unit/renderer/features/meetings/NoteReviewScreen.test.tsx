import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoteReviewScreen } from '../../../../../src/renderer/features/meetings/NoteReviewScreen';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('NoteReviewScreen', () => {
  it('renders five sections and highlights citation clicks', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      transcriptGetReview: vi.fn().mockResolvedValue({
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
          segments: [],
        },
        summaryItems: [
          { id: 'topic-1', kind: 'topic', text: 'Deck', citationStart: 0, citationEnd: 5, ordinal: 0 },
          { id: 'decision-1', kind: 'decision', text: 'Ship', citationStart: 6, citationEnd: 15, ordinal: 0 },
          { id: 'follow-1', kind: 'follow_up', text: 'Follow', citationStart: 0, citationEnd: 5, ordinal: 0 },
          { id: 'q-1', kind: 'open_question', text: 'Question', citationStart: 0, citationEnd: 5, ordinal: 0 },
        ],
        actions: [
          {
            id: 'act-1',
            noteId: 'note-1',
            approvalId: null,
            text: 'Send the deck',
            owner: 'self',
            citationStart: 0,
            citationEnd: 5,
            confidence: 0.9,
            status: 'draft',
            pushable: 1,
          },
        ],
      }),
    };
    const user = userEvent.setup();
    render(<NoteReviewScreen noteId="note-1" />);
    await waitFor(() => expect(screen.getByTestId('review-section-topic')).toBeTruthy());
    expect(screen.getByTestId('review-section-actions')).toBeTruthy();
    await user.click(screen.getByTestId('citation-topic-1'));
    expect(screen.getByTestId('citation-highlight').textContent).toBe('Alice');
  });
});
