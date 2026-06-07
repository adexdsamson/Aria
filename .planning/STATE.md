---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Voice Interface
status: verifying
last_updated: "2026-06-07T22:10:37.398Z"
last_activity: 2026-06-07
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 18
  completed_plans: 18
  percent: 50
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-02)

**Core value:** Aria tells the exec what matters today and handles the rest under user oversight (local-first, hybrid LLM, approval-gated).

## Current Position

Phase: 16 (streaming-cascade-barge-in-read-only) — CODE-COMPLETE (runtime smoke deferred)
Plan: 6 of 6 complete (sequential/no-worktree; node_modules intact throughout)
**Milestone:** v2.0 — Voice Interface (roadmapped 2026-06-02)
**Phase:** 16
**Plan:** All 6 complete. Full streaming cascade wired: PTT→STT→streamVoiceAnswer(local-route)→TtsSegmenter→VOICE_TTS_CHUNK→useReadAloudQueue→Kokoro; barge-in (renderer-first abort + [interrupted] turn); briefing read-aloud (pause/skip/speed); multi-turn via rag thread; D-13 read-only ratchet green.
**Status:** Phase 16 code-complete; 5-test runtime smoke (SC1–SC5) deferred to human-verify on running app
**Verifier:** 13/13 must-haves (/ask shell-HUD player gap closed in `f168a6a`); 5 runtime-smoke items open (see 16-VERIFICATION.md). Typecheck flat at 84 baseline, 0 new across all 6 plans.
**Open Phase-16 human-verify (run `pnpm dev`):** SC1 briefing pause/skip/speed · SC2 /ask first-audio <900ms + voice_latency_log 4 cols (ARIA_DEBUG=1) · SC3 barge-in <200ms · SC4 multi-turn "he" resolution · SC5 backchannel non-interruption
**Last activity:** 2026-06-07

**Open verification debts (Phase 15):**

- macOS whisper-cli binary: CI cmake -DWHISPER_METAL=ON + notarization; see build/whisper/README.md §Option A
- Packaged-launch SC2 (no ABI crash) + SC3 (laptop-speaker half-duplex) + SC5 (device hot-swap) + RAM ceiling: requires packaged build on 16 GB machine; see tests/e2e/packaged-launch.spec.ts + .planning/phases/15-audio-i-o-model-runtime/15-RAM-CEILING.md

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

## Decisions (Phase 16, Plan 01)

- VOICE_LATENCY_MARK stub: registered as ipcMain.handle(no-op → undefined) in both voice.ts and ipc/index.ts stubs (satisfies handler-count invariant; real timing handler in 16-04a)
- migration 136 position: appended at tail of EMBEDDED_MIGRATIONS (after 135, ascending order maintained for correct new-install application)
- voice-latency-log spec: uses better-sqlite3-multiple-ciphers (not better-sqlite3 — matches project convention; was corrected as Rule 1 auto-fix)
- handler-count invariant: 154/154 CHANNELS registered (149 Phase-15 + 5 Phase-16 new); uses Object.keys(CHANNELS).length dynamically (no hardcoded count)

## Decisions (Phase 16, Plan 03)

- bargeIn() guards window.aria undefined in test environments (null-check before voiceAbort IPC call)
- cancel()/suspend()/resume() on KokoroPlayerHandle return void (fire-and-forget; not awaited per D-09)
- suspend() guards audioCtx.state === 'running'; resume() guards 'suspended' (safe state transitions only)
- sourceRef cleared on source.onended as well as cancel() (no dangling source refs)
- half-duplex.spec.ts test updated to reflect D-01 behavior (PTT-during-speaking now calls bargeIn → idle)
- currentSessionId via crypto.randomUUID() with Date.now() fallback (Wave 2 VoiceSessionManager supplies canonical ID)

## Decisions (Phase 16, Plan 02)

- AI SDK 6 text-delta chunk property is chunk.text (not chunk.textDelta as in RESEARCH.md) — auto-fixed Rule 1 in Task 3
- streamVoiceAnswer does NOT include db in StreamVoiceAnswerArgs (deps carries it; cleaner separation)
- Retrieval failure path writes empty assistant turn (not silent skip) for D-12 barge-in context integrity
- DIAGNOSTICS_VOICE_LATENCY handler upgraded in voice.ts (not deferred): db-null guard + limit passthrough to readRecentVoiceLatencyLog

## Decisions (Phase 16, Plan 04a)

- sessions Map does NOT delete on onDone — sessions persist for D-11 multi-turn context; spec requires getSession() post-completion
- getSession() exposed on VoiceSessionManager return type for test + diagnostics access
- TtsSegmenter constructor mock: vi.fn(function(){}) not vi.fn(() => {}) — arrow functions not constructable in Vitest
- Auto-wire guard in registerVoiceHandlers: creates VoiceSessionManager only when db + emitToRenderer both present

## Decisions (Phase 16, Plan 04b)

- noopPlayer fallback in VoiceHUDBand: hook always receives valid KokoroPlayerHandle (avoids conditional hook call rule violation)
- Transport controls visible only when player prop present AND voiceState==='speaking' (guards against briefing context where player may not have initialized)
- VOICE_TTS_CHUNK subscription placed in useEffect with queue as dependency (stable via useCallback in useReadAloudQueue)
- synthStartFiredRef / firstAudioOutFiredRef reset when state leaves 'speaking' — one mark per speaking episode (not per chunk)
- buildSectionText() caps at top-3 items per section (matches CONTEXT top-3 budget for concise TTS); returns empty-state string when no items
- Stop button shown when isReading=true (currentSectionIndex>=0); Read Aloud button shown otherwise

## Decisions (Phase 16, Plan 05)

- confirm.ts excluded from D-13 scan: it DEFINES voiceConfirm (Phase-14 write-seam) not a caller; identifier-boundary RE cannot distinguish definition from call-site
- WRITE_CHOKEPOINTS named distinctly from Phase-14 CHOKEPOINT_NAMES to make Phase-16 extension intent explicit
- Single it() block with { file, chokepoint } pair offenders array mirrors Phase-14 template structure

## Next Action

**Phase 17 CONTEXT captured (2026-06-04, advisor mode) → `/gsd-plan-phase 17`.** 17 decisions D-01..D-17 locked (full text in 17-CONTEXT.md). Headline: voice intent = keyword-prefilter→per-domain extraction + thin-wrapper service dispatch (only ask.ts→ask-service.ts needs extraction); dual-channel confirm = spoken-affirmative short-STT + visible ApprovalCard → voiceConfirm seam; template read-back of RESOLVED entities; LLM confirm-classifier + re-prompt; forced→on-screen tap (renderer suppresses voice-confirm); pre-staging person-resolver disambiguation; cancel = PTT-to-cancel + Cancel button → new 'cancelled' approval state (state.ts union + transitions; migration ≥137 if DB CHECK); cloud = STT + NON-streaming cloud answer (buffered PII round-trip), frontier STREAMING + StreamingRehydrator DEFERRED to Phase 18; single master consent toggle + disclosure + audit; per-turn sensitivity fail-safe local; voice settings via voice/prefs.ts KV honored per-turn; D-17 update voice-streaming-no-write ratchet for write-capability (allow voiceConfirm, keep banning raw write-chokepoint imports).

**Phase 16** code-complete (verifier 13/13); 5-test runtime smoke deferred to user (`pnpm dev`). **Phase 15** packaged-verify debts open.
Keep `workflow.use_worktrees=false` (Windows). NOT pushed — ~32 commits ahead of origin.

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
