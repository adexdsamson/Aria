---
quick_id: 260602-m2g
slug: fix-invisible-tray-icon-dedicated-gold-t
status: complete
date: 2026-06-02
---

# 260602-m2g SUMMARY — Fix invisible system-tray icon

## What was done
Aria's Windows tray icon rendered as a blank square because the tray assets were
rasterised from `build/icon.svg` (the low-contrast ivory app-launcher tile).
Gave the tray its own high-contrast glyph artwork:

- **New SVGs:** `build/tray-glyph.svg` (gold #B8860B squircle + bold ivory "A"), `tray-glyph-badged.svg` (+ ivory activity dot), `tray-glyph-template.svg` (monochrome black "A", transparent — macOS Template), `tray-glyph-badged-template.svg`.
- **`scripts/build-tray-icons.mjs`:** sources `.ico` from the colour glyphs and the macOS Template PNGs from the monochrome glyphs (was sourcing everything from `icon.svg`).
- **Regenerated** all 6 tray assets via `pnpm run icons:tray`.
- Loader (`src/main/tray/icons.ts`) unchanged — already loads `.ico` on win32, `*Template.png` on darwin.

## Verification
- `tray-icon.ico` ≠ `tray-icon-badged.ico` by MD5 (the gold dot now bakes — previously byte-identical).
- macOS Template PNGs regenerated monochrome (300 / 337 bytes).
- 64px preview render = gold squircle + ivory "A" (high contrast).
- **Live (Windows, dev restart):** user confirmed the tray right-click **6-item menu** displays (Show Aria / Generate briefing now / Sync now ▸ / Open approvals / Quit Aria) — the tray icon is present + interactive. This also satisfies the **12-02 Task 4** tray-menu UAT (menu portion).

## Notes
- Tray icon loads once at bootstrap (no HMR) → required a dev-server restart to pick up the new asset.
- Dev-launch reminder: `ELECTRON_RUN_AS_NODE` must be unset or the Electron app crashes at startup (see [[reference_electron_run_as_node_blocks_launch]]).

## Self-Check: PASSED
