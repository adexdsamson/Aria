/**
 * Phase 12 / Plan 12-02 Task 3 — Static-grep ratchet: sealed-DB seal-guard.
 *
 * For each of the 8 cron callsites that touch DB-backed work, asserts the
 * cron callback body carries the seal-guard prelude:
 *
 *   const db = ... dbHolder ... .db ...
 *   ... pendingCatchup.add('<expected-channel>') ...
 *
 * The check is textual (file-level grep) rather than AST-walking the
 * specific callback — keeps the spec deliberately blunt so adding a new
 * cron in one of these files forces the author to also wire the guard.
 *
 * If you split a callsite file into multiple files, update CALLSITES.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

const CALLSITES: Array<{ file: string; channel: string }> = [
  { file: 'src/main/briefing/schedule.ts', channel: 'briefing' },
  { file: 'src/main/insights/schedule.ts', channel: 'insights' },
  { file: 'src/main/recap/schedule.ts', channel: 'recap' },
  { file: 'src/main/learning/schedule.ts', channel: 'learning' },
  { file: 'src/main/entitlement/schedule.ts', channel: 'entitlement' },
  { file: 'src/main/ipc/gmail.ts', channel: 'gmail-sync' },
  { file: 'src/main/ipc/calendar.ts', channel: 'calendar-sync' },
  { file: 'src/main/folder-ingestion/sweep-cron.ts', channel: 'knowledge-folder-sweep' },
];

describe('cron-seal-guard ratchet', () => {
  for (const { file, channel } of CALLSITES) {
    it(`${file} carries the seal-guard prelude with channel '${channel}'`, () => {
      const abs = path.join(ROOT, file);
      const src = fs.readFileSync(abs, 'utf8');
      // (a) reads dbHolder.db inside the cron body (we look for the shape
      //     `dbHolder.db` or `deps.dbHolder?.db`)
      expect(
        /dbHolder(\?)?\.db|deps\.dbHolder\?\.db/.test(src),
        `${file} does not read dbHolder.db — missing seal-guard prelude`,
      ).toBe(true);
      // (b) registers the expected channel for catchup
      expect(
        src.includes(`pendingCatchup.add('${channel}')`),
        `${file} does not call pendingCatchup.add('${channel}')`,
      ).toBe(true);
      // (c) signals the tray badge
      expect(
        src.includes('trayBus.setBadge()'),
        `${file} does not call trayBus.setBadge() in the seal-guard branch`,
      ).toBe(true);
    });
  }
});
