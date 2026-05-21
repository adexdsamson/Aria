---
phase: 10-knowledge-folders
plan: 02
type: execute
wave: 2
depends_on: [10-01]
files_modified:
  - src/main/services/sensitivity-router/ (extend existing gate — exact file from read_first)
  - src/main/services/folder-ingestion/Watcher.ts
  - src/main/services/folder-ingestion/FolderIngestionService.ts
  - src/main/services/folder-ingestion/cron.ts
  - src/main/services/folder-ingestion/reconciler.ts
  - src/main/ipc/knowledge.ts
  - src/main/index.ts
  - src/main/services/folder-ingestion/__tests__/sensitivity-gate.test.ts
  - src/main/services/folder-ingestion/__tests__/watcher.test.ts
  - src/main/services/folder-ingestion/__tests__/tombstone-resurrection.test.ts
  - src/main/services/folder-ingestion/__tests__/reconciler.test.ts
autonomous: true
requirements:
  - SPEC-§6-watcher-lifecycle
  - SPEC-§7-sensitivity-gate
  - SPEC-§8-progress-channel
  - SPEC-§10-testing

must_haves:
  truths:
    - "An /ask turn that retrieves any chunk linked to a sensitive folder is routed local-only with the Phase 3 lock badge"
    - "Per-turn taint does not carry across turns — a follow-up turn with only general sources re-enables frontier"
    - "Editing a watched file triggers re-parse + re-embed within ~2s of write completion"
    - "Deleting a file marks it tombstoned; chunks remain searchable until sweep"
    - "Renaming a file with identical content to a tombstoned row within 24h resurrects without re-embedding"
    - "Daily 03:00 sweep removes tombstones older than 24h and cascades to chunks via file_id"
    - "Boot reconciliation detects edits made while Aria was off and enqueues diffs"
    - "powerMonitor suspend/resume pauses + reconciles the watcher across sleep cycles"
    - "Folder chunks participate in the existing Phase 7 model-swap reconciler (no new code)"
  artifacts:
    - path: "src/main/services/folder-ingestion/Watcher.ts"
      provides: "chokidar lifecycle, p-queue concurrency 2, debounced progress emission, awaitWriteFinish config"
    - path: "src/main/services/folder-ingestion/reconciler.ts"
      provides: "boot + post-wake folder reconciliation (mtime/size diff against knowledge_files)"
    - path: "src/main/services/folder-ingestion/cron.ts"
      provides: "node-cron daily 03:00 tombstone sweep"
  key_links:
    - from: "/ask retrieval-set evaluation"
      to: "knowledge_folders.sensitivity"
      via: "JOIN chunks → knowledge_folders via folder_id, gate consults per-turn"
      pattern: "knowledge_folders.*sensitivity"
    - from: "chokidar 'unlink' event"
      to: "knowledge_files.status='tombstoned'"
      via: "Watcher handler"
      pattern: "tombstoned"
    - from: "Watcher 'add' with hash matching tombstoned row"
      to: "resurrect path"
      via: "ChunkStore.resurrectFile"
      pattern: "resurrect"
---

<objective>
Wire Phase 10 ingestion into Aria's live runtime: the sensitivity gate consults folder rows additively per turn, the chokidar watcher reflects on-disk changes into the index, tombstone + resurrection logic preserves token cost on renames, and cron + powerMonitor + boot reconciliation keep the index honest. Plan 10-03 will hang the UI off the IPC + progress channel landed here.

Purpose: make Knowledge Folders behave like a live system, with the sensitivity story locked.
Output: extended sensitivity router, Watcher service, cron, reconciler, progress emission, exhaustive sensitivity + lifecycle tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-knowledge-folders/10-CONTEXT.md
@docs/superpowers/specs/2026-05-21-knowledge-folders-design.md
@.planning/phases/03-approval-queue/03-CONTEXT.md
@.planning/phases/07-rag-qa/07-CONTEXT.md
@.planning/phases/08-insights-recap-learning-release/08-CONTEXT.md
@.planning/phases/10-knowledge-folders/10-01-schema-registry-parsers-ingest-PLAN.md
@src/main/services/sensitivity-router/
@src/main/services/rag/
@src/main/index.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend sensitivity router for per-turn folder taint</name>
  <files>
    src/main/services/sensitivity-router/ (exact file determined by read_first grep),
    src/main/services/folder-ingestion/__tests__/sensitivity-gate.test.ts
  </files>
  <read_first>
    src/main/services/sensitivity-router/ (grep for the existing pre-LLM gate function — it returns route='local'|'frontier' given a retrieval set + content),
    .planning/phases/03-approval-queue/03-CONTEXT.md,
    .planning/phases/10-knowledge-folders/10-CONTEXT.md (§decisions item 4 + sensitivity gate test contract),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§7)
  </read_first>
  <behavior>
    Five test cases from CONTEXT.md sensitivity gate test contract, asserted as discrete tests:
    1. Pure sensitive: retrieval set with only chunks linking to knowledge_folders.sensitivity='sensitive' → route='local', lockBadge=true, hoverText='Answered locally — sensitive folder source'
    2. Pure general: retrieval set with only chunks linking to sensitivity='general' (or no folder chunks) → route may be 'frontier', no lock badge from this gate (existing PII gate may still trigger independently)
    3. Hybrid: one sensitive folder chunk + many email/meeting/general chunks → route='local', lockBadge=true
    4. Multi-turn no-stickiness: invoke gate with sensitive set then again with general set → first call local, second call frontier-eligible (no internal state carried)
    5. In-flight flip: simulate sensitivity update between gate-evaluation and LLM-dispatch boundary — assert the gate function is pure over its inputs (does not re-read DB mid-call); document via test naming
  </behavior>
  <action>
    Extend the existing pre-LLM gate (do NOT duplicate). Add an additive check: SELECT folder_id FROM chunks WHERE id IN (?...) AND folder_id IS NOT NULL; if any row joins to knowledge_folders.sensitivity='sensitive', the gate returns route='local' with reason='sensitive-folder' and badge text per spec §7.3. This check runs ALONGSIDE the existing PII gate — either is sufficient to force local. The gate is a pure function over (retrievalSet, query); no internal taint state across calls. Citations are unchanged (rendered normally even when sensitive). Write sensitivity-gate.test.ts covering the 5 cases above using an in-memory SQLite with seeded knowledge_folders + chunks rows.
  </action>
  <acceptance_criteria>
    - `grep -rn "sensitive-folder" src/main/services/sensitivity-router/` matches (new reason code present)
    - The gate file contains exactly one SELECT against knowledge_folders.sensitivity (no duplicate code paths)
    - All 5 sensitivity-gate.test.ts cases pass
    - No new code in any Phase 7 reconciler — `git diff src/main/services/rag/` shows no changes in this plan
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/main/services/folder-ingestion/__tests__/sensitivity-gate.test.ts</automated>
  </verify>
  <done>
    The 5-case sensitivity gate test contract is green; gate is pure per-turn; no duplicate gate code.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Watcher + tombstones + resurrection + progress emission</name>
  <files>
    src/main/services/folder-ingestion/Watcher.ts,
    src/main/services/folder-ingestion/FolderIngestionService.ts,
    src/main/services/folder-ingestion/__tests__/watcher.test.ts,
    src/main/services/folder-ingestion/__tests__/tombstone-resurrection.test.ts
  </files>
  <read_first>
    src/main/services/folder-ingestion/FolderIngestionService.ts (from 10-01),
    src/main/services/folder-ingestion/ChunkStore.ts (from 10-01),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§6 verbatim),
    src/main/ipc/knowledge.ts (progress channel constant from 10-01)
  </read_first>
  <behavior>
    - One chokidar instance per enabled folder; config exactly: { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 } }
    - 'add' / 'change' → enqueue parse+embed via existing p-queue (concurrency 2)
    - 'unlink' → UPDATE knowledge_files SET status='tombstoned', tombstoned_at=? WHERE id=?; chunks remain in table
    - Resurrection: on 'add', compute content_hash first; if a tombstoned knowledge_files row in the same folder has matching content_hash AND tombstoned_at > now-24h → UPDATE row SET status='indexed', relative_path=?, tombstoned_at=NULL, last_error=NULL; DO NOT re-chunk or re-embed
    - Disabling a folder (enabled=0 via update-folder IPC) tears down its chokidar instance; enabling re-creates it after running reconciliation
    - Progress: debounce to ~500ms; emit { folderId, phase: 'scan'|'parse'|'embed', done, total } to the progress channel constant from 10-01
    - Watcher gracefully handles being closed mid-scan
  </behavior>
  <action>
    Implement Watcher.ts with start(folder)/stop(folderId)/stopAll() lifecycle. Extend FolderIngestionService to own a Map<folderId, Watcher> and wire watcher events into the existing indexFile / tombstone / resurrect code path. Add ChunkStore.tombstoneFile(fileId), ChunkStore.resurrectFile(fileId, newRelativePath) helpers if not already present from 10-01. Debounce progress via a small per-folder accumulator flushed on a 500ms timer. Tests: watcher.test.ts uses a temp directory + chokidar (real, but with a short stabilityThreshold via DI override) to assert add/change/unlink flow into expected DB rows; tombstone-resurrection.test.ts seeds a tombstoned row, simulates a re-add with matching content_hash within 24h, asserts no new chunks were written and the row was resurrected (status='indexed', tombstoned_at IS NULL).
  </action>
  <acceptance_criteria>
    - `grep -n "stabilityThreshold: 1500" src/main/services/folder-ingestion/Watcher.ts` matches (spec §6 verbatim)
    - `grep -n "ignoreInitial: true" src/main/services/folder-ingestion/Watcher.ts` matches
    - Resurrection test asserts `SELECT COUNT(*) FROM chunks WHERE file_id=?` is unchanged before vs. after re-add
    - Progress emission debounced — test asserts at most ceil(N/500ms) events for N file-parse events within 1s
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/main/services/folder-ingestion/__tests__/watcher.test.ts src/main/services/folder-ingestion/__tests__/tombstone-resurrection.test.ts</automated>
  </verify>
  <done>
    Live add/change/unlink update DB correctly; tombstone + 24h resurrection works without re-embedding; progress events debounced.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Cron sweep + boot reconciler + powerMonitor + Phase 7 reconciler integration check</name>
  <files>
    src/main/services/folder-ingestion/cron.ts,
    src/main/services/folder-ingestion/reconciler.ts,
    src/main/services/folder-ingestion/FolderIngestionService.ts,
    src/main/index.ts,
    src/main/services/folder-ingestion/__tests__/reconciler.test.ts
  </files>
  <read_first>
    src/main/services/folder-ingestion/Watcher.ts (from Task 2),
    src/main/services/folder-ingestion/FolderIngestionService.ts (from Task 2),
    src/main/index.ts (existing node-cron + powerMonitor wiring from Phase 1 — grep 'powerMonitor' and 'node-cron'),
    src/main/services/rag/ (Phase 7 model-swap reconciler entry point — grep 'reconcile' or 'modelSwap'),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§6 cron + powerMonitor),
    .planning/phases/10-knowledge-folders/10-CONTEXT.md (decision 1 — embed-model swap reuses Phase 7 reconciler)
  </read_first>
  <behavior>
    - Daily 03:00 local cron via node-cron: DELETE FROM knowledge_files WHERE status='tombstoned' AND tombstoned_at < now-24h; relies on CASCADE via file_id link OR explicit DELETE FROM chunks WHERE file_id IN (...) within the same transaction
    - On app boot (after DB unlock): for each enabled folder, run reconciler — walk disk, build a {relativePath → {mtime,size}} map, diff against knowledge_files, enqueue: new files → indexFile; modified files (mtime or size changed) → indexFile; missing files → tombstone
    - powerMonitor 'suspend' → FolderIngestionService.pause() (stop all chokidar watchers, pause p-queue); 'resume' → run reconciler per folder, then restart watchers
    - Phase 7 model-swap reconciler integration: VERIFY folder chunks participate without new code. Add an integration test that seeds chunks with corpus='folder' alongside corpus='email' rows, triggers the existing Phase 7 reconciler, and asserts both corpora are re-embedded from chunks.content (no disk re-walk). NO new code in src/main/services/rag/.
  </behavior>
  <action>
    Implement cron.ts exporting registerCron(service) — uses node-cron '0 3 * * *' to run sweep inside a transaction. Implement reconciler.ts exporting reconcileFolder(folder, service) and reconcileAll(service). Wire into src/main/index.ts: after DB unlock, call reconcileAll then start watchers; register cron; register powerMonitor 'suspend' / 'resume' handlers. Write reconciler.test.ts covering: (a) tombstone sweep deletes >24h tombstoned rows + cascades chunks; (b) boot reconciliation detects on-disk add/edit/delete made while service was off; (c) the Phase 7 model-swap reconciler integration assertion above. Folder chunks are NOT added to Phase 8's 14d hard gate — explicitly assert by grepping the gate file for `corpus = 'folder'` and confirming no match.
  </action>
  <acceptance_criteria>
    - `grep -n "0 3 \* \* \*" src/main/services/folder-ingestion/cron.ts` matches (daily 03:00)
    - `grep -n "powerMonitor" src/main/index.ts` matches near folder-ingestion registration
    - `git diff src/main/services/rag/` shows zero changes for this plan (Phase 7 reconciler unchanged)
    - reconciler.test.ts case (c) passes — folder chunks re-embedded by existing reconciler
    - Phase 8 hard gate assertion: `grep -rn "corpus.*'folder'" src/main/services/phase8/` (or wherever the 14d gate signal counter lives — locate via read of 08-CONTEXT.md) returns no match
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/main/services/folder-ingestion/__tests__/reconciler.test.ts && npm run build:main</automated>
  </verify>
  <done>
    Sweep deletes stale tombstones nightly; boot reconciler catches off-time edits; powerMonitor pauses/resumes watcher cleanly; folder chunks ride the existing Phase 7 model-swap reconciler with zero new code; Phase 8 14d gate untouched.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LLM router → frontier API | sensitive-folder content must never cross |
| chokidar → main process | filesystem events may be high-volume; rate-limit via p-queue + debounce |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-06 | Information Disclosure | sensitivity gate bypass | mitigate | Per-turn gate is pure function; 5 test cases enforce taint semantics; gate runs additive to existing PII gate |
| T-10-07 | DoS | watcher event storm | mitigate | awaitWriteFinish collapses atomic writes; p-queue concurrency 2; debounced progress |
| T-10-08 | Tampering | tombstone sweep skipping live data | mitigate | WHERE status='tombstoned' AND tombstoned_at < now-24h; cron runs inside transaction; reconciler.test.ts asserts no live-row deletion |
| T-10-09 | Repudiation | mid-flight sensitivity flip | accept | Documented per spec §7.5 — gate is per-turn pure; in-flight call not interrupted |
</threat_model>

<verification>
- Sensitivity gate test contract: all 5 CONTEXT.md cases pass (pure-sensitive / pure-general / hybrid / multi-turn no-stickiness / in-flight flip documentation)
- Watcher round-trip: a file edit on disk lands as updated chunks within ~2s
- Tombstone + 24h resurrection: identical-content re-add does not re-embed
- Daily 03:00 sweep removes stale tombstones + cascades chunks
- Boot reconciler picks up off-time edits
- powerMonitor suspend/resume reconciles
- **Phase 7 reconciler unchanged**: `git diff src/main/services/rag/` is empty for this plan
- **Phase 8 14-day hard gate NOT touched**: folder corpus does not appear in the gate's signal count
</verification>

<success_criteria>
- A live /ask query against a folder containing a sensitive document routes local-only with the lock badge; the same chat session's next query against general sources re-enables frontier
- Editing, deleting, renaming files in a watched folder reflects in the index within seconds (or within next boot if Aria was off)
- Embed-model swap re-embeds folder chunks via the existing Phase 7 reconciler with zero new code in src/main/services/rag/
</success_criteria>

<output>
After completion: `.planning/phases/10-knowledge-folders/10-02-SUMMARY.md`
</output>
