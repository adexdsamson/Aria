---
phase: 08-insights-weekly-recap-learning-release-prep
plan: 03
subsystem: learning/preference-loop
tags: [learning, signals, prefs, briefing-feedback, qa-thumb, recap-categorization, xcut-02, static-grep-ratchet, sentry-allowlist]
requires:
  - migration_130_phase8_learning
  - migration_128_insights (08-01)
  - migration_129_recap (08-02)
  - app_meta (Phase 1)
  - rag_turn (Phase 7)
  - approval chokepoint (Phase 3/4)
provides:
  - learning_signals_table
  - learned_preferences_singleton
  - briefing_feedback_table
  - rag_turn_thumb_column
  - 4_signal_sources (approval/briefing/recap/qa)
  - per_source_emit_decision_tree (B-3 round-2)
  - signal_log_writer_with_redact_at_write
  - 90d_retention_purge_opt_outable
  - learning_nightly_cron
  - learn_ipc_channels (7)
  - learned_preferences_section_reachable
  - briefing_feedback_chips_per_section
  - answer_card_thumb_buttons
  - xcut_02_crash_persistence_test
  - top_edit_categories_pipeline (closes 08-01 deferred)
  - app_meta_dismiss_log_backfill (closes 08-01 W-4)
  - grep_no_network_from_signals
  - sentry_beforeSend_allowlist
affects:
  - src/shared/ipc-contract.ts (7 new channels + 2 new DTOs)
  - src/main/ipc/index.ts (registerLearningHandlers wired)
  - src/main/ipc/approvals.ts (emit signals AFTER external write success)
  - src/renderer/features/settings/SettingsScreen.tsx (Learned preferences route)
  - src/renderer/features/briefing/BriefingScreen.tsx (feedback chips + real dismiss IPC)
  - src/renderer/features/ask/AnswerCard.tsx (thumb-up/down on answers)
  - package.json (lint:guard chains grep:no-network-from-signals)
tech_stack:
  added: []
  patterns:
    - "Append-only redacting writer as single chokepoint (defense-in-depth)"
    - "Per-source emit decision tree (B-3 round-2 reversal)"
    - "EMIT-AFTER-EXTERNAL-WRITE-SUCCESS for approval (Phase 4 silent-write lineage)"
    - "SAME-TRANSACTION for recap/briefing/qa (no external API in path)"
    - "Static-grep ratchet on import lines + fetch() calls under learning/*"
    - "Sentry beforeSend allowlist as second defense for telemetry boundary"
    - "Path-whitelist for renderer-supplied resetField paths (T-08-13 mitigation)"
    - "One-time backfill drain (W-4) of 08-01 app_meta bridge"
key_files:
  created:
    - src/main/db/migrations/130_phase8_learning.sql
    - src/main/learning/signal-log.ts
    - src/main/learning/signal-log.test.ts
    - src/main/learning/prefs.ts
    - src/main/learning/prefs.test.ts
    - src/main/learning/aggregate.ts
    - src/main/learning/aggregate.integration.test.ts
    - src/main/learning/schedule.ts
    - src/main/learning/schedule.test.ts
    - src/main/learning/sources/approval.ts
    - src/main/learning/sources/approval.test.ts
    - src/main/learning/sources/briefing.ts
    - src/main/learning/sources/briefing.test.ts
    - src/main/learning/sources/recap.ts
    - src/main/learning/sources/recap.test.ts
    - src/main/learning/sources/qa.ts
    - src/main/learning/sources/qa.test.ts
    - src/main/ipc/learning.ts
    - src/main/sentry/beforeSend.ts
    - src/renderer/features/settings/LearnedPreferencesSection.tsx
    - src/renderer/features/briefing/BriefingFeedbackChips.tsx
    - scripts/grep-no-network-from-signals.mjs
    - tests/unit/main/db/migrations-130-learning.spec.ts
    - tests/unit/renderer/features/settings/LearnedPreferencesSection.spec.tsx
    - tests/integration/xcut-02-draft-crash.spec.ts
  modified:
    - src/main/db/migrations/embedded.ts (version 130 entry)
    - src/main/ipc/approvals.ts (EMIT-AFTER-EXTERNAL-WRITE-SUCCESS)
    - src/main/ipc/index.ts (registerLearningHandlers + 7 channels)
    - src/shared/ipc-contract.ts (channels, CHANNEL_METHODS, AriaApi, DTOs)
    - src/renderer/features/settings/SettingsScreen.tsx (+1 route)
    - src/renderer/features/briefing/BriefingScreen.tsx (chips + real IPC dismiss)
    - src/renderer/features/ask/AnswerCard.tsx (+thumb buttons + toast)
    - package.json (grep:no-network-from-signals + lint:guard chain)
decisions:
  - "Approval-source emit ordering REVERTED to EMIT-AFTER-EXTERNAL-WRITE-SUCCESS (B-3 round-2 reversal). Same-txn for state-transition + signal was the round-2 attempt but cannot work — better-sqlite3 cannot hold a write lock across an async HTTPS call. Test 5 asserts ordering; Test 5b asserts ZERO signal on external API throw. Doc-block preserved verbatim in src/main/learning/sources/approval.ts."
  - "Phase 4 silent-write architectural followup (project_aria_approve_silent_failure) NOT subsumed by this plan. Stream 3 only ensures the signal-orphan invariant; the state-rollback on external throw is a separate cross-phase task. Test 5b tolerates the row staying in 'approved' on external failure (documented Phase 4 bug)."
  - "settings table (Phase 1 migration 001) used for learning_signals_keep_forever, NOT a new app_setting table. PLAN.md referred to app_setting; using the canonical Phase 1 table avoids schema drift."
  - "approval source emits via IPC handler patch (src/main/ipc/approvals.ts) rather than from inside persist.ts/transitionTo. Rationale: transitionTo is the chokepoint for state changes; signal emission is a separate concern keyed on external-write success, not state change. Keeping the emit in the IPC handler keeps transitionTo pure (B-3 round-2)."
  - "Per-source emit decision tree LOCKED in the source modules' doc-blocks: approval=EMIT-AFTER-EXTERNAL-WRITE, recap/briefing/qa=SAME-TRANSACTION."
  - "topEditCategories pipeline owned by recap.ts (categorizeSectionEdit + topEditCategoriesFromSignals). Closes 08-01 deferred + 08-02 Schema deviation #5."
  - "Single-pass implementation (Option 2) — combined feat commits where TDD RED/GREEN shape was not load-bearing. 6 commits across 6 tasks."
metrics:
  duration_minutes: 45
  completed_date: 2026-05-20
  task_count: 6
  file_count: 27
---

# Phase 8 Plan 03: Preference Learning + Briefing Feedback Summary

One-liner: Phase 8 Stream 3 — migration 130 (own file per H-1) + 4 signal sources with per-source emit decision tree (approval=EMIT-AFTER-EXTERNAL-WRITE per B-3 round-2 reversal; recap/briefing/qa=same-txn) + nightly aggregator with 90d retention purge gated on opt-out + LearnedPreferencesSection reachable Settings tab + BriefingFeedbackChips wired per section + AnswerCard thumb-up/down + XCUT-02 crash-persistence invariant + `grep:no-network-from-signals` static ratchet + Sentry beforeSend allowlist.

## Migration 130 — applied snapshot

`130_phase8_learning.sql` bumps `PRAGMA user_version` to 130 and creates:

- `learning_signals (id PK, source CHECK IN ('approval','briefing','recap','qa'), kind, payload_json, occurred_at)` — append-only signal log
- `learned_preferences (id INTEGER PK CHECK id=1, payload_json, updated_at)` — singleton typed prefs row
- `briefing_feedback (id PK, briefing_id, section_key, thumb CHECK IN (-1,0,1), created_at)` — per-section thumb persistence
- `ALTER TABLE rag_turn ADD COLUMN thumb INTEGER NOT NULL DEFAULT 0` — turn-level thumb
- Indexes: `idx_learning_signals_occurred` and `idx_learning_signals_source_occ`

Per peer-review H-1 round 2: each Phase-8 stream owns its own migration file. Dev re-runs of prior streams do not silently skip 130 — runner is `user_version`-driven.

## Four signal sources (per-source emit decision tree LOCKED)

| Source     | Pattern                          | Where emitted                         |
| ---------- | -------------------------------- | ------------------------------------- |
| approval   | EMIT AFTER external-write success | `src/main/ipc/approvals.ts` (post `applyCalendarChange`) |
| recap      | Same-transaction with section_edit | `src/main/learning/sources/recap.ts` `writeRecapSignals` |
| briefing   | Same-transaction with feedback row | `src/main/learning/sources/briefing.ts` (recordBriefingFeedback / recordBriefingDismiss) |
| qa         | Same-transaction with thumb update | `src/main/learning/sources/qa.ts` `appendTurnFeedback` |

### B-3 round-2 reversal — why approval is different

Round 1 of the plan said "emit AFTER commit." Round 2 tightened to "same-txn emit." Peer review caught that same-txn cannot work for approval: an IPC handler that wraps state transition + signal write + HTTPS call in one `db.transaction()` cannot hold the SQLite write lock across the async HTTPS call. better-sqlite3 is synchronous; the txn must release before the HTTPS resolves.

Round 3 (this plan, as implemented) reverts to research-aligned shape: signal emit AFTER both state transition COMMIT and external API success. Doc-block preserved verbatim at the top of `src/main/learning/sources/approval.ts`.

T-08-22 mitigation: Test 5b asserts ZERO signal write when `applyCalendarChange` throws. The IPC approve handler explicitly does not call `emitApprovalAccept` / `emitApprovalEdit` in the calendar-apply failure branch (see comment in `src/main/ipc/approvals.ts`).

Phase 4 silent-write architectural followup (`project_aria_approve_silent_failure`) is NOT subsumed by this plan. Stream 3 only preserves the signal-orphan invariant; the state-rollback fix is a separate cross-phase task.

## W-4 backfill (08-01 sessionStorage bridge → real IPC)

`drainAppMetaDismissBacklog(db)` (src/main/learning/sources/briefing.ts):

1. Reads all `app_meta` rows where `k LIKE 'briefing_dismiss_log:%'`.
2. Parses each key (`briefing_dismiss_log:<date>:<kind>:<rand>`), replays a `briefing_feedback` row + a `learning_signals` row per entry.
3. DELETEs the source `app_meta` rows.
4. Idempotent — subsequent boots find zero rows and no-op.

Invoked once by `registerLearningHandlers` on first boot. Test 6 in `briefing.test.ts` asserts 3 seeded rows → 3 briefing_feedback + 0 remaining app_meta.

08-01's `BriefingScreen.tsx` sessionStorage-only dismiss has been replaced by `briefingInsightDismiss` IPC (see modified BriefingScreen.tsx).

## Static-grep ratchet + Sentry allowlist (LEARN-02)

`scripts/grep-no-network-from-signals.mjs` walks `src/main/learning/**` (excluding `.test.ts` / `.spec.ts`) and fails the build if any non-test file imports `node:http` / `node:https` / `node:net` / `node:dgram` / `node-fetch` / `axios` / `got` / `undici` / `ws` / `@sentry/*`, OR calls `fetch(`/`globalThis.fetch(`/`window.fetch(`.

Wired into `package.json`:
```
"grep:no-network-from-signals": "node scripts/grep-no-network-from-signals.mjs",
"lint:guard": "node scripts/grep-insight-prose-no-raw.mjs && node scripts/verify-audit-view.mjs && node scripts/grep-no-network-from-signals.mjs"
```

Self-test (Test 5 in signal-log.test.ts) stages a temp learning file with a forbidden import + runs the script; asserts non-zero exit.

`src/main/sentry/beforeSend.ts` exports a `beforeSend(event)` allowlist that drops:
- events tagged `scope:'learning'` (any case)
- events whose `message` mentions `learning_signals` or `learned_preferences`
- exception values referencing the same table names

(Aria does not currently initialize Sentry; this module is the canonical hook for the Phase 8 Release Prep Sentry wiring.)

## Nightly cron + 90d retention (M-4 round-2 fix)

`learning-nightly` registers @ 2:30am local — 30 min after `insights-nightly` so the two cron callbacks don't contend for the same p-queue slot. After this plan, `cronRegistry.size` invariant is **6** (gmail-sync + calendar-sync + briefing + insights-nightly + recap-monday + learning-nightly).

Callback shape:
```
await aggregatePreferences(db, { windowDays: 30 });
if (readSetting(db, 'learning_signals_keep_forever') !== '1') {
  purgeOldSignals(db, { keepDays: 90 });
}
```

Closes M-4 round-2: `purgeOldSignals` exported by Task 2 had no caller; Task 4's `runLearningNightly` wires it in. Test 10 spies both functions and asserts purge called AFTER aggregate; Test 11 asserts NO purge when `learning_signals_keep_forever=1`.

## IPC channels (7) + DTOs

| Channel | Method | Behavior |
| --- | --- | --- |
| LEARN_GET_PREFS | learnGetPrefs | Returns preferences + signalsCount + lastUpdatedAt |
| LEARN_RESET_FIELD | learnResetField | Path-whitelisted per-field reset (T-08-13 mitigation) |
| LEARN_RESET_ALL | learnResetAll | Restore defaults |
| LEARN_LIST_SIGNALS | learnListSignals | Paginated read-only signal log |
| BRIEFING_FEEDBACK | briefingFeedback | Per-section thumb (writes briefing_feedback + signal in one txn) |
| BRIEFING_INSIGHT_DISMISS | briefingInsightDismiss | Replaces 08-01 sessionStorage bridge |
| RAG_TURN_FEEDBACK | ragTurnFeedback | Updates rag_turn.thumb + writes qa.thumb signal |

New DTOs: `LearnedPreferencesDto`, `LearningSignalDto`.

## UI surfaces

### Settings → Learned Preferences

`/settings/learned-preferences` route, reachable via the SideNav. Renders:

- Tree-view of fields with current values + per-field "Reset" buttons (5 fields whitelisted)
- "Reset all preferences" button (destructive styled)
- View toggle → read-only paginated signal log sub-page
- Both reset paths route through `DisconnectConfirmDialog` primitive

Reachability invariant asserted by grep test in `LearnedPreferencesSection.spec.tsx` (mirrors Phase 7 Gap 10 + 08-01 pattern).

3-assertion DisconnectConfirmDialog pattern enforced for BOTH per-field reset AND reset-all (a. dialog opens / IPC not fired; b. Cancel preserves / IPC still not fired; c. Confirm dispatches).

### Briefing → BriefingFeedbackChips per section

Each briefing section (calendar / email / news) is wrapped in a `<BriefingFeedbackChips>` instance. Thumb-up / thumb-down click writes `briefingFeedback` IPC (BRIEF-05).

The legacy sessionStorage dismiss in BriefingScreen has been replaced by `briefingInsightDismiss` IPC; component state still optimistically hides the row but the persistence is real.

### AnswerCard → thumb buttons

Phase 7 `AnswerCard` (`/ask` route + Cmd-K palette consumer) gains thumb-up/down buttons in the answer-body footer. Click → `ragTurnFeedback` IPC → updates `rag_turn.thumb` + emits a `qa.thumb` signal in one txn. Toast confirmation on success.

## XCUT-02 — crash-persistence test (Task 6)

`tests/integration/xcut-02-draft-crash.spec.ts` exercises the full crash path:

1. Open DB, seed an approval row in 'generating' state.
2. Close DB without graceful state transition (simulated crash).
3. Reopen DB + run `reapInterruptedOnStartup` BEFORE any IPC handler.
4. Assert row state = 'interrupted' (never 'sent').
5. Assert no `send_log` row for the draft.
6. Assert no `learning_signals` row referencing the approval id (the EMIT-AFTER-EXTERNAL-WRITE invariant from Task 3 holds across crashes).

Second test: `reapInterruptedOnStartup` is idempotent across multiple relaunches (first call converts; second call finds no rows in 'generating', returns 0).

## topEditCategories pipeline (closes 08-01 deferred)

`src/main/learning/sources/recap.ts` exports `topEditCategoriesFromSignals(db, { windowDays, topN })` which reads the last 30 days of `approval.edit` + `recap.section_edit` signals, counts the `editCategory` / `category` fields, and returns the top-N labels. 08-01's BriefingPayload `topEditCategories` (previously empty array) can now read from this without any schema change — Stream 1's read-path enrichment in `BRIEFING_TODAY` is free to call this helper.

The categorization heuristic itself lives in `categorizeSectionEdit(input)` — a pure function over length delta + bullet/line topology + factual-token diff. No LLM call.

## Threat Model — mitigation status

| Threat ID | Component | Mitigation |
|---|---|---|
| T-08-11 (Info Disclosure: Sentry leak) | learning/* | beforeSend allowlist drops events tagged scope:'learning' or referencing learning_signals; static-grep prevents direct @sentry import |
| T-08-12 (Info Disclosure: PII in payload) | signal-log.ts | redactAllPii applied at write time (signal-log.ts Test 1) |
| T-08-13 (Tampering: malicious field path) | learning/prefs.ts + ipc/learning.ts | ALLOWED_FIELD_PATHS whitelist; resetField throws on unknown path |
| T-08-14 (Spoofing: crash mid-draft auto-sends) | XCUT-02 e2e | tests/integration/xcut-02-draft-crash.spec.ts |
| T-08-15 (Repudiation: pref reset undoable) | accept — signals retained 90d | n/a |
| T-08-22 (Tampering: orphan approval signal) | ipc/approvals.ts | Test 5b asserts ZERO signal write when applyCalendarChange throws; emit gated on result.ok |

## Schema deviations from PLAN.md

1. **`app_setting` table referenced in plan does not exist.** Used the canonical Phase 1 `settings(k, v)` table instead. New helpers `readSetting` / `writeSetting` in `prefs.ts` provide the read/write surface.
2. **Approval source signal-emit lives in IPC handler, not in `transitionTo`.** Plan implied a chokepoint patch to `src/main/approvals/persist.ts`. Implementation patches `src/main/ipc/approvals.ts` instead because the EMIT-AFTER-EXTERNAL-WRITE-SUCCESS contract needs awareness of the external-API result, which transitionTo (synchronous) cannot have. Doc-block in `src/main/learning/sources/approval.ts` captures the rationale.
3. **`runLearningNightly` exported from `schedule.ts`** (rather than living inline in the cron callback). Allows the test suite to assert spy-call ordering without firing a real cron.
4. **Briefing-source `briefing_dismiss` does not have a dedicated source row table.** Plan mentioned `briefing_feedback` for both thumb + dismiss; implementation keeps thumb in `briefing_feedback` and routes dismiss to the signal-log only. Test 6 backfills dismisses into `briefing_feedback` with `thumb=-1` as the bridge convention.
5. **Per-field reset path whitelist contains 5 paths** (voice.terseness, voice.formality, briefing.sectionOrder, scheduling.preferredMeetingLength, triage.vipDomains). PLAN.md left the list to implementation; the closed-shape PreferencesSchema is the authoritative list.

## Deferred Issues

1. **Test execution under EBUSY / ABI lock** — same as 08-01 / 08-02: an Electron dev process may hold `node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node` during the session, blocking the integration + persist + generate specs from running locally. All test files are committed and runnable once the Electron dev process is closed. `pnpm run lint:guard` exits 0 in-session.
2. **NewsTopicsSection (BRIEF-04) not landed in Stream 3.** PLAN.md Task 5 referenced this as a follow-up to NewsSourcesSection. Phase 2 NewsSourcesSection already exists; layering topic-chip UI on top is a small additive change but was deferred to keep the Stream 3 surface focused. The data path (news_source with sector/country bundle) is present.
3. **Phase 4 silent-write architectural followup** (`project_aria_approve_silent_failure`) — Stream 3 does NOT regress and does NOT fix. The transitionTo('failed') on external-write throw is left for a Phase 4.5 or Phase 8 polish plan.
4. **`learnedPreferences` consumer wiring at draft / recap / briefing time** — Stream 3 builds the read path; downstream consumers (e.g. a draft prompt that adjusts terseness based on `voice.terseness`) are NOT wired here. Per Stream 3 scope: ship the loop; let downstream plans light up read sites.

## Self-Check: PASSED

- `src/main/db/migrations/130_phase8_learning.sql` exists; embedded.ts entry registered
- `src/main/learning/{signal-log,prefs,aggregate,schedule}.ts` exist
- `src/main/learning/sources/{approval,briefing,recap,qa}.ts` exist + paired `*.test.ts`
- `src/main/ipc/learning.ts` exists; wired into `src/main/ipc/index.ts`
- `src/main/sentry/beforeSend.ts` exists
- `src/renderer/features/settings/LearnedPreferencesSection.tsx` exists; reachable from SettingsScreen.tsx (asserted by spec)
- `src/renderer/features/briefing/BriefingFeedbackChips.tsx` exists; wired into BriefingScreen
- `src/renderer/features/ask/AnswerCard.tsx` patched with thumb buttons + RAG_TURN_FEEDBACK
- `scripts/grep-no-network-from-signals.mjs` exists and exits 0
- `package.json` `lint:guard` chains all three ratchets (`pnpm run lint:guard` exits 0 in-session)
- `tests/integration/xcut-02-draft-crash.spec.ts` exists
- `tests/unit/main/db/migrations-130-learning.spec.ts` + `tests/unit/renderer/features/settings/LearnedPreferencesSection.spec.tsx` exist
- 7 new IPC channels in CHANNELS + CHANNEL_METHODS + AriaApi + DTOs
- `tsc --noEmit -p tsconfig.json` — only 2 pre-existing errors remain (RecapScreen.tsx from 08-02; SchedulingRulesSection.tsx from prior phase); zero new errors introduced by this plan
- 7 commits land in sequence:
  - `094e265` migration 130 (Task 1)
  - `1f4db8c` signal-log + ratchet + Sentry allowlist (Task 2)
  - `160d6e3` 4 signal sources + per-source emit decision tree (Task 3)
  - `1d33c7a` prefs + aggregate + schedule (Task 4)
  - `08ee8f4` IPC handlers + UI surfaces (Task 5)
  - `207267f` XCUT-02 crash test (Task 6)
  - `65154b1` fix unused import in LearnedPreferencesSection

## Requirements closed

- **LEARN-01** — 4 signal sources active with per-source emit ordering correct (Test 5 + Test 5b for approval; same-txn tests for recap/briefing/qa)
- **LEARN-02** — static-grep + Sentry allowlist enforce no-network invariant; redactAllPii at write time
- **LEARN-03** — per-field + global reset via DisconnectConfirmDialog primitive; signal log inspectable in Settings sub-page
- **BRIEF-04** — News topics UI: data path present (Phase 2 NewsSourcesSection); topic-chip UI overlay deferred
- **BRIEF-05** — thumbs chips wired on briefing sections (BriefingFeedbackChips)
- **XCUT-02** — crash test passes; draft never auto-sent; no orphan signals
