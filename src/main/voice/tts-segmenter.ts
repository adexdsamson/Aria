/**
 * Phase 16 / Plan 16-02 Task 1 — D-04 Hybrid TTS segmenter.
 *
 * Two-regime incremental text segmenter that feeds token-delta streams into
 * prosody-aware TTS chunks:
 *
 * Regime 1 (first-chunk): Flushes a ~firstChunkWords-word fragment on the
 * nearest word boundary as soon as the buffer holds enough words. This drives
 * the first Kokoro synth call ASAP, targeting first-audio p50 <900 ms (SC2).
 *
 * Regime 2 (sentence): Accumulates full sentences with an abbreviation-aware
 * deny-list so that "Dr. Smith", "Prof. Jones", "3.14" and similar patterns do
 * not cause false sentence breaks (prosody quality).
 *
 * Pure TypeScript — ZERO imports from 'electron' or 'ai'. Unit-testable without
 * any Electron or LLM dependencies.
 */

/** Abbreviation prefixes that must NOT trigger a sentence split. */
const ABBREVIATION_RE = /\b(Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g\.)$/i;

/** Decimal numbers like 3.14 must NOT trigger a sentence split. */
const DECIMAL_RE = /\d\.\d$/;

/** Sentence-ending punctuation followed by whitespace or end-of-string. */
const SENTENCE_END_RE = /[.!?](?:\s|$)/g;

/**
 * Find the character index in `text` where the N-th whitespace-separated word
 * ends (i.e. just after the N-th space/run that follows a non-space sequence).
 * Returns -1 if the text has fewer than `n` words.
 */
function findWordBoundary(text: string, n: number): number {
  let wordCount = 0;
  let i = 0;

  while (i < text.length) {
    // Skip leading whitespace
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) break;

    // Scan a word
    while (i < text.length && !/\s/.test(text[i]!)) i++;
    wordCount++;

    if (wordCount === n) {
      // We are now right after the n-th word — skip trailing whitespace too
      // so the chunk includes a clean trailing space boundary.
      while (i < text.length && /\s/.test(text[i]!)) i++;
      return i;
    }
  }

  return -1; // fewer than n words
}

export class TtsSegmenter {
  private buffer = '';
  private firstChunkFlushed = false;

  constructor(private readonly firstChunkWords: number = 8) {}

  /**
   * Append `delta` to the internal buffer and return any newly-flushed chunks.
   *
   * - Before the first chunk is flushed (Regime 1): returns a 1-element array
   *   when the buffer has accumulated >= `firstChunkWords` words.
   * - After the first chunk is flushed (Regime 2): returns an array of complete
   *   sentences (may be empty if no sentence boundary yet in the buffer).
   */
  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];

    if (!this.firstChunkFlushed) {
      // Regime 1: count words and flush when we hit the threshold
      const words = this.buffer.split(/\s+/).filter(Boolean);
      if (words.length >= this.firstChunkWords) {
        const boundary = findWordBoundary(this.buffer, this.firstChunkWords);
        if (boundary > 0) {
          const chunk = this.buffer.slice(0, boundary).trim();
          if (chunk.length > 0) {
            chunks.push(chunk);
          }
          this.buffer = this.buffer.slice(boundary);
          this.firstChunkFlushed = true;
        }
      }
    } else {
      // Regime 2: sentence-boundary scanning with deny-list
      SENTENCE_END_RE.lastIndex = 0; // reset since we reuse the global regex
      let match: RegExpExecArray | null;
      let lastEnd = 0;

      while ((match = SENTENCE_END_RE.exec(this.buffer)) !== null) {
        const end = match.index + match[0].length;
        // The text from lastEnd up to (but not including) the match end
        const candidate = this.buffer.slice(lastEnd, end);
        // Text up to (but not including) the punctuation mark — for deny-list testing
        const beforePunct = this.buffer.slice(lastEnd, match.index);

        // Check deny-list on the text immediately before the punctuation mark.
        // ABBREVIATION_RE ends with word like "Dr", "Prof" — test without the dot.
        // DECIMAL_RE ends with digit.digit pattern — test without the dot.
        if (ABBREVIATION_RE.test(beforePunct) || DECIMAL_RE.test(beforePunct)) {
          // False boundary — skip this match (do NOT advance lastEnd)
          continue;
        }

        const chunk = candidate.trim();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
        lastEnd = end;
      }

      if (lastEnd > 0) {
        this.buffer = this.buffer.slice(lastEnd);
      }
    }

    return chunks;
  }

  /**
   * Flush any remaining text from the buffer and reset state.
   * Call this when the LLM stream ends to emit the trailing partial sentence.
   */
  flush(): string {
    const remaining = this.buffer.trim();
    this.buffer = '';
    this.firstChunkFlushed = false;
    return remaining;
  }
}
