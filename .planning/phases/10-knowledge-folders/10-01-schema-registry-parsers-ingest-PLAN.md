---
phase: 10-knowledge-folders
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/db/migrations/132_knowledge_folders.sql
  - src/main/services/folder-ingestion/FolderRegistry.ts
  - src/main/services/folder-ingestion/parsers/index.ts
  - src/main/services/folder-ingestion/parsers/text.ts
  - src/main/services/folder-ingestion/parsers/markdown.ts
  - src/main/services/folder-ingestion/parsers/csv.ts
  - src/main/services/folder-ingestion/parsers/docx.ts
  - src/main/services/folder-ingestion/parsers/xlsx.ts
  - src/main/services/folder-ingestion/parsers/pdf.ts
  - src/main/services/folder-ingestion/FileScanner.ts
  - src/main/services/folder-ingestion/ChunkStore.ts
  - src/main/services/folder-ingestion/FolderIngestionService.ts
  - src/main/services/folder-ingestion/types.ts
  - src/main/ipc/knowledge.ts
  - src/main/ipc/index.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
  - package.json
  - tests/fixtures/knowledge/
  - src/main/services/folder-ingestion/__tests__/parsers.test.ts
  - src/main/services/folder-ingestion/__tests__/scanner.test.ts
  - src/main/services/folder-ingestion/__tests__/chunkstore.test.ts
  - src/main/services/folder-ingestion/__tests__/registry.test.ts
autonomous: true
requirements:
  - SPEC-§3-architecture
  - SPEC-§4-schema
  - SPEC-§5-parsers
  - SPEC-§8-ipc (registry + prescan + reindex + stats + list-failures + pick-folder)
  - SPEC-§11-dependencies

must_haves:
  truths:
    - "User can register a folder via IPC and a knowledge_folders row exists"
    - "Scanning a folder produces knowledge_files rows + chunks rows with corpus='folder', folder_id, file_id populated"
    - "Re-indexing an unchanged file is a no-op (same chunk ids)"
    - "Per-file parser failure marks status='error' but folder remains healthy"
    - "Pre-scan IPC returns file count + byte total without writing to DB"
    - "folder-stats returns bytesIndexed = SUM(knowledge_files.size)"
  artifacts:
    - path: "src/main/db/migrations/132_knowledge_folders.sql"
      provides: "knowledge_folders + knowledge_files tables, ALTER chunks folder_id/file_id, idx_chunks_file_id, idx_knowledge_files_tombstone"
      contains: "ALTER TABLE chunks"
    - path: "src/main/services/folder-ingestion/FolderRegistry.ts"
      provides: "CRUD over knowledge_folders rows; ulid id generation"
    - path: "src/main/services/folder-ingestion/parsers/index.ts"
      provides: "registry: ext → ParsedDocument parser"
    - path: "src/main/services/folder-ingestion/FileScanner.ts"
      provides: "walks root, applies exclude globs, returns {relativePath, mtime, size} list; also exposes countOnly() for pre-scan"
    - path: "src/main/services/folder-ingestion/ChunkStore.ts"
      provides: "writeChunks(fileId, parsed) — reuses Phase 7 chunker+embedder; chunk id = sha256(file_id||chunk_index||content_hash); single-tx per file"
    - path: "src/main/ipc/knowledge.ts"
      provides: "all aria:knowledge:* handlers (list/add/update/remove/reindex/folder-stats/list-failures/pick-folder/prescan-folder)"
  key_links:
    - from: "ChunkStore"
      to: "src/main/services/rag/ (Phase 7 chunker + embedder + vector store)"
      via: "direct import — no parallel pipeline"
      pattern: "import.*services/rag"
    - from: "knowledge_files.id"
      to: "chunks.file_id"
      via: "FK reference (logical; cascade handled by remove-folder IPC tx)"
      pattern: "file_id"
    - from: "aria:knowledge:folder-stats"
      to: "SUM(knowledge_files.size)"
      via: "SQL aggregate"
      pattern: "SUM\\(.*size"
---

<objective>
Establish the schema, registry, parser layer, one-shot ingestion pipeline, and full IPC surface for Knowledge Folders. After this plan a user (via IPC) can register a folder, trigger an indexing run, and the chunks table is populated with `corpus='folder'` rows that are immediately retrievable by Phase 7 RAG. No watcher yet, no sensitivity-gate change yet, no UI yet.

Purpose: deliver the foundation that the next two plans plug into without ambiguity.
Output: migration 132, folder-ingestion service tree, IPC handlers, preload bridge, parser golden tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/10-knowledge-folders/10-CONTEXT.md
@docs/superpowers/specs/2026-05-21-knowledge-folders-design.md
@.planning/phases/07-rag-qa/07-CONTEXT.md
@src/main/db/migrations/126_rag_index.sql
@src/main/db/migrations/127_rag_source_dirty_dedupe.sql
@src/main/db/migrations/131_entitlement.sql
@src/main/db/migrations/runner.ts
@src/main/services/rag/
@src/main/ipc/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration 132 + FolderRegistry + golden fixtures</name>
  <files>
    src/main/db/migrations/132_knowledge_folders.sql,
    src/main/services/folder-ingestion/types.ts,
    src/main/services/folder-ingestion/FolderRegistry.ts,
    src/main/services/folder-ingestion/__tests__/registry.test.ts,
    tests/fixtures/knowledge/ (hello.txt, notes.md, rows.csv, sample.docx, sample.xlsx, sample.pdf),
    package.json
  </files>
  <read_first>
    src/main/db/migrations/126_rag_index.sql,
    src/main/db/migrations/127_rag_source_dirty_dedupe.sql,
    src/main/db/migrations/131_entitlement.sql,
    src/main/db/migrations/runner.ts,
    .planning/phases/10-knowledge-folders/10-CONTEXT.md (§decisions),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§4 verbatim)
  </read_first>
  <action>
    Author migration 132 implementing spec §4 verbatim: CREATE TABLE knowledge_folders + knowledge_files (with CHECK constraints exactly as in §4), ALTER chunks ADD COLUMN folder_id TEXT, ALTER chunks ADD COLUMN file_id TEXT, CREATE INDEX idx_chunks_file_id ON chunks(file_id) WHERE file_id IS NOT NULL, CREATE INDEX idx_knowledge_files_tombstone as specced. Do NOT use CREATE TABLE IF NOT EXISTS on chunks. Grep the existing chunks schema (from 126_rag_index.sql) before drafting the ALTER to confirm no naming collision. Verify the migration runner picks up 132 (numeric order). Define TypeScript types KnowledgeFolder, KnowledgeFile, ParsedDocument, Section, Parser in types.ts (shapes per spec §5 + §8). Implement FolderRegistry with methods: list(), addFolder({label, rootPath, sensitivity}), updateFolder({id, label?, sensitivity?, enabled?}), removeFolder({id}) — removeFolder performs DELETE FROM chunks WHERE folder_id=?; DELETE FROM knowledge_files WHERE folder_id=?; DELETE FROM knowledge_folders WHERE id=? inside a single better-sqlite3 transaction (per CONTEXT.md anti-pattern: no partial removal). Use ulid for ids. Add deps to package.json: chokidar, papaparse, mammoth, exceljs, pdfjs-dist (legacy build via 'pdfjs-dist/legacy/build/pdf.mjs'). Create tests/fixtures/knowledge/ with the six fixture files (minimal but real — a real one-page PDF, a one-sheet xlsx, etc.; commit the binaries). Write registry.test.ts: add → list returns row; remove → cascades to mocked chunks/files rows; update preserves immutable fields (id, root_path, created_at).
  </action>
  <verify>
    <automated>npm run build:main && npx vitest run src/main/services/folder-ingestion/__tests__/registry.test.ts</automated>
  </verify>
  <done>
    Migration applies on a fresh DB; knowledge_folders + knowledge_files exist; chunks has folder_id + file_id columns; FolderRegistry CRUD tests pass; remove uses a single transaction; fixture folder committed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Parser registry + golden-file tests</name>
  <files>
    src/main/services/folder-ingestion/parsers/index.ts,
    src/main/services/folder-ingestion/parsers/text.ts,
    src/main/services/folder-ingestion/parsers/markdown.ts,
    src/main/services/folder-ingestion/parsers/csv.ts,
    src/main/services/folder-ingestion/parsers/docx.ts,
    src/main/services/folder-ingestion/parsers/xlsx.ts,
    src/main/services/folder-ingestion/parsers/pdf.ts,
    src/main/services/folder-ingestion/__tests__/parsers.test.ts
  </files>
  <read_first>
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§5),
    tests/fixtures/knowledge/ (from Task 1)
  </read_first>
  <behavior>
    - text/markdown parser: reads via fs.readFile; markdown derives Section[] from h1..h6 with locator 'h{level}:{heading}'
    - csv parser (papaparse): ~50-row sections, header row preserved per section, locator 'rows:1-50'
    - docx parser (mammoth): heading runs → sections with locator 'h2:{heading}' style
    - xlsx parser (exceljs): one Section per sheet, TSV-rendered; locator 'sheet:{name}'; skip sheets whose rendered size > 5MB (record metadata note, do not throw)
    - pdf parser (pdfjs-dist legacy): page-level Section[]; locator 'p.{n}'; if a page has >0 bytes but <100 chars extracted text → set parser-level error 'likely_scanned_no_ocr' and skip the page (do not fail the file)
    - Hard limits: file > 50MB → throw a typed Skip error caller treats as last_error; extracted text > 5MB → truncate + emit warning
    - Unknown extension via parsers.index → returns null (silently ignored upstream)
  </behavior>
  <action>
    Implement each parser to return ParsedDocument per spec §5. Build parsers/index.ts as a registry: `getParser(ext: string): Parser | null` mapping the 6 extensions; everything else returns null. Each parser is async and exception-safe — internal failures throw typed errors; never crash the host. Write parsers.test.ts with one test per fixture from tests/fixtures/knowledge/: assert text contains a known token, Section[] non-empty with expected locator format. Add a test for the 50MB skip path (mock a Stat returning size > limit). Add a test for unknown-ext returning null.
  </action>
  <verify>
    <automated>npx vitest run src/main/services/folder-ingestion/__tests__/parsers.test.ts</automated>
  </verify>
  <done>
    All 6 parsers produce ParsedDocument with correct text + section locators against fixtures; size-limit + unknown-ext paths covered; tests pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: FileScanner + ChunkStore + FolderIngestionService (one-shot indexing)</name>
  <files>
    src/main/services/folder-ingestion/FileScanner.ts,
    src/main/services/folder-ingestion/ChunkStore.ts,
    src/main/services/folder-ingestion/FolderIngestionService.ts,
    src/main/services/folder-ingestion/__tests__/scanner.test.ts,
    src/main/services/folder-ingestion/__tests__/chunkstore.test.ts
  </files>
  <read_first>
    src/main/services/rag/ (chunker, embedder, vector store entry points — grep exports),
    src/main/services/folder-ingestion/parsers/index.ts (from Task 2),
    src/main/services/folder-ingestion/FolderRegistry.ts (from Task 1),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§3 + §5 + §6 backpressure)
  </read_first>
  <behavior>
    - FileScanner.scan(rootPath, {countOnly?: boolean}): walks tree; applies exclude globs (node_modules, .git, .DS_Store, dist, build, out, *~, .#*); for countOnly=true returns {fileCount, totalBytes} without parsing/hashing; for countOnly=false returns FileEntry[] = {relativePath, absolutePath, mtime, size, ext}
    - FileScanner.scan yields in batches of 500 entries for >10k-file folders (async iterator preferred)
    - ChunkStore.indexFile(folder, fileEntry): parse via parser registry; if null → skip; compute content_hash = sha256(extracted text); if knowledge_files row exists with same content_hash → no-op return 'unchanged'; else parse → chunker (Phase 7) → embedder (Phase 7) → write chunks with id = sha256(file_id || chunk_index || content_hash), corpus='folder', folder_id, file_id; upsert knowledge_files row inside a single transaction (delete old chunks WHERE file_id=? + insert new + upsert file row)
    - On parser/embed throw: catch, write knowledge_files row with status='error', last_error=err.message; do NOT propagate; folder stays healthy
    - FolderIngestionService.indexFolder(folderId): orchestrates scan + p-queue concurrency 2; updates knowledge_folders.last_indexed_at on completion; emits no events yet (progress channel comes in Plan 02 wiring)
    - Re-indexing same content → no new chunks, chunk ids stable
    - Removing a folder (via FolderRegistry.removeFolder) deletes its chunks rows (already covered Task 1 — re-assert via integration test)
  </behavior>
  <action>
    Implement FileScanner with exclude globs as a constant array; expose countOnly variant for the pre-scan IPC. Implement ChunkStore.indexFile against the existing Phase 7 chunker + embedder — import directly from src/main/services/rag; do NOT duplicate. Use one better-sqlite3 transaction per file. Implement FolderIngestionService as a thin orchestrator with p-queue (concurrency 2). Write scanner.test.ts: fixture folder walk returns expected count + bytes; exclude globs honored; countOnly skips hashing. Write chunkstore.test.ts: index fixture folder against an in-memory SQLite (post-132 migration); assert chunks rows have corpus='folder' + folder_id + file_id; re-index same file → no new rows + same chunk ids; corrupt one fixture parser (mock throw) → file row status='error', other files succeed; remove folder → chunks for that folder gone.
  </action>
  <acceptance_criteria>
    - `grep -rn "from.*services/rag" src/main/services/folder-ingestion/ChunkStore.ts` returns at least one match (no parallel chunker)
    - chunkstore.test.ts asserts `SELECT COUNT(*) FROM chunks WHERE corpus='folder'` > 0 after indexFolder
    - Re-index assertion: chunk ids returned from first index == chunk ids after second index for unchanged files
    - Error-isolation assertion: with one fixture forced to throw, `SELECT COUNT(*) FROM knowledge_files WHERE status='indexed'` == (fixtures-1) AND `SELECT COUNT(*) FROM knowledge_files WHERE status='error'` == 1
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/main/services/folder-ingestion/__tests__/scanner.test.ts src/main/services/folder-ingestion/__tests__/chunkstore.test.ts</automated>
  </verify>
  <done>
    One-shot indexing of fixture folder writes chunks with corpus='folder'; re-index is no-op; per-file failure isolation works; folder removal cascades.
  </done>
</task>

<task type="auto">
  <name>Task 4: IPC surface + preload bridge (full §8 surface, incl. prescan)</name>
  <files>
    src/main/ipc/knowledge.ts,
    src/main/ipc/index.ts,
    src/preload/index.ts,
    src/preload/index.d.ts
  </files>
  <read_first>
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§8 channel list verbatim),
    .planning/phases/10-knowledge-folders/10-CONTEXT.md (decision 3 pre-scan, decision 2 bytesIndexed),
    src/main/ipc/index.ts (registration pattern),
    src/preload/index.ts (existing bridge shape)
  </read_first>
  <action>
    Register the following ipcMain.handle channels in src/main/ipc/knowledge.ts and wire registration into src/main/ipc/index.ts (mirroring existing patterns — e.g., backup.ts):
      • aria:knowledge:list-folders → FolderRegistry.list()
      • aria:knowledge:add-folder ({label, rootPath, sensitivity}) → FolderRegistry.addFolder
      • aria:knowledge:update-folder ({id, label?, sensitivity?, enabled?}) → FolderRegistry.updateFolder
      • aria:knowledge:remove-folder ({id}) → FolderRegistry.removeFolder; return {ok:true}
      • aria:knowledge:reindex-folder ({id}) → enqueues FolderIngestionService.indexFolder; return {queued:fileCount}
      • aria:knowledge:folder-stats ({id}) → returns {fileCount, chunkCount, lastIndexedAt, errorCount, bytesIndexed}; bytesIndexed MUST be implemented as `SELECT COALESCE(SUM(size), 0) FROM knowledge_files WHERE folder_id = ? AND status='indexed'` (per CONTEXT.md decision 2)
      • aria:knowledge:list-failures ({id}) → SELECT * FROM knowledge_files WHERE folder_id=? AND status='error'
      • aria:knowledge:pick-folder () → dialog.showOpenDialog({properties:['openDirectory']}); returns {rootPath} or {cancelled:true}
      • aria:knowledge:prescan-folder ({rootPath}) → FileScanner.scan(rootPath, {countOnly:true}); returns {fileCount, totalBytes, exceedsThreshold: fileCount>5000 || totalBytes>2*1024*1024*1024} (CONTEXT.md decision 3 — no DB write)
      • aria:knowledge:progress (push) → declare the channel name as a constant; emission is wired in Plan 02 (watcher) but the constant + preload typing land here so the renderer can subscribe
    Extend preload/index.ts to expose `window.aria.knowledge` namespace with typed methods for every channel above + `onProgress(handler)` subscription. Update preload/index.d.ts. The reindex handler must NOT block — return {queued} immediately; service runs in background via p-queue.
  </action>
  <acceptance_criteria>
    - `grep -c "aria:knowledge:" src/main/ipc/knowledge.ts` returns at least 10 (9 request/response + 1 progress constant)
    - `grep -n "SUM(size)" src/main/ipc/knowledge.ts` matches (bytesIndexed implementation)
    - `grep -n "knowledge" src/preload/index.ts` matches; type augmentation present in index.d.ts
    - `npm run build:main && npm run build:preload` succeed
  </acceptance_criteria>
  <verify>
    <automated>npm run build:main && npm run build:preload && npm run typecheck</automated>
  </verify>
  <done>
    All 9 request/response channels + the progress channel constant are registered; preload exposes typed `window.aria.knowledge`; build + typecheck pass.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → main IPC | folder path strings, label, sensitivity flag — must be validated |
| filesystem → parser | untrusted file contents; malformed pdf/docx/xlsx must not crash main |
| local DB → renderer | folder paths returned in citations are user-owned but still strings — render as text, never as HTML |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-01 | Tampering | knowledge_folders.root_path | mitigate | Validate path is absolute + existsSync in add-folder handler before insert |
| T-10-02 | Denial of Service | parsers (pdfjs/exceljs/mammoth) | mitigate | 50MB file skip + 5MB text truncate; per-file try/catch isolates failure; size check uses Stat before read |
| T-10-03 | Information Disclosure | citations rendering folder paths | accept | User owns paths; lock badge surfaces sensitive routing; no cross-account leakage |
| T-10-04 | Tampering | remove-folder cascade | mitigate | Single better-sqlite3 transaction wraps delete chunks + delete files + delete folder (no partial state) |
| T-10-05 | Elevation of Privilege | sensitivity flag CHECK constraint | mitigate | SQL CHECK + zod validate in update-folder handler before write |
</threat_model>

<verification>
- Migration 132 applies cleanly on a fresh DB and is idempotent under the runner
- All 4 task vitest suites green
- `npm run build` + `npm run typecheck` succeed
- `grep -n "corpus='folder'" src/main/services/folder-ingestion/ChunkStore.ts` matches (chunks tagged at write site)
- `grep -n "SUM(size)" src/main/ipc/knowledge.ts` matches (bytesIndexed per CONTEXT.md decision 2)
- Folder chunks NOT added to Phase 8 14d hard gate: `grep -rn "corpus.*=.*folder" src/main/services/phase8/` (or equivalent insights signal counter) returns no match
</verification>

<success_criteria>
- A user can call `window.aria.knowledge.addFolder(...)` followed by `reindexFolder(...)`, and `SELECT COUNT(*) FROM chunks WHERE corpus='folder' AND folder_id=?` is > 0
- `prescan-folder` returns correct counts without writing to DB
- `folder-stats` returns bytesIndexed equal to `SUM(knowledge_files.size)` for that folder
- Per-file parser errors are isolated to that file's `knowledge_files.status='error'` row
- Removing a folder cascades atomically: 0 rows left in any of the 3 tables for that folder_id
</success_criteria>

<output>
After completion: `.planning/phases/10-knowledge-folders/10-01-SUMMARY.md`
</output>
