# Phase 10 — Knowledge Folders: CONTEXT

**Date:** 2026-05-21
**Status:** Decisions locked; ready for `/gsd-plan-phase 10`

<domain>
Let the user register one or more **local folders** as knowledge sources for `/ask`. Aria walks each folder, parses supported file types (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`), chunks + embeds into the existing Phase 7 `chunks` table with `corpus='folder'`, watches the folder live, and exposes citations alongside email/calendar/meeting/contacts corpora. Per-folder sensitivity flag forces local-only routing when any sensitive chunk enters a retrieval set.

Google Drive is **deferred** to a follow-up phase; parsers + ingestion pipeline built here will be reused.
</domain>

<canonical_refs>
Every downstream agent (researcher, planner) MUST read these before acting.

- `docs/superpowers/specs/2026-05-21-knowledge-folders-design.md` — **canonical design spec** (sections §1–§12 locked; this CONTEXT.md only adds the §13 resolutions and the four gray-area decisions below)
- `.planning/ROADMAP.md` — Phase 10 entry (goal placeholder; this doc supplies it)
- `.planning/phases/07-rag-qa/07-CONTEXT.md` — RAG pipeline + model-swap reconciler invariant
- `.planning/phases/03-approval-queue/03-CONTEXT.md` — sensitivity router shape; per-call taint pattern
- `.planning/phases/08-insights-recap-learning-release/08-CONTEXT.md` — 14-day hard gate (folder corpus does **not** count toward gate; see §decisions)
- `src/main/services/rag/` — Phase 7 chunker, embedder, vector store (reuse)
- `src/main/db/migrations/` — confirm next migration number during planning
- `src/main/services/sensitivity-router/` — Phase 3 gate (extend, do not duplicate)
- `src/renderer/features/settings/RagIndexSection.tsx`, `IntegrationsSection.tsx`, `BackupRestoreSection.tsx` — editorial card pattern to mirror
</canonical_refs>

<carried_forward>
From prior phases — already decided, do not re-ask:

- **Embedding model:** `nomic-embed-text` v1.5 via Ollama (Phase 1 / Phase 7); never frontier for embeddings
- **Vector store:** existing dual-impl `SqliteVec` / `BruteForce` from Phase 7; folder chunks share the store
- **Retrieval:** hybrid BM25 + vector + RRF (k=60); folder chunks join naturally
- **Sensitivity router shape:** per-call taint; PII / sensitive content downgrades a single LLM call to local. Phase 10 extends this with an additive folder-source check.
- **Approval / destructive-action consent dialog:** Phase 7 UAT enforced across all destructive surfaces; **Remove folder** must honor it
- **Editorial UI:** stat card + action cards + gold left-border accents (Phase 9 + Phase 7/8 polish)
- **Cron + powerMonitor:** node-cron + p-queue + Electron powerMonitor pattern (Phase 1); reuse
- **Migration discipline:** single migration, idempotent, numbered next-in-sequence; do not invent column names — grep canonical names ([[feedback-plan-schema-invention]])
- **Chokepoint pattern:** if any IPC writes data that downstream queries depend on, the write must be the single source — no duplicate paths ([[project-aria-phase2-sync-schema-drift]])
</carried_forward>

<decisions>

### Locked from spec (no further discussion)
Sections §1–§12 of `docs/superpowers/specs/2026-05-21-knowledge-folders-design.md` are canonical. In particular:

- **Schema:** new tables `knowledge_folders`, `knowledge_files`; ALTER `chunks` to add `folder_id`, `file_id`; unique index on `(folder_id, relative_path)`; cascade on folder delete via `file_id`.
- **Parsers:** `papaparse` / `mammoth` / `exceljs` / `pdfjs-dist` legacy + native text/markdown. Section locators carried into citations.
- **Watcher:** chokidar w/ `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }`; p-queue concurrency 2; tombstones with 24h resurrection window; daily 03:00 sweep cron + boot reconciliation; powerMonitor suspend/wake.
- **Sensitivity gate:** additive to existing Phase 3 gate; one sensitive chunk → local-only for that call.
- **IPC surface:** as listed in spec §8.
- **UI:** `KnowledgeFoldersSection.tsx` editorial pattern; confirm-dialog on Remove.
- **Failure isolation:** per-file `status='error'` + `last_error`; folder stays healthy.
- **Size limits:** 50 MB hard skip; 5 MB extracted-text truncate; unknown extensions silently ignored.
- **Chunk identity:** `sha256(file_id || chunk_index || content_hash)`; identical content = no-op re-index.

### Gray-area resolutions (this discussion)

1. **Embed-model swap → folder chunks participate in existing Phase 7 reconciler.**
   Re-embed reads from `chunks.content` (already on disk in SQLite); no disk re-walk, no re-parse. Same code path as other corpora. Preserves Phase 7's "never mixed-model retrieval" invariant.
   *Implication:* no new code in the reconciler — folder chunks are just rows with the same shape.

2. **Disk-footprint stat = sum of source-file bytes.**
   Computed from `SUM(knowledge_files.size)` per folder. Surfaced as `bytesIndexed` in `aria:knowledge:folder-stats`. UI shows it as "Size on disk" (or equivalent).
   *Rejected:* extracted-text bytes (confusing for PDF/xlsx), chunk-table bytes (operationally meaningful but opaque). Single number on the card.

3. **Large-folder pre-scan + confirm dialog at thresholds.**
   After `pick-folder` returns a path, run a fast count-only walk (no parse, no hash) bounded by the same exclude-globs (node_modules etc.) the scanner uses. If **file count > 5,000 OR total bytes > 2 GB**, render a confirm dialog: `"This folder has {N} files ({size}). Initial indexing will take a while. Continue?"` Below threshold, register silently.
   - The pre-scan is **not** the indexing scan — it's a read-only walk, cheap.
   - Cancel returns to the picker without persisting the row.
   - Pre-scan happens in the main process before any DB write.

4. **Sensitivity gate is per-turn, no cross-turn carry.**
   Each `/ask` turn evaluates its own retrieval set: any chunk whose `corpus='folder'` row links to a `knowledge_folders.sensitivity='sensitive'` row → that single turn routes local-only with the existing Phase 3 lock-badge. Next turn re-evaluates from scratch. Mirrors Phase 3's per-call shape.
   - **Hybrid retrieval (folder + email + meeting in one set):** one sensitive folder chunk taints the entire turn, even if non-sensitive sources dominate.
   - **Multi-turn chat:** taint does **not** stick across turns; user can ask a follow-up that retrieves only non-sensitive sources and frontier routing returns.
   - **Citations:** rendered normally for sensitive folders — only LLM routing changes.

### Sensitivity gate test contract (informs Phase 10 verifier)

The integration / E2E suite MUST cover:
- Pure-sensitive retrieval → local, lock-badge present
- Pure-general folder retrieval → frontier permitted (no badge)
- Hybrid set with one sensitive chunk → local, lock-badge, citations include both sources
- Multi-turn: turn 1 tainted (local) → turn 2 retrieves only general sources → frontier returns; no sticky lock-badge on turn 2
- Sensitivity flip on a folder between turns → next turn respects new flag; in-flight call not interrupted (documented per spec §7)

### Phase 8 14-day hard gate interaction

Folder chunks do **not** count toward the Phase 8 14-day data hard gate. Rationale: the gate exists to ensure Aria has seen *email/calendar/meeting* signal before insights/recap fire — those are the surfaces it judges over. Knowledge folders are passive Q&A context, not the activity stream. Planner: do NOT add `corpus='folder'` to the gate's signal count.
</decisions>

<deferred>
Captured here so they don't get lost; **not** Phase 10 work:

- **Google Drive connector** — separate follow-up phase; will reuse parsers + ingestion + sensitivity gate from Phase 10 unchanged.
- **OCR for scanned PDFs** — out of scope; `last_error='likely_scanned_no_ocr'` is the documented behavior.
- **`.pptx` / `.rtf` / `.html` / code-file parsers** — backlog.
- **Per-file sensitivity overrides** — folder-level only in v1.
- **Symlink following / network-drive placeholders / OneDrive-Dropbox cloud-hydration** — backlog.
- **Shared / multi-user folders** — out of scope.
- **Disk-footprint hard quotas** — soft warning + size limit only in v1.
- **`/ask` UI changes** — citation rendering reused as-is; no UI surface changes outside Settings.
</deferred>

<code_context>
Reusable assets (from scout + memory):

- **Phase 7 RAG pipeline** — `src/main/services/rag/` — chunker, Ollama embedder, vector store, RRF retrieval, model-swap reconciler. Folder ingestion plugs in at the chunk-write step; no new retrieval code.
- **Phase 3 sensitivity router** — `src/main/services/sensitivity-router/` (or equivalent) — extend the gate function to consult `knowledge_folders.sensitivity` for any chunk with `corpus='folder'`.
- **Phase 8 destructive-action confirm dialog** — already wired in Settings; reuse on Remove.
- **`AddAccountModal`-style modal** — for the large-folder confirm + the sensitivity-on-add inline form.
- **`RagIndexSection.tsx`** — closest visual analog for `KnowledgeFoldersSection.tsx`.
- **Migration pattern** — `src/main/db/migrations/NNN-*.ts`; planner must grep the latest number, must not invent column names already present in `chunks`.
- **node-cron + p-queue + powerMonitor** — Phase 1 wiring; reuse for the 03:00 sweep + concurrency control + sleep/wake.

Watch out for ([[feedback-plan-schema-invention]]): grep `chunks` schema before drafting the ALTER. Do not `CREATE TABLE IF NOT EXISTS` on existing shared tables.
</code_context>

<next_steps>
`/gsd-plan-phase 10` — research will be minimal (most decisions locked); planner should produce ~3 plans following the spec's §12 rollout order, collapsed where dependencies allow.
</next_steps>
