---
phase: 21-digest-briefing-integration
verified: 2026-06-10T14:40:00Z
status: human_needed
score: 15/15
overrides_applied: 0
human_verification:
  - test: "Morning WhatsApp section visible in daily briefing after 05:00 with a linked account"
    expected: "BriefingScreen shows a 'WhatsApp' SectionHead with per-group summaries (key points, decisions, etc.) for each tracked group that had >= 3 messages since the last digest"
    why_human: "Requires a live WhatsApp-linked account, Ollama running, and waiting for the 05:00 cron (or clicking Retry) — cannot exercise the full round-trip in a unit test"
  - test: "Ollama-offline degradation: briefing renders 'Digest unavailable' note when Ollama is down at 05:00"
    expected: "payload.whatsApp.state==='unavailable', copy reads exactly 'Digest unavailable — the local model was offline this morning. Aria will retry tonight.', retry button is visible"
    why_human: "Requires killing Ollama, waiting for 05:00 cron, then opening briefing — full E2E path"
  - test: "'Retry digest now' button re-triggers the local digest (no frontier call)"
    expected: "Clicking the retry button fires whatsappGenerateDigestNow IPC, Ollama is called (local only), briefing updates after a short delay"
    why_human: "Runtime IPC + Ollama call path; cannot be verified without a running app and Ollama sidecar"
  - test: "Device was asleep at 05:00 — digest runs on next wake-from-sleep"
    expected: "Suspending the device past 05:00, resuming, then opening the briefing shows the WhatsApp section generated post-wake (D-07.2 powerMonitor hook)"
    why_human: "Requires real sleep/resume cycle via powerMonitor.ts — no test harness for OS power events"
---

# Phase 21: Digest + Briefing Integration — Verification Report

**Phase Goal:** Each morning, before the daily briefing runs, Aria summarizes the activity in every tracked WhatsApp group using the local model only and inserts a WhatsApp section into that day's briefing — degrading gracefully if Ollama is unavailable, and never touching a frontier API.

**Verified:** 2026-06-10T14:40:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Digest cron starts at app boot (05:00) using local model only | VERIFIED | `startWhatsAppDigest` imported and called at `src/main/index.ts:83,640`; `_digestHandle` module-scope variable at line 172; cron `'0 5 * * *'` in `digest-cron.ts:47` |
| 2 | Per-group summaries written to `whatsapp_group_digest` via local model only — no frontier path | VERIFIED | `digest-cron.ts` imports `getLocalModel` (not `getFrontierModel`); no `@ai-sdk/{anthropic,openai,google}` import; `no-frontier.ratchet.spec.ts` 4/4 PASS |
| 3 | WhatsApp content never enters `runBriefing`/`generate.ts` — enrichment is read-path only, post-frontier | VERIFIED | `BRIEFING_TODAY` calls `readBriefing` (read-path, line 351) then enriches with `readWhatsAppDigests` (line 379) AFTER; `src/main/briefing/generate.ts` has zero WhatsApp references |
| 4 | Ollama-offline degrades gracefully: NULL digest row written, briefing returns `state:'unavailable'` | VERIFIED | `digest-cron.ts:238-249` catches `generateText` throw and writes NULL row; `readWhatsAppDigests` returns `{state:'unavailable',reason:'model-offline'}` when all rows are NULL; `briefing-whatsapp-enrichment.spec.ts` test 4 PASS |
| 5 | Briefing never throws when WhatsApp enrichment fails (D-07.3/WA-10) | VERIFIED | `briefing.ts:378-396` wraps enrichment in try/catch; `briefing-whatsapp-enrichment.spec.ts` test 6 PASS |
| 6 | BriefingScreen renders 'briefing-whatsapp' section for `state:'ready'` | VERIFIED | `BriefingScreen.tsx:872-892` renders `data-testid="briefing-whatsapp"`; `BriefingScreen.spec.tsx` Phase 21 case 1 PASS |
| 7 | BriefingScreen renders unavailable note + retry button for `state:'unavailable'` | VERIFIED | `BriefingScreen.tsx:862-869` renders `data-testid="briefing-whatsapp-unavailable"`; exact copy "local model was offline this morning" at line 866; retry button at line 147 with `data-testid="briefing-whatsapp-retry"` |
| 8 | Retry affordance calls `whatsappGenerateDigestNow` IPC, NOT `briefingGenerateNow` | VERIFIED | `BriefingScreen.tsx:107` calls `window.aria.whatsappGenerateDigestNow()`; this maps to `CHANNELS.WHATSAPP_GENERATE_DIGEST_NOW` via `CHANNEL_METHODS` in preload auto-map |
| 9 | WhatsApp section absent from DOM when `payload.whatsApp` is undefined | VERIFIED | JSX guards: `payload.whatsApp?.state === 'unavailable'` and `payload.whatsApp?.state === 'ready'` — neither renders without a defined state; `BriefingScreen.spec.tsx` Phase 21 case 3 PASS |
| 10 | `CatchupChannel` includes `'whatsapp-digest'` for unlock-drain dispatch | VERIFIED | `pendingCatchup.ts:22`: `\| 'whatsapp-digest'` present |
| 11 | `runChannelOnce` has a real `'whatsapp-digest'` case (not a no-op stub) | VERIFIED | `index.ts:925-927`: switch `case 'whatsapp-digest': if (_digestHandle) await _digestHandle.runNow(); break;` |
| 12 | powerMonitor `onResume` fires digest when `MAX(date) < today` (D-07.2 missed-tick) | VERIFIED | `index.ts:653-669`: `registerLifecycleCallbacks({ onResume })` with `MAX(date) AS maxDate` guard at line 661-663 |
| 13 | `INSERT OR REPLACE` (not `INSERT OR IGNORE`) enables retry overwrite of NULL rows | VERIFIED | `digest-cron.ts:234,246`: both success and failure paths use `INSERT OR REPLACE` |
| 14 | Watermark CTE uses `MAX(d.date)` from prior digest rows — not `MAX(m.sent_at)` (CR-01 fix) | VERIFIED | `digest-cron.ts:197-212`: `WITH last_digest AS (SELECT MAX(d.date) AS last_date FROM whatsapp_group_digest d WHERE ...)` — no join with `whatsapp_message`; multi-day regression test in `digest-cron.spec.ts:228` PASS (6/6) |
| 15 | WR-01 fire-and-forget only fires for "linked + tracked + no row today" — not for unlinked users | VERIFIED | `briefing.ts:185-191`: `readWhatsAppDigests` returns `{shouldGenerate:false}` when not linked (line 144) or zero groups (line 151); returns `{shouldGenerate:true}` only when all groups are no-activity (line 191); enrichment block at line 389 gates on `shouldGenerate` |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/whatsapp/digest-cron.ts` | 05:00 WhatsApp digest cron — local model per-group summarization | VERIFIED | Exists (322 lines); exports `startWhatsAppDigest`, `WhatsAppDigestHandle`, `WhatsAppDigestDeps`; uses `getLocalModel`; `0 5 * * *`; `pendingCatchup.add`; `INSERT OR REPLACE`; CR-01 corrected CTE |
| `src/main/lifecycle/pendingCatchup.ts` | Extended CatchupChannel union with `'whatsapp-digest'` | VERIFIED | Line 22: `\| 'whatsapp-digest'` present |
| `src/shared/ipc-contract.ts` | `BriefingPayload.whatsApp?` union, `WhatsAppGroupSummaryDto`, `WHATSAPP_GENERATE_DIGEST_NOW` channel | VERIFIED | `whatsApp?` at line 570; `WhatsAppGroupSummaryDto` at line 1781; `WHATSAPP_GENERATE_DIGEST_NOW` at line 217 (CHANNELS) and 1615 (CHANNEL_METHODS); `whatsappGenerateDigestNow` in AriaApi at line 1150 |
| `src/main/ipc/briefing.ts` | `readWhatsAppDigests` helper, `row.whatsApp` enrichment, `WHATSAPP_GENERATE_DIGEST_NOW` handler | VERIFIED | `readWhatsAppDigests` defined at line 131 with "read-only, no model" annotation; `row.whatsApp` set at line 380; `WHATSAPP_GENERATE_DIGEST_NOW` handler at line 527; D-10 state matrix fully implemented |
| `src/renderer/features/briefing/BriefingScreen.tsx` | WhatsApp section render switch with correct test IDs | VERIFIED | `briefing-whatsapp` at line 873; `briefing-whatsapp-unavailable` at line 863; `briefing-whatsapp-retry` at line 147; exact degraded copy at line 866 |
| `src/main/index.ts` | `_digestHandle` bootstrap + `runChannelOnce` switch + `onResume` hook | VERIFIED | Import at line 83; `let _digestHandle` at line 172; `startWhatsAppDigest` call at line 640; `runChannelOnce` switch at line 925; `onResume` at line 653; `getDigestHandle` getter at line 408 |
| `tests/unit/main/whatsapp/digest-cron.spec.ts` | 6 tests (5 plan + 1 CR-01 regression) | VERIFIED | 6 tests, all PASS; includes multi-day regression test at line 228 |
| `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` | 6 tests covering D-10 state matrix | VERIFIED | 6 tests, all PASS; covers not-linked, zero-groups, summarized, unavailable, degraded-connection, never-throws |
| `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` | 3 new Phase 21 cases appended | VERIFIED | 15 total tests PASS (12 pre-existing + 3 new Phase 21 cases at lines 247, 267, 278) |
| `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | SC3 ratchet passes — no frontier imports in `src/main/whatsapp/**` | VERIFIED | 4/4 PASS; `digest-cron.ts` imports only `getLocalModel` (no `getFrontierModel`, no `@ai-sdk/*`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `digest-cron.ts (startWhatsAppDigest)` | `index.ts (_digestHandle)` | import + assignment in bootPoll | VERIFIED | `index.ts:83` import; `index.ts:640` assignment |
| `index.ts (_digestHandle)` | `runChannelOnce 'whatsapp-digest' case` | module-scope variable | VERIFIED | `index.ts:926-927`: `if (_digestHandle) await _digestHandle.runNow()` |
| `index.ts (getDigestHandle getter)` | `briefing.ts (D-07.3 + WHATSAPP_GENERATE_DIGEST_NOW)` | `IpcDeps.getDigestHandle → BriefingHandlerDeps.getDigestHandle` | VERIFIED | `index.ts:408`; `ipc/index.ts:293`; `briefing.ts:388,528` |
| `briefing.ts (readWhatsAppDigests)` | `ipc-contract.ts (BriefingPayload.whatsApp)` | TypeScript type assignment `row.whatsApp = wa` | VERIFIED | `briefing.ts:380`; compiles with `ipc-contract.ts` union |
| `BriefingScreen.tsx (retry button)` | `preload auto-map → WHATSAPP_GENERATE_DIGEST_NOW handler` | `window.aria.whatsappGenerateDigestNow()` via `CHANNEL_METHODS` | VERIFIED | `BriefingScreen.tsx:107`; `CHANNEL_METHODS[WHATSAPP_GENERATE_DIGEST_NOW]='whatsappGenerateDigestNow'`; preload uses `CHANNEL_METHODS` to auto-expose all channels |
| `pendingCatchup drain (unlock)` | `runChannelOnce → _digestHandle.runNow()` | `registerOnUnlock` drain loop | VERIFIED | `index.ts:790-806` drain loop; `runChannelOnce:925` switch |
| `powerMonitor onResume` | `_digestHandle.runNow()` | `registerLifecycleCallbacks` callback in bootPoll | VERIFIED | `index.ts:653-669` |
| `digest-cron.ts (CRON_KEY)` | `pendingCatchup.ts ('whatsapp-digest' union)` | string literal union | VERIFIED | Both use `'whatsapp-digest'`; `pendingCatchup.ts:22`; `digest-cron.ts:45` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `BriefingScreen.tsx` | `payload.whatsApp` | `BRIEFING_TODAY` IPC → `readWhatsAppDigests(db, date, logger)` → `whatsapp_group_digest` table | Yes — queries `provider_account`, `whatsapp_group`, `whatsapp_group_digest` tables via prepared statements | FLOWING |
| `BriefingScreen.tsx (retry)` | N/A — fire-and-forget | `whatsappGenerateDigestNow` IPC → `_digestHandle.runNow()` → `runDigest()` → Ollama `generateText` | Yes — triggers real DB write via `INSERT OR REPLACE` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| digest-cron.spec.ts — 6 tests (WA-08/WA-10/D-06/D-07.1/D-09/CR-01) | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts` | 6 passed (6) | PASS |
| no-frontier ratchet — SC3 local-only enforcement | `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | 4 passed (4) | PASS |
| briefing-whatsapp-enrichment.spec.ts — 6 tests (D-10 state matrix) | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` | 6 passed (6) | PASS |
| BriefingScreen.spec.tsx — 15 tests (12 pre-existing + 3 Phase 21) | `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` | 15 passed (15) | PASS |
| briefing-regenerate.spec.ts pre-existing failure (baseline) | `npx vitest run tests/unit/main/ipc/briefing-regenerate.spec.ts` | 1 failed / 1 passed (2) — entitlement bootstrap gate, confirmed pre-existing | SKIP (pre-existing, not Phase 21) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WA-08 | 21-01, 21-02, 21-03, 21-04, 21-05, 21-06 | Daily briefing includes WhatsApp section summarizing tracked group activity | SATISFIED | `digest-cron.ts` 05:00 cron generates summaries; `briefing.ts` enriches BRIEFING_TODAY payload; `BriefingScreen.tsx` renders the section |
| WA-09 | 21-03, 21-06 | WhatsApp content summarized using local model only — enforced by static ratchet | SATISFIED | `digest-cron.ts` imports only `getLocalModel`; `no-frontier.ratchet.spec.ts` PASS; file lives under `src/main/whatsapp/` (ratchet scope by construction) |
| WA-10 | 21-03, 21-04, 21-05 | Ollama unavailable — briefing still generates; WhatsApp section degrades gracefully | SATISFIED | NULL row written on `generateText` throw; `readWhatsAppDigests` returns `state:'unavailable'`; `BriefingScreen.tsx` renders degraded copy + retry button; BRIEFING_TODAY never throws on enrichment failure |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/whatsapp/digest-cron.ts` | 249 | `generated_at=null` on Ollama-failure path (WR-03 from REVIEW.md — unresolved) | WARNING | Lost attempt timestamp on failure; no "last attempted at" UX; idempotency unaffected since INSERT OR REPLACE still works; future "why hasn't digest run?" diagnostics will lack timing data |
| `src/main/ipc/index.ts` | 283-294 | `WHATSAPP_GENERATE_DIGEST_NOW` absent from `briefingChannels` skip-set (WR-04 from REVIEW.md — unresolved) | WARNING | Currently correct (handler registered exactly once, pre-unlock, via `registerBriefingHandlers`). Fragile: if anyone adds this channel to a future `removeHandler` loop, Electron will throw on double-register. Not a current bug — a future maintenance trap |
| `src/renderer/features/briefing/BriefingScreen.tsx` | 228-236 | `isPayload` type guard uses brittle `'calendar' in v` check (WR-05 from REVIEW.md — pre-existing) | INFO | Pre-existing before Phase 21; not introduced by this phase; any payload missing `calendar` silently becomes null state |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 21 files.

### Human Verification Required

#### 1. Morning WhatsApp digest renders in live briefing

**Test:** Link a WhatsApp account, select at least one group to track. Wait for or simulate the 05:00 cron (or use the `runNow()` path via an existing test helper). Open the briefing for today.
**Expected:** A "WhatsApp" section appears in the briefing with per-group sub-headings showing key points, decisions, open questions, and mentions drawn from group activity.
**Why human:** Full round-trip requires a live WhatsApp-linked account, tracked groups with messages, Ollama running with a local model, and the 05:00 cron or manual trigger — not reproducible in unit tests.

#### 2. Ollama-offline degradation visible in UI

**Test:** Stop Ollama. Wait for (or trigger) the 05:00 digest cron. Open the briefing.
**Expected:** The WhatsApp section shows "Digest unavailable — the local model was offline this morning. Aria will retry tonight." with a "Retry digest now" button. No error thrown; the rest of the briefing (email, calendar, news) is unaffected.
**Why human:** Requires stopping Ollama mid-session and triggering the digest — not mockable at the app integration level.

#### 3. Retry button re-runs digest locally

**Test:** From the unavailable state (step 2), click "Retry digest now" with Ollama running again.
**Expected:** Button shows "Generating…" then resolves. Re-fetching the briefing (via the existing regenerate flow or navigation) shows the WhatsApp section populated. No frontier API call is made.
**Why human:** Requires live app + Ollama; cannot verify IPC round-trip + re-render in a unit test.

#### 4. Missed-tick catch-up on device wake

**Test:** Suspend the device before 05:00, resume after 05:00 with the app running.
**Expected:** `onResume` hook fires, `MAX(date) < today` check passes, `_digestHandle.runNow()` is called, and the digest is generated post-wake. Opening the briefing shows the WhatsApp section.
**Why human:** Requires a real OS sleep/resume cycle; powerMonitor callbacks cannot be exercised in unit tests.

### Warnings Summary

Two unresolved warnings from 21-REVIEW.md:

**WR-03** (`digest-cron.ts:249`) — Failure path writes `generated_at=null`. This is a data quality issue: the attempt timestamp is lost on Ollama-down runs, making future "last attempted at" diagnostics impossible. The phase goal (graceful degradation) is met; this is a quality gap for future tooling. Suggested fix: change `.run(jid, today, null, null, null)` to `.run(jid, today, null, Date.now(), null)`.

**WR-04** (`ipc/index.ts:283-294`) — `WHATSAPP_GENERATE_DIGEST_NOW` not in `briefingChannels` skip-set. Currently safe because `registerBriefingHandlers` is called exactly once. Risk: if a future developer adds this channel to a removeHandler/re-register loop, it will trigger the Electron double-register crash (well-documented in MEMORY). Suggested fix: add `CHANNELS.WHATSAPP_GENERATE_DIGEST_NOW` to `briefingChannels` array in `ipc/index.ts:283`.

Both warnings are low-risk to current functionality. The phase goal is achieved. These are recommended follow-up fixes, not blockers.

---

_Verified: 2026-06-10T14:40:00Z_
_Verifier: Claude (gsd-verifier)_
