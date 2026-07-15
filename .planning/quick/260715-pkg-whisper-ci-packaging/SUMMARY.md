---
quick_id: 260715-pkg
slug: whisper-ci-packaging
date: 2026-07-15
status: complete
---

# Summary

Unblocked CI packaging (broken since 2026-06-28), which was preventing any
installer — and therefore blocking live UAT of the OAuth CI fix (260715-4np).

## Changes

- **`package.json`** — removed the invalid `"platform"` key from the two whisper
  `extraResources` entries (electron-builder 26 schema rejects it). Relocated
  them to `win.extraResources` (windows whisper .exe/.dll) and
  `mac.extraResources` (macos whisper-cli). Top-level `extraResources` now holds
  only the icon/tray assets.
- **`.github/workflows/build.yml`** — added a "Stage voice binaries dir" step
  before Package in both `build-win` and `build-mac` (`mkdir -p
  build/whisper/{windows,macos}`), so electron-builder's `from` resolves to an
  existing (empty) dir on the runner. Filter matches nothing → no copy, no error.

## Decision

Voice/whisper excluded from CI installers for now (Voice milestone unreleased).
Local builds still bundle whisper (binaries present on the dev machine).

## Verified

- Workflow YAML parses; staging step ordered before Package in both jobs.
- package.json valid JSON; extraResources restructured as intended.
- CI run watched to completion (see STATE.md row for outcome).

## Iteration 2 (mac ad-hoc signing)

First push (b7f06f7): build-win GREEN (installer built + artifact uploaded);
build-mac FAILED. Even unsigned (`CSC_IDENTITY_AUTO_DISCOVERY: false`),
electron-builder falls back to AD-HOC signing, which still walks
`mac.binaries` and runs `codesign` on `Contents/Resources/whisper-cli` →
"No such file or directory" (whisper excluded from CI). Fix: removed the
`mac.binaries` whisper-cli entry from package.json too.

## Follow-up (deferred)

- Add whisper.cpp binary procurement to CI for a voice-capable installer.
  When doing so, RE-ADD `mac.binaries: ["Contents/Resources/whisper-cli"]`
  (removed here) so the procured binary gets ad-hoc/real signed.

## Files touched

- `package.json`
- `.github/workflows/build.yml`
