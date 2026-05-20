import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../db/connect';
import { runMigrations } from '../../db/migrations/runner';
import { createTempUserDataDir } from '../../../../tests/setup';
import { appendTurnFeedback } from './qa';
import { createThread, appendTurn } from '../../rag/threads';
import { listSignals } from '../signal-log';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-qa-src');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('qa source', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('Test 3 — appendTurnFeedback updates rag_turn.thumb AND emits signal', () => {
    const t = createThread(db, { title: 'test' });
    const turn = appendTurn(db, { threadId: t.id, role: 'assistant', text: 'hello' });
    const res = appendTurnFeedback(db, { turnId: turn.id, thumb: 1, route: 'LOCAL', sensitivity: 'low' });
    expect(res.ok).toBe(true);
    const row = db.prepare(`SELECT thumb FROM rag_turn WHERE id = ?`).get(turn.id) as { thumb: number };
    expect(row.thumb).toBe(1);
    const signals = listSignals(db, { source: 'qa' });
    expect(signals.length).toBe(1);
    expect(signals[0]!.kind).toBe('qa.thumb');
    expect((signals[0]!.payload as { thumb: number }).thumb).toBe(1);
    closeDb(db);
  });

  it('ok=false when turnId not found; no signal written', () => {
    const res = appendTurnFeedback(db, { turnId: 'missing', thumb: -1 });
    expect(res.ok).toBe(false);
    const signals = listSignals(db, { source: 'qa' });
    expect(signals.length).toBe(0);
    closeDb(db);
  });
});
