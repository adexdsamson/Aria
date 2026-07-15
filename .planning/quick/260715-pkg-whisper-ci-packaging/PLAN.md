---
quick_id: 260715-pkg
slug: whisper-ci-packaging
date: 2026-07-15
---

# Unblock CI packaging (electron-builder schema + whisper staging)

## Problem

No installer has built in CI since 2026-06-28. Root cause (confirmed from
run 29403002015 logs): electron-builder 26.8.1 rejects the `build` config at
schema validation:

```
configuration.extraResources[1] has an unknown property 'platform'
configuration.extraResources[2] has an unknown property 'platform'
```

Two whisper (voice) `extraResources` entries carried a `platform` key, which
electron-builder's FileSet schema does not allow. v25 was lenient; v26
(resolved by `npx electron-builder` in CI) enforces it. Both `build-win` and
`build-mac` die before packaging.

Secondary issue: whisper binaries are gitignored ("CI-procured ... not
committed") but no CI procurement step exists, so `build/whisper/{windows,macos}/`
are absent on the runner even after the schema fix.

Decision (user): exclude voice from CI builds for now — Voice milestone is
unreleased/in-progress. Get an OAuth-testable installer building; add whisper
procurement later.

## Change

1. `package.json` build config: remove the invalid `platform`-keyed entries
   from top-level `extraResources`; relocate them under `win.extraResources`
   (windows whisper) and `mac.extraResources` (macos whisper) — the idiomatic
   platform-scoping (no `platform` key needed; merged with top-level).
2. `.github/workflows/build.yml`: add a "Stage voice binaries dir" step before
   Package in both jobs (`mkdir -p build/whisper/windows` / `.../macos`) so
   electron-builder's `from` resolves to an existing (empty) dir; the filter
   matches nothing → nothing copied, no error. Voice binaries simply absent
   from CI installers until procurement is added.

## Verification

- `js-yaml` parse OK; staging step ordered before Package in both jobs.
- package.json valid; win/mac extraResources present, top-level trimmed to icons.
- CI run reaches Package and produces artifacts (watched).

## Follow-up (deferred)

- Add whisper.cpp procurement step (download win + mac binaries into
  build/whisper/) to ship a voice-capable installer.
