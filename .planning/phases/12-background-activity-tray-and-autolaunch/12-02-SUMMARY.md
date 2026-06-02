# 12-02 SUMMARY — Tray icon + rich menu + sealed-DB cron skip + catchup-on-unlock

**Status:** Complete (reconciled 2026-06-02 — implemented + committed in an earlier session; SUMMARY backfilled). Manual Windows tray UAT (Task 4) DEFERRED — see below.
**Plan:** 12-02

## What was built (4 commits)

- `6dba0e4` — **tray assets (Task 0, BG-06)**: `build/icon-badged.svg` + `tray-icon.ico` / `tray-icon-badged.ico` (Win) + `tray-iconTemplate.png` / `tray-iconTemplate@2x.png` (Mac Template). `package.json` gains `icons:tray` script + electron-builder `extraResources` bundling `build/tray-*`. (`8d0fcf7` later refreshed pnpm-lock for the tray icon deps.)
- `53f1c12` — **tray module + lifecycle hooks (Task 1)**: `src/main/tray/{icons,menu,index}.ts` — `loadTrayIcon`, `buildContextMenu` (6-item menu w/ db-null disable logic), `createTray`/`TrayHandle`/`TrayDeps` with module-level `let _tray` GC pin and the `trayBus` mutable setBadge/clearBadge (housed in tray/index.ts — no separate bus.ts). `src/main/lifecycle/onUnlock.ts` (`registerOnUnlock`/`fireOnUnlock`) + `pendingCatchup.ts` (`pendingCatchup`/`CatchupChannel`).
- `5db96cc` — **bootstrap wiring + single-instance (Task 2)**: `index.ts` constructs the tray inside the single-instance-lock branch, registers the catchup-drain `registerOnUnlock` callback + `runChannelOnce`, before-quit disposes the tray (and still calls `stopKnowledgeFolderLifecycle`), second-instance raises the window. `onboarding.ts` calls `fireOnUnlock(db, logger)` after `holder.db = db`. `single-instance-tray.spec.ts` (createTray-at-most-once).
- `8cc9584` — **8 cron seal-guards + static ratchets (Task 3)**: seal-guard prelude (`if (!db) { pendingCatchup.add('<channel>'); trayBus.setBadge(); return; }`) added to all 8 cron callsites; `tests/static/cron-seal-guard.spec.ts` + `tests/static/no-bare-cron-schedule.spec.ts`.

## Requirements: BG-02 (menu surface), BG-04, BG-05, BG-06 — delivered.

## Verification (reconciliation, 2026-06-02, static)
- **8 cron seal-guards confirmed** — `pendingCatchup.add` present in: briefing/schedule, insights/schedule, recap/schedule, learning/schedule, entitlement/schedule, ipc/gmail, ipc/calendar, and **folder-ingestion/sweep-cron.ts**.
- `createTray`/`registerOnUnlock`/`runChannelOnce`/`fireOnUnlock` wired in index.ts (8 hits); `fireOnUnlock` called post-unlock in onboarding.ts (L214/L269).
- Tray module (icons/menu/index), lifecycle (onUnlock/pendingCatchup), tray assets (5 files), package.json config, and test files (tray/*, lifecycle/*, single-instance-tray, cron-seal-guard, no-bare-cron-schedule) all present.

## Deviations from plan
- The 8th cron callsite is **`src/main/folder-ingestion/sweep-cron.ts`**, not the `folder-ingestion/lifecycle.ts` the plan's `files_modified` named (stale plan path) — guard is correctly present in the real file.
- `trayBus` lives inside `tray/index.ts` (the plan allowed "tray/index.ts OR new tray/bus.ts") — no separate `bus.ts`.

## DEFERRED — Task 4 manual Windows tray UAT
Not formally signed off. The tray code is committed and 12-03 (notifications, click→/briefing, AUMID) was built on top of it and completed, which exercises the tray path. A full manual walkthrough (close→tray, right-click 6-item menu, sealed badge, catchup drain, single-instance, quit) remains an open human-verify — can be done quickly since the app currently runs on Windows. macOS UAT deferred to a mac-hardware session.

## Self-Check: PASSED (reconciled — code committed, summary backfilled; manual UAT deferred)
