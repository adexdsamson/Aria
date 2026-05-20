/**
 * Plan 08-04 Task 6 — assertions over the package.json `build` block.
 *
 * Plan verify command:
 *   pnpm vitest run -t "package.json build config"
 *
 * L-1 round 2: the plan verify chain uses && (not ||) so a vitest failure
 * does NOT mask via the node-e fallback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('package.json build config', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  const build = pkg.build as Record<string, unknown>;

  it('Test 1 — appId / productName / publish.provider set to expected values', () => {
    expect(build.appId).toBe('com.aria.desktop');
    expect(build.productName).toBe('Aria');
    expect((build.publish as Record<string, unknown>).provider).toBe('github');
  });

  it('Test 2 — mac.hardenedRuntime + entitlements + notarize.teamId from APPLE_TEAM_ID env', () => {
    const mac = build.mac as Record<string, unknown>;
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.entitlements).toBe('build/entitlements.mac.plist');
    const notarize = mac.notarize as Record<string, unknown>;
    expect(notarize.teamId).toBe('${env.APPLE_TEAM_ID}');
  });

  it('Test 3 — win.target = ["nsis"]; certificateFile + certificateSubjectName ABSENT (XCUT-05 staged signing)', () => {
    const win = build.win as Record<string, unknown>;
    expect(win.target).toEqual(['nsis']);
    expect(win.certificateFile).toBeUndefined();
    expect(win.certificateSubjectName).toBeUndefined();
  });

  it('Test 4 — nsis flags: oneClick=false, perMachine=false, allowToChangeInstallationDirectory=true', () => {
    const nsis = build.nsis as Record<string, unknown>;
    expect(nsis.oneClick).toBe(false);
    expect(nsis.perMachine).toBe(false);
    expect(nsis.allowToChangeInstallationDirectory).toBe(true);
  });

  it('Test 5 — asarUnpack preserves existing sqlite-vec native unpacks', () => {
    const unpacks = (build.asarUnpack ?? []) as string[];
    expect(unpacks).toContain('**/node_modules/sqlite-vec/dist/native/**');
    expect(unpacks).toContain('**/node_modules/sqlite-vec-darwin-arm64/**');
    expect(unpacks).toContain('**/node_modules/sqlite-vec-windows-x64/**');
  });

  it('Test 6 — entitlements file contains allow-jit + network.client', () => {
    const text = readFileSync(
      resolve(process.cwd(), 'build/entitlements.mac.plist'),
      'utf8',
    );
    expect(text).toContain('com.apple.security.cs.allow-jit');
    expect(text).toContain('com.apple.security.network.client');
  });

  it('Test 7 — .env.example documents required env vars', () => {
    const text = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    expect(text).toContain('GH_TOKEN');
    expect(text).toContain('APPLE_ID');
    expect(text).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(text).toContain('APPLE_TEAM_ID');
    expect(text).toContain('ARIA_UPDATE_CHANNEL');
  });
});
