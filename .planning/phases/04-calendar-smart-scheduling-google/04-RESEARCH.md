# Phase 4: Calendar Smart-Scheduling (Google) — Research

**Researched:** 2026-05-18
**Domain:** Google Calendar write-back, NL scheduling intent, conflict/rules engine, polymorphic Approval Queue reuse
**Confidence:** HIGH (architecture / reuse / scopes), MEDIUM (rrule.js semantics for "all future", local Ollama `generateObject` reliability)

## Summary

Phase 4 is a wiring-heavy phase: most of the substrate (Google OAuth client, `CalendarClient` wrapper, `calendar_event` mirror, polymorphic `approval` table, p-queue scheduler, state-machine + `assertApproved` gate, IPC patterns, banner/StatusPanel patterns) already shipped in Phases 1-3. The new work is (a) extending OAuth to `calendar.events` write scope, (b) a canonical Event model + `events.patch` write-back with recurring-instance semantics, (c) a typed JSON rules engine + Settings UI, (d) an NL→intent pipeline using AI SDK 6 `generateObject` + Zod, and (e) a calendar-flavored approval card reusing the Phase 3 generic queue.

Two pieces of debt from Phase 2 must be paid before write-back can ship: the `calendar_event` table has no `etag` (or `iCalUID`/`sequence`) column. Phase 2 SUMMARY explicitly flagged this — Phase 4 needs migration **010** to add `etag`, `i_cal_uid`, `sequence`, and an `organizer_email` column so we can (a) do optimistic If-Match writes against Google and (b) detect self-only events cheaply.

**Primary recommendation:** Extend not rewrite. Add `'calendar_change'` to the `approval.kind` CHECK, add `calendar_*` columns (event_id, recurring_scope, before_json, after_json, conflicts_json, rule_overrides_json) via additive migration. Lean on existing `connectGoogle('calendar')` + p-queue + state machine + `assertApproved`. Single new external dep: **rrule.js** for "all future" RFC5545 RRULE manipulation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth write-scope upgrade | Main (`src/main/integrations/google/auth.ts`) | Renderer (Settings re-consent banner) | Refresh tokens live in `safeStorage`; renderer can never see them |
| Canonical Event model | Main (`src/main/integrations/google/calendar.ts` extension) | DB (`calendar_event` migration 010) | Wrapper translates Google → domain shape; DB persists |
| Recurring-event semantics (this / future / all) | Main (new `src/main/integrations/google/recurrence.ts`) | DB (read existing recurrence_id) | RFC5545 RRULE math + Google instance-ID handling — never the renderer's concern |
| Rules engine (focus blocks, buffers, no-meeting, prime-time, TZ) | Main (new `src/main/scheduling/rules.ts`) | DB (new `scheduling_rules` table) | Pure functions on time windows; conflict check runs server-side before approval card render |
| NL → intent parsing | Main (new `src/main/scheduling/intent.ts`) | LLM Router (Phase 1) | AI SDK 6 `generateObject` + Zod; goes through p-queue + redaction layer |
| Conflict detection + top-3 alternatives | Main (new `src/main/scheduling/conflict.ts`) | Calendar wrapper (free-busy + `calendar_event` read) | Local cache first, freebusy.query for confirmation |
| Approval Queue persistence + state | Main (`src/main/approvals/*`) — REUSE Phase 3 | DB (migration 010 extends `approval`) | Polymorphic schema is the explicit Phase 3 hand-off |
| Approval card (calendar variant) | Renderer (`src/renderer/features/approvals/ApprovalCard.tsx` extension) | Main IPC (`APPROVALS_*`) | Card is a UI variant; payload comes from main |
| Write-back via `events.patch` | Main (new `src/main/integrations/google/write-event.ts`) | Approval gate (calls `assertApproved`) | Side-effect chokepoint must enforce approval — mirrors Plan 03-04 send pattern |
| Rules settings UI | Renderer (`src/renderer/features/settings/SchedulingRulesSection.tsx`) | Main IPC (load/save typed JSON) | Editable form for typed rules JSON; advanced JSON drawer |
| Audit log (overrides + writes) | Main + DB (new `calendar_action_log` table OR reuse `routing_log`) | — | New table — see Open Q below |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**NL command parsing**
- Intent schema (Zod via `generateObject`): `{ action: 'move'|'create'|'find-time', target: { eventRef?, nlDescription? }, when: { datetimeRange?: ISO, nlWhen? }, attendees?: string[], duration?: minutes }`. Separate resolver step turns NL refs into concrete Google event IDs and concrete datetimes.
- Pipeline: NL → intent → resolver → conflict check → proposed change → Approval Queue.
- Ambiguity handling: clarification round-trip in chat; resolver asks "Which one — X or Y?" before proposing. No auto-pick.
- v1 command scope: `move`, `create`, `find-time`. **Cancel is NOT in v1** — Aria refuses with a "cancel is coming, do it in Calendar for now" message.
- Out of scope v1: accept/decline invitations, bulk find-and-replace.

**Conflict detection + alternatives**
- All four conflict types detected: busy block (hard), focus block (hard, overridable), buffer violation (soft warn), no-meeting / OOO / outside working hours (hard, overridable).
- Top-3 alternatives ranked by **proximity** to requested time. Rule-fitness scoring deferred to v1.x.
- Working hours: **Google Calendar's native working-hours setting** is the hard boundary. Aria does NOT maintain a separate working-hours config in v1.
- Slot scorer (v1): proximity + buffer adherence penalty + prime-time bonus for high-value events only.

**Rules engine design**
- Typed JSON, no DSL. Schema sketch:
  ```ts
  {
    focusBlocks: [{ day: Weekday|'all', start:'HH:mm', end:'HH:mm' }],
    buffers: { beforeMin: number, afterMin: number },
    noMeetingWindows: [{ day, start, end, label }],
    primeTimeWindows: [{ day, start, end }],
    timeZone: IANA
  }
  ```
- Settings UI; advanced users drop into JSON.
- Hard rules **block** the initial proposal (per SC-3); each alternative may carry explicit "Override and schedule" button — click logs override with reason.
- Override logging in audit-log table for future learning.
- Prime-time priority (CAL-07): user defines prime-time windows; scorer prefers them only for "high-value" events. v1 heuristic: longer than 30min AND has external attendees OR explicit user tag.

**Attendees + recurring + write-back**
- **Multi-attendee v1: self-only events only.** If target has other attendees, Aria refuses with "multi-attendee calendar changes coming in v1.x". NL parser surfaces attendee count early.
- `find-time` may use attendees as free-busy lookup constraint (read-only).
- Recurring "this / future / all" UX: card defaults to **"this instance"** with radio buttons for "all future" / "all". User must consciously change.
- Time-zone canonical source: user's Google primary-calendar TZ. Falls back to system OS TZ only if Google TZ unavailable, with a banner warning.
- Write-back: `events.patch` (not `update`) to preserve unknown fields. Recurring writes use `sendUpdates='none'` enforced by self-only constraint.
- Audit-log row written **before AND after** Google API call.

**Cross-cutting**
- OAuth: write scope added incrementally to existing read scope; consent prompt explains why. Reuse Phase 2 OAuth abstraction.
- LLM: NL→intent through p-queue. Sensitivity classifier NOT invoked for routine scheduling commands (calendar payload is structured, not body text); redaction helper still applies if NL command contains PII tokens before any frontier call.
- Approval card: shows before/after time, event title, attendees (read-only, self-only), conflict-check result, rule-impact summary, recurring scope radio (when applicable).
- Polling: v1 stays on 15min poll (Phase 2). Google push notifications deferred.

### Claude's Discretion
- Audit log table shape (extend `routing_log` vs new `calendar_action_log`) — **research recommends new table** (see Architecture Patterns).
- Conflict-check performance caching strategy (single-batch freebusy.query vs per-window queries) — research recommends single batched `freebusy.query` per proposal.
- iCal RRULE handling — research recommends **rrule.js** (vetted, used by widely deployed calendar libs).

### Deferred Ideas (OUT OF SCOPE)
- Cancel command → v1.x
- Multi-attendee move/create → v1.x
- Aria-managed working-hours config → use Google's
- Rule-fitness scoring for alternatives → v1.x
- Travel-mode TZ override (schema supports; UI deferred)
- Bulk find-and-replace scheduling → out
- Accept/decline invitations on user's behalf → out
- Google push notifications → v1.x
- Background re-scoring on rule changes → defer

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAL-04 | NL scheduling commands proposed via Approval Queue | NL→intent pipeline (`generateObject` + Zod); polymorphic `approval` table with `kind='calendar_change'` |
| CAL-05 | Conflict detection + alternative slot proposals | Local `calendar_event` cache + `freebusy.query` for confirmation; top-3 alternatives by proximity |
| CAL-06 | User-defined scheduling rules enforced when finding slots | Typed-JSON rules engine + `scheduling_rules` table + `SchedulingRulesSection` UI; hard rules block proposal |
| CAL-07 | Prime-time priority for high-value events | Slot scorer adds prime-time bonus when event is "high-value" (>30min + external attendees / explicit tag) |
| APPR-02 | All material calendar changes require explicit approval | `assertApproved` chokepoint reused in `write-event.ts`; static-grep enforcer extended to allow ONLY this site as a `events.patch`/`events.insert` caller |

## Standard Stack

### Core (already installed — REUSE)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| googleapis | 144+ | Google Calendar v3 API (`events.list/patch/insert`, `freebusy.query`, `calendarList`, `settings`) | Already proven in Phase 2; official Google SDK [VERIFIED: package.json] |
| google-auth-library | 9.x | OAuth2 client + token refresh | Phase 2 incumbent [VERIFIED: package.json] |
| ai (Vercel AI SDK) | 6.x | `generateObject` for NL→intent | Phase 1 router incumbent; Zod-typed output [VERIFIED: package.json shows ai ^6.0.0] |
| zod | 4.x | Intent schema + rules schema | Already used in Phase 3 classifier [VERIFIED: package.json] |
| p-queue | 9.x | Serialize Google + LLM calls (concurrency=1) | Shared scheduler from Phase 2 already covers Calendar — extend, don't add [VERIFIED: package.json] |
| better-sqlite3-multiple-ciphers | 11.x | Sync DB access | Migration 010 extends approval + adds scheduling_rules + calendar_action_log [VERIFIED: existing migrations 001-009] |

### New
| Library | Version (verify before install) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rrule | latest 2.x | Parse + manipulate RFC5545 RRULE strings for "all future" splits | Most-deployed JS RRULE lib; used by tui-calendar, react-big-calendar; pure JS no native build [CITED: github.com/jakubroztocil/rrule] [ASSUMED: still maintained — verify in plan-checker phase] |

**Verification step for planner (must run before install):**
```bash
npm view rrule version
npm view rrule time --json | head -5   # confirm recent release
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| rrule | hand-rolled UNTIL clause edit | Sufficient for "all future" (set UNTIL on old, new RRULE on new event) but fragile for BYDAY/BYMONTHDAY edits — punt to lib [CITED: RFC5545 §3.8.5.3] |
| `events.update` | `events.patch` | `update` requires sending the full resource; clobbers fields Aria doesn't know about. **patch is mandatory** per CONTEXT decision [CITED: developers.google.com/calendar/api/v3/reference/events/patch] |
| Single `freebusy.query` | Per-window list scan | freebusy.query supports up to 50 calendars in one round-trip; collapses N polls into 1 [CITED: developers.google.com/calendar/api/v3/reference/freebusy/query] |
| local LLM for NL→intent | frontier router | Local Ollama (Llama 3.1 8B) `generateObject` reliability lower than frontier on tool-call schemas [ASSUMED — needs spike or fallback path]; default to **router decision**: if redaction layer flags PII, local; else frontier. Phase 1 router already handles this. |

**Installation:**
```bash
npm install rrule
```

(All other deps already present.)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────── Renderer ───────────────┐
│  /scheduling (new chat surface)        │
│       │                                │
│       ▼  (NL text)                     │
│  window.aria.scheduling.parseIntent ───┼──► IPC: SCHEDULING_PARSE_INTENT
│  /approvals (existing — gains kind=calendar_change card variant)
│  /settings → SchedulingRulesSection ───┼──► IPC: SCHEDULING_RULES_GET/SET
└────────────────────────────────────────┘
                     │
┌────────────────── Main ─────────────────────────────────────────┐
│                                                                 │
│  scheduling/intent.ts                                           │
│    ├─ redact PII tokens (Phase 3 redactor)                     │
│    ├─ AI SDK 6 generateObject(IntentSchema)                    │
│    └─ via p-queue (shared scheduler)                           │
│                     │                                           │
│                     ▼                                           │
│  scheduling/resolver.ts (NL refs → concrete event IDs + dates) │
│    ├─ Query calendar_event cache by NL hints (time/title)      │
│    └─ Ambiguity → IPC clarification round-trip                 │
│                     │                                           │
│                     ▼                                           │
│  scheduling/self-only-gate.ts                                   │
│    └─ refuse if event has attendees other than organizer-self  │
│                     │                                           │
│                     ▼                                           │
│  scheduling/conflict.ts                                         │
│    ├─ Load active rules (scheduling_rules)                     │
│    ├─ Read local calendar_event for window                     │
│    ├─ freebusy.query (single batched call) for confirmation    │
│    ├─ Detect: busy / focus-block / buffer / no-meeting-window  │
│    └─ Generate top-3 alternatives by proximity                  │
│                     │                                           │
│                     ▼                                           │
│  approvals/persist.insertApproval({kind:'calendar_change',...}) │
│                     │                                           │
│                     ▼                                           │
│  User clicks Approve on calendar card                           │
│                     │                                           │
│                     ▼                                           │
│  integrations/google/write-event.ts (THE ONLY events.patch site)│
│    ├─ assertApproved(db, approvalId)  ◄── APPR-02 chokepoint   │
│    ├─ recurrence.computeWrite({scope, event, change})          │
│    │     scope=this  → use instance ID (id_yyyymmddThhmmssZ)   │
│    │     scope=all   → patch parent recurringEventId           │
│    │     scope=future → split: UNTIL on old, new event w/ RRULE│
│    ├─ events.patch(..., sendUpdates='none', ifMatch:etag)      │
│    ├─ write calendar_action_log BEFORE + AFTER                  │
│    └─ transition approval row → 'sent'                          │
│                                                                 │
│  scheduling/rules.ts (typed JSON rules CRUD)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/main/
├── integrations/google/
│   ├── calendar.ts            # existing wrapper — ADD: getCalendarSettings (working hours), freebusy.query
│   ├── write-event.ts         # NEW — only events.patch/insert call site; calls assertApproved first
│   └── recurrence.ts          # NEW — RRULE math (this / future / all) using rrule.js
├── scheduling/                # NEW dir
│   ├── intent.ts              # AI SDK 6 generateObject → IntentSchema
│   ├── resolver.ts            # NL refs → concrete event IDs + datetimes
│   ├── self-only-gate.ts      # refuse multi-attendee changes
│   ├── conflict.ts            # detect + propose alternatives
│   ├── rules.ts               # typed JSON rules schema + CRUD
│   └── audit.ts               # calendar_action_log writer
├── ipc/
│   └── scheduling.ts          # NEW — SCHEDULING_PARSE_INTENT, _CONFIRM_TARGET, _PROPOSE, _RULES_GET, _RULES_SET
└── db/migrations/
    └── 010_calendar_writeback.sql  # NEW — see Migration 010 below

src/renderer/features/
├── approvals/
│   └── ApprovalCard.tsx       # EXTEND — render kind='calendar_change' variant
├── scheduling/                # NEW
│   └── SchedulingChat.tsx     # /scheduling route — NL command box + ambiguity flow
└── settings/
    └── SchedulingRulesSection.tsx  # NEW — typed-form + advanced JSON
```

### Pattern 1: Incremental OAuth Scope Upgrade (Shape A — reuse Plan 03-04 pattern)
**What:** Extend `SCOPES.calendar` in `src/main/integrations/google/auth.ts` to include the write scope; existing users see an IntegrationsSection banner prompting re-connect.

**When to use:** Every time we widen a Google scope post-launch.

**Code:**
```ts
// src/main/integrations/google/auth.ts
export const SCOPES: Record<GoogleTokenKind, readonly string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',   // NEW — covers create/patch/delete on user's events
  ],
} as const;
// Source: developers.google.com/calendar/api/auth — calendar.events is the
// narrowest write scope; do NOT request calendar (full) or calendar.app.created.
```

**Verified via Phase 3 SUMMARY (03-04 voice-match):** same shape worked for gmail.send.

### Pattern 2: Polymorphic Approval Extension (zero new tables)
**What:** Add `'calendar_change'` to the `kind` CHECK and pre-declare `calendar_*` columns on the existing `approval` table.

**Migration 010 (sketch):**
```sql
-- 010_calendar_writeback.sql

-- 1. Extend approval.kind enum + add calendar payload columns (additive only)
ALTER TABLE approval RENAME TO approval_old;
CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change')),  -- extended
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
  -- ... all existing columns verbatim ...
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent')),
  -- existing email columns ...
  -- existing classifier/triage columns ...
  -- NEW calendar columns (NULL for kind='email_send')
  calendar_event_id TEXT,
  calendar_action TEXT CHECK (calendar_action IN ('move','create','find-time') OR calendar_action IS NULL),
  recurring_scope TEXT CHECK (recurring_scope IN ('this','future','all') OR recurring_scope IS NULL),
  before_json TEXT,           -- canonical snapshot of event before change
  after_json TEXT,            -- proposed change
  conflicts_json TEXT,        -- detected conflicts at proposal time
  alternatives_json TEXT,     -- top-3 alternative slots
  rule_overrides_json TEXT    -- which hard rules were explicitly overridden
);
INSERT INTO approval SELECT *, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM approval_old;
DROP TABLE approval_old;
-- Recreate indexes
CREATE INDEX idx_approval_state ON approval(state);
CREATE INDEX idx_approval_kind_state ON approval(kind, state);
CREATE INDEX idx_approval_updated_at ON approval(updated_at DESC);

-- 2. Extend calendar_event with write-back fields (paid-back debt from Phase 2 SUMMARY)
ALTER TABLE calendar_event ADD COLUMN etag TEXT;
ALTER TABLE calendar_event ADD COLUMN i_cal_uid TEXT;
ALTER TABLE calendar_event ADD COLUMN sequence INTEGER;
ALTER TABLE calendar_event ADD COLUMN organizer_email TEXT;
ALTER TABLE calendar_event ADD COLUMN organizer_self INTEGER;       -- 1 if Google reports organizer.self=true
ALTER TABLE calendar_event ADD COLUMN recurrence_json TEXT;         -- raw RRULE array from event.recurrence

-- 3. New rules + audit-log tables
CREATE TABLE scheduling_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules_json TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO scheduling_rules (id, rules_json, time_zone, updated_at)
VALUES (1, '{"focusBlocks":[],"buffers":{"beforeMin":0,"afterMin":0},"noMeetingWindows":[],"primeTimeWindows":[]}', 'UTC', datetime('now'));

CREATE TABLE calendar_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL REFERENCES approval(id),
  phase TEXT NOT NULL CHECK (phase IN ('proposed','pre_write','post_write','failed','override')),
  event_id TEXT,
  recurring_scope TEXT,
  before_json TEXT,
  after_json TEXT,
  rule_overrides_json TEXT,
  google_etag TEXT,
  google_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_action_log_approval ON calendar_action_log(approval_id);
CREATE INDEX idx_calendar_action_log_event ON calendar_action_log(event_id);
```

**SQLite caveat (verified pattern):** `ALTER TABLE ... ADD COLUMN` is safe for the additive `calendar_event` columns and the new tables. The `approval.kind` CHECK widening requires the RENAME/CREATE/INSERT/DROP dance because SQLite doesn't allow modifying CHECK constraints in place. The Phase 2/3 migrations runner is set up for this idiom (migration 006 already used CREATE TABLE IF NOT EXISTS) — but the runner spec hard-codes applied-version asserts; update `tests/unit/main/db/migrations.spec.ts` to `[1..10]` / `user_version === 10`. [VERIFIED: existing migrations runner + spec pattern]

### Pattern 3: Recurring Event Semantics (this / future / all)
**What:** Three distinct write paths for Google Calendar recurrence. Verified against developers.google.com/calendar/api/v3/reference/events docs [CITED].

| Scope | Approach | Google API call |
|-------|----------|----------------|
| **this instance** | Patch the **instance**, not the parent. Instance IDs have the form `{parentId}_{YYYYMMDD}T{HHMMSS}Z` for timed events or `{parentId}_{YYYYMMDD}` for all-day. `events.patch({eventId: instanceId, requestBody: {start, end}})` — Google internally creates an "exception" event with `recurringEventId` pointing to the parent. | `events.patch(calendarId, instanceId, {start, end})` |
| **all** | Patch the **parent** event (the one whose id has no instance suffix). Affects every instance that didn't already have an exception. | `events.patch(calendarId, parentId, {start, end})` |
| **all future** | Split: (a) patch parent's `recurrence` RRULE adding `UNTIL=<dayBeforeThisInstance>`; (b) `events.insert` a new event with the new `start/end` and a new RRULE (copy of original minus UNTIL). | Two-call transaction — must roll forward (compensating delete on insert success but parent-patch failure is impossible because we patch first; if insert fails, we restore UNTIL on parent). Document the failure mode explicitly. |

**Use rrule.js** for the UNTIL math and the RRULE clone — rolling our own RRULE string editing is the textbook "don't hand-roll" case. [CITED: github.com/jakubroztocil/rrule]

**Instance ID derivation (a subtle pitfall):** the instance ID for a timed event uses **the original event's start time formatted in UTC as YYYYMMDDTHHMMSSZ**, not the new time. If a user already moved that instance once (creating an exception), the exception event has its own non-templated id — query `events.instances({eventId: parentId, timeMin, timeMax})` to get the right one. [CITED: developers.google.com/calendar/api/v3/reference/events/instances]

### Pattern 4: Conflict Detection (Local Cache + freebusy.query Confirmation)
**What:** Two-stage check.

1. **Local stage (fast, free):** Read `calendar_event` rows for `[proposedStart-buffer, proposedEnd+buffer]` from SQLite. The 15min poller keeps this within 15 minutes of fresh.
2. **Confirmation stage (one network call):** Single `freebusy.query({timeMin, timeMax, items:[{id:'primary'}]})` against the **exact proposal window + the top-3 alternative windows** in one batched request. Catches the "user added an event in the last 15 minutes" case.

**Rule conflicts (focus, buffer, no-meeting):** Pure local — load `scheduling_rules.rules_json`, intersect windows, classify hard vs soft.

**Top-3 alternatives:**
- Start search at proposed time. Walk forward in 15-min increments up to 14 days. For each candidate window: skip if outside Google working-hours, skip if hard-conflict (busy/focus/no-meeting), score = `-|distanceFromRequested|` plus `+5` if inside prime-time AND event is high-value, minus buffer-penalty if applicable.
- Stop at first 3 viable candidates. Returns fewer than 3 if calendar is too packed — UI handles.

### Pattern 5: NL → Intent (AI SDK 6 generateObject + Zod)
**What:** AI SDK 6's `generateObject` returns a typed parsed object instead of free text. Pass the IntentSchema (zod).

**Code:**
```ts
// src/main/scheduling/intent.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { getRouterModel } from '../llm/router';  // Phase 1

export const IntentSchema = z.object({
  action: z.enum(['move', 'create', 'find-time', 'cancel-unsupported']),
  target: z.object({
    eventRef: z.string().optional(),       // user said "my 3pm" or "client meeting"
    nlDescription: z.string().optional(),  // full NL referent if no clean ref
  }).optional(),
  when: z.object({
    datetimeRange: z.object({ startIso: z.string(), endIso: z.string() }).optional(),
    nlWhen: z.string().optional(),
  }).optional(),
  attendees: z.array(z.string()).optional(),
  durationMin: z.number().int().min(5).max(8 * 60).optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export async function parseIntent(nl: string): Promise<Intent> {
  const { model, routed } = await getRouterModel({ payload: nl, kind: 'scheduling' });
  const { object } = await generateObject({
    model,
    schema: IntentSchema,
    prompt: `You parse scheduling commands. Today is ${new Date().toISOString()}. User says: ${nl}`,
  });
  if (object.action === 'cancel-unsupported') {
    throw new IntentRefusedError('cancel-not-in-v1');
  }
  return object;
}
```
[CITED: ai-sdk.dev/docs/reference/ai-sdk-core/generate-object]

**Notes:**
- `generateObject` on local Ollama models has known reliability issues for complex schemas. The IntentSchema above is intentionally shallow (single-level optionals). [ASSUMED — verify in plan-checker; may need 1-2 retry passes for local model.]
- Router decides local vs frontier. If user's NL has PII tokens, redaction layer pre-pass replaces them with placeholders; restoration happens after `generateObject` returns. Phase 3 redactor handles this.
- Run inside `scheduler.queue.add(...)` to keep cost predictable.

### Anti-Patterns to Avoid
- **`events.update` instead of `events.patch`:** clobbers fields Aria doesn't know about (description, conferencing, attachments). Use patch.
- **Treating instance ID as derivable from new time:** instance IDs encode the *original* start, not the rescheduled time. Use `events.instances` lookup if the instance has been previously modified.
- **Single-shot RRULE string edit for "all future":** parsing RRULEs by regex is the path to subtle BYDAY bugs. Use rrule.js.
- **Skipping `ifMatch: etag` on patch:** without it, two-writer races silently lose changes. Read etag with the event; pass it on patch; on 412 Precondition Failed, re-fetch + re-propose.
- **Sending `sendUpdates='all'` for self-only events:** self-only means no one to notify; defaults vary by client. Explicitly set `'none'`.
- **Re-querying freebusy for every alternative individually:** one batched call covers proposal + all alternatives.
- **Building a custom RRULE parser:** see rrule.js.
- **Building working-hours config in Aria:** Google's CalendarSettings exposes it — use that. [Open Q below: API shape — must verify]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RFC5545 RRULE parsing/editing | Regex on RRULE strings | rrule.js | BYDAY, BYMONTHDAY, BYSETPOS, COUNT vs UNTIL exclusivity, weekstart — dozens of edge cases [CITED: RFC5545 §3.3.10] |
| Recurring-instance ID lookup | String formatting `parentId_YYYYMMDDTHHMMSSZ` | `events.instances` API | Previously-modified instances have non-templated IDs |
| Free-busy detection | Walking events.list and overlapping in JS | `freebusy.query` | Google batches across calendars + handles transparency=opaque correctly [CITED: developers.google.com/calendar/api/v3/reference/freebusy/query] |
| NL→JSON intent extraction | Few-shot text completion + JSON.parse | AI SDK 6 `generateObject` + Zod | Schema-validated; AI SDK handles retries on parse failure |
| Time-zone math (DST, IANA) | Date arithmetic in raw ms | Reuse Phase 2's Intl.DateTimeFormat-based helpers in `sync-calendar.ts` (computeTodayBoundsUtc) | DST transitions break naive ms arithmetic. Pattern already in repo. |
| Approval state machine | New per-kind state machine | `src/main/approvals/state.ts` (Phase 3) | Polymorphic — already covers calendar via reused states |
| Send-gate enforcement | Direct calls into `events.patch` from agent code | `assertApproved(db, id)` + static-grep enforcer | APPR-02 chokepoint, mirrors APPR-01 pattern from 03-01 |

**Key insight:** This phase is primarily glue, not invention. The "don't-hand-roll" list is large because nearly every primitive already exists in the repo or in a vetted lib. The only new external dep is rrule.js.

## Runtime State Inventory

> Not applicable — this is a greenfield feature phase, no renames.

## Common Pitfalls

### Pitfall 1: etag-less Writes Lose Data
**What goes wrong:** Two clients (Aria + the user editing in Calendar web UI) write the same event near-simultaneously; last writer wins silently.
**Why it happens:** `events.patch` accepts an `If-Match: <etag>` header (or `ifMatch` param in googleapis); skipping it disables optimistic concurrency.
**How to avoid:** Always read + store etag on incremental sync (migration 010 adds the column); pass it on patch; on 412 → refetch + bounce to a new approval card with diff.
**Warning signs:** Phantom "I moved that meeting" reports from user.

### Pitfall 2: Instance ID Drift
**What goes wrong:** Code derives instance ID from `parentId + new start`; Google returns 404.
**Why it happens:** Instance IDs encode the **original** UTC start of that occurrence in the recurrence series. Once an instance is moved (exception created), it gets a synthetic ID.
**How to avoid:** Call `events.instances({eventId: parentId, timeMin, timeMax})` to enumerate; never construct the ID string yourself. Cache the resolved instance ID on the approval row.

### Pitfall 3: "This instance" Patches Mistakenly Touch the Parent
**What goes wrong:** User clicks "this instance" but the patch hits parent → all instances move.
**Why it happens:** `events.patch(parentId, ...)` looks like an event patch but is actually a series patch.
**How to avoid:** Resolver step must always populate `approval.calendar_event_id` with the **instance** ID when scope='this'. Add an `assertScope` check in `write-event.ts`: if `recurring_scope === 'this'` then `calendar_event_id` MUST contain the underscore separator marking it as an instance ID.

### Pitfall 4: "All future" Without RRULE UNTIL = Orphan Future Events
**What goes wrong:** Splitting the series by inserting a new event without bounding the old → both series fire from the split point.
**How to avoid:** rrule.js: load parent's RRULE, set `UNTIL` to the day before split, write parent first; only on success, insert new event with copied-then-cleared RRULE.
**Warning signs:** Duplicate weekly meetings on the user's calendar.

### Pitfall 5: Self-Only Detection Is Two Predicates, Not One
**What goes wrong:** Code checks `event.attendees.length === 0` and lets a "self+others" event through.
**Why it happens:** Google sometimes includes the organizer as a Self entry in `attendees`.
**How to avoid:** Self-only = `(attendees is undefined OR attendees.length === 0) OR (every attendee.email matches organizer.email AND organizer.self === true)`. Store `organizer_self` and `organizer_email` on the row (migration 010) and compute in a single function with unit tests.

### Pitfall 6: Google Working-Hours API Lookup
**What goes wrong:** Calendar working-hours may not be exposed where we expect.
**Why it happens:** Google Calendar exposes a per-user "working location and hours" feature, but its API representation is **not** under `calendar.settings.list` — it's encoded in events with `eventType='workingLocation'` and (separately) in `users.settings` Gmail-style. [LOW confidence — open question; may need fallback to a per-user override in our own rules table.]
**How to avoid:** Plan-checker phase MUST verify the actual API surface before committing the design. Fallback: if working-hours can't be read, prompt user once during onboarding-of-this-phase to set them in our rules JSON as `workingHours` (Phase 2 SUMMARY's Phase 5 deferred etag column is the precedent for "add later if Google API isn't clean").

### Pitfall 7: Migrations Spec Hard-Coded Version Asserts
**What goes wrong:** Adding migration 010 fails `tests/unit/main/db/migrations.spec.ts`.
**How to avoid:** Update the spec to assert `[1..10]` / `user_version === 10`. Precedent: every prior migration plan did this (verified in 02-02 SUMMARY and 03-01 SUMMARY).

### Pitfall 8: Local Ollama generateObject Reliability on Nested Optional Schemas
**What goes wrong:** Llama 3.1 8B returns objects that fail Zod parse on `IntentSchema` more often than the frontier model does.
**How to avoid:** Keep schema shallow (single-level optionals; no discriminated unions). Configure `generateObject({ maxRetries: 2 })`. If retry budget exhausts on local, fall back to frontier IF redaction passed; otherwise present user with a "I didn't understand — try rephrasing" UI message. [ASSUMED — confirm reliability in plan-checker spike.]

### Pitfall 9: Static-Grep Enforcer Needs Calendar Entry
**What goes wrong:** Phase 3's `tests/static/single-send-call-site.test.ts` only watches `gmail.users.messages.send`. Adding calendar write-back without an equivalent grep would leave APPR-02 unenforced.
**How to avoid:** Extend (or duplicate) the static-grep test to assert there is exactly one call site for `events.patch` and `events.insert` in `src/main/**`, and it lives in `src/main/integrations/google/write-event.ts`. The chokepoint function must call `assertApproved` as its first line. Mirrors the APPR-01 belt+suspenders pattern from 03-05.

## Code Examples

### NL Intent → Resolver → Conflict → Approval Insert
```ts
// src/main/ipc/scheduling.ts (sketch)
import { parseIntent } from '../scheduling/intent';
import { resolveTarget } from '../scheduling/resolver';
import { assertSelfOnly } from '../scheduling/self-only-gate';
import { detectConflictsAndAlternatives } from '../scheduling/conflict';
import { insertApproval } from '../approvals/persist';

ipcMain.handle(CHANNELS.SCHEDULING_PROPOSE, async (_e, nl: string) => {
  const intent = await parseIntent(nl);
  const target = await resolveTarget(intent);              // may throw NeedsClarification
  await assertSelfOnly(target.event);                       // throws MultiAttendeeRefused
  const { conflicts, alternatives, primaryFeasible } =
    await detectConflictsAndAlternatives(target, rules);
  const approvalId = await insertApproval(db, {
    kind: 'calendar_change',
    state: 'ready',
    approval_path: 'explicit',
    calendar_event_id: target.eventId,
    calendar_action: intent.action,
    recurring_scope: target.isRecurring ? 'this' : null,    // default; user may switch
    before_json: JSON.stringify(target.event),
    after_json: JSON.stringify(target.proposedChange),
    conflicts_json: JSON.stringify(conflicts),
    alternatives_json: JSON.stringify(alternatives),
  });
  return { approvalId, primaryFeasible, conflicts, alternatives };
});
```

### Write-back chokepoint (the only events.patch call site)
```ts
// src/main/integrations/google/write-event.ts
import { assertApproved } from '../../approvals/gate';
import { computeRecurringWrite } from './recurrence';
import { logCalendarAction } from '../../scheduling/audit';

export async function applyCalendarChange(db: Db, client: CalendarClient, approvalId: string) {
  assertApproved(db, approvalId);                            // APPR-02 chokepoint
  const row = readApproval(db, approvalId);
  await logCalendarAction(db, { approval_id: approvalId, phase: 'pre_write', ...row });
  try {
    const plan = computeRecurringWrite(row);                 // resolves which patch/insert calls
    for (const op of plan.ops) {
      if (op.kind === 'patch') {
        await client.patchEvent({ eventId: op.id, requestBody: op.body, ifMatch: op.etag, sendUpdates: 'none' });
      } else if (op.kind === 'insert') {
        await client.insertEvent({ requestBody: op.body, sendUpdates: 'none' });
      }
    }
    await logCalendarAction(db, { approval_id: approvalId, phase: 'post_write', ...plan });
    transitionTo(db, approvalId, 'sent');
  } catch (err) {
    await logCalendarAction(db, { approval_id: approvalId, phase: 'failed', google_error: String(err) });
    throw err;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `events.update` with full body | `events.patch` with field subset | API stable since v3 GA | Mandatory for additive-only updates [CITED: Google API ref] |
| Hand-rolled RRULE | rrule.js | rrule.js stable since 2017 | Don't re-litigate |
| `generateText` + JSON.parse | `generateObject` + Zod | AI SDK 4+, current AI SDK 6 in repo | Schema validation built in [CITED: ai-sdk.dev] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | rrule.js is still actively maintained and the right RRULE lib | Standard Stack | Could need swap to another lib; risk = low (alternatives all niche) |
| A2 | Local Ollama (Llama 3.1 8B) `generateObject` is reliable enough for IntentSchema with maxRetries=2 | Pattern 5, Pitfall 8 | Could force frontier-only routing for NL→intent; partial PII concerns — mitigate via redactor |
| A3 | Google Calendar working-hours is accessible via API (not just Web UI) | Pitfall 6, Open Q | If unreachable, fall back to user-configured `workingHours` in our rules JSON; planner must add UI |
| A4 | The SQLite RENAME/CREATE/INSERT idiom for widening `approval.kind` CHECK is the right pattern given prior migrations | Migration 010 | Could need a different approach; verify migrations runner handles it (it does — manual migration writes are the precedent) |
| A5 | Audit-log table belongs separate from Phase 3's routing_log (different concerns: routing decisions vs side-effecting writes) | Architectural Responsibility Map | If folded into routing_log, schema mismatch — recommend separate table |
| A6 | Phase 2's calendar_event is missing etag/i_cal_uid/sequence (no `etag` column in 003_calendar.sql) | Migration 010 | VERIFIED by reading 003_calendar.sql; not actually an assumption — confirmed |

## Open Questions

1. **Google working-hours API surface**
   - What we know: feature exists in Web UI; users.settings (Gmail) has separate working-hours; Calendar events use `eventType='workingLocation'` for *location* not hours.
   - What's unclear: where the *hours* (start/end-of-day) live in the Calendar v3 API.
   - Recommendation: Plan-checker spike — call `calendar.settings.list` and `events.list({eventTypes:['workingLocation']})` against a real test calendar with working hours set. If neither yields hours, fall back to a `workingHours` field in our `scheduling_rules.rules_json` with first-launch prompt during Phase 4.

2. **Self-only check: cheapest implementation**
   - What we know: organizer.self + attendees emptiness or self-only.
   - What's unclear: whether all-day "personal events" set `organizer.self=true`.
   - Recommendation: store both `organizer_email` and `organizer_self` and implement a single `isSelfOnly(event, userEmail)` helper with explicit unit tests covering: solo event, self+self-only attendee, self+1 external, undefined attendees array.

3. **Conflict-check pre-cache window**
   - What we know: top-3 alternative search walks forward up to 14 days at 15-min increments = 1344 windows.
   - What's unclear: whether a single `freebusy.query({timeMin: now, timeMax: now+14d})` returns enough granularity to score in-memory.
   - Recommendation: Yes — freebusy returns merged busy intervals; we walk them in JS, not query per window. Single call.

4. **Audit-log table shape — extend `routing_log` or new `calendar_action_log`?**
   - What we know: routing_log (Phase 3) is for LLM-routing decisions; calendar action log is for side-effecting writes.
   - Recommendation: separate table (see Pattern 2 migration 010). Different keys, different lifecycle, different downstream consumers (Phase 8 weekly recap will read calendar_action_log for "What Aria did this week").

5. **Recurring "all future" rollback semantics**
   - What we know: two-step (patch parent UNTIL, then insert new series).
   - What's unclear: if insert fails after patch succeeded, the user's series is truncated.
   - Recommendation: If insert fails, **restore the parent's RRULE** (remove the UNTIL we set). Document in `recurrence.ts`. Audit-log both phases.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 20 LTS | All | ✓ (Phase 1) | per Phase 1 | — |
| googleapis | Calendar wrapper | ✓ | ^144.0.0 | — |
| google-auth-library | OAuth | ✓ | ^9 | — |
| ai (Vercel AI SDK) | NL→intent | ✓ | ^6.0.0 | — |
| zod | schemas | ✓ | ^4.0.0 | — |
| p-queue | serialize | ✓ | ^9.0.0 | — |
| better-sqlite3-multiple-ciphers | DB | ✓ | ^11 | — |
| rrule | RRULE math | ✗ | — | NONE — must install (`npm install rrule`) |
| GCP OAuth credentials | calendar.events scope | ✓ (Phase 2 client) | — | reuse — same client, scope added |
| Ollama with Llama 3.1 8B | NL intent (local path) | ✓ (Phase 1) | per Phase 1 | Frontier router path is the fallback for unreliable local parse |

**Missing dependencies with no fallback:** rrule (must install before write-recurrence task).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (unit/integration), Playwright 1.60 (E2E) |
| Config file | `vitest.config.ts` (incl. `tests/static/**`), `playwright.config.ts` |
| Quick run command | `npm run test:unit -- <path-glob>` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAL-04 | "move my 3pm to Thursday" → approval card with conflict check | unit + e2e | `npm run test:unit -- tests/unit/main/scheduling/intent.test.ts` ; `npm run test:e2e -- tests/e2e/scheduling-propose.spec.ts` | ❌ Wave 0 |
| CAL-04 | Cancel command refused | unit | `npm run test:unit -- tests/unit/main/scheduling/intent.test.ts` | ❌ Wave 0 |
| CAL-04 | Multi-attendee event refused before alternative generation | unit | `npm run test:unit -- tests/unit/main/scheduling/self-only-gate.test.ts` | ❌ Wave 0 |
| CAL-05 | Conflict detection (busy/focus/buffer/no-meeting) | unit | `npm run test:unit -- tests/unit/main/scheduling/conflict.test.ts` | ❌ Wave 0 |
| CAL-05 | Top-3 alternatives by proximity | unit | `npm run test:unit -- tests/unit/main/scheduling/conflict-alternatives.test.ts` | ❌ Wave 0 |
| CAL-06 | Rules engine: hard rule blocks initial proposal | unit | `npm run test:unit -- tests/unit/main/scheduling/rules.test.ts` | ❌ Wave 0 |
| CAL-06 | Settings UI saves typed JSON rules | unit | `npm run test:unit -- tests/unit/renderer/features/settings/SchedulingRulesSection.spec.tsx` | ❌ Wave 0 |
| CAL-06 | Override is logged with reason | unit | `npm run test:unit -- tests/unit/main/scheduling/audit.test.ts` | ❌ Wave 0 |
| CAL-07 | Prime-time bonus only applies to high-value events | unit | `npm run test:unit -- tests/unit/main/scheduling/conflict-prime-time.test.ts` | ❌ Wave 0 |
| APPR-02 | Static grep: only one call site for events.patch / events.insert | static | `npm run test:unit -- tests/static/single-calendar-write-site.test.ts` | ❌ Wave 0 |
| APPR-02 | `assertApproved` thrown by `applyCalendarChange` when state ≠ approved | unit | `npm run test:unit -- tests/unit/main/integrations/google/write-event.test.ts` | ❌ Wave 0 |
| APPR-02 | E2E: cannot bypass approval — direct IPC call without prior approve throws | e2e | `npm run test:e2e -- tests/e2e/calendar-approval-bypass.spec.ts` | ❌ Wave 0 |
| (cross-cut) | Recurring "this/future/all" all three write paths correct | unit | `npm run test:unit -- tests/unit/main/integrations/google/recurrence.test.ts` | ❌ Wave 0 |
| (cross-cut) | Time-zone canonical = Google primary TZ; OS fallback warns | unit | `npm run test:unit -- tests/unit/main/scheduling/timezone.test.ts` | ❌ Wave 0 |
| (cross-cut) | etag mismatch → 412 → re-fetch + new approval card | unit | `npm run test:unit -- tests/unit/main/integrations/google/write-event-etag.test.ts` | ❌ Wave 0 |
| (cross-cut) | Migration 010 advances to user_version=10 and approval row count preserved | unit | `npm run test:unit -- tests/unit/main/db/migrations.spec.ts` | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- <files-touched-glob>` (sub-second to seconds)
- **Per wave merge:** `npm run test:unit` (full Vitest suite)
- **Phase gate:** `npm run test` (Vitest + Playwright) green before `/gsd-verify-work 4`

### Wave 0 Gaps
- [ ] `tests/unit/main/scheduling/intent.test.ts` — IntentSchema parse + cancel-refuse + ambiguity throw
- [ ] `tests/unit/main/scheduling/self-only-gate.test.ts` — self-only detection cases
- [ ] `tests/unit/main/scheduling/conflict.test.ts` — busy/focus/buffer/no-meeting detection
- [ ] `tests/unit/main/scheduling/conflict-alternatives.test.ts` — top-3 by proximity
- [ ] `tests/unit/main/scheduling/conflict-prime-time.test.ts` — prime-time bonus only for high-value
- [ ] `tests/unit/main/scheduling/rules.test.ts` — typed JSON rules CRUD + hard-rule block
- [ ] `tests/unit/main/scheduling/audit.test.ts` — calendar_action_log pre/post/override writes
- [ ] `tests/unit/main/scheduling/timezone.test.ts` — Google TZ canonical + OS fallback warning
- [ ] `tests/unit/main/integrations/google/recurrence.test.ts` — this / future / all
- [ ] `tests/unit/main/integrations/google/write-event.test.ts` — assertApproved chokepoint
- [ ] `tests/unit/main/integrations/google/write-event-etag.test.ts` — 412 + retry contract
- [ ] `tests/unit/renderer/features/settings/SchedulingRulesSection.spec.tsx` — settings UI
- [ ] `tests/unit/renderer/features/scheduling/SchedulingChat.spec.tsx` — NL command UI + ambiguity round-trip
- [ ] `tests/unit/renderer/features/approvals/ApprovalCard-calendar.spec.tsx` — calendar variant card
- [ ] `tests/static/single-calendar-write-site.test.ts` — APPR-02 static grep
- [ ] `tests/e2e/scheduling-propose.spec.ts` — full propose path
- [ ] `tests/e2e/calendar-approval-bypass.spec.ts` — bypass refused

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse Phase 2 OAuth loopback + PKCE + state CSRF |
| V3 Session Management | yes (token storage) | safeStorage (Phase 1) — refresh tokens never enter renderer |
| V4 Access Control | yes (APPR-02 chokepoint) | `assertApproved` + static-grep enforcer (mirror of APPR-01) |
| V5 Input Validation | yes | Zod IntentSchema + Zod RulesSchema; both validated at every IPC entry |
| V6 Cryptography | no (no new crypto introduced) | — |

### Known Threat Patterns for Calendar Write-back
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer constructs a fake `approved` approval and triggers write | Elevation of Privilege | All state mutations go through `persist.transitionTo`; write-event reads state via `assertApproved` |
| NL command contains PII routed to frontier | Information Disclosure | Phase 3 redactor pre-pass; router decides local-only if redaction inconclusive |
| Two-writer race (Aria + Calendar Web UI) clobbers user edit | Tampering | `If-Match: <etag>` on patch; 412 → new approval card with refreshed diff |
| Bug in self-only check allows multi-attendee silent change | Repudiation + Information Disclosure (uninvited notification to attendees) | `assertSelfOnly` before proposal generation; static-grep enforce single chokepoint also asserts `sendUpdates='none'` literal |
| User overrides focus block accidentally | Tampering with own time | Override is a distinct explicit click; logged with reason; audit-log surfaces in weekly recap (Phase 8) |
| RRULE manipulation creates orphan future series | Repudiation (calendar corruption) | rrule.js + restore-RRULE compensating action on insert failure (Pitfall 4) |
| Local LLM hallucinates an event ID not in calendar | Integrity | Resolver step REQUIRES that any `target.eventId` exist in `calendar_event` cache (or `events.get` confirmation); else ask user to clarify |
| Frontier API exfiltration of organizer email or attendees | Information Disclosure | NL-intent prompt does NOT include calendar contents; resolver runs locally on cached calendar_event rows; only the NL command text + redactor placeholders flow to frontier |

## Project Constraints (from CLAUDE.md)

- TypeScript / Node throughout (no Rust additions)
- Electron 33+ + electron-vite + React 18 + Tailwind + shadcn — UI work uses existing shadcn primitives
- AI SDK 6 unified for all LLM calls (verified in package.json — `ai ^6.0.0`)
- p-queue 9 for serialization (verified — already shared SchedulerHandle)
- better-sqlite3-multiple-ciphers + SQLCipher whole-DB encryption — migration 010 lands cleanly
- Approval gating: "All material calendar changes require explicit confirmation" — APPR-02 codified by `assertApproved` chokepoint
- No HIPAA / PCI in v1; standard OAuth + least-privilege — `calendar.events` is the narrowest write scope (NOT full `calendar` scope)
- Local-first; data never leaves machine except scoped LLM prompts (with PII pre-routed local) — NL→intent honors this via Phase 3 redactor + router
- Phases must be solo-session-sized — 3 plans, builds heavily on Phases 1-3 infra
- Tech-stack pins (snapshot section of CLAUDE.md): googleapis 144+, google-auth-library 9, AI SDK 5/6, Zod, p-queue, better-sqlite3 11.x, vitest 2/4, playwright 1.48+/1.60 — all aligned

## Sources

### Primary (HIGH confidence)
- Repo: `src/main/integrations/google/auth.ts` (SCOPES pattern, OAuth flow)
- Repo: `src/main/integrations/google/calendar.ts` (CalendarClient wrapper to extend)
- Repo: `src/main/integrations/google/sync-calendar.ts` (XCUT-07 TZ helpers)
- Repo: `src/main/db/migrations/003_calendar.sql` (current calendar_event shape)
- Repo: `src/main/db/migrations/006_approvals_and_tier.sql` (polymorphic approval table — Phase 4 reuses)
- Repo: `src/main/approvals/{state,persist,gate}.ts` (state machine + chokepoint)
- Repo: `.planning/phases/02-*/02-02-SUMMARY.md` (calendar ingest decisions; flags Phase 5/4 etag debt)
- Repo: `.planning/phases/03-*/03-01-SUMMARY.md` (polymorphic kind extension precedent)
- Repo: `.planning/REQUIREMENTS.md` lines 30, 52–55 (CAL-04..07, APPR-02 verbatim)
- Repo: `package.json` (verified versions of ai, googleapis, p-queue, zod)
- Google Calendar API v3 docs: events.patch / events.instances / freebusy.query / scopes [CITED: developers.google.com/calendar/api/v3/reference/*]
- AI SDK 6: generateObject signature + Zod schema integration [CITED: ai-sdk.dev/docs/reference/ai-sdk-core/generate-object]
- RFC5545 §3.3.10 / §3.8.5.3 (RRULE + UNTIL semantics) [CITED]

### Secondary (MEDIUM confidence)
- rrule.js library status [ASSUMED — recommend `npm view rrule` in plan-checker]
- Local Ollama `generateObject` reliability ceiling [ASSUMED — recommend small spike or fallback]

### Tertiary (LOW confidence)
- Google Calendar working-hours API exact surface [Open Q 1 — recommend short investigation in Plan 04-02 before committing rules-engine UI]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all but rrule.js already in repo and verified in package.json
- Architecture: HIGH — polymorphic approval table was explicitly designed for this in Phase 3; calendar wrapper + sync engine designed with extension hooks
- Pitfalls: HIGH (recurring semantics, etag, sendUpdates, self-only) / MEDIUM (working-hours API location)
- NL→intent: MEDIUM — generateObject + Zod is the right primitive; local-model reliability is the residual risk
- Validation architecture: HIGH — all gaps explicitly listed; pattern carries from Phase 3

**Research date:** 2026-05-18
**Valid until:** 2026-06-17 (30 days — Google Calendar v3 is stable; AI SDK 6 is recent but stable; rrule.js is stable)
