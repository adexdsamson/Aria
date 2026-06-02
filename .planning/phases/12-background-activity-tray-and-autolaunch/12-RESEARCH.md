# Phase 12: Background Activity (Tray + Auto-launch) — Research

**Researched:** 2026-05-22
**Domain:** Electron 33 tray icon, OS auto-launch, native notifications, background cron under sealed-DB conditions
**Confidence:** HIGH (Electron API surface verified against electronjs.org; codebase wiring verified line-by-line)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (do not re-decide)

1. **Sealed-DB behavior:** silent skip + gold tray-overlay-dot when at least one cron has been skipped since last unlock; on first unlock, run single-shot catchup per channel; clear dot after catchup.
2. **Auto-launch default OFF; first-X one-time toast.** `closeToTray` default `true`. First-X fires native notification "Aria is still running in the tray. Right-click the tray icon to quit." and sets `backgroundActivity.firstCloseToastShown=true`.
3. **Rich tray menu:** `Show Aria` / `Generate briefing now` / `Sync now` (Gmail/Calendar/Todoist submenu) / `Open approvals` / separator / `Quit Aria`. Windows: left-click → `Show Aria`, right-click → context menu. macOS: click → menu.
4. **Notification routes to `/briefing`.** macOS permission lazy. No quiet hours. Throttle: one per `briefingDateKey`. `backgroundActivity.notificationsEnabled` defaults `true`; when false, tray badge still updates.
5. **macOS dock always visible.** Closing window does NOT call `app.dock.hide()`.
6. **SQLite is source of truth.** Four new keys: `backgroundActivity.autoLaunch` (false), `.closeToTray` (true), `.notificationsEnabled` (true), `.firstCloseToastShown` (false). On `autoLaunch` change mirror to `app.setLoginItemSettings`. On boot, DB wins (reconcile OS → DB).

### Claude's Discretion
- Exact tray-badge implementation per platform (Win `setImage` swap, Mac `setTitle('•')` or image swap)
- File location of new `src/main/tray/index.ts` and lifecycle hooks
- Whether unlock-catchup is fired by `dbHolder` event vs. polling vs. callback registry
- Tray icon asset generation pipeline (electron-icon-builder vs. checked-in .ico/.png)
- Migration number for new `settings` keys (none needed — see Finding 1)

### Deferred Ideas (OUT OF SCOPE)
- Linux tray support (AppIndicator quirks deferred)
- Headless first-run (auto-launch always boots normally; window-hidden state only kicks in after first X)
- Background work while DB sealed beyond silent-skip (no notifications, no error counters)
- Quiet hours for notifications
- Multiple briefing notifications per day
</user_constraints>

---

<phase_requirements>
## Phase Requirements (inferred from CONTEXT.md)

| ID | Description | Research support |
|----|-------------|------------------|
| BG-01 | Closing main window hides to tray when `closeToTray=true`; quits otherwise; preserves macOS Cmd-Q behavior | `window-all-closed` rewrite (Finding 7); Decision 2/5 |
| BG-02 | Tray icon present on Win+Mac with platform-correct click + context-menu behavior | Tray API (Finding 1); Decision 3 |
| BG-03 | Sealed-DB cron callbacks early-return as no-op and set "pending catchup" flag for tray-dot | Cron audit (Finding 5); Decision 1 |
| BG-04 | First unlock fires single-shot catchup per channel; tray dot clears | Unlock-hook insertion point (Finding 6); Decision 1 |
| BG-05 | `app.setLoginItemSettings({ openAtLogin })` mirrors `backgroundActivity.autoLaunch`; DB wins on reconcile | setLoginItemSettings API (Finding 2); Decision 6 |
| BG-06 | Native notification on briefing-ready focuses window + routes to `/briefing`; one per briefing date | Notification API (Finding 3); Decision 4 |
| BG-07 | First-X toast fires once; `firstCloseToastShown` guards re-fires | Decision 2; settings KV pattern |
| BG-08 | Settings → Behaviour section exposes 3 toggles (autoLaunch, closeToTray, notificationsEnabled) | Renderer settings panel — pattern in `IntegrationsSection` |
</phase_requirements>

---

## Summary

Phase 12 is a self-contained main-process feature with a thin renderer settings surface. The Electron API surface is small (`Tray`, `Menu`, `nativeImage`, `Notification`, `app.setLoginItemSettings`, `BrowserWindow` close handler) and well-documented. The non-obvious work is (a) the sealed-DB catchup wiring, (b) tray-icon asset generation since `nativeImage.composite()` does not exist [VERIFIED: electronjs.org/docs/latest/api/native-image], and (c) `openAsHidden` is deprecated on macOS 13+ [VERIFIED: electronjs.org/docs/latest/api/app] which contradicts CONTEXT.md Decision 6's intent.

**Critical drift from CONTEXT.md:** Phase 8 produced `learned_preferences` (single-row closed-shape Zod payload) — NOT a generic `user_prefs` key-value table. The actual generic KV store in Aria is the **`settings` table** from migration 001 (`k TEXT PRIMARY KEY, v TEXT NOT NULL`), already used by `src/main/ipc/briefing.ts` for briefing-time and by `learning/prefs.ts` for the reset journal. The four `backgroundActivity.*` keys should go into `settings`, no migration required. The planner must rewrite the "user_prefs" wording in CONTEXT.md Decision 6 as an addendum (same pattern as the Phase 10 / Phase 11 fictional-schema reconciliations in MEMORY).

**Primary recommendation:** Build a new `src/main/tray/` module that takes `{ getMainWindow, scheduler, dbHolder, logger, emitToRenderer }` as deps. Pre-bake two `.ico` variants (plain + gold-dot) at build time via a one-shot Node script; macOS uses `Tray.setTitle('•')` toggle for the badge (cheaper than a second Template image). Wire `window-all-closed` to a `branchOnPref()` helper. Add a `lifecycle/onUnlock.ts` callback registry fired from `src/main/ipc/onboarding.ts` after `holder.db = db`. Use existing `settings` KV table for prefs — no new migration.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tray icon + menu lifecycle | Main process (`src/main/tray/`) | — | Tray API is main-only; module-level reference required to prevent GC |
| `app.setLoginItemSettings` mirror | Main process | — | Touches Win registry / Mac Launch Services |
| `Notification` show + click handler | Main process | Renderer (receives route push) | Notification API is main-only; click handler calls `webContents.send('aria:navigate', '/briefing')` |
| `backgroundActivity.*` pref reads/writes | Main process (settings KV) | Renderer (IPC) | SQLite source of truth per Decision 6 |
| `window-all-closed` branch | Main process (`src/main/index.ts`) | — | Existing handler at L463-465 |
| Sealed-DB cron guards | Main process (each `*/schedule.ts`) | — | Each cron callback needs `if (!db) return` + skip-counter increment |
| Catchup-on-unlock dispatch | Main process (new `lifecycle/onUnlock.ts`) | — | Fires after `holder.db = db` in onboarding.ts |
| Settings → Behaviour toggles UI | Renderer | Main IPC | New section in Settings; follows IntegrationsSection pattern |
| Tray badge state | Main process (in-memory counter + tray instance) | — | Cleared after catchup pass completes |

---

## Standard Stack

All Electron-builtin; no new npm dependencies. [VERIFIED: package.json — `electron@41.x`, no `electron-icon-builder`, no `auto-launch`]

| API / Module | Status | Purpose |
|--------------|--------|---------|
| `electron.Tray` | builtin | Tray icon + context menu host [CITED: electronjs.org/docs/latest/api/tray] |
| `electron.Menu` / `MenuItem` | builtin | Rich tray context menu |
| `electron.nativeImage` | builtin | Load `.ico` (Win) / Template `.png` (Mac) [CITED: electronjs.org/docs/latest/api/native-image] |
| `electron.Notification` | builtin | Briefing-ready + first-X toast [CITED: electronjs.org/docs/latest/api/notification] |
| `app.setLoginItemSettings` | builtin | Auto-launch on Win+Mac [CITED: electronjs.org/docs/latest/api/app] |
| `app.getLoginItemSettings` | builtin | Boot-time reconciler read |
| `BrowserWindow.on('close', e)` | builtin | Intercept X click for closeToTray branch |
| Existing `settings(k,v)` table | mig 001 | `backgroundActivity.*` keys [VERIFIED: 001_init.sql L14-17] |

### Optional dev-time helper (recommended)

| Package | Purpose | Use |
|---------|---------|-----|
| `electron-icon-builder` (^2.x) | One-shot generation of `.ico` / `.icns` / Template `.png` set from `build/icon.svg` | Run via `npm run icons` script; output checked into `build/`. NOT a runtime dep. |

If skipped: hand-author `build/tray-icon.ico` + `build/tray-iconTemplate.png` + `build/tray-iconTemplate@2x.png` using any image editor; size 16×16 (Win) and 22×22 logical pts (Mac status bar).

### Version verification

```bash
npm view electron-icon-builder version  # most recent stable
```
[ASSUMED: latest is 2.0.x — verify before installing]

---

## Architecture Patterns

### System Architecture Diagram

```
                ┌─────────────────────────────────────────┐
                │           main process boot             │
                │                                         │
  app.whenReady()│  ┌───────────────┐   ┌──────────────┐  │
        ─────────▶  │  bootstrap()  │──▶│ createTray() │  │
                │  └───────┬───────┘   └──────┬───────┘  │
                │          │                  │          │
                │          ▼                  │          │
                │  ┌───────────────┐          │          │
                │  │ registerHandlers│          │          │
                │  └───────┬───────┘          │          │
                │          │                  │          │
                │          ▼                  ▼          │
                │  ┌───────────────────────────────┐    │
                │  │ scheduler.cronRegistry         │    │
                │  │  briefing / gmail / calendar / │    │
                │  │  todoist / kf-sweep / entl     │    │
                │  └────────────┬──────────────────┘    │
                │               │                        │
                │               ▼ each tick              │
                │  ┌───────────────────────────────┐    │
                │  │ if (!db) {                     │    │
                │  │   pendingCatchup.add(channel); │    │
                │  │   tray.markBadge();            │    │
                │  │   return;                      │    │
                │  │ }                              │    │
                │  └───────────────────────────────┘    │
                └─────────────────────────────────────────┘
                              │
                              │ user unlocks (onboardingUnlock IPC)
                              ▼
                ┌─────────────────────────────────────────┐
                │ holder.db = db                          │
                │   ↓                                     │
                │ fireUnlockCallbacks()                   │
                │   ↓                                     │
                │ for (chan of pendingCatchup):           │
                │   runOnce(chan)  // single-shot         │
                │ pendingCatchup.clear(); tray.clearBadge │
                └─────────────────────────────────────────┘

  user clicks X
    ↓
  win.on('close', e):
    if (settings.closeToTray && !app.isQuitting):
      e.preventDefault(); win.hide();
      if (!firstCloseToastShown): showFirstCloseToast(); mark shown
    else: (default quit path)

  cron-fired briefing complete
    ↓
  emitToRenderer + new Notification({...}).show()
    notif.on('click', () => { win.show(); webContents.send('aria:navigate','/briefing') })
```

### Recommended Project Structure

```
src/main/tray/
├── index.ts              # createTray(deps): { dispose, setBadge, clearBadge }
├── menu.ts               # buildContextMenu(state): Menu
├── icons.ts              # loadTrayIcon(variant: 'plain'|'badged'): NativeImage
└── notify.ts             # showBriefingReadyNotification + first-close toast

src/main/lifecycle/
├── onUnlock.ts           # NEW — registerOnUnlock + fireOnUnlock callback registry
└── pendingCatchup.ts     # NEW — Set<CatchupChannel> + add/drain/clear API

src/main/background/
└── prefs.ts              # read/write `backgroundActivity.*` via settings KV + autoLaunch mirror

src/main/ipc/background.ts # new IPC handler: get-prefs, set-prefs

src/renderer/features/settings/
└── BehaviourSection.tsx  # 3 toggles + first-X toast preview

build/
├── tray-icon.ico                # Win plain (16×16 with @2x embedded)
├── tray-icon-badged.ico         # Win + gold dot overlay
├── tray-iconTemplate.png        # Mac 22×22 (auto-inverts)
└── tray-iconTemplate@2x.png     # Mac 44×44
```

### Pattern 1: Tray creation with GC pinning

```typescript
// Source: electronjs.org/docs/latest/api/tray + electron/electron#33040 GC fix
// MODULE-LEVEL ref is required — even after the 33040 fix, the convention
// remains to hold a strong reference so the Tray cannot disappear in prod.
let _tray: Tray | null = null;

export function createTray(deps: TrayDeps): TrayHandle {
  const icon = loadTrayIcon('plain');
  _tray = new Tray(icon);
  _tray.setToolTip('Aria — chief of staff');
  if (process.platform === 'darwin') {
    // macOS: click opens menu (Apple convention for status items).
    _tray.on('click', () => _tray?.popUpContextMenu());
  } else {
    // Windows: left-click shows window; right-click opens menu (default).
    _tray.on('click', () => deps.getMainWindow()?.show());
  }
  _tray.setContextMenu(buildContextMenu(deps));
  return {
    setBadge: () => _tray?.setImage(loadTrayIcon('badged')),
    clearBadge: () => _tray?.setImage(loadTrayIcon('plain')),
    rebuildMenu: () => _tray?.setContextMenu(buildContextMenu(deps)),
    dispose: () => { _tray?.destroy(); _tray = null; },
  };
}
```

### Pattern 2: Cron sealed-DB guard (apply to all 6 schedulers)

```typescript
// Source: pattern in src/main/briefing/schedule.ts L65-86 — verified
const task = cronImpl.schedule(expr, async () => {
  const db = dbHolder.db;
  if (!db) {
    pendingCatchup.add('briefing');     // NEW — module-level set
    tray.setBadge();                    // NEW — visual cue
    return;                             // silent skip per Decision 1
  }
  // ... existing fired-once-per-day dedupe ...
  await run(today);
}, { timezone: tz });
```

All 6 cron registrations need this prelude:
- `src/main/briefing/schedule.ts` — briefing
- `src/main/insights/schedule.ts` — insights-nightly
- `src/main/recap/schedule.ts` — recap-monday
- `src/main/learning/schedule.ts` — learning-nightly
- `src/main/entitlement/schedule.ts` — entitlement-refresh
- gmail-sync + calendar-sync cron registered inside their IPC handlers
- knowledge-folder sweep — `src/main/folder-ingestion/lifecycle.ts`

[VERIFIED via grep `cronImpl\.schedule` — 5 files in `src/main`, plus 2 sync crons registered by IPC handlers, plus knowledge-folder lifecycle = 8 callsites total]

### Pattern 3: Catchup-on-unlock callback registry

```typescript
// src/main/lifecycle/onUnlock.ts — NEW
const callbacks: Array<(db: Db) => void | Promise<void>> = [];
export function registerOnUnlock(cb: (db: Db) => void | Promise<void>): () => void {
  callbacks.push(cb);
  return () => { const i = callbacks.indexOf(cb); if (i >= 0) callbacks.splice(i, 1); };
}
export async function fireOnUnlock(db: Db, logger: Logger): Promise<void> {
  for (const cb of callbacks) {
    try { await cb(db); } catch (err) {
      logger.warn({ scope: 'onUnlock', err: (err as Error).message }, 'unlock callback threw');
    }
  }
}
```

Wire site: `src/main/ipc/onboarding.ts` L53 — after `holder.db = db`, add:
```typescript
holder.db = db;
void fireOnUnlock(db, logger);   // NEW — runs catchup pass
```

Tray module registers a catchup callback at boot:
```typescript
registerOnUnlock(async (db) => {
  for (const chan of pendingCatchup.drain()) {
    await runChannelOnce(chan, db);  // single-shot per Decision 1
  }
  tray.clearBadge();
});
```

### Pattern 4: `window-all-closed` rewrite

```typescript
// REPLACES src/main/index.ts L463-465
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;  // mac convention preserved
  const closeToTray = readPref('backgroundActivity.closeToTray', true);
  if (closeToTray) return;                    // stay alive in tray
  app.quit();
});
```

But the actual hide-on-close interception must happen in `BrowserWindow.on('close', e)` BEFORE window-all-closed fires, otherwise the window is destroyed and the X click closes the app even when closeToTray=true. See Pattern 5.

### Pattern 5: BrowserWindow close interception

```typescript
// In createMainWindow(), after `new BrowserWindow(...)`:
let appIsQuitting = false;
app.on('before-quit', () => { appIsQuitting = true; });

win.on('close', (e) => {
  if (process.platform === 'darwin') {
    // macOS: red-button hides, Cmd-Q quits. Honor before-quit flag.
    if (!appIsQuitting) { e.preventDefault(); win.hide(); }
    return;
  }
  // Windows: respect closeToTray pref.
  const closeToTray = readPref('backgroundActivity.closeToTray', true);
  if (closeToTray && !appIsQuitting) {
    e.preventDefault();
    win.hide();
    void maybeShowFirstCloseToast();
  }
});
```

### Pattern 6: setLoginItemSettings mirror

```typescript
// On boot — reconcile DB → OS
const dbPref = readPref('backgroundActivity.autoLaunch', false);
app.setLoginItemSettings({ openAtLogin: dbPref });
// On user toggle — write DB first, mirror to OS
function setAutoLaunch(value: boolean): void {
  writePref('backgroundActivity.autoLaunch', value);
  app.setLoginItemSettings({ openAtLogin: value });
  // NOTE: openAsHidden is DEPRECATED on macOS 13+ — do NOT pass it on darwin.
  // Phase 12 V1: skip openAsHidden entirely; the renderer can detect first-launch-
  // after-autolaunch via a process.argv flag (--was-auto-launched) passed in args
  // on Windows. macOS auto-launched apps come up visible; that is acceptable
  // behavior per Decision 5 (dock always visible).
}
```

### Anti-Patterns to Avoid

- **Do not store the Tray inside a function-local variable** — Tray must be module-level to survive GC [CITED: github.com/electron/electron#33040 historical bug; convention remains].
- **Do not call `nativeImage.composite()`** — the method does not exist [VERIFIED: electronjs.org native-image API]. Pre-bake icon variants at build time.
- **Do not pass `openAsHidden: true` on macOS 13+** — deprecated and no-op [VERIFIED: electronjs.org/docs/latest/api/app].
- **Do not call `app.dock.hide()` on macOS** — violates Decision 5.
- **Do not register new cron tasks outside `scheduler.cronRegistry` + `registerLifecycleCallbacks`** — bypasses powerMonitor suspend/resume.
- **Do not write `backgroundActivity.autoLaunch` to the DB without also calling `setLoginItemSettings`** — they will drift; on next boot the reconciler will pick whichever it polls first, leading to nondeterministic behavior.
- **Do not skip the `if (!db) return` guard inside cron callbacks** — the cron registry is registered BEFORE first unlock per existing pattern (see Plan 08.1-02 stub-then-real pattern in `src/main/index.ts` L294 + L313-325).

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Auto-launch on Win/Mac | Direct registry / launchd writes | `app.setLoginItemSettings` | Cross-platform abstraction handles Win HKCU\Run + Mac SMAppService (mac 13+) [CITED: electronjs.org/api/app] |
| Tray context menu | Custom HTML window | `Menu.buildFromTemplate` | Native OS menu — matches platform look + keyboard nav |
| Notification permission flow | Custom prompt UI | `new Notification({...}).show()` | macOS prompts natively on first show; Windows uses Action Center |
| Icon overlay/composition | Canvas-in-main | Pre-bake variants at build | `nativeImage.composite` does not exist [VERIFIED] |
| Generic key-value prefs | New table + migration | `settings(k,v)` table from migration 001 | Already exists; already used by briefing time + learning reset journal |
| Second-instance hide-to-tray race | Custom IPC | Existing `acquireSingleInstanceLock` | Already raises window on second-launch [VERIFIED: src/main/single-instance.ts L52-69] |
| Catchup scheduling | Re-run cron N times | Single-shot per channel | Matches Decision 1 ("not re-fire every cron tick that was missed") |

---

## Runtime State Inventory

> Phase 12 modifies runtime behavior + introduces OS-level registration. Inventory is required.

| Category | Items found | Action required |
|----------|-------------|------------------|
| Stored data | `settings` KV table gains 4 new keys (`backgroundActivity.{autoLaunch,closeToTray,notificationsEnabled,firstCloseToastShown}`). No new tables. | Code edits only — keys lazy-inserted on first write (KV `INSERT ... ON CONFLICT`). |
| Live service config | None — no external services. | None. |
| OS-registered state | **Windows:** `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` gains an `Aria` entry when `autoLaunch=true`. **macOS:** Login Items list gains Aria. Both managed by `app.setLoginItemSettings`. | On uninstall, electron-builder NSIS / DMG flows should run `setLoginItemSettings({openAtLogin:false})`. Document for Phase 8 release scripts; otherwise stale registry entry persists after uninstall. |
| Secrets / env vars | None. No new secrets. | None. |
| Build artifacts | `build/tray-icon.ico`, `build/tray-icon-badged.ico`, `build/tray-iconTemplate.png` + `@2x`. Currently only `build/icon.svg` exists [VERIFIED: ls build/]. The deferred `.ico/.icns` work from `project_aria_brand_icon.md` MEMORY is forced here. | Generate via one-shot `electron-icon-builder` invocation OR hand-author + commit. Add to `electron-builder.files` (already covered by `"files": ["out/**/*", ...]` IF placed under `out/`; otherwise add `"extraResources": ["build/tray-*"]`). |

---

## Common Pitfalls

### Pitfall 1: Tray reference garbage-collected — icon disappears in prod
**What goes wrong:** Tray declared in a function scope is GC'd at random; the icon vanishes from the system tray (intermittent, only in packaged builds).
**Why:** Historical Electron bug fixed in #33040 but the convention remains.
**How to avoid:** Module-level `let _tray: Tray | null = null` ref. Never let `_tray` go out of scope until `app.quit`.
**Warning signs:** Tray icon disappears after a few minutes / after window close; works fine in `electron .` dev mode.

### Pitfall 2: `nativeImage.composite()` does not exist
**What goes wrong:** Plan to draw a gold dot onto the base icon at runtime; compiles fine if typed loosely (`as any`), throws `TypeError: not a function` at call time.
**How to avoid:** Pre-bake two `.ico` variants at build time. For macOS, use `tray.setTitle('•')` toggle instead of a second image — cheaper and avoids managing two Template PNGs.

### Pitfall 3: `openAsHidden` no-op on macOS 13+
**What goes wrong:** CONTEXT.md Decision 6 says to call `setLoginItemSettings({openAtLogin:value, openAsHidden:value})`. On macOS Sonoma+ `openAsHidden` is a deprecated no-op. The auto-launched app comes up visible regardless.
**How to avoid:** Drop `openAsHidden` entirely. On macOS, accept "comes up visible on autolaunch" — matches Decision 5 (dock always visible) anyway. On Windows, use `args: ['--was-auto-launched']` and have the renderer skip first-window-show when that flag is present.
**Warning signs:** macOS user enables auto-launch + closeToTray, expects silent boot, gets the full window. Document this as expected.

### Pitfall 4: `window-all-closed` quits before close-handler interception
**What goes wrong:** The X click destroys the BrowserWindow, then `window-all-closed` fires and quits the app — bypassing closeToTray.
**How to avoid:** Intercept at `BrowserWindow.on('close', e)` with `e.preventDefault(); win.hide()`. The `window-all-closed` rewrite is a secondary defense, not the primary.
**Warning signs:** closeToTray=true but app fully exits on X click.

### Pitfall 5: Pre-unlock IPC handler poisoning (regression of [IPC db-null skip trap])
**What goes wrong:** New background IPC channels registered pre-unlock are added to the `skip` set in `registerHandlers`, then never re-registered post-unlock. Renderer settings panel hits "No handler for aria:background:get-prefs".
**How to avoid:** Background prefs IPC channels work fine pre-unlock (they read `settings` table which exists from migration 001 — but only AFTER the DB is open). If pre-unlock reads are needed (e.g., for closeToTray on first window-close before unlock), use a **defaults-only path** that returns hardcoded defaults when `dbHolder.db` is null. Do NOT register a stub-then-replace pattern — defaults-only is simpler.
**Warning signs:** First X click before unlock crashes or shows wrong behavior. Test: launch app, click X immediately without unlocking — should follow the default `closeToTray=true` path.

### Pitfall 6: Notification permission denial breaks the briefing flow
**What goes wrong:** macOS user denies notification permission on first prompt. `new Notification({...}).show()` becomes a silent no-op; the user never knows their briefing is ready.
**How to avoid:** Tray badge stays as fallback. The briefing IPC `emitToRenderer(BRIEFING_READY, ...)` still fires regardless — if the window is open the user sees in-app indication. Phase 12 V1 does NOT add a settings prompt to grant permission; the OS handles it.
**Warning signs:** User reports "I never get notifications" — first diagnostic is System Settings → Notifications → Aria.

### Pitfall 7: Single-instance second-launch double-creates Tray
**What goes wrong:** User clicks the auto-launch shortcut while Aria is already running. Without guard, the new process exits via single-instance-lock — but if Tray creation lives outside `acquireSingleInstanceLock`, brief lifecycle issues can leak.
**How to avoid:** Tray is created in `bootstrap()` which only runs AFTER `acquireSingleInstanceLock` returns true. The second-instance-launch path exits via `app.quit()` BEFORE `app.whenReady().then(bootstrap)` resolves [VERIFIED: src/main/index.ts L450-461 + single-instance.ts L36-41].
**Warning signs:** Two tray icons on Win; menu actions fire twice.

### Pitfall 8: Quit-from-tray while sealed double-prompts for unlock
**What goes wrong:** User clicks `Quit Aria` in tray menu. App tries to flush state to DB → DB sealed → unlock prompt appears → user confused.
**How to avoid:** `Quit Aria` calls `app.quit()` directly. `app.on('before-quit')` sets `appIsQuitting = true` so close-handler skips hide. No DB writes are required for clean exit — existing `before-quit` handler at L467-469 only stops knowledge-folder lifecycle (db-safe).
**Warning signs:** Unlock screen appears on `Quit Aria` click.

### Pitfall 9: Tray badge on Windows HiDPI displays
**What goes wrong:** A 16×16 `.ico` looks blurry / too small on 4K displays at 200% scaling.
**How to avoid:** Embed multiple sizes in the `.ico` file (16, 24, 32, 48). `electron-icon-builder` does this automatically. Hand-authored single-size `.ico` will look bad.
**Warning signs:** Tray icon blurry on user's HiDPI laptop.

### Pitfall 10: `app.requestSingleInstanceLock` + auto-launch race
**What goes wrong:** On Windows, fast user-switching or login-script timing can fire two Aria.exe invocations within a few ms. Second instance can exit before the first's tray is created.
**How to avoid:** This is the existing single-instance contract — already handled by `acquireSingleInstanceLock`. Phase 12 inherits the same guarantee.

---

## Code Examples

### Reading + writing settings KV (verified pattern)
```typescript
// Source: src/main/ipc/briefing.ts L115-128 — verified
function readBgPref<T extends string | boolean>(
  db: Db, key: string, fallback: T,
): T {
  const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(`backgroundActivity.${key}`) as
    { v?: string } | undefined;
  if (!row?.v) return fallback;
  if (typeof fallback === 'boolean') return (row.v === '1') as T;
  return row.v as T;
}

function writeBgPref(db: Db, key: string, value: string | boolean): void {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : value;
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(`backgroundActivity.${key}`, v);
}
```

### Briefing-ready notification with click-to-route
```typescript
// Source: electronjs.org/docs/latest/api/notification + Aria emitToRenderer pattern
import { Notification } from 'electron';

export function showBriefingReadyNotification(
  win: BrowserWindow,
  summary: { emails: number; events: number; news: number },
): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: 'Your morning briefing is ready',
    body: `${summary.emails} emails, ${summary.events} events, ${summary.news} news`,
    silent: false,
  });
  n.on('click', () => {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send('aria:navigate', '/briefing');
  });
  n.show();
}
```

### Tray menu template
```typescript
// Source: electronjs.org/docs/latest/api/menu + Decision 3
import { Menu, MenuItemConstructorOptions } from 'electron';

export function buildContextMenu(deps: TrayDeps): Menu {
  const dbOpen = deps.dbHolder.db !== null;
  const template: MenuItemConstructorOptions[] = [
    { label: 'Show Aria', click: () => deps.getMainWindow()?.show() },
    {
      label: 'Generate briefing now',
      enabled: dbOpen,
      toolTip: dbOpen ? undefined : 'Unlock Aria first',
      click: () => deps.ipc.invoke('aria:briefing:generate-now'),
    },
    {
      label: 'Sync now',
      submenu: [
        { label: 'Gmail',    enabled: dbOpen && deps.connected.gmail,    click: () => deps.ipc.invoke('aria:gmail:force-sync') },
        { label: 'Calendar', enabled: dbOpen && deps.connected.calendar, click: () => deps.ipc.invoke('aria:calendar:force-sync') },
        { label: 'Todoist',  enabled: dbOpen && deps.connected.todoist,  click: () => deps.ipc.invoke('aria:todoist:force-sync') },
      ],
    },
    { label: 'Open approvals', click: () => { deps.getMainWindow()?.show(); deps.navigate('/approvals'); } },
    { type: 'separator' },
    { label: 'Quit Aria', click: () => { (global as any).__ariaIsQuitting = true; app.quit(); } },
  ];
  return Menu.buildFromTemplate(template);
}
```

---

## State of the Art

| Old approach | Current approach | Impact |
|--------------|------------------|--------|
| `app.setLoginItemSettings({openAsHidden})` cross-platform | Win uses `args`; mac 13+ no-op on `openAsHidden` | Drop `openAsHidden` for macOS; Decision 6 wording needs correction |
| `nativeImage.composite()` overlays | Method never existed; pre-bake variants | Build pipeline needs `.ico` generation |
| Tray balloon notifications on Windows | Deprecated; use `Notification` API | Already aligned — Aria uses `Notification` |
| Manual SMLoginItemSetEnabled on macOS | `setLoginItemSettings` (uses SMAppService internally on mac 13+) | Stays cross-platform |

**Deprecated / outdated:**
- `keytar` for credentials — replaced by `safeStorage` (already done in Phase 1)
- `electron.Tray.displayBalloon` — replaced by `Notification` API
- `setLoginItemSettings({openAsHidden})` on macOS 13+

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `electron-icon-builder@2.x` is the current stable version | Standard Stack | Low — `npm view` will resolve at install |
| A2 | Mac status-bar icons render at 22×22 logical points | Project Structure | Low — easily corrected by re-export |
| A3 | `Tray.setTitle('•')` toggle is acceptable as Mac badge UX | Recommendation | Medium — if rejected, fall back to pre-baked Template @2x variant |
| A4 | The 8 cron callsites listed cover all background work | Cron audit | Medium — planner should re-grep `cronImpl\.schedule` immediately before Wave 1 to confirm |
| A5 | macOS auto-launched-app coming up visible (not hidden) is acceptable trade given Decision 5 | Pitfall 3 | Low — Decision 5 explicitly says dock always visible; visible-on-autolaunch is consistent |
| A6 | The renderer can route via `webContents.send('aria:navigate', path)` and a renderer listener pushes the route | Notification click handler | Low — if no such channel exists, add it; pattern matches existing `ENTITLEMENT_STATE_CHANGED` push |
| A7 | The current `before-quit` handler (L467) is db-safe and does not need an unlock prompt to run | Pitfall 8 | Low — verified: only calls `stopKnowledgeFolderLifecycle` which has its own db-null guard |

---

## Open Questions

1. **CONTEXT.md says `user_prefs` table — actual table is `settings`.**
   - What we know: Phase 8 produced `learned_preferences` (single-row Zod-validated payload) NOT a generic typed-prefs KV. The generic KV is `settings(k,v)` from mig 001.
   - Recommendation: planner adds a CONTEXT addendum (same pattern as Phase 10 / Phase 11 fictional-schema fixes per MEMORY) clarifying that `backgroundActivity.*` keys live in `settings`. No migration needed.

2. **Tray badge UX on macOS: `setTitle('•')` vs second Template image.**
   - What we know: `setTitle` is cheaper; renders next to the icon in the menu bar. Template image swap is more visually consistent across platforms.
   - Recommendation: ship `setTitle('•')` for V1 to skip the @2x Template generation. Revisit if UAT finds it ugly.

3. **First-X toast uses Notification API — what if permission denied on mac?**
   - What we know: Decision 4 says permission is lazy via Notification API. First X click might be the FIRST notification ever shown.
   - Recommendation: tolerate denial — the user discovers the tray icon themselves on next interaction. Document in UAT.

4. **electron-icon-builder vs hand-authored assets.**
   - What we know: `build/icon.svg` exists; no `.ico/.icns` checked in (deferred per `project_aria_brand_icon.md`).
   - Recommendation: one-shot `npx electron-icon-builder --input=build/icon.svg --output=build/` script in package.json as `"icons:gen"`. Commit the outputs to git so CI doesn't need to regenerate. Hand-author the badged variant (single overlay dot on the same source SVG via a `build/icon-badged.svg`).

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| electron `Tray` | BG-02 | ✓ | 41.x (Aria pin) | — |
| electron `Notification` | BG-06 / BG-07 | ✓ | 41.x | Tray badge fallback if perm denied |
| electron `app.setLoginItemSettings` | BG-05 | ✓ | 41.x | — |
| Windows OS | BG-01..08 | dev machine | 11 Pro 26200 | — |
| macOS dev access | BG-01..08 manual UAT | likely absent | — | Test on Windows; defer macOS UAT to next session with mac hardware |
| `electron-icon-builder` (dev) | Tray icon assets | ✗ | — | Hand-author `.ico` / Template PNGs in any image editor |

**Missing dependencies with fallback:** electron-icon-builder — solvable with hand-authored assets.
**Missing dependencies with no fallback:** macOS hardware for UAT — Phase 12 PLAN.md should explicitly mark macOS tray + autolaunch verification as "deferred to mac session" (similar to Phase 5 Outlook OAuth pattern in MEMORY).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2 |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run tests/unit/main/tray --passWithNoTests` |
| Full suite command | `npx vitest run --passWithNoTests` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|-------------|
| BG-01 | `window-all-closed` respects `closeToTray` pref | unit (mocked app) | `npx vitest run tests/unit/main/index-close-handler.spec.ts` | ❌ Wave 0 |
| BG-01 | `BrowserWindow.on('close')` intercepts when `closeToTray=true` and not quitting | unit | same file | ❌ Wave 0 |
| BG-02 | Tray context menu items present + enabled-state respects DB-open | unit (mock electron) | `npx vitest run tests/unit/main/tray/menu.spec.ts` | ❌ Wave 0 |
| BG-02 | Win left-click shows window; Mac click opens menu | unit (platform-stub) | `npx vitest run tests/unit/main/tray/index.spec.ts` | ❌ Wave 0 |
| BG-03 | Cron callback early-returns when `db=null` + adds to pendingCatchup + sets badge | unit | `npx vitest run tests/unit/main/briefing/schedule.spec.ts` (extend) | ✅ extend existing |
| BG-04 | `fireOnUnlock` drains pendingCatchup once per channel + clears badge | unit | `npx vitest run tests/unit/main/lifecycle/onUnlock.spec.ts` | ❌ Wave 0 |
| BG-05 | `setAutoLaunch(true)` writes settings + calls `app.setLoginItemSettings` | unit (spy on app) | `npx vitest run tests/unit/main/background/prefs.spec.ts` | ❌ Wave 0 |
| BG-05 | Boot reconciler: DB pref wins on disagreement | unit | same file | ❌ Wave 0 |
| BG-06 | Notification.on('click') focuses window + sends navigate('/briefing') | unit (mock Notification) | `npx vitest run tests/unit/main/tray/notify.spec.ts` | ❌ Wave 0 |
| BG-06 | One notification per `briefingDateKey` (throttle) | unit | same file | ❌ Wave 0 |
| BG-07 | First X click shows toast + flips `firstCloseToastShown`; second X click does NOT | unit | `npx vitest run tests/unit/main/index-close-handler.spec.ts` | ❌ Wave 0 |
| BG-08 | Renderer Settings → Behaviour wires 3 toggles via IPC | UI | `npx vitest run tests/unit/renderer/BehaviourSection.spec.tsx` | ❌ Wave 0 |
| Static | cron callsites all carry `if (!db) return` + `pendingCatchup.add` | static grep | `npx vitest run tests/static/cron-seal-guard.spec.ts` | ❌ Wave 0 |

### Sampling rate
- **Per task commit:** `npx vitest run tests/unit/main/tray tests/unit/main/lifecycle/onUnlock.spec.ts --passWithNoTests`
- **Per wave merge:** `npx vitest run --passWithNoTests`
- **Phase gate:** Full suite green + manual UAT on Win (mac UAT deferred per Environment Availability)

### Wave 0 gaps
- [ ] `tests/unit/main/tray/index.spec.ts` — Tray creation + click handlers per platform
- [ ] `tests/unit/main/tray/menu.spec.ts` — context menu state matrix
- [ ] `tests/unit/main/tray/notify.spec.ts` — briefing notification + click route
- [ ] `tests/unit/main/lifecycle/onUnlock.spec.ts` — callback registry + catchup drain
- [ ] `tests/unit/main/background/prefs.spec.ts` — KV read/write + setLoginItemSettings mirror
- [ ] `tests/unit/main/index-close-handler.spec.ts` — close interception + window-all-closed branch
- [ ] `tests/unit/renderer/BehaviourSection.spec.tsx` — 3-toggle UI
- [ ] `tests/static/cron-seal-guard.spec.ts` — static grep that all 8 cron callsites carry the guard
- [ ] Extend `tests/unit/main/briefing/schedule.spec.ts` — sealed-DB skip case
- [ ] Manual UAT script `12-UAT.md` — Win + mac sections; mac marked deferred

---

## Security Domain

### Applicable ASVS Categories

| ASVS category | Applies | Standard control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session management | no | — |
| V4 Access control | yes | Tray menu items that touch DB are disabled when sealed; sealed-cron guard prevents writes |
| V5 Input validation | yes | `backgroundActivity.*` IPC payloads validated against a closed boolean shape |
| V6 Cryptography | no | No new secrets introduced |

### Known threat patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Auto-launch enabled by silent IPC call without user consent | Elevation | All 3 toggles are user-visible in Settings → Behaviour; no auto-enable on update |
| Tray menu action fires DB write while sealed | Tampering | Menu items that touch DB are `enabled: false` when `dbHolder.db === null` |
| Notification click navigates to unauthorized route | Information Disclosure | Hard-coded `/briefing` route only; no user-controlled route in payload |
| Background cron runs sensitive work without unlock | Information Disclosure | Decision 1 silent-skip pattern — no LLM calls, no network, no DB writes when sealed |
| `setLoginItemSettings` path argument injection | Tampering | We never pass user-controlled `path` / `args`; the default `process.execPath` is used |

---

## Sources

### Primary (HIGH confidence)
- electronjs.org/docs/latest/api/tray — Tray API + platform behavior
- electronjs.org/docs/latest/api/native-image — confirms NO `composite()` method
- electronjs.org/docs/latest/api/notification — Notification main-process API
- electronjs.org/docs/latest/api/app — `setLoginItemSettings` + `openAsHidden` deprecation on mac 13+
- electronjs.org/docs/latest/tutorial/tray — tray menu template patterns
- `src/main/index.ts` L463-469 — `window-all-closed` + `before-quit` current state [VERIFIED]
- `src/main/briefing/schedule.ts` — cron registration + suspend/resume pattern [VERIFIED]
- `src/main/lifecycle/powerMonitor.ts` — `registerLifecycleCallbacks` API [VERIFIED]
- `src/main/single-instance.ts` — second-instance handling [VERIFIED]
- `src/main/ipc/onboarding.ts` L46-67 — `holder.db = db` insertion point for unlock hook [VERIFIED]
- `src/main/db/migrations/001_init.sql` L14-17 — `settings(k,v)` KV table [VERIFIED]
- `src/main/ipc/briefing.ts` L115-128 — settings read/write pattern [VERIFIED]

### Secondary (MEDIUM confidence)
- github.com/electron/electron#33040 — historical Tray GC fix (convention reinforced)
- github.com/electron/electron#15309 — `openAsHidden` not working on macOS

### Tertiary (LOW confidence / ASSUMED)
- A1: electron-icon-builder current version
- A3: `setTitle('•')` UX acceptability on Mac

---

## Recommended Task Breakdown (3 PLAN.md splits)

The planner should consider three sequential plans, executed in order:

### Plan 12-01 — Foundation: prefs + close-handler + window-all-closed rewrite

**Touches:** `src/main/background/prefs.ts` (NEW), `src/main/ipc/background.ts` (NEW), `src/main/index.ts` (close handler + window-all-closed), renderer `BehaviourSection.tsx` (NEW), `shared/ipc-contract.ts` (3 new channels).

**Why first:** Establishes the source-of-truth pref reads + writes that everything else depends on. Decoupled from Tray work so it can land + ship even if Tray runs into asset-pipeline blockers. Includes the renderer settings UI so the user can flip toggles for manual UAT.

**Wave 0 tests:** `prefs.spec.ts`, `index-close-handler.spec.ts`, `BehaviourSection.spec.tsx`.

**Deliverable:** User can toggle closeToTray + autoLaunch + notifications in Settings; closing the window respects the pref; auto-launch shortcut is registered/unregistered on toggle. No tray icon yet — closing the window with closeToTray=true currently means "window hidden, can only re-show via taskbar / dock".

---

### Plan 12-02 — Tray icon + menu + sealed-DB guards + unlock catchup

**Touches:** `src/main/tray/{index,menu,icons}.ts` (NEW), `src/main/lifecycle/{onUnlock,pendingCatchup}.ts` (NEW), `src/main/ipc/onboarding.ts` (one-line fireOnUnlock hook), all 8 cron callsites (sealed-DB guard), `build/tray-icon{,-badged}.ico` + `build/tray-iconTemplate.png` (NEW assets), package.json `"icons:gen"` script.

**Why second:** Depends on prefs from 12-01 (closeToTray + `Show Aria` from tray). Bundles tray + sealed-DB skip + catchup because the badge state machine spans all three. Static grep test ratchet ensures no cron callsite escapes the guard.

**Wave 0 tests:** `tray/index.spec.ts`, `tray/menu.spec.ts`, `lifecycle/onUnlock.spec.ts`, `tests/static/cron-seal-guard.spec.ts`, extension to `briefing/schedule.spec.ts`.

**Deliverable:** Tray icon present on Win (left-click shows, right-click menu) + Mac (click → menu); all 6 menu items work; sealed-DB crons skip silently + badge appears; on unlock the badge clears + single-shot catchup runs per channel.

---

### Plan 12-03 — Notifications: briefing-ready + first-X toast

**Touches:** `src/main/tray/notify.ts` (NEW), `src/main/briefing/run.ts` or wherever briefing completion fires (call `showBriefingReadyNotification`), `src/main/index.ts` close handler (call `maybeShowFirstCloseToast`), renderer adds `aria:navigate` listener.

**Why third:** Smallest surface; depends on Tray from 12-02 (the notification falls back to the tray badge when permission is denied). One-shot throttle + `firstCloseToastShown` guard.

**Wave 0 tests:** `tray/notify.spec.ts`, extend `index-close-handler.spec.ts` with first-X toast assertion.

**Deliverable:** Briefing-ready notification fires once per day, clicks focus the window + routes to `/briefing`; first X click shows the one-time "Aria is still running" toast.

---

### Alternative: 4-plan split (defer if Plan 12-02 grows too large)

If Plan 12-02 exceeds ~12 tasks, split tray-icon-creation from sealed-DB-catchup:

- **12-02a — Tray icon + menu** (no sealed-DB awareness yet; menu items always enabled with TODO comments)
- **12-02b — Sealed-DB guards + unlock catchup + tray badge state machine** (wires the badge into 12-02a's tray)
- 12-03 unchanged

Recommend: start with 3-plan split; only escalate to 4-plan if the task count signals it.

---

## Metadata

**Confidence breakdown:**
- Electron API surface: HIGH — verified against electronjs.org
- Codebase wiring: HIGH — file-line-verified for all insertion points
- Sealed-DB cron audit: MEDIUM-HIGH — 8 callsites identified via grep; planner should re-grep before Wave 1
- macOS Notification permission lifecycle: MEDIUM — official docs are thin; behavior verified by community sources + Aria's own permissions ratchet pattern
- Tray badge implementation choice: MEDIUM — `setTitle('•')` is an opinion; alternative (Template @2x swap) is fully workable

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (Electron API surface stable; Electron 41 → 33 spread covered by current docs)
