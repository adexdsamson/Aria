---
phase: 21-digest-briefing-integration
reviewed: 2026-06-10T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/main/index.ts
  - src/main/ipc/briefing.ts
  - src/main/ipc/index.ts
  - src/main/lifecycle/pendingCatchup.ts
  - src/main/whatsapp/digest-cron.ts
  - src/renderer/features/briefing/BriefingScreen.tsx
  - src/shared/ipc-contract.ts
  - tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts
  - tests/unit/main/whatsapp/digest-cron.spec.ts
  - tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: partially_resolved
---

# Phase 21: Code Review Report

**Reviewed:** 2026-06-10
**Depth:** standard
**Files Reviewed:** 10
**Status:** partially_resolved

## Summary

Phase 21 wires the WhatsApp group digest cron (05:00) and enriches `BRIEFING_TODAY`
with a `whatsApp` discriminated-union section. The privacy invariant holds well:
`runBriefing`/`generate.ts` never reference WhatsApp content, enrichment is strictly
read-path (`briefing.ts` after `runBriefing` returns), the digest cron uses
`getLocalModel()` only, and the `src/main/whatsapp/**` no-frontier ratchet structurally
forbids any frontier import in `digest-cron.ts`. The seal-guard (`db===null` →
`pendingCatchup.add` + tray badge) is correctly mirrored from `retention.ts` on both the
cron tick and `runNow()`. Fire-and-forget error swallowing is generally disciplined
(`runDigest` never throws to caller, `void _dh.runNow()` resolves).

However, there is one **BLOCKER**: the multi-day watermark query in `runDigest` collapses
to the group's latest message timestamp because of a cartesian JOIN, which silently breaks
the daily digest after the first successful day. The unit tests cannot catch it (all run
single-day with a fresh DB). There are also several robustness/maintainability warnings
around stale-DB-handle capture, an over-eager fire-and-forget trigger for unlinked users,
and a handler-registration asymmetry that is correct today but fragile.

## Critical Issues

### CR-01: Watermark CTE collapses to group-wide MAX(sent_at) — daily digest breaks after day 1

**File:** `src/main/whatsapp/digest-cron.ts:176-194`
**Issue:** The incremental-window watermark is computed as:

```sql
WITH last_digest AS (
  SELECT MAX(m.sent_at) AS watermark
  FROM whatsapp_message m
  INNER JOIN whatsapp_group_digest d ON d.jid = m.jid
  WHERE d.jid = ? AND d.summary_text IS NOT NULL AND d.date < ?
)
```

The JOIN `whatsapp_message m … whatsapp_group_digest d ON d.jid = m.jid` is a cartesian
product of every message in the group × every prior digest row of the group. `MAX(m.sent_at)`
therefore returns the **latest message timestamp of the entire group**, not the cutoff of the
prior digest run. The intent (per the comment "Window = max(lastDigestWatermark, now − WINDOW_DAYS days)")
is to skip messages already summarized yesterday.

Effect: once a group has *any* non-NULL digest row dated before today, `watermark` = MAX message
timestamp, and the outer query filters `m.sent_at >= watermark` — selecting only the single newest
message (or zero). That falls below `MIN_ACTIVITY` (3), so the group is skipped, **no digest row is
written for today**, and the briefing WhatsApp section silently disappears from day 2 onward. It also
causes the `BRIEFING_TODAY` fire-and-forget (`briefing.ts:371`) to re-trigger `runNow()` on every
view because `row.whatsApp` stays undefined.

Why tests miss it: `digest-cron.spec.ts` always uses a fresh DB and runs `runNow()` on `today`; the
re-run test writes rows with `date = today`, and `d.date < ?` (today) excludes them, so the CTE returns
NULL and `COALESCE(..., windowStart)` masks the bug. The cross-day path is untested.

**Fix:** Derive the watermark from the prior digest run, not from message timestamps. Either store an
explicit `window_end` / use `generated_at`, or subquery the prior digest directly without joining
messages. For example:

```sql
WITH last_digest AS (
  SELECT MAX(d.date) AS last_date
  FROM whatsapp_group_digest d
  WHERE d.jid = ? AND d.summary_text IS NOT NULL AND d.date < ?
)
SELECT m.jid, m.body_text, m.sent_at, m.sender_jid
FROM whatsapp_message m
WHERE m.jid = ?
  AND m.sent_at >= COALESCE(
        (SELECT last_date || 'T00:00:00.000Z' FROM last_digest), ?)
  AND m.sent_at >= ?
ORDER BY m.sent_at ASC
LIMIT ${MAX_MESSAGES}
```

Add a multi-day regression test: seed a prior-day digest row + fresh messages dated today, run
`runNow()`, assert today's row is written non-NULL.

**Status:** Resolved (fix commit a30ac3d — corrected CTE; regression test commit 824e7d2)

## Warnings

### WR-01: Fire-and-forget `runNow()` triggers on every briefing view for unlinked / zero-group users

**File:** `src/main/ipc/briefing.ts:370-373`
**Issue:** The D-07.3 async fallback fires when `row.whatsApp === undefined`:

```js
const _dh = deps.getDigestHandle?.() ?? deps.digestHandle;
if (row.whatsApp === undefined && _dh) {
  void _dh.runNow();
}
```

`row.whatsApp` is `undefined` not only in the intended "linked but no digest row yet today" case, but
also when WhatsApp is **not linked at all** and when there are **zero tracked groups** (both return
`undefined` from `readWhatsAppDigests`). `BRIEFING_TODAY` is invoked on every BriefingScreen mount /
navigation, so users who never linked WhatsApp fire `runNow()` (→ `runDigest`) on every briefing view.
`runDigest` early-returns on zero tracked groups so it is cheap, but it spins up a `PQueue`, runs a DB
query, and (post-fix) could repeatedly hit Ollama. The intended trigger is specifically "linked + tracked
groups exist + no row for today."

**Fix:** Distinguish "omit because not applicable" from "omit because no row yet today." Have
`readWhatsAppDigests` signal the latter explicitly (e.g. return a sentinel or a separate boolean), and
only fire `runNow()` in that case:

```js
const { payload: wa, shouldGenerate } = readWhatsAppDigests(db, date, logger);
if (wa !== undefined) row.whatsApp = wa;
if (shouldGenerate && _dh) void _dh.runNow();
```

**Status:** Resolved (fix commit e81bfc6)

### WR-02: Digest handle captures `deps.db` while seal-guard reads `deps.dbHolder.db` — diverges after backup-restore

**File:** `src/main/whatsapp/digest-cron.ts:269-299` and `src/main/index.ts:602-645`
**Issue:** `startWhatsAppDigest` is called once in `bootPoll` with `db: dbHolder.db!` captured at unlock,
guarded by the one-shot `lifecycleBooted` flag. The seal-guard checks `deps.dbHolder?.db` for null, but
`runDigest(deps)` then operates on `deps.db` — the connection captured at first unlock. `ONBOARDING_LOCK`
leaves the handle open (so the lock path is fine), but `BACKUP_RESTORE` calls `closeDb(db)` and reopens a
new connection into `dbHolder`. After a restore, `dbHolder.db` is the fresh handle (passes the null
seal-guard) while `runDigest` writes through `deps.db`, a closed connection → throws inside `runDigest`'s
outer catch and silently logs `runDigest outer error`. The digest then never runs for the rest of the
session.

**Fix:** Read the live DB from the holder at run time instead of capturing it. Have `runDigest` resolve
`const db = deps.dbHolder?.db ?? deps.db;` after the seal-guard, mirroring the late-binding pattern used
elsewhere (e.g. `closeToTrayReader`, `getDigestHandle`). `retention.ts` shares the same latent issue but
is out of scope for this phase.

**Status:** Resolved (fix commit b8fc3a9)

### WR-03: `INSERT OR REPLACE` on the NULL-failure path writes `generated_at = null, model_id = null`

**File:** `src/main/whatsapp/digest-cron.ts:226-230`
**Issue:** On the Ollama-down path the failure row is written with `(jid, today, null, null, null)` —
`generated_at` and `model_id` both NULL. The success path writes `Date.now()` and `DEFAULT_LOCAL_MODEL`.
A NULL `generated_at` discards the attempt timestamp, so there is no record of *when* the failed attempt
happened — which the missed-tick catch-up (`index.ts:653-670`) and any future "last attempted at" UX
cannot use. The `whatsapp_group_digest.generated_at` column is declared but rendered useless for failures.

**Fix:** Record the attempt time even on failure:

```js
.run(jid, today, null, Date.now(), null);
```

### WR-04: `WHATSAPP_GENERATE_DIGEST_NOW` registered only via the pre-unlock briefing path — fragile and undocumented

**File:** `src/main/ipc/briefing.ts:509-516`, `src/main/ipc/index.ts:283-295`
**Issue:** `registerBriefingHandlers` registers `WHATSAPP_GENERATE_DIGEST_NOW`, but that channel is *not*
in the `briefingChannels` array used to gate/mark registration (`index.ts:283-291`), nor in
`WHATSAPP_CHANNELS` (so it is not removed/re-registered in `bootPoll`). It works today only because
`registerBriefingHandlers` runs exactly once (pre-unlock) with the late-binding `getDigestHandle` getter,
and the handler-count test passes since the channel is registered exactly once. But the registration is
silently decoupled from the `briefingChannels` skip-set: if anyone adds `WHATSAPP_GENERATE_DIGEST_NOW`
to a removeHandler loop or re-runs `registerBriefingHandlers` post-unlock (the established remove-then-
re-register pattern everywhere else in this file), `ipcMain.handle` will throw on the second registration
(the documented Aria double-register crash, see MEMORY: "Electron ipcMain.handle throws on 2nd register").
The channel is also absent from the `briefingChannels` documentation comment.

**Fix:** Add `CHANNELS.WHATSAPP_GENERATE_DIGEST_NOW` to the `briefingChannels` array in `index.ts` so the
skip-set, handler-count accounting, and any future re-registration loop treat it consistently with the
other briefing channels, and document that it is owned by `registerBriefingHandlers`.

### WR-05: `isPayload` type guard rejects valid WhatsApp-only briefings via brittle key-shape check

**File:** `src/renderer/features/briefing/BriefingScreen.tsx:228-236`
**Issue:** `isPayload` asserts a `BriefingPayload` via `'date' in v && 'sections' in v === false && 'calendar' in v`.
This relies on operator precedence (`'sections' in (v) === false` parses as `'sections' in v === false`,
i.e. `('sections' in v) === false`) which happens to be correct here but is unreadable and a refactor
hazard. More importantly, it hard-requires a `calendar` key. `BriefingPayload.calendar` is non-optional in
the contract so this holds, but the guard silently treats any payload missing `calendar` as an error and
calls `setPayload(null)` — masking a real backend/contract drift as an empty state rather than surfacing it.

**Fix:** Make the precedence explicit and validate on a stable discriminator instead of structural keys:

```js
function isPayload(v: unknown): v is BriefingPayload {
  return !!v && typeof v === 'object'
    && 'date' in v && 'route' in v && !('error' in v);
}
```

## Info

### IN-01: Group prompt sends raw `sender_jid` (phone-number-bearing JID) to the local model

**File:** `src/main/whatsapp/digest-cron.ts:109`
**Issue:** `buildGroupPrompt` emits `${m.sender_jid}: ${m.body_text}` — the sender JID (which embeds the
phone number local-part) is included in the prompt. This stays on the local model (privacy invariant holds),
but JIDs are noisier and less useful than display names for an executive summary, and embedding phone
parts in prompt text is a mild data-hygiene smell even locally.
**Fix:** Map `sender_jid` to a group-member display name where available, or strip to a stable
pseudonym/local-part-hash before composing the prompt.

### IN-02: `MAX_MESSAGES` cap silently truncates the *oldest* messages in a busy window

**File:** `src/main/whatsapp/digest-cron.ts:191-192`
**Issue:** `ORDER BY m.sent_at ASC LIMIT 150` keeps the 150 *oldest* messages in the window and drops the
newest when a group exceeds the cap — the opposite of what a "morning briefing of what happened" usually
wants (most recent context). Combined with CR-01 this is currently moot, but after the watermark fix a busy
group would summarize stale messages and ignore the latest.
**Fix:** Select the newest N (`ORDER BY sent_at DESC LIMIT 150`) then re-sort ASC for the prompt, or
document that oldest-first truncation is intentional.

### IN-03: `parseDigestSections` keeps literal `(nothing to report)` body text in rendered sections

**File:** `src/renderer/features/briefing/BriefingScreen.tsx:56-88`, rendered at `872-959`
**Issue:** The system prompt instructs the model to write `(nothing to report)` under empty headers. The
parser preserves that text, so the UI renders e.g. `Decisions: (nothing to report)` instead of omitting the
sub-section. The empty-string omission guards (`{sections.decisions && …}`) only fire when the model emits a
truly empty body, not the instructed placeholder.
**Fix:** Treat a body that trims to `(nothing to report)` as empty in `parseDigestSections` (or filter it at
render) so empty sections collapse cleanly.

### IN-04: Hardcoded footer copy "Briefing generated 07:00" ignores the user's configured time

**File:** `src/renderer/features/briefing/BriefingScreen.tsx:998`
**Issue:** The editorial footer hardcodes `Briefing generated 07:00 ·` even though briefing time is
user-configurable (`BRIEFING_SET_SETTINGS`, default `07:00`). Users who set a different hour see a wrong
timestamp. Pre-existing (not introduced this phase) but adjacent to the reviewed change.
**Fix:** Render from `payload.generatedAt` / the configured time rather than a literal.

---

_Reviewed: 2026-06-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
