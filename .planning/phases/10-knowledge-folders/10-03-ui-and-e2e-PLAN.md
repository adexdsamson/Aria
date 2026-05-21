---
phase: 10-knowledge-folders
plan: 03
type: execute
wave: 3
depends_on: [10-01, 10-02]
files_modified:
  - src/renderer/features/settings/KnowledgeFoldersSection.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - src/renderer/features/settings/__tests__/KnowledgeFoldersSection.test.tsx
  - src/renderer/features/settings/__tests__/KnowledgeFoldersSection.remove-confirm.test.tsx
  - tests/integration/knowledge-folder-ask-roundtrip.spec.ts
  - tests/e2e/knowledge-folders.spec.ts
autonomous: false
requirements:
  - SPEC-§8-progress-channel
  - SPEC-§9-renderer
  - SPEC-§10-testing-integration-e2e
  - CONTEXT-§decision-3-prescan-confirm

must_haves:
  truths:
    - "User can add a folder via Settings → Knowledge Folders, see file count rise live, and ask /ask a question that returns an answer with a folder citation"
    - "Large-folder pre-scan (>5,000 files OR >2GB) shows confirm dialog before the row is created"
    - "Removing a folder requires explicit confirm-dialog interaction; cancel preserves data"
    - "Flipping a folder to Sensitive causes the next /ask answer drawing from it to show the local-only lock badge"
    - "Failure expander surfaces per-file errors when errorCount > 0"
  artifacts:
    - path: "src/renderer/features/settings/KnowledgeFoldersSection.tsx"
      provides: "Editorial section: stats strip + folder cards + add-folder flow + failure expander + remove confirm dialog + live progress"
      min_lines: 150
  key_links:
    - from: "KnowledgeFoldersSection Add button"
      to: "aria:knowledge:pick-folder → aria:knowledge:prescan-folder → confirm dialog (if exceedsThreshold) → aria:knowledge:add-folder"
      via: "window.aria.knowledge"
      pattern: "prescan-folder"
    - from: "KnowledgeFoldersSection Remove menu item"
      to: "destructive-action confirm dialog → aria:knowledge:remove-folder"
      via: "shared ConfirmDialog component"
      pattern: "ConfirmDialog|destructive"
    - from: "KnowledgeFoldersSection progress strip"
      to: "aria:knowledge:progress push channel"
      via: "window.aria.knowledge.onProgress"
      pattern: "onProgress"
---

<objective>
Ship the user-facing surface for Knowledge Folders and the end-to-end verification proving the system works. The section follows the editorial pattern established in Backup / Updates / Integrations: stat card + action cards + gold left-border. Add-folder uses native picker → pre-scan → conditional confirm → register. Remove uses the destructive-action confirm dialog enforced across Aria. /ask UI is unchanged; folder citations render through the existing citation component.

Purpose: close the phase — visible value with safety rails in place.
Output: KnowledgeFoldersSection, integration round-trip, Playwright E2E walkthrough, human-verify checkpoint.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-knowledge-folders/10-CONTEXT.md
@docs/superpowers/specs/2026-05-21-knowledge-folders-design.md
@.planning/phases/10-knowledge-folders/10-01-schema-registry-parsers-ingest-PLAN.md
@.planning/phases/10-knowledge-folders/10-02-sensitivity-watcher-lifecycle-PLAN.md
@src/renderer/features/settings/RagIndexSection.tsx
@src/renderer/features/settings/BackupRestoreSection.tsx
@src/renderer/features/settings/IntegrationsSection.tsx
@src/renderer/features/settings/SettingsScreen.tsx
@src/renderer/components/AddAccountModal.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: KnowledgeFoldersSection editorial UI + add-folder flow + progress wiring</name>
  <files>
    src/renderer/features/settings/KnowledgeFoldersSection.tsx,
    src/renderer/features/settings/SettingsScreen.tsx,
    src/renderer/features/settings/__tests__/KnowledgeFoldersSection.test.tsx
  </files>
  <read_first>
    src/renderer/features/settings/RagIndexSection.tsx (closest visual analog),
    src/renderer/features/settings/BackupRestoreSection.tsx (stat-card pattern),
    src/renderer/features/settings/IntegrationsSection.tsx (account-card + alert pattern),
    src/renderer/components/AddAccountModal.tsx (inline form pattern for label+sensitivity),
    src/preload/index.d.ts (typed window.aria.knowledge surface from 10-01),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§9),
    .planning/phases/10-knowledge-folders/10-CONTEXT.md (decision 3 — pre-scan thresholds)
  </read_first>
  <behavior>
    - Stats strip (top of section): total folders, total files indexed, total chunks, total disk footprint (= SUM of per-folder bytesIndexed). Uses BackupRestoreSection stat-card pattern.
    - Folder cards: label + middle-truncated rootPath + file count + last-indexed relative timestamp + sensitivity chip (General / Sensitive with lock glyph) + enabled toggle + kebab menu (Reindex / Rename / Change sensitivity / Remove).
    - Add folder button → invokes window.aria.knowledge.pickFolder(); on {rootPath} calls prescanFolder({rootPath}). If exceedsThreshold → render confirm dialog "This folder has {N} files ({prettyBytes}). Initial indexing will take a while. Continue?" with Cancel + Continue. Cancel returns to picker (no DB write). Continue (or below threshold) → render inline form (label default = basename(rootPath), sensitivity radio with General as default) → submit calls addFolder.
    - Sensitivity chip uses gold left-border accent for Sensitive; General is neutral.
    - Live progress strip: subscribes via window.aria.knowledge.onProgress; shows the active folder's {phase, done, total} as a thin progress bar (matching Updates section's progress bar pattern).
    - Failure expander: if folder.errorCount > 0, render a `<details>` element listing failures from listFailures({id}) with relativePath + last_error.
    - Disabled folders render at reduced opacity; toggle calls updateFolder({id, enabled}).
    - Section is mounted from SettingsScreen alongside RagIndexSection.
  </behavior>
  <action>
    Build KnowledgeFoldersSection.tsx as a functional React component. Use TanStack Query (project convention) to fetch listFolders + per-folder folder-stats + listFailures lazily. Use Zustand only if there's a project-established pattern for cross-component progress; otherwise component-local useState fed from the onProgress subscription is fine. Wire from SettingsScreen between IntegrationsSection and RagIndexSection (or wherever RagIndexSection is mounted — read first to match). Use the inline `<style>` + editorial-token approach established in Phase 9 (feedback_aria_animation_patterns.md). Do NOT fabricate fields the DTO doesn't carry (feedback_design_ref_prototype_vs_dto_reality.md). Write KnowledgeFoldersSection.test.tsx covering:
      • renders empty state when listFolders returns []
      • renders stats strip + folder card when one folder exists
      • Add → pick → prescan-under-threshold → form submit calls addFolder with {label, rootPath, sensitivity:'general'}
      • Add → pick → prescan-over-threshold → confirm dialog renders → cancel → no addFolder call
      • Add → pick → prescan-over-threshold → confirm → form submit → addFolder called
      • Progress subscription updates the progress strip
      • Failure expander shows listFailures rows when errorCount > 0
      • Sensitive folder card shows lock glyph + chip
  </action>
  <acceptance_criteria>
    - `grep -n "prescanFolder\\|prescan-folder" src/renderer/features/settings/KnowledgeFoldersSection.tsx` matches
    - `grep -n "KnowledgeFoldersSection" src/renderer/features/settings/SettingsScreen.tsx` matches (reachability — addresses feedback_verifier_blindspot_ui_wiring)
    - Test count >= 8 in KnowledgeFoldersSection.test.tsx; all pass
    - `grep -n "onProgress" src/renderer/features/settings/KnowledgeFoldersSection.tsx` matches
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/renderer/features/settings/__tests__/KnowledgeFoldersSection.test.tsx && npm run typecheck</automated>
  </verify>
  <done>
    Section renders editorial cards; add-folder flow honors prescan thresholds; progress + failures visible; mounted in SettingsScreen.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Remove-folder destructive-action confirm dialog (3-split contract) + integration round-trip</name>
  <files>
    src/renderer/features/settings/__tests__/KnowledgeFoldersSection.remove-confirm.test.tsx,
    tests/integration/knowledge-folder-ask-roundtrip.spec.ts,
    src/renderer/features/settings/KnowledgeFoldersSection.tsx (only the remove handler if not already complete from Task 1)
  </files>
  <read_first>
    src/renderer/features/settings/IntegrationsSection.tsx (existing destructive-action confirm dialog precedent — disconnect),
    .planning/phases/10-knowledge-folders/10-01-schema-registry-parsers-ingest-PLAN.md (remove-folder transactional cascade),
    tests/fixtures/knowledge/ (from 10-01)
  </read_first>
  <behavior>
    Destructive-action confirm dialog test contract (per CLAUDE.md memory feedback_destructive_actions_require_consent — 3 split assertions):
    1. **Renders dialog:** clicking Remove on a folder card opens a confirm dialog with the folder label and explicit destructive copy ("This will remove the folder and all its indexed knowledge. This cannot be undone.")
    2. **Cancel preserves data:** clicking Cancel closes the dialog AND removeFolder IPC was NOT called AND the folder card is still rendered
    3. **Confirm performs destruction:** clicking Confirm calls removeFolder({id}) exactly once AND the card disappears from the list AND the stats strip recomputes

    Integration round-trip (real SQLite, real ingestion, mocked frontier — but real Phase 7 retrieval):
    - Register a folder pointing to tests/fixtures/knowledge/
    - Wait for indexing to complete (poll folder-stats until fileCount > 0)
    - Issue an /ask query whose expected answer is drawn from one of the fixtures
    - Assert the response includes at least one citation with file_path matching a fixture file
    - Flip the folder to sensitive via updateFolder
    - Issue the same /ask query; assert the response's sensitivity-gate decision is 'local' (frontier provider not called)
    - Remove the folder
    - Assert SELECT COUNT(*) FROM chunks WHERE folder_id=? returns 0
  </behavior>
  <action>
    Write KnowledgeFoldersSection.remove-confirm.test.tsx with the 3 discrete tests above — each a separate `it()` block so a regression on any single assertion surfaces independently. If Task 1's draft uses a window.confirm or skips the dialog, replace with the shared destructive ConfirmDialog component used by IntegrationsSection. Write tests/integration/knowledge-folder-ask-roundtrip.spec.ts driving the full add → index → ask → flip-sensitive → ask → remove flow against an in-process main + a real better-sqlite3 DB (after migration 132). Mock only the frontier LLM provider (assert it is or isn't called) and the embedder if needed for determinism; use the real Phase 7 retrieval code path.
  </action>
  <acceptance_criteria>
    - KnowledgeFoldersSection.remove-confirm.test.tsx contains exactly 3 `it(` blocks
    - Each it() asserts ONE of: dialog renders / cancel preserves / confirm destroys
    - Integration spec asserts citation.file_path matches a fixture path
    - Integration spec asserts frontier provider mock was NOT called after sensitivity flip
    - Integration spec asserts `chunks` rows for folder_id are 0 after remove
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/renderer/features/settings/__tests__/KnowledgeFoldersSection.remove-confirm.test.tsx tests/integration/knowledge-folder-ask-roundtrip.spec.ts</automated>
  </verify>
  <done>
    3-split destructive-action contract green; integration round-trip green; sensitive flip forces local routing; remove cascades.
  </done>
</task>

<task type="auto">
  <name>Task 3: Playwright _electron E2E walkthrough</name>
  <files>
    tests/e2e/knowledge-folders.spec.ts
  </files>
  <read_first>
    tests/e2e/ (existing Playwright _electron pattern — grep for an existing spec to mirror harness setup),
    docs/superpowers/specs/2026-05-21-knowledge-folders-design.md (§10 E2E),
    tests/fixtures/knowledge/
  </read_first>
  <action>
    Author tests/e2e/knowledge-folders.spec.ts covering the spec §10 E2E walkthrough:
      1. Launch app, unlock with test vault
      2. Navigate Settings → Knowledge Folders
      3. Click Add Folder; intercept pick-folder dialog to return tests/fixtures/knowledge/ (use IPC test harness — Playwright cannot drive native dialogs)
      4. Fill label, sensitivity=General, submit
      5. Poll until folder card shows fileCount > 0
      6. Open /ask, issue a query whose answer is in the fixtures; assert the answer card shows a citation with the fixture file path
      7. Back to Settings, change sensitivity to Sensitive via kebab menu
      8. Re-issue the /ask query; assert the lock badge is visible on the answer card
      9. Click Remove on the folder card; assert confirm dialog appears with destructive copy
      10. Click Confirm; assert the card disappears
    Use the existing _electron harness; mock pick-folder via a test-only IPC override registered before launch.
  </action>
  <acceptance_criteria>
    - `grep -n "playwright" tests/e2e/knowledge-folders.spec.ts` matches
    - Spec contains assertions for: citation visible, lock badge visible after flip, confirm dialog opens on Remove, card removed after Confirm
  </acceptance_criteria>
  <verify>
    <automated>npx playwright test tests/e2e/knowledge-folders.spec.ts --reporter=line</automated>
  </verify>
  <done>
    E2E spec runs against packaged-or-dev Electron and exercises the full Add → Ask → Flip → Ask → Remove flow.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Human-verify walkthrough + UAT signoff</name>
  <what-built>
    KnowledgeFoldersSection in Settings, full add-folder flow with native picker + prescan confirm, live progress, sensitivity flip with lock badge in /ask, destructive remove with confirm dialog.
  </what-built>
  <how-to-verify>
    1. Launch Aria dev build (`npm run dev`); unlock with your local vault
    2. Settings → Knowledge Folders should be visible between Integrations and RAG Index
    3. Click "Add Folder", pick a small real folder on your disk (e.g., ~/Documents/notes if you have one — fewer than 100 files)
    4. Submit with label of your choosing, sensitivity=General
    5. Watch the progress strip — it should run scan → parse → embed and settle within seconds for a small folder
    6. Open /ask, ask a question whose answer lives in that folder
    7. Confirm the answer card shows at least one citation pointing to a file in your folder
    8. Back to Settings → kebab → Change sensitivity to Sensitive on that folder
    9. Re-ask the same /ask question — confirm the lock badge appears on the answer with hover text "Answered locally — sensitive folder source"
    10. Now try a folder with >5,000 files (e.g., a node_modules-adjacent dir) — confirm the pre-scan dialog appears BEFORE the folder is registered
    11. Cancel that pre-scan dialog — confirm no folder card is created
    12. On your real folder, click Remove → confirm the dialog text says "This will remove the folder and all its indexed knowledge. This cannot be undone." → click Cancel → folder still there
    13. Click Remove again → Confirm → folder gone; stats strip drops to zero
    14. Reboot the app — your General folder (if you re-added one) should reappear; edit a file in it from outside Aria; confirm the new content is queryable within ~2s OR within seconds of next boot
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issue. UAT findings get triaged into a 10-04 gap-closure plan if needed.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer ConfirmDialog → IPC remove-folder | destructive action must be gated by explicit user click on Confirm — no programmatic path |
| native pick-folder dialog → renderer | rootPath string is user-chosen; main process validates existence + absoluteness (10-01 T-10-01) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-10 | Tampering | silent destructive remove | mitigate | 3-split destructive-action confirm dialog test contract; reuses IntegrationsSection's ConfirmDialog precedent |
| T-10-11 | DoS | accidentally indexing a massive folder | mitigate | Pre-scan IPC + confirm dialog at 5k files / 2GB thresholds (CONTEXT.md decision 3) |
| T-10-12 | Information Disclosure | sensitive folder citations leaking via frontier | mitigate | Sensitivity gate from 10-02 forces local; integration round-trip asserts frontier mock not called |
</threat_model>

<verification>
- KnowledgeFoldersSection mounted in SettingsScreen (reachability grep) — addresses feedback_verifier_blindspot_ui_wiring
- 3-split destructive confirm test contract green
- Integration round-trip green: add → index → ask → flip → ask (local-only) → remove (cascade)
- Playwright E2E green
- Human-verify checkpoint signed off
- No regressions in pre-existing Settings sections (typecheck + RagIndexSection / IntegrationsSection / BackupRestoreSection vitest suites untouched and green)
</verification>

<success_criteria>
- Live demo: register a real folder, ask a question, see a folder citation in the answer
- Flip to sensitive, see lock badge, frontier provider not called
- Remove requires explicit confirm-dialog interaction
- Large-folder pre-scan threshold gates registration with a confirm dialog
- Phase 8 14-day hard gate is verifiably untouched (no `corpus='folder'` in the gate signal counter)
</success_criteria>

<output>
After completion: `.planning/phases/10-knowledge-folders/10-03-SUMMARY.md`
</output>
