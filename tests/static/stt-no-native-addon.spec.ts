/**
 * Phase 15 / Plan 15-02 Task 3 — No-native-addon static ratchet.
 *
 * SC2 / VOICE-04 / D-01 / D-04:
 *   "The STT path ships no native addon, so NODE_MODULE_VERSION is impossible
 *   by construction."
 *
 * Guarantees:
 *   1. No file under src/main/voice/stt/** imports or requires a '.node' file
 *      (the binary-blob format of Node native addons).
 *   2. No file under src/main/voice/stt/** references the banned native-addon
 *      packages: smart-whisper, nodejs-whisper, whisper-node.
 *      (RESEARCH §State of the Art: smart-whisper last published 2024-10,
 *      nodejs-whisper and whisper-node wrap the same native binding.)
 *
 * This spec is the automated proxy for the manual SC2 packaged-launch check
 * (Plan 15-09). It proves the design invariant at CI time, not at runtime.
 *
 * D-01 rationale: a pure CLI binary process cannot throw NODE_MODULE_VERSION
 * because it is not loaded by Node's require() machinery. The sidecar manager
 * (sidecar-manager.ts) calls child_process.spawn() — the binary is exec'd,
 * not require()'d.
 *
 * W-1 MISSING-DIR GUARD: mirrors voice-routes-through-staging.spec.ts.
 * If src/main/voice/stt/ does not exist (pre-Plan-15-02), the spec treats
 * the directory as having zero files and passes. It will fail the moment a
 * .node addon is introduced under that path.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STT_ROOT = path.resolve(__dirname, '../..', 'src', 'main', 'voice', 'stt');

// ─── File walker (mirrors voice-routes-through-staging.spec.ts) ──────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out; // W-1: missing-dir guard
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Block comments first, then line comments — order matters (same as staging ratchet). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

// ─── Banned patterns ──────────────────────────────────────────────────────────

/**
 * Matches any import or require of a .node file.
 * Examples that must be rejected:
 *   require('./addon.node')
 *   require("../bindings.node")
 *   import bindings from './something.node'
 *   import('./foo.node')
 */
const NODE_ADDON_RE = /\.node['"]/;

/**
 * Banned native-addon package names (RESEARCH §State of the Art).
 * smart-whisper: last published 2024-10, wraps whisper.cpp as a native addon.
 * nodejs-whisper: Node native binding, triggers NODE_MODULE_VERSION.
 * whisper-node: wrapper around nodejs-whisper, same ABI coupling.
 */
const BANNED_PACKAGES = ['smart-whisper', 'nodejs-whisper', 'whisper-node'] as const;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SC2 / D-01 — the STT path ships no native addon (NODE_MODULE_VERSION impossible by construction)', () => {
  it('no file under src/main/voice/stt/** imports or requires a .node binary', () => {
    const sttFiles = walk(STT_ROOT);
    const offenders: string[] = [];

    for (const f of sttFiles) {
      // Skip spec/test files — they prove the production code, not enforce it
      if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (NODE_ADDON_RE.test(src)) {
        offenders.push(f.replace(/\\/g, '/'));
      }
    }

    expect(
      offenders,
      `STT files import/require a .node native addon — ABI coupling makes NODE_MODULE_VERSION crashes possible:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it.each(BANNED_PACKAGES)(
    'no file under src/main/voice/stt/** references the banned package: %s',
    (pkg) => {
      const sttFiles = walk(STT_ROOT);
      const offenders: string[] = [];

      for (const f of sttFiles) {
        if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;

        const src = stripComments(fs.readFileSync(f, 'utf8'));
        // Match package name in import/require strings or package.json-style refs
        const RE = new RegExp(`['"]${pkg}['"]`);
        if (RE.test(src)) {
          offenders.push(`${f.replace(/\\/g, '/')} → ${pkg}`);
        }
      }

      expect(
        offenders,
        `STT files reference banned native-addon package '${pkg}' (RESEARCH §State of the Art — D-04):\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    },
  );
});
