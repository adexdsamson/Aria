import { describe, expect, it, vi } from 'vitest';
import { extractMeetingArtifacts } from '../../../../src/main/transcripts/extract';

describe('extractMeetingArtifacts', () => {
  it('uses generateObject schema output and preserves absolute citations', async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({
      object: {
        actions: [
          {
            text: 'Send the deck',
            owner: 'self',
            dueHint: { raw: 'tomorrow', confidence: 'high' },
            priorityHint: 'p2',
            citation: { start: 0, end: 22 },
            confidence: 0.9,
          },
        ],
        summary: {
          topicsCovered: [{ text: 'Deck', citation: { start: 0, end: 22 } }],
          decisions: [],
          followUps: [],
          openQuestions: [],
        },
      },
    });
    const result = await extractMeetingArtifacts({
      normalizedText: 'Alice will send the deck.',
      meetingDateIso: '2026-05-19T10:00:00.000Z',
      generateObjectFn: generateObjectFn as never,
    });
    expect(result.actions[0]).toMatchObject({
      text: 'Send the deck',
      dueHint: { iso: '2026-05-20' },
    });
    expect(result.summary.topicsCovered[0]!.citation).toEqual({ start: 0, end: 22 });
  });
});
