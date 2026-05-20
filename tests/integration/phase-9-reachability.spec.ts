/**
 * Plan 09-06 Task 1 — Phase 9 reachability ratchet.
 *
 * Closes the Phase 4 verifier blindspot (feedback_verifier_blindspot_ui_wiring):
 * a primitive that exists + has unit tests but is not imported by any in-route
 * Screen is a dead-code re-skin. This test catches that programmatically.
 *
 * Assertions:
 *  1. Every named export from `src/renderer/components/editorial/index.ts`
 *     appears in ≥1 import statement in a non-test file outside
 *     `src/renderer/components/editorial/`.
 *  2. No file under `src/renderer/features/` imports from `fonts.googleapis.com`
 *     (Google Fonts CDN — should be self-hosted / via design tokens).
 *  3. Legacy `--aria-accent` CSS variable + `bg-accent` / `text-accent` Tailwind
 *     class usage is ratcheted downward — captured baseline as a constant; any
 *     INCREASE fails the test. The baseline can be lowered by hand as the codebase
 *     finishes the editorial migration.
 *  4. Every feature directory under `src/renderer/features/` has ≥1 file importing
 *     from `components/editorial` (a feature with zero editorial imports is
 *     suspicious — likely missed during the re-skin).
 *
 * Implementation note: uses fs.readdirSync + regex, no AST tooling. Runs <2s.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_ROOT = path.join(REPO_ROOT, 'src', 'renderer');
const EDITORIAL_BARREL = path.join(
  RENDERER_ROOT,
  'components',
  'editorial',
  'index.ts',
);
const FEATURES_ROOT = path.join(RENDERER_ROOT, 'features');

// One-way ratchet baseline. If you lower the count by editing legacy code,
// also lower this constant. The test will FAIL if the count rises.
// Captured 2026-05-20 at Phase 9 close.
const LEGACY_TOKEN_RATCHET_MAX = 250;

/**
 * Known-orphan allowlist — editorial primitives exported from the barrel
 * but not yet wired into any in-route Screen at Phase 9 close.
 *
 * Each entry MUST carry a routing decision: either (a) wire into a Screen
 * in a follow-up plan, or (b) remove the export. New orphans (any name NOT
 * in this list) still fail the test. This is the documented escape hatch
 * surfaced to the Phase 9 human-verify checkpoint (09-06 Task 3).
 *
 * Status at Phase 9 close: surfaced to user; decision pending in 09-UAT.md.
 */
const KNOWN_ORPHAN_PRIMITIVES = new Set<string>([
  // Available for future surfaces (avatar grid not yet built); kept exported
  // because primitives.test.tsx exercises them and a near-term contact /
  // attendee surface will consume them.
  'MonogramSquare',
  'StatusDot',
  // Input: form primitives staged for next Settings polish wave.
  'Input',
  // Modal: DisconnectConfirmDialog uses an inline modal shell; barrel Modal
  // is staged for the unified-confirm refactor in a Phase 10 polish wave.
  'Modal',
]);

/**
 * Known-naked feature allowlist — feature directories with no editorial
 * imports yet. Currently:
 *   - diagnostics: thin wrapper around settings/RoutingLogPanel (which IS
 *     editorial-skinned). No direct editorial usage needed.
 *   - email: ThreadSummaryModal is itself unrouted; flagged for routing
 *     decision in 09-UAT.md.
 */
const KNOWN_NAKED_FEATURES = new Set<string>(['diagnostics', 'email']);

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip nested __tests__ and node_modules
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\.(tsx?|jsx?)$/.test(entry.name)) {
        acc.push(full);
      }
    }
  }
  return acc;
}

function readNamedExports(barrelPath: string): string[] {
  const src = fs.readFileSync(barrelPath, 'utf8');
  const names = new Set<string>();
  // Match: export { Foo } from './Foo';  and  export { Foo, Bar } from './x';
  const re = /export\s*\{([^}]+)\}\s*from/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/\s+as\s+\w+$/, '').trim();
      // Skip type-only exports (export type { ... } already filtered, but
      // also defensive against accidental capture).
      if (!name) continue;
      // Filter out things that start with lowercase (likely values not components)
      // — actually, allow everything; the barrel only exports PascalCase value
      // names and types are emitted separately via `export type { ... }`.
      names.add(name);
    }
  }
  // Remove the type-only re-exports (parsed by the same regex but irrelevant
  // to runtime import statements). The barrel's `export type { ... }` lines
  // also match — filter them out by looking at the source line context.
  const valueExports: string[] = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`^export\\s+type\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`, 'm');
    if (!lineRe.test(src)) valueExports.push(name);
  }
  return valueExports;
}

describe('Phase 9 reachability ratchet', () => {
  const allRendererFiles = walk(RENDERER_ROOT).filter(
    (f) => !f.includes(path.join('components', 'editorial')),
  );

  it('every editorial primitive is imported by ≥1 non-editorial, non-test file', () => {
    const exports = readNamedExports(EDITORIAL_BARREL);
    expect(exports.length).toBeGreaterThan(0);

    const orphans: string[] = [];
    for (const name of exports) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match an import that names this symbol from any editorial path.
      // Permissive: matches default-named bindings inside `import { ... }`.
      // Match import blocks pulling from any path that ends in
      // `editorial` or `editorial/index` (covers `./editorial`,
      // `../editorial`, `components/editorial`, `@/components/editorial`).
      const editorialBlockRe =
        /import\s*\{([^}]*)\}\s*from\s+['"][^'"]*\/editorial(?:\/[^'"]*)?['"]/g;

      const found = allRendererFiles.some((file) => {
        const src = fs.readFileSync(file, 'utf8');
        if (!/editorial/.test(src)) return false;
        let bm: RegExpExecArray | null;
        editorialBlockRe.lastIndex = 0;
        while ((bm = editorialBlockRe.exec(src)) !== null) {
          if (new RegExp(`\\b${escaped}\\b`).test(bm[1])) return true;
        }
        return false;
      });

      if (!found && !KNOWN_ORPHAN_PRIMITIVES.has(name)) orphans.push(name);
    }

    if (orphans.length > 0) {
      throw new Error(
        `Editorial primitive(s) have NO importer outside components/editorial:\n` +
          orphans.map((n) => `  - ${n}`).join('\n') +
          `\n\nEither wire them into a Screen, remove the export, or add the ` +
          `name to KNOWN_ORPHAN_PRIMITIVES with a routing decision.`,
      );
    }
  });

  it('no feature file imports from fonts.googleapis.com', () => {
    const offenders: string[] = [];
    for (const file of walk(FEATURES_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('fonts.googleapis.com')) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders, `Google Fonts CDN references:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('legacy --aria-accent / bg-accent / text-accent usage is ratcheted downward', () => {
    let count = 0;
    for (const file of walk(RENDERER_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      const matches = src.match(/var\(--aria-accent\)|\bbg-accent\b|\btext-accent\b/g);
      if (matches) count += matches.length;
    }
    expect(
      count,
      `Legacy token usage rose to ${count} (ratchet max: ${LEGACY_TOKEN_RATCHET_MAX}). ` +
        `Either lower the count by editing legacy refs, or — if you intentionally added ` +
        `a new legacy use — lower the baseline constant in this test with a justification comment.`,
    ).toBeLessThanOrEqual(LEGACY_TOKEN_RATCHET_MAX);
  });

  it('every feature directory has ≥1 file importing from components/editorial', () => {
    const featureDirs = fs
      .readdirSync(FEATURES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const naked: string[] = [];
    for (const feat of featureDirs) {
      const dir = path.join(FEATURES_ROOT, feat);
      const files = walk(dir);
      const hasEditorialImport = files.some((file) => {
        const src = fs.readFileSync(file, 'utf8');
        return /from\s+['"][^'"]*\/editorial(?:\/[^'"]*)?['"]/.test(src);
      });
      if (!hasEditorialImport && !KNOWN_NAKED_FEATURES.has(feat)) naked.push(feat);
    }

    expect(
      naked,
      `Feature(s) with NO editorial imports — likely missed during re-skin:\n${naked.join('\n')}\n\n` +
        `If intentional, add to KNOWN_NAKED_FEATURES with a routing decision.`,
    ).toEqual([]);
  });
});
