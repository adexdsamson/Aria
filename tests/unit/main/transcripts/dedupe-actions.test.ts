import { describe, expect, it } from 'vitest';
import { dedupeActions } from '../../../../src/main/transcripts/dedupe-actions';
import type { MeetingActionArtifact } from '../../../../src/main/transcripts/extract';

function action(over: Partial<MeetingActionArtifact>): MeetingActionArtifact {
  return {
    text: 'Send the deck',
    owner: 'self',
    citation: { start: 0, end: 13 },
    confidence: 0.9,
    ...over,
  };
}

describe('dedupeActions', () => {
  it('dedupes by normalized text or overlapping citation', () => {
    const out = dedupeActions([
      action({ text: 'Send the deck', citation: { start: 0, end: 13 } }),
      action({ text: 'send the deck!', citation: { start: 100, end: 113 } }),
      action({ text: 'Book the room', citation: { start: 3, end: 12 } }),
    ]);
    expect(out.map((a) => a.text)).toEqual(['Send the deck']);
  });
});
