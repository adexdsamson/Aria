/**
 * Phase 12 / Plan 12-02 Task 1 — Tray icon loader.
 *
 * Resolves the platform-correct tray asset path and returns a NativeImage.
 *
 * Win/Linux: tray-icon.ico (plain) / tray-icon-badged.ico (gold-dot queued).
 * macOS:     tray-iconTemplate.png — Template-named so AppKit auto-inverts
 *            on light vs dark menu bar.
 *
 * Asset roots:
 *   - Packaged build: process.resourcesPath (extraResources mapping in
 *     package.json copies build/tray-* alongside the .asar).
 *   - Dev build:      <project>/build (derived from __dirname).
 *
 * No nativeImage.composite — the badged variant is pre-baked at build time
 * (RESEARCH Pitfall 2; composite() does not exist on the nativeImage API).
 */
import { nativeImage, type NativeImage, app } from 'electron';
import * as path from 'node:path';

export type TrayIconVariant = 'plain' | 'badged';

function resolveAssetDir(): string {
  // app.isPackaged is the runtime signal; in tests Electron may be stubbed
  // so we tolerate a missing app object.
  try {
    if (app?.isPackaged && process.resourcesPath) {
      return process.resourcesPath;
    }
  } catch {
    /* electron mock without isPackaged */
  }
  // Dev/test fallback: walk up from out/main → build.
  return path.join(__dirname, '..', '..', '..', 'build');
}

function fileFor(variant: TrayIconVariant, platform: NodeJS.Platform): string {
  const dir = resolveAssetDir();
  if (platform === 'win32') {
    return path.join(
      dir,
      variant === 'badged' ? 'tray-icon-badged.ico' : 'tray-icon.ico',
    );
  }
  // darwin + linux fallback to Template PNGs.
  return path.join(
    dir,
    variant === 'badged'
      ? 'tray-iconBadgedTemplate.png'
      : 'tray-iconTemplate.png',
  );
}

/**
 * Load the tray icon for `variant` on the current platform. Returns a fresh
 * NativeImage on every call so the caller can hand it to `Tray.setImage`
 * without worrying about shared references.
 */
export function loadTrayIcon(
  variant: TrayIconVariant,
  platform: NodeJS.Platform = process.platform,
): NativeImage {
  return nativeImage.createFromPath(fileFor(variant, platform));
}

/** Test-only: expose the resolved path for assertion. */
export function _resolveTrayIconPathForTests(
  variant: TrayIconVariant,
  platform: NodeJS.Platform,
): string {
  return fileFor(variant, platform);
}
