# v1 Requirements

**Generated:** 2026-05-14
**Source:** PROJECT.md v1 scope + research/SUMMARY.md (table stakes + differentiators)
**Mode:** YOLO / auto-included all table stakes; deferred items in v2 / out-of-scope per PROJECT.md

## v1 Requirements

### Foundation (FOUND)

- [ ] **FOUND-01**: User can install and launch Aria as a signed desktop app (macOS, Windows; Linux best-effort)
- [ ] **FOUND-02**: User sees a first-launch onboarding that captures their identity, sets a recovery passphrase, and confirms the recovery phrase
- [ ] **FOUND-03**: All user data is stored locally in an encrypted SQLite database (SQLCipher whole-DB encryption)
- [ ] **FOUND-04**: User can export an encrypted backup file and restore from it on the same machine
- [ ] **FOUND-05**: User can configure a frontier API key (Anthropic / OpenAI / Google) via Settings; key is stored in OS keychain
- [ ] **FOUND-06**: User can install and connect a local Ollama daemon; Aria detects Ollama availability and routes accordingly
- [ ] **FOUND-07**: User can see Aria operational status (online / offline, Ollama running, API key present) at a glance

### Hybrid LLM Routing (LLM)

- [ ] **LLM-01**: System routes prompts containing PII / sensitive content to the local model only; never to a frontier API
- [ ] **LLM-02**: System redacts identifiable content (names, emails, financial figures) before any frontier API call; restores on response
- [ ] **LLM-03**: System logs every routing decision with reason; user can inspect the routing log
- [ ] **LLM-04**: System fails closed - if classifier is uncertain, route LOCAL by default
- [ ] **LLM-05**: System degrades gracefully when frontier API is unreachable (offline, rate-limited, missing key) - LOCAL path stays usable

### Approval Queue (APPR)

- [ ] **APPR-01**: All outbound communication (email sends) requires an explicit approval action before transmission
- [x] **APPR-02**: All material calendar changes (move, cancel, accept on user behalf) require explicit approval
- [ ] **APPR-03**: Approval card shows recipients, subject, full body preview, and any diff vs the originating draft
- [ ] **APPR-04**: User can approve, edit-then-approve, or reject each item; rejections recorded for learning
- [ ] **APPR-05**: User can see a queue of pending approvals; approvals survive app restart
- [ ] **APPR-06**: User can configure approval tiers per content class (silent / explicit / always-confirm); default = explicit for all sends
- [ ] **APPR-07**: Sensitivity classifier flags risky drafts (financial, legal, HR, urgent tone) for forced explicit approval regardless of tier

### Email Integration (EMAIL)

- [ ] **EMAIL-01**: User can OAuth-connect a Gmail account (read scope) and Aria ingests incoming mail incrementally
- [ ] **EMAIL-02**: User can OAuth-connect an Outlook/Microsoft 365 account (read scope) and Aria ingests incoming mail incrementally
- [ ] **EMAIL-03**: System classifies each new message by priority and surfaces "what needs the user" with a rationale string
- [ ] **EMAIL-04**: User can request a summary of any long email thread on demand
- [ ] **EMAIL-05**: System drafts replies in the user voice (learned from sent mail); drafts enter the Approval Queue
- [ ] **EMAIL-06**: User can send approved drafts via the original provider (Gmail/Outlook); send-scope OAuth required and obtained
- [ ] **EMAIL-07**: System detects and gracefully handles expired OAuth tokens with a re-auth prompt

### Calendar Integration (CAL)

- [ ] **CAL-01**: User can OAuth-connect Google Calendar; events synced bidirectionally with conflict handling
- [ ] **CAL-02**: User can OAuth-connect Outlook/Microsoft Calendar via Graph; events synced
- [ ] **CAL-03**: User sees a unified multi-calendar view spanning work and personal sources
- [x] **CAL-04**: User can issue natural-language scheduling commands ("move my 3pm to Thursday"); system proposes via Approval Queue
- [x] **CAL-05**: System detects scheduling conflicts before write and proposes alternative time slots
- [x] **CAL-06**: User can define scheduling rules (focus blocks, buffers, no-meeting windows, time-zone preferences); rules enforced when finding slots
- [x] **CAL-07**: System honors user-defined priority for prime-time scheduling
- [ ] **CAL-08**: System normalizes recurring events across providers correctly (Google and Microsoft semantics differ)

### Meeting Capture (MEET)

- [ ] **MEET-01**: User can paste or upload a meeting transcript (any text format); Aria ingests it linked to a calendar event when possible
- [ ] **MEET-02**: System extracts action items with owners and due-date hints from a transcript; surfaces them for review
- [ ] **MEET-03**: Every extracted action item has a citation to the source transcript span; user can click to verify
- [ ] **MEET-04**: System generates a structured meeting summary (decisions / actions / follow-ups)
- [ ] **MEET-05**: Approved action items push to the user task system (Todoist for v1)
- [ ] **MEET-06**: System never adds itself as a bot attendee to live meetings and never records cloud-side

### Task System (TASK)

- [ ] **TASK-01**: User can connect a Todoist account via API token; tasks created in Aria appear in Todoist within one sync cycle
- [ ] **TASK-02**: User can see tasks pulled from Todoist alongside Aria-extracted action items in the dashboard

### Daily Briefing (BRIEF)

- [ ] **BRIEF-01**: User receives a daily briefing at a configurable local time (default 7am)
- [x] **BRIEF-02**: Briefing surfaces top 3-5 priorities for the day with a rationale for each
- [ ] **BRIEF-03**: Briefing includes today calendar preview, overdue tasks, unread priority email, and external news items
- [x] **BRIEF-04**: User can configure news topics / interests for the briefing
- [x] **BRIEF-05**: User can give feedback on the briefing (more like / skip section); preferences refine over time
- [ ] **BRIEF-06**: Briefing degrades gracefully if any source (email, calendar, news) is unavailable

### Insights (INSIGHT)

- [x] **INSIGHT-01**: System computes trend insights from the user own data (calendar load week-over-week, email response-time trends, recurring meeting themes) after at least 2 weeks of history
- [x] **INSIGHT-02**: Insights appear in the daily briefing and weekly recap
- [x] **INSIGHT-03**: System never sends insight underlying data to a frontier API; insight prose generation is routed appropriately

### Conversational Q&A / RAG (RAG)

- [x] **RAG-01**: System indexes the user emails, meeting transcripts, and calendar events locally using nomic-embed-text (or equivalent)
- [x] **RAG-02**: User can ask natural-language questions ("what did Sarah commit to on Q3?") and get a cited answer
- [ ] **RAG-03**: Every RAG answer cites at least one source (email / transcript / event); user can click to inspect the source
- [ ] **RAG-04**: System uses hybrid retrieval (BM25 + vector) for accuracy on named entities
- [x] **RAG-05**: System re-indexes incrementally when source data is updated or deleted

### Weekly Recap (RECAP)

- [x] **RECAP-01**: System auto-generates a weekly recap covering meetings held, actions closed/open, wins, and what is coming
- [x] **RECAP-02**: Recap includes an "audit log" of Aria actions for the week (drafts sent, meetings moved, action items created)
- [x] **RECAP-03**: User can edit the recap before finalizing; edits feed preference learning
- [x] **RECAP-04**: User can export the recap as PDF or DOCX

### Preference Learning (LEARN)

- [x] **LEARN-01**: System captures edits, rejections, and accepts on approval items and uses them to refine voice and routing over time
- [x] **LEARN-02**: Preference learning is local-only - no learning signal is sent off-machine
- [x] **LEARN-03**: User can inspect learned preferences and reset them

### Cross-Cutting / Quality (XCUT)

- [ ] **XCUT-01**: Aria handles sleep/wake events cleanly (no cron storm on resume; missed jobs coalesced)
- [x] **XCUT-02**: Aria persists work-in-progress (drafts being generated) across crashes without ever auto-transitioning to "sent"
- [ ] **XCUT-03**: Application logs redact PII before write; debug logs are local-only, opt-in
- [x] **XCUT-04**: Auto-updater performs a pre-migration database backup; failed migrations auto-restore
- [x] **XCUT-05**: Application is code-signed and notarized (macOS) at v1 release. Windows OV signing applies at **GA release**; initial v1 tester build ships Windows-unsigned with documented SmartScreen warning. OV cert acquired and Windows signing wired after tester usage period (user-confirmed staged approach 2026-05-17).
- [ ] **XCUT-06**: Aria provides a status panel showing sync state, queue depth, last error per integration
- [ ] **XCUT-07**: Aria respects user time zone correctly across all integrations

## v2 Requirements (Deferred)

Per PROJECT.md - defer until v1 validates:
- Voice interface (STT/TTS, voice commands)
- Personal Health pillar (devices, vitals, alerts, medication, lab parsing)
- Full executive Reports beyond weekly recap (monthly, quarterly, KPI dashboards, budget proposals)
- Predictive analytics beyond own-data trends (business forecasting, industry models)
- Multi-party meeting coordination (external attendee negotiation)
- Special-date tracking and personal relationship reminders
- Administrator role, RBAC, enterprise policy enforcement
- Developer SDK / plugin marketplace
- Live meeting capture via local Whisper
- Asana + Jira task system integrations
- Multi-device sync
- Cross-account email composition

## Out of Scope (Cut)

Per PROJECT.md - explicitly not building:
- Call handling / VoIP / Twilio - too much eng for solo dev
- IoT / smart-home / security cameras / computer vision - wrong domain
- CRM integrations (Salesforce, HubSpot) - enterprise complexity
- BI tools (Tableau, Power BI) - enterprise complexity

## Traceability

(Populated by ROADMAP.md - each requirement mapped to exactly one phase.)

## Phase Mapping (filled by ROADMAP.md)

| Phase | Requirements |
|---|---|
| Phase 1 Foundation | FOUND-01..07, LLM-01, LLM-03..05 |
| Phase 2 Gmail + Briefing MVP | EMAIL-01, EMAIL-07, CAL-01, BRIEF-01, BRIEF-03, BRIEF-06, XCUT-01, XCUT-06, XCUT-07 |
| Phase 3 Approval + Router + Email | APPR-01, APPR-03..07, LLM-02, EMAIL-03..06 |
| Phase 4 Calendar Smart-Scheduling | CAL-04..07, APPR-02 |
| Phase 5 Outlook Parity | EMAIL-02, CAL-02, CAL-03, CAL-08 |
| Phase 6 Meeting Capture + Todoist | MEET-01..06, TASK-01, TASK-02 |
| Phase 7 RAG Q&A | RAG-01..05 |
| Phase 8 Insights / Recap / Learning / Release | INSIGHT-01..03, RECAP-01..04, LEARN-01..03, BRIEF-02, BRIEF-04, BRIEF-05, XCUT-02, XCUT-04, XCUT-05 |
| Cross-cutting (every phase) | XCUT-03 (log redaction discipline) |
