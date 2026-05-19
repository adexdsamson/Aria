import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { bm25Search, buildFtsMatchExpr } from '../../../../src/main/rag/bm25-search';
import {
  hybridRetrieve,
  rrfFuse,
  type EmbedClient,
} from '../../../../src/main/rag/hybrid-retrieval';
import type { VectorStore, Hit } from '../../../../src/main/rag/vector-store';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-hr');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function insertChunk(
  db: ReturnType<typeof setupDb>,
  id: string,
  text: string,
  opts: {
    providerKey?: string;
    accountId?: string;
    sourceKind?: string;
    deletedAt?: string | null;
    sensitivity?: string | null;
    title?: string;
  } = {},
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rag_chunk (id, source_kind, source_id, provider_key, account_id, title, text,
                            char_start, char_end, token_count, sensitivity, sensitivity_model,
                            deleted_at, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    opts.sourceKind ?? 'email',
    `src-${id}`,
    opts.providerKey ?? null,
    opts.accountId ?? null,
    opts.title ?? `Title ${id}`,
    text,
    text.length,
    Math.max(1, Math.round(text.length / 4)),
    opts.sensitivity ?? 'none',
    'router-v1',
    opts.deletedAt ?? null,
    now,
    now,
  );
}

class FakeVectorStore implements VectorStore {
  constructor(private readonly results: Hit[] = []) {}
  upsert(): void {}
  query(): Hit[] {
    return this.results;
  }
  deleteByChunkId(): void {}
  deleteByModelId(): void {}
  backendName(): 'sqlite-vec' | 'fallback' {
    return 'fallback';
  }
}

const fakeEmbed: EmbedClient = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(768));
  },
};

describe('rrfFuse — RESEARCH §6', () => {
  it('fuses 3 ranked lists with known scores', () => {
    const out = rrfFuse(
      [
        ['a', 'b', 'c'],
        ['b', 'a', 'd'],
        ['c', 'a', 'b'],
      ],
      { k: 60 },
    );
    // a appears at ranks 0,1,1 → 1/61 + 1/62 + 1/62
    const a = 1 / 61 + 1 / 62 + 1 / 62;
    const b = 1 / 62 + 1 / 61 + 1 / 63;
    const c = 1 / 63 + 1 / 61;
    expect(out.get('a')).toBeCloseTo(a, 10);
    expect(out.get('b')).toBeCloseTo(b, 10);
    expect(out.get('c')).toBeCloseTo(c, 10);
    // a > b > c
    const sorted = Array.from(out.entries()).sort((x, y) => y[1] - x[1]);
    expect(sorted[0]![0]).toBe('a');
    expect(sorted[1]![0]).toBe('b');
  });
  it('handles missing-from-list IDs gracefully', () => {
    const out = rrfFuse([['x'], ['y']]);
    expect(out.size).toBe(2);
  });
});

describe('buildFtsMatchExpr', () => {
  it('escapes operators and quotes tokens', () => {
    expect(buildFtsMatchExpr('what did Sarah commit to about AND or NOT'))
      .toBe('"what" "did" "sarah" "commit" "to" "about"');
  });
  it('returns empty placeholder for empty input', () => {
    expect(buildFtsMatchExpr('')).toBe('""');
  });
});

describe('bm25Search — porter stem + soft-delete + account filter', () => {
  let db: ReturnType<typeof setupDb>;
  beforeEach(() => {
    db = setupDb();
  });

  it('porter stem finds "commits" when querying "committed"', () => {
    insertChunk(db, 'c1', 'Sarah commits to the Q3 plan today');
    insertChunk(db, 'c2', 'Unrelated text about other topics');
    const hits = bm25Search(db, 'committed');
    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain('c1');
  });

  it('excludes soft-deleted chunks', () => {
    insertChunk(db, 'alive', 'Quarterly forecast meeting');
    insertChunk(db, 'gone', 'Quarterly forecast meeting', { deletedAt: new Date().toISOString() });
    const hits = bm25Search(db, 'quarterly forecast');
    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain('alive');
    expect(ids).not.toContain('gone');
  });

  it('respects account filter', () => {
    insertChunk(db, 'g1', 'shared content', { providerKey: 'google', accountId: 'a@x' });
    insertChunk(db, 'm1', 'shared content', { providerKey: 'microsoft', accountId: 'b@x' });
    const hits = bm25Search(db, 'shared content', {
      accountFilter: [{ providerKey: 'google', accountId: 'a@x' }],
    });
    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain('g1');
    expect(ids).not.toContain('m1');
  });
});

describe('hybridRetrieve — fusion + hydration', () => {
  let db: ReturnType<typeof setupDb>;
  beforeEach(() => {
    db = setupDb();
  });

  it('hydrates top-K with denormalized title + cached sensitivity', async () => {
    insertChunk(db, 'h1', 'budget plan for Q3', { title: 'Q3 budget', sensitivity: 'financial:med' });
    insertChunk(db, 'h2', 'random other content', { sensitivity: 'none' });
    const vectorStore = new FakeVectorStore([{ chunkId: 'h1', score: 0.9 }]);
    const res = await hybridRetrieve(
      { db, embedClient: fakeEmbed, vectorStore },
      'budget',
      { topK: 5 },
    );
    expect(res.length).toBeGreaterThan(0);
    const top = res[0]!;
    expect(top.title).toBe('Q3 budget');
    expect(top.sensitivity).toBe('financial:med');
    expect(top.id).toBe('h1');
  });

  it('excludes soft-deleted chunks even if vector returns them', async () => {
    insertChunk(db, 'ghost', 'phantom text', { deletedAt: new Date().toISOString() });
    const vectorStore = new FakeVectorStore([{ chunkId: 'ghost', score: 1.0 }]);
    const res = await hybridRetrieve(
      { db, embedClient: fakeEmbed, vectorStore },
      'phantom',
    );
    expect(res.find((c) => c.id === 'ghost')).toBeUndefined();
  });

  it('rrf k is configurable via app_meta', async () => {
    db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.prepare(`INSERT INTO app_meta (key, value) VALUES ('rag_rrf_k', '10')`).run();
    insertChunk(db, 'k1', 'tunable parameter');
    const vectorStore = new FakeVectorStore([]);
    const res = await hybridRetrieve(
      { db, embedClient: fakeEmbed, vectorStore },
      'tunable',
    );
    // With k=10 the lone BM25 hit at rank 0 scores 1/11 ≈ 0.0909.
    expect(res.length).toBe(1);
    expect(res[0]!.rrfScore).toBeCloseTo(1 / 11, 6);
  });
});
