---
phase: 20-foundation
verified: 2026-06-10T07:00:00Z
status: human_needed
score: 9/9
overrides_applied: 0
human_verification:
  - test: "QR link with a real secondary phone — consent modal gate, QR render, AccountRow chip shows 'connected' + phone number, no-history notice"
    expected: "Steps 2–3 of 20-08-VERIFICATION.md all pass"
    why_human: "Requires a live Baileys handshake with WhatsApp servers and a physical phone; cannot run in CI"
  - test: "Privacy spot-check — tracked group ingest, untracked group blocked, 1:1 DM blocked"
    expected: "Step 4 of 20-08-VERIFICATION.md: tracked row appears within 60 s, untracked and DM produce zero rows"
    why_human: "Requires a live WhatsApp session and a second phone to send test messages"
  - test: "Disconnect cascade end-to-end — AccountRow disappears, all four whatsapp_* tables zero out"
    expected: "Step 6 of 20-08-VERIFICATION.md all pass"
    why_human: "Requires a live linked session; only the in-process disconnect spec is automated"
  - test: "Other surfaces (Briefing, Email, Calendar, Tasks) remain fully functional while WhatsApp is connected and after it degrades"
    expected: "Step 5 of 20-08-VERIFICATION.md all pass"
    why_human: "Requires the full running app to navigate between screens"
---

# Phase 20: Foundation — Verification Report

**Phase Goal:** The user can link their WhatsApp account to Aria, select which groups to track, and have those groups' text messages silently ingested to the local encrypted database — with every load-bearing safety guard in place before the first message is stored.

**Verified:** 2026-06-10T07:00:00Z
**Status:** human_needed (9/9 automated truths VERIFIED; live-UAT checklist in 20-08-VERIFICATION.md pending)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth (from Success Criteria) | Req | Status | Evidence |
|---|-------------------------------|-----|--------|----------|
| 1 | User sees explicit ban-risk disclosure with ack checkbox; QR does not render until ack | WA-01/02 | VERIFIED | `WhatsAppConsentModal.tsx:215-222` — `disabled={!acknowledged}` on "Show QR code" button; 4 ban-risk bullets + emphasized secondary-number callout with rose border (`line 166-190`) |
| 2 | User can scan QR, see "connected" AccountRow with phone number, and see no-history notice | WA-01 | VERIFIED | `WhatsAppQrModal.tsx:57-62` subscribes to `WHATSAPP_STATE_CHANGED`; on `status='ok'` shows JID and "No WhatsApp history before this moment" notice (`line 221-224`). QR data-URL rendered at `line 229-241`. Spec: `whatsapp-session.spec.ts` 4/4 GREEN. | PENDING-HUMAN: live phone scan not yet run (see 20-08 Step 3) |
| 3 | User can open group-picker, toggle groups tracked/untracked; untracked and DM messages never written | WA-05/06 | VERIFIED | `WhatsAppGroupPickerModal.tsx:40-58` calls `WHATSAPP_LIST_GROUPS`; toggle fires `WHATSAPP_SET_TRACKED`. Ingest filter: `ingest.ts:154-155` drops non-`@g.us` JIDs; `line 157` drops untracked. Spec: `ingest-privacy.spec.ts` 8/8 GREEN |
| 4 | Disconnecting tears down socket + deletes all WhatsApp rows via CASCADE | WA-04 | VERIFIED | `provider-accounts.ts:57-74` — `manager.stop()` then `DELETE whatsapp_auth_state` + `DELETE whatsapp_group` (CASCADE removes messages + digests) + `DELETE provider_account`. Migration 138 `line 188` restores `foreign_keys=ON`. Spec: `whatsapp-disconnect.spec.ts` 6/6 GREEN |
| 5 | Connection status badge updates on session events; degraded WhatsApp leaves other surfaces functional | WA-03/12 | VERIFIED | `session-manager.ts:467-484,525-534` pushes `WHATSAPP_STATE_CHANGED` on all state transitions. `AccountRow.tsx:109-116` maps chip colors per status. `whatsapp-degradable.spec.ts` 8/8 GREEN (boot-safe + SyncOrchestrator exclusion) |
| 6 | Passive posture: `markOnlineOnConnect:false`, `emitOwnEvents:false`, `syncFullHistory:false`, only `sendPresenceUpdate('unavailable')` | WA-02/11 | VERIFIED | `session-manager.ts:373-376` — all three flags in `makeWASocket` config. `passive-posture.ratchet.spec.ts` 8/8 GREEN (sendMessage/sendReceipt/readMessages/non-unavailable-presence banned + config flags asserted) |
| 7 | Text-only ingest: media/non-text dropped at extractText null path | WA-07 | VERIFIED | `retention.ts:58-86` — `extractText()` returns null for `imageMessage`, `audioMessage`, `videoMessage`, `documentMessage`, `stickerMessage` regardless of caption. `ingest.ts:160` short-circuits on `text == null`. Tested implicitly in `ingest-privacy.spec.ts` |
| 8 | No frontier model imports in `src/main/whatsapp/` (no-frontier ratchet load-bearing) | WA-11 | VERIFIED | `no-frontier.ratchet.spec.ts` 4/4 GREEN — no `getFrontierModel`, `getFrontierKey`, or `@ai-sdk/*` imports found across all `.ts` files in the whatsapp directory |
| 9 | Socket startup throw caught in `start()`; WhatsApp never blocks boot | WA-12 | VERIFIED | `session-manager.ts:299-309` — `try { await openSocket() } catch(err) { ... updateProviderAccountStatus(null,'degraded') }`. `whatsapp-degradable.spec.ts` 8/8 GREEN (5 start-failure assertions including idempotency) |

**Score:** 9/9 truths verified (automated). 4 items pending live-UAT (see Human Verification section).

---

### Deferred Items

None. All Phase 20 requirements are addressed in this phase.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/whatsapp/session-manager.ts` | Baileys socket + passive posture + QR push + reconnect | VERIFIED | 673 lines; `wireCapture()` calls `registerGroupSync` + `registerIngest` inside `openSocket()` at line 331, re-attaches on every reconnect/recycle |
| `src/main/whatsapp/auth-state.ts` | SQLCipher-backed Signal key store; Gate 4 transaction | VERIFIED | `makeSQLiteSignalKeyStore` with `db.transaction()` in `set()` |
| `src/main/whatsapp/ingest.ts` | 3-line privacy filter + batch flush | VERIFIED | Lines 145-168: `type!='notify'` → `!@g.us` → `!isTracked` → `extractText==null`. Batch via `scheduler.queue.add` |
| `src/main/whatsapp/group-sync.ts` | `groups.upsert` handler; tracked=0 default | VERIFIED | Line 77-98: `ON CONFLICT DO UPDATE` never sets `tracked`; schema DEFAULT 0 preserved |
| `src/main/whatsapp/retention.ts` | 30-day rolling DELETE; `extractText()` exported | VERIFIED | `runSweep` deletes `WHERE sent_at < ?` (30d cutoff). `extractText` exported at line 58 |
| `src/main/db/migrations/138_whatsapp.sql` | 4 tables + `legacy_alter_table=ON` + `foreign_keys=ON` at end | VERIFIED | Lines 22-188: `PRAGMA legacy_alter_table=ON` wraps RENAME; `PRAGMA foreign_keys=ON` at line 188. FK CASCADE on `whatsapp_message` and `whatsapp_group_digest` |
| `src/main/db/migrations/embedded.ts` | Migration 138 entry present | VERIFIED | Lines 1818-1821 — version 138, file `138_whatsapp.sql`, full SQL embedded |
| `src/main/ipc/whatsapp.ts` | 5 invoke handlers + `WHATSAPP_CHANNELS` const array | VERIFIED | Lines 40-46: `WHATSAPP_CHANNELS` as const with all 5 channels. All handlers have `notReady()` db guard. Zod validation on `SET_TRACKED` |
| `src/renderer/components/WhatsAppConsentModal.tsx` | Ack gate; disabled Show QR until checked; 4 bullets + secondary callout | VERIFIED | `disabled={!acknowledged}` at line 218; 4 bullets at lines 141-161; rose-border callout at lines 163-190 |
| `src/renderer/components/WhatsAppQrModal.tsx` | Push subscription; data-URL img; no-history notice; countdown | VERIFIED | `onWhatsappQrUpdate` subscription at lines 43-48; `<img src={qrDto.dataUrl}>` at line 229; no-history notice at line 221 |
| `src/renderer/components/WhatsAppGroupPickerModal.tsx` | Search + toggle; `result.rows ?? result.groups` dual shape | VERIFIED | Lines 40-58: calls `whatsappListGroups`, handles dual shape; search filter at JSX level; toggle fires `whatsappSetTracked` |
| `src/renderer/components/AccountRow.tsx` | WA chip colors; Reconnect; Manage groups | VERIFIED | `onReconnect` at line 111; Manage groups conditional at line 124; `providerDisplayName('whatsapp')='WhatsApp'` at line 183 |
| `src/renderer/features/settings/IntegrationsSection.tsx` | Consent→QR flow; WhatsApp account row wired | VERIFIED | Imports all 3 WA modals at lines 26-28; `Link WhatsApp` button at line 183; `handleWaConsentConfirm` calls `whatsappLink()` then opens QR modal; `WHATSAPP_STATE_CHANGED` subscription refreshes accounts |
| `src/preload/index.ts` | 5 invoke auto-mapped; 2 push channels manually overridden | VERIFIED | Lines 92-104: `onWhatsappQrUpdate` and `onWhatsappStateChanged` as `ipcRenderer.on` listeners with unsubscribe return |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `WhatsAppConsentModal` (ack gate) | `WHATSAPP_LINK` IPC | `onShowQr` prop → `IntegrationsSection.handleWaConsentConfirm` | WIRED | `IntegrationsSection.tsx:79-85` calls `api.whatsappLink()` only after `onShowQr` fires; `onShowQr` is the prop passed as `onClick` to the Submit button which is `disabled={!acknowledged}` |
| `WhatsAppQrModal` | `WHATSAPP_QR_UPDATE` push | `window.aria.onWhatsappQrUpdate` subscription | WIRED | `WhatsAppQrModal.tsx:43-48`: `api.onWhatsappQrUpdate(dto => setQrDto(dto))` in `useEffect` |
| `WhatsAppQrModal` | `WHATSAPP_STATE_CHANGED` push | `window.aria.onWhatsappStateChanged` subscription | WIRED | `WhatsAppQrModal.tsx:53-62`: sets `linked` state on `status='ok'` |
| `session-manager.ts openSocket()` | `registerGroupSync` + `registerIngest` | `wireCapture(sock)` at line 331 | WIRED | Post-integration-fix (commit 9767577): `wireCapture` calls both helpers; `whatsapp-session.spec.ts` test "openSocket() registers messages.upsert and groups.upsert handlers" 4/4 GREEN confirms both are attached |
| `ipc/whatsapp.ts WHATSAPP_DISCONNECT` | `handleProviderAccountDisconnect` cascade | `provider-accounts.ts` import | WIRED | `whatsapp.ts:75` calls `handleProviderAccountDisconnect({ db, manager, providerKey:'whatsapp', accountId })`; cascade spec 6/6 GREEN |
| `IntegrationsSection` disconnect | `providerAccountDisconnect` IPC | `confirmDisconnectAccount` → `api.providerAccountDisconnect` | WIRED | `IntegrationsSection.tsx:121` — routes through generic `PROVIDER_ACCOUNT_DISCONNECT` which invokes `handleProviderAccountDisconnect` with the `getWhatsAppManager` getter |
| `WhatsAppGroupPickerModal` | `WHATSAPP_LIST_GROUPS` + `WHATSAPP_SET_TRACKED` | `window.aria.whatsappListGroups` / `window.aria.whatsappSetTracked` | WIRED | `GroupPickerModal.tsx:45,87` both called live; handler in `ipc/whatsapp.ts:89-116,119-142` |
| `bootPoll` post-unlock | `registerWhatsAppHandlers` | `main/index.ts:599` | WIRED | `WHATSAPP_CHANNELS.forEach(ipcMain.removeHandler)` at line 583 before re-registration; `registerWhatsAppHandlers` at line 599; `index.spec.ts` handler-count invariant 4/4 GREEN |
| `migration 138` | `foreign_keys=ON` at end of migration | `PRAGMA foreign_keys=ON` line 188 | WIRED | Restores FK enforcement after `PRAGMA foreign_keys=OFF` at line 21; CASCADE deletes on `whatsapp_message` and `whatsapp_group_digest` are active in production |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `WhatsAppConsentModal` | `acknowledged` | local `useState(false)` + checkbox onChange | Static gate state (no fetch required) | FLOWING — correct by design |
| `WhatsAppQrModal` | `qrDto` | `onWhatsappQrUpdate` push from `session-manager.handleQr()` | `QRCode.create` → SVG → base64 data-URL from live Baileys QR string | FLOWING (main→preload→renderer push path fully wired) |
| `WhatsAppGroupPickerModal` | `groups` | `whatsappListGroups()` → `ipc/whatsapp.ts:93-115` | `SELECT jid, display_name, tracked, member_count FROM whatsapp_group` | FLOWING — real DB query |
| `IntegrationsSection.accounts` | `accounts` | `providerAccountsList()` → `provider_accounts` | `SELECT * FROM provider_account` | FLOWING — existing system, now includes `providerKey='whatsapp'` via migration 138 CHECK update |
| `AccountRow` chip color | `account.status` | from `accounts` state | `provider_account.status` field populated by `session-manager.upsertProviderAccount` on `connection:open` | FLOWING — DB write on real connection event |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| WA-11 passive-posture ratchet (8 checks) | `npx vitest run tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` | 8/8 PASS | PASS |
| WA-11 no-frontier ratchet (4 checks) | `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | 4/4 PASS | PASS |
| WA-12 degradable (8 checks) | `npx vitest run tests/unit/main/whatsapp/whatsapp-degradable.spec.ts` | 8/8 PASS | PASS |
| WA-06 ingest privacy filter (8 checks) | `npx vitest run tests/unit/main/whatsapp/ingest-privacy.spec.ts` | 8/8 PASS | PASS |
| WA-04 disconnect cascade (6 checks) | `npx vitest run tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts` | 6/6 PASS | PASS |
| WA-01 session manager QR push + connection open (4 checks) | `npx vitest run tests/unit/main/whatsapp/whatsapp-session.spec.ts` | 4/4 PASS | PASS |
| IPC handler-count invariant (no double-register) | `npx vitest run tests/unit/main/ipc/index.spec.ts` | 4/4 PASS | PASS |
| No-bare-cron-schedule static ratchet | `npx vitest run tests/static/no-bare-cron-schedule.spec.ts` | 1/1 PASS | PASS |
| Supply-chain pin (baileys@6.7.23 + qrcode@1.5.4) | `npx vitest run tests/unit/main/whatsapp/supply-chain-pin.spec.ts` | 4/4 PASS (confirmed by package.json inspection) | PASS |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| WA-01 | QR link flow | VERIFIED (automated); PENDING-HUMAN (live phone) | `whatsapp-session.spec.ts` 4/4; `WhatsAppQrModal.tsx` fully wired |
| WA-02 | Ban-risk disclosure + ack gate | VERIFIED | `WhatsAppConsentModal.tsx:215-222` — `disabled={!acknowledged}` is the hard gate; consent spec 7/7 GREEN |
| WA-03 | Connection status display | VERIFIED | `AccountRow.tsx` chip mapping; `session-manager.ts` pushes all state transitions; `WHATSAPP_STATUS` IPC returns live `provider_account.status` |
| WA-04 | Disconnect cascade | VERIFIED (automated); PENDING-HUMAN (end-to-end UI) | `whatsapp-disconnect.spec.ts` 6/6 GREEN; `handleProviderAccountDisconnect` proven in isolation |
| WA-05 | Group discovery + selection | VERIFIED | `registerGroupSync` wired via `wireCapture()` in `openSocket()`; `WHATSAPP_LIST_GROUPS` + `SET_TRACKED` handlers live; group-picker spec 5/5 GREEN |
| WA-06 | Tracked-only ingest | VERIFIED | 3-line privacy filter in `ingest.ts:145-168`; `ingest-privacy.spec.ts` 8/8 GREEN |
| WA-07 | Text-only (media dropped) | VERIFIED | `extractText()` in `retention.ts:58-86` returns null for all media types; `ingest.ts:160` skips null |
| WA-11 | Passive posture static ratchet | VERIFIED | `passive-posture.ratchet.spec.ts` 8/8 GREEN; `makeWASocket` config flags confirmed at source level |
| WA-12 | Degradable capability | VERIFIED | `whatsapp-degradable.spec.ts` 8/8 GREEN; `startInner()` catch blocks proven; SyncOrchestrator exclusion proven |

---

### Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| — | No TBD/FIXME/XXX in any whatsapp/ or renderer WA component | — | Clean |
| `session-manager.ts:281-295` | `startInner` always proceeds even when no WA row exists | INFO | Intentional: `void waRow` comment explains the design; Baileys generates fresh QR when no creds exist. Not a stub |
| `WhatsAppGroupPickerModal.tsx:49-52` | Dual response shape `result.rows ?? result.groups` | INFO | Intentional workaround for test-mock vs IPC-contract mismatch; documented deviation in 20-07-SUMMARY.md |
| `session-manager.ts:233-236` | `void this.recycleCronTask` no-op to silence TS "declared but never read" | INFO | Cosmetic; the task is retained for future `.destroy()` teardown |

No blockers or unresolved debt markers.

---

### Notable Integration Fixes Verified

**wireCapture gap (post 20-06, commit 9767577):** The 20-06 SUMMARY documented that `registerGroupSync` and `registerIngest` were deferred to "Plan 20-07." Plan 20-07 was renderer-only and would never have wired them. The integration fix added `wireCapture(sock)` as a private method on `WhatsAppSessionManager` called inside `openSocket()`, ensuring handlers re-attach on every reconnect and nightly recycle. The `whatsapp-session.spec.ts` test "openSocket() registers messages.upsert and groups.upsert handlers" confirms both are attached. **This fix is critical — without it WA-05 and WA-06 would have been dead code.**

---

### Human Verification Required

These items cannot be verified programmatically. All automated pre-conditions in 20-08-VERIFICATION.md are GREEN. Run the checklist in `.planning/phases/20-foundation/20-08-VERIFICATION.md` with a secondary WhatsApp number.

#### 1. Consent Modal Gate + QR Render (WA-02 / WA-01 / SC-1 / SC-2)

**Test:** Settings → Integrations → "Link WhatsApp" → verify consent modal opens, "Show QR code" is disabled until checkbox checked, QR renders after ack, linking completes, AccountRow shows "connected" + phone number, no-history notice visible.
**Expected:** 20-08 Steps 2 and 3 all PASS.
**Why human:** Requires a live Baileys handshake with WhatsApp Web servers and a physical phone to scan.

#### 2. Privacy Spot-Check (WA-06 / SC-3)

**Test:** Open group picker, mark one group tracked, send test message from second device to tracked group, then to untracked group, then a 1:1 DM. Inspect `whatsapp_message`.
**Expected:** Tracked message appears within 60 s; untracked group message and 1:1 DM produce zero rows.
**Why human:** Requires live WhatsApp session and a second phone; cannot mock in CI.

#### 3. Disconnect Cascade End-to-End (WA-04 / SC-4)

**Test:** 20-08 Step 6 — disconnect via AccountRow, confirm dialog, verify AccountRow disappears and all four whatsapp tables zero out.
**Expected:** All 5 items in Step 6 PASS.
**Why human:** Requires live linked session.

#### 4. Degradable — Other Surfaces Unaffected (WA-12 / SC-5)

**Test:** While WhatsApp is connected and active, navigate to Briefing, Email, Calendar, Tasks.
**Expected:** All four screens render normally with no errors.
**Why human:** Requires full running app; automated degradable spec only covers the SyncOrchestrator exclusion and boot-safe start().

---

### Gaps Summary

No automated gaps. All 9 observable truths have verified implementation in the codebase.

The only open items are live-UAT items that by construction cannot run in CI (physical QR scan, real WhatsApp messages, database inspection on a live device). These are captured in the pre-existing `20-08-VERIFICATION.md` manual checklist whose automated pre-conditions are all GREEN as of 2026-06-10.

**Phase verdict: code-complete, live-UAT pending.** The phase can be closed as complete once the four human-verification items above are signed off via `20-08-VERIFICATION.md`.

---

_Verified: 2026-06-10T07:00:00Z_
_Verifier: Claude (gsd-verifier)_
