export interface TranscriptChunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export function chunkTranscriptForExtraction(
  normalizedText: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): TranscriptChunk[] {
  const maxChars = Math.max(200, opts.maxChars ?? 6000);
  const overlapChars = Math.max(0, Math.min(opts.overlapChars ?? 400, Math.floor(maxChars / 2)));
  const chunks: TranscriptChunk[] = [];
  let start = 0;
  while (start < normalizedText.length) {
    const roughEnd = Math.min(normalizedText.length, start + maxChars);
    const end = roughEnd === normalizedText.length ? roughEnd : findBoundary(normalizedText, start, roughEnd);
    chunks.push({
      index: chunks.length,
      text: normalizedText.slice(start, end),
      startOffset: start,
      endOffset: end,
    });
    if (end === normalizedText.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

function findBoundary(text: string, start: number, roughEnd: number): number {
  const window = text.slice(start, roughEnd);
  const lastBreak = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '));
  if (lastBreak > 100) return start + lastBreak + 1;
  return roughEnd;
}
