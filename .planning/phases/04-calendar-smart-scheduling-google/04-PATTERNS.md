# Phase 4: Calendar Smart-Scheduling (Google) — Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 21 new + 5 modified
**Analogs found:** 25 / 26 (one greenfield — `recurrence.ts` has no in-repo analog; rrule.js semantics)

This phase is wiring-heavy. ~85% of patterns are direct reuse from Phases 1–3. The new external dep is `rrule`. The single semantic novelty (RRULE math for "this/future/all") has no in-repo analog — planner must lean on RESEARCH Pattern 3 + rrule.js docs.

## File Classification

| File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|------|---------|------|-----------|----------------|---------------|
| `src/main/db/migrations/010_calendar_writeback.sql` | NEW | migration | schema | `src/main/db/migrations/006_approvals_and_tier.sql` | exact |
| `src/main/integrations/google/auth.ts` | MOD | config | n/a | self (extend SCOPES.calendar) | exact (Phase 3 Plan 03-04 precedent for gmail.send) |
| `src/main/integrations/google/calendar.ts` | MOD | service-wrapper | request-response | self (add `patchEvent`, `insertEvent`, `eventsInstances`, `freebusyQuery`, `getCalendarSettings`) | exact |
| `src/main/integrations/google/write-event.ts` | NEW | service (chokepoint) | request-response + side-effect | `src/main/integrations/google/send.ts` | exact |
| `src/main/integrations/google/recurrence.ts` | NEW | utility | transform (pure) | — (none) — partial: `src/main/integrations/google/sync-calendar.ts` for TZ helper style | partial |
| `src/main/scheduling/intent.ts` | NEW | service (LLM) | request-response | `src/main/llm/sensitivityClassifier.ts` | exact (generateObject + Zod + p-queue) |
| `src/main/scheduling/resolver.ts` | NEW | service | CRUD-read + clarification | `src/main/triage/email.ts` | role-match |
| `src/main/scheduling/self-only-gate.ts` | NEW | utility (guard) | pure predicate | `src/main/approvals/gate.ts` (guard-style throw) | role-match |
| `src/main/scheduling/conflict.ts` | NEW | service | CRUD-read + transform | `src/main/integrations/google/sync-calendar.ts` (window math) + `src/main/triage/email.ts` (scoring) | role-match |
| `src/main/scheduling/rules.ts` | NEW | service (CRUD) | CRUD | `src/main/approvals/tier.ts` | role-match |
| `src/main/scheduling/audit.ts` | NEW | service (logger) | append-only | `src/main/integrations/google/sendLog.ts` | exact |
| `src/main/ipc/scheduling.ts` | NEW | IPC handler | request-response | `src/main/ipc/approvals.ts` | exact |
| `src/main/approvals/persist.ts` | MOD | model | CRUD | self (extend `NewApprovalInput` w/ calendar columns; kind union) | exact |
| `src/main/approvals/gate.ts` | (no mod) | guard | predicate | reused as-is | n/a |
| `src/renderer/features/approvals/ApprovalCard.tsx` | MOD | component | request-response | self (add `kind==='calendar_change'` variant block) | exact |
| `src/renderer/features/scheduling/SchedulingChat.tsx` | NEW | component | request-response (chat) | `src/renderer/features/settings/AskAriaBox.tsx` | role-match |
| `src/renderer/features/settings/SchedulingRulesSection.tsx` | NEW | component (form) | CRUD | `src/renderer/features/settings/BriefingSettingsSection.tsx` | exact |
| `src/renderer/features/settings/IntegrationsSection.tsx` | MOD | component | UI | self (add calendar re-consent banner) | exact (Phase 3 Plan 03-04 precedent) |
| `tests/static/single-calendar-write-site.test.ts` | NEW | test (static) | static-grep | `tests/static/single-send-call-site.test.ts` | exact |
| `tests/unit/main/db/migrations.spec.ts` | MOD | test | n/a | self (bump version asserts to `[1..10]`) | exact |
| `tests/unit/main/scheduling/intent.test.ts` | NEW | test (unit) | n/a | tests for `sensitivityClassifier.ts` | role-match |
| `tests/unit/main/scheduling/self-only-gate.test.ts` | NEW | test | n/a | tests for `approvals/gate.ts` | role-match |
| `tests/unit/main/scheduling/conflict.test.ts` | NEW | test | n/a | `tests/unit/main/integrations/google/sync-calendar.test.ts` (if exists) | partial |
| `tests/unit/main/scheduling/rules.test.ts` | NEW | test | n/a | existing approvals persist tests | partial |
| `tests/unit/main/integrations/google/write-event.test.ts` | NEW | test | n/a | tests for `send.ts` | exact |
| `tests/unit/main/integrations/google/recurrence.test.ts` | NEW | test | n/a | — | none |
| `tests/e2e/scheduling-propose.spec.ts` | NEW | e2e | n/a | existing approvals e2e | role-match |
| `tests/e2e/calendar-approval-bypass.spec.ts` | NEW | e2e | n/a | existing bypass spec for send | exact |

---

## Pattern Assignments

### `src/main/integrations/google/write-event.ts` (NEW — chokepoint)

**Analog:** `src/main/integrations/google/send.ts` (Plan 03-04). This is the **most important pattern in the phase** — APPR-02 chokepoint mirrors APPR-01 exactly.

**Copy the file-header docblock pattern** (send.ts lines 1–23): naming the file as THE ONLY call site, citing the static-grep test, declaring `assertApproved` as FIRST executable line, declaring audit-log writes on BOTH success and failure paths.

**Imports pattern** (send.ts lines 24–32):
```ts
import type Database from 'better-sqlite3-multiple-ciphers';
import { google } from 'googleapis';
import { assertApproved } from '../../approvals/gate';
import { getApproval, transitionTo, writeSendLog } from '../../approvals/persist';
import { getOAuth2Client } from './auth';
```
Adapt: swap `writeSendLog` → `logCalendarAction` from `scheduling/audit.ts`; add `import { computeRecurringWrite } from './recurrence';`.

**Chokepoint pattern** (send.ts lines 85–90 — first line MUST be assertApproved):
```ts
export async function sendApprovedEmail(db: Db, approvalId: string, deps: SendApprovedDeps = {}): Promise<SendResult> {
  assertApproved(db, approvalId);              // ← FIRST LINE — APPR-01 chokepoint
  const row = getApproval(db, approvalId);
  ...
}
```
Apply verbatim shape: `assertApproved(db, approvalId)` on line 1 of `applyCalendarChange`. RESEARCH Code Example 2 already shows the calendar-flavored body.

**Audit-log-on-both-paths pattern** (send.ts lines 119–149):
```ts
let providerMsgId: string | null = null;
let sendErr: Error | null = null;
try {
  // ... API call ...
} catch (err) {
  sendErr = err instanceof Error ? err : new Error(String(err));
}
// Always write send_log — both success and failure paths (T-03-04-06).
const logId = writeSendLog(db, { approvalId, ok: sendErr ? 0 : 1, ... });
if (sendErr || !providerMsgId) {
  throw sendErr ?? new Error('gmail-send-failed');
}
transitionTo(db, approvalId, 'sent', { sent_at: new Date().toISOString(), ... });
```
Apply: write `calendar_action_log` rows for `pre_write` (before API), and `post_write` (success) OR `failed` (catch). Transition `approved → sent` ONLY on success.

**Dependency-injection seam** (send.ts lines 73–77):
```ts
export interface SendApprovedDeps {
  buildGmailClient?: () => Promise<ReturnType<typeof google.gmail>>;
}
```
Apply: `interface ApplyCalendarChangeDeps { buildCalendarClient?: () => Promise<CalendarClient> }` so unit tests inject a fake.

---

### `src/main/db/migrations/010_calendar_writeback.sql` (NEW)

**Analog:** `src/main/db/migrations/006_approvals_and_tier.sql`.

**Polymorphic table extension idiom:** migration 006 already pre-declared `approval` columns as nullable (line 17 comment: *"email_send payload (NULL when kind != 'email_send'; Phase 4 adds calendar columns)"*). Phase 4 honors that hand-off.

**`kind` CHECK widening:** SQLite cannot ALTER CHECK in place. Use the RENAME/CREATE/INSERT/DROP idiom (RESEARCH Migration 010 sketch lines 261–281). Reference the existing index names verbatim (006 lines 42–44):
```sql
CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);
```

**Additive ALTERs for `calendar_event`:** the existing schema (003_calendar.sql lines 28–46) has no `etag`/`i_cal_uid`/`sequence`/`organizer_*`/`recurrence_json` — add via `ALTER TABLE … ADD COLUMN` (paying back Phase 2 SUMMARY debt).

**Singleton table pattern** (003_calendar.sql lines 19–27 `calendar_account`):
```sql
CREATE TABLE scheduling_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ...
);
```
Copy `CHECK (id = 1)` enforced-singleton pattern.

**Migration runner:** `runner.ts` lines 1–11 — files named `<NNN>_<slug>.sql` are user_version-driven; advance to `010`. Update `tests/unit/main/db/migrations.spec.ts` version asserts to `[1..10]` / `user_version === 10` (precedent in every prior phase per RESEARCH Pitfall 7).

---

### `src/main/scheduling/intent.ts` (NEW — NL → Intent)

**Analog:** `src/main/llm/sensitivityClassifier.ts` (Plan 03-02).

**Schema + generateObject + retry pattern** (sensitivityClassifier.ts lines 19–32):
```ts
import { z } from 'zod';
import { generateObject } from 'ai';
import type PQueueImport from 'p-queue';

export const SensitivitySchema = z.object({
  categories: z.array(z.enum([...])).min(1),
  severity: z.enum(['low','med','high']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
});
export type SensitivityResult = z.infer<typeof SensitivitySchema>;
```
Apply verbatim to `IntentSchema` (RESEARCH Pattern 5 lines 358–371).

**p-queue wrap + maxRetries pattern** (per sensitivityClassifier and RESEARCH Pitfall 8): every `generateObject` call goes inside `scheduler.queue.add(...)`; pass `maxRetries: 2`. On local-model exhaustion, fall back to frontier IF redaction passed.

**Router integration:** call `getRouterModel({ payload: nl, kind: 'scheduling' })` per `router.ts` lines 1–55 — router decides local vs frontier based on PII classifier. Reuse PII redaction from `briefing/redact.ts` lines 1–40 (uses `DEFAULT_PII_PATTERNS` from `log/redact.ts`).

---

### `src/main/integrations/google/calendar.ts` (MOD — extend wrapper)

**Analog:** self.

**Error-translation pattern** (lines 88–116): keep the `isGone`/`maybeThrowTokenInvalid` envelope; wrap every new method (`patchEvent`, `insertEvent`, `freebusyQuery`, `getCalendarSettings`, `eventsInstances`) in the same try/catch:
```ts
async patchEvent(opts: PatchEventOpts) {
  try {
    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId: opts.eventId,
      requestBody: opts.requestBody,
      sendUpdates: opts.sendUpdates ?? 'none',
      ifMatch: opts.ifMatch,
    });
    return res.data;
  } catch (err) {
    maybeThrowTokenInvalid(err);
    throw err;
  }
}
```

**Custom-error class pattern** (lines 29–35): add `EtagMismatchError extends Error` for 412 responses, mirroring `SyncTokenInvalidatedError`.

**Pitfall-14-style defensive check pattern** (lines 130–141): for `patchEvent` add an `assertScope` defensive check — RESEARCH Pitfall 3 requires that if approval's `recurring_scope === 'this'`, the `eventId` MUST contain an underscore (instance-ID marker). Throw `InvalidInstanceIdError` at the wrapper boundary before the HTTP call.

---

### `src/main/integrations/google/auth.ts` (MOD — SCOPES.calendar)

**Analog:** self. Pattern already proven for `gmail.send` incremental consent (lines 42–51, Plan 03-04 Shape A).

**Copy diff** (lines 50):
```ts
// before
calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
// after
calendar: [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',  // NEW — narrowest write scope; do NOT request full `calendar`
],
```
Renderer banner via `IntegrationsSection.tsx` per Phase 3 Plan 03-04 precedent.

---

### `src/main/scheduling/audit.ts` (NEW)

**Analog:** `src/main/integrations/google/sendLog.ts` + `writeSendLog` in `approvals/persist.ts`.

**Append-only insert pattern:** simple `INSERT INTO calendar_action_log (...) VALUES (...)` returning rowid. Phases: `'proposed' | 'pre_write' | 'post_write' | 'failed' | 'override'`. JSON-serialize `before_json`/`after_json`/`rule_overrides_json` at insert time (consistent with `approval.recipients_json` pattern from persist.ts).

---

### `src/main/scheduling/self-only-gate.ts` (NEW)

**Analog:** `src/main/approvals/gate.ts` (lines 26–33 for error class + 41–100 for throw pattern).

**Custom-error-then-throw pattern** (gate.ts lines 21–33):
```ts
export type SelfOnlyGateErrorCode = 'multi-attendee' | 'no-organizer';
export class SelfOnlyGateError extends Error {
  readonly code: SelfOnlyGateErrorCode;
  constructor(code: SelfOnlyGateErrorCode, message: string) {
    super(message);
    this.name = 'SelfOnlyGateError';
    this.code = code;
  }
}
```

**Predicate logic** (per RESEARCH Pitfall 5): `isSelfOnly(event, userEmail) = (attendees is undefined OR length === 0) OR (every attendee.email === organizer.email AND organizer.self === true)`. Uses `organizer_email` + `organizer_self` columns added in migration 010.

---

### `src/main/ipc/scheduling.ts` (NEW)

**Analog:** `src/main/ipc/approvals.ts` (lines 1–80).

**Handler-registration shape** (approvals.ts lines 51–60):
```ts
export function registerSchedulingHandlers(ipcMain: IpcMain, deps: SchedulingDeps): void {
  const { logger, dbHolder } = deps;
  ipcMain.handle(CHANNELS.SCHEDULING_PROPOSE, async (_e, nl: string) => { ... });
  ipcMain.handle(CHANNELS.SCHEDULING_RULES_GET, async () => { ... });
  ipcMain.handle(CHANNELS.SCHEDULING_RULES_SET, async (_e, rules) => { ... });
}
```

**`notReady` / `DbHolder` pattern** (approvals.ts lines 36–38, 56): copy verbatim — DB-not-open returns `{ error: 'DB_NOT_OPEN' }`.

**E2E-hook env-gating pattern** (approvals.ts lines 46–48, 58): if Phase 4 needs E2E seeding, mirror `process.env.ARIA_E2E === '1'` guarded handlers.

**Channel registration:** add to `src/shared/ipc-contract.ts` (planner will read its existing CHANNELS layout).

---

### `src/renderer/features/approvals/ApprovalCard.tsx` (MOD)

**Analog:** self.

**Variant-by-kind pattern:** ApprovalCard.tsx already takes `row: ApprovalRowDto` (lines 21–29). Plan 04 adds branch `if (row.kind === 'calendar_change') return <CalendarApprovalCard row={row} ... />` OR inlines the variant. Recurring-scope radio defaults to `'this'` (CONTEXT decision). Pre-existing JSON parse helpers (lines 31–49) are reused for `conflicts_json`/`alternatives_json`/`rule_overrides_json`.

**Edit-then-approve, reject, snooze, batch-select pattern** already exists (lines 21–29 props); calendar variant inherits the same `onApprove`/`onReject`/`onSnooze` contract.

---

### `src/renderer/features/settings/SchedulingRulesSection.tsx` (NEW)

**Analog:** `src/renderer/features/settings/BriefingSettingsSection.tsx` (form + save + advanced-JSON drawer).

**Form-then-save IPC roundtrip:** copy the local-state / dirty-flag / save-button pattern. Validate via the shared Zod schema (re-import from `src/main/scheduling/rules.ts` types — or move schema to `src/shared/scheduling-rules.ts` so the renderer can validate before IPC).

---

### `tests/static/single-calendar-write-site.test.ts` (NEW)

**Analog:** `tests/static/single-send-call-site.test.ts` (the entire file, 58 lines — copy verbatim and swap the regex + allowed path).

**Imports, walk(), stripLineComments** (lines 10–36): copy verbatim.

**Regex pattern change** (line 32):
```ts
// SEND_RE
const SEND_RE = /[A-Za-z_$][\w$]*\s*\.\s*users\s*\.\s*messages\s*\.\s*send\s*\(/;
// NEW for Phase 4 (two regexes — events.patch AND events.insert)
const PATCH_RE  = /[A-Za-z_$][\w$]*\s*\.\s*events\s*\.\s*patch\s*\(/;
const INSERT_RE = /[A-Za-z_$][\w$]*\s*\.\s*events\s*\.\s*insert\s*\(/;
```

**Allowed-path constant** (line 16): swap to `src/main/integrations/google/write-event.ts`. Note: `calendar.ts` wrapper now also contains `calendar.events.patch(` — exempt the wrapper too OR keep the wrapper calling through a renamed helper. **Planner decision:** put both call sites in `write-event.ts` directly (the wrapper exposes methods that internally call `calendar.events.patch` — wrapper file must be in the allow-list, since the chokepoint enforcement is at the function call, not the file).

**Verify** (lines 38–57): same `it(...)` assert shape; offenders array empty + match count > 0.

---

### `tests/unit/main/db/migrations.spec.ts` (MOD)

**Analog:** self.

Update version asserts from `[1..9]` / `user_version === 9` → `[1..10]` / `user_version === 10`. Precedent: every prior migration plan did this (Phase 2 02-02 SUMMARY, Phase 3 03-01 SUMMARY).

---

## Shared Patterns

### Pattern A: Approval Chokepoint (assertApproved FIRST LINE)
**Source:** `src/main/approvals/gate.ts` (entire file, esp. lines 41–100) + `src/main/integrations/google/send.ts` lines 85–90.
**Apply to:** `src/main/integrations/google/write-event.ts` only.
**Static-grep enforcement:** `tests/static/single-calendar-write-site.test.ts`.

### Pattern B: Polymorphic Approval Row
**Source:** `src/main/db/migrations/006_approvals_and_tier.sql` lines 5–44 + `src/main/approvals/persist.ts` lines 27–82.
**Apply to:** migration 010 + persist.ts `NewApprovalInput` extension + `ApprovalKind` union widening to `'email_send' | 'calendar_change'`.

### Pattern C: State Machine
**Source:** `src/main/approvals/state.ts` lines 12–37.
**Apply to:** calendar approvals — REUSE AS-IS. Same states (`pending → generating → ready → approved → sent`). No new transitions needed.

### Pattern D: googleapis Wrapper Error Translation
**Source:** `src/main/integrations/google/calendar.ts` lines 75–116, 142–162.
**Apply to:** every new method on the wrapper (`patchEvent`, `insertEvent`, `freebusyQuery`, `eventsInstances`, `getCalendarSettings`). Always wrap try/catch → `maybeThrowTokenInvalid(err); throw err`.

### Pattern E: AI SDK 6 generateObject + Zod + p-queue
**Source:** `src/main/llm/sensitivityClassifier.ts` lines 19–32 (schema) + uses `scheduler.queue.add` for dispatch + `maxRetries: 2`.
**Apply to:** `src/main/scheduling/intent.ts`. Schema MUST stay shallow (RESEARCH Pitfall 8 — local Ollama reliability).

### Pattern F: p-queue Single-Concurrency Serialization
**Source:** `src/main/lifecycle/scheduler.ts` lines 20–27.
**Apply to:** all `generateObject` + all `events.*` API calls in this phase — wrap with `scheduler.queue.add(...)` (calendar sync already does this).

### Pattern G: PII Redaction Before Frontier
**Source:** `src/main/briefing/redact.ts` lines 1–40 (uses `DEFAULT_PII_PATTERNS` + `DEFAULT_PII_PATTERN_TOKENS` from `src/main/log/redact.ts`).
**Apply to:** NL→intent — if router routes to frontier, pre-pass NL through redactor with rehydration after `generateObject` returns.

### Pattern H: IPC Handler Registration
**Source:** `src/main/ipc/approvals.ts` lines 1–60.
**Apply to:** `src/main/ipc/scheduling.ts`. Pattern: `registerSchedulingHandlers(ipcMain, deps)` + `DbHolder` + `notReady()` guard + `CHANNELS.SCHEDULING_*` constants in `src/shared/ipc-contract.ts`.

### Pattern I: OAuth Incremental Consent
**Source:** `src/main/integrations/google/auth.ts` lines 42–51 (Plan 03-04 added `gmail.send` to existing readonly scope).
**Apply to:** SCOPES.calendar — add `calendar.events`. Refresh tokens in safeStorage already; no changes to OAuth flow itself.

### Pattern J: Migration version-bump test
**Source:** `tests/unit/main/db/migrations.spec.ts` (existing).
**Apply to:** bump expected version to 10. Precedent in every prior migration phase.

### Pattern K: Append-only audit log
**Source:** `src/main/integrations/google/sendLog.ts` + `writeSendLog` in `approvals/persist.ts`.
**Apply to:** `src/main/scheduling/audit.ts` writing `calendar_action_log` rows.

### Pattern L: Singleton Config Table
**Source:** `src/main/db/migrations/003_calendar.sql` lines 19–27 (`calendar_account` with `id INTEGER PRIMARY KEY CHECK (id = 1)`).
**Apply to:** `scheduling_rules` table.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner Reference |
|------|------|-----------|--------|-------------------|
| `src/main/integrations/google/recurrence.ts` | utility (pure) | RRULE transform | No RRULE handling exists in repo; new external dep `rrule.js` | RESEARCH §Pattern 3 (this/future/all matrix) + §Pitfalls 2, 3, 4; rrule.js README |
| `tests/unit/main/integrations/google/recurrence.test.ts` | test | n/a | Tests for novel module | Drive from RESEARCH Pattern 3 table — three write paths × instance-ID corner cases |

---

## Metadata

**Analog search scope:** `src/main/**`, `src/renderer/features/**`, `src/main/db/migrations/**`, `tests/static/**`
**Files scanned:** ~60 main + ~15 renderer feature + 9 migrations + 1 static test
**Key reusable scaffolding identified:**
- Phase 2: `calendar.ts` wrapper, `sync-calendar.ts` engine, OAuth scope abstraction, calendar_event mirror
- Phase 3: polymorphic `approval` table (lines 5–41 of 006), `assertApproved` chokepoint, `assertTransition` state machine, `sensitivityClassifier.ts` (generateObject+Zod template), `single-send-call-site.test.ts` (static-grep template), `IntegrationsSection.tsx` re-consent banner, `send.ts` chokepoint shape (the most important analog in the phase)
- Phase 1: `scheduler.ts` p-queue handle, `log/redact.ts` PII patterns, `router.ts` local-vs-frontier decision

**Pattern extraction date:** 2026-05-18

---

## PATTERN MAPPING COMPLETE

**Phase:** 04 - calendar-smart-scheduling-google
**Files classified:** 26 (21 new + 5 modified)
**Analogs found:** 25 / 26

### Coverage
- Files with exact analog: 16
- Files with role-match / partial analog: 8
- Files with no analog: 2 (`recurrence.ts` + its test)

### Key Patterns Identified
1. **`write-event.ts` mirrors `send.ts` exactly** — `assertApproved` FIRST LINE + audit-log-on-both-paths + transition-on-success-only. This is the APPR-02 chokepoint, structurally identical to APPR-01.
2. **Static-grep enforcer is a verbatim copy** of `tests/static/single-send-call-site.test.ts` with the regex swapped to `events.patch` + `events.insert` and the allowed path swapped to `write-event.ts`.
3. **Polymorphic approval extension was pre-wired** — migration 006 line 17 explicitly documents that Phase 4 will add calendar columns; persist.ts `NewApprovalInput` widens cleanly.
4. **NL→intent reuses sensitivityClassifier shape** — generateObject + Zod + p-queue + maxRetries:2 + router-decides-local-vs-frontier.
5. **Only one greenfield module** — `recurrence.ts` (rrule.js usage). Everything else is wiring.

### Ready for Planning
Pattern mapping complete. Planner can reference concrete file/line analogs in PLAN.md task actions.
