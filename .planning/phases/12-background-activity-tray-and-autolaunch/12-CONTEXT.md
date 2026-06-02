# Phase 12 — Background Activity (Tray + Auto-launch)

**Goal:** Aria runs in the background after the user closes the main window and auto-launches on login. The daily briefing cron and integration sync keep firing while the window is hidden; the user is notified via native OS notification when the briefing is ready.

**Platforms (v1):** Windows + macOS. Linux deferred.
**Out of scope:** Headless first-run (auto-launch always boots normally; window-hidden state only takes over after first-X). Linux tray support (AppIndicator quirks deferred). Background work while DB sealed (silent skip — see Decision 1).

---

## Existing infrastructure to reuse (do not reinvent)

- **node-cron + cronRegistry** — [`src/main/briefing/schedule.ts`](src/main/briefing/schedule.ts), [`src/main/scheduler`](src/main/scheduler) — keeps firing in the main process regardless of window visibility.
- **powerMonitor lifecycle** — [`src/main/lifecycle/powerMonitor.ts`](src/main/lifecycle/powerMonitor.ts) — `registerLifecycleCallbacks({ onSuspend, onResume })` already pauses/resumes briefing cron on sleep/wake. Background phase MUST NOT regress this.
- **Single-instance lock** — [`src/main/single-instance.ts`](src/main/single-instance.ts) — second-launch raises the existing instance. Background-mode + auto-launch must coexist with this.
- **user_prefs table (Phase 8)** — typed prefs with nightly aggregation + per-field reset. Reuse for `backgroundActivity.*` keys (see Decision 6).
- **DB-locked gate** — `dbHolder.db` is null until first unlock; existing `if (db)` guards in IPC handlers (see knowledge-folders + entitlement-stub pattern in MEMORY.md) are the precedent for tray + cron behavior under a sealed vault.

---

## Locked decisions

### Decision 1 — Locked-vault behavior: silent skip + tray badge

When auto-launched with a sealed DB:
- Cron callbacks (briefing, gmail-sync, calendar-sync, todoist-sync, knowledge-folder-sweep, entitlement-refresh) check `dbHolder.db` first. If null, they return early as a no-op. **No log noise, no error counter increment.**
- Tray icon renders a small overlay dot (gold) when at least one cron has been skipped since last unlock — meaning "Aria is paused, waiting for unlock."
- On first successful unlock of the day, run a "catchup" pass for any cron that fired-and-skipped during the sealed window. Catchup is single-shot: it does not re-fire every cron tick that was missed, just runs the latest pending job per channel.
- Tray badge clears after catchup completes.

**Rationale:** doesn't wake the user with notifications they can't act on; doesn't force them to unlock right after auto-launch; gives a quiet visual cue that work is queued.

### Decision 2 — Auto-launch default OFF; first-X shows a one-time toast

- `backgroundActivity.autoLaunch` defaults to `false`. User opts in via Settings → Behaviour → "Run Aria in the background on login" toggle.
- `backgroundActivity.closeToTray` defaults to `true` (the new behavior — clicking X hides instead of quits).
- **First-X UX:** the first time the user closes the window with `closeToTray=true`, fire a native OS notification: **"Aria is still running in the tray. Right-click the tray icon to quit."** Persist `backgroundActivity.firstCloseToastShown=true` so it never fires again.
- Power-user escape: Settings → Behaviour → "Quit Aria when I close the window" toggle flips `closeToTray=false`.

### Decision 3 — Tray menu: rich, with platform-conventional clicks

**Menu items (top to bottom):**
1. `Show Aria` — focuses the existing window or creates one if `BrowserWindow.getAllWindows().length === 0`.
2. `Generate briefing now` — IPC `aria:briefing:generate-now`; disabled if DB sealed (with tooltip "Unlock Aria first").
3. `Sync now` submenu — `Gmail` / `Calendar` / `Todoist`, each calling its existing force-sync IPC. Submenu items disabled if the relevant provider isn't connected.
4. `Open approvals` — routes window to `/approvals`. Useful when approval count > 0.
5. (separator)
6. `Quit Aria` — `app.quit()`. This is the only way to actually exit when `closeToTray=true`.

**Click behavior:**
- **Windows:** left-click `Show Aria`; right-click opens the context menu.
- **macOS:** click opens the menu (Apple convention for status items). `Show Aria` is the first item, so a single click + Enter reaches it. No left/right distinction.

### Decision 4 — Notification routes to /briefing; macOS permission lazy

- Briefing-ready notification body: **"Your morning briefing is ready"** + summary count ("3 emails, 2 events, 1 news item"). Click action focuses the window and navigates to `/briefing`.
- **macOS notification permission** is requested lazily by Electron's `Notification` API on first `new Notification(...).show()`. We don't wrap this in a Settings prompt — the system handles it natively.
- **Quiet hours:** none added in this phase. The briefing schedule already respects user-configured time-of-day, so notifications fire when the briefing fires.
- **Throttle:** at most one briefing-ready notification per `briefingDateKey`. Re-firing the cron (which is deduped server-side anyway) does not produce a second notification.
- **Settings toggle:** `backgroundActivity.notificationsEnabled` (default `true`). When `false`, notifications never fire; tray badge still updates.

### Decision 5 — macOS dock icon: always visible

Keep `app.dock` always shown. Closing window does NOT call `app.dock.hide()`. Aria stays visible in Cmd-Tab and Mission Control even when its window is closed — matches Slack / Notion / Linear convention for chief-of-staff apps.

### Decision 6 — Prefs in `settings` KV; OS state mirrored

> **2026-05-22 ADDENDUM (post-research):** Two corrections from `12-RESEARCH.md`:
> 1. `user_prefs` does not exist. The Phase-8 product is `learned_preferences` (a single-row Zod payload — not a generic KV). The real KV is the `settings(k, v)` table from migration 001, already used by briefing-time and learning reset. Store the four `backgroundActivity.*` keys there — **no new migration**.
> 2. `app.setLoginItemSettings({ openAsHidden })` is **deprecated and a no-op on macOS 13+**. Drop `openAsHidden` from the mirror call on `process.platform === 'darwin'`. On Windows, pass `args: ['--was-auto-launched']` instead so the main process can detect auto-launch boot. macOS auto-launched windows come up visible (consistent with Decision 5 — dock always visible).

**SQLite is the source of truth.** New keys in `user_prefs` (Phase 8 schema):

| Key | Type | Default | Notes |
|---|---|---|---|
| `backgroundActivity.autoLaunch` | bool | `false` | Mirrors to `app.setLoginItemSettings({ openAtLogin })` on change + at app start. |
| `backgroundActivity.closeToTray` | bool | `true` | Controls window close-handler branch. |
| `backgroundActivity.notificationsEnabled` | bool | `true` | Briefing-ready notification gate. |
| `backgroundActivity.firstCloseToastShown` | bool | `false` | One-time first-X toast guard. |

**IPC channels (new):**
- `aria:background:get-prefs` → `{ autoLaunch, closeToTray, notificationsEnabled }`
- `aria:background:set-prefs` accepts partial `{ autoLaunch?, closeToTray?, notificationsEnabled? }`; on `autoLaunch` change, also calls `app.setLoginItemSettings({ openAtLogin: value, openAsHidden: value })` so login-launch is hidden (matches Decision 2 intent).
- `aria:tray:set-badge` (internal, main→main, not exposed to renderer) — sets the tray overlay dot from cron skip-counter.

**Startup reconciliation:** on `app.whenReady().then(bootstrap)`, after DB unlocks (or before, using a safe defaults read from a fresh prefs row if the table is post-migration but empty), compare `user_prefs.backgroundActivity.autoLaunch` against `app.getLoginItemSettings().openAtLogin`; if they diverge, the DB wins (same pattern as Phase 10 entitlement reconciler).

---

## Critical regressions to guard against

1. **`window-all-closed` quit-on-non-darwin** ([src/main/index.ts:463-465](src/main/index.ts)) — must become a conditional that respects `backgroundActivity.closeToTray`. When `true`, do NOT call `app.quit()`. When `false`, behave as today.
2. **Single-instance second-launch with tray** — second-launch must raise the window AND not double-register a tray icon. The single-instance handler creates the Tray once at first boot and reuses it.
3. **DB-sealed cron writes** — every cron callback that touches the DB needs the `if (!db) return` guard. Audit list: briefing, gmail-sync, calendar-sync, todoist-sync, knowledge-folder-sweep, entitlement-refresh, news-aggregate.
4. **powerMonitor pause/resume** — existing suspend handlers pause cron tasks. Background phase must NOT register new cron tasks that skip this lifecycle — go through the existing `scheduler.cronRegistry` + `registerLifecycleCallbacks` plumbing.
5. **Tray icon assets** — Win needs `.ico` (`build/icon.ico`), Mac needs Template-style `.png` @1x/@2x (`tray-iconTemplate.png` + `@2x.png`) for status bar dark/light auto-inversion. SVG-only is not enough (per `project_aria_brand_icon.md` memory — `.ico` / `.icns` deferred to packaging; this phase forces the issue for tray).

---

## Open items for the planner

- Where exactly the Tray gets constructed in `bootstrap()` — likely a new `src/main/tray/index.ts` with `initTray({ getMainWindow, getLogger })`.
- How catchup-on-unlock is triggered — a new `lifecycle/onUnlock` hook fired by the seal/unlock flow, or polling `dbHolder.db` from the cron registry?
- Tray badge implementation per platform — Windows: `Tray.setImage(withDotOverlay)`; macOS: `Tray.setTitle('•')` or image overlay. Decide in research.
- Test strategy — Playwright `_electron` cannot easily exercise tray. Vitest with mocked `electron` (`app`, `Tray`, `Notification`, `nativeImage`) covers the unit layer; manual UAT covers the OS-integration layer.

---

## Next step

Run `/gsd-plan-phase 12` to produce PLAN.md(s). Researcher should investigate: Electron 33 `Tray` API on Win+Mac (icon formats, click vs right-click handlers, balloon notifications deprecation), `app.setLoginItemSettings` differences between Win (registry HKCU\Run) vs Mac (Launch Services), and current `Notification` permission flow in Electron 33 on macOS Sonoma+.
