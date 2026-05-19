import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

/**
 * Plan 07-01 Task 1: migration 126 RAG schema.
 *
 * Pre/post snapshots assert:
 *  - DB advances from user_version=125 to user_version=126
 *  - All new tables/indexes/triggers exist
 *  - C7 columns are present on rag_chunk, rag_embedding, rag_turn
 *  - rag_index_state seeded with the canonical embedding model
 *  - RagCitation hydration row (C12) reads all needed fields w/ non-null title
 */
describe('migration 126 rag index', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-db-mig-126');
    dbKey = crypto.randomBytes(32);
  });

  it('pre-migration snapshot: lands on user_version=125 with canonical source tables', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    // Apply through 125 only (the runner naturally advances to highest).
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const version = db.pragma('user_version', { simple: true }) as number;
    // Once 126 lands the migrations dir advances DB to 126. Use this test purely
    // to confirm canonical source tables exist for the harvester contract.
    expect(version).toBeGreaterThanOrEqual(125);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('gmail_message');
    expect(tables).toContain('calendar_event');
    expect(tables).toContain('meeting_note');
    expect(tables).toContain('meeting_note_segment');
    expect(tables).toContain('meeting_action');
    closeDb(db);
  });

  it('applies 126: schema, indexes, triggers, FTS, seed row, C7 columns', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    // Migration 127 (Phase 7 UAT Gap 8) rebuilds rag_source_dirty for dedupe.
    // The runner advances to the latest migration; assert ≥126 to remain
    // forward-compatible with later schema bumps.
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(126);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      'rag_chunk',
      'rag_embedding',
      'rag_index_state',
      'rag_source_dirty',
      'rag_thread',
      'rag_turn',
      'person',
      'person_alias',
    ]) {
      expect(tables).toContain(t);
    }

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const i of [
      'idx_rag_chunk_source',
      'idx_rag_chunk_dirty',
      'idx_rag_chunk_account',
      'idx_rag_chunk_alive',
      'idx_rag_embedding_model',
      'idx_rag_source_dirty_enq',
      'idx_rag_thread_updated',
      'idx_rag_turn_thread_ord',
      'idx_person_alias_alias',
    ]) {
      expect(indexes).toContain(i);
    }

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(triggers).toContain('rag_chunk_ai');
    expect(triggers).toContain('rag_chunk_ad');
    expect(triggers).toContain('rag_chunk_au');

    // FTS5 virtual table queryable
    const ftsCount = db
      .prepare("SELECT count(*) AS n FROM rag_chunk_fts")
      .get() as { n: number };
    expect(ftsCount.n).toBe(0);

    // Seed row
    const state = db
      .prepare(
        "SELECT active_model_id, active_model_dim, vector_backend FROM rag_index_state WHERE id=1",
      )
      .get() as { active_model_id: string; active_model_dim: number; vector_backend: string };
    expect(state.active_model_id).toBe('nomic-embed-text:v1.5');
    expect(state.active_model_dim).toBe(768);
    expect(state.vector_backend).toBe('sqlite-vec');

    // C7 column presence on rag_chunk
    const chunkCols = (db.pragma('table_info(rag_chunk)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    for (const c of [
      'title',
      'lang',
      'sensitivity',
      'sensitivity_model',
      'sensitivity_at',
      'source_updated_at',
      'deleted_at',
    ]) {
      expect(chunkCols).toContain(c);
    }

    const embedCols = (db.pragma('table_info(rag_embedding)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(embedCols).toContain('embedding_norm');

    const turnCols = (db.pragma('table_info(rag_turn)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    for (const c of ['embedding_model_id', 'retrieval_strategy', 'total_cost_usd']) {
      expect(turnCols).toContain(c);
    }

    closeDb(db);
  });

  it('C12: RagCitation hydration reads all needed fields with non-null title', () => {
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rag_chunk (
        id, source_kind, source_id, title, text, char_start, char_end,
        token_count, dirty, created_at, updated_at
      ) VALUES (
        'email:test:1:chunk:0', 'email', 'test-msg-1',
        'Q3 budget revision', 'sample chunk text', 0, 17, 4, 1, ?, ?
      )`,
    ).run(now, now);

    const row = db
      .prepare(
        `SELECT id, source_kind, source_id, title, char_start, char_end
         FROM rag_chunk WHERE id = 'email:test:1:chunk:0'`,
      )
      .get() as Record<string, unknown>;
    expect(row.id).toBe('email:test:1:chunk:0');
    expect(row.source_kind).toBe('email');
    expect(row.source_id).toBe('test-msg-1');
    expect(row.title).toBe('Q3 budget revision');
    expect(row.title).not.toBeNull();
    expect(row.char_start).toBe(0);
    expect(row.char_end).toBe(17);

    // FTS row populated by trigger
    const fts = db
      .prepare("SELECT count(*) AS n FROM rag_chunk_fts WHERE rag_chunk_fts MATCH 'sample'")
      .get() as { n: number };
    expect(fts.n).toBe(1);

    closeDb(db);
  });
});
