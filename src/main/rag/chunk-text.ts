/**
 * Plan 07-01 Task 2 — text cleanup primitives for the RAG pipeline.
 *
 * - `tokenCount`: cheap char/4 heuristic (RESEARCH §7) — avoids a tokenizer dep
 *   while staying close enough to GPT-class behavior for chunk sizing.
 * - `normalizeWhitespace`: collapses runs of spaces / blank lines WITHOUT
 *   shifting char offsets used elsewhere (callers pass the original body in;
 *   the cleaned body is for downstream search only).
 * - `stripEmailReply`: wraps `email-reply-parser@2.3.5`. Note Pitfall 6 in
 *   RESEARCH §8 mentions an `aggressive: false` flag — that flag does not exist
 *   in the library's public API as of 2.3.5 (see node_modules/email-reply-parser/
 *   dist/emailreplyparser.d.ts). The library default behavior already preserves
 *   inline-reply content, which is what the pitfall is asking for; the inline-
 *   reply fixture in `tests/fixtures/rag/email-reply-samples.json` exercises
 *   this directly. Swap-friendly: callers go through `stripEmailReply` only.
 */

import EmailReplyParser from 'email-reply-parser';

/** Approximate token count via char/4 heuristic. */
export function tokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Collapse runs of internal whitespace + trim, but preserve paragraph breaks
 * (single blank line). Does NOT modify the original body — callers should
 * preserve the source string if they need stable char offsets.
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return '';
  return text
    // collapse 3+ blank lines into one blank line (paragraph)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // collapse runs of spaces / tabs (but not newlines)
    .replace(/[ \t]+/g, ' ')
    // trim trailing whitespace per line
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

/**
 * Strip quoted replies + signatures from an email body. Returns the visible
 * text. Never logs the body. Empty input yields empty output.
 */
export function stripEmailReply(body: string): string {
  if (!body) return '';
  const email = new EmailReplyParser().read(body);
  return email.getVisibleText();
}

/**
 * Optional helper for callers that need to map a `cleaned` substring back to
 * the original body. We perform a simple `indexOf` lookup. If the cleaned text
 * is not found verbatim in the original (because reply-stripping removed
 * surrounding context), we clamp to the start of the visible region as a
 * documented approximation — see Plan 07-01 Task 2 behavior note.
 */
export function mapCleanedToOriginalSpan(
  cleaned: string,
  original: string,
): { charStart: number; charEnd: number; approximated: boolean } {
  if (!cleaned) return { charStart: 0, charEnd: 0, approximated: false };
  const idx = original.indexOf(cleaned);
  if (idx >= 0) {
    return { charStart: idx, charEnd: idx + cleaned.length, approximated: false };
  }
  // Approximation: clamp to the first non-whitespace char of the original.
  const firstNonWs = original.search(/\S/);
  const start = firstNonWs >= 0 ? firstNonWs : 0;
  return { charStart: start, charEnd: Math.min(original.length, start + cleaned.length), approximated: true };
}
