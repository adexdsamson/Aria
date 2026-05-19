/**
 * Plan 07-01 Task 2 — shared RAG chunk + source-doc types.
 *
 * RagChunk mirrors the rag_chunk row shape produced by Task 1 migration 126,
 * plus the C7 columns (title, lang, sourceUpdatedAt) and the C8/C12 contract
 * that `title` is non-empty so RagCitation hydration is a single-row read.
 */

export type SourceKind = 'email' | 'event' | 'note' | 'action';

export type ProviderKey = 'google' | 'microsoft' | 'todoist';

export interface RagChunk {
  /** Stable id, e.g. 'email:<msg_id>:chunk:0'. */
  id: string;
  sourceKind: SourceKind;
  sourceId: string;
  providerKey?: ProviderKey | null;
  accountId?: string | null;
  /** Thread/event/note id used for grouping (strategy B). */
  parentRef?: string | null;
  /** Speaker name when the chunk straddles a transcript segment. */
  speakerHint?: string | null;
  /** Denormalized at index time for citation rendering (C8/C12). Non-empty. */
  title: string;
  text: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  /** BCP-47 short tag if detectable (C7). */
  lang?: string | null;
  /** ISO timestamp mirroring canonical source row updated_at (C7). */
  sourceUpdatedAt?: string | null;
}

export interface SourceSegment {
  charStart: number;
  charEnd: number;
  speaker?: string;
}

export interface SourceDoc {
  sourceKind: SourceKind;
  sourceId: string;
  providerKey?: ProviderKey | null;
  accountId?: string | null;
  parentRef?: string | null;
  /** For citation rendering — populated at harvest time. Non-empty. */
  title: string;
  /** Cleaned (reply-stripped for email). */
  text: string;
  /** Transcript-friendly segment list with optional speaker. */
  segments?: SourceSegment[];
  /** ISO; for time-rendering in citations (Phase 4 L-04-10 lesson). */
  occurredAt?: string;
  sourceUpdatedAt?: string | null;
  lang?: string | null;
}

export interface ChunkingStrategy {
  name: 'A-per-message' | 'B-per-thread' | 'C-hybrid-token-window';
  /**
   * Pure function. Produces zero or more chunks for the given source. The
   * RagChunk.id field is left to the caller (Wave 2 indexer) so the strategy
   * stays pure with respect to clock/randomness.
   */
  chunk(doc: SourceDoc): Omit<RagChunk, 'id'>[];
}
