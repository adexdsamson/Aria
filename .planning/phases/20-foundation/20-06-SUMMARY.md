---
phase: 20-foundation
plan: "06"
subsystem: whatsapp-ipc
tags: [whatsapp, ipc, bootpoll, disconnect-cascade, WA-04, WA-12]

dependency_graph:
  requires:
    - phase: 20-foundation-plan-01
      provides: "7 WHATSAPP_* channel constants + pre-unlock stubs in ipc/index.ts"
    - phase: 20-foundation-plan-04
      provides: "WhatsAppSessionManager (start/stop/startLink/getStatus)"
    - phase: 20-foundation-plan-05
      provides: "startWhatsAppRetention() cron helper"
  provides:
    - "src/main/ipc/whatsapp.ts: registerWhatsAppHandlers + WHATSAPP_CHANNELS const array"
    - "bootPoll removeHandler loop + manager construction + retention start (main/index.ts)"
    - "handleProviderAccountDisconnect exported from provider-accounts.ts (WA-04 cascade)"
    - "getWhatsAppManager getter in IpcDeps + forwarded to registerProviderAccountHandlers"
  affects:
    - "Plan 20-07 (renderer): WHATSAPP_LINK / LIST_GROUPS / SET_TRACKED / STATUS channels live"
    - "Plan 20-08 (digest): manager available post-unlock for WHATSAPP_* group digest reads"

tech_stack:
  added: []
  patterns:
    - "WHATSAPP_CHANNELS const array (single source of truth for removeHandler loop) — mirrors KNOWLEDGE_FOLDER_CHANNELS"
    - "Getter pattern (getWhatsAppManager) for late-binding post-unlock manager access via IpcDeps"
    - "handleProviderAccountDisconnect exported standalone function (testable without IPC scaffolding)"
    - "WA-04 cascade: manager.stop() → auth_state + group DELETE (→ FK CASCADE message + digest) → provider_account DELETE in one transaction"

key_files:
  created:
    - src/main/ipc/whatsapp.ts
  modified:
    - src/main/ipc/index.ts
    - src/main/index.ts
    - src/main/ipc/provider-accounts.ts
    - tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts

decisions:
  - "WHATSAPP_CHANNELS excludes push channels (QR_UPDATE, STATE_CHANGED) — they are in pushOnlyChannels (ipc/index.ts) and not invokable by renderer"
  - "handleProviderAccountDisconnect as standalone exported function — mirrors handleVoiceConfirmApproval pattern; disconnect spec tests it directly without IPC scaffolding"
  - "getWhatsAppManager getter in IpcDeps (not direct reference) — manager created post-unlock in bootPoll; getter returns null pre-unlock, live instance post-unlock; avoids eager creation with db=null"
  - "WA-04 whatsapp_group DELETE relies on migration 138 ON DELETE CASCADE for message + digest rows (no explicit DELETE needed for those tables)"
  - "Plan 20-07 scope: registerIngest() + registerGroupSync() socket attachment deferred — not yet imported in main/index.ts (will wire in Plan 20-07 when session-manager exposes socket)"
  - "Static import for handleProviderAccountDisconnect in whatsapp.ts (not dynamic import) — resolves TS2339 at compile time"

metrics:
  duration_minutes: 35
  completed_date: "2026-06-10"
  tasks_completed: 3
  files_created: 1
  files_modified: 4
---

# Phase 20 Plan 06: WhatsApp IPC + Bootstrap Spine Summary

**IPC registrar with WHATSAPP_CHANNELS canonical array, bootPoll post-unlock wiring (manager + retention cron), and WA-04 cascade delete — the integration spine that lets the renderer drive linking, group toggling, status, and disconnect.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-06-10
- **Tasks:** 3 (committed atomically per task)
- **Files created:** 1
- **Files modified:** 4

## Accomplishments

- T-20-20 (IPC double-register DoS) mitigated: `WHATSAPP_CHANNELS` const array exported from `ipc/whatsapp.ts` is the single source of truth for the `removeHandler` loop in `bootPoll`; pre-unlock stubs from Plan 20-01 are removed before real handlers are registered
- T-20-22 (residual PII after disconnect) mitigated: `handleProviderAccountDisconnect` cascade deletes `whatsapp_auth_state` + `whatsapp_group` (FK CASCADE removes `whatsapp_message` + `whatsapp_group_digest`) + `provider_account` row in one transaction; `manager.stop()` tears down the socket first
- T-20-23 (bootPoll throw rejects boot) mitigated: `manager.start()` wrapped in `.catch()`; retention cron registered without blocking boot
- Zod validation on `WHATSAPP_SET_TRACKED` payload (T-20-21 tamper mitigation)
- `getStatus()` + JID from `provider_account.account_id` for `WHATSAPP_STATUS` (D-11)
- 84 pre-existing typecheck errors (baseline unchanged); 0 new errors in touched files
- All 3 static ratchets (passive-posture 8/8, no-frontier 4/4, no-bare-cron 1/1) GREEN

## Task Commits

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1a | ipc/whatsapp.ts registrar + WHATSAPP_CHANNELS canonical array | 07427a8 | src/main/ipc/whatsapp.ts |
| 1b | IpcDeps getWhatsAppManager getter + forward to provider-accounts | cd0b8aa | src/main/ipc/index.ts |
| 3 | provider-accounts.ts whatsapp disconnect cascade + spec fix | edb94d8 | src/main/ipc/provider-accounts.ts, whatsapp-disconnect.spec.ts |
| 2 | main/index.ts bootPoll — manager + real handlers + retention cron | 807597e | src/main/index.ts |

## Test Results

| Spec | Tests | Status |
|------|-------|--------|
| `tests/unit/main/ipc/index.spec.ts` | 4/4 | GREEN |
| `tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts` | 6/6 | GREEN |
| `tests/static/no-bare-cron-schedule.spec.ts` | 1/1 | GREEN |
| `tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` | 8/8 | GREEN |
| `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | 4/4 | GREEN |
| **Total** | **23/23** | **GREEN** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] whatsapp-disconnect.spec.ts used wrong column name**
- **Found during:** Task 3 verification (whatsapp-disconnect.spec.ts RED run)
- **Issue:** Spec seeded `whatsapp_auth_state` with `(type, key_id, value_json)` but the actual schema column is `value` (established in migration 138 / Plan 20-03 decision)
- **Fix:** Changed `value_json` → `value` in the INSERT seed statement
- **Files modified:** `tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts`
- **Commit:** `edb94d8`

## Known Stubs

None — all 5 WHATSAPP invoke channels are now wired to real implementations post-unlock.

## Post-Execution Integration Fix (2026-06-10, commit 9767577)

**Gap found:** `registerGroupSync` and `registerIngest` (built in Plan 20-05) were never
attached to the live Baileys socket. The 20-06 SUMMARY and the comment at `src/main/index.ts:613`
both deferred this to "Plan 20-07," but Plan 20-07 is the renderer-only plan and would never
touch the main-process socket. WA-05 group discovery and WA-06 message ingest were dead code.

**Fix:** Added `wireCapture(sock)` private method to `WhatsAppSessionManager`. It calls
`registerGroupSync(sock, ...)` and `registerIngest({ sock, ... })` and is invoked inside
`openSocket()` immediately after the existing `wireConnectionUpdate` / `wireCredsUpdate` /
`wirePowerMonitor` calls. Placement inside `openSocket()` ensures handlers re-attach on
every reconnect and nightly recycle (each recycle creates a fresh socket via `stop()` + `start()`).

The misleading comment in `src/main/index.ts` was replaced with an accurate note that
`wireCapture` handles attachment internally.

**Test coverage:** Added assertion to `whatsapp-session.spec.ts` that both `messages.upsert`
(ingest) and `groups.upsert` (group-sync) handlers are registered alongside `connection.update`
and `creds.update` after `manager.start()`. All 4 tests GREEN. No new typecheck errors (84 baseline).

## Threat Flags

No new threat surface beyond the plan's threat model:
- T-20-20 mitigated: WHATSAPP_CHANNELS + bootPoll removeHandler loop (handler-count test asserts exact count)
- T-20-21 mitigated: Zod WhatsAppSetTrackedReq validation on SET_TRACKED handler
- T-20-22 mitigated: cascade deletes all WA tables + provider_account in one transaction; integration spec asserts 0 rows
- T-20-23 mitigated: start() + block wrapped in .catch(); WA-12 degradable confirmed

## Self-Check: PASSED

Files exist:
- `src/main/ipc/whatsapp.ts` — FOUND
- Commits 07427a8, cd0b8aa, edb94d8, 807597e — FOUND in git log

Test results: 23/23 GREEN across 5 spec files

---

*Phase: 20-foundation*
*Completed: 2026-06-10*
