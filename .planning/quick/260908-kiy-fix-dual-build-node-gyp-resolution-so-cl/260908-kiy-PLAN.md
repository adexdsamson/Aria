---
phase: quick-260908-kiy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/build-native-dual.mjs
autonomous: true
requirements: [QUICK-260908-kiy]

estimate:
  tokens: 55000
  raw_tokens: 35000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "scripts/build-native-dual.mjs locates node-gyp without depending on a hoisted node_modules/node-gyp directory (pnpm strict layout, verified absent on this machine)"
    - "When node-gyp cannot be located, the script prints a tiered, actionable failure listing what it tried and how to fix it — never a raw MODULE_NOT_FOUND stack"
    - "The resolved absolute node-gyp path and the tier that produced it are logged before the rebuild is spawned"
    - "pnpm run rebuild:native:node completes and produces the Node-ABI variant plus its .abi stamp sidecar"
    - "When the script finishes, the ACTIVE build/Release/better_sqlite3.node is byte-identical to the Electron variant, so the desktop app still loads"
    - "The commit contains only this task's files — the unrelated in-flight bench/tsx work stays unstaged"
  artifacts:
    - path: "scripts/build-native-dual.mjs"
      provides: "Tiered, layout-independent node-gyp resolution + --print-node-gyp probe"
      contains: "resolveNodeGyp"
    - path: "node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.node-node"
      provides: "Node-ABI native binding consumed by tests/setup-native-abi.ts"
    - path: "node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.node-node.abi"
      provides: "NODE_MODULE_VERSION stamp used for stale-variant detection"
  key_links:
    - from: "resolveNodeGyp()"
      to: "run('node-gyp rebuild', process.execPath, [...])"
      via: "single resolved path passed as argv[0] of the node-gyp step (no second path literal)"
      pattern: "resolveNodeGyp\\(\\)"
    - from: "node_modules/better-sqlite3-multiple-ciphers/aria-abi/"
      to: "tests/setup-native-abi.ts"
      via: "vitest globalSetup reads the stash to swap ABIs for the test run"
      pattern: "aria-abi"
---

<objective>
Fix `pnpm install` failing at postinstall because `scripts/build-native-dual.mjs` hardcodes the
**hoisted** path `node_modules/node-gyp/bin/node-gyp.js`. `node-gyp` is not a direct dependency of
this repo, so under pnpm's strict layout it exists only inside `node_modules/.pnpm/`. The main
checkout used to satisfy the hardcoded path via a legacy top-level hoist artifact; the recent clean
`pnpm install` removed it, so the Node-ABI half of the dual build now dies with `MODULE_NOT_FOUND`.

Purpose: restore `pnpm install` to a clean exit, and remove the whole class of failure (layout
dependence) so a fresh clone, a git worktree, CI, or a different package manager all work.
Output: one modified build script + a regenerated Node-ABI native binding, committed without
touching the unrelated in-flight work already in the tree.

Blast radius is narrow: the Electron-ABI step already succeeded and the desktop app runs today.
Only the vitest-facing Node-ABI variant is missing.
</objective>

<decision>
## Chosen fix: tiered in-script resolution (NOT an explicit `node-gyp` devDependency)

The brief asked to weigh both. Both were probed on this machine before deciding.

**Measured facts (probed 2026-09-08, this checkout):**
- `node_modules/node-gyp` — does not exist.
- `node_modules/.bin/node-gyp` — does not exist (only `electron-rebuild` is linked).
- `node_modules/.pnpm/node-gyp@12.4.0/node_modules/node-gyp/bin/node-gyp.js` — exists.
- `node-gyp@12.4.0` is a declared dependency of `@electron/rebuild@4.2.0`, which IS a direct
  devDependency of this repo.
- `createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js')` from `scripts/` — **FAILS**
  today (`MODULE_NOT_FOUND`). So the one-line `require.resolve` swap suggested in the brief is *not
  sufficient on its own*; it must be tier 1 of a chain, not the whole fix.
- Anchoring on `@electron/rebuild`'s **main entry** and resolving from there — **WORKS**, returns the
  `.pnpm` path above.
- Anchoring on `@electron/rebuild/package.json` — **FAILS** with `ERR_PACKAGE_PATH_NOT_EXPORTED`
  (that package's `exports` map blocks the `./package.json` subpath). The executor must use the main
  entry, not the manifest, as the anchor.
- `node-gyp`'s own manifest has no `exports` field, so once the anchor is right the
  `node-gyp/bin/node-gyp.js` subpath resolves cleanly.

**Why not declare `node-gyp` as a devDependency (the "more honest fix"):**
1. **Commit hygiene is impossible here.** `package.json` and `pnpm-lock.yaml` already carry an
   unrelated in-flight change in the working tree (bench harness scripts + `tsx` devDep; lockfile
   diff is ~1885/1624 lines). Adding a dependency forces those files into this task's commit, or
   forces interactive partial staging — both violate the hard "stage ONLY this task's files"
   constraint (V-5).
2. **It would split the dual build across two node-gyp copies.** The Electron half runs
   `electron-rebuild`, which uses `@electron/rebuild`'s own bundled node-gyp. A separately declared
   direct node-gyp would drift from that version over time, so the two halves of a *dual*-ABI build
   would be produced by different builders. Resolving through `@electron/rebuild` keeps both halves
   on exactly one node-gyp.
3. **It fixes a narrower class of failure.** A devDep only helps package managers that link direct
   deps at the root; the tiered resolver additionally covers worktrees, partial installs, and
   `.pnpm`-only layouts, and still yields a readable error instead of a stack trace when it truly
   cannot find node-gyp.

**Tier 1 is kept deliberately** so the devDependency route stays available as a strict superset: if
anyone later runs `pnpm add -D node-gyp`, tier 1 picks it up first with no further code change. The
failure message names that command as one of the two remedies.
</decision>

<constraints_from_brief>
These are hard, non-negotiable, and each is cited in the task that enforces it.

- **V-1** Verify with the NODE-ONLY rebuild: `pnpm run rebuild:native:node`. Do NOT run the full
  dual rebuild — the Electron variant already built successfully and re-running electron-rebuild is
  slow and pointless.
- **V-2** Success = both variants present in `node_modules/better-sqlite3-multiple-ciphers/aria-abi/`:
  `better_sqlite3.electron.node` and `better_sqlite3.node-node` (plus `better_sqlite3.node-node.abi`).
- **V-3** The ACTIVE `node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node`
  must be left as the **Electron** variant — the desktop app loads it directly.
- **V-4** Do NOT run `vitest` / `pnpm test` / `pnpm run test:unit` anywhere in this task. Running
  specs swaps the active binding to the Node ABI and strands the desktop app (documented recurring
  failure mode in this repo). Any gate here must be a non-vitest gate.
- **V-5** The tree carries unrelated modifications (`package.json`, `pnpm-lock.yaml`,
  `src/main/index.ts`, `src/main/rag/answer-service.ts`, `tsconfig.node.json`, untracked `bench/`).
  Stage ONLY this task's files by explicit path. Never `git add -A`, `git add .`, or `git commit -a`.
- **V-6** Aria must not be running during a native rebuild on Windows — better-sqlite3 holds a file
  lock and the rebuild fails with EBUSY. Check, do not assume.
</constraints_from_brief>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@scripts/build-native-dual.mjs
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Resolve node-gyp by tiered lookup instead of a hardcoded hoisted path</name>
  <files>scripts/build-native-dual.mjs</files>
  <read_first>
    scripts/build-native-dual.mjs — the whole file (128 lines). The hardcoded join is the first
    argument of the step-3 `run('node-gyp rebuild', process.execPath, [...])` call near line 109.
    The header comment block documents the 5-step pipeline; step 3 is the one being changed.
  </read_first>
  <action>
    Add `createRequire` to the existing `node:module`-free import block (the file already imports
    `spawnSync`, `fs`, `path`, `fileURLToPath`). Create one module-level require instance anchored on
    `import.meta.url`.

    Add a `resolveNodeGyp()` function that returns an object carrying the absolute path plus the name
    of the tier that produced it, trying these in order and catching each tier's throw so that a
    failure falls through to the next rather than aborting:

    Tier 1, name it `direct` — resolve the specifier `node-gyp/bin/node-gyp.js` off the module-level
    require. This is first on purpose: if node-gyp is ever hoisted or declared as a direct dependency
    it must win. Probed on this checkout it currently fails, which is expected and fine.

    Tier 2, name it `@electron/rebuild` — build a second require anchored on the resolution of the
    bare specifier `@electron/rebuild` (its MAIN ENTRY — resolving that package's manifest subpath
    throws ERR_PACKAGE_PATH_NOT_EXPORTED because of its exports map, so the manifest must not be used
    as the anchor), then resolve `node-gyp/bin/node-gyp.js` from it. This is the tier that works
    under pnpm's strict layout today, and it deliberately reuses the same node-gyp that
    electron-rebuild itself drives in step 1.

    Tier 3, name it `pnpm-scan` — a dependency-free filesystem scan: read the entries of the repo's
    `node_modules/.pnpm` directory, keep those whose name begins with the node-gyp package prefix,
    sort descending so the newest version wins, and return the first entry whose nested
    `node_modules/node-gyp/bin/node-gyp.js` exists on disk. Do not add a glob library.

    If every tier fails, print a multi-line failure through the existing `[dual-build] x` prefix
    style that (a) states node-gyp could not be located, (b) lists the three tiers that were tried in
    order, and (c) gives the two remedies: re-run the install (node-gyp ships transitively via
    `@electron/rebuild`), or declare it explicitly with `pnpm add -D node-gyp`. Then exit 1. The
    executor must ensure no raw MODULE_NOT_FOUND stack can reach the user from this path.

    Log the winning tier and the absolute path on stderr before the rebuild is spawned, so postinstall
    output always shows which node-gyp was used. Additionally, if the resolved path is not underneath
    this repo's `node_modules`, emit a warning line — warning only, never a hard failure: git
    worktrees in this repo junction `node_modules` back to the main checkout, so a realpath outside
    the repo is legitimate here (this is also the T-Q-01 visibility mitigation).

    Rewire the step-3 `run(...)` call to pass the resolved path as its first argv element. There must
    be exactly one path expression feeding that spawn — do not leave a fallback literal behind.

    Add a `--print-node-gyp` argument, parsed off the existing `args` Set and handled BEFORE the
    electron-rebuild block so it performs zero rebuild or copy work. It resolves, writes ONLY the
    absolute path to stdout (all diagnostics go to stderr so the value stays pipe-clean), and exits 0.
    This is the task's automated gate and a standing diagnostic for the next time this breaks.

    Finally, update step 3 of the header comment block so it describes locating node-gyp by tiered
    resolution rather than at a fixed location. Keep every other step's wording intact; steps 1, 2, 4
    and 5 are unchanged by this task.
  </action>
  <verify>
    <automated>P=$(node scripts/build-native-dual.mjs --print-node-gyp) && test -f "$P" && node "$P" --version</automated>
    <expected>Prints an absolute path to a node-gyp.js that exists, then a node-gyp version string (v12.4.0 on this checkout). Exit 0.</expected>
  </verify>
  <done>
    `--print-node-gyp` emits exactly one absolute path on stdout and exits 0 without rebuilding
    anything; that path is a runnable node-gyp; the step-3 spawn consumes the same resolved value;
    and the unresolvable case produces the tiered guidance message plus exit 1 instead of a
    MODULE_NOT_FOUND stack.
  </done>
  <reversibility rating="reversible">Single-file build-script change, revertable with one git checkout; no runtime or schema surface touched.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Prove the Node-ABI half of the dual build now completes</name>
  <files>node_modules/better-sqlite3-multiple-ciphers/aria-abi/ (generated, not committed)</files>
  <precondition>Aria / electron-vite dev is not running — Windows holds a file lock on better_sqlite3.node and the rebuild fails with EBUSY (V-6).</precondition>
  <action>
    Assert the precondition first: list running processes and look for an electron or Aria image
    (`tasklist | grep -iE "electron|aria"` from the bash tool works on this machine). If anything
    matches, HALT and ask the developer to close Aria and stop any `pnpm dev` session. Do not kill
    processes unilaterally.

    Then confirm the Electron variant is present at
    `node_modules/better-sqlite3-multiple-ciphers/aria-abi/better_sqlite3.electron.node` — the
    node-only path refuses to run without it. It is present in this checkout (2280960 bytes). If it
    is somehow missing, HALT and report; do NOT escalate to the full pipeline on your own initiative.

    Run exactly one command: `pnpm run rebuild:native:node` (V-1). Do NOT run `pnpm run
    rebuild:native`, do NOT run `pnpm install`, and do NOT run vitest, `pnpm test`, or
    `pnpm run test:unit` at any point (V-4).

    Read the output for the new resolution log line from Task 1 and record the tier it reports in the
    summary. Note that the host Node here is 22.23.0 with NODE_MODULE_VERSION 127, so the produced
    Node variant and its stamp will read 127 — that is correct for this machine even though the
    script's header comment still describes an older Node 25 / ABI 141 pairing. Do not "fix" the
    stamp to match the comment.

    If node-gyp now launches but the C++ compile fails (MSVC or Python toolchain error), that is a
    DIFFERENT defect from the resolution bug this task fixes: capture the compiler output verbatim in
    the summary and report it. Do not revert the resolver, and do not start installing build tools.
  </action>
  <verify>
    <automated>node -e "const c=require('crypto'),f=require('fs'),p=require('path');const d=p.join('node_modules','better-sqlite3-multiple-ciphers'),S=p.join(d,'aria-abi');const h=x=>c.createHash('sha256').update(f.readFileSync(x)).digest('hex');const E=p.join(S,'better_sqlite3.electron.node'),N=p.join(S,'better_sqlite3.node-node'),A=p.join(d,'build','Release','better_sqlite3.node');for(const x of [E,N,N+'.abi',A]) if(!f.existsSync(x)) throw new Error('missing '+x);if(h(A)!==h(E)) throw new Error('active binding is NOT the Electron variant');if(h(N)===h(E)) throw new Error('node variant identical to electron variant');const abi=f.readFileSync(N+'.abi','utf8').trim();if(abi!==process.versions.modules) throw new Error('abi stamp '+abi+' != host '+process.versions.modules);console.log('OK dual-ABI: both variants present, active=electron, abi='+abi)"</automated>
    <expected>Prints "OK dual-ABI: both variants present, active=electron, abi=127" and exits 0. (Dry-run today fails with "missing ...better_sqlite3.node-node" — that is the pre-fix state this task closes.)</expected>
  </verify>
  <done>
    `pnpm run rebuild:native:node` exits 0; both ABI variants and the `.abi` stamp exist in
    `aria-abi/` (V-2); the active `build/Release/better_sqlite3.node` hashes identical to the Electron
    variant so the desktop app still loads (V-3); the Node variant hashes differently from the
    Electron variant, proving a real second-ABI build rather than a copy; and no vitest process was
    started (V-4).
  </done>
</task>

<task type="auto">
  <name>Task 3: Commit the script fix with strict staging</name>
  <files>scripts/build-native-dual.mjs</files>
  <action>
    Stage by explicit path only — `scripts/build-native-dual.mjs` and this quick task's planning
    directory `.planning/quick/260908-kiy-fix-dual-build-node-gyp-resolution-so-cl/`. Never
    `git add -A`, never `git add .`, never `git commit -a` (V-5).

    The working tree deliberately retains unrelated in-flight work that must remain unstaged: the
    bench harness additions to the manifest and lockfile, the edits under `src/main/`, the
    `tsconfig.node.json` change, and the untracked `bench/` directory. Confirm with a status check
    after committing that those are still modified-but-unstaged.

    Nothing under `node_modules/` is committed — the regenerated ABI variants are build output.

    Commit message: `fix(build): resolve node-gyp by tiered lookup instead of hoisted path`, with a
    body noting that node-gyp is not a direct dependency and pnpm's strict layout keeps it under
    `.pnpm`, so the previous fixed path only worked via a stale hoist artifact.
  </action>
  <verify>
    <automated>git show --pretty=format: --name-only HEAD | sed '/^$/d' | grep -v -e '^scripts/build-native-dual\.mjs$' -e '^\.planning/quick/260908-kiy' | wc -l</automated>
    <expected>0 — the commit touches no path outside this task's script and its planning directory.</expected>
  </verify>
  <done>
    One commit exists containing the build script (and this plan's planning artifacts) and nothing
    else; `git status` still shows the unrelated manifest, lockfile, `src/main/`, tsconfig and
    `bench/` changes as unstaged working-tree modifications.
  </done>
  <reversibility rating="reversible">Single commit, revertable with git revert; no published artifact.</reversibility>
</task>

</tasks>

<!-- planner-discipline-allow: scripts/build-native-dual.mjs -->

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| node_modules → build toolchain | Third-party package content selects and is executed as the native build tool during `postinstall`, at developer privilege |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-QK-01 | Tampering | `resolveNodeGyp()` tier 3 `.pnpm` filesystem scan | medium | mitigate | Tiers are ordered so declared-dependency resolution (tier 1 direct, tier 2 through the `@electron/rebuild` dependency edge) is exhausted before any filesystem scan — a planted `.pnpm/node-gyp@<higher-version>` entry cannot pre-empt a legitimately declared node-gyp. The winning tier and absolute path are logged to stderr before spawn, and a path outside the repo's `node_modules` raises a visible warning, so an unexpected source shows up in postinstall output. |
| T-QK-02 | Elevation of Privilege | `run()` spawnSync with `shell: true` | low | accept | Pre-existing behavior, unchanged by this task. All argv values are literals or resolver output; no user-supplied input reaches the command line. |

No package-manager install tasks in this plan (the devDependency route was explicitly rejected in
`<decision>`), so the package-legitimacy gate is not triggered and no supply-chain checkpoint is
required.
</threat_model>

<source_audit>
| Source | Item | Covered by |
|--------|------|------------|
| BRIEF | Durable code fix: layout-independent node-gyp resolution | Task 1 |
| BRIEF | Clear actionable error instead of raw MODULE_NOT_FOUND | Task 1 |
| BRIEF | Weigh require.resolve chain vs explicit devDependency, pick one, state rationale | `<decision>` (probed both, chose the chain) |
| BRIEF | Consider glob fallback of `.pnpm/node-gyp@*` | Task 1 tier 3 (dependency-free readdir scan, ordered last per T-QK-01) |
| BRIEF | Verification that postinstall now completes | Task 2 |
| V-1 | Node-only rebuild, not full dual | Task 2 action + done |
| V-2 | Both ABI variants + `.abi` present | Task 2 verify |
| V-3 | Active binding left as Electron variant | Task 2 verify (sha256 equality) |
| V-4 | No vitest / `pnpm test` | Task 2 action + done; all gates are non-vitest node/git commands |
| V-5 | Commit only this task's files | Task 3 |
| V-6 | App must not be running (EBUSY) | Task 2 `<precondition>` + action |

No unplanned items.
</source_audit>

<verification>
1. `node scripts/build-native-dual.mjs --print-node-gyp` prints a resolvable absolute path (Task 1).
2. `pnpm run rebuild:native:node` exits 0 (Task 2).
3. The dual-ABI assertion one-liner prints OK (Task 2).
4. The commit-scope gate prints 0 (Task 3).

Explicitly out of scope for verification: vitest, `pnpm test`, `pnpm run test:unit`, `pnpm install`,
and `pnpm run rebuild:native`. None may be run (V-1, V-4).

Left as a known follow-up, not fixed here: the header comment block of the script still cites Node
25.x / ABI 141 while the host Node is 22.23.0 / ABI 127. Cosmetic drift, orthogonal to this defect;
note it in the summary rather than widening the diff.
</verification>

<success_criteria>
- A clean `pnpm install` on a strict pnpm layout can complete postinstall — no hoisted
  `node_modules/node-gyp` required.
- `node_modules/better-sqlite3-multiple-ciphers/aria-abi/` holds `better_sqlite3.electron.node`,
  `better_sqlite3.node-node`, and `better_sqlite3.node-node.abi`.
- The active native binding is the Electron variant; the desktop app is not stranded.
- One commit, scoped to `scripts/build-native-dual.mjs` plus this plan's planning artifacts.
</success_criteria>

<output>
Create `.planning/quick/260908-kiy-fix-dual-build-node-gyp-resolution-so-cl/260908-kiy-SUMMARY.md` when done.
Record: which resolution tier won on this machine, the ABI stamp value produced, and whether the
node-gyp compile itself surfaced any toolchain warnings.
</output>
