/**
 * Plan 07-03 Task 3 — Redaction round-trip util (REVIEWS C4 lift).
 *
 * Thin wrapper around `src/main/llm/tokenize.ts` (NOT `router.ts` — REVIEWS C4
 * caught the wrong-file citation in the original research). Phase 3 drafting
 * code keeps calling `tokenize.ts` directly with `approvalId`; Phase 7 answer
 * synthesis calls this module with an opaque `requestKey` (typically a ULID).
 *
 * Both backends share the same process-local `drafts` Map inside `tokenize.ts`.
 * Namespaces don't collide because the key shapes are disjoint by convention
 * (UUID-style approvalId vs ULID requestKey). Callers MUST dispose the table
 * after the round-trip completes via `disposeRedactionRoundtrip(requestKey)`.
 *
 * Anti-regression: this file MUST import from './tokenize' and MUST NOT import
 * from './router'. The plan 07-03 grep gates assert both.
 */
import {
  tokenizeForFrontier as _tokenize,
  rehydrate as _rehydrate,
  disposeDraftTable as _dispose,
  type TokenizedPrompt,
  type TokenTable,
} from './tokenize';

export type { TokenizedPrompt, TokenTable };

export function tokenizeForFrontier(requestKey: string, raw: string): TokenizedPrompt {
  return _tokenize(requestKey, raw);
}

export function rehydrate(requestKey: string, frontierResponse: string): string {
  return _rehydrate(requestKey, frontierResponse);
}

export function disposeRedactionRoundtrip(requestKey: string): void {
  _dispose(requestKey);
}
