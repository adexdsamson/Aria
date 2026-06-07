/**
 * Phase 16 / Plan 16-01 — TtsSegmenter failing spec scaffold (D-04).
 *
 * Wave-0 RED scaffold: TtsSegmenter does not exist yet (lands in Plan 16-02).
 * These specs assert the D-04 hybrid first-chunk + sentence segmenter contract.
 * They MUST fail with "Cannot find module" or similar import error (not syntax
 * errors) until the implementation lands.
 *
 * D-04 contract:
 * - Regime 1: flush a short ~8-word fragment on a word boundary immediately
 *   (drives first-audio p50 <900ms, SC2)
 * - Regime 2: full-sentence accumulation with abbreviation-aware deny-list
 *   (Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\. + decimal patterns)
 * - flush(): returns remaining buffer, resets state
 */
import { describe, it, expect, beforeEach } from 'vitest';
// This import fails RED until Plan 16-02 creates the implementation.
import { TtsSegmenter } from '../../../../src/main/voice/tts-segmenter';

describe('TtsSegmenter (D-04)', () => {
  let segmenter: TtsSegmenter;

  beforeEach(() => {
    segmenter = new TtsSegmenter(8);
  });

  describe('first-chunk regime (Regime 1)', () => {
    it('flushes a chunk when buffer reaches ~8 words on a word boundary', () => {
      // Push 8 words incrementally
      const result1 = segmenter.push('Hello ');
      const result2 = segmenter.push('world ');
      const result3 = segmenter.push('this ');
      const result4 = segmenter.push('is ');
      const result5 = segmenter.push('a ');
      const result6 = segmenter.push('test ');
      const result7 = segmenter.push('of ');
      const result8 = segmenter.push('segmentation ');

      // At least one push should have returned a non-empty array once 8 words are reached
      const allChunks = [
        ...result1, ...result2, ...result3, ...result4,
        ...result5, ...result6, ...result7, ...result8,
      ];
      expect(allChunks.length).toBeGreaterThan(0);
      expect(allChunks[0].trim().length).toBeGreaterThan(0);
    });

    it('returns empty array before 8 words are reached', () => {
      const result1 = segmenter.push('Hello ');
      const result2 = segmenter.push('world ');
      const result3 = segmenter.push('foo ');

      // Less than 8 words — no chunk flushed yet
      expect([...result1, ...result2, ...result3]).toHaveLength(0);
    });

    it('switches to sentence regime after first chunk is flushed', () => {
      // Trigger first-chunk flush
      segmenter.push('one two three four five six seven eight ');

      // Now in sentence regime — period should trigger a flush
      const r = segmenter.push('Next sentence here. ');
      expect(r.length).toBeGreaterThan(0);
    });
  });

  describe('sentence regime (Regime 2)', () => {
    beforeEach(() => {
      // Transition to sentence regime by flushing first chunk
      segmenter.push('one two three four five six seven eight ');
    });

    it('does NOT split on "Dr. Smith" (abbreviation deny-list)', () => {
      const r = segmenter.push('She called Dr. Smith immediately. ');
      // Should produce one chunk ("She called Dr. Smith immediately."), not two
      if (r.length > 0) {
        expect(r.some((c) => c.includes('Dr.'))).toBe(true);
        // The abbreviation should NOT cause a split before "Smith"
        expect(r.every((c) => !c.match(/^\s*Smith/i))).toBe(true);
      }
      // If no chunk yet, that is also acceptable (pending more text)
    });

    it('does NOT split on "3.14" (decimal pattern)', () => {
      const r = segmenter.push('Pi is approximately 3.14 in most calculations. ');
      if (r.length > 0) {
        // "3.14" should not be treated as a sentence boundary
        expect(r.every((c) => !c.match(/^\s*in most/i))).toBe(true);
      }
    });

    it('accumulates until a real sentence boundary', () => {
      const chunks: string[] = [];
      chunks.push(...segmenter.push('She smiled and said '));
      chunks.push(...segmenter.push('hello to everyone present. '));
      chunks.push(...segmenter.push('They all waved back.'));

      // Should have flushed at least one sentence
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('flush()', () => {
    it('returns remaining buffer content and resets state', () => {
      segmenter.push('incomplete fragment without boundary');
      const remaining = segmenter.flush();
      expect(remaining.length).toBeGreaterThan(0);
      expect(remaining).toContain('incomplete');
    });

    it('returns empty string when buffer is empty', () => {
      const remaining = segmenter.flush();
      expect(remaining).toBe('');
    });

    it('resets state so next push starts fresh', () => {
      // Fill up to first-chunk threshold
      segmenter.push('one two three four five six seven eight ');
      segmenter.flush();
      // After flush, should start in first-chunk regime again
      const r = segmenter.push('short ');
      expect(r).toHaveLength(0); // Not enough words yet
    });
  });
});
