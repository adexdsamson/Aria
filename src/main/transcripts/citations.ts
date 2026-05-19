export interface Citation {
  start: number;
  end: number;
}

export function validateCitation(citation: Citation, normalizedText: string): Citation | null {
  const start = Math.max(0, Math.floor(citation.start));
  const end = Math.min(normalizedText.length, Math.floor(citation.end));
  if (end <= start) return null;
  return { start, end };
}

export function quoteForCitation(citation: Citation, normalizedText: string): string {
  const valid = validateCitation(citation, normalizedText);
  return valid ? normalizedText.slice(valid.start, valid.end) : '';
}

export function offsetCitation(citation: Citation, chunkStartOffset: number): Citation {
  return { start: citation.start + chunkStartOffset, end: citation.end + chunkStartOffset };
}
