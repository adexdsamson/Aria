# Phase 6 Context: Meeting Capture + Todoist Push

**Phase:** 6
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** MEET-01, MEET-02, MEET-03, MEET-04, MEET-05, MEET-06, TASK-01, TASK-02

<domain>
Aria turns a pasted transcript into a structured, cited summary and pushes approved action items to Todoist. Delivers:
- Transcript ingest (paste / upload) with calendar event linking; canonical Note entity
- Action-item extraction with citation spans into source transcript
- Structured 5-section summary (topics / decisions / actions / follow-ups / open questions)
- Approval Queue flow for created tasks
- Todoist adapter (API token) for two-way sync
- Tasks view unifying Aria-extracted + Todoist tasks
- MEET-06 invariant: no bot attendees, no cloud-side recording — verifiable
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 6 scope, plans, success criteria (lines 115–125)
- `.planning/REQUIREMENTS.md` — MEET-01..06 (60–65), TASK-01..02 (69–70)
- `CLAUDE.md` — `@doist/todoist-api-typescript`, better-sqlite3 11, Vercel AI SDK 5 + Zod `generateObject`, p-queue
- `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md` — generic Approval Queue (accepts task-batch cards), sensitivity router for transcript content
- `.planning/phases/05-outlook-parity-email-calendar/05-CONTEXT.md` — Provider abstraction (Todoist becomes a `TaskProvider` capability), N-account, sync-state, isolation patterns
- `.planning/phases/04-calendar-smart-scheduling-google/04-CONTEXT.md` — canonical Event model used for transcript→event linking
- Todoist REST/Sync v9 API docs (researcher)
- VTT / SRT spec; Otter / Fireflies / tldv JSON export formats (researcher)
</canonical_refs>

<prior_decisions>
**Project-level:**
- Local-first; transcripts are sensitive — must run through Phase 3 sensitivity router
- All material outputs gated by Approval Queue (same trust posture as email/calendar)

**From Phase 3:**
- Approval Queue is generic — task-batch cards just register a new card type
- Sensitivity classifier runs on transcript chunks before frontier calls; HR/legal/financial categories at severity ≥ med route entirely local
- Tier schema and routing log reused

**From Phase 4:**
- Canonical Event model exists; transcript Note carries optional `eventRef`

**From Phase 5:**
- Provider abstraction exists with capability flags — Todoist becomes a new `task` capability on a `Provider`
- Sync-state table reused for Todoist cursor
- Hard-pause/soft-retry, per-provider keyring namespacing, re-auth chip pattern all apply
</prior_decisions>

<decisions>

### Transcript ingest + calendar linking
- **Supported formats (v1):** raw text (paste box + .txt upload), VTT, SRT, JSON exports (Otter / Fireflies / tldv), .docx, .pdf. Parsers normalize to a common internal text format with optional `speaker` and `timestamp` annotations.
- **Internal text model:** `{ normalizedText: string, segments: [{ start: charOffset, end: charOffset, speaker?, timestampSec? }] }`. Citations index `normalizedText`.
- **Chrome extension companion:** A separate companion project is being built that records the user's own browser audio locally during meetings and surfaces the transcript for the user to copy. **Out of scope for Phase 6 — Aria-side only handles the paste path.** No dependency, no bridge work in this phase. The extension's existence does NOT affect MEET-06 because Aria itself never joins or records.
- **Calendar event linking:** Time-window proximity (events within ±60min of upload time) **plus attendee/title fuzzy match from transcript content** (extract speaker names, topic keywords; cross-reference attendee email/display names and event title). Best match auto-selected with confidence; if confidence below threshold, picker with top-5 candidates.
- **No-event case:** Allow standalone transcript Notes (`eventRef` nullable). Action extraction and Todoist push work the same; the deep-link just opens the Note view.
- **Note entity:** `{ id, providerKey?: ('paste'|'upload'), source, ingestedAt, normalizedText, segments, eventRef?, title, summaryRef?, status }`.

### Action-item extraction schema
- **Citation span format:** **Char offsets into normalized transcript text** — `{ start: int, end: int }`. Robust across formats (timestamps stored separately on segments; citation is always a normalizedText range). Click → scrolls Note view and highlights span.
- **Owner inference (3 states):**
  - `self` — explicit user commitment ("I'll send the deck by Friday") → pushable to Todoist
  - `follow-up-with-X` — other person's commitment becomes a self-task variant ("Follow up with Sarah on Q3 numbers") → pushable to Todoist as a self-action
  - `unassigned` — when ambiguous, surfaced for review but not pushable until user assigns
- **Extraction output schema (Zod via `generateObject`):**
  ```ts
  {
    actions: [{
      text: string,
      owner: 'self' | 'follow-up' | 'unassigned',
      followUpWith?: string,           // when owner === 'follow-up'
      dueHint?: { iso?: string, raw: string, confidence: 'high'|'med'|'low' },
      priorityHint?: 'p1'|'p2'|'p3'|'p4',
      citation: { start, end },
      confidence: 0..1,
    }],
    summary: {
      topicsCovered: string[],
      decisions:  [{ text, citation }],
      actions:    [{ text, owner, followUpWith?, citation }],  // mirrors actions
      followUps:  [{ text, citation }],
      openQuestions: [{ text, citation }],
    },
    notes?: string,                    // free-form context the model wants to surface
  }
  ```
- **Summary structure (MEET-04):** 5 sections — Topics covered, Decisions, Actions, Follow-ups, Open Questions. Each item carries a citation span.
- **Due-date resolution:** `dueHint.iso` resolved relative to the meeting date (from linked event, or upload date if standalone). Only `confidence: high` hints become the Todoist `due` field; others stored as `dueHint.raw` for display.
- **LLM routing:** Transcript chunks go through Phase 3 sensitivity classifier first. HR/legal/financial at severity ≥ med run entirely local (chunks redacted-or-routed by classifier per phase 3 rules). All extraction LLM calls through p-queue.

### Todoist sync semantics
- **Direction: two-way** (push + pull).
  - **Push:** Approved Aria actions create Todoist tasks via Todoist API.
  - **Pull:** Periodic sync (using Todoist Sync API v9 incremental sync_token) pulls tasks/projects/labels for the Tasks view (TASK-02).
  - **Edits in Todoist:** propagate back to Aria-side action mirror; Aria-side edits propagate to Todoist.
  - **Conflict resolution:** last-write-wins on field-level; user sees a small "edited in Todoist" badge when remote changed after local. No three-way merge in v1.
- **Field mapping (push):**
  - **Title** ← action text (cleaned)
  - **Description** ← always includes a deep-link back to Aria Note + cited span (`aria://notes/{noteId}#{start}-{end}`) and the raw cited quote
  - **Due** ← `dueHint.iso` only when `confidence: high`; else blank
  - **Priority** ← `priorityHint` mapped to Todoist 1–4 (p1→4, p2→3, p3→2, p4→1)
  - **Project** ← user-configured default Todoist project (settings); per-Note override possible
  - **Labels** ← `#from-meeting` always; optional event-derived label (e.g. `#weekly-sync`) if event title matches a configured pattern
- **Reject after push:** Prompt the user — "Also remove the matching task from Todoist?" Three outcomes: remove (delete in Todoist), detach (keep in Todoist, Aria stops tracking), cancel.
- **Sync cadence:** Push immediate on approval. Pull every 5min (matches mail). Use Todoist Sync API `sync_token` for incremental.
- **Auth:** Todoist API token (user pastes; no OAuth needed for Todoist personal). Stored via Phase 5 per-provider keyring namespacing as `aria:tokens:todoist:default`.

### Dashboard surface + MEET-06 invariant
- **UI surface:**
  - **Tasks view** (new left-nav route `/tasks`): unified list of Aria-extracted + Todoist tasks. Filters by source (Aria / Todoist), project, due, owner, completion. Tasks from Aria carry source-note link.
  - **Briefing "Open Actions" section:** top-N self-actions due soon, with deep-link.
  - **Per-Note view:** transcript + summary + actions + push-status per action. Click action → highlight cited span.
- **Approval flow:**
  - Each Note review produces **one Approval Queue card** containing the full extracted-action batch.
  - User can batch-approve (push all to Todoist), batch-reject (drop all), or expand-and-edit per action (edit text, change owner, set due/priority, mark individual reject).
  - Push to Todoist happens only after card approval.
  - This card uses the Phase 3 generic queue surface; new card-type renders the action batch.
- **MEET-06 enforcement (belt + suspenders):**
  1. **Architectural boundary module:** `src/transcript/ingest.ts` is the SOLE path for transcript content into Aria. All Note rows must originate from a call into this module (enforced by a dedicated `TranscriptSource` type that only this module produces).
  2. **CI check / lint rule:** static-grep CI step forbids importing known meeting-bot SDKs (Recall.ai, Symbl, Voiceflow recording APIs, etc.) and forbids any outbound HTTP to known bot/recording endpoints.
  3. **Runtime assertion test:** integration test attempts to spy on outbound network during Phase-6 flows and asserts no calls to a blocklist of bot/recording hosts.
  4. **Documented threat model entry:** PROJECT.md / SECURITY.md entry codifying the invariant + the enforcement mechanisms; reviewer checklist for any PR touching transcript path.

### Cross-cutting
- **Long transcripts:** chunk before LLM extraction (e.g. ~3k token chunks with overlap); merge action lists across chunks; de-dup by similar text + close citation spans.
- **Storage:** transcripts persisted in SQLCipher; full text stored once; summary + actions in linked tables. Embeddings deferred to Phase 7 (RAG).
- **Provider abstraction reuse:** Todoist registered as a `Provider` with capability `{ task: TaskCapability }`. Sync-state row in `provider_sync_state` table with `resource: 'tasks'`.
- **Re-auth:** if Todoist API token rejected, hard-pause that provider (same UX as Phase 5): badge on settings + chip; click to re-paste token.

</decisions>

<deferred>
- **Live meeting capture / bot attendees / cloud recording** — explicitly forbidden by MEET-06; not v1.x either
- **Chrome extension bridge (deep-link, watched folder)** — separate companion project, future phase
- **Other task systems (Asana, Jira)** — ROADMAP defers to later phase (phase 8 / 9)
- **Three-way merge on Todoist conflicts** — last-write-wins in v1
- **Speaker-diarized embeddings for retrieval** — Phase 7
- **Action-item learning loop** (drop suggestions for low-confidence types if user repeatedly rejects them) — defer
- **Bulk-import historic transcripts** — defer; v1 is one-at-a-time
- **Audio file upload + local transcription** — out of scope for v1; user brings text/transcript files only
</deferred>

<open_questions_for_research>
- Best chunking strategy for transcripts for action-item extraction quality — fixed-token vs speaker-turn vs topic-segmented; researcher to compare on a small held-out set
- Todoist API choice: REST v2 (simpler, no incremental) vs Sync API v9 (`sync_token` incremental) — verify Sync API token model + rate limits
- VTT / SRT / Otter / Fireflies / tldv JSON parsers — pick libraries (e.g. node-webvtt, subsrt) or roll minimal
- .docx and .pdf parsing — mammoth/docx for .docx, pdf-parse for .pdf; quality on real meeting-minutes documents
- Fuzzy attendee match: heuristic (Levenshtein on display names) vs LLM-assisted; cost tradeoff
- Action-item de-duplication across chunks — embedding-based vs LLM-rerun pass
- LLM choice for extraction: local (Llama 3.1 8B / Qwen 2.5 7B) vs frontier — accuracy/cost on transcript-extraction Zod schema
- Deep-link scheme `aria://` — Electron `app.setAsDefaultProtocolClient` reliability on Windows/macOS/Linux; fallback for Todoist description text
- CI grep + import-deny rules — best tooling (eslint plugin? custom node script?) for enforcing the no-bot-SDK rule
- Phase 3 sensitivity classifier on transcript chunks — performance with 3k-token inputs; need to batch or stream
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User pastes a transcript; Aria links it to the right calendar event and produces a summary with cited action items
2. Approved action items appear in Todoist within one sync cycle
3. Every action item is clickable to the source transcript span
4. Aria does not join meetings as a bot or store cloud recordings (verifiable by code review and tests)
</success_criteria_recap>
