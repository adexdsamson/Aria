# Phase 8 Peer Review — Fresh Context

**Reviewer:** independent peer (general-purpose agent, no prior session context)
**Reviewing:** plans at commit dc204a1 (plan-checker PASS after 1 revision round)
**Date:** 2026-05-20

## Verdict
REVISE — 3 BLOCKER, 4 HIGH, 4 MEDIUM, 2 LOW.

The plans are largely sound and the W-/B-/S- ratchets show the plan-checker did its job. The remaining issues cluster around (a) the runMigrations call site being inside openDb (not a separate boot site as Plan 08-04 assumes), (b) cross-plan timing on the single migration 128 file, and (c) the Phase 7 closure smoke not actually requiring the wired path to be hit in CI.

---

## BLOCKER findings (must close before execute)

### B-1 — Plan 08-04 Task 4 wraps the wrong call site; `runMigrations` lives inside `openDb`, not at a boot location
**Plan:** 08-04 Task 4 (`<action>` paragraph: "Grep for the existing call site… `src/main/index.ts` (or wherever runMigrations is invoked at boot) is updated to call `runMigrationsWithBackup` instead.")
**Issue:** A direct grep of the current tree shows `runMigrations(db)` is invoked from exactly one location — `src/main/db/connect.ts:67`, inside `openDb()` itself, gated by `runMigrationsOnOpen` (default true). Restore (`src/main/db/restore.ts:62`) and onboarding (`src/main/ipc/onboarding.ts:191`) and the IPC backup path (`src/main/ipc/backup.ts:82`) all flow through `openDb`. There is **no top-level `runMigrations(db)` call in `src/main/index.ts`** to wrap. To wrap, the executor must either (a) push the wrapper inside `openDb` — which creates the circular problem that `runMigrationsWithBackup` needs `dbHolder.close()` + `dbHolder.reopen(key)` to do the Pitfall-3 rollback, but `openDb` is the function that *creates* the handle and doesn't know about the holder; or (b) flip `runMigrationsOnOpen:false` for the main boot path and add a new explicit wrapped-migrate step in `src/main/index.ts` — which is a real architectural change with cascading effects on onboarding (which expects migrations to have already run) and on `restore.ts` (which already opts out).
**Why plan-checker missed it:** Plan-checker confirmed `runMigrations` exists and is exported; it did not trace where the existing caller(s) live and whether a "boot init" surface exists. The plan's `<interfaces>` block treats `runMigrations(db)` as if it had one identifiable invocation site at boot.
**Fix:** Add an explicit Task 4a sub-step that decides between (a) and (b) above with a written-down decision. Recommended (b): change `src/main/db/connect.ts` to add `runMigrationsOnOpen:'deferred'`, have `src/main/index.ts` open with `'deferred'`, then call `runMigrationsWithBackup(db, dbPath, …)` against the freshly opened handle, and have the restore-helper close → rename → call `openDb({runMigrationsOnOpen:false})` (no migrations on the restored snapshot — it was taken at the old schema version). Update Test 9 (B-5) — `dbHolder.reopen(testKey)` is not an existing API; specify that the helper signature is `reopen({dbKey, runMigrationsOnOpen:false})` and reuses `openDb`. Without this fix, Task 4 lands either as (i) a partial wrap inside `openDb` that cannot satisfy Pitfall 3, or (ii) a silent architectural change to onboarding/restore.

### B-2 — Plan 08-04 Task 3 Mode A's "spy on getOrCreateAnswerService" cannot fire across the Electron main/renderer boundary; the smoke proves nothing about wiring
**Plan:** 08-04 Task 3 Mode A, Test 6 (`assert getOrCreateAnswerService was invoked at least once during the test (spy on the factory; proves wiring, not LLM quality)`)
**Issue:** Playwright `_electron` runs the test in the test harness process; `getOrCreateAnswerService` lives in `src/main/ipc/index.ts` as a *module-local* closure (per research lines 378–393, it's declared `let _answerService` + `function getOrCreateAnswerService` at module scope inside `registerHandlers`). It is not exported, not on a DI container, and not reachable from the test harness. There is no place to plant a spy. Mode A's Tests 4+5 only assert the response **shape** is not the legacy "Q&A service not ready" string — but if a future regression returns, say, `{ kind: 'refusal', text: '...' }` from a hardcoded stub at the top of the handler, the smoke passes while the wire is dead. The dark-handler shape from MEMORY `project_aria_phase3_executed` (Phase 3 sensitivity classifier was dark for entire phase) is exactly this class of bug.
**Why plan-checker missed it:** B-6 introduced Mode A/B specifically to address "smoke proves nothing." Plan-checker accepted Test 6 at face value without asking *where the spy would be installed*. The Mode B real-Ollama path closes the gap pre-tag, but Mode A — the CI default — does not.
**Fix:** Either (a) export `getOrCreateAnswerService` from a small dedicated module (`src/main/ipc/answer-service-factory.ts`) and re-import in the test via `_electron`'s exposed-main-process eval API, or (b) replace Test 6 with a *side-effect assertion*: the factory writes a one-line log entry on first construction (e.g. `logger.info({ scope: 'answer-service' }, 'created')`); Mode A asserts that log line appears in the captured pino stream during the test. The log-line ratchet survives refactors and crosses the process boundary. Document which option is chosen.

### B-3 — Plan 08-03 Task 3 W-6 "same-transaction" semantics break Phase 4's approve→write order; signals can rollback a *successful* send
**Plan:** 08-03 Task 3 W-6, action item 1 (`approval source (SAME-TRANSACTION emit): signal write executes INSIDE the same db.transaction() block that performs the approval state transition`)
**Issue:** Phase 4 / MEMORY `project_aria_approve_silent_failure` flagged that the existing order is `transitionTo('approved')` BEFORE `applyCalendarChange()` / Gmail send; the architectural followup is to wrap **state-transition + external-write** atomically. W-6 now says wrap **state-transition + writeSignal** atomically. These are two different "atomic" boundaries and they're incompatible: you cannot have one `db.transaction()` that contains both the signal *and* the external API call (the API call must be outside the SQLite transaction — you don't hold a SQLite write lock across HTTPS). So in practice the order becomes `db.transaction(() => { transitionTo; writeSignal })()` THEN `applyCalendarChange()`. Now consider: external write succeeds, but a transient DB error fires on a *later* unrelated INSERT (or the process crashes between the txn commit and the external call). The signal is committed and the row is `approved` — exactly the silent-write shape MEMORY warned about — AND the signal log now claims an action happened that has no `send_log` / `calendar_action_log` row. The recap "What Aria did" list (Plan 08-02 anchor) will be missing the row but the learned-prefs aggregator (Plan 08-03 Task 4) will count the approval signal. Drift between the trust anchor and the learned-prefs derivation.
**Why plan-checker missed it:** W-6 looks like a tightening (was "after commit", now "same transaction"). Plan-checker did not check that the new boundary collides with the Phase-4-silent-write architectural followup that lives in a *different* memory file.
**Fix:** Re-scope: the same-transaction wrap is between **state transition** and **the audit-log row write** (send_log/calendar_action_log/etc.), NOT the signal. The signal MUST emit AFTER the external write commits — research §Anti-Patterns explicitly says "signal capture happens AFTER user action commits, never speculatively." Revert Task 3's W-6 wording to "emit after the audit-log row is written; if audit-log write fails, signal is skipped (re-derivable from the audit log on next aggregator run)." Update Test 5's assertion shape accordingly. Cross-reference MEMORY `project_aria_approve_silent_failure` explicitly in the task body so the next reviewer doesn't re-introduce the collision.

---

## HIGH findings (close before merge but not before execute)

### H-1 — Migration 128 is written across THREE plans against the same file with no merge protocol; Wave 1 ships first and Wave 2/3 will rewrite already-applied schema
**Plan:** 08-01 Task 1, 08-02 Task 1, 08-03 Task 1 — all say "Append to 128_phase8.sql"
**Issue:** Migration runner tracks applied versions by `user_version`. Once Wave 1 ships in a dev session, `user_version=128` is set. Wave 2's appended SQL in the same file will be ignored on dev machines that already ran Wave 1. Plan 08-03 Task 1 acknowledges this in a single line ("If executor finds migration 128 already applied due to Stream 1/2 dev runs, document a clean reset path") but does not require it: nothing forces a reset, no test catches the silent skip, and the verifier will see all tables present *only on a fresh DB*. Solo-dev machines that ran Wave 1, then Wave 2, then Wave 3 will be missing tables until the user thinks to delete the dev DB.
**Why plan-checker missed it:** The single-migration-file decision is researcher-locked ("intentional decision"). Plan-checker confirmed each plan touches the file; it did not gate on a per-wave reset protocol.
**Fix:** Either split into 128/129/130 (cleanest, runner-friendly, no protocol needed) OR add an explicit Task 0 in 08-02 and 08-03 that detects `user_version=128 && missing-expected-table` and aborts with a "delete dev DB" instruction. Strongly prefer the split.

### H-2 — Plan 08-04 Task 7's verify grep is anchored on an XCUT-05 line that includes a date ("2026-05-17") — if the user-visible amendment ever needs a date refresh, the ratchet bricks
**Plan:** 08-04 Task 7, `<verify>` block uses an exact-string anchor: `"...staged approach 2026-05-17)."`
**Issue:** Brittle ratchet of the exact class Phase 5 peer review flagged. The date is decorative metadata; a future plan author who localizes the date or appends a clarifying parenthetical (e.g. "see 08-CONTEXT") will silently fail the verify and waste a debug cycle. The amendment text is also long enough (~310 chars) that any whitespace or smart-quote drift on Windows shell pipelines will misfire.
**Why plan-checker missed it:** Treated as "good — exact-string is rigorous." Phase 5 peer review specifically called out "brittle ratchets" as a class.
**Fix:** Anchor on a shorter invariant substring: `applies at **GA release**` AND `tester build ships Windows-unsigned` — both are the *meaning* of the amendment. Drop the date from the grep anchor (keep it in the file body).

### H-3 — Plan 08-04 backup-hook `verifyRowCounts` reads `expects_drop` directive from "applied migration source" — but `runMigrations` returns version numbers, not file paths; the parsing path is unspecified
**Plan:** 08-04 Task 4 action paragraph 2 ("`-- @expects_drop: <table>` SQL comment at the top of the migration file; verify-migration reads applied migration source from the runner's tracked list and extracts the directive")
**Issue:** The runner exports `runMigrations(db) → number[]` per the `<interfaces>` block. To read the source comment of migration N, `verify-migration.ts` would need to either re-read `embedded.ts` (a generated re-export) or know the file path convention. Neither is specified. The plan also offers a fallback ("If easier: pass an `expectedDrops: Record<migrationId, string[]>` map directly to runMigrationsWithBackup — confirm pattern with executor judgment") — but "executor judgment" on the rollback path is exactly the kind of unspecified state-machine gap that produces silent failures.
**Why plan-checker missed it:** Both options sound plausible; plan-checker did not require the plan to commit to one.
**Fix:** Commit to the `expectedDrops: Record<number, string[]>` map argument now. Phase 8 has zero migrations that intentionally drop critical-table rows (the four new tables are additive), so the map is `{}` at ship time; the API exists for future migrations. Delete the SQL-comment-parsing alternative.

### H-4 — Plan 08-02 `audit_action_log` VIEW arm 1 hardcodes `sl.provider` projection but never tests the Outlook arm path; Phase 5 Outlook send already shipped
**Plan:** 08-02 Task 1 action: "hardcoded `'gmail'` in arm 1 must be replaced with `sl.provider` so Phase 5 Outlook send slots in without VIEW changes (research Assumption A7)."
**Issue:** Per MEMORY `project_aria_phase5_executed`, Phase 5 Outlook send is committed at `cb00988` + `5b53c7e`. `send_log.provider` may already contain `'outlook'` rows on user machines that connected an Outlook account in Phase 5 testing. Task 1's Test 6 (per-arm count parity) compares `SELECT COUNT(*) FROM send_log` against `WHERE kind='email_send'` — that part is correct, both sides scan all providers. BUT the VIEW emits `provider: sl.provider` and the recap renderer (Plan 08-02 Task 3 + Task 7) will render rows with `provider='outlook'`. There is no test that the recap UI handles a non-gmail provider in the audit list rendering, nor that DOCX/PDF exporters render the provider name correctly. If the renderer hardcodes "Sent draft via Gmail to …" the audit list silently mis-labels Outlook sends.
**Why plan-checker missed it:** The VIEW fix is correct; the downstream rendering surface was assumed to follow. Cross-plan plumbing not exercised.
**Fix:** Add a test in Plan 08-02 Task 7 that seeds an `outlook` send_log row + a `gmail` send_log row and asserts both render with the correct provider label in the canonical (and downstream DOCX/PDF).

---

## MEDIUM findings (followup-worthy)

### M-1 — `app_meta(k TEXT PRIMARY KEY)` collision risk on the W-4 bridge writes
**Plan:** 08-01 Task 8 action W-4: `INSERT INTO app_meta(k, v) VALUES('briefing_dismiss_log:' || ts || ':' || random_id, …)`
**Issue:** `app_meta.k` is PRIMARY KEY (verified against `001_init.sql:10`). The plan does not specify how `random_id` is generated. If `ts = Date.now()` and `random_id = Math.floor(Math.random() * N)` for small N, collisions are non-zero on rapid dismissals. INSERT will throw, the dismissal is lost, Stream 3 backfill never sees it. Single-machine impact is small (the user has to click twice in the same millisecond on different sections) but worth pinning.
**Fix:** Specify `random_id = crypto.randomUUID()` and use `INSERT OR REPLACE` (or, better, use a Wave 1 throwaway table that Wave 3 backfills then drops — cleaner than abusing the kv store).

### M-2 — Auto-updater + migration interplay: electron-updater holds a lock on the .exe / .app during install; the post-update migration backup writes under `userData/backups/` which is unrelated, but the recovery dialog (Task 4 action) is invoked from the boot path *after* the updater has handed off to the new binary. If the new migration crashes, the previous installer is **gone** — electron-updater does not retain prior installers.
**Plan:** 08-04 Task 4 + Task 5 + CONTEXT line 106 ("Auto-updater wraps this: pre-update snapshot, post-migration verify, rollback path runs the previous installer if needed.")
**Issue:** The CONTEXT promise of "rollback path runs the previous installer if needed" is not deliverable with electron-updater's default behavior. The wrapper restores the DB but cannot restore the binary; the new binary then re-attempts the failing migration on next boot → infinite recovery-dialog loop. RELEASE-RUNBOOK §9 ("Rollback procedure") covers the user-uninstalls-and-downloads-prior-release path but does not document that the in-app DB restore alone is insufficient when the migration is broken in a way the new binary cannot avoid.
**Fix:** Either keep the previous installer in `userData/installers/prev.exe` as part of the pre-update step, or amend CONTEXT line 106 to drop the "runs the previous installer" claim and document the manual reinstall path in RELEASE-RUNBOOK §9.

### M-3 — Plan 08-04 Task 8 Step 9 ("simulated migration failure restores from backup") is described but no fixture mechanism is specified
**Plan:** 08-04 Task 8 Step 9
**Issue:** "Simulated migration failure" in a Playwright `_electron` spec against the packaged build means either bundling a deliberately-throwing migration into the production binary (unacceptable) or shipping a test-mode flag that injects one. The plan doesn't say which. If it's "test-mode only", the test passes against the test build but never exercises the real migration runner path in CI of the actual release artifact — exactly the "Phase 7 closure smoke proves nothing" shape from B-2.
**Fix:** Specify: Step 9 runs against a dev build with `ARIA_INJECT_FAILING_MIGRATION=true`; the packaged build is **separately** smoke-tested by a runbook step (Task 9 §3) that uses a known-bad migration drop-in.

### M-4 — Plan 08-03 Task 2 Test 7 90-day retention purge is described but no schedule/trigger is specified
**Plan:** 08-03 Task 2 Test 7 (`purgeOldSignals(db, { keepDays: 90 }) deletes rows older than 90d`)
**Issue:** `purgeOldSignals` is exported and tested, but nothing schedules it. Task 4's `learning-nightly` cron runs `aggregatePreferences` only. After a year the signal log grows to research Pitfall 8's documented 100k–500k rows, exactly what the retention was meant to prevent.
**Fix:** Add a one-liner to Task 4's action: "scheduleLearning also invokes `purgeOldSignals(db, { keepDays: 90 })` after the aggregator step, gated on `app_setting.learning_signals_keep_forever`."

---

## LOW findings (cosmetic)

### L-1 — Plan 08-04 Task 6 Test 5 verify command uses `||` chain that swallows the typecheck-style failure
**Plan:** 08-04 Task 6 `<verify>` block: `pnpm vitest run -t "package.json build config" 2>&1 || node -e "..."`
**Issue:** The shell `||` means "run the node fallback if vitest fails." If vitest fails for any reason (e.g. a typecheck error in an unrelated file) the fallback runs and may exit 0 — masking the real failure.
**Fix:** Use `&&` or two separate invocations.

### L-2 — Plan 08-04 Task 5 Test 9 grep test asserts `UpdatesSection imported by SettingsScreen` but does not assert it is reachable from any *route*; SettingsScreen itself could theoretically be orphan
**Plan:** 08-04 Task 5 Test 9
**Issue:** L-04-04 reachability test exists per-section but assumes SettingsScreen is on a live route. Phase 4 MEMORY `feedback_verifier_blindspot_ui_wiring` was about a Settings *sub-section* being unreachable; the parent screen being orphan is even more catastrophic.
**Fix:** Add a single phase-level grep ratchet (anywhere in Wave 1) that asserts `/settings` route exists in `src/renderer/App.tsx`. One-time, cheap, closes the parent-orphan class.

---

## What plan-checker correctly caught (positive validation)

- B-1 (08-02 phase-enum coverage `'proposed'` exclusion) — Test 2b explicitly seeds proposed rows and asserts zero count.
- B-2 (08-02 per-arm parity + PRAGMA snapshot ratchet) — robust against base-table column drift.
- B-3 (08-01 `recurring_themes` cluster-stability threshold N=50) — locked.
- B-4 (08-01 briefing single-source-of-truth read path, no double gate evaluation) — locked.
- B-5 (08-04 close→rename→reopen integration with cached key) — present but see B-1 above re reopen API surface.
- B-6 (08-04 dual-mode smoke A+B with Mode B real-Ollama gate) — present but see B-2 above re Mode A spy reachability.
- W-1 (lint:guard composite ratchet chain spec across 4 plans) — coherent across plans.
- W-3 (08-04 plan-split decision) — explicit rationale.
- W-4 (08-01 → 08-03 BRIEFING_INSIGHT_DISMISS bridge via app_meta) — bridge described; see M-1 for the PK collision detail.

## What the revision round may have introduced

- B-3 (this review): the W-6 "same-transaction emit" wording in 08-03 Task 3 is the revision artifact that collides with the Phase-4 silent-write architectural followup. Pre-revision wording ("emit AFTER commit") was correct per research §Anti-Patterns; the revision tightened in the wrong direction.
- H-2 (this review): the verbatim XCUT-05 anchor with `2026-05-17` date is a revision-time hardening that became brittle.

## Notes / observations

- Plan 08-04 Task 1 ("version-verify all Stream 2/4 new deps") is *defensive* against Plan 08-02 not adding `docx`/`@react-pdf/renderer`/TipTap. This is good belt-and-suspenders, but it also means a Wave-4 failure surfaces a Wave-2 omission — long feedback loop. Consider running it once at end of Wave 2 too.
- The `scheduler.cronRegistry.size` invariant of 6 in 08-04 verification §7 assumes Phase 5 has not added an Outlook-sync cron under a separate key. Per MEMORY `project_aria_phase5_executed`, the Provider-interface lift may have unified gmail-sync + outlook-sync under one key OR split them — the invariant should be expressed as a delta ("after Phase 8, registry size grows by exactly 3: insights-nightly + recap-monday + learning-nightly") rather than an absolute number.
- 08-02 Task 5 PDF Test 5 round-trip comparison ("same canonical → DOCX, → PDF; both contain the SAME audit row strings") is a string-match across two parsers (mammoth + pdf-parse) with different whitespace normalization. Likely needs a tokenize-and-set-equality helper; the plan currently implies substring search.
- The Phase 3 CR-01 gate fail-OPEN cross-reference is correctly NOT subsumed by Phase 8 (08-04 verification calls it out). Good discipline.
