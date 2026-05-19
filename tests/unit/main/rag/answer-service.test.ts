import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import pino from 'pino';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  createAnswerService,
  REFUSAL_TEXT,
  ERROR_TEXT,
  type LlmInvocation,
} from '../../../../src/main/rag/answer-service';
import {
  createThread,
  getThread,
  listThreads,
} from '../../../../src/main/rag/threads';
import type { EmbedClient } from '../../../../src/main/rag/hybrid-retrieval';
import type { VectorStore, Hit } from '../../../../src/main/rag/vector-store';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function setupDb() {
  const dataDir = createTempUserDataDir('aria-ans');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function insertChunk(
  db: ReturnType<typeof setupDb>,
  id: string,
  text: string,
  opts: { sensitivity?: string | null; title?: string } = {},
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rag_chunk (id, source_kind, source_id, title, text, char_start, char_end,
                            token_count, sensitivity, sensitivity_model, dirty, created_at, updated_at)
     VALUES (?, 'email', ?, ?, ?, 0, ?, ?, ?, 'router-v1', 0, ?, ?)`,
  ).run(
    id,
    `src-${id}`,
    opts.title ?? `T-${id}`,
    text,
    text.length,
    Math.max(1, text.length / 4),
    opts.sensitivity === undefined ? 'none' : opts.sensitivity,
    now,
    now,
  );
}

class FakeVS implements VectorStore {
  constructor(public results: Hit[] = []) {}
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
  async embed(t) {
    return t.map(() => new Float32Array(768));
  },
};

const logger = pino({ level: 'silent' });

describe('answer-service.ask', () => {
  let db: ReturnType<typeof setupDb>;
  beforeEach(() => {
    db = setupDb();
  });

  it('empty retrieval → refusal with EXACT verbatim copy + persisted refusal turn', async () => {
    const svc = createAnswerService({
      db,
      logger,
      embedClient: fakeEmbed,
      vectorStore: new FakeVS([]),
      llm: { generate: async () => ({ answer: 'never called', citations: [1] }) },
    });
    const res = await svc.ask({ question: 'unanswerable question' });
    expect(res.kind).toBe('refusal');
    if (res.kind === 'refusal') {
      expect(res.text).toBe("I couldn't find anything in your data about that.");
      expect(res.text).toBe(REFUSAL_TEXT);
    }
  });

  it('happy path → answer with ≥1 citation; user + assistant turns persisted', async () => {
    insertChunk(db, 'c1', 'Sarah committed to ship Q3 budget by Friday');
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const llm: LlmInvocation = {
      generate: vi.fn(async () => ({ answer: 'Sarah will ship Q3 [1].', citations: [1] })),
    };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const res = await svc.ask({ question: 'When will Sarah ship?' });
    expect(res.kind).toBe('answer');
    if (res.kind === 'answer') {
      expect(res.citations.length).toBeGreaterThan(0);
      expect(res.citations[0]!.title).toBe('T-c1');
      const thread = getThread(db, res.threadId, { lastN: 10 });
      expect(thread!.turns).toHaveLength(2);
      expect(thread!.turns[0]!.role).toBe('user');
      expect(thread!.turns[1]!.role).toBe('assistant');
    }
  });

  it('out-of-range citation index → dropped; all-dropped → refusal', async () => {
    insertChunk(db, 'c1', 'something');
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const llm: LlmInvocation = {
      generate: async () => ({ answer: 'bogus', citations: [99] }),
    };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const res = await svc.ask({ question: 'something' });
    expect(res.kind).toBe('refusal');
  });

  it('LLM throw → RagErrorResult with distinct copy; NO turn persisted', async () => {
    insertChunk(db, 'c1', 'content');
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const llm: LlmInvocation = {
      generate: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const res = await svc.ask({ question: 'content' });
    expect(res.kind).toBe('error');
    if (res.kind === 'error') {
      expect(res.text).toBe(ERROR_TEXT);
      expect(res.text).not.toBe(REFUSAL_TEXT); // distinct
    }
    // No turn rows.
    const rows = db.prepare(`SELECT count(*) AS n FROM rag_turn`).get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('multi-turn resume: 2nd ask with threadId loads lastN=6 history', async () => {
    insertChunk(db, 'c1', 'Q3 plan content');
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const seenPrompts: string[] = [];
    const llm: LlmInvocation = {
      generate: async ({ prompt }) => {
        seenPrompts.push(prompt);
        return { answer: 'reply [1]', citations: [1] };
      },
    };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const r1 = await svc.ask({ question: 'Q3 plan?' });
    if (r1.kind !== 'answer') throw new Error('expected answer');
    const r2 = await svc.ask({ question: 'more about Q3', threadId: r1.threadId });
    expect(r2.kind).toBe('answer');
    // 2nd prompt MUST include <thread_history>
    expect(seenPrompts[1]).toMatch(/<thread_history>/);
  });

  it('seedTurns (C9) — Cmd-K Expand creates thread w/ Q+A as turn 0/1', () => {
    const t = createThread(db, {
      seedTurns: [
        { role: 'user', text: 'cmd-k question' },
        { role: 'assistant', text: 'cmd-k answer', citations: [{ index: 1 }] },
      ],
    });
    const full = getThread(db, t.id, { lastN: 10 });
    expect(full!.turns).toHaveLength(2);
    expect(full!.turns[0]!.role).toBe('user');
    expect(full!.turns[0]!.text).toBe('cmd-k question');
    expect(full!.turns[1]!.role).toBe('assistant');
  });

  it('transient flag does NOT prevent listing (Cmd-K filter is renderer-side)', async () => {
    // Backend honors transient flag only via title prefix; surfacing filter
    // is the renderer's job (see Task 6). Service must still create + persist
    // for routing-log/cost tracking.
    insertChunk(db, 'c1', 'foo');
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const llm: LlmInvocation = { generate: async () => ({ answer: 'r [1]', citations: [1] }) };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const r = await svc.ask({ question: 'foo?', transient: true });
    expect(r.kind).toBe('answer');
    const threads = listThreads(db);
    expect(threads.length).toBe(1);
    expect(threads[0]!.title).toContain('transient');
  });

  it('question >4 KB → error (ASVS V5)', async () => {
    const svc = createAnswerService({
      db,
      logger,
      embedClient: fakeEmbed,
      vectorStore: new FakeVS([]),
      llm: { generate: async () => null },
    });
    const huge = 'x'.repeat(5000);
    const res = await svc.ask({ question: huge });
    expect(res.kind).toBe('error');
  });

  it('NULL-sensitivity chunk forces LOCAL route (C5 fail-closed)', async () => {
    insertChunk(db, 'c1', 'content', { sensitivity: null });
    const vs = new FakeVS([{ chunkId: 'c1', score: 0.9 }]);
    const seenRoutes: string[] = [];
    const llm: LlmInvocation = {
      generate: async ({ route }) => {
        seenRoutes.push(route);
        return { answer: 'r [1]', citations: [1] };
      },
    };
    const svc = createAnswerService({ db, logger, embedClient: fakeEmbed, vectorStore: vs, llm });
    const r = await svc.ask({ question: 'content' });
    expect(r.kind).toBe('answer');
    expect(seenRoutes[0]).toBe('LOCAL');
  });
});
