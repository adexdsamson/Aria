# Phase 8 Context: Insights, Weekly Recap, Learning, Release Prep

**Phase:** 8
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** INSIGHT-01..03, RECAP-01..04, LEARN-01..03, BRIEF-02, BRIEF-04, BRIEF-05, XCUT-02, XCUT-04, XCUT-05

<domain>
Final v1 phase. Delivers:
- Insights computation over user history (calendar load, response-time trends, recurring themes, edit patterns)
- Weekly recap with explicit "What Aria did this week" audit section; editable + exportable
- Preference learning loop wired to approval/briefing/recap/Q&A feedback; local-only; inspectable; resettable
- Release prep: code signing, notarization, auto-updater, pre-migration backup + restore, integration tests
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 8 scope, plans, success criteria (lines 143–162)
- `.planning/REQUIREMENTS.md` — INSIGHT-01..03 (83–85), RECAP-01..04 (97–100), LEARN-01..03 (104–106), BRIEF-02/04/05 (75/77/78), XCUT-02/04/05 (111/113/114)
- `CLAUDE.md` — electron-builder 25 / electron-updater 6, docx + @react-pdf/renderer, Playwright 1.48 _electron, Sentry, signing recommendations
- Prior CONTEXT.md files in `.planning/phases/01..07/` — audit-log sources (Phase 3 routing log, Phase 4 calendar audit, Phase 6 Todoist push log), approval signals, briefing structure, RAG patterns
- electron-builder + electron-updater docs (researcher)
- Apple notarization, Microsoft SmartScreen reputation, OV cert vendors (researcher)
</canonical_refs>

<prior_decisions>
**Project-level:**
- Local-only learning — `LEARN-02` is non-negotiable
- Briefing is sectioned / exec-terse / top-3 per section (Phase 2)
- All sensitive routing rules from Phase 3 still apply

**From earlier phases:**
- Phase 3: edit-diff capture on approval queue (drafts), reject reasons, accept signals; routing log
- Phase 4: calendar action audit log (before/after API call); override-with-reason log
- Phase 6: Todoist push log + unified action audit feed
- Phase 7: RAG chat history + per-turn metadata (citations, sources used)
- Phase 1 / CLAUDE.md: electron-builder 25, electron-updater 6, signing/notarization plan
</prior_decisions>

<decisions>

### Insights computation + briefing integration
- **Insights shipped in v1 (all four):**
  - **Calendar-load delta** — WoW meeting hours, focus-time fragmentation (count of >=60min contiguous focus blocks)
  - **Email response-time trend** — per-person median and overall trend (sent/received pairing by thread)
  - **Recurring themes** — topic clustering across mail/transcripts; uses Phase 7 embeddings + lightweight k-means or HDBSCAN over recent N items
  - **Approval-edit patterns** — directly hooks LEARN-01; surfaces "you shortened 60% of drafts last week" style observations
- **Cadence:** Nightly background job (node-cron, after sync window quiets) computes aggregates → cached in `insights` table. Briefing reads cache. Manual recompute available from settings.
- **Prose generation routing (INSIGHT-03):** **Pre-aggregate to numeric/structural facts locally; only aggregates go to frontier for prose.** Example payload sent to LLM: `{ calendarLoadDeltaPct: 23, topThemes: ['Q3 planning','hiring'], medianReplyTimeShiftHours: -2.1 }`. Underlying mail/event bodies never leave the machine. Local LLM fallback if user disables frontier altogether.
- **History gate (INSIGHT-01): hard 14-day gate per relevant corpus.** Before that, briefing shows "Insights unlock in X days" placeholder. Per-corpus means: calendar-load needs 14d events, response-time needs 14d sent mail, etc.
- **Briefing integration:** Insights appear as their own briefing section ("This week"), top-3 most-impactful that day (sectioned-doc / exec-terse pattern from Phase 2). Each insight is dismissible; dismissals feed learning.

### Weekly recap + "What Aria did" audit
- **Generation timing:** **Auto-generated Monday morning** covering the prior week (Mon–Sun). Quiet compute window; fresh eyes on review. User-triggered manual generation also available.
- **Section structure (RECAP-01):**
  - Meetings held (count + highlights)
  - Actions closed / open (from Phase 6 + Todoist sync)
  - Wins (LLM-distilled from sent mail + decisions section of meeting summaries)
  - What's coming (next-week calendar + open follow-ups)
  - **"What Aria did this week"** — stitched directly from unified action audit log
- **"What Aria did" source:** Unified `action_audit_log` table merging:
  - Phase 3 sent drafts + approvals declined
  - Phase 4 calendar changes (proposed / approved / overridden)
  - Phase 6 Todoist tasks pushed + rejected-after-push
  - Each row: `{ kind, timestamp, providerKey?, summary, sourceRefs[], approvalOutcome }`
  - Recap renders raw rows in a deterministic list ("Aug 5: sent draft to Sarah re Q3 deck; Aug 6: moved Tuesday 3pm Smith call to Thursday; …") **plus** a short LLM-written narrative paragraph above it. List is the trust anchor; narrative is the readability layer.
- **Edit-feedback loop (RECAP-03 → LEARN-01):** Per-section diffs stored and **categorized** (tone / length / factual / structure). Same pipeline as Phase 3 draft-edit signal; recap edits tagged with source `'recap'` and section.
- **Export (RECAP-04):** Both formats — DOCX via `docx` (dolanmiu) and PDF via `@react-pdf/renderer`. Single canonical recap doc renders to either; user picks at export time.
- **Editable preview:** Recap opens in a rich-text editor; user edits before finalize. Finalize commits the recap + emits learning signals.

### Preference learning + briefing feedback
- **Storage shape (both):**
  - **Typed structured preferences** (JSON schema, single row per user):
    ```ts
    {
      voice: { avgDraftLengthChars, formality: low|med|high, openerStyle, signOffStyle, terseness: 0..1 },
      triage: { vipBoosts: [{ email, weight }], deprioritizedSenders: [], topicMutes: [] },
      scheduling: { bufferPref, focusTimePref, primeTimeWindows },
      briefing: { preferredSections, dismissedInsightKinds, newsTopics: [] },
      lastUpdatedAt
    }
    ```
  - **Raw signal log** retained (`learning_signals` table): every captured signal with kind, source, payload, timestamp. Nightly aggregator derives the typed preferences from the recent window. Signal log enables replay if aggregator logic changes.
- **Signals captured (all four sources):**
  - Approval-queue actions (edit diffs, reject reasons, accepts) across email, calendar, tasks
  - Briefing "more like / skip section" feedback (BRIEF-05) — per-section chips
  - Recap section edits (categorized by tone/length/factual/structure)
  - Q&A thumb-up/down on answers (Phase 7) — feeds RAG retrieval quality + answer-tone signals
- **Inspect + reset UI (LEARN-03):** Settings → "Learned preferences" tab.
  - Tree view of typed preferences with current value, source signals count, last-updated
  - Per-field reset button + global "Reset all preferences" button
  - "View signal log" sub-page for transparency (read-only)
- **Local-only invariant (LEARN-02):** Signals and preferences never leave the machine. Frontier LLM may be used at *application time* (e.g. drafting an email with prefs in context), but the prefs are part of the prompt — never sent for training or storage. Sentry telemetry beforeSend allowlist enforces this.
- **News topic configuration (BRIEF-04):** Settings UI with topic chips (add/remove) + RSS source list. Preferences tab also tunes news from briefing skip-section signals. Explicit + implicit, both active.

### Release prep
- **Auto-updater feed: GitHub Releases** (electron-updater built-in `github` provider). Zero infra; public; works for v1 solo-dev. Config structured so swap to S3/R2 generic provider is config-only later.
- **Signing — staged approach (user-confirmed 2026-05-17):**
  - **macOS:** Developer ID + notarization at v1 release.
  - **Windows:** Ship v1 **unsigned** with SmartScreen warning. OV cert acquired and Windows builds signed **after a tester usage period** (real users put hours on the unsigned build, surface bugs, then sign for general availability).
  - **REQUIREMENTS amendment needed:** XCUT-05 and SC-5 currently require Windows OV signing in v1. Amend to: Windows OV signing required for **GA release**, not the initial v1 tester build. Planner to update REQUIREMENTS.md in plan 4 prep.
  - Trigger to acquire OV cert: "testers have used it for some time" (no specific count locked; solo-dev judgment).
- **Pre-migration DB backup + restore (XCUT-04): snapshot + verify, rollback on count drift.**
  - Before any migration, copy SQLCipher DB file to `userData/backups/{timestamp}-{prevSchemaVersion}.db`. Keep last 5.
  - Migration runner records expected row counts per critical table pre-migration; verifies post-migration counts match (allowing schema changes that intentionally drop columns but not rows).
  - On count mismatch or migration error: restore from snapshot, show recovery dialog, surface backup file location.
  - Auto-updater wraps this: pre-update snapshot, post-migration verify, rollback path runs the previous installer if needed.
- **Final integration tests (Playwright `_electron`):** Full happy-path E2E covering:
  1. Connect Google + Outlook accounts
  2. Ingest mail; briefing renders
  3. Draft an email, approve, send (mocked Gmail send)
  4. Schedule a meeting via NL command, approve calendar write
  5. Paste a transcript; push action items to Todoist
  6. Run a RAG query and verify citations open the source
  7. View the weekly recap and edit a section
  - This sequence is the codified "I used Aria today" criterion from CLAUDE.md cross-cutting NFRs. Runs in CI on each release candidate.
- **Antivirus runbook:** Documented in PROJECT.md / OPS.md — what to do when an AV vendor false-positives the Windows installer (submit to Microsoft, common AVs). v1.1 mitigation if Windows-unsigned path is taken.

### Cross-cutting
- **XCUT-02 (drafts persist across crashes, never auto-transition to sent):** already enforced by Phase 3 state machine (interrupted state on crash). Phase 8 plan 4 includes a dedicated test asserting this invariant under simulated crash.
- **Log redaction:** Pino logs continue to use the redaction helper from Phase 2; Sentry beforeSend allowlist gates any opt-in error reports.
- **"I used Aria today" dogfood criterion:** Solo dev runs Aria daily through this phase; bugs surfaced go to a Phase 8 backlog and get triaged before signing/release.

</decisions>

<requirements_amendment>
- **XCUT-05 / SC-5 Windows-signing clause** — amend to apply at GA release, not initial v1 tester build. User-confirmed staged approach: ship Windows unsigned to testers, acquire OV cert and sign once testers have used it for some time. Planner updates REQUIREMENTS.md in plan 4 prep. No blocker.
</requirements_amendment>

<deferred>
- **S3 / R2 updater hosting** — config-ready, swap when going commercial
- **Differential updates beyond electron-updater defaults** — defer
- **Windows OV signing** (if option (a) above is chosen) — v1.1
- **Insight categories beyond the four** (e.g. attention budget, meeting-load rebalancing suggestions) — v1.x
- **HDBSCAN over k-means for theme clustering** — researcher picks the simpler one for v1
- **Cross-week recap comparisons (this-week-vs-last)** — defer
- **Recap collaboration / share-with-assistant** — out of scope (solo persona)
- **Preference learning across multiple users on one machine** — n/a (single-user app)
- **Federated learning / cloud sync of prefs** — explicitly out of scope (LEARN-02)
- **Crash-reporter beyond Sentry opt-in** — defer
</deferred>

<open_questions_for_research>
- electron-builder + GitHub Releases provider: rate limits, draft-vs-published behavior, semver tag conventions for differential updates
- Apple notarization workflow in 2026 (notarytool, app-specific password vs API key), Mac Developer ID renewal flow
- SmartScreen reputation seeding strategy if Windows OV is acquired: how many installs to clear warnings, common pitfalls
- Theme clustering library choice — simple k-means (with embedding-based silhouette tuning) vs HDBSCAN (no-k tuning); evaluate on a small Aria-corpus sample
- Email response-time pairing: best heuristic for matching sent to received (In-Reply-To/References headers first; subject-match fallback)
- Recap editor library — TipTap vs Slate vs ProseMirror; integration with docx/pdf export pipeline
- Migration runner with row-count verification — existing libs (umzug, knex migrations) vs hand-rolled with better-sqlite3
- Playwright `_electron` flake patterns for OAuth flows — how to stub provider auth in E2E
- Local LLM fallback for insight prose when user disables frontier — quality on aggregate→prose tasks (Llama 3.1 8B vs Qwen 2.5 7B)
- Audit log unification — existing per-phase tables vs new consolidated `action_audit_log`; migration cost
- Pino redaction config audit before release — ensure no PII slips into log lines
- AV false-positive mitigation playbooks for Electron apps on Windows (submitter forms, common signatures)
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User receives a weekly recap covering meetings, actions, wins, what's coming, with explicit "What Aria did this week" from action audit log; editable + exportable
2. After two weeks of use, briefing includes at least one insight derived from the user's own data
3. Drafts after week two are observably closer to the user voice than week one (manual eval)
4. Auto-updater installs a new version, runs schema migration, and restores from backup if migration fails (verified in test)
5. macOS build passes notarization; Windows build is OV-signed and installs cleanly past SmartScreen reputation seed
   - Amended: applies at GA release. Initial v1 tester build ships Windows-unsigned; OV signing happens after a tester usage period. See `<requirements_amendment>`.
</success_criteria_recap>
