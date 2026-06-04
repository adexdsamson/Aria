/**
 * Phase 15 / Plan 15-09 Task 1 — Whisper binary packaging static guard.
 *
 * Asserts the package.json electron-builder config invariants required for
 * the whisper-cli sidecar binary to (a) be included in the packaged app and
 * (b) be code-signed on macOS so Gatekeeper does not quarantine it.
 *
 * This spec reads package.json only — it does NOT require the actual binary
 * to be present on disk. It is green on the Windows dev machine before the
 * macOS CI build (Task 2) has run.
 *
 * Invariants enforced:
 *   1. build.extraResources includes per-platform whisper-cli entries (D-02).
 *   2. The extraResources `to: "."` mapping resolves the binary to the
 *      resources root (process.resourcesPath) — matching resolveBinaryPath()
 *      in sidecar-manager.ts (Plan 15-02). A from/to typo here would ship a
 *      binary the sidecar can never find.
 *   3. build.mac.binaries lists the sidecar binary path so electron-builder
 *      code-signs it (§Pitfall 2 — an unsigned binary inside a notarized .app
 *      is quarantined by Gatekeeper on macOS 15+).
 *   4. The whisper-cli binary is NOT in build.asarUnpack (asarUnpack is for
 *      .node native addons only; plain executables go in extraResources).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Load package.json ────────────────────────────────────────────────────────

const PKG_PATH = path.resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) as Record<string, unknown>;
const build = pkg['build'] as Record<string, unknown>;

// ─── Helper types ─────────────────────────────────────────────────────────────

interface ExtraResourcesEntry {
  from?: string;
  to?: string;
  filter?: string[];
  platform?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the list of extraResources entries from package.json.
 * Each entry may be a string or an { from, to, filter, platform } object.
 */
function getExtraResources(): ExtraResourcesEntry[] {
  const raw = build['extraResources'];
  if (!Array.isArray(raw)) return [];
  return raw as ExtraResourcesEntry[];
}

/**
 * Returns the mac.binaries array from package.json.
 */
function getMacBinaries(): string[] {
  const mac = build['mac'] as Record<string, unknown> | undefined;
  if (!mac) return [];
  const bins = mac['binaries'];
  if (!Array.isArray(bins)) return [];
  return bins as string[];
}

/**
 * Returns the asarUnpack array from package.json.
 */
function getAsarUnpack(): string[] {
  const raw = build['asarUnpack'];
  if (!Array.isArray(raw)) return [];
  return raw as string[];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Whisper binary packaging config — package.json invariants (D-02, §Pitfall 2)', () => {

  describe('extraResources entries — per-platform whisper-cli', () => {

    it('has a Windows extraResources entry that includes whisper-cli.exe', () => {
      const entries = getExtraResources();
      const winEntry = entries.find(
        (e) =>
          e.platform === 'win32' &&
          Array.isArray(e.filter) &&
          e.filter.some((f) => f.includes('whisper-cli.exe')),
      );
      expect(
        winEntry,
        'Expected a package.json build.extraResources entry with platform="win32" and filter including "whisper-cli.exe".\n' +
        'Add: { "from": "build/whisper/windows/", "to": ".", "filter": ["whisper-cli.exe", "whisper.dll", ...], "platform": "win32" }',
      ).toBeDefined();
    });

    it('Windows extraResources filter includes whisper.dll (required runtime DLL — omitting causes STATUS_DLL_NOT_FOUND / exit 127)', () => {
      const entries = getExtraResources();
      const winEntry = entries.find(
        (e) =>
          e.platform === 'win32' &&
          Array.isArray(e.filter) &&
          e.filter.some((f) => f.includes('whisper-cli.exe')),
      );
      expect(winEntry).toBeDefined();
      expect(
        winEntry?.filter,
        'The Windows extraResources filter MUST include "whisper.dll".\n' +
        'Removing whisper.dll causes whisper-cli.exe to exit with STATUS_DLL_NOT_FOUND (exit 127 / 1 output line) at runtime.\n' +
        'This was verified empirically: with whisper.dll → exit 0 (73 lines); without whisper.dll → exit 127 (1 line).\n' +
        'Add "whisper.dll" to the win32 extraResources filter in package.json.',
      ).toContain('whisper.dll');
    });

    it('has a macOS extraResources entry that includes whisper-cli', () => {
      const entries = getExtraResources();
      const macEntry = entries.find(
        (e) =>
          e.platform === 'darwin' &&
          Array.isArray(e.filter) &&
          e.filter.some((f) => f === 'whisper-cli'),
      );
      expect(
        macEntry,
        'Expected a package.json build.extraResources entry with platform="darwin" and filter including "whisper-cli".\n' +
        'Add: { "from": "build/whisper/macos/", "to": ".", "filter": ["whisper-cli"], "platform": "darwin" }',
      ).toBeDefined();
    });

    it('Windows whisper-cli entry has to: "." so binary lands at process.resourcesPath root (matches sidecar-manager resolveBinaryPath)', () => {
      const entries = getExtraResources();
      const winEntry = entries.find(
        (e) =>
          e.platform === 'win32' &&
          Array.isArray(e.filter) &&
          e.filter.some((f) => f.includes('whisper-cli.exe')),
      );
      expect(winEntry).toBeDefined();
      expect(
        winEntry?.to,
        'Windows whisper-cli extraResources entry must have to: "." so the binary is placed directly under ' +
        'process.resourcesPath (i.e. process.resourcesPath/whisper-cli.exe). ' +
        'sidecar-manager.ts resolveBinaryPath() resolves: path.join(process.resourcesPath, "whisper-cli.exe").',
      ).toBe('.');
    });

    it('macOS whisper-cli entry has to: "." so binary lands at process.resourcesPath root (matches sidecar-manager resolveBinaryPath)', () => {
      const entries = getExtraResources();
      const macEntry = entries.find(
        (e) =>
          e.platform === 'darwin' &&
          Array.isArray(e.filter) &&
          e.filter.some((f) => f === 'whisper-cli'),
      );
      expect(macEntry).toBeDefined();
      expect(
        macEntry?.to,
        'macOS whisper-cli extraResources entry must have to: "." so the binary is placed directly under ' +
        'process.resourcesPath (i.e. process.resourcesPath/whisper-cli). ' +
        'sidecar-manager.ts resolveBinaryPath() resolves: path.join(process.resourcesPath, "whisper-cli").',
      ).toBe('.');
    });

  });

  describe('mac.binaries — macOS sidecar code-signing (§Pitfall 2)', () => {

    it('build.mac.binaries lists the macOS whisper-cli sidecar binary for code-signing', () => {
      const bins = getMacBinaries();
      const hasSidecar = bins.some((b) => b.includes('whisper-cli'));
      expect(
        hasSidecar,
        'package.json build.mac.binaries must include the macOS whisper-cli path so electron-builder ' +
        'code-signs it with the Developer ID certificate.\n' +
        'Without this, Gatekeeper quarantines the binary even inside a notarized .app bundle (§Pitfall 2).\n' +
        'Add: "binaries": ["Contents/Resources/whisper-cli"] to build.mac in package.json.',
      ).toBe(true);
    });

    it('mac.binaries whisper-cli entry matches the extraResources to: "." destination path (Contents/Resources/whisper-cli)', () => {
      const bins = getMacBinaries();
      // The canonical electron-builder path for a resource at process.resourcesPath
      // is "Contents/Resources/<filename>" in the mac.binaries array.
      const canonical = bins.find((b) => b === 'Contents/Resources/whisper-cli');
      expect(
        canonical,
        'The mac.binaries entry for whisper-cli should be "Contents/Resources/whisper-cli" ' +
        '(the electron-builder canonical path for a resource copied to the resources root via extraResources to: ".").\n' +
        'Current entries: ' + JSON.stringify(bins),
      ).toBeDefined();
    });

  });

  describe('asarUnpack exclusion — whisper-cli must NOT be in asarUnpack (anti-pattern §Research)', () => {

    it('build.asarUnpack does not contain any whisper-cli reference', () => {
      const asarUnpack = getAsarUnpack();
      const offenders = asarUnpack.filter((entry) =>
        typeof entry === 'string' && entry.toLowerCase().includes('whisper'),
      );
      expect(
        offenders,
        'build.asarUnpack must NOT include whisper-cli.\n' +
        'asarUnpack is for .node native addons only (e.g. better-sqlite3-multiple-ciphers, sqlite-vec).\n' +
        'Plain executables ship via extraResources (D-02, RESEARCH §Anti-patterns).\n' +
        'Offending entries: ' + JSON.stringify(offenders),
      ).toEqual([]);
    });

  });

});
