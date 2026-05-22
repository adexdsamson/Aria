/**
 * Phase 12 / Plan 12-02 Task 3 — Static-grep ratchet: every cron callsite
 * registers with scheduler.cronRegistry.
 *
 * Walks src/ for `cron.schedule(`, `cronImpl.schedule(`, or `nodeCron.schedule(`
 * callsites. For each match, asserts the same FILE contains a call to
 * `scheduler.cronRegistry.set(` OR `cronRegistry.set(` (sufficient signal that
 * the cron is registered with the lifecycle plumbing — the powerMonitor
 * suspend/resume hooks rely on this).
 *
 * Allowlist: tests/**, scheduler.ts (the registration helper itself),
 * and node-cron type-import shims.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../..', 'src');

const ALLOWLIST = [
  'src/main/lifecycle/scheduler.ts', // the registration helper
];

const CRON_SCHEDULE_RE = /\b(?:cron|cronImpl|nodeCron)\.schedule\s*\(/;
const REGISTRY_SET_RE = /\bcronRegistry\.set\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.isFile() &&
      /\.ts$/.test(entry.name) &&
      !/\.(test|spec)\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Strip block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('no-bare-cron-schedule ratchet', () => {
  const files = walk(SRC_ROOT);
  const root = path.resolve(__dirname, '../..');

  it('every cron.schedule callsite registers with scheduler.cronRegistry', () => {
    const violations: Array<{ file: string; reason: string }> = [];
    for (const abs of files) {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (ALLOWLIST.includes(rel)) continue;
      const raw = fs.readFileSync(abs, 'utf8');
      const code = stripCommentsAndStrings(raw);
      if (!CRON_SCHEDULE_RE.test(code)) continue;
      if (!REGISTRY_SET_RE.test(code)) {
        violations.push({
          file: rel,
          reason:
            'calls cron.schedule() but the same file does not call cronRegistry.set() — register the task with the scheduler so powerMonitor suspend/resume can find it',
        });
      }
    }
    expect(
      violations,
      `no-bare-cron-schedule violations:\n${violations
        .map((v) => `  ${v.file}: ${v.reason}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
