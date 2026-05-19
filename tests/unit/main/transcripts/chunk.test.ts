import { describe, expect, it } from 'vitest';
import { chunkTranscriptForExtraction } from '../../../../src/main/transcripts/chunk';

describe('chunkTranscriptForExtraction', () => {
  it('chunks long transcripts with offset preservation and overlap', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i}.`).join(' ');
    const chunks = chunkTranscriptForExtraction(text, { maxChars: 220, overlapChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
    expect(chunks[1]!.startOffset).toBeLessThan(chunks[0]!.endOffset);
  });
});
