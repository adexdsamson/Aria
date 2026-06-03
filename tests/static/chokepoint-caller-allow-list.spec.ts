/**
 * Plan 14-03 Task 1 — D-08/D-09 chokepoint caller allow-list ratchet (Ratchet B).
 *
 * The three exported write-module entry points are the approval-gated chokepoints
 * that reach external providers (Gmail, Google Calendar, Todoist). They enforce
 * assertApproved at their function boundary.
 *
 * This ratchet fences each entry point to ONLY its one known IPC caller.
 * Any rogue caller — including any future src/main/voice/** handler — that
 * imports or calls these entry points DIRECTLY (bypassing the IPC staging layer)
 * turns this spec red, proving the write path is closed.
 *
 * Context: The existing write-site ratchets (single-calendar-write-site.test.ts
 * et al.) guard only the low-level SDK surface (events.patch / messages.send).
 * This ratchet guards the EXPORTED chokepoint entry points themselves — the gap
 * a voice handler could exploit (D-09).
 *
 * Three entry points and their sole allowed callers:
 *   sendApprovedEmail          → src/main/ipc/gmail-send.ts
 *   applyCalendarChange        → src/main/ipc/approvals.ts
 *   pushApprovedMeetingActions → src/main/ipc/todoist.ts
 *
 * Comment-only mentions in scheduling/propose.ts and learning/sources/approval.ts
 * are stripped by stripComments and do NOT register as callers.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..', 'src', 'main');

function abs(rel: string): string {
  return path.resolve(__dirname, '../..', rel).replace(/\\/g, '/');
}

function walk(dir: string, out: string[] = []): string[] {
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

interface EntryPoint {
  /** Exported identifier name */
  name: string;
  /** The file that DEFINES (exports) this function — excluded from offenders. */
  definitionSite: string;
  /** The ONE IPC file allowed to call this function. */
  allowedCaller: string;
}

const ENTRY_POINTS: EntryPoint[] = [
  {
    name: 'sendApprovedEmail',
    definitionSite: abs('src/main/integrations/send.ts'),
    allowedCaller: abs('src/main/ipc/gmail-send.ts'),
  },
  {
    name: 'applyCalendarChange',
    definitionSite: abs('src/main/integrations/write-event.ts'),
    allowedCaller: abs('src/main/ipc/approvals.ts'),
  },
  {
    name: 'pushApprovedMeetingActions',
    definitionSite: abs('src/main/integrations/todoist/push-actions.ts'),
    allowedCaller: abs('src/main/ipc/todoist.ts'),
  },
];

describe('D-08/D-09 chokepoint caller allow-list (Ratchet B)', () => {
  for (const ep of ENTRY_POINTS) {
    const { name, definitionSite, allowedCaller } = ep;

    it(`${name}: only the allowed IPC caller may import or call this entry point`, () => {
      const ALLOWED = new Set([allowedCaller]);
      const files = walk(ROOT);
      const offenders: string[] = [];

      for (const f of files) {
        const norm = f.replace(/\\/g, '/');
        // Exclude definition site (a function declaring itself is not a caller).
        if (norm === definitionSite) continue;
        // Exclude test/spec files — they are not production callers.
        if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)) continue;
        // Already in the allow-list — skip.
        if (ALLOWED.has(norm)) continue;

        const src = stripComments(fs.readFileSync(f, 'utf8'));
        // Match the bare identifier as an import or call site.
        // This catches: import { X } from ...; X(...); X.something; etc.
        const RE = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?:[^A-Za-z0-9_$]|$)`);
        if (RE.test(src)) {
          offenders.push(norm);
        }
      }

      expect(
        offenders,
        `'${name}' referenced outside its allowed caller (${allowedCaller}):\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    });

    it(`${name}: positive assertion — allowed caller file DOES reference the entry point`, () => {
      const src = stripComments(fs.readFileSync(allowedCaller, 'utf8'));
      const RE = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?:[^A-Za-z0-9_$]|$)`);
      expect(
        RE.test(src),
        `GUARD: regex for '${name}' matched NOTHING in its allowed caller (${allowedCaller}) — regex is silently broken`,
      ).toBe(true);
    });
  }
});
