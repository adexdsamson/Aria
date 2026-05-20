---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: ready_to_plan
last_updated: "2026-05-20T04:25:19.439Z"
progress:
  total_phases: 10
  completed_phases: 8
  total_plans: 33
  completed_plans: 30
  percent: 80
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Aria tells the exec what matters today and handles the rest under user oversight (local-first, hybrid LLM, approval-gated).

## Current Phase

**Phase 8 Plan 04 complete (2026-05-20)** — v1 Release Preparation (Stream 4). Closes Phase 7's dangling RAG_ASC wiring + lands the full release pipeline. AnswerService factory hoisted out of the module-local closure (B-2 round 2) into `src/main/rag/answer-service-factory.ts`; first `.get()` with non-null db emits a one-time pino log line (`{ scope: 'answer-service', event: 'factory.constructed' }`) as the cross-process E2E ratchet that replaces the unreachable closure spy. Concrete `LlmInvocation` in `src/main/rag/answer-llm.ts` routes LOCAL vs FRONTIER via existing provider factories with tight `AnswerCitationsSchema` (answer ≤8000 chars, citations 1..20). `runMigrations` extracted out of `openDb` into a single boot call site (B-1 round 2) — onboarding seal/unlock + backup-restore + restore.ts all updated; seal path INVERTED to persist vault.json AFTER successful open+migrate, closing MEMORY `project_aria_seal_not_atomic`. `runMigrationsWithBackup` (`src/main/release/backup-hook.ts`) takes VACUUM-INTO snapshot + records CRITICAL_TABLES counts + throws `MigrationFailedError | RowCountDriftError` carrying `backupPath`; `restoreFromBackup` closes-before-rename (Pitfall 3) + reopens with cached key + `runMigrationsOnOpen: false` (no recursion). `expectedDrops: Record<number, string[]>` is the committed map-argument shape (H-3 round 2); SQL-comment-parsing alternative deleted. `electron-updater@^6.8.3` wired: `startAutoUpdater` (`src/main/release/updater.ts`) with pino-shim logger + autoDownload=false + autoInstallOnAppQuit=true + channel from `ARIA_UPDATE_CHANNEL ?? 'tester'`; UPDATER_CHECK/DOWNLOAD/RESTART/CHANNEL IPC; UpdatesSection mounted at `/settings/updates`. electron-builder config: `appId='com.aria.desktop'`, mac hardenedRuntime + entitlements + notarize.teamId from APPLE_TEAM_ID, win target=['nsis'] with certificateFile/Subject ABSENT per amended XCUT-05 staged signing. REQUIREMENTS.md XCUT-05 + ROADMAP SC-5 amended (tester ships Windows-unsigned, OV at GA); 08-CONTEXT.md M-2 round 2 softened (electron-updater does NOT auto-rollback; user must manually reinstall prior binary; DB snapshot recovers data). RELEASE-RUNBOOK.md — 11 sections (pre-flight w/ mandatory ARIA_E2E_REAL_LLM pre-tag gate, tag/publish, spctl-assess, Windows tester ship + SmartScreen copy, AV submission portals, SmartScreen reputation strategy, channel flip, GH PAT scope, rollback procedure matching softened CONTEXT, EV-cert deferral note, manual packaged-build smoke). `999_force_fail.sql` fixture under `tests/fixtures/` gated by `ARIA_E2E_FORCE_MIGRATION_FAIL=true`, NEVER in embedded.ts; belt-and-suspenders fixture-leak ratchet (`scripts/grep-no-fixture-leak.mjs`) wired into `lint:guard` alongside the new `grep-migration-callsite.mjs`. Two .skip placeholders authored per user's Option A authorization: `tests/integration/rag-ask-smoke.spec.ts` (Mode A + Mode B) + `tests/integration/phase8-happy-path.spec.ts` (steps 1-8 + Step 9 migration-failure restore); both carry `PHASE-8 PRE-RELEASE` marker for the final release-verification un-skip pass. M-3 fixture-leak guard inside phase8-happy-path is ACTIVE (runs unconditionally). 10 commits `5acd75d…4bb414c`. XCUT-04, XCUT-05, RAG-02 closed in REQUIREMENTS.md. Test execution + `pnpm install` + electron-rebuild + Apple Developer ID enrollment all deferred to the final release-verification human checkpoint (same Electron-ABI lock pattern that affected 08-01/02/03 and the Apple-creds checkpoint marked skip). `lint:guard` exits 0 in-session with all 5 ratchets green. **Phase 8 plan 04/04 → 4/4 plans complete. PHASE 8 COMPLETE.**

**Phase 8 Plan 03 complete (2026-05-20)** — Preference Learning + Briefing Feedback (Stream 3). Migration 130 (own file per H-1) adds `learning_signals` + `learned_preferences` (singleton) + `briefing_feedback` + `rag_turn.thumb`. Four signal sources with per-source emit decision tree (B-3 round-2 reversal): **approval=EMIT-AFTER-EXTERNAL-WRITE-SUCCESS** (Test 5 ordering, Test 5b zero-signal-on-throw — T-08-22 mitigation; Phase 4 silent-write architectural followup NOT subsumed); recap/briefing/qa=SAME-TRANSACTION. `signal-log.ts` redactAllPii at write (defense-in-depth). `prefs.ts` zod closed-shape with 5-path whitelist for resetField (T-08-13). `aggregate.ts` deterministic `deriveVoice` over 30d window. `schedule.ts` learning-nightly cron @ 2:30am (cronRegistry.size invariant=6); `runLearningNightly` calls aggregate THEN `purgeOldSignals(keepDays:90)` gated on `settings.learning_signals_keep_forever != 1` (M-4 round-2 fix; Test 10 + 11). 7 IPC channels. LearnedPreferencesSection reachable from SettingsScreen (L-04-04) with 3-assertion DisconnectConfirmDialog pattern on per-field + reset-all. BriefingFeedbackChips wired per section (BRIEF-05). AnswerCard thumbs → RAG_TURN_FEEDBACK. W-4 backfill: `drainAppMetaDismissBacklog` drains 08-01's app_meta dismiss-log on first boot. topEditCategories pipeline closes 08-01 deferred + 08-02 Schema dev #5. `grep:no-network-from-signals` static ratchet wired into `lint:guard` (exits 0 in-session). `src/main/sentry/beforeSend.ts` allowlist scaffold. XCUT-02 crash-persistence integration test asserts no orphan signals across simulated crash. 7 commits `094e265 … 65154b1`. LEARN-01/02/03, BRIEF-04, BRIEF-05, XCUT-02 closed in REQUIREMENTS.md. Test execution deferred under the same Electron ABI lock that affected 08-01/02; `lint:guard` exits 0 in-session. **Phase 8 plan 03/04 → 3/4 plans complete.**

**Phase 8 Plan 02 complete (2026-05-20)** — Weekly Recap + `action_audit_log` VIEW. Migration 129 (own file per H-1) introduces the VIEW unioning send_log (provider preserved, H-4) + calendar_action_log (phase IN post_write/failed/override, B-1) + meeting_action_task_link+todoist_task + approval(rejected). `weekly_recap` + `weekly_recap_section_edit` tables; Monday-08:00 cron with `_lastFiredIsoWeek` dedupe; two-pass narrative cross-validation (research Pitfall 6) — narrative is truncated when an actionRef is missing from the audit ID set, `hallucinationDetected` is surfaced. `RecapCanonical` zod schema is the single shape between TipTap editor and DOCX + PDF exporters (no HTML round-trip, Pitfall 7). 8 IPC channels, `/recap` route + SideNav entry. `verify-audit-view` static ratchet + base-table column snapshot wired into `lint:guard`. 7 commits `c96127a…5a53cee`. RECAP-01..04 all closed. Test execution deferred under the same Electron ABI lock that affected 08-01; `lint:guard` exits 0 in-session.

**IPC schema-drift fix (2026-05-19, commit f44ffd4)** — Settings → Integrations Gmail block was rendering `Could not connect: no such table: gmail_account` because `GMAIL_CONNECT` still INSERT-OR-REPLACEd the legacy singleton table dropped by migration 014. Routed Gmail + Calendar IPC writes to `provider_account` (capability-merging UPSERT preserves SC3 per-kind disconnect scope) + `provider_sync_state`. Reads now use the legacy `gmail_account_view` / `calendar_account_view` (designed as compat shims by migration 014). Also fixed the symmetric `getUserEmail` SELECT in scheduling handler. Deferred: `sync-gmail.ts` / `sync-calendar.ts` still SELECT/UPDATE the dropped base tables for cursor advance — caught by `runTick` try/catch and surfaces as a non-fatal "Last sync" line in the UI; deeper cursor-pathway lift is a follow-up.

**Phase 7 UAT Gaps 8 + 9 closed (2026-05-19, commits 88e2736 + 3525079 + bd07779)** — Gap 8: migration 127 rebuilds `rag_source_dirty` with a COALESCE-based UNIQUE INDEX so NULL `target_model_id` no longer breaks `INSERT OR IGNORE` dedupe (backfill resumability restored). Gap 9: rewrote `people-directory-10.json` fixture into the structured shape consumed by `person-resolver.test.ts` (`displayName`/`canonicalEmail`/`aliases`/`cases`) and updated `people-directory.test.ts` to match. Targeted Phase 7 suite now **153/0/0** — fully green. Only Gap 6 (Ollama precondition) remains, and it lives in the integration tier by design.

**Phase 7 UAT Gap 7 closed (2026-05-19, commit 2458e98)** — Renamed `app_meta(key, value)` → `(k, v)` across Phase 7 modules to match migration 001's canonical schema. 17 previously-failing tests turned green; targeted Phase 7 suite now 130/2/1 (remaining 2 are pre-existing, unrelated).

**Phase 7 Plan 03 complete** — User-facing Q&A loop: hybrid BM25 + vector + RRF retrieval reading denormalized title + cached sensitivity (C5/C8/C12), person-mention resolver w/ local-LLM disambiguation + 24h directory-staleness (C10), answer router as a PURE function over chunk.sensitivity (zero classifier calls per query — C5) + XML-wrapped context AND thread history with explicit data semantics (C6), redaction-roundtrip util lifted from tokenize.ts (C4), answer service w/ 4 distinct result kinds (answer/refusal/error/disambiguation), 7 new IPC channels, global Cmd/Ctrl+K palette via cmdk@1.1.1 w/ thread-seeded Expand-to-chat (C9), /ask chat panel w/ TZ-correct timestamps + account chips from IPC payload + ?thread= hydration, disconnected-account RAG wipe UI. 8 tasks + 1 gate fix = 9 commits (`3efc6a1…2e0e4b9`). All grep gates green. Tests written but unrun (Aria desktop app holds the better-sqlite3 ABI lock). AnswerService↔IPC factory wiring deferred to a follow-up plan or Phase 8 hookup. **Phase 7 complete (3/3 plans).**

**Phase 7 Plan 02 complete** — RAG index online: VectorStore dual-impl (sqlite-vec + brute-force fallback w/ 250k cap, C11/C2), Ollama `/api/embed` client + mandatory live-roundtrip contract (C13), IndexWriter w/ sensitivity-at-index-time (C5), IndexWorker w/ atomic rebuild_progress_done (Pitfall 4), ReindexScheduler + model-swap boot reconciler (C3, 4 cases), opt-in backfill, people directory w/ inline + cron freshness paths (C10), Settings → RAG Index UI reachable from SettingsScreen.tsx (L-04-04). 11 tasks, 11 atomic commits (`faba095…4ebc206`). Live OLLAMA_AVAILABLE=1 + RAG_BENCH=1 gates deferred to phase verification (Aria desktop app holds the native-binary lock — same constraint as 07-01).

**Phase 7 Plan 01 complete** — RAG indexing foundation: migration 126 schema, chunk primitives, four-corpus harvesters, three chunking strategies, synthetic-fixture spike. Provisional winner `A-per-message`; replace synthetic fixture with real-DB user-authored fixture before plan 07-02 commits chunk-size (see 07-01-SUMMARY.md `Deferred / Followups` item 1). Task 0 human-action checkpoint was overridden by user authorization on 2026-05-19.

**Phase 4 complete (pending verification)** — All 3 waves landed. Wave 3 (04-03 NL pipeline + SchedulingChat + ApprovalCard calendar variant + APPR-02 dispatch) green: 43 scheduling unit tests + 2 skip-tolerant e2e specs. SC-1 demonstrable: "move my 3pm to Thursday" → ProposeResult with conflict check → approve → applyCalendarChange chokepoint.

## Phase Status

- [x] Phase 1: Foundation
- [x] Phase 2: Gmail + Daily Briefing MVP (pending verification)
- [ ] Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send
- [ ] Phase 4: Calendar Smart-Scheduling (Google)
- [ ] Phase 5: Outlook Parity (email + calendar)
- [ ] Phase 6: Meeting Capture + Todoist Push
- [x] Phase 7: RAG Q&A
- [x] Phase 8: Insights, Recap, Learning, Release Prep (pending verification)

## Next Action

Phase 8 is now code-complete (4/4 plans). Next: `/gsd-verify-work 8` once `pnpm install` runs (Apple creds + electron-rebuild gate). Phase 9 (product UI from Anthropic design system) is unblocked and follows. Phase 2/4/7/8 verification still pending. Cross-phase open items: Phase 3 CR-01 fail-OPEN gate (blocks GA); Phase 4 latent bugs from UAT (MEMORY project_aria_phase4_complete).

## Accumulated Context

### Roadmap Evolution

- Phase 9 added: Implement product UI from Anthropic design system (design ref VGTQmBNc8uXN62kH9DBTXA) — fetch design + README, apply to product UI, integrate logo; landing page out of scope
- Phase 08.1 inserted after Phase 8: Subscription + 60-day trial (Stripe, license-key + periodic online check, no-card trial on first launch) — inserted before Phase 9 UI so paywall ships on new design system (URGENT)

### Phase 7 Followups

- 2026-05-20 — Gap 10 closed (bdb8693): destructive integration disconnect now gated by `DisconnectConfirmDialog` with explicit RAG-wipe copy; symmetric across Gmail, Calendar, Todoist, and generic provider-account rows. Matches CLAUDE.md approval-gating principle and plan 07-03 task 8 "confirm before wipe" contract.

## Workflow Config

- Mode: YOLO (auto-approve)
- Granularity: Standard
- Parallelization: Parallel
- Commit docs: Yes
- Research: Yes
- Plan check: Yes
- Verifier: Yes
- Model profile: Balanced (Sonnet)
