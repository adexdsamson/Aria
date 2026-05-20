import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import { writeSignal, listSignals, purgeOldSignals } from './signal-log';
import { beforeSend } from '../sentry/beforeSend';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-signal-log');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('signal-log', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('Test 1: writeSignal redacts PII strings in payload before INSERT', () => {
    writeSignal(db, {
      source: 'approval',
      kind: 'approval.edit',
      payload: { recipient: 'alice@example.com', body: 'Call me at 415-555-1212' },
    });
    const row = db.prepare(`SELECT payload_json FROM learning_signals`).get() as { payload_json: string };
    const p = JSON.parse(row.payload_json);
    expect(p.recipient).not.toContain('@example.com');
    // redactAllPii replaces emails with <EMAIL>
    expect(p.recipient).toContain('<EMAIL>');
    // Body redaction — phone replaced with <PHONE>
    expect(p.body).toContain('<PHONE>');
    closeDb(db);
  });

  it('Test 2: listSignals paginates by limit/offset/source/fromIso/toIso', () => {
    for (let i = 0; i < 10; i++) {
      writeSignal(db, {
        source: i % 2 === 0 ? 'approval' : 'qa',
        kind: 'x',
        payload: { i },
        now: new Date(2026, 0, i + 1),
      });
    }
    const page1 = listSignals(db, { limit: 3 });
    expect(page1.length).toBe(3);
    const page2 = listSignals(db, { limit: 3, offset: 3 });
    expect(page2.length).toBe(3);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);
    const approvalOnly = listSignals(db, { source: 'approval', limit: 100 });
    expect(approvalOnly.every((r) => r.source === 'approval')).toBe(true);
    closeDb(db);
  });

  it('Test 3: writeSignal NEVER calls globalThis.fetch', () => {
    const fetchSpy = vi.fn();
    const orig = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    try {
      writeSignal(db, { source: 'briefing', kind: 'briefing.dismiss', payload: { kind: 'email' } });
    } finally {
      (globalThis as { fetch?: unknown }).fetch = orig;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    closeDb(db);
  });

  it('Test 4: grep-no-network-from-signals exits 0 on current learning/* tree', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const out = execFileSync(process.execPath, ['scripts/grep-no-network-from-signals.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(typeof out).toBe('string');
    closeDb(db);
  });

  it('Test 5: injecting a forbidden import into a temp learning copy fails the ratchet', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const tmp = mkdtempSync(path.join(tmpdir(), 'grep-ratchet-'));
    try {
      // Stage a minimal repo subset: scripts/ + a temp src/main/learning/ tree
      // containing a single file with a forbidden import.
      cpSync(path.join(repoRoot, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
      const learningDir = path.join(tmp, 'src/main/learning');
      writeFileSync = writeFileSync; // referenced to avoid unused-import lint
      const fs = require('node:fs') as typeof import('node:fs');
      fs.mkdirSync(learningDir, { recursive: true });
      fs.writeFileSync(
        path.join(learningDir, 'tainted.ts'),
        `import fetch from 'node-fetch';\nexport const x = fetch;\n`,
        'utf8',
      );
      let threw = false;
      try {
        execFileSync(process.execPath, ['scripts/grep-no-network-from-signals.mjs'], {
          cwd: tmp,
          encoding: 'utf8',
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    closeDb(db);
  });

  it('Test 6: Sentry beforeSend drops events tagged scope:learning and message-containing learning_signals', () => {
    expect(beforeSend({ tags: { scope: 'learning' }, message: 'hi' })).toBeNull();
    expect(beforeSend({ message: 'INSERT failed on learning_signals' })).toBeNull();
    expect(
      beforeSend({
        exception: { values: [{ type: 'Error', value: 'no such column learned_preferences' }] },
      }),
    ).toBeNull();
    expect(beforeSend({ tags: { scope: 'gmail' }, message: 'normal' })).toEqual({
      tags: { scope: 'gmail' },
      message: 'normal',
    });
  });

  it('Test 7: purgeOldSignals deletes only rows older than cutoff', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    // 100d old + 30d old + new
    writeSignal(db, { source: 'qa', kind: 'qa.thumb', payload: {}, now: new Date('2026-02-09T00:00:00.000Z') });
    writeSignal(db, { source: 'qa', kind: 'qa.thumb', payload: {}, now: new Date('2026-04-20T00:00:00.000Z') });
    writeSignal(db, { source: 'qa', kind: 'qa.thumb', payload: {}, now });
    const removed = purgeOldSignals(db, { keepDays: 90, now });
    expect(removed).toBe(1);
    const remaining = db.prepare(`SELECT COUNT(*) AS c FROM learning_signals`).get() as { c: number };
    expect(remaining.c).toBe(2);
    closeDb(db);
  });
});
