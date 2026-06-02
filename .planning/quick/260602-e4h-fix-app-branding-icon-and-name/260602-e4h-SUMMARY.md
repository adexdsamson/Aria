---
quick_id: 260602-e4h
slug: fix-app-branding-icon-and-name
status: complete
date: 2026-06-02
commit: 76fae51
---

# Quick Task 260602-e4h — Summary

Fixed production branding: packaged build showed the default **Electron logo**
and a generic **"electron"** Windows taskbar identity instead of Aria's monogram
and name. Three independent root causes, all fixed in one cohesive commit
(`76fae51`).

## Changes

| Area | Change |
|------|--------|
| Icon assets | New `scripts/build-app-icons.mjs` + `icons:app` script → `build/icon.png` (1024) + `build/icon.ico` (16–256). Committed assets. |
| electron-builder | `win.icon=build/icon.ico`, `mac.icon=build/icon.png` (→.icns on mac runner), `linux.icon=build/icon.png`; `icon.ico`+`icon.png` added to `extraResources`. |
| Runtime window icon | `resolveBrandIcon()` now reads the raster from `process.resourcesPath` (packaged) / `build/` (dev) — was pointing at an SVG that wasn't packaged and can't be a Win/Mac window icon. |
| Windows identity | AUMID `com.aria.app` → `com.aria.desktop` to match electron-builder `appId` (and the NSIS shortcut). Fixes the "electron" taskbar name + default icon. |
| Regression guards | `package-build.test.ts` Tests 8/9 — per-platform icon keys, extraResources filter, assets exist on disk. |

## Verification done

- `icon.png` 1024×1024, `icon.ico` 7 sizes (16/24/32/48/64/128/256) — confirmed.
- Monogram rasterised correctly (ivory squircle, serif "A", gold rule) — the
  Playfair fallback serif is faithful; production-quality.
- `npm run build` (electron-vite) → green. `tsc -p tsconfig.node.json` → clean for `index.ts`.
- Build-config assertions verified directly (vitest couldn't run — see below).

## Outstanding (needs a packaged build to close)

1. **Visual confirmation in a packaged app.** Code + config layer is verified, but
   the embedded icon + taskbar name can only be *seen* after a real
   `electron-builder` run (CI parallel win/mac jobs, or local). Recommend a local
   `electron-builder --win --dir` (fast, no installer) or let GitHub Actions build.
2. **Close the running Aria app first.** It holds the better-sqlite3 native lock
   ([[reference_better_sqlite3_abi_lock]]) — vitest globalSetup hit EBUSY this
   session, and a native rebuild/packaging run will too while it's open.

## Notes

- Pre-existing failing test (out of scope): `package-build.test.ts` Test 2 asserts
  `mac.notarize.teamId`, but `mac.notarize` was intentionally removed earlier
  (electron-builder schema change). Not touched here.
