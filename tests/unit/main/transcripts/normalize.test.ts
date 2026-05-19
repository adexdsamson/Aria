import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../../../../src/main/transcripts/normalize';

describe('normalizeTranscript', () => {
  it('normalizes raw text into one full-span segment', () => {
    const out = normalizeTranscript({ sourceKind: 'paste', text: ' Alice: Ship the deck.\n' });
    expect(out.normalizedText).toBe('Alice: Ship the deck.');
    expect(out.segments).toEqual([{ start: 0, end: 21 }]);
  });

  it('parses VTT cues with speakers and timestamps', () => {
    const out = normalizeTranscript({
      sourceKind: 'vtt',
      text: `WEBVTT

00:00:01.000 --> 00:00:03.000
Alice: I will send the deck.

00:00:05.000 --> 00:00:06.000
Bob: Thanks.`,
    });
    expect(out.normalizedText).toContain('I will send the deck.');
    expect(out.segments[0]).toMatchObject({ speaker: 'Alice', timestampSec: 1 });
    expect(out.segments[1]).toMatchObject({ speaker: 'Bob', timestampSec: 5 });
  });

  it('parses SRT cues', () => {
    const out = normalizeTranscript({
      sourceKind: 'srt',
      text: `1
00:00:01,000 --> 00:00:02,000
Alice: Follow up Friday.`,
    });
    expect(out.segments[0]).toMatchObject({ speaker: 'Alice', timestampSec: 1 });
  });

  it('parses common JSON transcript arrays', () => {
    const out = normalizeTranscript({
      sourceKind: 'json',
      text: JSON.stringify([{ speaker: 'Alice', start: 7, text: 'Send recap.' }]),
    });
    expect(out.normalizedText).toBe('Send recap.');
    expect(out.segments[0]).toMatchObject({ speaker: 'Alice', timestampSec: 7 });
  });
});
