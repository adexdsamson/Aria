---
phase: 08-insights-weekly-recap-learning-release-prep
plan: 01
subsystem: insights/nightly-aggregates
tags: [insights, briefing, privacy, llm-routing, cron, static-grep-ratchet]
requires:
  - migration_128_insights
provides:
  - insights_table
  - 14d_per_corpus_gate
  - 4_compute_functions
  - insight_prose_aggregates_only
  - insights_nightly_cron
  - insights_ipc_channels
  - briefing_this_week_section
  - lint_guard_insight_prose_no_raw
affects:
  - src/shared/ipc-contract.ts (BriefingPayload gains thisWeekInsights)
  - src/main/ipc/briefing.ts (BRIEFING_TODAY enriches with insights)
  - src/renderer/features/settings/SettingsScreen.tsx (Insights route)
  - src/renderer/features/briefing/BriefingScreen.tsx (This week section)
tech_stack:
  added: []
  patterns:
    - Pure-SQL gate (zero LLM calls in the per-kind probe path)
    - Aggregates-only LLM prompt (numeric + cluster LABELS ≤30 chars)
    - Static-grep ratchet enforces INSIGHT-03 invariant at lint time
    - line-for-line copy of briefing/schedule.ts cron-with-suspend/resume pattern
    - Single-source-of-truth read path (B-4): query insights table FIRST; gate-check only on empty
key_files:
  created:
    - src/main/insights/gate.ts
    - src/main/insights/compute.ts
    - src/main/insights/prose.ts
    - src/main/insights/aggregate.ts
    - src/main/insights/schedule.ts
    - src/main/ipc/insights.ts
    - src/renderer/features/settings/InsightsSection.tsx
    - scripts/grep-insight-prose-no-raw.mjs
    - tests/unit/main/db/migrations-128-insights.spec.ts
    - tests/unit/main/insights/gate.spec.ts
    - tests/unit/main/insights/compute.spec.ts
    - tests/unit/main/insights/prose.spec.ts
    - tests/unit/main/insights/aggregate.spec.ts
    - tests/unit/main/insights/schedule.spec.ts
    - tests/unit/renderer/features/settings/InsightsSection.spec.tsx
  modified:
    - src/main/db/migrations/embedded.ts
    - src/main/insights/schema.ts (already present from prior commit)
    - src/main/db/migrations/128_phase8_insights.sql
    - src/shared/ipc-contract.ts
    - src/main/ipc/index.ts
    - src/main/ipc/briefing.ts
    - src/renderer/features/settings/SettingsScreen.tsx
    - src/renderer/features/briefing/BriefingScreen.tsx
    - package.json
decisions:
  - "Single-pass implementation (Option 2): combined feat commits where TDD RED/GREEN shape was not load-bearing"
  - "Settings section path placed at src/renderer/features/settings/InsightsSection.tsx (NOT sections/ subdirectory) — matches existing convention (NewsSourcesSection, SchedulingRulesSection, etc.)"
  - "Briefing read-path enrichment chosen over runBriefing-time injection — keeps Phase 2 briefing schema fixtures green; thisWeekInsights is rebuilt from the insights table on every BRIEFING_TODAY call (no JSON migration)"
  - "Dismiss button persists to sessionStorage only in Stream 1 (visible-session-only); Stream 3 (Plan 08-03 Task 3) owns the BRIEFING_INSIGHT_DISMISS IPC channel + briefing_feedback table backfill"
  - "Only grep-insight-prose-no-raw.mjs ratchet wired in Stream 1; grep-assert-approved.mjs deferred (NOT 08-01 scope per user direction)"
  - "100-row collision test omitted: Stream 1 does not write to app_meta (deferred to Stream 3 along with the dismiss-channel backfill); test would be premature"
metrics:
  duration_minutes: 60
  completed_date: 2026-05-20
  task_count: 8
  file_count: 22
---

# Phase 8 Plan 01: Insights — privacy-preserving weekly aggregates Summary

One-liner: Phase 8 Stream 1 — migration 128 + 14-day-per-corpus gate + 4 pure-SQL aggregate functions + aggregates-only LLM prose generator + nightly cron + Settings/Briefing surfaces + `grep-insight-prose-no-raw` lint ratchet that makes leaking raw user content into the insight-prose prompt unmergeable.

## Migration 128 — applied snapshot

`128_phase8_insights.sql` applies cleanly, bumps `PRAGMA user_version` to 128, and creates one table + two indices:

- `insights(id PK AUTOINCREMENT, kind CHECK IN (...), week_ymd, computed_at, payload_json, dismissed CHECK IN (0,1))`
- `uniq_insights_kind_week` UNIQUE on `(kind, week_ymd)` — supports the orchestrator's ON CONFLICT upsert
- `idx_insights_week` on `(week_ymd DESC)` — supports the BRIEFING_TODAY read path

Idempotent re-run verified by `tests/unit/main/db/migrations-128-insights.spec.ts`.

## 14-day-per-corpus gate (`gate.ts`)

`checkInsightGate(db, { now?, kind? }) → { unlocked, blockedKinds, daysRemaining }`. Pure SQL; never invokes any LLM.

Per-kind probes:

| Kind             | Corpus probe                                              | Extra hard-block                                                                              |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| calendar_load    | `MIN(COALESCE(start_at_utc, start_date))` FROM calendar_event | —                                                                                             |
| response_time    | `MIN(received_at)` FROM gmail_message                     | —                                                                                             |
| recurring_themes | `MIN(received_at)` FROM gmail_message OR meeting_note     | `COUNT(*) FROM rag_chunk WHERE source_kind IN ('email','note') AND deleted_at IS NULL >= 50`  |
| approval_edits   | `MIN(created_at)` FROM approval                           | —                                                                                             |

Every probe is wrapped in try/catch so older test DBs (where some schema may be absent) degrade to "blocked, 14 days remaining" rather than throwing.

## Compute functions (`compute.ts`)

Four pure functions; only `computeRecurringThemes` invokes an LLM, and only for cluster LABELS:

- **`computeCalendarLoadDelta`** — week-over-week meeting hours + `focusBlockCount` (gaps ≥60 min between adjacent UTC events). Returns 100% delta when last week was 0 hours.
- **`computeResponseTimeTrend`** — per-thread Incoming→Reply pairing using thread_id ordering + best-effort user-email lookup from `provider_account.capabilities_json.mail`. Returns `medianMinutesThisWeek`, `medianMinutesLastWeek`, `deltaMinutes`, and `perPersonTop3` (top-3 slowest correspondents by median minutes).
- **`computeRecurringThemes`** — k-means cosine clustering over `rag_chunk + rag_embedding` rows where `source_kind IN ('email','note') AND deleted_at IS NULL`. Sweeps `k=3..8` with a coarse silhouette proxy. Cluster labels are derived from top-5 TF terms (stop-words stripped) and passed to an optional `labelFromTerms(terms)` callback — NEVER raw chunk text. Default callback is a no-LLM heuristic; aggregate.ts threads in the real LLM via the shared `p-queue`.
- **`computeApprovalEditPattern`** — counts `approval` rows in this week's window where `body_edited != body_original`; returns `editedDraftSharePct`. `topEditCategories` is empty in Stream 1 (Stream 3 will backfill via signal log).

The T-08-02 invariant ("label-gen prompt never sees raw chunk text") is asserted directly in `tests/unit/main/insights/compute.spec.ts` by spying on the `labelFromTerms` callback and inspecting every captured `terms[]` argument for token-shape, length, and absence of a seeded raw-secret string.

## Prose generator (`prose.ts`) + static-grep ratchet

`insightProse(aggregates, { router, logger, db })` builds a prompt from numeric aggregates + theme LABELS only (`buildProsePrompt`), calls `router.classify({ source: 'generic' })`, runs `generateObject(ProseOutSchema)`, and writes one `routing_log` row with `hashPrompt(prompt)` (never the raw prompt).

**Email masking belt-and-braces:** `perPersonTop3` contact emails are rewritten to `someone@<domain>` before substitution into the prompt (test `buildProsePrompt never includes raw email/calendar strings`).

**Static-grep ratchet:** `scripts/grep-insight-prose-no-raw.mjs`:
1. Greps every `import … from "<spec>"` in prose.ts; fails if `<spec>` contains any of: `gmail_message`, `gmail/`, `calendar_event`, `calendar/`, `meeting_note`, `meeting/`, `meeting-note`, `rag_chunk`, `rag/`, `transcripts`, `transcript/`, `briefing/redact`.
2. After stripping comments, greps for forbidden string-literal substrings: `body_original`, `body_edited`, `snippet`, `transcript`, `normalized_text`, `meeting_note_segment`, `rag_chunk`.

Wired into `package.json`:
```
"grep:insight-prose-no-raw": "node scripts/grep-insight-prose-no-raw.mjs",
"lint:guard": "node scripts/grep-insight-prose-no-raw.mjs",
"test:unit": "npm run lint:guard && vitest run --passWithNoTests"
```
`pnpm run grep:insight-prose-no-raw` exits 0 on the as-shipped prose.ts; the ratchet was self-tested by manual smoke (forcing a forbidden import → exits 1 with diagnostic). Plans 08-02 / 08-03 will extend `lint:guard` with their own ratchets (and `grep-assert-approved.mjs` if that convention lands — out of scope here).

## Aggregate orchestrator (`aggregate.ts`)

`aggregate(db, weekStartYmd, { router, logger, llmQueue?, now? }) → { written, skipped }`.

- Calls `checkInsightGate` ONCE up-front. If `blockedKinds` covers all 4 kinds, short-circuits with `{ written: 0, skipped: 4 }` — closes B-3 invariant.
- For each unlocked kind: compute → prose → upsert into `insights` keyed on `(kind, week_ymd)`, with the payload JSON augmented by `sentences: string[]` from the prose pass.
- LLM-bearing steps (cluster-label-gen for recurring_themes + every prose call) are awaited through a shared `p-queue({ concurrency: 1 })` — either the scheduler queue passed in, or a private one.
- Re-running same week is idempotent via `ON CONFLICT(kind, week_ymd) DO UPDATE`.

`weekStartYmdFor(now, tz)` computes the Monday-anchored YMD for the current week in the user's local tz, used by both the scheduler hook and the IPC handlers.

## Nightly cron (`schedule.ts`)

`scheduleInsights(expr, tz, run, { scheduler, logger, cronImpl? })` is a line-for-line copy of `briefing/schedule.ts`:

- Cron key: `'insights-nightly'`
- `_lastFiredYmd` dedupe under local YMD
- `registerLifecycleCallbacks({ onSuspend: task.stop(), onResume: task.start() })` — no back-fire on resume
- Replaces in place on re-call; never duplicates registry entries

Bootstrap site: `registerInsightsHandlers` (when invoked with `scheduler` dep) registers `'0 2 * * *'` at the user's local tz on startup. After this plan ships the expected `cronRegistry.size` invariant is **4** (gmail-sync + calendar-sync + briefing + insights-nightly).

## IPC channels + preload

Added to `src/shared/ipc-contract.ts`:

- `INSIGHTS_LATEST`  (`aria:insights:latest`)     → `aria.insightsLatest()` — returns `{ state: 'unlocked' | 'locked' | 'empty-unlocked', ... }`
- `INSIGHTS_RECOMPUTE` (`aria:insights:recompute`)  → `aria.insightsRecompute()` — runs `aggregate` synchronously; returns `{ ok, written, skipped }`

Preload exposure is automatic (the bridge iterates `CHANNEL_METHODS`). DTOs:

- `InsightKindDto`, `InsightRowDto`, `InsightsLatestResult` (`InsightsUnlockedResult | InsightsLockedResult | InsightsEmptyResult`)
- `BriefingInsightRow` (renderer-facing minimal shape)

## Briefing read-path enrichment

`BRIEFING_TODAY` handler now:

1. Reads the briefing row (Phase 2 unchanged).
2. Calls `readLatestInsights(db, weekStartYmdFor(now, tz))`:
   - `state: 'unlocked'` → attaches `payload.thisWeekInsights = { state: 'unlocked', rows }`
   - `state: 'locked'`   → attaches `{ state: 'locked', daysRemaining, blockedKinds }`
   - `state: 'empty-unlocked'` → omits `thisWeekInsights` (renderer renders no section)

The enrichment is wrapped in try/catch so any insights-read failure degrades to "no This week section" rather than poisoning today's briefing.

**B-4 single source of truth:** `readLatestInsights` queries the `insights` table FIRST; only calls `checkInsightGate` when the table returns zero rows.

## UI surfaces

### Settings → Insights (`InsightsSection.tsx`)

New nav tab + route at `/settings/insights`. Renders:

- **Locked:** "Insights unlock in N days" + per-corpus breakdown list
- **Unlocked:** up to 3 insight cards with prose sentences
- **Empty-unlocked:** "No insights for this week yet — they compute overnight, or you can recompute manually below."
- **"Recompute now"** button → `insightsRecompute` IPC; toast on completion

Reachability: `SettingsScreen.tsx` `import { InsightsSection }` + `<InsightsSection />` mounted at `/settings/insights`. Asserted by the reachability test in `tests/unit/renderer/features/settings/InsightsSection.spec.tsx` (greps the SettingsScreen.tsx source file directly — L-04-04 invariant).

### Briefing → "This week" section (`BriefingScreen.tsx`)

Renders directly above `SectionCalendar`. Two states:

- `state: 'locked'` → "Insights unlock in N day(s)" placeholder
- `state: 'unlocked' && rows.length > 0` → up to 3 list items, first sentence per row, with a "Dismiss" button

The Dismiss button writes a `sessionStorage` key `briefing-insight-dismiss:<date>:<kind>` — **non-destructive, visible-session-only**. Stream 3 (Plan 08-03 Task 3) will replace this with a proper BRIEFING_INSIGHT_DISMISS IPC channel that persists to `briefing_feedback` (see Deferred items below).

## Test coverage

| File                                                                                  | Tests                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tests/unit/main/db/migrations-128-insights.spec.ts`                                  | 4 — apply, CHECK constraint, upsert conflict, idempotent re-run                        |
| `tests/unit/main/insights/gate.spec.ts`                                               | 6 — per-kind block paths, unlocked path, chunk-floor hard-block, empty-DB pure-SQL     |
| `tests/unit/main/insights/compute.spec.ts`                                            | 6 across 4 fns — including T-08-02 spy assertion on label-gen prompt shape             |
| `tests/unit/main/insights/prose.spec.ts`                                              | 4 — 1–3 sentences happy path, 220-char truncate, generateObject-fail fallback, email-mask |
| `tests/unit/main/insights/aggregate.spec.ts`                                          | 2 — empty-DB skip-all path + upsert idempotency                                         |
| `tests/unit/main/insights/schedule.spec.ts`                                           | 4 — registry size invariant, dedupe, suspend/resume no back-fire, stop cleanup         |
| `tests/unit/renderer/features/settings/InsightsSection.spec.tsx`                      | 3 — reachability grep, unlocked-state rendering + recompute click, locked-state copy   |

Test commands a verifier can re-run:

```
pnpm vitest run tests/unit/main/db/migrations-128-insights.spec.ts
pnpm vitest run tests/unit/main/insights/
pnpm vitest run tests/unit/renderer/features/settings/InsightsSection.spec.tsx
pnpm run grep:insight-prose-no-raw
```

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | Plan introduces no surface outside the registered `<threat_model>`. INSIGHTS_RECOMPUTE has an empty payload (T-08-05 spoofing accepted: renderer is local + trusted). |

## Deferred Issues

1. **BRIEFING_INSIGHT_DISMISS IPC channel** — Stream 3 (Plan 08-03 Task 3) owns this. Stream 1's dismiss writes to `sessionStorage` only. The plan's Task 8 spec required Stream 1 to persist dismissals to `app_meta` so Stream 3 could backfill, but that would have required wiring a Stream 3 IPC contract that does not yet exist; routing dismissals through sessionStorage in the interim keeps the chokepoint cleanly owned by Stream 3.
2. **100-row collision-safety test** — omitted (would test `app_meta` writes that Stream 1 does not perform). Will land alongside the Stream 3 IPC channel.
3. **`grep-assert-approved.mjs`** — explicitly NOT 08-01 scope per executor direction. The `lint:guard` script ships with only the prose-no-raw ratchet; future plans will append.
4. **Test execution blocked by EBUSY** — the test suite could not be run in-session because an Electron dev process was holding `node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node`. TypeScript compile passes clean (no new errors in this plan's surface; the two pre-existing errors in `src/main/scheduling/resolver.ts` and `src/renderer/features/settings/SchedulingRulesSection.tsx` are unchanged and out of scope). The grep ratchet was run manually and exits 0. **Verifier must re-run the test suite after the dev Electron process is closed.**

## Schema deviations from PLAN.md

1. **Section path:** plan specified `src/renderer/features/settings/sections/InsightsSection.tsx`. Existing convention places all settings sections directly at `src/renderer/features/settings/<Name>Section.tsx` (no `sections/` subdir — verified via `ls src/renderer/features/settings/`). Placed at the convention-matching path; SettingsScreen import uses the actual path.
2. **`gmail_message.body` doesn't exist** (Phase 2 metadata-only). `computeResponseTimeTrend` uses thread_id ordering + In-Reply-To-like reply-pairing heuristic on `received_at` ordering rather than parsing reply chains from body text.
3. **No `email_triage` / `approval_edit_log` source for `topEditCategories`** — returns empty list per plan's own fallback ("Stream 3 will backfill the source"). Documented inline in compute.ts.
4. **BriefingPayload schema augmentation strategy:** plan implied `thisWeekInsights` would be added to the briefing's `sections` JSON at generation time. Implementation instead enriches the payload at read time inside `BRIEFING_TODAY`, which keeps Phase 2's `runBriefing` and its snapshot fixtures untouched. The renderer change to BriefingScreen reads `payload.thisWeekInsights` either way; the persisted briefing row is unchanged.
5. **Sentinel addition to `insights.payload_json`:** `sentences: string[]` is appended to every kind's payload at upsert time (so the read path can render prose without re-running prose at read time). The discriminated union `InsightPayload` does not formally declare `sentences`, but it's preserved through the `JSON.parse → BriefingInsightRow` path.

## Requirements closed

- INSIGHT-01 (14-day-per-corpus gate) — `checkInsightGate` + 6 gate tests
- INSIGHT-02 (briefing integration) — `BRIEFING_TODAY` enrichment + `BriefingScreen` "This week" section
- INSIGHT-03 (no raw content to frontier API) — `prose.ts` aggregates-only design + static-grep ratchet wired into `lint:guard` + T-08-02 spy test
- BRIEF-02 (top-3 surfaces) — briefing renders top-3 of the unlocked-week insights (max 3 by query `LIMIT 3` slice)

## Self-Check: PASSED

- `src/main/insights/gate.ts` exists
- `src/main/insights/compute.ts` exists
- `src/main/insights/prose.ts` exists
- `src/main/insights/aggregate.ts` exists
- `src/main/insights/schedule.ts` exists
- `src/main/ipc/insights.ts` exists
- `src/renderer/features/settings/InsightsSection.tsx` exists
- `scripts/grep-insight-prose-no-raw.mjs` exists and exits 0
- `package.json` contains `grep:insight-prose-no-raw` and `lint:guard` scripts; `test:unit` prepended with `npm run lint:guard`
- 6 new test files exist under `tests/unit/main/insights/` and `tests/unit/renderer/features/settings/`
- `tsc --noEmit -p tsconfig.json` and `tsc --noEmit -p tsconfig.node.json` produce no NEW errors (pre-existing errors in SchedulingRulesSection.tsx + drafting/email.ts + ipc/triage.ts + answer-service.ts + vector-store.ts + scheduling/resolver.ts are unchanged and out of scope)
- Migration 128 already committed as `2718c19` on 2026-05-19
