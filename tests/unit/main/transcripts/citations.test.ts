import { describe, expect, it } from 'vitest';
import { offsetCitation, quoteForCitation, validateCitation } from '../../../../src/main/transcripts/citations';

describe('citations', () => {
  it('validates, quotes, and offsets citation spans', () => {
    const text = 'Alice will send the deck.';
    expect(validateCitation({ start: 0, end: 5 }, text)).toEqual({ start: 0, end: 5 });
    expect(quoteForCitation({ start: 0, end: 5 }, text)).toBe('Alice');
    expect(offsetCitation({ start: 1, end: 3 }, 10)).toEqual({ start: 11, end: 13 });
    expect(validateCitation({ start: 9, end: 2 }, text)).toBeNull();
  });
});
