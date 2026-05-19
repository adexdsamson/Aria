/**
 * Plan 07-01 Task 4 — three named chunking strategies.
 *
 * Pure functions: no DB writes, no LLM calls, no I/O. The Wave-2 indexer
 * (plan 07-02) provides the SourceDoc[] from the harvesters and assigns the
 * RagChunk.id; these strategies emit `Omit<RagChunk,'id'>[]`.
 */

import type { ChunkingStrategy, RagChunk, SourceDoc } from './chunk-types';
import { tokenCount } from './chunk-text';

const TOKEN_BUDGET_PER_CHUNK = 4000;
const WINDOW_TARGET_TOKENS = 512;
const WINDOW_OVERLAP_TOKENS = 64;
const CHARS_PER_TOKEN = 4;

function baseChunk(
  doc: SourceDoc,
  text: string,
  charStart: number,
  charEnd: number,
  speakerHint?: string | null,
): Omit<RagChunk, 'id'> {
  return {
    sourceKind: doc.sourceKind,
    sourceId: doc.sourceId,
    providerKey: doc.providerKey ?? null,
    accountId: doc.accountId ?? null,
    parentRef: doc.parentRef ?? null,
    speakerHint: speakerHint ?? null,
    title: doc.title,
    text,
    charStart,
    charEnd,
    tokenCount: tokenCount(text),
    lang: doc.lang ?? null,
    sourceUpdatedAt: doc.sourceUpdatedAt ?? null,
  };
}

/**
 * Strategy A — one chunk per SourceDoc. Truncate at TOKEN_BUDGET (tail-clip).
 */
export const strategyA: ChunkingStrategy = {
  name: 'A-per-message',
  chunk(doc) {
    const maxChars = TOKEN_BUDGET_PER_CHUNK * CHARS_PER_TOKEN;
    if (!doc.text) return [];
    if (doc.text.length <= maxChars) {
      return [baseChunk(doc, doc.text, 0, doc.text.length)];
    }
    const clipped = doc.text.slice(0, maxChars);
    return [baseChunk(doc, clipped, 0, clipped.length)];
  },
};

/**
 * Strategy B — per-thread / per-parentRef rolled into a single chunk.
 * Caller passes one SourceDoc per row; the strategy expects already-grouped
 * input (Wave 2 indexer groups by parentRef and concatenates). For solo
 * invocation, B reduces to a single chunk over the input doc with
 * start-and-end retention if it exceeds the token budget.
 */
export const strategyB: ChunkingStrategy = {
  name: 'B-per-thread',
  chunk(doc) {
    const maxChars = TOKEN_BUDGET_PER_CHUNK * CHARS_PER_TOKEN;
    if (!doc.text) return [];
    if (doc.text.length <= maxChars) {
      return [baseChunk(doc, doc.text, 0, doc.text.length)];
    }
    // Start-and-end retention: first half + sentinel + last half.
    const halfChars = Math.floor(maxChars / 2);
    const head = doc.text.slice(0, halfChars);
    const tail = doc.text.slice(doc.text.length - halfChars);
    const combined = `${head}\n…[truncated]…\n${tail}`;
    return [baseChunk(doc, combined, 0, doc.text.length)];
  },
};

/** Helper: chunk-by-paragraph/sentence boundaries within a [start,end) slice. */
function splitByBoundary(
  text: string,
  start: number,
  end: number,
  targetChars: number,
): Array<{ from: number; to: number }> {
  if (end - start <= targetChars) return [{ from: start, to: end }];
  const slice = text.slice(start, end);

  // Try paragraph boundaries first.
  const paraBreaks: number[] = [];
  let idx = slice.indexOf('\n\n');
  while (idx !== -1) {
    paraBreaks.push(start + idx + 2);
    idx = slice.indexOf('\n\n', idx + 2);
  }

  // Choose paragraph break closest to target.
  if (paraBreaks.length > 0) {
    const target = start + targetChars;
    const best = paraBreaks.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p));
    if (best > start && best < end) {
      return [
        { from: start, to: best },
        ...splitByBoundary(text, best, end, targetChars),
      ];
    }
  }

  // Fall back to sentence boundary `. `.
  const sentenceTarget = start + targetChars;
  const dotIdx = text.indexOf('. ', sentenceTarget - 200);
  if (dotIdx !== -1 && dotIdx + 2 < end) {
    const cut = dotIdx + 2;
    return [
      { from: start, to: cut },
      ...splitByBoundary(text, cut, end, targetChars),
    ];
  }

  // Final fallback: hard cut at targetChars.
  const hardCut = Math.min(start + targetChars, end);
  return [
    { from: start, to: hardCut },
    ...splitByBoundary(text, hardCut, end, targetChars),
  ];
}

/**
 * Strategy C — hybrid ~512-token windows with ~64-token overlap, respecting
 * segment turn boundaries when present. Falls back to paragraph then sentence
 * boundaries when no segments are supplied.
 */
export const strategyC: ChunkingStrategy = {
  name: 'C-hybrid-token-window',
  chunk(doc) {
    if (!doc.text) return [];
    const targetChars = WINDOW_TARGET_TOKENS * CHARS_PER_TOKEN;
    const overlapChars = WINDOW_OVERLAP_TOKENS * CHARS_PER_TOKEN;
    const out: Omit<RagChunk, 'id'>[] = [];

    // Segment-aware path.
    if (doc.segments && doc.segments.length > 0) {
      let buffer: { from: number; to: number; speaker?: string } | null = null;
      for (const seg of doc.segments) {
        // If a single segment exceeds the window, split it by boundary.
        if (seg.charEnd - seg.charStart > targetChars) {
          if (buffer) {
            out.push(
              baseChunk(
                doc,
                doc.text.slice(buffer.from, buffer.to),
                buffer.from,
                buffer.to,
                buffer.speaker ?? null,
              ),
            );
            buffer = null;
          }
          const sub = splitByBoundary(doc.text, seg.charStart, seg.charEnd, targetChars);
          for (const s of sub) {
            out.push(baseChunk(doc, doc.text.slice(s.from, s.to), s.from, s.to, seg.speaker ?? null));
          }
          continue;
        }
        if (!buffer) {
          buffer = { from: seg.charStart, to: seg.charEnd, speaker: seg.speaker };
          continue;
        }
        // If extending the buffer keeps us under budget, extend (allow speaker switch).
        if (seg.charEnd - buffer.from <= targetChars) {
          buffer.to = seg.charEnd;
          // Keep first speaker as hint; if mixed, mark as null.
          if (buffer.speaker && seg.speaker && buffer.speaker !== seg.speaker) {
            buffer.speaker = undefined;
          }
        } else {
          out.push(
            baseChunk(
              doc,
              doc.text.slice(buffer.from, buffer.to),
              buffer.from,
              buffer.to,
              buffer.speaker ?? null,
            ),
          );
          // Overlap by stepping back overlapChars into prior buffer where possible.
          const overlapFrom = Math.max(buffer.from, buffer.to - overlapChars);
          buffer = { from: overlapFrom, to: seg.charEnd, speaker: seg.speaker };
        }
      }
      if (buffer && buffer.to > buffer.from) {
        out.push(
          baseChunk(
            doc,
            doc.text.slice(buffer.from, buffer.to),
            buffer.from,
            buffer.to,
            buffer.speaker ?? null,
          ),
        );
      }
      return out;
    }

    // No segments: fall back to paragraph/sentence boundary splitting with overlap.
    const ranges = splitByBoundary(doc.text, 0, doc.text.length, targetChars);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      const from = i === 0 ? r.from : Math.max(0, r.from - overlapChars);
      out.push(baseChunk(doc, doc.text.slice(from, r.to), from, r.to));
    }
    return out;
  },
};

export const ALL_STRATEGIES: ChunkingStrategy[] = [strategyA, strategyB, strategyC];
