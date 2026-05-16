# Aria — Feature Spec for Implementation

> Handover document for Claude Code. Features are grouped by phase in priority order.
> Each feature includes a description, acceptance criteria, and relevant tech stack notes.
> Stack reference: see `CLAUDE.md` → Technology Stack.

---

## Phase 1 — Daily Briefing (Core Wedge)

### F-01 · Daily Briefing Engine

**What it does:** Every morning (configurable time), Aria generates a structured briefing from the user's connected data sources and displays it as the home screen.

**Sections in the briefing:**
- Today's calendar events (with prep notes if available)
- Unread email triage — flagged by urgency + sender importance
- Open action items (unresolved commitments from previous meetings/emails)
- "One thing that could blow up today" — highest-urgency item surfaced prominently
- "Needs your decision in 4 hours" block — time-sensitive items only

**Acceptance criteria:**
- Briefing generates on app open if none exists for today
- Scheduled generation via `node-cron` at user-configured time (default 7:00am)
- Suspended on sleep, resumed on wake via Electron `powerMonitor`
- Renders in <3s from cached data; full refresh in background
- Works offline using last-synced data

**Tech notes:**
- Use Vercel AI SDK `generateObject` + Zod schema for structured briefing output
- Route through Anthropic (claude-sonnet) for quality; fall back to local Ollama for offline
- Store briefing in SQLite with date index; keep last 30 days
- UI: full-width card layout, React + Tailwind + shadcn/ui

---

### F-02 · Email Triage + Urgency Scoring

**What it does:** Reads the user's inbox and classifies each email by urgency, sender importance, and required action type.

**Classifications:**
- `URGENT` — needs reply today, time-sensitive
- `ACTION` — requires a task or response but not urgent
- `FYI` — informational, no action needed
- `NOISE` — newsletters, notifications, automated mail

**Acceptance criteria:**
- Processes up to 200 unread emails per sync
- Urgency score (1–10) attached to each email in SQLite
- Sender importance learned over time (frequent senders rank higher)
- Briefing shows top 5 URGENT + top 3 ACTION items only
- User can correct a classification; correction is stored and used as training signal

**Tech notes:**
- Google: `googleapis` Gmail API with `history.list` for incremental sync
- Microsoft: `microsoft-graph-client` with `$filter=isRead eq false`
- Use local Ollama (Llama 3.1 8B) for classification — sensitive content stays on device
- `p-queue` to serialize LLM classification calls

---

### F-03 · Meeting Prep Briefs

**What it does:** 15 minutes before each calendar event, Aria automatically generates a prep brief and surfaces it as a notification.

**Brief contains:**
- Attendees + last email thread with each person
- Open action items from previous meetings with these attendees
- Relevant context pulled from email history (e.g. last discussed topics)
- Suggested agenda items based on open threads

**Acceptance criteria:**
- Fires 15 minutes before event (configurable: 5, 15, 30 min)
- Skips events with no other attendees (solo blocks)
- Skips events already in the past
- Notification opens prep brief panel in app
- Brief cached in SQLite; accessible after meeting starts

**Tech notes:**
- Calendar polling via `node-cron` every 5 minutes
- RAG query over email history using `sqlite-vec` + `nomic-embed-text` embeddings
- Electron native notification API

---

## Phase 2 — Voice & Email Drafting

### F-04 · Draft Emails in User's Voice

**What it does:** For any email flagged ACTION or URGENT, Aria drafts a reply that sounds like the user wrote it.

**Voice model:**
- Learns from sent mail history (tone, vocabulary, greeting/sign-off patterns)
- Adjusts per relationship (formal with new contacts, casual with frequent ones)
- Stores voice profile locally in SQLite — never leaves the device

**Acceptance criteria:**
- Draft generated in <5s for standard replies
- User sees diff view: original email + proposed reply
- One-click to edit, approve, or discard
- Approved drafts go to `PENDING_SEND` queue — never sent without explicit confirmation
- Voice profile improves with every approved/edited draft

**Tech notes:**
- `generateText` via Vercel AI SDK with Anthropic claude-sonnet
- System prompt includes last 50 sent emails as voice examples (chunked to fit context)
- Draft stored in SQLite with status: `draft | approved | sent | discarded`
- Approval gate: user must click "Send" — no autonomous sending in v1

---

### F-05 · Post-Meeting Action Capture

**What it does:** After a calendar event ends, Aria prompts the user to paste or dictate meeting notes (or auto-captures from a connected transcript source). It extracts commitments and creates tracked action items.

**Extracted entities:**
- Commitments made by user ("I'll send you X by Thursday")
- Commitments made by others ("They'll come back with pricing next week")
- Decisions reached
- Follow-up meetings needed

**Acceptance criteria:**
- Triggered automatically 5 minutes after event end time
- Accepts pasted text or typed notes in a quick-capture modal
- Action items created in SQLite with: owner, description, due date, source meeting
- Items surface in the daily briefing under "Open Action Items"
- Items marked complete by user when done

**Tech notes:**
- `generateObject` + Zod schema for action item extraction
- Due date parsing: relative ("by Thursday") → absolute ISO date via date-fns
- Future: connect to Granola/Fireflies transcript APIs for auto-capture

---

### F-06 · Commitment Tracker + Follow-Through Alerts

**What it does:** Tracks commitments extracted from meetings and emails. Alerts the user before deadlines arrive and flags overdue items.

**Alert logic:**
- Day-before warning for any commitment due tomorrow
- Morning-of flag in the daily briefing
- "You haven't sent X to Y — it was due 2 days ago" surfaced prominently

**Acceptance criteria:**
- Alert appears in daily briefing, not as a disruptive notification
- User can mark complete, snooze (+ new due date), or dismiss with reason
- Overdue items escalate in visual weight each day
- Weekly summary shows % of commitments hit on time

**Tech notes:**
- SQLite query on `action_items` table filtered by `due_date` and `status != complete`
- Cron job runs at briefing generation time
- No external dependencies

---

## Phase 3 — Relationship Intelligence

### F-07 · Relationship Health Tracker

**What it does:** Tracks communication cadence with important contacts and surfaces when relationships are going cold.

**Signals tracked:**
- Last email sent / received per contact
- Response rate (do they reply to you?)
- Meeting history
- Open items owed to/from them

**Surfaces in briefing:**
- "You haven't replied to Sarah in 9 days"
- "Marcus is waiting on something from you"
- "You haven't spoken to the Acme team in 3 weeks"

**Acceptance criteria:**
- Contact importance inferred from email frequency (configurable manually too)
- Silence threshold configurable per contact tier (VIP: 7 days, normal: 21 days)
- User can snooze a contact alert for N days
- No cloud sync of contact data — all local

**Tech notes:**
- Contact table in SQLite derived from email headers
- Importance score updated on each sync
- Relationship alerts injected into briefing generation prompt as context

---

## Phase 4 — "Ask Aria" (RAG over personal history)

### F-08 · Natural Language Query over Personal Data

**What it does:** User can ask Aria questions about their own history in natural language.

**Example queries:**
- "What did we agree with Acme last quarter?"
- "When did I last talk to James?"
- "What's still open from the board meeting in March?"
- "Find any emails about the Series B term sheet"

**Acceptance criteria:**
- Query box always accessible (keyboard shortcut: Cmd+K / Ctrl+K)
- Answers cite source (email date, meeting name, etc.)
- Results in <4s for indexed data
- Handles "I don't know" gracefully when no relevant data found
- All queries processed locally — no query text sent to cloud

**Tech notes:**
- Embedding model: `nomic-embed-text v1.5` via Ollama (274MB, 8192 ctx)
- Vector store: `sqlite-vec` in same SQLite DB
- Chunking strategy: email = one chunk per message; meeting notes = paragraph chunks
- Retrieval: top-5 chunks by cosine similarity → passed to local Ollama for synthesis
- Sensitive routing: use local model only for this feature

---

## Phase 5 — Smart Scheduling

### F-09 · Calendar Preference Learning + Conflict Awareness

**What it does:** Learns the user's scheduling preferences and proactively flags or resolves conflicts.

**Learned preferences:**
- No meetings before X time / after Y time
- Focus blocks (protected deep work time)
- Preferred meeting lengths per type (1:1 = 30min, team = 45min)
- Buffer time between meetings

**Actions Aria takes (with approval):**
- Drafts polite decline/reschedule for meetings that violate preferences
- Suggests alternative slots when someone requests a meeting
- Flags back-to-back meeting stacks in the briefing

**Acceptance criteria:**
- Preferences set in onboarding; editable in settings
- Conflict detection runs on every calendar sync
- Aria drafts a response — user approves before anything is sent
- No calendar changes made without explicit user confirmation

**Tech notes:**
- Preference DSL stored as JSON in SQLite user settings
- Timezone handling: all times stored as UTC, displayed in user local TZ via date-fns-tz
- Calendar write operations gated behind approval queue (same pattern as email drafts)

---

## Phase 6 — Subscription + Licensing

### F-10 · License Key Activation

**What it does:** App requires a valid license key to activate. Keys are validated locally after initial online check.

**Tiers:**
- `SOLO` — $45/month or $420/year (1 device)
- `SYNC` — $55/month or $510/year (up to 3 devices, includes encrypted sync)

**Acceptance criteria:**
- License key entered on first launch
- Online validation on first activation; subsequent launches validate locally (cached key hash)
- Grace period: 7 days offline before re-validation required
- Clear error state if license expired or revoked
- No telemetry beyond license validation ping

**Tech notes:**
- License key = HMAC-signed JWT with expiry + tier + device fingerprint
- Validation endpoint: lightweight Cloudflare Worker (no database needed, stateless)
- Key stored via Electron `safeStorage`
- Device fingerprint: hash of OS username + machine ID (non-reversible)

---

## Phase 7 — Cross-Device Sync

### F-11 · Encrypted Sync via User-Owned Storage (iCloud / Dropbox)

**What it does:** User connects their own iCloud Drive or Dropbox. Aria encrypts the sync payload locally before writing to it. Other devices decrypt on read.

**What syncs:**
- Briefing preferences and settings
- Action items and completion status
- Contact importance overrides
- Voice profile model (sent mail patterns)
- Does NOT sync: raw email/calendar data (re-fetched on each device from source)

**Acceptance criteria:**
- Setup wizard walks user through selecting sync folder
- Encryption key derived from user password + device salt (never stored in sync folder)
- Conflict resolution: last-write-wins for settings; union-merge for action items
- Sync runs on app open and every 30 minutes while active
- Works completely offline; syncs when folder becomes available

**Tech notes:**
- Sync payload: encrypted JSON blob written to `aria-sync.enc` in chosen folder
- Encryption: AES-256-GCM via Node `crypto` module
- Key stored in OS keychain via Electron `safeStorage`
- SQLite WAL snapshots for the action items table

---

### F-12 · Aria-Hosted Encrypted Sync (SYNC tier add-on)

**What it does:** For users who don't want to manage their own storage, Aria provides a hosted sync endpoint. Data is end-to-end encrypted — Aria's servers store opaque blobs only.

**Acceptance criteria:**
- Available to `SYNC` tier license holders only
- Same encryption model as F-11 (AES-256-GCM, key never leaves device)
- Sync server stores: `{ device_id, user_id_hash, encrypted_blob, updated_at }` — nothing else
- User can delete all sync data from settings
- Server infrastructure: Cloudflare R2 (object storage) + Cloudflare Worker for auth

**Tech notes:**
- Auth: short-lived signed token derived from license key (no separate login)
- R2 for blob storage (~$0.015/GB/month — negligible for this data size)
- Cloudflare Worker validates token, proxies R2 read/write
- No user PII on server — user_id is a one-way hash of license key

---

## Phase 8 — Weekly Recap Export

### F-13 · Weekly Recap Document

**What it does:** Every Friday evening, Aria generates a weekly recap and exports it as a Word doc and/or PDF.

**Sections:**
- Decisions made this week (from meeting action capture)
- Emails sent (count + key threads)
- Meetings attended (list + outcomes)
- Commitments hit vs. missed (with %score)
- Open items carried into next week
- One paragraph executive summary (AI-generated)

**Acceptance criteria:**
- Auto-generated every Friday at 5pm (configurable)
- User can trigger manually at any time
- Exported to user-chosen folder as `Aria-Recap-YYYY-MM-DD.docx`
- PDF version also generated
- Last 12 weeks of recaps accessible in app

**Tech notes:**
- `docx` (dolanmiu) for Word output
- `@react-pdf/renderer` for PDF output
- All data sourced from local SQLite — no LLM call needed for data assembly
- LLM call (Anthropic) only for the executive summary paragraph

---

## Approval Gate — applies to all phases

### F-14 · Approval Queue (Trust Budget System)

**What it does:** Any outbound action Aria wants to take — send email, create calendar invite, update a task — goes into an approval queue. The user reviews and approves/rejects in a morning batch or in real-time.

**Trust levels (user-configurable):**
- `ASK_ALWAYS` — every action requires explicit tap (default)
- `AUTO_SMALL` — auto-approve: email drafts under 3 lines, calendar declines, task creates
- `AUTO_MEDIUM` — auto-approve: anything not involving external send

**Acceptance criteria:**
- Pending approvals shown as badge on app icon and in briefing header
- Each item shows: what Aria wants to do, why, and a preview
- One-tap approve / reject / edit-then-approve
- Rejected items stored with reason for Aria to learn from
- Nothing is ever sent or changed without passing through this queue

**Tech notes:**
- `pending_actions` table in SQLite: `{ id, type, payload, status, created_at, reason }`
- Action types: `EMAIL_SEND`, `CALENDAR_DECLINE`, `CALENDAR_INVITE`, `TASK_CREATE`
- Electron `ipcMain`/`ipcRenderer` for renderer → main process action dispatch
- Actual send/write only happens in main process after approval confirmed

---

## Onboarding

### F-15 · First-Run Setup Wizard

**What it does:** Walks the user through connecting accounts, setting preferences, and activating their license on first launch.

**Steps:**
1. License key entry + validation
2. Connect Google (Gmail + Calendar) or Microsoft (Outlook + Calendar)
3. Set scheduling preferences (no-meeting hours, focus blocks)
4. Set briefing time
5. Optional: connect sync folder (iCloud / Dropbox) or Aria Sync
6. Generate first briefing

**Acceptance criteria:**
- Skippable steps (except license and at least one account)
- OAuth flow opens in dedicated `BrowserWindow`, redirect intercepted in main process
- Preferences stored in SQLite `user_settings` table
- Can re-run from Settings → Connections at any time

**Tech notes:**
- Google OAuth: loopback IP flow via `google-auth-library`
- Microsoft OAuth: auth-code + PKCE via `@azure/msal-node`
- Tokens stored via Electron `safeStorage`
- Wizard state machine: React component with step index in Zustand store

---

## Implementation Order (recommended)

| Priority | Feature | Why |
|----------|---------|-----|
| 1 | F-15 Onboarding wizard | Unblocks everything — need connected accounts |
| 2 | F-02 Email triage | Core data input for briefing |
| 3 | F-01 Daily briefing | The wedge — first thing users see value in |
| 4 | F-03 Meeting prep briefs | High perceived value, easy to build on top of F-01 |
| 5 | F-14 Approval queue | Required before any drafting feature ships |
| 6 | F-04 Email drafting in user's voice | First "action" feature — drives upgrade |
| 7 | F-05 Post-meeting action capture | Starts the commitment tracking loop |
| 8 | F-06 Commitment tracker | Closes the loop on F-05 |
| 9 | F-07 Relationship health tracker | Adds stickiness; daily briefing gets richer |
| 10 | F-10 License key activation | Required before any paid launch |
| 11 | F-08 Ask Aria (RAG) | Power feature — needs embedding index built up first |
| 12 | F-09 Smart scheduling | Calendar write — needs approval queue solid first |
| 13 | F-11 Encrypted sync (user storage) | Expand to multi-device users |
| 14 | F-13 Weekly recap export | Retention feature — gives users a shareable artifact |
| 15 | F-12 Aria-hosted sync | Revenue add-on — build after F-11 proven |

---

*Last updated: 2026-05-15*
*Stack: Electron 33 · React 18 · Vercel AI SDK 5 · better-sqlite3 · sqlite-vec · Ollama · Anthropic · electron-vite*
