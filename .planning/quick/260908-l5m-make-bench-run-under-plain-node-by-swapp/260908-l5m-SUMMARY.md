---
phase: quick-260908-l5m
plan: 01
subsystem: build-tooling
tags: [native-abi, better-sqlite3, bench, vitest, windows]
status: complete
requires:
  - scripts/build-native-dual.mjs (dual-ABI variant producer + aria-abi/ stash)
provides:
  - scripts/native-abi.mjs (shared ABI swap library with onLocked policy)
  - scripts/with-node-abi.mjs (out-of-process swap/restore wrapper runner)
affects:
  - tests/setup-native-abi.ts (vitest globalSetup, now a thin delegate)
  - package.json bench/bench:quick/bench:live (rewired, deliberately UNCOMMITTED)
tech-stack:
  added: []
  patterns:
    - "helper-first, call-site later: committed helper stands alone; package.json rewiring rides with the developer's bench WIP"
    - "out-of-process ABI swap: the restoring process must never map the binding"
key-files:
  created:
    - scripts/native-abi.mjs
    - scripts/with-node-abi.mjs
  modified:
    - tests/setup-native-abi.ts
    - package.json (working tree only — NOT committed)
decisions:
  - "D-01 approach (b): extract a shared scripts/*.mjs helper rather than import tests/ from bench/ — (a) would have produced nothing committable"
  - "D-02: the swap/restore lives in a WRAPPER PROCESS; an in-process restore fails with EBUSY on Windows 100% of the time"
  - "D-03: one library, two lock policies — onLocked defaults to 'warn' so vitest keeps warn-and-continue; bench passes 'throw'"
  - "bench/run.ts left completely untouched; only three package.json script values change"
metrics:
  duration: ~35 min
  completed: 2026-09-08
actuals:
  tokens: 4000
  tasks: 3
  commits: 3
---

# Quick Task 260908-l5m: Make bench run under plain Node by swapping the ABI binding Summary

`pnpm bench`, `bench:quick` and `bench:live` now run to completion under plain Node via a wrapper process that swaps the Node-ABI better-sqlite3 binding in, runs the command as a child, and copies the Electron variant back on every exit path — with a sha256 assertion and a loud non-zero banner if the restore ever fails.

## What Was Built

**`scripts/native-abi.mjs`** — the shared swap library, lifted verbatim in behavior from the vitest globalSetup. Exports `ensureNodeVariant`, `activateNodeAbi`, `restoreElectronAbi`, `isElectronVariantActive`. The `onLocked` option defaults to `'warn'` (vitest's existing warn-and-continue tolerance); `'throw'` is the opt-in strict policy for bench. Never imports better-sqlite3.

**`scripts/with-node-abi.mjs`** — the out-of-process runner. Prepends `node_modules/.bin` to PATH (case-insensitive key lookup, same idiom as `build-native-dual.mjs`), activates the Node ABI with the strict policy, spawns the command with inherited stdio, and restores via three independent triggers: the spawn block's `finally`, SIGINT/SIGTERM handlers, and a `process.on('exit')` belt-and-braces. Restore is idempotent on success and retryable on failure. If the active binding is not sha256-identical to the Electron variant afterwards, it prints a banner naming `pnpm rebuild:native:electron` and exits non-zero **even when the child succeeded**.

**`tests/setup-native-abi.ts`** — reduced from 145 lines to a 41-line thin delegate. Both exports keep their names and signatures (`vitest.config.ts:19` resolves them by name) and call the library with **no options**, which is what preserves V-3 lock tolerance exactly.

## Verification Results

| Gate | Result |
|---|---|
| Library roundtrip (swap → assert not-electron → restore → assert electron) | PASS |
| Wrapper propagates failing child status (`node -e "process.exit(3)"` → exit 3) and restores | PASS |
| `pnpm bench:quick` end-to-end | PASS — exit 0, **9s** first run / **7s** second, wrote `bench/results/latest.json` + `latest.md` |
| `pnpm bench:live` | PASS — exit 0, 30s; "local model stack unreachable, skipping live routing" (expected, Ollama down) |
| `pnpm bench` (full) | PASS — exit 0, 22s; corpus of 680 chunks across 12 topics built under plain Node |
| Real `setup()`/`teardown()` exports swap and restore | PASS |
| Commit scope (paths outside the three source files) | 0 |
| Final ABI assertion | PASS — active binding sha256 `a0ef0605aafd7423…` == Electron variant |

**The wrapper's restore never once reported a lock** — which is the entire point of D-02. Every restore was a plain `copyFileSync` into an unmapped file.

No `NODE_MODULE_VERSION` error appeared in any run. `bench/run.ts` was never opened for editing.

### Ctrl-C interrupt path (plan's `<human-check>`)

Auto-approved under auto mode, but substantively probed rather than waved through. Two findings:

1. **The restore mechanism a real Ctrl-C depends on is PROVEN.** With a wrapper mid-run (Node variant active, verified), the child process was killed out from under it — exactly what Ctrl-C does to the child. `spawnSync` returned, the `finally` fired, and `isElectronVariantActive()` flipped back to `true` with zero orphan processes left behind. This is the path that actually carries the restore: `spawnSync` blocks the event loop, so a queued SIGINT cannot be dispatched until the child has exited anyway.
2. **A true `GenerateConsoleCtrlEvent` probe was inconclusive** (isolated hidden console, `AttachConsole` + CTRL_C_EVENT: `attached=True sent=True`, wrapper survived). Cause: `shell: true` interposes a `cmd.exe`, which on Ctrl-C puts up "Terminate batch job (Y/N)?" and waits on stdin — unanswerable in a headless console. In a real terminal the developer answers it and the restore proceeds. This is now documented in the wrapper's header.

Also confirmed empirically: a hard `taskkill /F /T` leaves the Node variant active, matching the plan's documented known limitation exactly. Recovery via `restoreElectronAbi` worked first try.

## Deviations from Plan

**1. [Constraint conflict — orchestrator wins] Planning directory NOT committed**
- **Found during:** Task 3
- **Issue:** Plan Task 3 instructs staging `.planning/quick/260908-l5m-…/`; the orchestrator's execution constraints forbid committing docs artifacts (it owns the docs commit).
- **Resolution:** Committed only the three source files. The commit-scope gate still reports 0 out-of-scope paths.

**2. [Rule 3 — blocking, V-7] `npx tsx` in the Task 3 gate replaced with the local binary**
- **Found during:** Task 3 verification
- **Issue:** The plan's own gate command literally begins `npx tsx -e …`, contradicting the plan's constraint V-7 (and the orchestrator's hard "never run `npx <anything>`", which is what destroyed `node_modules` earlier that day).
- **Fix:** Ran `./node_modules/.bin/tsx -e …` instead — same gate, repo-pinned binary. Gate passed.

**3. [Protocol] Three atomic commits instead of the plan's single commit**
- Per-task atomic commits are the GSD execution protocol; the plan was written around one squashed commit. Content and scope are identical.

**4. [Rule 2 — document real behavior] Ctrl-C / cmd.exe note added to the wrapper header**
- The `shell: true` + `cmd.exe` "Terminate batch job (Y/N)?" interaction and the verified `finally`-carries-the-restore mechanism are now recorded in `scripts/with-node-abi.mjs`, alongside the measured `taskkill /F` limitation. No behavior change.

## Preflight Note

The `pnpm install --frozen-lockfile` repair was already completed before execution began and was **not** re-run. `package.json` and `pnpm-lock.yaml` were reported byte-identical (md5) to their pre-repair state, so the install did **not** rewrite the lockfile beyond the developer's existing WIP diff. Both ABI variants plus the `.abi` stamp (127, host Node 22.23.0) were present and the Electron variant was active at start.

## Commit Scope / Working Tree

Committed (3 files only):
- `scripts/native-abi.mjs`
- `scripts/with-node-abi.mjs`
- `tests/setup-native-abi.ts`

Deliberately left **unstaged** as the developer's in-flight work, exactly as required: `package.json` (including this task's three `bench:*` rewirings), `pnpm-lock.yaml`, `src/main/index.ts`, `src/main/rag/answer-service.ts`, `tsconfig.node.json`, and untracked `bench/`. Verified with `git status --short` after the final commit; staged set is empty.

One stray zero-byte file named `{}` was created in the repo root by a probe whose `()=>{}` argv was mangled into a shell redirect by `cmd.exe`; it was removed. No `git clean` was used at any point.

## Known Follow-ups (not fixed here)

- **vitest's own teardown remains subject to EBUSY** when a worker still holds the mapping — the root of memory `reference_vitest_abi_swap_breaks_app`. Fixing it needs the same wrapper-process treatment (`node scripts/with-node-abi.mjs vitest run`), which is a separate task. Deliberately not widened into.
- **`package.json` bench rewiring is uncommitted by design** — it lands with the developer's bench harness.
- **`shell: true` argv hazard:** any argument containing shell metacharacters (notably `=>` and `>`) is mangled by `cmd.exe` when passed through the wrapper. The real bench argv (`tsx bench/run.ts --quick`) is unaffected, and this mirrors the pre-existing `run()` helper in `build-native-dual.mjs`, but it is a sharp edge for future callers.

## No Stubs

Scanned all three files for stub/placeholder patterns — none found. No `TODO`/`FIXME` introduced.

## Self-Check: PASSED

- `scripts/native-abi.mjs` — FOUND
- `scripts/with-node-abi.mjs` — FOUND
- `tests/setup-native-abi.ts` — FOUND
- Commit `af4e72c` — FOUND
- Commit `759d53f` — FOUND
- Commit `38ae44d` — FOUND
