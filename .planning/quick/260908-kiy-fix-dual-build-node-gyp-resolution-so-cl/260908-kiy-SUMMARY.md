---
phase: quick-260908-kiy
plan: 01
subsystem: build-tooling
status: complete
tags: [build, native, node-gyp, pnpm, dual-abi, better-sqlite3]
requires:
  - "@electron/rebuild (direct devDependency) as the dependency edge supplying node-gyp"
provides:
  - "Layout-independent node-gyp resolution for the dual-ABI native build"
  - "--print-node-gyp diagnostic probe on scripts/build-native-dual.mjs"
affects:
  - "postinstall.mjs (calls the dual build)"
  - "tests/setup-native-abi.ts (consumes the aria-abi/ stash it regenerates)"
tech-stack:
  added: []
  patterns:
    - "Tiered module resolution (declared-dependency-first, filesystem scan last)"
    - "createRequire anchored on a dependency's MAIN ENTRY, not its package.json"
key-files:
  created: []
  modified:
    - scripts/build-native-dual.mjs
decisions:
  - "Tiered in-script resolution chosen over declaring node-gyp as a devDependency"
  - "Tier 2 anchors on @electron/rebuild's main entry (its exports map blocks ./package.json)"
  - "Tier 3 .pnpm scan ordered LAST so a planted higher-version entry cannot pre-empt the dependency graph"
  - "Committed the script only, not the planning directory (orchestrator owns the docs commit)"
metrics:
  duration: "~9 min"
  completed: 2026-09-08
actuals:
  tokens: 2400
  tasks: 3
  commits: 1
---

# Quick Task 260908-kiy: Fix dual-build node-gyp resolution Summary

`scripts/build-native-dual.mjs` now locates node-gyp by a three-tier resolution chain
(direct → via `@electron/rebuild` → `.pnpm` scan) instead of the hoisted path
`node_modules/node-gyp/bin/node-gyp.js`, restoring the Node-ABI half of the dual build under
pnpm's strict layout.

## What Was Built

**Root cause.** `node-gyp` is not a direct dependency of this repo — it arrives transitively
through `@electron/rebuild@4.2.0`. Under pnpm's strict (non-hoisted) layout it therefore exists
only at `node_modules/.pnpm/node-gyp@12.4.0/node_modules/node-gyp/bin/node-gyp.js`. The main
checkout had been satisfying the script's hardcoded hoisted path via a legacy hoist artifact from
an older install; a recent clean `pnpm install` removed it, so step 3 of the pipeline died with
`MODULE_NOT_FOUND` and postinstall never produced the Node-ABI variant that vitest's
`tests/setup-native-abi.ts` swaps in.

**Fix — `resolveNodeGyp()`**, returning `{ path, tier }`, each tier's throw caught so failure falls
through rather than aborting:

| Tier | Name | Mechanism | Status on this checkout |
|------|------|-----------|-------------------------|
| 1 | `direct` | `require.resolve('node-gyp/bin/node-gyp.js')` off a module-level `createRequire(import.meta.url)` | fails (expected — node-gyp is not hoisted or direct here) |
| 2 | `@electron/rebuild` | `createRequire(require.resolve('@electron/rebuild'))` then resolve the node-gyp subpath | **WINNER** |
| 3 | `pnpm-scan` | dependency-free `readdirSync` of `node_modules/.pnpm`, `node-gyp@*` entries sorted descending, first whose nested binary exists | not reached |

Tier 1 is kept deliberately so the rejected devDependency route remains a strict superset: a later
`pnpm add -D node-gyp` is picked up first with no code change.

Tier 2 anchors on the package's **main entry**, not its manifest — `@electron/rebuild`'s `exports`
map blocks the `./package.json` subpath with `ERR_PACKAGE_PATH_NOT_EXPORTED`. It also means both
halves of a *dual*-ABI build are produced by exactly one node-gyp (the same copy electron-rebuild
itself drives in step 1), which a separately declared direct node-gyp would eventually drift from.

Also added:
- **Failure output** — when all three tiers fail, a `[dual-build] x` block lists the tiers tried in
  order and the two remedies (re-run the install, or `pnpm add -D node-gyp`), then exits 1. Every
  tier is wrapped in try/catch, so no raw `MODULE_NOT_FOUND` stack can reach the user.
- **Resolution log** — the winning tier and absolute path go to **stderr** before the spawn, so
  postinstall output always shows which node-gyp was used.
- **Out-of-repo warning** (T-QK-01 visibility mitigation) — a resolved path outside the repo's
  `node_modules` emits a warning, never a hard failure: git worktrees in this repo junction
  `node_modules` back to the main checkout, so an out-of-repo realpath is legitimate here.
- **`--print-node-gyp`** — parsed off the existing `args` Set and handled before the
  electron-rebuild block, so it does zero rebuild/copy work. Writes only the absolute path to
  stdout (all diagnostics on stderr, so the value is pipe-clean) and exits 0.
- Step 3 of the header comment block updated to describe tiered resolution. Steps 1, 2, 4, 5
  untouched.

The step-3 spawn consumes the single resolved value (`nodeGyp.path`) — no fallback path literal
was left behind.

## Requested Outputs

- **Winning tier on this machine:** `@electron/rebuild` (tier 2), resolving to
  `C:\Users\HomePC\Documents\GitHub\Aria\node_modules\.pnpm\node-gyp@12.4.0\node_modules\node-gyp\bin\node-gyp.js`
  (node-gyp v12.4.0).
- **ABI stamp produced:** `127` — host Node is 22.23.0 (`NODE_MODULE_VERSION` 127). Correct for
  this machine; see Known Issues about the header comment's stale Node 25.x / ABI 141 wording.
- **Toolchain warnings from the compile:** one, benign and pre-existing —
  `sqlite3.c(136949,12): warning C4018: '>': signed/unsigned mismatch` in the upstream SQLite
  amalgamation. MSVC 2022 BuildTools; `gyp info ok`, no errors. Nothing in the project's own
  `better_sqlite3.cpp` warned.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Task 1 | `P=$(node scripts/build-native-dual.mjs --print-node-gyp) && test -f "$P" && node "$P" --version` | PASS — one absolute path on stdout, `v12.4.0`, exit 0 |
| Task 1 (failure path) | ran a copy of the script from a scratch dir with no reachable node-gyp | PASS — tiered guidance + remedies, exit 1, no `MODULE_NOT_FOUND` stack |
| Task 2 | `pnpm run rebuild:native:node` | PASS — exit 0 |
| Task 2 | dual-ABI sha256 assertion one-liner | PASS — `OK dual-ABI: both variants present, active=electron, abi=127` |
| Task 3 | commit-scope grep | PASS — `0` paths outside this task |

Constraint compliance:
- **V-1** Only `pnpm run rebuild:native:node` was run. No full dual rebuild, no `pnpm install`.
- **V-2** `aria-abi/` holds `better_sqlite3.electron.node`, `better_sqlite3.node-node`, and
  `better_sqlite3.node-node.abi`.
- **V-3** Active `build/Release/better_sqlite3.node` hashes **identical to the Electron variant**;
  the Node variant hashes differently, proving a real second-ABI build rather than a copy. The
  desktop app is not stranded.
- **V-4** No vitest / `pnpm test` / `pnpm run test:unit` was started at any point. All gates were
  node/git one-liners.
- **V-5** One file staged by explicit path. Never `git add -A`/`.`/`-a`. Post-commit `git status`
  confirms `package.json`, `pnpm-lock.yaml`, `src/main/index.ts`,
  `src/main/rag/answer-service.ts`, `tsconfig.node.json` and untracked `bench/` remain
  modified-but-unstaged.
- **V-6** Checked before rebuilding: `tasklist` matched no `electron`/`aria` image, so no EBUSY
  file lock. No processes were killed.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 + 3 | `eb59cc6` | `scripts/build-native-dual.mjs` (+107 / −2) |

Task 2 produced only build output under `node_modules/` — intentionally not committed.

## Deviations from Plan

**1. [Conflict resolution] Commit scope narrowed to the script alone**
- **Found during:** Task 3
- **Conflict:** the plan's Task 3 says to stage this task's planning directory alongside the
  script; the orchestrator's execution constraints say *"Do NOT commit docs artifacts
  (SUMMARY.md, STATE.md, PLAN.md) — the orchestrator handles the docs commit in Step 8."*
- **Resolution:** staged `scripts/build-native-dual.mjs` only. This satisfies both, because the
  plan's own Task 3 gate filters out *either* path and still expects `0` — verified `0`. The
  planning directory remains untracked for the orchestrator's docs commit.
- **Commit:** `eb59cc6`

No auto-fixes were required (Rules 1–3 did not trigger). Task 1's tracer verify passed
end-to-end on first run, so the expansion tasks proceeded on a proven slice.

## Known Issues / Follow-ups

1. **Stale header comment (deliberately out of scope, per plan `<verification>`).** The script's
   header still describes "System Node 25.x → NODE_MODULE_VERSION 141"; this host is Node 22.23.0
   / ABI 127, and the stamp correctly reads 127. Cosmetic drift orthogonal to this defect — not
   "fixed", to keep the diff narrow.
2. **`run()` uses `spawnSync(..., { shell: true })` and does not quote argv.** Pre-existing
   (T-QK-02, disposition *accept*), unchanged here. The newly resolved `.pnpm` path contains `@`
   and `.` which are not `cmd.exe`-special, so it is safe on this checkout — but a repo path
   containing spaces would break this spawn, as it would have before this change too.
3. Not re-verified here: a genuinely clean `pnpm install` end-to-end. The fix was proven against
   the exact failing step (`--node-only`), which is the half that was broken; the Electron half
   already succeeded before this task.

## Known Stubs

None. No placeholder values, TODO/FIXME markers, or unwired data paths were introduced.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or schema change at a trust
boundary. The one new filesystem read (tier 3's `.pnpm` readdir) is covered by the plan's
existing T-QK-01 register entry and its mitigation shipped as specified: tiers are ordered so
declared-dependency resolution is exhausted before any filesystem scan, and the winning tier plus
absolute path are logged before the spawn.

## Self-Check: PASSED

- `scripts/build-native-dual.mjs` — FOUND (modified, 9553 bytes)
- `node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.node-node` — FOUND
- `node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.node-node.abi` — FOUND (`127`)
- `node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.electron.node` — FOUND
- Commit `eb59cc6` — FOUND in `git log`
