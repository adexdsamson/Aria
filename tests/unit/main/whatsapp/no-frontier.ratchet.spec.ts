/**
 * Gate 3 — Frontier-import prohibition ratchet for src/main/whatsapp/.
 *
 * The WhatsApp group-digest (Phase 21) must use ONLY the local model via
 * getLocalModel(). No file under src/main/whatsapp/ may import or call
 * frontier-routing primitives. This ratchet is planted in Phase 20 — BEFORE
 * the digest cron exists — so the constraint is enforced from the moment the
 * directory appears.
 *
 * Banned identifiers / import paths:
 *   - getFrontierModel
 *   - getFrontierKey
 *   - @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google  (provider imports)
 *
 * MISSING-DIR GUARD (W-1): src/main/whatsapp/ may not exist until Plan 20-04.
 * walk() returns [] when the directory is absent so this spec stays GREEN
 * immediately and turns load-bearing once any source file appears there.
 *
 * Template: tests/static/voice-streaming-no-write.spec.ts (walk + stripComments
 * + identifier-boundary RE pattern — copied and adapted).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const WHATSAPP_ROOT = path.resolve(__dirname, '../../../..', 'src', 'main', 'whatsapp');

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

/** Block comments first, then line comments — order matters. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('Gate 3 — no frontier imports in src/main/whatsapp/**', () => {
  const files = walk(WHATSAPP_ROOT);

  it('directory scan returns a list (empty when dir absent — W-1 guard)', () => {
    expect(Array.isArray(files)).toBe(true);
  });

  it('no file calls getFrontierModel()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const RE = /(?:^|[^A-Za-z0-9_$])getFrontierModel(?:[^A-Za-z0-9_$]|$)/;
      if (RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('no file calls getFrontierKey()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const RE = /(?:^|[^A-Za-z0-9_$])getFrontierKey(?:[^A-Za-z0-9_$]|$)/;
      if (RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('no file imports from @ai-sdk/anthropic, @ai-sdk/openai, or @ai-sdk/google', () => {
    const offenders: string[] = [];
    const AI_SDK_RE = /@ai-sdk\/(anthropic|openai|google)/;
    for (const f of files) {
      if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(f)) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      if (AI_SDK_RE.test(src)) offenders.push(f.replace(/\\/g, '/'));
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });
});
