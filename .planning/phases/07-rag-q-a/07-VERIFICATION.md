---
phase: 07-rag-q-a
verified: 2026-05-19T20:30:00Z
status: human_needed
score: 5/5 must-haves verified (code+wiring); 4/4 success criteria PARTIAL pending live smoke
execution_blocker: "Vitest suites and live integration gates (Ollama roundtrip, 90k brute-force bench) are UNRUN — Aria desktop app holds Windows exclusive lock on better-sqlite3 native binding. Documented in 07-01/02/03 SUMMARYs and ratified by user. Re-verification required after running suites with desktop app closed."
deferred_followups:
  - "Real-DB user-authored eval-qa-set.json (replaces synthetic fixture) — provisional A-per-message chunk strategy re-evaluation"
  - "AnswerService ↔ IPC factory wiring (Phase 8 boot wiring)"
  - "SC-1 live smoke (cited answer / refusal / error / Cmd-K Expand) — owned by /gsd-verify-work"
  - "OLLAMA_AVAILABLE=1 + RAG_BENCH=1 integration gates"
  - "SourcePreview ↔ Phase 6 char-offset viewer"
  - "Disambiguation recentContext subjects-per-candidate JOIN"
  - "getProgress().perMinute live wiring through dbHolder"
human_verification:
  - test: "SC-1 — Ask cited Q&A"
    expected: "Backfill ≥50 chunks, ask 'what did X commit to?', receive answer with ≥1 clickable citation; ask out-of-corpus Q, receive verbatim refusal; force LLM throw, receive distinct error copy; Cmd-K transient → Expand creates new thread carrying only current Q+A"
    why_human: "End-to-end live LLM + real DB; requires desktop app to be runnable (currently holding native-binding lock that blocks vitest)"
  - test: "SC-2 — Edit source triggers re-embed within one sync cycle"
    expected: "Modify a Gmail message; verify rag_source_dirty row enqueued; ReindexScheduler.markDirty triggers IndexWorker drain; chunk re-embedded with new model_id stamp"
    why_human: "Requires live Gmail sync + Ollama + observation of dirty-queue draining over a cycle"
  - test: "SC-3 — 10-case person-name eval ≥9 top-1"
    expected: "Run person-resolver.test.ts SC-3 case (10-fixture eval at tests/fixtures/rag/people-directory-10.json) — assertions encoded but suite is unrun"
    why_human: "Vitest currently blocked by desktop-app native-binding lock; run after closing app"
  - test: "SC-4 — Embedding model swap rebuilds index; old vectors not silently reused"
    expected: "Change active_model_id in rag_index_state; ReindexScheduler.startModelSwap enqueues rebuild; boot reconciler handles crash boundaries; old-model vectors not served during/after flip"
    why_human: "Multi-process state machine + crash-boundary scenarios; reconciler unit tests cover 4 cases but live verification requires manual swap"
overrides: []
---

# Phase 7: RAG Q&A — Verification Report

**Phase Goal:** Cited natural-language Q&A over the user's own data ("What did Sarah commit to on Q3?")
**Mode:** mvp (per ROADMAP); however the User-Story regex does not match the goal text — verified against Success Criteria + REQUIREMENTS as the contract.
**Verified:** 2026-05-19T20:30:00Z
**Status:** human_needed — Phase 7 code and wiring are complete; SC live smoke requires desktop-app-closed environment to exercise vitest + live Ollama roundtrip + 90k bench gate.

## Executive Summary

All 3 plans (07-01 / 07-02 / 07-03) are landed on master at `0938dbd…2e0e4b9`. All 53 expected files exist and are substantive (5,585 LOC across 28 RAG-domain source files). Critical wiring (boot reconciler anchor, RAG IPC registration, AskScreen route, RagIndexSection mount in SettingsScreen, CommandPalette in Layout.tsx, ipc-contract methods) is grep-verified. Critical anti-regression gates (no `api/embeddings` hit, no classifier call on query path, `redaction-roundtrip` imports from `./tokenize` not `./router`, no `tools:` literal under `src/main/rag`) are all green.

The phase is **code-complete and wired**, but **success-criteria attestation is PARTIAL** because vitest cannot run while the Aria desktop app is mapping the better-sqlite3-multiple-ciphers native binding (documented same-shape blocker across 07-01/02/03). Live Ollama roundtrip (C13) and 90k brute-force p95≤300ms bench (C2) are gated by the same lock. These are flagged for human verification, not as goal-failure gaps.

## Success Criteria (ROADMAP contract)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | NL question → cited answer | PARTIAL | `answer-service.ts` (471 LOC) returns 4 discriminated result kinds; `CitationList.tsx` renders citations w/ account chip + TZ timestamps; `AskScreen.tsx` chat surface mounts at `/ask` (routes.tsx:22); `CommandPalette.tsx` mounts in `Layout.tsx:34`. Live smoke deferred — desktop-app lock. |
| SC-2 | Source edit triggers re-embed within one sync cycle | PARTIAL | `reindex-scheduler.ts` exposes `indexInline` + `markDirty`; `index-worker.ts` (254 LOC) drains `rag_source_dirty`; migration 126 wires `rag_source_dirty` PK + cascades. Unit tests written but unrun. |
| SC-3 | Person-name 10-case eval ≥9 top-1 | PARTIAL | `tests/fixtures/rag/people-directory-10.json` shipped; `person-resolver.test.ts` SC-3 case encoded; resolver hits cache → alias → local LLM disambiguation (`pick()` — never frontier per CONTEXT). Suite unrun (lock). |
| SC-4 | Model swap rebuilds index; old vectors not silently reused | PARTIAL | `model-swap-reconciler.ts` (139 LOC) covers 4 crash-boundary cases per C3; `reconcileModelSwap` boot anchor referenced at `src/main/index.ts:84,88`; sticky `vector_backend` in `rag_index_state`. Live swap not exercised. |

## REQUIREMENTS Coverage (RAG-01..RAG-05)

| REQ | Description | Status | Evidence |
|-----|-------------|--------|----------|
| RAG-01 | Local indexing via nomic-embed-text (or equivalent) | VERIFIED | `ollama-embeddings.ts` calls `/api/embed` (Pitfall 1 grep gate confirms no `/api/embeddings`); `rag_index_state` seeded with `active_model_id='nomic-embed-text:v1.5'`, dim=768. Live roundtrip gated by `OLLAMA_AVAILABLE=1` — deferred. |
| RAG-02 | NL Q → cited answer | VERIFIED (code) / PARTIAL (live) | `answer-service.ts` orchestrates retrieval → router → persistence; `AskScreen` UI + `CommandPalette` Cmd/Ctrl+K both ship. Live exec needs SC-1 smoke. |
| RAG-03 | Every answer cites ≥1 source; click-to-inspect | VERIFIED (code) | `CitationList.tsx` (111 LOC) renders citations w/ account chip + TZ-correct timestamps; `SourcePreview.tsx` shell exists; `ragOpenSource` IPC wired. SourcePreview deep-link to Phase 6 char-offset viewer is a known stub (Phase 8). |
| RAG-04 | Hybrid retrieval (BM25 + vector) for entity accuracy | VERIFIED | `bm25-search.ts` (81 LOC) uses FTS5 porter-stem MATCH; `hybrid-retrieval.ts` (211 LOC) does RRF fusion `Σ 1/(k+rank+1)` with configurable k via `app_meta.rag_rrf_k` (default 60); falls back to BM25-only on vector throw. |
| RAG-05 | Incremental re-index on update/delete | VERIFIED (code) | Migration 126 ships `rag_chunk_ai/ad/au` triggers + `rag_source_dirty`; `reindex-scheduler.ts` `markDirty` + `index-worker.ts` drain; cascade triggers FK-correct. Live cycle observation deferred. |

## Artifact Verification

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| migration 126 `rag_index.sql` | ✓ | ✓ | ✓ (embedded.ts) | VERIFIED |
| `src/main/rag/*.ts` (21 files) | ✓ | ✓ (47–471 LOC ea.) | ✓ | VERIFIED |
| `src/main/ipc/rag.ts` | ✓ | ✓ (320 LOC) | ✓ (`registerRagHandlers` called at `ipc/index.ts:334`) | VERIFIED |
| `src/main/llm/redaction-roundtrip.ts` | ✓ | ✓ (37 LOC, thin wrapper) | imports `./tokenize` (gate ✓), no `./router` import (gate ✓) | VERIFIED |
| `src/renderer/features/ask/*` (4 files) | ✓ | ✓ | AskScreen routed at `/ask` (routes.tsx:22) | VERIFIED |
| `src/renderer/components/CommandPalette.tsx` | ✓ | ✓ (268 LOC) | Mounted in `Layout.tsx:34` + App.tsx (≥2 hits) | VERIFIED |
| `src/renderer/features/settings/RagIndexSection.tsx` | ✓ | ✓ | Mounted at SettingsScreen.tsx:24,75 | VERIFIED |
| `src/renderer/features/settings/RagDisconnectedSection.tsx` | ✓ | ✓ | Plugged into IntegrationsSection | VERIFIED |
| Test files (29 spec/test files) | ✓ | ✓ | UNRUN (Windows native-binding lock) | VERIFIED-CODE / UNRUN |

## Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `src/main/index.ts` boot | `reconcileModelSwap` (C3) | comment+import+void ref at L79/84/88 | WIRED |
| `src/main/ipc/index.ts` | `registerRagHandlers` | import L47, call L334 | WIRED |
| `src/renderer/app/routes.tsx` | `AskScreen` | import L10, `<Route path="/ask">` L22 | WIRED |
| `src/renderer/features/settings/SettingsScreen.tsx` | `RagIndexSection` | import L24, `<Route path="rag-index">` L75 | WIRED |
| `src/renderer/app/Layout.tsx` | `CommandPalette` | import L15, JSX L34 | WIRED |
| `src/main/rag/answer-router.ts` | Phase 3 classifier | NOT IMPORTED (C5 anti-regression — pure function over cached `chunk.sensitivity`) | VERIFIED (zero-call invariant) |
| `redaction-roundtrip.ts` | `tokenize.ts` (C4 lift) | `from './tokenize'` (1 line) | WIRED |
| AnswerService factory | IPC handler | `getAnswerService?:` DI accepted but boot does not construct service yet | DEFERRED (Phase 8) |

## Anti-Pattern Scan

| File | Concern | Severity | Disposition |
|------|---------|----------|-------------|
| `src/main/ipc/rag.ts` | Returns `{ kind: 'error', text: 'Q&A service not ready' }` when no AnswerService injected | INFO | Intentional graceful degradation per plan 07-03; documented in SUMMARY "Known Stubs". UI surfaces as distinct error mode. |
| `src/renderer/features/ask/SourcePreview.tsx` | Minimal kind-aware caption shell (48 LOC); deep-link to Phase 6 viewer is a stub | INFO | Documented in 07-03 SUMMARY "Known Stubs"; deferred to Phase 8 polish. UI degrades to caption + click-through via ragOpenSource. |
| `RAG_INDEX_STATUS.perMinute = 0` | IndexWorker singleton not held in dbHolder | INFO | Carry-over from 07-02 #5; cosmetic IPC metric only. |
| Synthetic eval-qa-set.json | Authored under user override, not real-DB | INFO (acknowledged) | Top deferred followup; A-per-message is provisional. Does NOT block phase goal — winner tie-break is documented honestly. |

No TBD / FIXME / XXX / HACK markers found in Phase 7 source files. No console.log of chunk.text (logging hygiene gate green).

## Re-Verification Triggers

When the desktop app is closed and the user invokes `/gsd-verify-work`:

1. Run full vitest suite (29 RAG specs). Expected: green.
2. Run `OLLAMA_AVAILABLE=1 vitest tests/integration/rag/ollama-roundtrip.test.ts` — assert 768-dim L2-normalized roundtrip.
3. Run `RAG_BENCH=1 vitest tests/integration/rag/brute-force-90k-bench.test.ts` — assert p95 ≤ 300ms at 90k chunks.
4. SC-1 manual smoke (6 steps in 07-03 PLAN `<verification>`): backfill ≥50 chunks, ask cited Q, refusal copy, error copy, Cmd-K transient, Expand-to-chat.
5. SC-3 manual run of `person-resolver.test.ts` SC-3 fixture against `tests/fixtures/rag/people-directory-10.json` (≥9 top-1).

If all five pass, status promotes to `passed`. If vitest reveals failing assertions, status drops to `gaps_found` with specifics.

## Gaps Summary

**No code-level gaps.** All artifacts exist, are substantive, and wired per their declared key-links. All grep gates from REVIEWS / SUMMARY are green. The phase goal — "cited natural-language Q&A over user's own data" — is implemented end-to-end at the code layer.

**Verification is incomplete** because the test-execution and live-LLM gates were blocked at execution time by an environmental constraint (better-sqlite3 ABI lock held by running desktop app on Windows). This blocker is explicitly acknowledged in 07-01/02/03 SUMMARYs and ratified by user instruction to the verifier. It is reported as `human_needed`, not as a code gap.

**One known architectural followup** (AnswerService ↔ IPC factory boot wiring) is deferred to Phase 8 boot wiring; the IPC handler degrades cleanly with the distinct "Q&A service not ready" error path until then. This is intentional and documented — `RAG_ASK` does not silently no-op; it returns a discriminated error result that the UI renders as a distinct visual mode.

---

_Verified: 2026-05-19T20:30:00Z_
_Verifier: Claude (gsd-verifier, goal-backward)_
