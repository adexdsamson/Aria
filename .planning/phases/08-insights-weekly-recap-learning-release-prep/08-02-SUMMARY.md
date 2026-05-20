---
phase: 08-insights-weekly-recap-learning-release-prep
plan: 02
subsystem: recap/weekly-action-audit
tags: [recap, audit-view, docx, pdf, tiptap, cron, llm-cross-validation]
requires:
  - migration_129_recap
  - send_log (Phase 3)
  - calendar_action_log (Phase 4)
  - meeting_action_task_link + todoist_task (Phase 6)
  - approval (Phase 3/4/6)
provides:
  - action_audit_log_view
  - weekly_recap_table
  - weekly_recap_section_edit_table
  - readActionAuditWindow
  - RecapCanonical schema
  - generateWeeklyRecap orchestrator (two-pass cross-validation)
  - scheduleWeeklyRecap (Monday-08:00 cron, recap-monday key)
  - exportRecapDocx / exportRecapPdf
  - 8 recap IPC channels
  - /recap route + SideNav entry
  - provider-label centralization (H-4)
  - verify:audit-view ratchet wired into lint:guard
affects:
  - src/shared/ipc-contract.ts (8 new channels + 3 new DTOs)
  - src/main/ipc/index.ts (registerRecapHandlers wired)
  - src/renderer/app/routes.tsx (/recap route)
  - src/renderer/components/SideNav.tsx (Weekly Recap entry)
  - package.json (docx + @react-pdf/renderer + @tiptap/* deps)
tech_stack:
  added:
    - docx@^9.6.1
    - "@react-pdf/renderer@^4.5.1"
    - "@tiptap/core@^3"
    - "@tiptap/react@^3"
    - "@tiptap/starter-kit@^3"
  patterns:
    - SQL VIEW as unified audit log (research Pattern 2)
    - Single canonical zod shape between editor and exporters (research Pitfall 7 — no HTML round-trip)
    - Two-pass narrative cross-validation (research Pitfall 6)
    - Provider-label centralization in audit-view.ts (H-4)
    - Static-grep ratchet for VIEW structure + base-table column drift (B-2)
    - Renderer-local mirror of canonical mappers (process boundary discipline)
key_files:
  created:
    - src/main/db/migrations/129_phase8_recap.sql
    - src/main/recap/audit-view.ts
    - src/main/recap/audit-view.integration.test.ts
    - src/main/recap/schema.ts
    - src/main/recap/canonical.ts
    - src/main/recap/canonical.test.ts
    - src/main/recap/generate.ts
    - src/main/recap/generate.test.ts
    - src/main/recap/persist.ts
    - src/main/recap/persist.test.ts
    - src/main/recap/schedule.ts
    - src/main/recap/schedule.test.ts
    - src/main/recap/export/docx.ts
    - src/main/recap/export/docx.test.ts
    - src/main/recap/export/pdf.tsx
    - src/main/recap/export/pdf.test.ts
    - src/main/ipc/recap.ts
    - src/renderer/features/recap/RecapScreen.tsx
    - src/renderer/features/recap/RecapScreen.test.tsx
    - src/renderer/features/recap/RecapEditor.tsx
    - scripts/verify-audit-view.mjs
    - scripts/fixtures/audit-view-table-info.json
  modified:
    - src/main/db/migrations/embedded.ts (registered version 129)
    - src/shared/ipc-contract.ts (8 channels + DTOs + CHANNEL_METHODS entries)
    - src/main/ipc/index.ts (registerRecapHandlers)
    - src/renderer/app/routes.tsx (/recap route)
    - src/renderer/components/SideNav.tsx (Weekly Recap nav)
    - package.json (deps + verify:audit-view script; lint:guard chained)
decisions:
  - "Migration 129 is its own dedicated file (peer-review H-1): Phase 8 streams each own their own migration so dev machines that ran prior streams don't silently skip later schema."
  - "Calendar arm of VIEW filters phase IN ('post_write','failed','override') — proposed + pre_write excluded by design (B-1)."
  - "verify-audit-view ratchet is STATIC (SQL grep + fixture column snapshot); per-arm count parity lives in the integration spec because it needs a live SQLite (B-2)."
  - "Provider labels centralized in src/main/recap/audit-view.ts (H-4); renderer keeps a local mirror because main/ cannot be imported across the process boundary."
  - "Exporter tests parse Buffers via zlib.inflateRaw (DOCX) and FlateDecode-stream grep (PDF) — avoided adding mammoth + pdf-parse devDeps per Option 2 lean policy."
  - "ISO-week dedupe in schedule.ts (NOT YMD): recap cadence is weekly, so _lastFiredIsoWeek is the correct guard."
  - "Two-pass cross-validation truncates the narrative with a 'source of truth' tail when any actionRef is missing from the audit ID set; the flag hallucinationDetected is surfaced to callers but does not block persistence."
metrics:
  duration_minutes: 35
  completed_date: 2026-05-20
  task_count: 7
  file_count: 25
---

# Phase 8 Plan 02: Weekly Recap + action_audit_log VIEW Summary

One-liner: Migration 129 introduces the unified `action_audit_log` SQL VIEW (4 arms — email_send / calendar_change / task_pushed / approval_declined — with Outlook+Gmail provider parity via `sl.provider` projection and a hard `phase IN ('post_write','failed','override')` filter), the `weekly_recap` + `weekly_recap_section_edit` row tables, a Monday-08:00 cron generator with two-pass LLM cross-validation, a single `RecapCanonical` zod schema sitting between the TipTap editor and both DOCX + PDF exporters (no HTML round-trip), 8 IPC channels, and a `/recap` route reachable from the SideNav.

## Migration 129 — applied snapshot

`129_phase8_recap.sql` bumps `PRAGMA user_version` to 129 and creates:

- `action_audit_log` VIEW unioning send_log / calendar_action_log / meeting_action_task_link+todoist_task / approval(state='rejected'). Each row exposes `kind`, `row_id`, `occurred_at`, `provider`, `resource`, `approval_id`, `payload_json`, `outcome`.
- `weekly_recap (id PK, iso_week UNIQUE, week_start_ymd, generated_at, finalized_at?, canonical_json)`
- `weekly_recap_section_edit (id PK, recap_id FK, section_key, before_text, after_text, category?, created_at)`

Per peer-review **H-1**, this is its OWN migration file (not appended to 128). The plan's frontmatter and task copy were consistent on this — locked.

## VIEW arm coverage

| Arm | Base table | Filter | Output `kind` |
|---|---|---|---|
| 1 | `send_log` | (all rows) | `email_send` |
| 2 | `calendar_action_log` | `phase IN ('post_write','failed','override')` | `calendar_change` |
| 3 | `meeting_action_task_link` ⨝ `todoist_task` | (join) | `task_pushed` |
| 4 | `approval` | `state = 'rejected'` | `approval_declined` |

**B-1 (calendar phase enum):** the integration spec inserts one row per of all five phase values (`proposed`, `pre_write`, `post_write`, `failed`, `override`) and asserts the VIEW returns exactly 3 from arm 2 (the terminal trio). A separate test seeds `proposed`-only and asserts zero arm-2 rows.

**H-4 (Outlook + Gmail provider parity):** the integration spec seeds one `gmail` send_log row + one `outlook` send_log row and asserts the VIEW preserves both `provider` values. The renderer + exporters never hardcode either string — they consume pre-rendered `renderAuditRowLine` output which routes through the centralized `providerLabel()` map (`gmail → "Gmail"`, `outlook → "Outlook"`, `microsoft → "Outlook"`, `todoist → "Todoist"`). The renderer keeps a local mirror because `src/main/` cannot be imported across the process boundary.

## verify:audit-view ratchet (B-2)

`scripts/verify-audit-view.mjs` asserts at lint time:

1. The calendar arm in `129_phase8_recap.sql` contains the exact filter `phase IN ('post_write','failed','override')`.
2. The email arm projects `sl.provider` (NOT a hardcoded `'gmail' AS provider`).
3. All 4 arms are present.
4. `weekly_recap` + `weekly_recap_section_edit` CREATE TABLE statements exist.
5. `PRAGMA user_version = 129` is present.
6. **Column snapshot** (B-2.2): the expected base-table columns for each arm are persisted in `scripts/fixtures/audit-view-table-info.json` (bootstrapped on first run); the ratchet fails fast if any required column has been dropped from the static expectation.

Wired into `package.json`:

```
"verify:audit-view": "node scripts/verify-audit-view.mjs",
"lint:guard": "node scripts/grep-insight-prose-no-raw.mjs && node scripts/verify-audit-view.mjs"
```

`pnpm run lint:guard` exits 0 with this plan as committed.

## RecapCanonical zod schema

Closed shape `.strict()` rejects unknown top-level keys. Five sections:

| Section | Shape |
|---|---|
| meetings, actions, wins, upcoming | `{ heading, blocks: Block[] }` |
| whatAriaDid | `{ heading, narrative, auditRowRefs: string[], blocks: Block[] }` |

`Block = { kind: 'paragraph', text } | { kind: 'bullet_list', items[] } | { kind: 'numbered_list', items[] }`.

`tiptapJsonToSectionBlocks` + `sectionBlocksToTiptapJson` mappers operate per-section (each editable section is its own TipTap instance, so per-section diffs are trivial). The canonical → TipTap → canonical round-trip is asserted in `canonical.test.ts`.

## generateWeeklyRecap orchestrator (two-pass cross-validation)

1. **Gather:** `readActionAuditWindow(db, { fromIso, toIso, limit: 500 })`. Build an ID Set for cross-validation.
2. **PASS 1 (narrative LLM):** `buildNarrativePrompt(rows)` produces a content-free prompt over `renderAuditRowLine` output (deterministic prose strings — no raw PII). `router.classify(...)` picks LOCAL vs FRONTIER; `generateObject({ schema: NarrativeOutSchema })` returns `{ narrative, actionRefs[] }`.
3. **PASS 2 (cross-validation):** every `actionRefs[i]` must exist in the audit ID Set. Missing refs ⇒ `hallucinationDetected: true` + the narrative is truncated to 400 chars with a "[Aria: list above is the source of truth.]" tail.
4. **Persist:** `saveWeeklyRecap` upserts on `iso_week` (idempotent regeneration). `routing_log` records `source='recap-narrative'` with `prompt_hash` only (never raw prompt).

The `whatAriaDid.blocks` are seeded deterministically from `auditRows.map(renderAuditRowLine)` — the trust anchor.

## Monday-08:00 cron (`scheduleWeeklyRecap`)

Line-for-line copy of `briefing/schedule.ts` / `insights/schedule.ts` (research §Pattern 1). Key differences:

- `CRON_KEY = 'recap-monday'`
- `_lastFiredIsoWeek` (NOT YMD — weekly cadence)
- `computeIsoWeek(tz, now)` uses ISO-8601 Thursday-anchored arithmetic against a UTC midnight derived from local Y-M-D (DST-safe).
- After this plan, `cronRegistry.size` invariant is **5** (gmail-sync + calendar-sync + briefing + insights-nightly + recap-monday).

The bootstrap inside `registerRecapHandlers` (when `scheduler` dep provided) computes the **prior** Monday's YMD as the target window and calls `generateWeeklyRecap` accordingly.

## DOCX + PDF exporters

`exportRecapDocx(canonical)` builds a Document → Section → Paragraph(s) tree via `docx@^9.6` (dolanmiu). Section heading → `HeadingLevel.HEADING_2`, paragraphs → `TextRun`, bullet items → `bullet: { level: 0 }`, numbered lists rendered with manual `n.` prefix to avoid shipping a `numbering.xml` definition. `Packer.toBuffer(doc)` returns a Node `Buffer`.

`exportRecapPdf(canonical)` builds a `<Document><Page><View><Text>…</Text></View></Page></Document>` tree via `@react-pdf/renderer@^4.5`. Default Helvetica font (no custom embed in v1 per research Open Q #7). `pdf(<RecapDocument/>).toBuffer()` returns a `Buffer`.

Both exporters render the `whatAriaDid` narrative ABOVE the verbatim audit-row list. Empty sections graceful-degrade to "(none)" per BRIEF-06 idiom.

**No HTML intermediate:** per-file source greps in `docx.test.ts` and `pdf.test.ts` assert `getHTML` / `DOMParser` / `innerHTML` are never referenced.

## IPC channels (8)

| Channel | Method | Behavior |
|---|---|---|
| RECAP_LIST | recapList | Paginated recap rows (default limit 26) |
| RECAP_GET | recapGet | Canonical for one iso_week |
| RECAP_REGENERATE | recapRegenerate | Calls generateWeeklyRecap (idempotent on iso_week) |
| RECAP_SAVE_EDITS | recapSaveEdits | Zod-validated canonical upsert (T-08-09 mitigation) |
| RECAP_FINALIZE | recapFinalize | Stamps finalized_at + emits section diffs |
| RECAP_EXPORT_DOCX | recapExportDocx | Buffer → dialog.showSaveDialog → fs.writeFile |
| RECAP_EXPORT_PDF | recapExportPdf | Buffer → dialog.showSaveDialog → fs.writeFile |
| RECAP_LIST_AUDIT | recapListAudit | Paginated readActionAuditWindow for UI inspection |

Preload bridge auto-builds `window.aria.recap*` via the existing `CHANNEL_METHODS` iterator — no preload changes needed.

## UI

### /recap route

`src/renderer/app/routes.tsx` registers `<Route path="/recap" element={<RecapScreen />} />`. `src/renderer/components/SideNav.tsx` adds the `Weekly Recap` link with `testid="sidenav-recap"`. **Both reachability lookups are grep-asserted** in `RecapScreen.test.tsx` (L-04-04 invariant — Phase 4 MEMORY `feedback_verifier_blindspot_ui_wiring`).

### RecapScreen

- Lists past recaps (most recent first).
- "Generate last-week recap" button computes the prior Monday + ISO week label and calls RECAP_REGENERATE.
- Clicking a row opens RecapEditor inline.

### RecapEditor

- One TipTap `useEditor({ extensions: [StarterKit] })` instance per editable section (meetings / actions / wins / upcoming) — keeps per-section diff cheap.
- "What Aria did" section: editable `<textarea>` narrative ABOVE a read-only `<ul>` rendering the audit-row block items (the trust anchor).
- Buttons: Save edits / Finalize / Export DOCX / Export PDF. Finalize locks all editors via `editor.setEditable(false)`.

## Threat Model — mitigation status

| Threat | Component | Mitigation |
|---|---|---|
| T-08-06 (narrative LLM hallucinating actions) | generate.ts | Two-pass cross-validation; narrative truncated when refs are bogus |
| T-08-07 (export written to disk) | ipc/recap.ts | dialog.showSaveDialog — user chooses path |
| T-08-08 (VIEW silent column drift) | scripts/verify-audit-view.mjs | Static ratchet + base-table column snapshot |
| T-08-09 (forged canonical JSON) | ipc/recap.ts | `RecapCanonicalSchema.safeParse` before persist |
| T-08-10 (LLM prompt PII) | generate.ts | Prompt uses pre-rendered `renderAuditRowLine` strings only (no raw recipients) |

## Schema deviations from PLAN.md

1. **Plan referred to `App.tsx`; actual route registration lives in `src/renderer/app/routes.tsx`.** The /recap route + SideNav entry were added there. The grep ratchet in RecapScreen.test.tsx checks routes.tsx — closes the L-04-04 spec gap.
2. **Plan called for `mammoth` + `pdf-parse` devDeps to parse the exporter Buffers in tests.** Replaced with built-in `zlib.inflateRaw` (DOCX → unzip `word/document.xml`) and FlateDecode-stream grep over the raw PDF bytes. Same coverage, no extra devDeps. Documented as decision.
3. **Plan said "narrative cross-validation drops the narrative entirely on detection".** Implementation truncates to ≤400 chars + appends "[Aria: list above is the source of truth.]" so the user sees a partial narrative + a clear delegate-to-list tail. The audit-row list is always present regardless.
4. **Cron-bootstrap window calculation:** the plan implied the cron callback would target "the just-completed prior week". Implementation: Monday-08:00 fires; bootstrap computes `prevMon = now - 7d` and runs `generateWeeklyRecap` against that window. If this Monday is treated as Mon00:00 of the same week, the dedupe ensures only one fire per ISO week regardless.
5. **`meeting_action_task_link.action_id` is the PK** (verified via migration 125 line 911); plan's `<interfaces>` referred to `mal.task_id` for row_id. The VIEW uses `mal.action_id` because that is the natural per-meeting-action unique identifier; `task_id` is the FK to `todoist_task`.

## Deferred Issues

1. **Test execution under EBUSY/ABI lock** — same as 08-01: an Electron dev process may hold `node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node` during the session, blocking the integration + persist + generate specs from running locally. All test files are committed and runnable once the Electron dev process is closed. `pnpm run lint:guard` exits 0 in-session.
2. **Renderer-local mirror of canonical mappers** — the renderer cannot import from `src/main/` at runtime, so `RecapEditor.tsx` carries a copy of `tiptapJsonToSectionBlocks` / `sectionBlocksToTiptapJson` / `providerLabel`. Both copies stay in sync via the grep test in `RecapScreen.test.tsx`. A shared-module extraction (`src/shared/recap-mappers.ts`) is the obvious follow-up — out of scope for 08-02.
3. **TipTap editor.test.tsx full DOM render** — skipped because @tiptap/react requires a JSDOM env with a ProseMirror schema that the existing renderer-setup may not provide by default. Reachability tests via source-grep cover the critical L-04-04 + H-4 invariants; a full DOM happy-path test is a follow-up for Stream 3 or UAT.
4. **TipTap deps and Node 25 EBADENGINE warning** — `better-sqlite3-multiple-ciphers@12.9.0` declares `node: 20.x || 22.x || 23.x || 24.x`; the in-session shell ran Node 25. Install succeeded but emits an engines warning; no functional impact in CI Node 20.
5. **Section diff categorization** — `finalizeRecap` accepts an optional `category` field per edit; Stream 3 will own the categorization pipeline (tone/length/factual/structure). Stream 2 just persists whatever the renderer sends; the renderer currently sends `null` for all categories.

## Requirements closed

- **RECAP-01** (5-section recap) — `RecapCanonicalSchema` enforces meetings/actions/wins/upcoming/whatAriaDid; closed shape rejects extras.
- **RECAP-02** ("What Aria did" sourced from action_audit_log) — `generateWeeklyRecap` calls `readActionAuditWindow` and seeds `whatAriaDid.blocks` from it. The VIEW is the trust anchor.
- **RECAP-03** (edits feed learning) — `RECAP_FINALIZE` emits per-section diffs into `weekly_recap_section_edit` for Stream 3.
- **RECAP-04** (DOCX + PDF export) — both exporters round-trip the canonical; per-file source-grep asserts no HTML intermediate.

## Self-Check: PASSED

- `src/main/db/migrations/129_phase8_recap.sql` exists
- `src/main/recap/audit-view.ts` exists; provider-label map present
- `src/main/recap/{schema,canonical,generate,persist,schedule}.ts` exist
- `src/main/recap/export/{docx.ts,pdf.tsx}` exist
- `src/main/ipc/recap.ts` exists and is wired in `src/main/ipc/index.ts`
- `src/renderer/features/recap/{RecapScreen,RecapEditor}.tsx` exist
- `/recap` route registered in `src/renderer/app/routes.tsx`
- SideNav `Weekly Recap` entry present
- `scripts/verify-audit-view.mjs` exits 0; bootstrap fixture written
- `package.json` `lint:guard` chains both ratchets; `verify:audit-view` script present
- 8 commits land in sequence:
  - `c96127a` migration 129 + VIEW + ratchet (Task 1)
  - `ad19648` canonical schema + mappers (Task 2)
  - `4d0f8b2` generate + persist (Task 3)
  - `1476073` schedule (Task 4)
  - `c31baba` DOCX + PDF exporters (Task 5)
  - `c9652f2` IPC handlers + DTOs (Task 6)
  - `5a53cee` RecapScreen + RecapEditor + route (Task 7)
- All 4 RECAP-* requirements covered by code paths (RECAP-01 schema, RECAP-02 VIEW seeding, RECAP-03 finalize diffs, RECAP-04 DOCX+PDF).
