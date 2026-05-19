import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  classifyChunksBulk,
  classifyChunkSensitivity,
  type SensitivityClass,
} from '../../../../src/main/rag/sensitivity-cache';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-sens');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function insertChunk(
  db: ReturnType<typeof setupDb>,
  id: string,
  opts: { sensitivity?: SensitivityClass; sensitivity_model?: string } = {},
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rag_chunk (id, source_kind, source_id, text, char_start, char_end, token_count, sensitivity, sensitivity_model, sensitivity_at, created_at, updated_at)
     VALUES (?, 'email', ?, 'body', 0, 4, 1, ?, ?, ?, ?, ?)`,
  ).run(id, `src-${id}`, opts.sensitivity ?? null, opts.sensitivity_model ?? null, opts.sensitivity ? now : null, now, now);
}

describe('sensitivity-cache — REVIEWS C5', () => {
  let db: ReturnType<typeof setupDb>;

  beforeEach(() => {
    db = setupDb();
  });

  it('cache hit: ZERO classifier calls when modelId unchanged', async () => {
    for (let i = 0; i < 10; i++) {
      insertChunk(db, `c${i}`, { sensitivity: 'none', sensitivity_model: 'router-v1' });
    }
    const classify = vi.fn(async (_t: string) => 'none' as SensitivityClass);
    const chunks = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: 'x' }));
    const out = await classifyChunksBulk(db, chunks, 'router-v1', classify);
    expect(classify).toHaveBeenCalledTimes(0);
    expect(out.size).toBe(10);
    expect(out.get('c0')).toBe('none');
  });

  it('model-id mismatch invalidates cache: classifier called for every chunk', async () => {
    for (let i = 0; i < 10; i++) {
      insertChunk(db, `c${i}`, { sensitivity: 'none', sensitivity_model: 'router-v1' });
    }
    const classify = vi.fn(async (_t: string) => 'pii:low' as SensitivityClass);
    const chunks = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: 'x' }));
    await classifyChunksBulk(db, chunks, 'router-v2', classify);
    expect(classify).toHaveBeenCalledTimes(10);
    const updated = db
      .prepare(`SELECT sensitivity, sensitivity_model FROM rag_chunk WHERE id = 'c3'`)
      .get() as { sensitivity: string; sensitivity_model: string };
    expect(updated.sensitivity).toBe('pii:low');
    expect(updated.sensitivity_model).toBe('router-v2');
  });

  it('classifier failure leaves sensitivity NULL (fail-closed)', async () => {
    insertChunk(db, 'c1');
    const classify = vi.fn(async () => {
      throw new Error('ollama-down');
    });
    const out = await classifyChunkSensitivity(db, { id: 'c1', text: 'x' }, 'router-v1', classify);
    expect(out).toBeNull();
    const row = db
      .prepare(`SELECT sensitivity FROM rag_chunk WHERE id = 'c1'`)
      .get() as { sensitivity: string | null };
    expect(row.sensitivity).toBeNull();
  });

  it('single-chunk cache hit returns without calling classify', async () => {
    insertChunk(db, 'c1', { sensitivity: 'hr:med', sensitivity_model: 'router-v1' });
    const classify = vi.fn(async () => 'none' as SensitivityClass);
    const out = await classifyChunkSensitivity(db, { id: 'c1', text: 'x' }, 'router-v1', classify);
    expect(out).toBe('hr:med');
    expect(classify).toHaveBeenCalledTimes(0);
  });
});
