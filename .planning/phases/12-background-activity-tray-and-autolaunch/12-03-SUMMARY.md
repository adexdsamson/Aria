---
phase: 12-background-activity-tray-and-autolaunch
plan: "03"
subsystem: notifications
tags: [electron, notifications, ipc, tray, close-handler, renderer]
dependency_graph:
  requires:
    - 12-01  # prefs + window decisions
    - 12-02  # tray module + onUnlock lifecycle
  provides:
    - showBriefingReadyNotification (BG-03)
    - maybeShowFirstCloseToast (BG-07)
    - CHANNELS.NAVIGATE (aria:navigate push channel)
    - window.aria.onNavigate preload subscription
    - App.tsx navigate listener with allowlist
  affects:
    - src/main/ipc/briefing.ts (runOnce hook)
    - src/main/index.ts (close handler hook)
    - src/preload/index.ts (new channel)
    - src/renderer/app/App.tsx (subscribe + route)
tech_stack:
  added: []
  patterns:
    - Electron Notification API with isSupported guard
    - Per-dateKey module-level Set for notification dedupe
    - ipcRenderer.on push-channel subscription with unsubscribe
    - React useEffect subscribe/cleanup pattern
    - Allowlist-enforced IPC path routing (T-12-10)
key_files:
  created:
    - src/main/tray/notify.ts
    - tests/unit/main/tray/notify.spec.ts
    - tests/unit/renderer/navigate-listener.spec.tsx
  modified:
    - src/shared/ipc-contract.ts (CHANNELS.NAVIGATE, AriaApi.onNavigate)
    - src/main/ipc/briefing.ts (runOnce notification hook)
    - src/main/index.ts (close handler first-X toast hook)
    - src/preload/index.ts (onNavigate subscription)
    - src/renderer/app/App.tsx (AppShellNavigateListener)
    - tests/unit/main/index-close-handler.spec.ts (4 new cases)
decisions:
  - maybeShowFirstCloseToast intentionally NOT gated on notificationsEnabled
    (BG-07 rationale — discoverability affordance, not a briefing notification)
  - CHANNELS.NAVIGATE path hardcoded in call sites (T-12-10 no user-controlled value)
  - Allowlist ['/briefing', '/approvals'] in App.tsx enforces T-12-10
  - maybeShowFirstCloseToast writes firstCloseToastShown even when
    Notification.isSupported()=false so no future retry loops
metrics:
  duration_minutes: 45
  completed_date: "2026-05-23"
  tasks_completed: 3
  tasks_total: 4
  files_created: 3
  files_modified: 6
---

# Phase 12 Plan 03: Notifications — briefing-ready + first-X toast + aria:navigate Summary

Native notification UX: briefing-ready toast with click-to-/briefing routing, one-time first-close discoverability toast, and the aria:navigate IPC channel wiring from main-process through preload into the renderer router.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | showBriefingReadyNotification + maybeShowFirstCloseToast + CHANNELS.NAVIGATE | 0b3b073 | notify.ts, ipc-contract.ts, briefing.ts, notify.spec.ts |
| 2 | First-X toast hook in close handler + extend close-handler tests | 850d834 | index.ts, index-close-handler.spec.ts |
| 3 | Preload aria:navigate + App.tsx listener | 98218fc | preload/index.ts, App.tsx, navigate-listener.spec.tsx |
| 4 | Manual UAT checkpoint | — | awaiting user verification |

## Test Results

```
npx vitest run tests/unit/main/tray/notify.spec.ts
  tests/unit/main/index-close-handler.spec.ts
  tests/unit/renderer/navigate-listener.spec.tsx --passWithNoTests

Test Files  3 passed (3)
     Tests  32 passed (32)
```

- notify.spec.ts: 12 cases (dedupe, gate, isSupported, click handler, BG-07 intentional)
- index-close-handler.spec.ts: 14 cases (10 original + 4 new first-X toast wiring)
- navigate-listener.spec.tsx: 6 cases (subscribe, allowlist hit/miss, unmount cleanup)

`npx tsc --noEmit` — clean (0 errors).

## Files Created / Modified

### Created
- `src/main/tray/notify.ts` — `showBriefingReadyNotification` + `maybeShowFirstCloseToast` + `_resetDedupeForTests`
- `tests/unit/main/tray/notify.spec.ts` — 12 unit cases
- `tests/unit/renderer/navigate-listener.spec.tsx` — 6 unit cases

### Modified
- `src/shared/ipc-contract.ts` — `CHANNELS.NAVIGATE = 'aria:navigate'`; `AriaApi.onNavigate` subscription helper
- `src/main/ipc/briefing.ts` — `runOnce()` now calls `showBriefingReadyNotification` on success
- `src/main/index.ts` — close handler calls `maybeShowFirstCloseToast` when `action='hide' && !darwin`
- `src/preload/index.ts` — `window.aria.onNavigate` override with real `ipcRenderer.on` subscription
- `src/renderer/app/App.tsx` — `AppShellNavigateListener` component + wire into `App` root
- `tests/unit/main/index-close-handler.spec.ts` — 4 new first-X toast cases replacing `describe.todo`

## Key Behaviors Shipped

**BG-03 — Briefing-ready notification:**
- `showBriefingReadyNotification(win, summary, dateKey, opts)` in `src/main/tray/notify.ts`
- Gated on `notificationsEnabled` pref (Decision 4)
- Per-`dateKey` dedupe Set (T-12-12: one notification per day max)
- `Notification.isSupported()` guard — silent fallback to tray badge on failure
- Click handler: `restore()` if minimized, `show()` if hidden, `focus()`, `webContents.send(CHANNELS.NAVIGATE, '/briefing')`
- Hooked into `runOnce()` in `src/main/ipc/briefing.ts` at the `status=done` site

**BG-07 — First-X discoverability toast:**
- `maybeShowFirstCloseToast(win, db, logger)` in `src/main/tray/notify.ts`
- **INTENTIONALLY NOT gated on `notificationsEnabled`** — one-time discoverability affordance
- `firstCloseToastShown` flag guard — fires at most once per vault
- `Notification.isSupported()=false` path: no Notification, but flag still written (no retry loops)
- `db=null` path: clean no-op (pre-unlock defense)
- Hooked into BrowserWindow close handler in `src/main/index.ts` when `action='hide' && !darwin`

**aria:navigate channel (T-12-10):**
- `CHANNELS.NAVIGATE = 'aria:navigate'` added to `src/shared/ipc-contract.ts` (12-03 owns this)
- Preload override: `window.aria.onNavigate(cb) => unsubscribe` via `ipcRenderer.on`
- `AppShellNavigateListener` in App.tsx: `useEffect` subscribe + allowlist `['/briefing', '/approvals']`
- Non-allowlisted paths silently ignored

## Manual UAT Result (Task 4)

**Windows UAT:** Awaiting user verification.

**macOS UAT:** DEFERRED to mac-hardware session (no macOS device available during this execution). Specific items deferred:
- macOS Notification permission flow (system prompt on first `Notification.show()`)
- Permission denial → silent no-op, tray badge fallback
- macOS click-X hides per Decision 5 (dock always visible, `maybeShowFirstCloseToast` NOT called on darwin)

## BG-07 Rationale (intentional deviation from default notification gating)

`maybeShowFirstCloseToast` is NOT gated on `notificationsEnabled`. This is intentional:
- CONTEXT Decision 2 gates BRIEFING notifications on `notificationsEnabled`
- The first-X toast is the only UX signal telling a user with `notificationsEnabled=false`
  that the window was hidden (not closed) and Aria is running in the tray
- Without it, a `notificationsEnabled=false` user would silently lose the window with no
  way to re-find Aria until they check the system tray
- `notify.spec.ts` line: `BG-07: fires Notification even when notificationsEnabled=false in DB`
  explicitly asserts this intentional behavior

## Allowlist Enforcement (T-12-10)

`App.tsx` enforces `NAVIGATE_ALLOWLIST = ['/briefing', '/approvals']`. Any path value delivered
by `aria:navigate` that is not in this list is silently ignored. The main-process call sites
use hardcoded string literals (`'/briefing'` in `showBriefingReadyNotification`, `'/approvals'`
in the tray menu), so no user-controlled value ever reaches the allowlist check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `src/main/briefing/run.ts` does not exist**
- **Found during:** Task 1 implementation
- **Issue:** Plan references `src/main/briefing/run.ts` as the hook site, but this file was
  never created. The actual briefing pipeline entry is `runBriefing` in `generate.ts`, called
  from `runOnce()` in `src/main/ipc/briefing.ts`
- **Fix:** Hooked `showBriefingReadyNotification` into `runOnce()` in `src/main/ipc/briefing.ts`
  immediately after `scheduler.queue.add()` succeeds — semantically identical to
  "at the status=done site" but matching the actual code structure
- **Files modified:** `src/main/ipc/briefing.ts`
- **Commit:** 0b3b073

**2. [Rule 2 - Missing critical functionality] CHANNELS.NAVIGATE needed in CHANNEL_METHODS + AriaApi**
- **Found during:** Task 1
- **Issue:** Adding a new CHANNELS entry requires corresponding entries in CHANNEL_METHODS
  and AriaApi for the preload bridge to remain consistent
- **Fix:** Added `NAVIGATE: 'onNavigate'` to CHANNEL_METHODS and `onNavigate?:` to AriaApi
  (optional, like `onResearchReportDone`) — preload override pattern used for push channels
- **Files modified:** `src/shared/ipc-contract.ts`
- **Commit:** 0b3b073

**3. [Rule 2 - Missing critical functionality] AppShellNavigateListener must be inside MemoryRouter**
- **Found during:** Task 3 (test writing)
- **Issue:** `AppShellNavigateListener` uses `useNavigate()` which requires a router context.
  Component must be rendered inside `MemoryRouter` to work
- **Fix:** Placed `<AppShellNavigateListener />` inside the existing `<MemoryRouter>` in `App()`
  component. Test wraps in `<MemoryRouter>` for isolation
- **Files modified:** `src/renderer/app/App.tsx`
- **Commit:** 98218fc

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

The `aria:navigate` channel is IPC-internal (main-to-renderer only, not renderer-to-main).
The allowlist in `App.tsx` covers T-12-10. The hardcoded paths at call sites cover T-12-11.
No threat flags beyond those already documented in the plan's threat model.

## Self-Check: PASSED

Files exist:
- src/main/tray/notify.ts: FOUND
- tests/unit/main/tray/notify.spec.ts: FOUND
- tests/unit/renderer/navigate-listener.spec.tsx: FOUND

Commits exist:
- 0b3b073: FOUND (Task 1)
- 850d834: FOUND (Task 2)
- 98218fc: FOUND (Task 3)

TypeScript: clean (0 errors)
Tests: 32/32 pass
