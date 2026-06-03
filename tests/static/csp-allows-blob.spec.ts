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
 * This test reads src/main/index.ts as source text (comments stripped) and
 * asserts that:
 *   1. prodCspHeader() string concatenation contains 'script-src' followed
 *      by blob: on the same string segment
 *   2. devCspHeader() likewise
 *
 * T-15-01 (threat model): blob: added ONLY to script-src; connect-src
 * MUST NOT be changed (hard egress gate). This spec also asserts the
 * connect-src string segments do NOT include blob:.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const INDEX_TS = path.resolve(__dirname, '../../src/main/index.ts');

/** Strip block and line comments from source text. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('CSP blob: guard — both prodCspHeader and devCspHeader must allow blob: in script-src', () => {
  it('src/main/index.ts can be read', () => {
    expect(fs.existsSync(INDEX_TS)).toBe(true);
  });

  it('prodCspHeader() allows blob: in script-src directive', () => {
    const source = stripComments(fs.readFileSync(INDEX_TS, 'utf8'));
    // Check for the pattern: a string literal containing 'script-src' and also 'blob:'
    // The CSP header is built as a string concatenation; blob: must be on a segment
    // that also contains script-src.
    const PROD_RE = /prodCspHeader[\s\S]{0,500}?script-src[\s\S]{0,200}?blob:/;
    expect(
      PROD_RE.test(source),
      `prodCspHeader() must contain blob: in its script-src segment.\n` +
      `AudioWorklet Blob URL registration requires script-src blob: in the packaged build.\n` +
      `Edit prodCspHeader() in src/main/index.ts to add blob: to the script-src directive.`,
    ).toBe(true);
  });

  it('devCspHeader() allows blob: in script-src directive', () => {
    const source = stripComments(fs.readFileSync(INDEX_TS, 'utf8'));
    const DEV_RE = /devCspHeader[\s\S]{0,500}?script-src[\s\S]{0,200}?blob:/;
    expect(
      DEV_RE.test(source),
      `devCspHeader() must contain blob: in its script-src segment.\n` +
      `Edit devCspHeader() in src/main/index.ts to add blob: to the script-src directive.`,
    ).toBe(true);
  });

  it('connect-src string segments do NOT contain blob: (T-15-01 hard egress gate)', () => {
    const source = stripComments(fs.readFileSync(INDEX_TS, 'utf8'));
    // Find string literals that start with connect-src and assert they don't contain blob:.
    // This catches accidental drift where blob: ends up in the wrong directive.
    const connectSrcMatches = [...source.matchAll(/"connect-src[^"]+"/g)];
    expect(
      connectSrcMatches.length,
      'No connect-src string literal found in CSP functions (did the format change?)',
    ).toBeGreaterThan(0);
    for (const m of connectSrcMatches) {
      expect(
        m[0],
        `connect-src string literal must NOT contain blob: (T-15-01 hard egress gate — voice must not gain a network egress path)`,
      ).not.toMatch(/\bblob:/);
    }
  });
});
