---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Voice Interface
status: executing
last_updated: "2026-06-04T06:38:00.000Z"
last_activity: 2026-06-04
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 12
  completed_plans: 11
  percent: 17
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-02)

**Core value:** Aria tells the exec what matters today and handles the rest under user oversight (local-first, hybrid LLM, approval-gated).

## Current Position

Phase: 15 (audio-i-o-model-runtime) — EXECUTING
Plan: 9 of 9 (15-09 in-progress, paused at Task 2 human-action checkpoint)
**Milestone:** v2.0 — Voice Interface (roadmapped 2026-06-02)
**Phase:** 15
**Plan:** 9 in-progress (packaging config + static guard done; paused at Task 2 human-action checkpoint: macOS whisper-cli binary procurement)
**Status:** Executing Phase 15
**Last activity:** 2026-06-04

**v2.0 phases (14–19), dependency-ordered:**

- [ ] **Phase 14: Voice Safety / Confirm Contract** — VOICE-10. The confirm contract + HARD GATE (voice blocked from forced/high-severity) + STATIC RATCHET on voice write-paths. Build this BEFORE fluency.
- [ ] **Phase 15: Audio I/O + Model Runtime** — VOICE-01/04/07. Renderer mic/VAD/playback + STT sidecar; prove AEC (#47043) + ABI + RAM + device handling on the packaged app. _(Research flag: highest uncertainty.)_
- [ ] **Phase 16: Streaming Cascade + Barge-in (read-only)** — VOICE-02/03/06. Streaming STT→LLM→TTS + barge-in (one AbortController) + spoken briefing/answer playback. Zero write risk.
- [ ] **Phase 17: Voice-Confirm + Writes Through the Gate** — VOICE-05/08/09/11. Voice-driven triage/scheduling/drafting via confirm → assertApproved; mishear recovery; cloud opt-in consent + voice settings.
- [ ] **Phase 18: Opt-in Wake-Word + Privacy Isolation** — VOICE-12. Privacy-isolated, provably-killable KWS process, OFF by default. _(Research flag: licensing decision required first.)_
- [ ] **Phase 19: Cloud Opt-in Polish + Performance** — no net-new req. GPU whisper, MessagePort PCM, voice-priority queue, idle unload, a11y polish.

**Locked v2.0 decisions:** hybrid local-first audio (Whisper large-v3-turbo + Kokoro-82M/Chatterbox-Turbo local default; cloud opt-in) · PTT-first, wake-word last · voice-confirm routes THROUGH assertApproved (never around) · STT in a sidecar/worker (Ollama pattern, dodges Electron-41 ABI trap) · half-duplex mic-gating (Chromium AEC no-ops in Electron #47043).

## Decisions (Phase 15)

- D-19 resample strategy (15-04): AudioContext created at sampleRate 16000 — worklet receives pre-downsampled audio and forwards mono channel 0 as transferable ArrayBuffer; no in-worklet resampler
- Factory pattern (15-04): createMicCapture() factory + useMicCapture() React wrapper — core logic testable without React runtime
- AudioContext reuse across devicechange (15-04): context not closed on hot-swap; only tracks + worklet node torn down to avoid re-init cost
- D-18 trigger (15-06): speak(text) exposes plain text param — caller supplies echo/fixed utterance; hook does NOT hard-code briefing content
- D-13 cooldown (15-06): HALF_DUPLEX_COOLDOWN_MS=800 exported constant; fake-timer driven in tests
- Store pattern (15-06): createVoiceSessionStore() observable factory (Zustand not installed) — pub/sub achieves same contract
- half-duplex.spec placement (15-06): tests/unit/renderer/voice/ (not tests/unit/voice/) — matches vitest renderer project include glob
- startTurn() returns boolean (15-06): false when blocked (speaking state), true when started — callers can check
- Pre-unlock voice stubs (15-05): VOICE_FEED_AUDIO/DOWNLOAD/GET_STATUS/CANCEL stubs in ipc/index.ts replaced at bootstrap by real registerVoiceHandlers; voiceEmitter forward-ref bound post-mainWindow
- IPC db-null skip trap (15-05): knowledge channels stubs always register + add to skip pre-unlock; entitlement else-branch covers all 5 channels
- Handler-count invariant (15-05): 149/149 CHANNELS registered in registerHandlers — push-event no-op stubs + pre-unlock stubs close the gap
- VoiceStatusDot (15-07): wraps StatusDot editorial primitive; state→kind: listening/processing→warn, speaking→ok, error→err, idle/muted→idle; prefers-reduced-motion suppresses pulse+spinner (D-14/D-16)
- VoiceHUDBand (15-07): grid-template-rows 0fr/1fr collapse/expand chosen over max-height; inner overflow:hidden; role=status aria-live=polite aria-atomic=false; transcript plain text node (D-15/T-15-21)
- VoicePTTButton (15-07): Public/Core split avoids conditional useVoiceSession hook; _testSession prop avoids vi.mock vitest-pool timeout; testId prop for Topbar aria-topbar-ptt slot (D-10/D-12)
- stopTurn/setVadMode (15-07): added to VoiceSessionActions — stopTurn transitions listening→processing; setVadMode stores 'hold'|'toggle' for capture layer (D-10/D-11)
- VoiceModelDownload variants (15-08): step card vs Modal size="md"; _testIpc prop for test isolation; DISCLOSED_BYTES=601_882_624 matches model-download.ts
- OnboardingWizard voice step (15-08): password → voice → sealing sequence; seal() called from voice step onSkip/onComplete; __forceStep__ test-only prop; sealing extracted to own render branch
- Voice step isolation (15-08): Card.data-testid limitation worked around with wrapper div; voice step never blocks seal (T-15-24 mitigated)

## Next Action

`/gsd-plan-phase 14` — plan the Voice Safety / Confirm Contract phase (lighter research; extends existing assertApproved / approval-transition / static-grep patterns). Phase 15 and Phase 18 are flagged for deeper `/gsd-research-phase` at plan time.

**Carried v1.0 tech debt (from MILESTONES.md):** Phase 9 design pixel-diff walkthrough (human checkpoint open); Phase 2/8 live/release verification (Ollama smoke, packaged-build E2E, Apple notarization, lived-14d data); macOS tray UAT; dark-mode `--aria-gray-*` gap; `pnpm typecheck` not run on the 2026-06-02 UI WIP batch; migration_014 legacy singleton-cron paths not exhaustively traced.

---

# v1.0 History (SHIPPED 2026-06-02)

> Archived for continuity. Phases 1–13 (incl. 08.1). Full archives: milestones/v1.0-ROADMAP.md, milestones/v1.0-REQUIREMENTS.md, v1.0-MILESTONE-AUDIT.md.

## Phase History (v1.0)

**Phase 9 Plan 06 complete (2026-05-20) — code-complete, milestone gated on human walkthrough.** Visual QA + reachability ratchet + UAT scaffold. 3 atomic commits: `9675367` (Task 1 reachability spec — 4 assertions: editorial-barrel-importers / no-google-fonts-cdn / legacy-token-ratchet at 250 / per-feature editorial-import; passes with documented `KNOWN_ORPHAN_PRIMITIVES`={MonogramSquare, StatusDot, Input, Modal} + `KNOWN_NAKED_FEATURES`={diagnostics, email} allowlist surfaced to 09-UAT.md Test 9 for human routing decision per orchestrator constraint "don't auto-decide orphans"), `577e63b` (Task 2 Playwright `_electron` visual walkthrough scaffolded as `.skip` mirroring Phase 8 `phase8-happy-path.spec.ts` precedent — 14 routes + 4 entitlement states + un-skip checklist in header gated on packaged-build harness), `7e377a6` (Task 4 09-UAT.md scaffold — 12 test items in Phase 7 UAT structure: cold start smoke / per-screen design-ref comparison / Cmd+K from 3 triggers / DisconnectConfirmDialog destructive flows / onboarding seal copy / /ask styling / Recap export DOCX+PDF / 14 Settings tabs / reachability ratchet routing / snapshot delta / TrialBanner 4 states / core flow regression; plus design-ref screenshot table for briefing.png ×3, D-01..D-17 criteria checklist with D-11 pre-populated, BLOCKER→loop/MAJOR→09.1/MINOR→backlog rubric). Task 3 = `checkpoint:human-verify` AWAITING USER — pixel-diff against `design-ref/project/screenshots/` (3 briefing PNGs) + side-by-side vs JSX prototypes (`app-screen-*.jsx`) is human eyeball work per pre-authorized Option 2 + orchestrator's "don't pixel-diff yourself". Reachability spec runs in <2s via `npx vitest run tests/integration/phase-9-reachability.spec.ts` (4/4 green). Closes Phase 4 verifier-blindspot (`feedback_verifier_blindspot_ui_wiring`). **Phase 9 plan 06/06 → 6/6 plans code-complete. Phase 9 milestone NOT auto-closed — user owns the close commit per orchestrator critical_constraints.**

**Phase 9 Plan 05 complete (2026-05-20)** — System surfaces re-skin: Settings shell + 17 section components (Task 1, `4f19a9b`), RoutingLogScreen + 4 Entitlement components (TrialBanner / PaywallScreen / ActivateLicenseForm / RestoreLicenseSection) + DisconnectConfirmDialog (Task 2, `1c98c2b`), Onboarding 4-step wizard + UnlockScreen + RestoreScreen + BackupRestoreSection (Task 3, `04c55f7`) = 30 files modified across 3 atomic commits. RE-SKIN ONLY per pre-authorized Option-2 envelope — zero IPC signature changes, zero state-shape changes, zero hook signature changes. SettingsScreen regrouped into 4 NavSections (Status / Connections / Behaviour / Account) with gold left-rail active state; 14 tab labels + `settings-nav-{slug}` testids verbatim. DisconnectConfirmDialog: paper card with 2px rose top-accent + mono "DESTRUCTIVE ACTION" eyebrow + Playfair heading + editorial Button cancel/confirm; role=dialog, aria-modal, all 3 testids, wipe-copy, Escape-key all verbatim (D-12). TrialBanner 3 editorial tones (info=paper, warn=ivory-deep+gold rule, urgent=rose-tinted+rose rule) mapped from existing 5-state band machine; no state changes. 38/38 targeted tests pass unmodified. **Phase 9 plan 05/06 → 5/6 plans complete.**

**Phase 9 Plan 04 complete (2026-05-20)** — Workspace re-skin batch 2: Meetings (4 files) + Tasks (2 files) + Ask Aria (4 files) + Recap (2 files) = 12 files modified across 3 atomic commits (`f0f3eea` / `ad440b1` / `9bf1e02`). RE-SKIN ONLY — every IPC call, hook signature, state slice, TipTap editor lifecycle, and data-testid preserved verbatim. H-4 grep ratchet preserved. 18/18 targeted tests pass unmodified. **Phase 9 plan 04/06 → 4/6 plans complete.**

**Phase 9 Plan 03 complete (2026-05-20)** — Workspace re-skin batch 1: Briefing (7) + Approvals (6) + Calendar (4) + SchedulingChat (1) = 18 files across 3 atomic commits (`fafd8d2` / `c352f09` / `2d407ac`). RE-SKIN ONLY — all IPC + hook + state + testids verbatim. assertApproved chokepoint paths (email_send / calendar_change / task_batch) untouched. 39/39 targeted tests pass unmodified. **Phase 9 plan 03/06 → 3/6 plans complete.**

**Phase 9 Plan 02 complete (2026-05-20)** — Shell re-skin: SideNav + Topbar + Layout chrome + CommandPalette overlay + SidebarStatus. 3 atomic commits (`7cc0523` / `a12bc2c` / `fa47842`). W-2 chrome-suppression Branch A (App.tsx owns onboarding/locked gate). IPC plumbing untouched. **Phase 9 plan 02/06 → 2/6 plans complete.**

**Phase 9 Plan 01 complete (2026-05-20)** — Editorial design-system foundation: @fontsource fonts as runtime deps, editorial palette tokens alongside `--aria-*`, primitive classes ported from design-ref, 11 React primitives under `src/renderer/components/editorial/`. 9/9 primitives tests pass. 2 commits `3ef4281` + `9f26dbf`. **Phase 9 plan 01/06 → 1/6 plans complete.**

**Phase 8 Plan 04 complete (2026-05-20)** — v1 Release Preparation (Stream 4). Closes Phase 7's dangling RAG_ASC wiring + lands the full release pipeline. AnswerService factory hoisted; `runMigrations` extracted out of `openDb` into a single boot call site (seal path inverted to persist vault.json AFTER successful open+migrate, closing `project_aria_seal_not_atomic`); `runMigrationsWithBackup` VACUUM-INTO snapshot + row-count drift guard; `electron-updater@^6.8.3` wired (autoDownload=false, channel from `ARIA_UPDATE_CHANNEL ?? 'tester'`); electron-builder config (mac notarize from APPLE_TEAM_ID; win nsis unsigned per amended XCUT-05 staged signing); RELEASE-RUNBOOK.md (11 sections); fixture-leak ratchets. 10 commits `5acd75d…4bb414c`. XCUT-04, XCUT-05, RAG-02 closed. **Phase 8 plan 04/04 → PHASE 8 COMPLETE.**

**Phase 8 Plan 03 complete (2026-05-20)** — Preference Learning + Briefing Feedback. Migration 130 (learning_signals / learned_preferences / briefing_feedback / rag_turn.thumb). approval signals EMIT-AFTER-EXTERNAL-WRITE-SUCCESS; recap/briefing/qa SAME-TRANSACTION. Nightly learning cron @2:30am + purgeOldSignals (keepDays 90, gated). 7 IPC channels. `grep:no-network-from-signals` ratchet. 7 commits `094e265…65154b1`. LEARN-01/02/03, BRIEF-04/05, XCUT-02 closed.

**Phase 8 Plan 02 complete (2026-05-20)** — Weekly Recap + `action_audit_log` VIEW. Migration 129. weekly_recap tables; Monday-08:00 cron; two-pass narrative cross-validation; RecapCanonical zod single shape for TipTap + DOCX + PDF. 8 IPC channels, `/recap` route. 7 commits `c96127a…5a53cee`. RECAP-01..04 closed.

**IPC schema-drift fix (2026-05-19, f44ffd4)** — Gmail/Calendar IPC writes routed to `provider_account` + `provider_sync_state` (legacy singleton tables dropped by migration 014). Reads via compat views. Deferred: sync-gmail.ts / sync-calendar.ts still SELECT/UPDATE dropped base tables for cursor advance (non-fatal, try/catch).

**Phase 7 complete (3/3 plans)** — RAG Q&A: migration 126 schema, four-corpus harvesters, hybrid BM25 + vector + RRF retrieval, person-mention resolver, answer router as pure fn over chunk.sensitivity, /ask chat + global Cmd/Ctrl+K palette. UAT: 153/0/0 targeted green; Gaps 1–10 closed (Gap 10 bdb8693 = DisconnectConfirmDialog destructive gate across all 4 provider surfaces). AnswerService↔IPC factory wiring landed in 08-04.

**Phase 4 complete (pending verification)** — Calendar smart-scheduling. NL pipeline + SchedulingChat + ApprovalCard calendar variant + APPR-02 dispatch. SC-1 demonstrable: "move my 3pm to Thursday" → ProposeResult → approve → applyCalendarChange chokepoint.

## Phase Status (v1.0)

- [x] Phase 1: Foundation
- [x] Phase 2: Gmail + Daily Briefing MVP (pending verification)
- [x] Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send
- [x] Phase 4: Calendar Smart-Scheduling (Google)
- [x] Phase 5: Outlook Parity (email + calendar)
- [x] Phase 6: Meeting Capture + Todoist Push
- [x] Phase 7: RAG Q&A
- [x] Phase 8: Insights, Recap, Learning, Release Prep (pending verification)
- [x] Phase 08.1: Subscription + 60-day trial
- [x] Phase 9: Product UI (editorial design system) — code-complete, human walkthrough open
- [x] Phase 10: Knowledge Folders
- [x] Phase 11: Web Research
- [x] Phase 12: Background Activity Tray + Auto-launch
- [x] Phase 13: Open-Source Release Prep

## Accumulated Context (v1.0)

### Quick Tasks Completed

| # | Description | Date | Commit |
|---|-------------|------|--------|
| 260523-a5w | Settings integrations cleanup + calendar fetch fix | 2026-05-23 | a70936f / 968821c / 32e90b2 |
| 260523-eaf | Onboarding name personalization (5-step wizard) | 2026-05-23 | 74af0e8 |
| 260523-f73 | Bake OAuth credentials into production build | 2026-05-23 | 0181d18 |
| 260601-nxh | Fix production `dbHolder is not defined` crash | 2026-06-01 | da2d936 |
| 260602-e4h | Fix production branding (icon + Windows identity) | 2026-06-02 | 76fae51 |
| 260602-l4c | Fix dark-mode white backgrounds in Phase 11 Research UI | 2026-06-02 | 2a11048 |
| 260602-m2g | Fix invisible system-tray icon (dedicated gold tray glyphs) | 2026-06-02 | 7b1165f |

## Workflow Config

- Mode: YOLO (auto-approve)
- Granularity: Standard
- Parallelization: Parallel
- Commit docs: Yes
- Research: Yes
- Plan check: Yes
- Verifier: Yes
- Model profile: Balanced (Sonnet)
