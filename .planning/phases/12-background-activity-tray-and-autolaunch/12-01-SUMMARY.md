# 12-01 SUMMARY — Background-activity prefs + close-to-tray foundation

**Status:** Complete (reconciled 2026-06-02 — implemented + committed in an earlier session; SUMMARY backfilled)
**Plan:** 12-01

## What was built (3 commits)

- `fd1da81` — **prefs module + IPC**: `src/main/background/prefs.ts` exporting `BG_PREF_DEFAULTS`, `readBgPref`, `writeBgPref`, `getBackgroundPrefs`, `setAutoLaunch`, `reconcileAutoLaunchOnBoot` (settings-KV pattern, boolean→'1'/'0', defaults-only when db null, `setLoginItemSettings` OS mirror with win32 `args:['--was-auto-launched']` and NO `openAsHidden` on darwin per D-06). `src/main/ipc/background.ts` exporting `registerBackgroundHandlers` (closed Zod patch). `src/shared/ipc-contract.ts` adds `BG_GET_PREFS`/`BG_SET_PREFS` + `BackgroundPrefsDto`/`BackgroundPrefsPatchDto`.
- `451e9a6` — **close-to-tray + window-all-closed + bans ratchet**: `src/main/index.ts` gains module-level `appIsQuitting`, pure helpers `decideCloseAction` + `decideWindowAllClosed`, the `win.on('close')` interceptor, the rewritten `window-all-closed` handler, and bootstrap wiring (`registerBackgroundHandlers` + post-unlock `reconcileAutoLaunchOnBoot`). `tests/static/phase12-bans.spec.ts` persistent ratchet (bans `app.dock.hide` / `openAsHidden` / `nativeImage.composite` under src/main + src/preload).
- `7c006da` — **Settings → Behaviour panel**: `BehaviourSection.tsx` with 3 editorial-Checkbox toggles (autoLaunch / closeToTray / notificationsEnabled) wired to `BG_GET_PREFS`/`BG_SET_PREFS`; registered in `SettingsScreen.tsx`.

## Requirements: BG-01, BG-02, BG-08 — delivered.

## Verification (reconciliation, 2026-06-02, static — tests not re-run; dev server held the better-sqlite3 ABI lock)
- `git grep` confirms `decideCloseAction`/`decideWindowAllClosed`/`appIsQuitting` (10 hits) + bootstrap wiring in index.ts.
- prefs.ts / background.ts / ipc-contract additions present; 4 test files exist (prefs.spec, index-close-handler.spec, BehaviourSection.spec, phase12-bans.spec).
- phase12-bans ratchet present and was green in the original execution.

## Notes
- `BehaviourSection.tsx` + `SettingsScreen.tsx` show as working-tree-modified, but that WIP is the *separate* dark-mode/Appearance effort layered on top of the committed 12-01 panel — 12-01's panel itself is committed (7c006da).

## Self-Check: PASSED (reconciled — code committed, summary backfilled)
