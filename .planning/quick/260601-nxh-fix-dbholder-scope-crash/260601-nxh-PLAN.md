---
quick_id: 260601-nxh
slug: fix-dbholder-scope-crash
description: Fix production ReferenceError "dbHolder is not defined" in main process close handler
date: 2026-06-01
status: ready
---

# Quick Task 260601-nxh: Fix `dbHolder is not defined` production crash

## Problem

Packaged build throws on window close:

```
Uncaught Exception:
ReferenceError: dbHolder is not defined
    at BrowserWindow.<anonymous> (…/out/main/index.js:…44)
    at BrowserWindow.emit (node:events:521:24)
```

## Root cause

`src/main/index.ts:318` — inside `createMainWindow()` — calls
`maybeShowFirstCloseToast(win, dbHolder.db, getLogger())`. But `dbHolder` is a
local `const` declared inside `bootstrap()` (line 345), **not** in
`createMainWindow`'s scope. `createMainWindow` only receives `closeToTrayReader`.
So `dbHolder` at line 318 is a free identifier → `ReferenceError` at runtime when
the close handler fires on Windows (non-darwin) and `decideCloseAction` returns
`'hide'`.

It shipped because electron-vite bundles the main process with esbuild, which
strips types **without typechecking** — the "Cannot find name 'dbHolder'" error
was never surfaced at build time.

The comment at index.ts:302-304 already documents the correct pattern: the
`closeToTrayReader` is closured precisely so the close handler does not reference
`dbHolder` directly. The Plan 12-03 first-close toast (BG-07) ignored that.

## Fix

Mirror the `closeToTrayReader` closure pattern. Add a `dbReader: () => Db | null`
parameter to `createMainWindow` and call `dbReader()` instead of `dbHolder.db`.

### Task 1 — Thread a db reader into `createMainWindow`

- **File:** `src/main/index.ts`
- **Action:**
  1. Add second param `dbReader: () => import('./db/connect').Db | null = () => null` to `createMainWindow` (line ~282).
  2. Line ~318: `maybeShowFirstCloseToast(win, dbReader(), getLogger())`.
  3. Line ~511 call site: `createMainWindow(closeToTrayReader, () => dbHolder.db)`.
  4. Line ~618 `app.on('activate')` re-create call site: `createMainWindow(closeToTrayReader, () => dbHolder.db)`.
- **Verify:** `npx tsc --noEmit -p tsconfig.node.json` (or the main-process tsconfig) reports no "Cannot find name 'dbHolder'"; main-process unit tests pass.
- **Done:** No free `dbHolder` reference remains inside `createMainWindow`; both call sites pass a live db reader.

## must_haves

- **truths:** `dbHolder` is never referenced outside `bootstrap()`'s scope; the first-close toast reads the live DB via an injected closure.
- **artifacts:** `src/main/index.ts` (modified).
- **key_links:** `src/main/index.ts:createMainWindow`, `src/main/tray/notify.ts:maybeShowFirstCloseToast`.
