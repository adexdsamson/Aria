# Aria Roadmap

**Project:** Aria - local-first desktop AI executive assistant
**Created:** 2026-05-14
**Granularity:** Standard | Mode: MVP | Phases: 8 | Requirements covered: 56/56

## Phase Overview

| # | Phase | Goal | Plans (est) |
|---|---|---|---|
| 1 | Foundation | Desktop app shell with encrypted local store, LLM router skeleton, and "hello briefing" stub end-to-end | 4 |
| 2 | Gmail + Daily Briefing MVP | First useful slice - Gmail inbound, today calendar, briefing generated and displayed | 3 |
| 3 | Approval Queue + Sensitivity Router + Email Triage/Drafting/Send | Aria writes its first email under user approval, with hybrid LLM routing live | 4 |
| 4 | Calendar Smart-Scheduling (Google) | Aria reschedules a meeting from a natural-language command, conflict-aware | 3 |
| 5 | Outlook Parity (email + calendar) | Aria works for an Outlook/M365 exec the same as a Google one | 3 |
| 6 | Meeting Capture + Todoist Push | Aria turns a pasted transcript into action items in Todoist | 3 |
| 7 | RAG Q&A | Cited natural-language Q&A over user own data | 3 |
| 8 | Insights, Recap, Learning, Release Prep | Weekly recap shipped, insights derived, learning loop closed, app signed and shippable | 4 |

---

## Phase Details

### Phase 1: Foundation
**Goal:** Desktop app shell with encrypted local store, LLM router skeleton, and a hello-briefing stub working end-to-end
**Mode:** mvp
**Requirements:** FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, LLM-01, LLM-03, LLM-04, LLM-05
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
**Goal:** First useful slice - Gmail inbound, today calendar, briefing generated and displayed
**Mode:** mvp
**Requirements:** EMAIL-01, EMAIL-07, CAL-01 (read portion), BRIEF-01, BRIEF-03, BRIEF-06, XCUT-01, XCUT-06, XCUT-07
**Plans (estimated):**
1. Gmail OAuth (loopback IP flow); read-only ingest with historyId change tokens; rate-limited backfill; reconciliation pass
2. Google Calendar OAuth + read-only ingest with delta tokens (write capability deferred to Phase 4)
3. Briefing agent v1: today calendar preview + unread priority email + external news placeholder; daily cron with sleep/wake coalescing; UI surface
**Success Criteria:**
1. User connects Gmail; new mail appears in Aria within 5 minutes
2. User wakes machine at 7am; sees a briefing covering today calendar and top unread mail
3. Expired Gmail token surfaces a re-auth banner; other features unaffected
4. Sleep/wake does not produce a cron storm

### Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send
**Goal:** Aria writes its first email under user approval, with hybrid LLM routing live and defended
**Mode:** mvp
**Requirements:** APPR-01, APPR-03, APPR-04, APPR-05, APPR-06, APPR-07, LLM-02, EMAIL-03, EMAIL-04, EMAIL-05, EMAIL-06
**Plans (estimated):**
1. Approval Queue persisted entity and state machine (pending/generating/ready/approved/sent); UI surface; tier configuration
2. Sensitivity classifier upgrade (local LLM via generateObject + Zod); redaction layer with re-hydration; PII regression eval; routing-log audit UI
3. Email triage agent (priority + rationale); thread summarization on demand
4. Email drafting agent (voice-match few-shot from sent mail) -> Approval Queue; Gmail send scope OAuth using CASA-approved credentials; send + audit log
**Success Criteria:**
1. User cannot send any email without an explicit approval action (verified by attempted bypass)
2. PII-like content classifies as sensitive and routes LOCAL; routing log shows decision + reason
3. User approves a draft; email sends via Gmail; appears in Sent folder
4. Approval queue items survive an app crash mid-generation; never transition to sent without explicit user action
5. Draft voice match passes a held-out eval vs prior sent emails

Pre-Phase-3 gate: recruit at least one real SMB-exec design partner per PROJECT.md key decision.

### Phase 4: Calendar Smart-Scheduling (Google)
**Goal:** Aria reschedules a meeting from a natural-language command, with conflict detection and rules respected
**Mode:** mvp
**Requirements:** CAL-04, CAL-05, CAL-06, CAL-07, APPR-02
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
**Plans (estimated):**
1. MSAL-node + Microsoft Graph adapter for Outlook mail (read + send) with PKCE auth-code flow
2. Microsoft Graph adapter for calendar (read + write); recurring event normalization across providers
3. Unified multi-calendar view across Google + Outlook; provider-agnostic UI; integration testing on a real M365 tenant
**Success Criteria:**
1. User connects an Outlook account; Outlook mail appears alongside Gmail in the briefing
2. User connects Outlook Calendar; unified view shows both calendars; smart-scheduling works on Outlook calendar
3. A recurring event from Outlook displays identically to one from Google
4. Token expiry on Outlook surfaces a re-auth banner; other providers continue working

### Phase 6: Meeting Capture + Todoist Push
**Goal:** Aria turns a pasted transcript into structured action items pushed to Todoist
**Mode:** mvp
**Requirements:** MEET-01, MEET-02, MEET-03, MEET-04, MEET-05, MEET-06, TASK-01, TASK-02
**Plans (estimated):**
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
**Plans (estimated):**
1. Chunking strategy spike on real Aria-stored mail/transcripts (per-message vs per-thread vs hybrid); decision recorded
2. Embedding pipeline (nomic-embed-text via Ollama); sqlite-vec index colocated in SQLCipher DB; incremental re-index on edit/delete; model-id versioning
3. RAG query agent (hybrid BM25 + vector retrieval with entity disambiguation); cited answer UI; integration with Q&A chat surface
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
2. Weekly recap agent with audit log of Aria actions; editable preview; PDF/DOCX export via docx + @react-pdf/renderer
3. Preference learning loop wired to approval feedback (edits, rejects); local-only; user-inspectable preferences with reset
4. Release prep: macOS notarization, Windows OV signing, electron-updater feed, pre-migration DB backup, antivirus runbook, final integration testing
**Success Criteria:**
1. User receives a weekly recap covering meetings, actions, wins, and what is coming, plus an audit log of Aria actions; editable and exportable
2. After two weeks of use, briefing includes at least one insight derived from the user own data
3. Drafts after week two are observably closer to the user voice than week one (manual eval)
4. Auto-updater installs a new version, runs schema migration, and restores from backup if migration fails (verified in test)
5. macOS build passes notarization; Windows build is OV-signed and installs cleanly past SmartScreen reputation seed

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
