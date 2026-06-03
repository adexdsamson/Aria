/**
 * Phase 15 / Plan 15-01 Task 3 — CSP blob: guard (static ratchet).
 *
 * D-19: The AudioWorklet is bundled as an inline Blob URL to dodge
 * Electron's file-protocol CSP. This requires `blob:` in the `script-src`
 * directive of BOTH the production and development CSP headers in
 * src/main/index.ts.
 *
 * Without `blob:`, `new URL(blobUrl)` resolves fine but `registerProcessor`
 * inside the worklet throws a CSP violation in the packaged build — a silent
 * failure that is very hard to diagnose.
 *
 * This test reads src/main/index.ts as source text and asserts that:
 *   1. prodCspHeader() function body contains `script-src` followed by `blob:`
 *   2. devCspHeader() function body contains `script-src` followed by `blob:`
 *
 * T-15-01 (threat model): `blob:` added ONLY to script-src; connect-src
 * MUST NOT be changed (hard egress gate). This spec also asserts connect-src
 * is unchanged relative to the pre-Phase-15 baseline.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const INDEX_TS = path.resolve(__dirname, '../../src/main/index.ts');

describe('CSP blob: guard — both prodCspHeader and devCspHeader must allow blob: in script-src', () => {
  let src: string;

  it('src/main/index.ts can be read', () => {
    expect(() => {
      src = fs.readFileSync(INDEX_TS, 'utf8');
    }).not.toThrow();
  });

  it('prodCspHeader() allows blob: in script-src directive', () => {
    const source = fs.readFileSync(INDEX_TS, 'utf8');
    // Extract the prodCspHeader function body.
    const prodMatch = source.match(/function prodCspHeader\(\)[^{]*\{([\s\S]*?)^\}/m);
    expect(prodMatch, 'prodCspHeader() function not found in src/main/index.ts').toBeTruthy();
    const prodBody = prodMatch![1];
    expect(
      /script-src[^;'"]*\bblob:/.test(prodBody),
      `prodCspHeader() script-src must contain blob: (needed for AudioWorklet Blob URL registration in packaged build).\n` +
      `Found body:\n${prodBody}`,
    ).toBe(true);
  });

  it('devCspHeader() allows blob: in script-src directive', () => {
    const source = fs.readFileSync(INDEX_TS, 'utf8');
    // Extract the devCspHeader function body.
    const devMatch = source.match(/function devCspHeader\(\)[^{]*\{([\s\S]*?)^\}/m);
    expect(devMatch, 'devCspHeader() function not found in src/main/index.ts').toBeTruthy();
    const devBody = devMatch![1];
    expect(
      /script-src[^;'"]*\bblob:/.test(devBody),
      `devCspHeader() script-src must contain blob: (needed for AudioWorklet Blob URL registration in dev mode).\n` +
      `Found body:\n${devBody}`,
    ).toBe(true);
  });

  it('connect-src is unchanged — blob: MUST NOT appear in connect-src (T-15-01 hard egress gate)', () => {
    const source = fs.readFileSync(INDEX_TS, 'utf8');
    // connect-src should contain the baseline hosts and NOT blob:.
    // Blob: in connect-src would give a net egress path to blob: "servers" —
    // a nonsensical allowlist entry, but also a sign the edit drifted.
    const connectSrcMatches = [...source.matchAll(/connect-src[^;'"]+/g)];
    expect(connectSrcMatches.length, 'No connect-src directive found in CSP functions').toBeGreaterThan(0);
    for (const m of connectSrcMatches) {
      expect(
        m[0],
        `connect-src must NOT contain blob: (T-15-01 hard egress gate — voice must not gain a network egress path)`,
      ).not.toMatch(/\bblob:/);
    }
  });
});
