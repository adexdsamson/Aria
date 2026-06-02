# Phase 14: Voice Safety / Confirm Contract - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 9 (4 new, 5 modified)
**Analogs found:** 9 / 9 (every file has an in-repo analog; zero greenfield patterns)

> All work this phase is headless (no audio). Every new file is a unit/integration/static
> test artifact or a pure contract function. The planner should treat "no audio yet" as a
> hard constraint: nothing here wires IPC, mic, or a caller of `voiceConfirm`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/voice/confirm.ts` (NEW) | service (dormant contract seam) | transform (row state transition) | `src/main/approvals/persist.ts` → `writeSendLog` (line 287) | exact (dormant-contract precedent) |
| `src/main/approvals/persist.ts` (MOD) | model (type union) | transform | self — extend `ApprovalPath` line 25 | exact |
| `src/main/approvals/gate.ts` (MOD) | service (authorization gate) | request-response (assert/throw) | self — existing forced-explicit branch lines 84-99 + error-code union lines 21-24 | exact |
| `src/main/db/migrations/134_voice_explicit_path.sql` (NEW) | migration | batch (DDL rebuild) | `124_meeting_extraction_approvals.sql` (table-rebuild idiom) | exact |
| `src/main/db/migrations/embedded.ts` (MOD) | migration (bundled snapshot) | batch | self — append version-134 entry mirroring the new .sql | exact |
| `tests/static/voice-routes-through-staging.spec.ts` (NEW) | test (static ratchet) | batch (FS walk + regex) | `tests/static/single-calendar-write-site.test.ts` | exact |
| `tests/static/<chokepoint-caller-allow-list>.spec.ts` (NEW) | test (static ratchet) | batch | `tests/static/single-entitlement-gate-site.test.ts` (caller allow-list idiom) | exact |
| gate unit/integration test (SC2) (NEW) | test | request-response | existing gate tests (vitest) | role-match |
| SC4 integration test (NEW) | test | request-response | `send.ts` assertApproved call site (line 146) | role-match |
| `.planning/research/ARCHITECTURE.md` (MOD docs) | docs | n/a | self — lines 122/306/314-316 | n/a |

---

## Pattern Assignments

### `src/main/voice/confirm.ts` (NEW — dormant contract seam)

**Analog:** `src/main/approvals/persist.ts` → `writeSendLog` (the "dormant, zero-caller, locked-up-front" precedent named explicitly in D-10).

**The dormant-contract precedent** (`persist.ts:281-316`):
```typescript
/**
 * Append a row to send_log. Dormant in Plan 03-01 — the send_log table is
 * created by Plan 03-04 migration 009; this function exists so the contract
 * is locked up front. Calling it before migration 009 lands will throw
 * (no such table).
 */
export function writeSendLog(db: Db, args: {...}): number { ... }
```
The docblock idiom ("dormant … exists so the contract is fixed up front") is the exact
voice to reuse for `confirm.ts`. ARCHITECTURE.md:122 already names `confirm.ts` "the
load-bearing trust decision."

**The single mutation primitive it wraps** (`persist.ts:211-239`) — `voiceConfirm` calls
`transitionTo` with `to='approved'` and `patch={ approval_path: 'voice-explicit' }`. Note
`transitionTo` already runs inside a transaction, validates via `assertTransition`, and only
applies patch keys in `ALLOWED_PATCH_COLS` (line 170) — `approval_path` IS in that set
(line 171), so no persist.ts change is needed for the patch path:
```typescript
export function transitionTo(
  db: Db,
  id: string,
  to: ApprovalState,
  patch: Partial<ApprovalRow> = {},
): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(id) as
      | { state: ApprovalState } | undefined;
    if (!row) throw new Error(`approval-not-found:${id}`);
    assertTransition(row.state, to);
    // ...applies only ALLOWED_PATCH_COLS keys, then UPDATE
  });
  tx();
}
```

**Frozen signature** (D-11): `export function voiceConfirm(db: Db, approvalId: string): void`
— two args only, no read-back payload type, no IPC. Import `transitionTo` and the `Db` type
alias (`type Db = Database.Database` from `better-sqlite3-multiple-ciphers`, see persist.ts:14, 20).

**Legal edge it relies on** (`state.ts:25-37`): `ready → approved` is the ONLY edge into
`approved` and is exactly what the UI fires — so SC4 ("same transition the UI performs") is
true by construction (D-05). No state-machine change:
```typescript
const ALLOWED: Record<ApprovalState, readonly ApprovalState[]> = {
  ready: ['approved', 'rejected', 'snoozed'],
  approved: ['sent', 'sending'],
  // ...
};
```

---

### `src/main/approvals/persist.ts` (MODIFIED — union extension, D-01)

**Analog:** self. Single-line change at line 25:
```typescript
// BEFORE
export type ApprovalPath = 'explicit' | 'silent';
// AFTER
export type ApprovalPath = 'explicit' | 'silent' | 'voice-explicit';
```
Note `insertApproval` defaults `approval_path` to `'explicit'` (line 135) — leave that
default; voice never goes through `insertApproval` for the path (D-07: staging reuses
`insertApproval`, the *confirm* sets the path). `ALLOWED_PATCH_COLS` already contains
`'approval_path'` (line 171) so the widened value flows through `transitionTo` unchanged.

---

### `src/main/approvals/gate.ts` (MODIFIED — named rejection branch, D-02)

**Analog:** self. Two extension points.

**1. Extend the error-code union** (lines 21-24) — add the dedicated code:
```typescript
export type ApprovalGateErrorCode =
  | 'not-found'
  | 'not-approved'
  | 'forced-explicit-missing'
  | 'voice-forbidden-forced';   // D-02: NEW dedicated code
```
`ApprovalGateError` (lines 26-33) carries `code` verbatim — no constructor change.

**2. The existing forced branch to mirror** (lines 84-99) — the new named branch is
defense-in-depth that fires *within/before* this generic check (D-02). The generic logic:
```typescript
const isForced =
  parseFailed ||
  row.severity === null ||
  row.severity === 'high' ||
  cats.some((c) => FORCED_CATEGORIES.has(c));
if (isForced && row.approval_path !== 'explicit') {
  // throws 'forced-explicit-missing'
}
```
The new branch: when `isForced && row.approval_path === 'voice-explicit'`, throw
`new ApprovalGateError('voice-forbidden-forced', …)`. Place it BEFORE the generic
`!== 'explicit'` throw so a future refactor of the generic branch cannot silently reopen
the voice path. `'voice-explicit'` is `!== 'explicit'`, so it is ALSO caught by the generic
branch today — the named branch makes the rejection auditable and refactor-proof.
`FORCED_CATEGORIES = {financial, legal, hr}` (lines 35-39). The SELECT already pulls
`approval_path` (line 44) — no query change.

> SC2 centerpiece (D-12 / `<specifics>`): the failing-then-passing test must assert the
> SPECIFIC `voice-forbidden-forced` code, NOT the generic `forced-explicit-missing`.

---

### `src/main/db/migrations/134_voice_explicit_path.sql` (NEW — CHECK-widening, D-03)

**Analog:** `124_meeting_extraction_approvals.sql` (the table-rebuild idiom; the most recent
rebuild of `approval`). Next free version is **134** (last is `133_research.sql`; see runner
numbering below).

**The CHECK pinned across every materialized form** (all currently
`CHECK (approval_path IN ('explicit','silent'))`):
- `006_approvals_and_tier.sql:15`
- `010_calendar_writeback.sql:23`
- `012a_idempotency_key.sql:20`
- `124_meeting_extraction_approvals.sql:61`
- `embedded.ts` (multiple snapshot stages — final materialized form at line 685)

**Rebuild idiom to copy** (`124_…sql:50-119`) — SQLite cannot ALTER a CHECK, so the table is
renamed, recreated with the widened CHECK, repopulated via INSERT…SELECT, then dropped:
```sql
ALTER TABLE approval RENAME TO approval_old;

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change','task_batch')),
  state TEXT NOT NULL CHECK (state IN ( 'pending','generating', ... )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approval_path TEXT NOT NULL DEFAULT 'explicit'
    CHECK (approval_path IN ('explicit','silent','voice-explicit')),  -- WIDENED
  -- ... all 30+ columns verbatim from the 124 column list ...
  meeting_note_id TEXT
);

INSERT INTO approval (id, kind, state, ..., meeting_note_id)
SELECT id, kind, state, ..., meeting_note_id
FROM approval_old;

DROP TABLE approval_old;

CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
```
CAUTION: copy the EXACT column set from 124 (it added `beta_voice INTEGER NOT NULL DEFAULT 0`
at line 79 — present in the current live shape). A drifted column list will lose data on the
INSERT…SELECT. Discretion (D-03 / `<decisions>`): in-place rebuild vs full rebuild is the
planner's call, but it MUST follow this chain convention.

**Runner numbering convention** (`runner.ts:4-6`): files named `<NNN>[a-z]?_<slug>.sql`;
numeric/alpha prefix IS the target `user_version`. Applied if prefix > current
`user_version`, inside a single transaction that advances `user_version`. So `134_…` lands
as version 134.

---

### `src/main/db/migrations/embedded.ts` (MODIFIED — bundled snapshot, D-03)

**Analog:** self. The runner reads `EMBEDDED_MIGRATIONS` (version/file/sql) when no explicit
dir is supplied (`runner.ts:67`); fresh/packaged DBs run THIS, the .sql files only run in
unit tests. D-03 is explicit: update BOTH or fresh test DBs and migrated DBs split-brain.

**Append a new entry** mirroring the .sql, matching the existing shape (last is version 133
at line 1451):
```typescript
export const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [
  // ... existing 1..133 ...
  {
    version: 134,
    file: '134_voice_explicit_path.sql',
    sql: `<verbatim copy of the .sql rebuild above>`,
  },
];
```
The header docblock warns: "Keep in sync with the .sql files. The migrations test reads from
the .sql files directly — drift between the two will fail in CI." So the embedded `sql`
string must be byte-equivalent to the .sql file.

> Do NOT edit the historical embedded snapshots (lines 157/254/464/685) — those are frozen
> past versions. Only the NEW version-134 rebuild widens the CHECK going forward.

---

### `tests/static/voice-routes-through-staging.spec.ts` (NEW — named voice ratchet, D-08 option A)

**Analog:** `tests/static/single-calendar-write-site.test.ts` (canonical ratchet shape).

**The idiom to copy verbatim** (`single-calendar-write-site.test.ts:33-71`):
```typescript
const ROOT = path.resolve(__dirname, '../..', 'src', 'main');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|js|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripLineComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments first
    .replace(/\/\/[^\n]*/g, '');        // then line comments
}

// match → collect offenders → assert offenders === []
const offenders = matches.filter((m) => !allowed.has(m));
expect(offenders, `offending …: ${offenders.join(', ')}`).toEqual([]);
```
Keyed to the planned `src/main/voice/**` namespace; phrase the test description to read like
SC3 so an auditor can point to it (D-08A). D-09a (discretion): may also assert no
`src/main/voice/**` file contains a `approval_path:'explicit'` literal (it must write
`'voice-explicit'`) — mirror the `phase12-bans.spec.ts` banned-token shape:
```typescript
// phase12-bans.spec.ts:34, 58-72 — banned literal idiom
const BANS = ['app.dock.hide', 'openAsHidden', ...] as const;
for (const banned of BANS) {
  it(`no file ... contains \`${banned}\``, () => {
    const offenders = ALL_FILES.filter((f) => stripComments(read(f)).includes(banned));
    expect(offenders, ...).toEqual([]);
  });
}
```

---

### Chokepoint caller allow-list spec (NEW — D-08 option B, the real hole-closer)

**Analog:** `tests/static/single-entitlement-gate-site.test.ts` (the caller allow-list idiom
— GATED_SITES + ALLOWED_CALLERS Set + "no other file calls it" assertion).

**Why this and not the existing write-site ratchets** (D-09): the existing ratchets guard the
*low-level SDK surface* (`events.patch`, `messages.send`, `provider.mail.sendMessage`) — NOT
the exported chokepoint *entry points* a voice handler would call. This spec closes that gap.

**The three chokepoint entry points to fence** (heterogeneous signatures — regex must match
BOTH import and call site, D-09):
| Entry point | Signature | Source |
|-------------|-----------|--------|
| `sendApprovedEmail(db, approvalId, deps)` | positional | `src/main/integrations/send.ts:140` |
| `applyCalendarChange(db, approvalId, deps)` | positional | `src/main/integrations/write-event.ts:88` |
| `pushApprovedMeetingActions({ db, approvalId, client })` | single options object | `src/main/integrations/todoist/push-actions.ts:25` |

**The ONLY legitimate callers today** (allow-list — verified via grep):
- `sendApprovedEmail` ← `src/main/ipc/gmail-send.ts` (import :22, call :129)
- `applyCalendarChange` ← `src/main/ipc/approvals.ts` (import :23, call :223)
- `pushApprovedMeetingActions` ← `src/main/ipc/todoist.ts` (import :8, call :107)
- (doc-only mentions in `scheduling/propose.ts` and `learning/sources/approval.ts` are in
  comments — `stripComments` removes them, so they will NOT register as callers.)

**The allow-list idiom to copy** (`single-entitlement-gate-site.test.ts:39, 77-94`):
```typescript
const ALLOWED_CALLERS = new Set([...].map((s) => abs(s.file)));
// ... walk, strip comments, for each file: if RE matches && !ALLOWED_CALLERS.has(norm) → offender
expect(offenders, `… called outside the allowed sites: ${offenders.join(', ')}`).toEqual([]);
```
Fail-closed against ANY rogue caller (voice or otherwise) from day one. Discretion: regex
form and whether D-09a folds here or into the named spec.

---

### Gate unit/integration test — SC2 (NEW, failing-then-passing, D-12)

**Analog:** existing gate behavior in `gate.ts:41-100`; standard vitest unit test against an
in-memory DB seeded with an `approval` row.

- **Failing case:** a `ready→approved` row with a forced category (or `severity='high'`) AND
  `approval_path='voice-explicit'` → `assertApproved` throws `ApprovalGateError` with code
  **`voice-forbidden-forced`** (assert the SPECIFIC code per `<specifics>`).
- **Passing case (after branch lands):** a low/med, non-forced row with
  `approval_path='voice-explicit'` → `assertApproved` returns without throwing.
- This test REQUIRES the migration-widened CHECK to even insert the voice row (D-03) — seed
  through `insertApproval` then `voiceConfirm`, or a direct INSERT against the version-134 DB.

---

### SC4 integration test (NEW — same transition + unchanged adapter, D-12)

**Analog:** `send.ts:140-146` — the unified send adapter's first two lines are the unchanged
enforcement target:
```typescript
export async function sendApprovedEmail(db, approvalId, deps = {}): Promise<SendResult> {
  await assertEntitled(db, 'email_send');
  assertApproved(db, approvalId);   // ← SC4 asserts THIS runs unchanged after voiceConfirm
  // ...
}
```
Flow: seed a `ready` email_send row → `voiceConfirm(db, id)` → `sendApprovedEmail(db, id, deps)`
and assert `assertApproved` runs verbatim (a forced row staged via voice is rejected here too).
Use the `deps`-injection seam (`SendApprovedDeps`, `deps.buildGmailClient`) to avoid a real
Gmail call — the same injection the existing send tests use.

---

### `.planning/research/ARCHITECTURE.md` (MODIFIED docs — D-13 corpus correction)

**Stale lines to correct** from `'explicit'` to `'voice-explicit'` (reconcile-via-addendum,
the established "spec vs codebase reality" loop):
- **Line 122:** `confirm.ts … turns a spoken "yes, send it" into the exact same approval row
  transition (state→approved, approval_path='explicit')` → must say `'voice-explicit'`.
- **Line 306:** `→ state='approved', approval_path='explicit'` → `'voice-explicit'`.
- **Lines 314-316:** the "Non-negotiables" bullet **"Voice-confirm produces
  `approval_path='explicit'` … A voice 'yes' is a first-class explicit approval"** directly
  contradicts SC2 (a forced-category voice confirm MUST be rejectable, which requires a
  distinguishable path value). Rewrite to the `'voice-explicit'` design: voice confirm
  produces `'voice-explicit'`, which clears the gate for low/med but is REJECTED for
  forced/high by the new `voice-forbidden-forced` branch.
- ROADMAP.md, research/SUMMARY.md (§73), research/PITFALLS.md (§§23-30) are AUTHORITATIVE and
  already specify `'voice-explicit'`; ARCHITECTURE.md is the lone outlier.

---

## Shared Patterns

### Named, typed error codes on the gate
**Source:** `src/main/approvals/gate.ts:21-33`
**Apply to:** D-02 branch.
```typescript
export type ApprovalGateErrorCode = 'not-found' | 'not-approved' | 'forced-explicit-missing';
export class ApprovalGateError extends Error {
  readonly code: ApprovalGateErrorCode;
  constructor(code: ApprovalGateErrorCode, message: string) { super(message); this.name = 'ApprovalGateError'; this.code = code; }
}
```
Voice adds `'voice-forbidden-forced'` to the union and throws it from the named branch.

### Static-ratchet machinery (walk + stripComments + ALLOWED set + offenders === [])
**Source:** `tests/static/single-calendar-write-site.test.ts:33-71`,
`single-entitlement-gate-site.test.ts:39-94`, `phase12-bans.spec.ts:36-72`
**Apply to:** both D-08 specs.
- `ROOT = path.resolve(__dirname, '../..', 'src', 'main')`; recursive `walk` skipping
  `node_modules`/dotfiles; `stripComments` removes block comments THEN line comments (order
  matters); normalize paths with `.replace(/\\/g, '/')` (Windows); assert
  `offenders` `.toEqual([])` with the offender list interpolated into the message; and a
  positive `expect(matches).toContain(ALLOWED…)` to prove the ratchet still matches the real
  site (guards against a regex that silently matches nothing).

### Single mutation primitive — `transitionTo` inside a transaction
**Source:** `src/main/approvals/persist.ts:211-239` + `state.ts:39-43` (`assertTransition`)
**Apply to:** `voiceConfirm`. Never write `approval.state`/`approval_path` via raw SQL —
always go through `transitionTo`, which validates the edge and patches only
`ALLOWED_PATCH_COLS`.

### Dormant-contract function (typed, fully tested, zero callers shipped)
**Source:** `src/main/approvals/persist.ts:281-316` (`writeSendLog`)
**Apply to:** `voiceConfirm` — ship the contract + unit tests this phase; first caller is
Phase 17.

### esbuild skips tsc → guards must be vitest static tests
**Source:** project memory (`reference_esbuild_skips_typecheck`) + every `tests/static/*`.
Build-time enforcement MUST be a vitest static spec, NOT a type-only construct. Run
`npm run typecheck` after editing `gate.ts`/`persist.ts`/`confirm.ts`.

---

## No Analog Found

None. Every Phase 14 file maps to a concrete in-repo analog. The phase is deliberately
designed as "extend an existing contract," so RESEARCH.md fallback patterns are not needed.

---

## Metadata

**Analog search scope:** `src/main/approvals/`, `src/main/integrations/`,
`src/main/db/migrations/`, `src/main/ipc/`, `tests/static/`, `.planning/research/`
**Files scanned:** ~15 read in full or in targeted ranges; grep across `src/main/**` and
`src/main/db/migrations/**`
**Pattern extraction date:** 2026-06-02
**Next free migration version:** 134 (last shipped: `133_research.sql`)
