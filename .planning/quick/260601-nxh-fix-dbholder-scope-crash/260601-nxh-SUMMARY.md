---
quick_id: 260601-nxh
slug: fix-dbholder-scope-crash
status: complete
date: 2026-06-01
commit: da2d936
---

# Quick Task 260601-nxh — Summary

## What was wrong

Packaged build crashed with a modal `Uncaught Exception` on window close:

```
ReferenceError: dbHolder is not defined
    at BrowserWindow.<anonymous> (…/out/main/index.js:…44)
    at BrowserWindow.emit (node:events:521:24)
```

## Root cause

`createMainWindow()` (`src/main/index.ts`) wired the Plan 12-03 first-close
toast as `maybeShowFirstCloseToast(win, dbHolder.db, getLogger())`. But
`dbHolder` is a local `const` declared inside `bootstrap()` (line 345) — it does
not exist in `createMainWindow`'s scope. The free identifier resolved to nothing
at runtime → `ReferenceError` the moment the close handler fired on Windows
(non-darwin) with `decideCloseAction === 'hide'`.

The comment at index.ts:302-304 already documented the correct pattern — the
`closeToTrayReader` is closured precisely so the close handler never references
`dbHolder` directly — but the BG-07 toast call ignored it.

**Why it shipped:** electron-vite bundles the main process with esbuild, which
strips types **without typechecking**. The "Cannot find name 'dbHolder'" error
that `tsc` would have raised was never surfaced by the production build.

## Fix (commit da2d936)

- Added `dbReader: () => Db | null = () => null` param to `createMainWindow`,
  mirroring the existing `closeToTrayReader` closure.
- Close handler now calls `maybeShowFirstCloseToast(win, dbReader(), getLogger())`.
- Both call sites pass `() => dbHolder.db`:
  - initial create (`const mainWindow = createMainWindow(...)`)
  - `app.on('activate')` window re-create.
- Added `tests/static/create-main-window-no-free-dbholder.spec.ts` — a ratchet
  that extracts the `createMainWindow` body and asserts it never references
  `dbHolder` again.

## Verification

- `tsc --noEmit -p tsconfig.node.json` → zero errors in `index.ts` (pre-existing
  baseline errors in unrelated files remain; none from this change).
- `vitest run` on the new ratchet + `index-close-handler.spec.ts` → 15/15 pass.

## Follow-ups (not done here — flagged)

1. **The production build does not typecheck.** This bug class (free identifier)
   is invisible to esbuild and only `tsc` catches it. The `typecheck` script
   exists but currently has pre-existing baseline failures (better-sqlite3 module
   resolution, test-mock typing, `jose` `KeyLike`) so it isn't a clean CI gate.
   Worth a separate task to green the baseline and gate the build on `tsc`.
2. **`index-close-handler.spec.ts` tests a simulation, not the real handler.**
   It re-implements the close logic in `simulateCloseHandler()` and asserts a
   comment that the real code "uses identical branching" — which was false. This
   is the simulated-wiring blindspot; the new static ratchet compensates, but the
   spec's false-confidence pattern is worth revisiting.
