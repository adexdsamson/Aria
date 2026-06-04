# whisper.cpp Binary Procurement Contract

This directory stages the per-platform `whisper-cli` binaries for electron-builder
`extraResources` packaging (D-02, Plan 15-09 Task 1).

```
build/whisper/
  windows/   whisper-cli.exe  +  GGML DLLs (from official release)
  macos/     whisper-cli       (built via CI — cmake -DWHISPER_METAL=ON)
  README.md  (this file)
```

The binaries are NOT committed to the repo. They are placed here before a
packaged build run. The `build/whisper/windows/` and `build/whisper/macos/`
directories are git-ignored (see `.gitignore`).

---

## Windows Binary (Official Release — v1.8.6)

**Source:** `https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.6`
**Artifact:** `whisper-bin-x64.zip`
**Contents:**
  - `whisper-cli.exe` — the CLI binary
  - `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll` — required GGML runtime DLLs

**Steps:**
1. Download `whisper-bin-x64.zip` from the GitHub release page.
2. Extract `whisper-cli.exe` and all `ggml*.dll` files into `build/whisper/windows/`.
3. Verify the binary runs: `build\whisper\windows\whisper-cli.exe --help`

Windows OV signing of the Aria installer also covers `whisper-cli.exe` at
signing time. No separate signing step needed for the sidecar binary.

---

## macOS Binary (CI Build — cmake with Metal)

**No official macOS CLI binary exists** in the whisper.cpp release artifacts.
Release v1.8.6 provides only a Swift xcframework (`whisper-v1.8.6-xcframework.zip`),
which is not usable as a standalone CLI binary.

### Option A (RECOMMENDED): Build in GitHub Actions CI (cmake -DWHISPER_METAL=ON)

```yaml
# .github/workflows/build.yml addition — macOS runner step
- name: Build whisper-cli (macOS, Metal-enabled)
  if: runner.os == 'macOS'
  run: |
    git clone --depth=1 --branch v1.8.6 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper-src
    cmake -B /tmp/whisper-build -S /tmp/whisper-src -DWHISPER_METAL=ON
    cmake --build /tmp/whisper-build -j --config Release
    cp /tmp/whisper-build/bin/whisper-cli build/whisper/macos/whisper-cli
    chmod +x build/whisper/macos/whisper-cli

- name: Verify whisper-cli is self-contained (no external dylib deps)
  if: runner.os == 'macOS'
  run: |
    # Must show ONLY system frameworks (no third-party .dylib paths)
    otool -L build/whisper/macos/whisper-cli
    # Confirm it is not dynamically linked to a non-system path
    otool -L build/whisper/macos/whisper-cli | grep -v '/usr/lib\|/System\|whisper-cli' \
      && echo "ERROR: non-system dylib dependency found" && exit 1 \
      || echo "OK: binary is self-contained"
```

**Why Metal:** `cmake -DWHISPER_METAL=ON` enables GPU acceleration on Apple Silicon
and Intel Macs with Metal-capable GPUs. Without Metal, inference falls back to CPU
(slower but functional).

**Self-contained check:** `otool -L build/whisper/macos/whisper-cli` must list ONLY:
  - `/usr/lib/libSystem.B.dylib`
  - `/System/Library/Frameworks/...` (Metal, Accelerate, etc.)
  No third-party `.dylib` paths (e.g. `/usr/local/lib/libX.dylib`) — bundle those or
  rebuild static if found.

**Code signing:** electron-builder signs `Contents/Resources/whisper-cli` automatically
via the `build.mac.binaries` entry in `package.json`, using the Developer ID Application
certificate. This is REQUIRED — an unsigned binary inside a notarized `.app` bundle is
quarantined by Gatekeeper (§Pitfall 2).

**Local dev builds:** Use `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing (existing
CI pattern from `.github/workflows/build.yml`).

### Option B (FALLBACK — temporary only): Third-party community distribution

`https://github.com/bizenlabs/whisper-cpp-macos-bin` provides arm64-Metal and x64
builds. **Use only if CI build is blocked.** Provenance is unverified for a commercial
app — migrate to Option A as soon as a macOS runner is available.

---

## D-04 Fallback: utilityProcess + Native Addon (wire-but-disable)

If macOS binary signing proves intractable (no Apple Developer ID cert available,
signing pipeline blocked), do NOT re-architect mid-phase. Per D-04:

1. Implement the whisper.cpp native addon path (e.g. `nodejs-whisper` or `smart-whisper`)
   behind a compile-time `WHISPER_BACKEND=addon` flag.
2. Wire the fallback into `SttSidecarManager` as a second code path that is
   DISABLED at runtime (gated by a `settings(k,v)` pref `voice.stt.backend=sidecar`).
3. Document the decision in the Plan 15-09 SUMMARY.md under "Deviations".
4. The ratchet in `tests/static/stt-no-native-addon.spec.ts` must be updated to
   allow the addon path only when the fallback is explicitly enabled.

---

## Packaging Flow

`package.json` `build.extraResources` entries:

```json
{
  "from": "build/whisper/windows/",
  "to": ".",
  "filter": ["whisper-cli.exe", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"],
  "platform": "win32"
},
{
  "from": "build/whisper/macos/",
  "to": ".",
  "filter": ["whisper-cli"],
  "platform": "darwin"
}
```

These copy the binaries to the app's `Contents/Resources/` (macOS) or `resources/`
(Windows), which is `process.resourcesPath` at runtime. The `SttSidecarManager`
`resolveBinaryPath()` function resolves the binary from there:

```typescript
// packaged app:
path.join(process.resourcesPath, 'whisper-cli')     // macOS
path.join(process.resourcesPath, 'whisper-cli.exe') // Windows
// dev/test:
path.join(__dirname, '../../../../build', 'whisper-cli[.exe]')
```

The `build.mac.binaries` entry in `package.json` tells electron-builder to
code-sign the `Contents/Resources/whisper-cli` binary with the Developer ID cert,
which is REQUIRED to pass macOS Gatekeeper on a clean install (§Pitfall 2).

---

## Verification Checklist (before packaged build)

- [ ] `build/whisper/windows/whisper-cli.exe` exists and runs with `--help`
- [ ] `build/whisper/windows/ggml.dll` (and other DLLs) present
- [ ] `build/whisper/macos/whisper-cli` exists, is executable, `otool -L` shows only system frameworks
- [ ] Apple Developer ID cert available for macOS notarization (or `CSC_IDENTITY_AUTO_DISCOVERY=false` for dev build)
- [ ] `npx vitest run tests/static/whisper-binary-packaging.spec.ts -x` passes
