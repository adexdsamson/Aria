# Phase 7 Context: RAG Q&A

**Phase:** 7
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** RAG-01, RAG-02, RAG-03, RAG-04, RAG-05

<domain>
Cited natural-language Q&A over the user's own data ("What did Sarah commit to on Q3?"). Delivers:
- Local embedding pipeline using nomic-embed-text via Ollama
- sqlite-vec vector index colocated in the SQLCipher DB with FTS5 BM25
- Hybrid BM25 + vector retrieval with entity disambiguation
- Cited answer UI in a chat panel + global command-bar
- Incremental re-indexing on source edit/delete with model-id versioning
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 7 scope, plans, success criteria (lines 129–138)
- `.planning/REQUIREMENTS.md` — RAG-01..05 (89–93)
- `CLAUDE.md` — better-sqlite3 11, sqlite-vec, SQLCipher, Ollama (nomic-embed-text v1.5 274MB 8192 ctx), Vercel AI SDK 5
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md` — Gmail/Calendar ingest cadence (mail 5min, calendar 15min); SQLite schema patterns
- `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md` — sensitivity classifier + hybrid redaction (token sub for general PII, entirely local for HR/legal/financial ≥ med). Reused for answer-synthesis routing.
- `.planning/phases/05-outlook-parity-email-calendar/05-CONTEXT.md` — provider abstraction; canonical Message/Event keyed on providerKey+accountId+externalId
- `.planning/phases/06-meeting-capture-todoist-push/06-CONTEXT.md` — Note entity, normalized transcript text with char-offset spans, action items
- sqlite-vec docs (asg017); SQLite FTS5 docs; nomic-embed-text v1.5 model card (researcher)
</canonical_refs>

<prior_decisions>
**Project-level:**
- Local-first; embeddings always local (Ollama)
- Sensitive content routing reuses Phase 3 hybrid rule

**From earlier phases:**
- All canonical entities (Message, Event, Note, Action) keyed on stable IDs and have char-offset spans available
- sqlite-vec is NOT loaded in Phase 1 (see src/main/db/connect.ts:14). Phase 7 ships a `VectorStore` dual-impl: `SqliteVecStore` (when the runtime load probe succeeds) + `BruteForceStore` (fallback). Phase 7 plan 07-02 Task 1 owns the load probe and impl selection. (corrected 2026-05-19 per REVIEWS.md C1; original text was an inherited assumption from Phase 1 punt)
</prior_decisions>

<decisions>

### Indexing scope + chunking strategy spike
- **Corpora indexed in v1 (all four):**
  - Email bodies (Gmail + Outlook) — strip quoted-replies and signatures before chunking
  - Calendar event titles + descriptions
  - Meeting transcripts + 5-section summaries (Phase 6 Notes, including action-item text)
  - Aria-extracted action items + Todoist task descriptions
- **Chunking spike (ROADMAP plan 1):** Compare three named strategies on real Aria-stored data:
  - **A — Per-message**: each email body / event description / note section as one chunk (with truncation rule for long bodies)
  - **B — Per-thread (rolled)**: entire email thread or full transcript collapsed into one chunk; truncated by token budget with start-and-end retention
  - **C — Hybrid (token-window with overlap)**: ~512-token chunks with ~64-token overlap, respecting message/turn boundaries when possible
- **Spike eval design:**
  - **Primary metric (decision driver):** recall@10 and MRR of ground-truth chunks against a **user-authored 20-question held-out QA set** built from real data; each question labeled with the correct source message/note/event IDs.
  - **Sanity check:** end-to-end LLM-judge over the same 20 questions (retrieval → answer → judge picks "answer cites correct source / answer is correct"). Confirms the retrieval winner also produces better answers.
  - **Decision record:** spike output committed as `07-SPIKE-CHUNKING.md` before plans 2–3 begin; CONTEXT updated if winning strategy needs config changes downstream.
- **Re-index trigger semantics (RAG-05 / SC-2): dual-mode**
  - **Synchronous (immediate)** for high-priority sources: transcript edits, Note edits, recent-mail (last 7d) edits or deletes.
  - **Background** for older sources: mark chunks dirty, worker re-embeds on next ingest cycle (mail 5min, calendar 15min).
  - SC-2 "within one sync cycle" is honored in both paths.
- **Chunk schema:**
  ```ts
  chunks {
    id, sourceKind: 'email'|'event'|'note'|'action', sourceId, providerKey?, accountId?,
    text, charStart, charEnd, tokenCount,
    parentRef?,            // thread/event/note id for grouping
    speakerHint?,          // for transcript chunks
    createdAt, dirty: bool
  }
  embeddings {
    chunkId, modelId, dim, vector blob, embeddedAt
  }
  ```

### Retrieval + entity disambiguation
- **Hybrid fusion: Reciprocal Rank Fusion (RRF)** with k=60 default, over BM25 top-K and vector top-K (K=50 each → fused → top-10 to the LLM). Parameter-light, no per-corpus tuning. Reranker explicitly deferred to v1.x.
- **BM25 backend: SQLite FTS5**, colocated with sqlite-vec in the SQLCipher DB. Single query path; native to better-sqlite3.
- **Person-name entity resolution (RAG-04 / SC-3):** Both — directory primary, LLM fallback for ambiguous.
  - **Contacts directory** built as a background job from sent/received mail headers + calendar attendees + Note speakers. Schema: `Person { id, canonicalEmail, displayName, aliases[] }`.
  - **Alias map** captures variants from observed headers (Sarah / Sarah S / S. Smith / sarah@x.com).
  - **Query pipeline** detects person mentions in the question, looks up directory: confident single match → rewrite to canonical Person ID before retrieval. Multiple matches → invoke LLM with the candidate list + short context (recent messages, recency, query) to pick or ask the user.
- **SC-3 manual eval shape:** 10 cases total — **7 unambiguous + 3 ambiguous** (multiple people sharing a first name). Pass = top-1 canonical Person match. User authors the 10 against real data.

### Citation + Q&A surface UX
- **Citation granularity: chunk-level** — `{ sourceKind, sourceId, charStart, charEnd }`. Click on a citation opens the source view (email / Note / event) with the chunk highlighted (reuses Phase 6 char-offset highlight viewer for Notes).
- **Q&A surfaces (both):**
  - **Dedicated chat panel** at left-nav route `/ask` — multi-turn conversation, threaded history.
  - **Global command-bar one-shot** (Cmd/Ctrl+K) — single-turn quick question from anywhere in the app; opens a popover with the answer + citations; "expand to chat" button moves the question into a new thread in the `/ask` panel.
  - Both surfaces share the same retrieval + answer pipeline.
- **Conversation memory: persistent threaded history.** Threads persist across app restarts; user can browse / search / resume past threads. Multi-turn within a thread uses last-N-turns context window (default N=6).
- **No-source behavior:** **Hard refusal** — `"I couldn't find anything in your data about that."` No best-effort uncited answer. Preserves trust posture and the RAG-03 contract.
- **Citation rendering:** inline numbered superscripts `[1][2]` mapped to a citation list below the answer; each list item shows source kind + title + snippet + click-to-open.

### Embedding versioning + sensitivity routing
- **Versioning approach:** Stamp every vector row with `(modelId, dim, embeddedAt)`. Queries filter by current active `modelId`. Old vectors remain in the table during migration but are never returned — satisfies SC-4 (old vectors not silently reused).
- **Rebuild on model swap: background full rebuild with progress UI, atomic switch.**
  - On swap: insert new `modelId` rows alongside old; background worker re-embeds all chunks under new model; queries continue serving from old until rebuild completes; atomic flip changes "active modelId" pointer; old vectors then purged in a sweep job.
  - UI: settings page shows rebuild progress; RAG continues working throughout.
- **Sensitive content + answer LLM (Phase 3 hybrid):**
  - Phase 3 classifier runs on each retrieved chunk's source.
  - **General PII chunks**: redacted via token substitution (Phase 3) before being placed in the answer-synthesis prompt; frontier LLM sees tokens; local re-hydration on response before display.
  - **HR / legal / financial at severity ≥ med**: answer synthesis runs **entirely on local LLM** (no frontier call); no redaction-and-send path for these categories.
  - Consistent with Phase 3 drafting routing — same router, same rules.
- **Embedding routing: never frontier.** All embeddings via local Ollama (nomic-embed-text v1.5). No opt-in for frontier embeddings in v1.

### Cross-cutting
- **LLM call governance:** answer synthesis through p-queue; classifier + embedding workers each have their own bounded concurrency to avoid Ollama saturation.
- **Re-index on delete:** when a source is deleted, its chunks + embeddings are cascade-deleted; FTS5 row removed.
- **Cross-account behavior:** retrieval is unified across all connected accounts by default; UI filter to scope to a single account if needed (matches Phase 5 mail/calendar UX).
- **Storage growth:** projected size estimated via spike (chunk count × dim × 4 bytes). Settings shows DB size; vacuum/compaction strategy out of scope for v1.

</decisions>

<deferred>
- **Cross-encoder reranker (bge-reranker-base or similar)** — v1.x quality improvement
- **Frontier embedding API opt-in** — out of scope
- **Cross-app federated search (Slack, Drive, Notion)** — out of scope; v1 is local data only
- **Question rewriting / multi-query expansion before retrieval** — defer
- **Streaming answer rendering with progressive citation reveal** — nice-to-have, defer
- **Per-source ACL beyond "user owns it"** — n/a for single-user local app
- **Compaction / vacuum for old embeddings** — defer
- **Index attachments (PDF/doc bodies in emails)** — defer; v1 indexes message text + already-ingested Notes
- **Topic clustering / auto-tag generation** — Phase 8 territory
</deferred>

<open_questions_for_research>
- nomic-embed-text v1.5 on Ollama: max input length (8192 ctx claimed), throughput on a typical exec laptop, batching API shape
- sqlite-vec on better-sqlite3-multiple-ciphers (SQLCipher): loading the extension under SQLCipher, performance vs plain SQLite
- FTS5 best-config for our content: tokenizer (unicode61 vs porter), prefix queries, ranking function (bm25() with weights?)
- Quoted-reply / signature stripping for email: existing libs (email-reply-parser, mailparser) vs hand-rolled regex; quality on real corporate-mail formats
- 20-question QA set authoring guidance — what makes a good evaluation question for an exec-context RAG; how to label ground-truth chunks efficiently
- Storage-cost estimation: typical embedding bytes per Aria-stored mail/event/Note for the persona — needed to set user expectations on DB size
- Background worker model in Electron: powerMonitor + node-cron pattern from Phase 2; how to keep re-embed work off the main thread
- Atomic model-swap pointer mechanism — config table row with version vs schema migration
- LLM choice for answer synthesis: local 8B for sensitive paths vs frontier for general — need quality comparison on cited-answer tasks
- Command-bar (Cmd-K) implementation: existing patterns in Tauri/Electron React stacks (cmdk lib) — fit our shadcn/ui setup
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User asks a natural-language question about content in their inbox/calendar/transcripts and receives an answer with at least one verifiable citation
2. Editing a source message triggers re-embedding of affected chunks within one sync cycle
3. Querying for a person name returns the right entity on a 10-case manual eval (7 unambiguous + 3 ambiguous)
4. Embedding model swap rebuilds the index; old vectors are not silently re-used
</success_criteria_recap>
