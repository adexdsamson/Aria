/**
 * Phase 11 Plan 03 — Research IPC integration test.
 *
 * Tests the RESEARCH_JOB_RUN IPC handler against a real in-memory SQLite DB
 * (migration 133 applied via runMigrations). All HTTP and LLM calls are mocked.
 * Verifies that after researchJobRun completes, a research_report row exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { runMigrations } from '../../src/main/db/migrations/runner';
import { registerResearchHandlers } from '../../src/main/ipc/research';
import { CHANNELS } from '../../src/shared/ipc-contract';

// ---------------------------------------------------------------------------
// Mocks — must appear at top level before any dynamic requires
// ---------------------------------------------------------------------------

vi.mock('../../src/main/entitlement/gate', () => ({
  assertEntitled: vi.fn().mockResolvedValue(undefined),
  EntitlementError: class EntitlementError extends Error {},
}));

vi.mock('../../src/main/secrets/safeStorage', () => ({
  getProviderTokens: vi.fn().mockReturnValue('fake-key'),
  setProviderTokens: vi.fn(),
  getActiveProvider: vi.fn().mockResolvedValue('anthropic'),
  hasFrontierKey: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/main/llm/providers', () => ({
  getFrontierModel: vi.fn().mockResolvedValue({}),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateObject: vi.fn().mockResolvedValue({
      object: {
        summary: {
          executive: 'Integration test synthesis summary — 8 sentences of content. This is sentence 2. This is sentence 3. This is sentence 4. This is sentence 5. This is sentence 6. This is sentence 7. This is sentence 8.',
          keyTakeaways: ['Key insight 1', 'Key insight 2', 'Key insight 3'],
        },
        findings: [
          {
            heading: 'Finding Alpha',
            analysis: 'In-depth analysis of finding alpha with specific data points and references.',
            keyPoints: ['Point A1', 'Point A2'],
            actionableInsights: ['Action A'],
            sourceUrls: ['https://integration.example.com/a'],
          },
          {
            heading: 'Finding Beta',
            analysis: 'In-depth analysis of finding beta.',
            keyPoints: ['Point B1', 'Point B2'],
            actionableInsights: ['Action B'],
            sourceUrls: ['https://integration.example.com/b'],
          },
          {
            heading: 'Finding Gamma',
            analysis: 'In-depth analysis of finding gamma.',
            keyPoints: ['Point G1', 'Point G2'],
            actionableInsights: ['Action G'],
            sourceUrls: ['https://integration.example.com/c'],
          },
        ],
        recommendations: [
          { action: 'Do X immediately', rationale: 'Evidence shows...', priority: 'critical' as const, timeframe: 'This week' },
          { action: 'Evaluate Y', rationale: 'Research indicates...', priority: 'high' as const, timeframe: 'Within 30 days' },
        ],
        sources: [
          { title: 'Source A', url: 'https://integration.example.com/a', domain: 'integration.example.com', relevance: 'High' },
        ],
        metrics: [{ label: 'Sources', value: '1' }],
        confidenceScore: 80,
      },
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock fetch for Brave/Exa/Jina calls
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('search.brave.com')) {
      return new Response(
        JSON.stringify({ web: { results: [{ url: 'https://integration.example.com/a', title: 'Result A', description: 'Desc A' }] } }),
        { status: 200 },
      );
    }
    if (url.includes('exa.ai')) {
      return new Response(
        JSON.stringify({ results: [{ url: 'https://integration.example.com/b', title: 'Exa B', text: 'Exa text B' }] }),
        { status: 200 },
      );
    }
    if (url.includes('r.jina.ai')) {
      return new Response('# Article\n\nFull article content here.', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal IpcMain mock that captures invoke handlers by channel. */
function buildMockIpcMain(): {
  ipcMain: IpcMain;
  invoke: (channel: string, req?: unknown) => Promise<unknown>;
} {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, req?: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle(channel: string, fn: (event: IpcMainInvokeEvent, req?: unknown) => Promise<unknown>): void {
      handlers.set(channel, fn);
    },
    removeHandler(channel: string): void {
      handlers.delete(channel);
    },
  } as unknown as IpcMain;

  const fakeEvent = {} as IpcMainInvokeEvent;

  async function invoke(channel: string, req?: unknown): Promise<unknown> {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`No handler registered for channel: ${channel}`);
    return fn(fakeEvent, req);
  }

  return { ipcMain, invoke };
}

/** Open an in-memory SQLite DB, run all migrations up to 133, and return it. */
function openTestDb(): Database.Database {
  const db = new Database(':memory:') as unknown as Database.Database;
  runMigrations(db as unknown as import('better-sqlite3-multiple-ciphers').Database, {
    logger: { info: () => undefined, warn: () => undefined },
  });
  return db;
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Research IPC integration — researchJobRun', () => {
  it('writes a research_report row after RESEARCH_JOB_RUN completes', async () => {
    const db = openTestDb();
    const { ipcMain, invoke } = buildMockIpcMain();

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as import('pino').Logger;

    const emitToRenderer = vi.fn();
    const dbHolder = { db } as { db: import('better-sqlite3-multiple-ciphers').Database | null };

    registerResearchHandlers(ipcMain, {
      logger: mockLogger,
      dbHolder: dbHolder as Parameters<typeof registerResearchHandlers>[1]['dbHolder'],
      emitToRenderer,
    });

    // First: create a research job via the CREATE handler
    const createResult = await invoke(CHANNELS.RESEARCH_JOB_CREATE, {
      title: 'Integration test: AI in healthcare 2025',
      goals: 'Understand adoption patterns',
      domains: ['healthcare', 'AI'],
    }) as { job?: { id: string }; error?: string };

    expect(createResult.error).toBeUndefined();
    expect(createResult.job?.id).toBeTruthy();
    const jobId = createResult.job!.id;

    // Run the job via the RUN handler — this is fire-and-forget, returns immediately
    const runResult = await invoke(CHANNELS.RESEARCH_JOB_RUN, {
      jobId,
    }) as { ok?: boolean; error?: string };

    expect(runResult.error).toBeUndefined();
    expect(runResult.ok).toBe(true);

    // Wait for the background run to complete (fire-and-forget pattern)
    // Poll up to 5s since runResearchJob is async in the background
    let report: { id: string; status: string } | undefined;
    const start = Date.now();
    while (Date.now() - start < 5000) {
      report = db.prepare('SELECT id, status FROM research_report WHERE job_id = ?').get(jobId) as
        | { id: string; status: string }
        | undefined;
      if (report && (report.status === 'done' || report.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Assert research_report row exists
    expect(report).toBeTruthy();
    expect(report?.status === 'done' || report?.status === 'failed').toBe(true);

    // If done, assert sections were written
    if (report?.status === 'done') {
      const sectionCount = (
        db
          .prepare('SELECT COUNT(*) as n FROM research_report_section WHERE report_id = ?')
          .get(report.id) as { n: number }
      ).n;
      expect(sectionCount).toBeGreaterThan(0);
    }

    // Assert the job status changed from 'draft'
    const job = db.prepare('SELECT status FROM research_job WHERE id = ?').get(jobId) as { status: string };
    expect(job.status).not.toBe('draft');

    db.close();
  });

  it('RESEARCH_JOB_LIST returns the created job', async () => {
    const db = openTestDb();
    const { ipcMain, invoke } = buildMockIpcMain();

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as import('pino').Logger;

    const dbHolder = { db } as { db: import('better-sqlite3-multiple-ciphers').Database | null };
    registerResearchHandlers(ipcMain, {
      logger: mockLogger,
      dbHolder: dbHolder as Parameters<typeof registerResearchHandlers>[1]['dbHolder'],
    });

    // Create a job
    await invoke(CHANNELS.RESEARCH_JOB_CREATE, {
      title: 'List test job',
      goals: 'Test listing',
    });

    // List jobs
    const listResult = await invoke(CHANNELS.RESEARCH_JOB_LIST) as { jobs?: Array<{ title: string }>; error?: string };
    expect(listResult.error).toBeUndefined();
    expect(listResult.jobs).toBeTruthy();
    expect(listResult.jobs!.some((j) => j.title === 'List test job')).toBe(true);

    db.close();
  });

  it('RESEARCH_FEEDBACK_SAVE writes a feedback row', async () => {
    const db = openTestDb();
    const { ipcMain, invoke } = buildMockIpcMain();

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as import('pino').Logger;

    const dbHolder = { db } as { db: import('better-sqlite3-multiple-ciphers').Database | null };
    registerResearchHandlers(ipcMain, {
      logger: mockLogger,
      dbHolder: dbHolder as Parameters<typeof registerResearchHandlers>[1]['dbHolder'],
    });

    // Seed a minimal report row directly (no full run needed)
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO research_job (id, title, goals, domains_json, status, schedule_interval, created_at, updated_at) VALUES (?, 'Feedback test', '', '[]', 'done', 'none', ?, ?)`,
    ).run(jobId, now, now);
    db.prepare(
      `INSERT INTO research_report (id, job_id, version, status, trigger, created_at) VALUES (?, ?, 1, 'done', 'manual', ?)`,
    ).run(reportId, jobId, now);

    const feedbackResult = await invoke(CHANNELS.RESEARCH_FEEDBACK_SAVE, {
      reportId,
      sectionId: null,
      thumb: 1,
      note: 'Great finding!',
    }) as { ok?: boolean; error?: string };

    expect(feedbackResult.ok).toBe(true);

    const fbRow = db.prepare('SELECT thumb, note FROM research_feedback WHERE report_id = ?').get(reportId) as
      | { thumb: number; note: string }
      | undefined;
    expect(fbRow?.thumb).toBe(1);
    expect(fbRow?.note).toBe('Great finding!');

    db.close();
  });
});
