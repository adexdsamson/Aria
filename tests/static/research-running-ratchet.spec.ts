/**
 * Phase 11 — static-grep ratchet for job.status = 'running'.
 *
 * Invariant: the string `job.status = 'running'` MUST appear in exactly ONE
 * file under src/main, and that file MUST be ResearchService.ts.
 *
 * This prevents future contributors from setting status='running' in cron
 * callbacks, IPC handlers, or helper functions — which would break the
 * single-chokepoint design for concurrent-run detection.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_MAIN = path.resolve(__dirname, '../..', 'src', 'main');
const EXPECTED_FILE = path
  .resolve(__dirname, '../..', 'src', 'main', 'services', 'ResearchService.ts')
  .replace(/\\/g, '/');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  // Remove /* */ block comments
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments
  s = s.replace(/\/\/[^\n]*/g, '');
  return s;
}

const PATTERNS = [
  /job\.status\s*=\s*['"]running['"]/,
  /job\.status\s*=\s*`running`/,
];

describe('research-running-ratchet', () => {
  it('only ResearchService.ts sets job.status = "running"', () => {
    const allFiles = walk(SRC_MAIN);
    const matches: string[] = [];

    for (const file of allFiles) {
      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (PATTERNS.some((p) => p.test(src))) {
        matches.push(file.replace(/\\/g, '/'));
      }
    }

    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(EXPECTED_FILE);
  });

  it('ResearchService.ts exports runResearchJob function', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../..', 'src', 'main', 'services', 'ResearchService.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export\s+(async\s+)?function\s+runResearchJob/);
  });
});
