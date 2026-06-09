/**
 * Gate 10: Supply-chain pin ratchet.
 *
 * Asserts:
 *   1. package.json baileys dep is the exact literal string "6.7.23" (no ^ or ~).
 *   2. qrcode dep is the exact literal string "1.5.4".
 *   3. pnpm-lock.yaml resolves @whiskeysockets/baileys@6.7.23.
 *   4. No dependency key is a non-@whiskeysockets/ "baileys"-ish package name
 *      (supply-chain attack vector per PITFALLS.md Pitfall 8).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../');

function readRootJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, unknown>;
}

function readRootText(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('Supply-chain pin ratchet (Gate 10)', () => {
  it('package.json pins @whiskeysockets/baileys exactly at 6.7.23 (no ^ or ~)', () => {
    const pkg = readRootJson('package.json');
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const pin = deps['@whiskeysockets/baileys'];
    expect(pin, '@whiskeysockets/baileys must be present in dependencies').toBeDefined();
    // Must NOT start with ^ or ~
    expect(pin).not.toMatch(/^[\^~]/);
    // Must be the exact version string
    expect(pin).toBe('6.7.23');
  });

  it('package.json pins qrcode exactly at 1.5.4 (no ^ or ~)', () => {
    const pkg = readRootJson('package.json');
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const pin = deps['qrcode'];
    expect(pin, 'qrcode must be present in dependencies').toBeDefined();
    expect(pin).not.toMatch(/^[\^~]/);
    expect(pin).toBe('1.5.4');
  });

  it('pnpm-lock.yaml contains a resolved entry for @whiskeysockets/baileys@6.7.23', () => {
    const lockfile = readRootText('pnpm-lock.yaml');
    expect(lockfile).toMatch(/@whiskeysockets\/baileys@6\.7\.23/);
  });

  it('no dependency uses a forbidden baileys-fork name (lotusbail, non-@whiskeysockets baileys)', () => {
    const pkg = readRootJson('package.json');
    const allDeps = {
      ...((pkg.dependencies ?? {}) as Record<string, string>),
      ...((pkg.devDependencies ?? {}) as Record<string, string>),
    };
    for (const depName of Object.keys(allDeps)) {
      // Block any package that contains "lotusbail"
      expect(depName, `Forbidden package: ${depName}`).not.toMatch(/lotusbail/i);
      // Block any package named exactly "baileys" (without the @whiskeysockets/ scope)
      // or any scoped-package whose package portion is exactly "baileys" and the scope is NOT @whiskeysockets
      if (depName.startsWith('@')) {
        const [scope, pkg_] = depName.split('/');
        if (pkg_ === 'baileys' && scope !== '@whiskeysockets') {
          throw new Error(`Forbidden scoped baileys fork: ${depName}`);
        }
      } else {
        expect(depName).not.toBe('baileys');
      }
    }
  });
});
