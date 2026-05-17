# Phase 7 Discussion Log

**Date:** 2026-05-17
**Phase:** 7 — RAG Q&A

Human reference only.

## Gray Areas Selected
- Indexing scope + chunking strategy spike
- Retrieval + entity disambiguation
- Citation + Q&A surface UX
- Embedding versioning + sensitivity routing

## Q&A

### Indexing scope + chunking strategy spike
- **Corpora:** _Email bodies + Calendar event titles/descriptions + Meeting transcripts/summaries + Aria-extracted action items + Todoist task descriptions (all four)._
- **Spike scope:** _Three named strategies — per-message, per-thread (rolled), hybrid (token-window with overlap)._
- **Spike eval:** _Both — retrieval metric (recall@10 / MRR on user-authored 20-question QA set) for decision; end-to-end LLM-judge as sanity check._
- **Re-index trigger:** _Dual-mode — synchronous for transcripts and recent (7d) mail edits; background within one sync cycle for older sources._

### Retrieval + entity disambiguation
- **Fusion:** _RRF (k=60) over BM25 top-50 + vector top-50 → fused top-10._
- **BM25 backend:** _SQLite FTS5, colocated with sqlite-vec in SQLCipher._
- **Entity resolution:** _Both — contacts directory as primary, LLM fallback for ambiguous._
- **SC-3 eval shape:** _Mix — 7 unambiguous + 3 ambiguous (same first name)._

### Citation + Q&A surface UX
- **Citation granularity:** _Chunk-level (source + char span)._
- **Surface:** _Dedicated chat panel `/ask` + global command-bar (Cmd-K) one-shot._
- **Memory:** _Persistent chat history with sessions/threads._
- **No-source:** _Hard refusal — "I couldn't find anything in your data about that."_

### Embedding versioning + sensitivity routing
- **Versioning:** _Stamp every vector row with (modelId, dim, embeddedAt); queries filter by current model._
- **Rebuild:** _Background full rebuild with progress UI; old model serves until rebuild completes; atomic switch._
- **Sensitivity routing:** _Hybrid — redact for general PII (token sub), entirely local for HR/legal/financial ≥ med (matches Phase 3)._
- **Embedding routing:** _Never frontier — all embeddings via local Ollama (nomic-embed-text)._

## Deferred Ideas
- Cross-encoder reranker → v1.x
- Frontier embedding API opt-in → out of scope
- Cross-app federated search → out of scope
- Question rewriting / multi-query expansion → defer
- Streaming answer rendering → defer
- Attachments indexing (PDF/doc in emails) → defer
- Topic clustering / auto-tag → Phase 8

## Claude's Discretion (not asked, applied)
- RRF k=60; top-50 BM25 + top-50 vector → top-10 to LLM
- Chunk schema with `dirty` flag for incremental re-index
- Embeddings table with (modelId, dim, embeddedAt) tuple
- Atomic model-swap via active-modelId pointer
- Multi-turn context window default N=6
- Citation rendering as inline numbered superscripts + list below answer
- p-queue gates answer synthesis; embedding worker has separate concurrency budget
- Cross-account retrieval unified by default; account chip filter available
