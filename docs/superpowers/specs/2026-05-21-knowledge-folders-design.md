# Knowledge Folders — Design Spec

**Status:** Draft — awaiting user review before `/gsd-plan-phase`
**Date:** 2026-05-21
**Author:** Solo dev + Claude
**Related:** Phase 7 (RAG Q&A), Phase 2 (Google OAuth — for the deferred Drive follow-up)

---

## 1. Summary

Let the user register one or more local folders as knowledge sources. Aria walks each folder, parses supported file types (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`), chunks and embeds the text into the existing Phase 7 RAG store, watches the folder for changes, and exposes the chunks to `/ask` alongside the existing email/calendar/meeting/contacts corpora.

Each folder carries a sensitivity flag (`general` | `sensitive`). When any chunk from a sensitive folder enters a retrieval set, the answer is forced local-only — frontier LLMs are not called.

Google Drive is **deferred to a follow-up phase**. The parsers and ingestion pipeline built here will be reused unchanged when Drive lands.

## 2. Goals / Non-Goals

**Goals**
- Index local files into the existing `chunks` table with `corpus='folder'`.
- Many folders, per-folder enable/disable, per-folder sensitivity flag.
- Live filesystem watching with chokidar; correct behavior across atomic-write editors.
- Robust to "Aria was off while files changed" via boot reconciliation.
- Per-file failure isolation — one bad PDF must not poison a folder.
- Citations resolve to `[folder/relative/path locator]` in `/ask` answers.

**Non-Goals (v1)**
- Google Drive connector (next phase).
- OCR for scanned PDFs.
- `.pptx` / `.rtf` / `.html` / code-file parsers.
- Per-file sensitivity overrides (folder-level only).
- Symlink following, network-drive placeholder semantics, OneDrive/Dropbox cloud-hydration.
- Multi-user / shared folders.
- Hard disk-footprint quotas.

## 3. Architecture

New service: `src/main/services/folder-ingestion/`.

```
KnowledgeFoldersSection (renderer)
   └─ IPC → folder-ingestion IPC handlers
        └─ FolderIngestionService
             ├─ FolderRegistry  (CRUD knowledge_folders rows)
             ├─ FileScanner     (initial enumeration, mtime/hash diff)
             ├─ FileParser      (docx/xlsx/pdf/text → ParsedDocument)
             ├─ Chunker         (reuses Phase 7 chunker)
             ├─ Embedder        (reuses Phase 7 Ollama embed pipeline)
             ├─ ChunkStore      (writes chunks rows, corpus='folder')
             └─ Watcher         (chokidar per folder, debounced)
```

Retrieval at `/ask` time is unchanged — RRF hybrid over the existing `chunks` table picks up folder chunks for free. The only retrieval-path change is the **sensitivity gate** consulting `knowledge_folders.sensitivity` before frontier dispatch.

## 4. Schema

One new migration (next number in sequence; confirm against `src/main/db/migrations/` during planning).

```sql
CREATE TABLE knowledge_folders (
  id              TEXT PRIMARY KEY,         -- ulid
  label           TEXT NOT NULL,
  root_path       TEXT NOT NULL UNIQUE,     -- absolute path
  sensitivity     TEXT NOT NULL DEFAULT 'general'
                    CHECK (sensitivity IN ('general','sensitive')),
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  last_indexed_at INTEGER,
  last_error      TEXT
);

CREATE TABLE knowledge_files (
  id            TEXT PRIMARY KEY,           -- sha256(folder_id || relative_path)
  folder_id     TEXT NOT NULL REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  mtime         INTEGER NOT NULL,
  size          INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,              -- sha256 of extracted text
  parser        TEXT NOT NULL,              -- 'docx'|'xlsx'|'pdf'|'text'|'markdown'|'csv'
  status        TEXT NOT NULL
                  CHECK (status IN ('indexed','tombstoned','error')),
  tombstoned_at INTEGER,
  last_error    TEXT,
  UNIQUE(folder_id, relative_path)
);
CREATE INDEX idx_knowledge_files_tombstone
  ON knowledge_files(tombstoned_at) WHERE status='tombstoned';

-- additions to existing chunks table (Phase 7)
ALTER TABLE chunks ADD COLUMN folder_id TEXT;
ALTER TABLE chunks ADD COLUMN file_id   TEXT;
CREATE INDEX idx_chunks_file_id ON chunks(file_id) WHERE file_id IS NOT NULL;
```

**Chunk identity:** `sha256(file_id || chunk_index || content_hash)`. Re-indexing an unchanged file is a no-op; a changed file replaces only its own chunks.

**Tombstone sweep:** rows with `status='tombstoned'` and `tombstoned_at < now - 24h` are deleted (with cascade to their chunks via `file_id`) by a daily 03:00 cron and on boot.

**Sensitivity flip (general↔sensitive):** updates `knowledge_folders.sensitivity` only. No chunk mutation — the gate consults the folder row at query time.

## 5. Parsers and Chunking

```ts
type ParsedDocument = {
  text: string;
  sections?: Section[];        // soft chunk boundaries
  metadata: { pages?: number; sheets?: string[]; title?: string };
};
type Section = { heading?: string; text: string; locator: string };
// locator examples: "p.3", "sheet:Q4!A1:G40", "h2:Risks"
```

| Type | Library | Notes |
|---|---|---|
| `.txt`, `.md` | none (`fs.readFile`) | markdown headings → sections |
| `.csv` | `papaparse` | ~50-row sections; header row preserved per section |
| `.docx` | `mammoth` | heading runs → sections |
| `.xlsx` | `exceljs` | one section per sheet, TSV-rendered; skip sheets > 5MB rendered |
| `.pdf` | `pdfjs-dist` legacy build | page-level sections; if extracted text < 100 chars on a >0-byte page, set `last_error='likely_scanned_no_ocr'` and skip — do not fail the file |

**Chunking:** Phase 7 chunker reused. Section boundaries are soft — chunker cannot cross them; within a section, existing token-window logic applies.

**Citations:** `{file_path, locator}` carried through to `/ask` so answers render `[contracts/acme-msa.pdf p.3]`.

**Size limits (hard, fail-loud per file):**
- File > 50 MB → skip, `last_error` populated.
- Extracted text > 5 MB → truncate to 5 MB, warning logged.
- Unknown extensions → silently ignored.

## 6. Watcher and Lifecycle

**chokidar config (per enabled folder):**
```
{ ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 } }
```
`awaitWriteFinish` collapses Word/Excel atomic-write-then-rename into a single event.

**Events:**
- `add` / `change` → enqueue parse+embed.
- `unlink` → mark file `tombstoned`, `tombstoned_at=now`; chunks remain searchable until sweep.
- Rename = `unlink` + `add`. If new path's parsed `content_hash` matches a tombstoned row within 24h, **resurrect** — clear tombstone, update `relative_path`, skip re-embed. Saves token cost on bulk renames.

**Concurrency:** `p-queue` with concurrency 2. Embeds dominate; two-at-a-time keeps Ollama busy without thrashing.

**Backpressure:** initial scans of >10k-file folders process in batches of 500 with a yield between batches.

**Cron jobs (node-cron):**
- Daily 03:00 local: tombstone sweep.
- On boot: per-folder reconciliation — walk disk, diff against `knowledge_files` by mtime+size, enqueue diffs. Handles "Aria was off while user edited files."

**powerMonitor:** suspend watcher + queue on sleep; on wake, run reconciliation before re-enabling watch.

**Failure isolation:** parser/embed errors are per-file. `knowledge_files.status='error'` + `last_error` populated. Folder stays healthy. UI shows per-folder error count with an expander listing failures.

## 7. Sensitivity Gate

1. Retrieval is unchanged — sensitive-folder chunks are eligible RRF matches.
2. Pre-LLM gate (additive to existing PII gate): if **any** chunk in the retrieval set has a `corpus='folder'` row whose `knowledge_folders.sensitivity = 'sensitive'`, the entire answer is routed local-only. One sensitive chunk taints the batch.
3. UI: forced-local answers show the existing local-only lock badge from Phase 3 with hover text `"Answered locally — sensitive folder source"`.
4. Citations render normally for sensitive folders — file path is not hidden, only routing changes.
5. **Edge case:** sensitivity flip mid-flight does not interrupt an in-flight frontier answer; next query respects the new flag. Documented behavior.

## 8. IPC Surface

```
aria:knowledge:list-folders        → KnowledgeFolder[]
aria:knowledge:add-folder          ({ label, rootPath, sensitivity }) → KnowledgeFolder
aria:knowledge:update-folder       ({ id, label?, sensitivity?, enabled? }) → KnowledgeFolder
aria:knowledge:remove-folder       ({ id }) → { ok: true }   // cascade
aria:knowledge:reindex-folder      ({ id }) → { queued: number }
aria:knowledge:folder-stats        ({ id }) → { fileCount, chunkCount,
                                                lastIndexedAt, errorCount,
                                                bytesIndexed }
aria:knowledge:list-failures       ({ id }) → KnowledgeFile[]
aria:knowledge:pick-folder         () → { rootPath } | { cancelled: true }

aria:knowledge:progress (push)     → { folderId, phase: 'scan'|'parse'|'embed',
                                       done, total }  // ~500ms debounce
```

## 9. Renderer

New: `src/renderer/features/settings/KnowledgeFoldersSection.tsx`, routed from Settings alongside `IntegrationsSection` and `RagIndexSection`. Editorial pattern (stat card + action cards, gold left-border accents) matching the Backup/Updates/Integrations redesigns.

- **Stats strip:** total folders, total files indexed, total chunks, disk footprint estimate.
- **Folder cards:** label, middle-truncated path, file count, last-indexed timestamp, sensitivity chip (`General` / `Sensitive` with lock glyph), enabled toggle, kebab menu (Reindex / Rename / Change sensitivity / Remove).
- **Add folder:** primary button → `aria:knowledge:pick-folder` (native dialog) → inline form for label + sensitivity (default General).
- **Failure expander:** if `errorCount > 0`, disclosure lists relative paths + reasons.
- **Remove confirm dialog:** destructive-action pattern enforced across all destructive surfaces in Phase 7 UAT.

`/ask` UI is unchanged. Folder citations render through the existing citation component with an extension-keyed icon mapping.

## 10. Testing

**Unit (Vitest):**
- Each parser: golden-file fixtures in `tests/fixtures/knowledge/`, assert text + section locators.
- Chunk identity stability: same content → same ids; one-byte change → only affected ids change.
- Tombstone resurrection: parse → tombstone → re-parse identical content within 24h → no new embeddings, tombstone cleared, path updated.
- Size-limit handling: 50MB+ skipped, 5MB+ extracted truncated, folder remains healthy.
- Sensitivity gate: mixed retrieval set forces local-only; pure-general permits frontier; sensitivity flip updates routing on next query.

**Integration (Vitest, real SQLite):**
- Add folder → scan → embed → `/ask` round-trip against a fixture folder; assert citations carry `{file_path, locator}`.
- Remove folder cascades: `knowledge_files` and their `chunks` deleted.
- Boot reconciliation: mutate fixture folder while service is "off", boot, assert diff is detected and re-embedded.

**E2E (Playwright `_electron`):**
- Settings → Knowledge Folders → Add → pick fixture → file count climbs → `/ask` query → folder citation in answer card → flip to Sensitive → re-query → lock badge.
- Confirm-dialog gate on Remove.

**Skipped for v1:**
- Chokidar event timing tests (flaky; covered indirectly by boot reconciliation).
- Cross-OS path normalization tests (dogfooding catches Windows quirks).

## 11. Dependencies Added

| Package | Purpose | Approx size |
|---|---|---|
| `chokidar` | filesystem watch | already in stack candidates |
| `papaparse` | CSV | ~40 KB |
| `mammoth` | docx → text | ~500 KB |
| `exceljs` | xlsx → text | ~900 KB |
| `pdfjs-dist` (legacy build) | pdf → text | ~2 MB |

No new native modules. All pure-JS — no electron-rebuild risk.

## 12. Rollout Order (anticipates the planning split)

1. Schema migration + `FolderRegistry` + IPC stubs.
2. Parsers behind a registry, with golden-file tests.
3. `FileScanner` + `ChunkStore` integration; one-shot indexing (no watch yet).
4. Sensitivity gate wiring into existing `/ask` pipeline.
5. Watcher + tombstones + resurrection + cron sweep + boot reconciliation + powerMonitor.
6. `KnowledgeFoldersSection` UI + confirm dialog + progress channel.
7. E2E walkthrough + UAT.

## 13. Open Questions

None blocking. Items intentionally deferred are listed in §2 Non-Goals.
