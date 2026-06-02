# Aria Roadmap

**Project:** Aria - local-first desktop AI executive assistant
**Created:** 2026-05-14
**Granularity:** Standard | Mode: MVP | Phases: 8 | Requirements covered: 56/56

## Phase Overview

| # | Phase | Goal | Plans (est) |
|---|---|---|---|
| 1 | 5/5 | Complete   | 2026-05-16 |
| 2 | Gmail + Daily Briefing MVP | First useful slice - Gmail inbound, today calendar, briefing generated and displayed | 4 |
| 3 | 5/5 | Complete   | 2026-05-18 |
| 4 | Calendar Smart-Scheduling (Google) | Aria reschedules a meeting from a natural-language command, conflict-aware | 3/3 complete |
| 5 | Outlook Parity (email + calendar) | Aria works for an Outlook/M365 exec the same as a Google one | 3 |
| 6 | Meeting Capture + Todoist Push | Aria turns a pasted transcript into action items in Todoist | 3 |
| 7 | 3/3 | Complete   | 2026-05-19 |
| 8 | 4/4 | Complete (pending verification) |  |

---

## Phase Details

### Phase 1: Foundation

**Goal:** Desktop app shell with encrypted local store, LLM router skeleton, and a hello-briefing stub working end-to-end
**Mode:** mvp
**Requirements:** FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, LLM-01, LLM-03, LLM-04, LLM-05
**Plans:** 5/5 plans complete
Plans:

- [ ] 01-01-scaffold-PLAN.md — Electron 42 + electron-vite + React + TS + Tailwind + shadcn scaffold; secure preload bridge; pino redacted log sink; vitest + playwright _electron smoke (wave 1)
- [x] 01-02-db-passphrase-PLAN.md — BIP39 mnemonic + scrypt vault + SQLCipher chacha20 DB + migration runner + VACUUM-INTO backup/restore + onboarding wizard (wave 2)
- [x] 01-03-secrets-settings-PLAN.md — Electron safeStorage frontier-key layer (Linux basic_text refusal) + Ollama probe + Settings UI sections + Google CASA intake D-15 (wave 2)
- [x] 01-04-llm-router-PLAN.md — Hard-rules classifier + LLM router over AI SDK 6 (Anthropic/OpenAI/Google/Ollama via ollama-ai-provider-v2) + routing_log + Settings → Diagnostics Ask-Aria + hello-Aria e2e (wave 3)

**Plans (estimated):**

1. Electron 33 + Vite + React + TS scaffold via electron-vite; dev build runs on macOS and Windows
2. SQLite + better-sqlite3 + SQLCipher schema and migrations; recovery passphrase onboarding; encrypted backup/restore
3. safeStorage secrets layer; Settings UI for frontier API key; Ollama detection and status panel
4. LLM router skeleton (Vercel AI SDK 5 + Anthropic + ollama-ai-provider) with hard-rules sensitivity classifier and routing log

**Success Criteria:**

1. User installs Aria, sets a recovery passphrase, and sees a working app window
2. Frontier API key stored only in OS keychain (verifiable)
3. User asks Aria a question and the routing decision is logged (LOCAL or FRONTIER) with a reason
4. Encrypted SQLCipher DB is created, backed up, and restored successfully
5. With Ollama not installed, Aria warns and offers install instructions instead of silent failure

Cross-cutting in Phase 1: kick off Google CASA security review (multi-week lead time for gmail.send used in Phase 3); document data dir under userData; PII redaction at the log sink.

### Phase 2: Gmail Ingest + Daily Briefing MVP

**Goal:** As a busy SMB executive, I want to connect Gmail and Google Calendar to Aria and have it ingest mail and events locally on a schedule, so that I can read a daily briefing without giving Aria send or write permissions yet.
**Mode:** mvp
**Requirements:** EMAIL-01, EMAIL-07, CAL-01 (read portion), BRIEF-01, BRIEF-03, BRIEF-06, XCUT-01, XCUT-06, XCUT-07
**Plans:** 4/4 plans complete
Plans:

- [x] 02-01-gmail-ingest-PLAN.md — Gmail OAuth (loopback IP + PKCE) + read-only ingest with historyId + 7-day backfill + 5-min cron + EMAIL-07 banner + StatusPanel row + invalid_grant detection (wave 1, autonomous: false — GCP setup checkpoint)
- [x] 02-02-calendar-ingest-PLAN.md — Google Calendar OAuth (reuses connectGoogle) + read-only ingest via syncToken + 410 fallback + all-day/timed event normalization (XCUT-07) + 15-min cron + Calendar row + StatusPanel row (wave 2, depends on 02-01)
- [x] 02-03-briefing-news-PLAN.md — News sources (HN + RSS + NG country bundle) with URL resolution + CountrySectorPicker onboarding step + NewsSourcesSection Settings + migration 004 news_source table (wave 3, depends on 02-02)
- [x] 02-04-briefing-engine-PLAN.md — Briefing engine: Promise.allSettled gather + M1 PII redaction + generateObject(BriefingSchema) via Phase 1 router + B4 SC2 fallback for no-IMPORTANT accounts + scheduler with lastFiredDate + powerMonitor coalescing + BriefingScreen UI + BriefingSettingsSection + Playwright e2e + migration 005 briefing/dismissed tables (wave 4, depends on 02-03)

**Success Criteria:**

1. User connects Gmail; new mail appears in Aria within 5 minutes
2. User wakes machine at 7am; sees a briefing covering today calendar, top unread mail, and external news; every item shows a "why this mattered" rationale (B4 fallback: when account has unread mail but no IMPORTANT labels, the email section displays a documented Phase-2-limitation placeholder pointing to Phase 3's classifier)
3. Expired Gmail token surfaces a re-auth banner; other features unaffected
4. Sleep/wake does not produce a cron storm (cronRegistry size invariant: 3 across suspend/resume)
5. External news section honors guardrails: bounded source list, no auto-action, user can dismiss/disable

### Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send

**Goal:** Aria writes its first email under user approval, with hybrid LLM routing live and defended
**Mode:** mvp
**Requirements:** APPR-01, APPR-03, APPR-04, APPR-05, APPR-06, APPR-07, LLM-02, EMAIL-03, EMAIL-04, EMAIL-05, EMAIL-06
**Plans (estimated):**

1. Approval Queue persisted entity and state machine (pending/generating/ready/approved/sent); UI surface; tier configuration infra in place (always-confirm vs per-recipient allowlist) but v1 ships with always-confirm default only — allowlist UI deferred to v1.x
2. Sensitivity classifier upgrade (local LLM via generateObject + Zod); redaction layer with re-hydration; PII regression eval; routing-log audit UI
3. Email triage agent (priority + first-class "why this mattered" rationale on every triage decision, surfaced inline in the queue); thread summarization on demand
4. Voice-match spike: few-shot from sent mail vs local fine-tune — pick approach against held-out eval before building. Then Email drafting agent on chosen path -> Approval Queue; Gmail send scope OAuth using CASA-approved credentials; send + audit log

**Success Criteria:**

1. User cannot send any email without an explicit approval action (verified by attempted bypass)
2. PII-like content classifies as sensitive and routes LOCAL; routing log shows decision + reason
3. User approves a draft; email sends via Gmail; appears in Sent folder
4. Approval queue items survive an app crash mid-generation; never transition to sent without explicit user action
5. Draft voice match passes a held-out eval vs prior sent emails
6. Every triage decision carries a user-visible "why this mattered" rationale; rationale is structured and auditable
7. Tier config schema exists and is enforced by the gate even though only the always-confirm tier is user-selectable in v1

Pre-Phase-3 gate: recruit at least one real SMB-exec design partner per PROJECT.md key decision.

### Phase 4: Calendar Smart-Scheduling (Google)

**Goal:** Aria reschedules a meeting from a natural-language command, with conflict detection and rules respected
**Mode:** mvp
**Requirements:** CAL-04, CAL-05, CAL-06, CAL-07, APPR-02
**Plans:** 3/3 plans complete
Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Migration 010 + calendar.events OAuth + rrule.js + recurrence.ts (this/future/all) + write-event.ts APPR-02 chokepoint + static-grep ratchet (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — RulesSchema (shared zod) + Settings UI + pure-function conflict detector with top-3 alternatives + CAL-07 prime-time bonus (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — End-to-end MVP slice: parseIntent + resolveTarget + assertSelfOnly + proposeCalendarChange + SchedulingChat + ApprovalCard calendar variant + e2e (wave 3)

**Plans (estimated):**

1. Calendar write scope OAuth; canonical Event model; Google recurring-event handling (this instance / all future / all)
2. Scheduling rules engine (focus blocks, buffers, no-meeting windows, time-zone preferences); user settings UI
3. Smart-scheduling agent: NL command -> proposed change -> conflict check -> Approval Queue; approval flow for calendar items

**Success Criteria:**

1. User types "move my 3pm to Thursday" and sees a proposed change with conflict check, awaiting approval
2. Approved calendar changes write back to Google Calendar with correct time-zone handling
3. Aria refuses to schedule into a focus block without explicit override
4. Recurring meeting moves handle the "this instance / all future / all" decision explicitly

### Phase 5: Outlook Parity (Email + Calendar)

**Goal:** Aria works for an Outlook/M365 exec the same as a Google one
**Mode:** mvp
**Requirements:** EMAIL-02, CAL-02, CAL-03, CAL-08
**Plans:** 3 plans
Plans:

- [ ] 05-01-PLAN.md — Microsoft adapter alongside Google: MSAL PKCE + Graph mail/calendar delta sync + RFC5545 boundary conversion + migrations 011/012 + per-provider keyring + per-(provider,account) p-queue isolation; identity-set self-only gate (wave 1, autonomous: false — M365 dev tenant + Azure AD app registration checkpoint)
- [ ] 05-02-PLAN.md — Generalize via Provider interface: src/shared/provider.ts + ProviderRegistry + SyncOrchestrator; lift chokepoints to src/main/integrations/{write-event,send}.ts with L-04-05 transition-after-write fix; static-grep ratchets for calendar AND mail; AddAccountModal w/ provider picker (wave 2, depends on 05-01, autonomous: false — live Outlook send + calendar move smoke)
- [ ] 05-03-PLAN.md — Unified surfaces (CAL-03): UnifiedCalendarScreen w/ per-account color + visibility toggle; AccountChip across briefing/approvals/calendar; ProviderStatusTray; ApprovalCard L-04-03 + L-04-10 fixes; migration 013 legacy singleton views + googleTokens drop; 05-UAT.md (wave 3, depends on 05-02, autonomous: false — Phase 5 UAT execution)

**Success Criteria:**

1. User connects an Outlook account; Outlook mail appears alongside Gmail in the briefing
2. User connects Outlook Calendar; unified view shows both calendars; smart-scheduling works on Outlook calendar
3. A recurring event from Outlook displays identically to one from Google
4. Token expiry on Outlook surfaces a re-auth banner; other providers continue working

### Phase 6: Meeting Capture + Todoist Push

**Goal:** Aria turns a pasted transcript into structured action items pushed to Todoist
**Mode:** mvp
**Requirements:** MEET-01, MEET-02, MEET-03, MEET-04, MEET-05, MEET-06, TASK-01, TASK-02
**Plans:** 3 plans
Plans:

- [x] 06-01-PLAN.md — Transcript/Note foundation: migration 123 meeting_note + segments; transcript normalization for paste/txt/vtt/srt/json; calendar-event linking heuristic; /meetings capture + NoteView shell; MEET-06 no-bot static guardrails (wave 1, autonomous: false)
- [x] 06-02-PLAN.md — Cited extraction + review: migration 124 summary/action tables + task_batch approval kind; chunked generateObject extraction; citation validation; NoteReviewScreen with transcript highlighting; task-batch ApprovalCard (wave 2, depends on 06-01)
- [x] 06-03-PLAN.md — Todoist + Tasks view: migration 125 task provider schema; Todoist token settings + adapter; approved action push; Todoist pull sync; /tasks unified dashboard; briefing Open Actions; 06-UAT.md (wave 3, depends on 06-02, autonomous: false — live Todoist token smoke deferred)

**Plans (original estimate):**

1. Transcript ingest (paste / file upload) with calendar event linking; canonical Note entity
2. Action-item extraction with structured citations (transcript span); structured summary (decisions/actions/follow-ups); approval flow for created tasks
3. Todoist adapter (API token auth) for read + write sync; dashboard surface for tasks alongside extracted actions

**Success Criteria:**

1. User pastes a transcript; Aria links it to the right calendar event and produces a summary with cited action items
2. Approved action items appear in Todoist within one sync cycle
3. Every action item is clickable to the source transcript span
4. Aria does not join meetings as a bot or store cloud recordings (verifiable by code review and tests)

### Phase 7: RAG Q&A

**Goal:** Cited natural-language Q&A over the user own data ("What did Sarah commit to on Q3?")
**Mode:** mvp
**Requirements:** RAG-01, RAG-02, RAG-03, RAG-04, RAG-05
**Plans:**

- [x] 07-01-PLAN.md - Chunking strategy spike on Aria-stored mail/calendar/transcripts/actions; schema and decision record
- [x] 07-02-PLAN.md - Local embedding pipeline with Ollama, sqlite-vec/fallback index, incremental re-index, and model-id versioning
- [x] 07-03-PLAN.md - Hybrid RAG query agent, person disambiguation, cited answer UI, and Q&A chat surface

**Success Criteria:**

1. User asks a natural-language question about content in their inbox/calendar/transcripts and receives an answer with at least one verifiable citation
2. Editing a source message triggers re-embedding of affected chunks within one sync cycle
3. Querying for a person name returns the right entity on a 10-case manual eval
4. Embedding model swap rebuilds the index; old vectors are not silently re-used

### Phase 8: Insights, Weekly Recap, Learning, Release Prep

**Goal:** Recap shipped, insights derived, learning loop closed, app signed and shippable
**Mode:** mvp
**Requirements:** INSIGHT-01, INSIGHT-02, INSIGHT-03, RECAP-01, RECAP-02, RECAP-03, RECAP-04, LEARN-01, LEARN-02, LEARN-03, BRIEF-02, BRIEF-04, BRIEF-05, XCUT-02, XCUT-04, XCUT-05
**Plans (estimated):**

1. Insights computation over user history (calendar-load delta, response-time trends, recurring themes); briefing integration; routed prose generation
2. Weekly recap agent: meetings/actions/wins/upcoming PLUS an explicit "What Aria did this week" section stitched from the action audit log (drafts sent, meetings moved, tasks pushed, approvals declined); editable preview; PDF/DOCX export via docx + @react-pdf/renderer
3. Preference learning loop wired to approval feedback (edits, rejects); local-only; user-inspectable preferences with reset
4. Release prep: macOS notarization, Windows OV signing, electron-updater feed, pre-migration DB backup, antivirus runbook, final integration testing

**Success Criteria:**

1. User receives a weekly recap covering meetings, actions, wins, and what is coming, with an explicit "What Aria did this week" section sourced from the action audit log; editable and exportable
2. After two weeks of use, briefing includes at least one insight derived from the user own data
3. Drafts after week two are observably closer to the user voice than week one (manual eval)
4. Auto-updater installs a new version, runs schema migration, and restores from backup if migration fails (verified in test)
5. macOS build passes notarization; Windows build is OV-signed and installs cleanly past SmartScreen reputation seed *at GA release*. Initial v1 tester build ships Windows-unsigned (amended per CONTEXT 2026-05-17 staged signing decision).

### Phase 08.1: Subscription and 60-Day Trial — Stripe Billing integration with Customer Portal and webhooks; license-key entitlement with periodic online check, offline grace period, and signed entitlement cached locally; 60-day trial starts on first launch with no card required, trial state persisted in encrypted SQLite; paywall UX on trial expiry with restore-license flow (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 2/3 plans executed

Plans:
- [ ] TBD (run /gsd-plan-phase 08.1 to break down)

### Phase 9: Implement product UI from Anthropic design system (design ref VGTQmBNc8uXN62kH9DBTXA — fetch design file + README, apply to product UI, integrate logo; landing page out of scope)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 6/6 plans code-complete (milestone gated on human walkthrough — Task 3 of 09-06)

Plans:

- [ ] TBD (run /gsd-plan-phase 9 to break down)

### Phase 10: Knowledge Folders

**Goal:** Register local folders as knowledge sources for /ask. Aria walks, parses (.txt/.md/.csv/.docx/.xlsx/.pdf), chunks + embeds into the Phase 7 chunks table with corpus=folder, watches live (chokidar + tombstones + 24h resurrection), and forces local-only LLM routing per turn when any chunk from a sensitivity=sensitive folder enters the retrieval set. Google Drive deferred.
**Requirements**: SPEC-§3, SPEC-§4, SPEC-§5, SPEC-§6, SPEC-§7, SPEC-§8, SPEC-§9, SPEC-§10, SPEC-§11 (Phase 10 inserted after v1 REQ-ID lock — see canonical spec docs/superpowers/specs/2026-05-21-knowledge-folders-design.md)
**Depends on:** Phase 9
**Plans:** 2/3 plans executed

Plans:
- [x] 10-01-PLAN.md — Migration 132, FolderRegistry, parser registry, FileScanner + ChunkStore one-shot ingest, full IPC surface (incl. prescan)
- [x] 10-02-PLAN.md — Per-turn sensitivity gate extension, chokidar watcher + tombstones + 24h resurrection, daily 03:00 cron sweep, boot reconciler, powerMonitor, Phase 7 model-swap reconciler integration verified
- [ ] 10-03-PLAN.md — KnowledgeFoldersSection editorial UI + prescan-confirm + destructive remove dialog (3-split contract) + integration round-trip + Playwright E2E + human-verify UAT

### Phase 11: Research

**Goal:** Aria lets users commission web-backed research jobs (manual + transcript auto-detected), renders versioned reports in Document and Dashboard views, and refines results through a structured per-section feedback loop
**Requirements:** RES-01, RES-02, RES-03, RES-04, RES-05, RES-06, RES-07, RES-08
**Depends on:** Phase 6, Phase 9
**Plans:** 2/3 plans executed

Plans:
- [x] 11-01-PLAN.md — Migration 132 + ipc-contract DTOs + EntitlementAction extension + ResearchService + SearchProviderService + static ratchets (wave 1)
- [x] 11-02-PLAN.md — research.ts IPC handlers + index.ts registration + transcripts.ts hook + renderer UI components + route + Integrations key rows (wave 2)
- [ ] 11-03-PLAN.md — SideNav Research link + unit/integration/UI tests + human-verify UAT (wave 3)

### Phase 12: Background Activity (Tray + Auto-launch)

**Goal:** Aria runs in the background after the user closes the main window and auto-launches on login. The daily briefing cron and integration sync keep firing while the window is hidden; the user is notified via native OS notification when the briefing is ready. Win + Mac only; Linux deferred.
**Requirements:** new — BG-01 close-to-tray (Win+Mac), BG-02 auto-launch on login w/ Settings toggle, BG-03 native OS notification on briefing complete (click→/briefing), BG-04 silent cron skip when DB sealed + tray badge + first-unlock catchup, BG-05 rich tray menu (Show/Generate briefing/Sync now submenu/Open approvals/Quit), BG-06 platform tray icon assets (.ico for Win, Template PNG @1x/@2x for Mac), BG-07 first-X close-to-tray discoverability toast (one-time, on first window close with closeToTray=true), BG-08 Settings → Behaviour section UI surfacing the three background prefs (autoLaunch, closeToTray, notificationsEnabled) using the editorial Checkbox primitive.
**Depends on:** Phase 8 (user_prefs), Phase 9 (settings UI shell)
**Context:** see [12-CONTEXT.md](phases/12-background-activity-tray-and-autolaunch/12-CONTEXT.md) — 6 decisions locked.
**Plans:** 1/3 plans executed

Plans:
- [ ] TBD (run /gsd-plan-phase 12 to break down)

### Phase 13: Open-Source Release Prep: publish Aria as a documented, source-available MIT project

**Goal:** Publish Aria as a documented, source-available MIT project — pre-publish safety pass (secret scan + .planning sensitivity review), root docs (README/LICENSE/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT), docs/DEVELOPMENT.md + docs/ARCHITECTURE.md, GitHub issue/PR templates, and package.json metadata cleanup.
**Requirements**: none (documentation + release-prep phase)
**Depends on:** Phase 12
**Plans:** 4/4 plans complete

Plans:
- [x] 13-01-PLAN.md — Pre-publish safety pass: full git-history secret scan + .planning sensitivity review + stray-file disposition (wave 1, autonomous: false — user sign-off checkpoint)
- [x] 13-02-PLAN.md — Root community docs: README.md, LICENSE (MIT), CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md (wave 2)
- [x] 13-03-PLAN.md — Developer + architecture docs: docs/DEVELOPMENT.md (grounded in package.json) + docs/ARCHITECTURE.md (grounded in src/) (wave 2)
- [x] 13-04-PLAN.md — GitHub scaffolding + metadata: .github issue/PR templates + package.json OSS fields + AGENTS.md Codex cleanup (wave 2)

---

## Notes for Planners

- **Phase 1 also kicks off Google CASA procurement** in parallel (multi-week lead time required for the gmail.send scope used in Phase 3).
- **Recruit one real SMB-exec design partner before Phase 3** - the PROJECT.md key decision flagged this as a Revisit item; do not build the Approval Queue UX without one real user touching it.
- **Phase 7 (RAG) requires Phase 2 (email), Phase 4 (calendar), and Phase 6 (meetings) to have ingested real data.** Confirm dependencies at the planning gate.
- **Cross-cutting NFRs in every phase:** approval discipline, audit-log of sensitive routing, sleep/wake correctness, log redaction, "I used Aria today" criterion for the solo dev (dogfood from Phase 1).
- **Defend the cuts at every phase boundary:** voice / health / call/VoIP / CRM / BI / IoT stay cut. Scope sprawl is the meta-pitfall.

## Coverage Validation

All 56 unique v1 REQ-IDs in REQUIREMENTS.md map to exactly one primary phase:

- Phase 1: FOUND-01..07, LLM-01, LLM-03..05 (11)
- Phase 2: EMAIL-01, EMAIL-07, CAL-01, BRIEF-01, BRIEF-03, BRIEF-06, XCUT-01, XCUT-06, XCUT-07 (9)
- Phase 3: APPR-01, APPR-03..07, LLM-02, EMAIL-03..06 (11)
- Phase 4: CAL-04..07, APPR-02 (5)
- Phase 5: EMAIL-02, CAL-02, CAL-03, CAL-08 (4)
- Phase 6: MEET-01..06, TASK-01, TASK-02 (8)
- Phase 7: RAG-01..05 (5)
- Phase 8: INSIGHT-01..03, RECAP-01..04, LEARN-01..03, BRIEF-02, BRIEF-04, BRIEF-05, XCUT-02, XCUT-04, XCUT-05 (16)

Total: 69 line items covering all 56 unique REQ-IDs. Some cross-cutting requirements (XCUT-03) are infrastructure work that ships continuously - logging discipline ships in Phase 1 and is enforced in every subsequent phase plan.
