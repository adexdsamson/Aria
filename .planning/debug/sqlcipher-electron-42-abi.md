---
slug: sqlcipher-electron-42-abi
status: resolved
reopened: 2026-05-16 — inline fix attempt revealed a second, more invasive blocker
  in Electron 42's bundled V8 headers (cppgc/heap.h __builtin_frame_address on MSVC).
  Second-cycle investigation completed; pin Electron to 41.6.1.
trigger: |
  better-sqlite3-multiple-ciphers@12.9.0 native build fails against Electron 42 V8 ABI
  (External::Value / External::New signature changes). Unit tests pass under Node but
  Electron runtime cannot load the encrypted DB module, blocking Phase 1 onboarding e2e
  and hello-Aria verify gate. Options surfaced in plan SUMMARY: vendor patch, pin
  Electron 38-39, wait for upstream. Diagnose root cause and recommend a fix path.
created: 2026-05-16
updated: 2026-05-16
---

# Debug Session: sqlcipher-electron-42-abi

## Symptoms

- **Expected:** `npm run test:e2e -- tests/e2e/onboarding.spec.ts` boots Electron 42, loads
  better-sqlite3-multiple-ciphers, creates an encrypted SQLCipher DB, and the onboarding
  wizard completes end-to-end.
- **Actual:** Native module load fails at runtime inside Electron 42. Build/link step
  against Electron's V8 headers reports signature mismatch on `v8::External::Value()` and
  `v8::External::New()`. Module compiles and loads cleanly under plain Node (vitest unit
  tests pass — 35/35).
- **Error signal:** V8 ABI signature mismatch on `External::Value` / `External::New`
  during electron-rebuild of better-sqlite3-multiple-ciphers@12.9.0. Postinstall
  electron-rebuild is wrapped non-fatally; failure surfaces only when Electron tries to
  `require()` the module.
- **Timeline:** Surfaced during Plan 01-02 execution (2026-05-16). Never worked against
  Electron 42 in this repo. Was assumed compatible at Plan 01-01a (RESEARCH-pinned
  versions).
- **Reproduction:** `npm install` (electron 42.1.0 + better-sqlite3-multiple-ciphers
  12.9.0) → `npm run rebuild:native` → fails. Or run `npm run test:e2e --
  tests/e2e/onboarding.spec.ts` and observe runtime load error in Electron.

## References

- .planning/phases/01-foundation/01-02-db-passphrase-SUMMARY.md (Deviations →
  Architectural Blocker)
- .planning/phases/01-foundation/01-01a-tooling-SUMMARY.md (pinned versions:
  electron@42.1.0, better-sqlite3-multiple-ciphers@12.9.0)
- .planning/phases/01-foundation/01-RESEARCH.md
- scripts/postinstall.mjs (currently wraps electron-rebuild non-fatally)
- package.json (pins)

## Evidence

(see "Reopen evidence" below for second-cycle additions)

- timestamp: 2026-05-16T10:30Z
  source: `npm view better-sqlite3-multiple-ciphers versions` + `dist-tags`
  finding: Latest published fork version is **12.9.0** (released 2026-04-14). No newer
    release exists; the fork is one minor behind upstream `better-sqlite3@12.10.0`
    (2026-05-12).

- timestamp: 2026-05-16T10:31Z
  source: `node-abi` lookup for `electron`
  finding: NODE_MODULE_VERSION map — Electron 38→139, 39→140, 40→143, 41→145, **42→146**.

- timestamp: 2026-05-16T10:32Z
  source: `electron-to-chromium/versions`
  finding: Electron 41.x → Chromium 146 (V8 pre-12.8); **Electron 42.x → Chromium 148**
    (V8 12.8+).

- timestamp: 2026-05-16T10:34Z
  source: Inspection of upstream `better-sqlite3@12.10.0` source
  finding: Both `src/util/macros.cpp:30` (`OnlyAddon` macro using no-arg
    `External::Value()`) and `src/better_sqlite3.cpp:60` (`External::New(isolate, addon)`
    without `static_cast<void*>`) trigger C2660 against V8 12.8 headers. Same source in
    12.9.0. Fork inherits the bug from upstream.

- timestamp: 2026-05-16T10:50Z
  source: corrected V8 headers `~/.electron-gyp/42.1.0/include/node/v8-external.h`
  finding: Actual V8 12.8+ signatures:
    `static Local<External> New(Isolate*, void*, ExternalPointerTypeTag);`
    `void* Value(ExternalPointerTypeTag) const;`
    The legacy no-arg `Value()` and 2-arg `New(Isolate*, void*)` are removed in 12.8.

## Reopen evidence (second cycle, 2026-05-16)

- timestamp: 2026-05-16T11:00Z
  source: `~/.electron-gyp/42.1.0/include/node/cppgc/heap.h` (line 38–45)
  finding: Class `StackStartMarker` is defined with an inline constructor
    `StackStartMarker() : stack_start_(__builtin_frame_address(0)) {}`. There
    is NO `_MSC_VER` / `V8_HAS_BUILTIN_FRAME_ADDRESS` guard. Any native addon that
    transitively includes `cppgc/heap.h` on Windows + MSVC fails to compile with
    C3861. This is upstream V8 / Electron 42 — not in our patch surface.

- timestamp: 2026-05-16T11:02Z
  source: Electron 41.6.1 headers tarball
    (`https://artifacts.electronjs.org/headers/dist/v41.6.1/node-v41.6.1-headers.tar.gz`),
    file `include/node/cppgc/heap.h`
  finding: **The entire `StackStartMarker` class is absent from Electron 41's
    `cppgc/heap.h`.** It was introduced in V8 12.8 (Chromium 148 / Electron 42).
    Electron 41 builds are not affected by the heap.h MSVC issue.

- timestamp: 2026-05-16T11:03Z
  source: Electron 41.6.1 `include/node/v8-external.h`
  finding: Both legacy AND tag-form `External::*` overloads exist:
    - line 32: `static Local<External> New(Isolate*, void*)` (legacy)
    - line 45: `static Local<External> New(Isolate*, void*, ExternalPointerTypeTag);`
    - line 55: `void* Value() const { return Value(kExternalPointerTypeTagDefault); }` (legacy delegating wrapper)
    - line 65: `void* Value(ExternalPointerTypeTag) const;`
    Implication: **the corrected vendor patch (tag-form) is forward-portable to
    Electron 41**. Equally important: the *unpatched* upstream code (no-arg
    `Value()`, 2-arg `New`) ALSO compiles against Electron 41 because the legacy
    overloads are retained. On Electron 41 the vendor patch is OPTIONAL.

- timestamp: 2026-05-16T11:04Z
  source: Electron 41.6.1 `include/node/v8-template.h` (lines 104–112)
  finding: `Template::SetNativeDataProperty` has a single
    `AccessorNameSetterCallback setter = nullptr` overload. No `nullptr_t`
    overload exists yet. Therefore the C2668 ambiguity in `helpers.cpp:89`
    (literal `0` as setter) does NOT reproduce on Electron 41. Patch surface
    on Electron 41 is zero.

- timestamp: 2026-05-16T11:05Z
  source: `npm view electron dist-tags` + tag list scan via GitHub API
  finding: Electron 42 line has only `42.0.0` and `42.1.0` — one stable patch
    release. No `42.x.y` patch has shipped a fix for the heap.h MSVC bug.
    Electron 41 line has 17 patch releases through `41.6.1` (current latest),
    indicating a mature stable line. Electron's support policy guarantees
    support for the latest three majors (42, 41, 40) — 41.x will receive
    security patches until Electron 44 ships (~3 months given Chromium's
    8-week major cadence).

- timestamp: 2026-05-16T11:06Z
  source: Re-evaluation of Option 3 (clang-cl)
  finding: clang-cl would solve the `__builtin_frame_address` issue (it's a
    Clang/GCC builtin that clang-cl supports under MSVC ABI). However it does
    NOT solve the original `External::*` API breakage (that's a header API
    change, not a compiler builtin issue). So clang-cl gets us past heap.h
    but still requires the vendor patch — net cost is HIGHER than Option 1
    (pin Electron 41), not lower, because we'd carry both the patch AND a
    non-standard toolchain for every Windows contributor + CI runner. macOS
    and Linux are unaffected by the heap.h issue (both use clang/gcc by
    default) but would also need clang for consistency if we go this path.

- timestamp: 2026-05-16T11:07Z
  source: Re-evaluation of Option 4 (wait for Electron patch)
  finding: An Electron 42.x.y release including the `_MSC_VER` guard requires
    either (a) an upstream V8 patch landing in Chromium and rolling forward
    into Electron, or (b) an Electron-local patch in their `patches/v8/`
    chromium-style patch set. Both are uncertain; Chromium does not
    officially support MSVC for V8 (they use clang on Windows), so the V8
    team is unlikely to prioritize an MSVC fix unless an Electron maintainer
    upstreams it. Worst case: indefinite. Best case: weeks. This is the same
    "wait" posture we already rejected for upstream better-sqlite3 in the
    first cycle.

## Eliminated

- "Just upgrade to better-sqlite3-multiple-ciphers latest" — there is no newer
  release than 12.9.0.
- "Wait for upstream better-sqlite3 sync" — upstream 12.10.0 also has the defect.
- "Toolchain / VS Build Tools issue" — errors are header API changes (C2660) and
  a header builtin (C3861), not linker/SDK errors.
- "Bug in our code" — 35/35 unit tests pass under Node.
- **Option 2 alone (vendor patch only)** — eliminated this cycle. The vendor
  patch resolves the `External::*` C2660s and the `helpers.cpp` C2668 but cannot
  reach `~/.electron-gyp/.../cppgc/heap.h`, which lives in a per-developer cache
  outside the repo. Patching that cache would make the build non-reproducible
  across machines / CI / contributors.
- **Option 3 (clang-cl)** — eliminated this cycle. Higher net cost than Option 1
  (still requires the patch, adds toolchain divergence for every Windows dev,
  no offsetting benefit because the addon is the only consumer of the
  problematic header). May revisit if Electron 41 also presents a blocker in
  later phases.
- **Option 4 (wait)** — eliminated this cycle. No upstream momentum; Chromium
  V8 does not officially support MSVC, so the fix is not on a known timeline.
  Blocking Phase 1 indefinitely is incompatible with the Plan 01-03 CASA review
  lead time.

## Specialist Review

specialist_hint: rust → no skill mapped. The relevant expertise is C++/V8
native-addon authorship and Chromium/V8 build internals, which is not covered
by any configured specialist skill. Resolution issued without specialist review.

## Resolution

**Root cause (final, two-layer):**

1. **Layer 1 — addon source:** `better-sqlite3-multiple-ciphers@12.9.0` (and
   upstream `better-sqlite3@12.10.0`) uses pre-V8-12.8 forms of
   `v8::External::Value()` and `v8::External::New()`, and uses literal `0` as
   the `setter` argument to `Template::SetNativeDataProperty` in
   `src/util/helpers.cpp:89`. All three break under Electron 42 (V8 12.8+).
2. **Layer 2 — Electron 42 headers:** `cppgc/heap.h:40` uses
   `__builtin_frame_address(0)` unguarded in an inline constructor. This is a
   Clang/GCC builtin and fails on MSVC with C3861. The file is shipped inside
   `~/.electron-gyp/42.1.0/include/node/` and is therefore outside any
   repo-vendored patch surface. Affects any native addon transitively
   including `cppgc/heap.h` on Windows + MSVC, not just better-sqlite3.

Layer 1 can be patched in-repo. Layer 2 cannot be patched reproducibly on
Electron 42.

**Recommended fix path: Pin Electron to `41.6.1`.**

Specific pin: `"electron": "41.6.1"` (exact pin, not caret). Latest stable on
the 41 line; Chromium 146; V8 pre-12.8.

**Why this is the single best path (evidence-backed):**

| Option | Verdict | Net cost |
|---|---|---|
| 1. **Pin Electron 41.6.1** | **ACCEPT** | Zero compile-time blockers (Electron 41 headers are clean per evidence 2026-05-16T11:02Z/11:03Z/11:04Z). Vendor patch becomes OPTIONAL — the addon's unpatched legacy `External::*` forms still compile against Electron 41's V8 which retains both legacy and tag overloads. One-line change in `package.json`, one-line update in `01a-tooling-SUMMARY.md`, one paragraph in `01-RESEARCH.md` Pitfalls. Supported by Electron team until Electron 44 ships (~3 months runway). |
| 2. Vendor patch + electron-gyp cache patch | Reject | Non-reproducible across machines/CI; patches a cache directory that is re-downloaded on every Electron version bump. |
| 3. clang-cl toolchain | Reject | Solves heap.h but not the addon API breakage; net cost higher than Option 1. |
| 4. Wait for Electron 42.x.y | Reject | No known timeline; Chromium V8 does not officially support MSVC; blocks Phase 1 indefinitely against the multi-week CASA lead time in Plan 01-03. |

**Concrete fix steps:**

1. **`package.json`** — change `"electron"` from `"^42.1.0"` (or whatever the
   current 42 pin is) to `"41.6.1"` (exact). Run `npm install`.
2. **Remove or neutralize the vendor patch** — the corrected patch in
   `patches/better-sqlite3-multiple-ciphers+12.9.0.patch` is not needed
   against Electron 41 and uses an API form (`ExternalPointerTypeTag`) that
   doesn't help here. Recommended: delete the patch file and remove
   `patch-package` from the postinstall chain. If you want to keep the
   patch as defense-in-depth for a future Electron 42+ migration, leave it
   in place — Electron 41 retains the legacy overloads so the patched
   tag-form ALSO compiles (forward-compatible). Either way, `patch-package`
   will report no rejects against the unmodified 12.9.0 source under
   Electron 41 because no errors fire in the first place.
3. **`scripts/postinstall.mjs`** — restore the original "fail-hard on
   electron-rebuild failure" posture; with Electron 41 the rebuild should
   succeed cleanly so a non-fatal wrapper is no longer needed as a hack.
4. **`.planning/phases/01-foundation/01-01a-tooling-SUMMARY.md`** — update
   the pinned Electron version from 42.1.0 → 41.6.1 with a note pointing at
   this debug session for context.
5. **`.planning/phases/01-foundation/01-RESEARCH.md`** — add a Pitfalls entry:
   "Electron 42 ships V8 12.8 whose `cppgc/heap.h` uses unguarded
   `__builtin_frame_address`, breaking MSVC builds of any native addon
   transitively including it. Re-test all native addons before bumping
   Electron major. Track electron/electron for the heap.h `_MSC_VER` guard
   as the sunset condition for the 41.x pin."
6. **Verify:** `npm run rebuild:native` (clean), then
   `npm run test:e2e -- tests/e2e/onboarding.spec.ts` to close Plan 01-02's
   deferred verify gate, then proceed to Plan 01-03.

**Sunset condition (when to bump back to Electron 42+):**

Any one of the following is sufficient evidence to revisit the pin:

- Electron releases a 42.x.y or 43.x.y whose `cppgc/heap.h` either omits
  `StackStartMarker`'s inline constructor, guards it with `_MSC_VER`, or
  uses `V8_HAS_BUILTIN_FRAME_ADDRESS` from `v8config.h`. Verify by
  downloading the headers tarball from
  `https://artifacts.electronjs.org/headers/dist/vX.Y.Z/node-vX.Y.Z-headers.tar.gz`
  and grepping `include/node/cppgc/heap.h` for `_MSC_VER` /
  `V8_HAS_BUILTIN_FRAME_ADDRESS`.
- AND `better-sqlite3-multiple-ciphers` publishes a release whose
  `src/util/macros.cpp` uses the `ExternalPointerTypeTag` form of
  `External::Value` and whose `src/util/helpers.cpp` uses `nullptr` (not
  `0`) for the `SetNativeDataProperty` setter.

When both conditions are met, drop the 41.x pin, drop any vendor patches,
and re-run the e2e onboarding spec under the new Electron line.

**Risk of pinning to 41.6.1:**

- Low. Electron 41 is a current, fully supported line. Chromium 146 is
  current-major-minus-2 (Chromium 148 is on Electron 42), well within
  Chromium's security support window. We do not lose access to any Aria-relevant
  feature (no Electron 42-only API is referenced anywhere in Plans 01-03).
- The pin is reversible (sunset conditions documented above) and the cost of
  revisiting is one `package.json` change + `npm run rebuild:native` + re-run
  of the onboarding e2e.
- CASA review timing for Plan 01-03 (Google OAuth scopes) is unaffected by the
  Electron version pin — CASA evaluates the application's OAuth posture, not
  its desktop runtime.

**Files touched by the fix:**

- `package.json` (Electron pin → 41.6.1; possibly remove `patch-package` dev dep)
- `scripts/postinstall.mjs` (restore fail-hard rebuild)
- `patches/better-sqlite3-multiple-ciphers+12.9.0.patch` (delete OR keep as
  forward-compatible defense-in-depth — author's choice)
- `.planning/phases/01-foundation/01-01a-tooling-SUMMARY.md` (Electron version note)
- `.planning/phases/01-foundation/01-RESEARCH.md` (Pitfalls entry)
- `.planning/phases/01-foundation/01-02-db-passphrase-SUMMARY.md` (note
  resolution and re-enable the deferred verify gate)

**Out-of-scope follow-ups (do not block Plan 01-03):**

- File an issue against `electron/electron` referencing
  `include/node/cppgc/heap.h:40` `StackStartMarker::StackStartMarker()` and
  the missing `_MSC_VER` guard, citing `v8config.h`'s
  `V8_HAS_BUILTIN_FRAME_ADDRESS` macro as the intended gate.
- File an issue against `m4heshd/better-sqlite3-multiple-ciphers` referencing
  the same defect in upstream `better-sqlite3@12.10.0` and offering the
  tag-form diff from the original first-cycle Resolution.
