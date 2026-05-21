/**
 * Phase 11 — ResearchService unit tests.
 *
 * Tests createResearchJob, runResearchJob, and detectResearchTopics.
 * Uses in-memory SQLite (same pattern as existing service tests).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { Database } from 'better-sqlite3-multiple-ciphers';
import {
  createResearchJob,
  runResearchJob,
  detectResearchTopics,
} from '../../../src/main/services/ResearchService';

// ---------------------------------------------------------------------------
// DB setup — minimal schema for research tables
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new BetterSqlite3(':memory:') as Database;
  db.exec(`
    CREATE TABLE research_job (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goals TEXT NOT NULL DEFAULT '',
      domains_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','done','failed')),
      schedule_interval TEXT NOT NULL DEFAULT 'none',
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE research_report (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','done','failed')),
      trigger TEXT NOT NULL DEFAULT 'manual',
      summary TEXT,
      confidence_score INTEGER,
      error_message TEXT,
      generated_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES research_job(id)
    );
    CREATE TABLE research_report_section (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      section_type TEXT NOT NULL,
      ordinal INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES research_report(id)
    );
    CREATE TABLE meeting_note (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'captured'
    );
  `);
  return db;
}

let db: Database;
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

beforeEach(() => {
  db = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  (db as unknown as { close: () => void }).close();
});

// ---------------------------------------------------------------------------
// createResearchJob
// ---------------------------------------------------------------------------

describe('createResearchJob', () => {
  it('inserts a draft research_job row and returns its id', () => {
    const { id } = createResearchJob(db, {
      title: 'AI trends in logistics',
      goals: 'Understand adoption patterns',
      domains: ['logistics', 'AI'],
    });
    expect(id).toBeTruthy();
    const row = db.prepare('SELECT * FROM research_job WHERE id = ?').get(id) as {
      status: string;
      title: string;
      domains_json: string;
    };
    expect(row).toBeTruthy();
    expect(row.status).toBe('draft');
    expect(row.title).toBe('AI trends in logistics');
    expect(JSON.parse(row.domains_json)).toEqual(['logistics', 'AI']);
  });

  it('throws when title is empty', () => {
    expect(() => createResearchJob(db, { title: '' })).toThrow(
      'Research job title must be non-empty',
    );
  });

  it('throws when title is only whitespace', () => {
    expect(() => createResearchJob(db, { title: '   ' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// runResearchJob
// ---------------------------------------------------------------------------

describe('runResearchJob', () => {
  it('sets job.status=running then done, writes report and sections on success', async () => {
    const { id: jobId } = createResearchJob(db, {
      title: 'Quantum computing market',
      goals: 'Market size and players',
    });

    // Mock the search providers and generateObject
    vi.mock('../../../src/main/services/SearchProviderService', () => ({
      searchBrave: vi.fn().mockResolvedValue([
        { url: 'https://q.example.com', title: 'Quantum', description: 'Overview' },
      ]),
      searchExa: vi.fn().mockResolvedValue([]),
      fetchWithJina: vi.fn().mockResolvedValue('# Quantum computing\n\nContent here.'),
      deduplicateByUrl: (results: { url: string }[]) =>
        [...new Map(results.map((r) => [r.url, r])).values()],
    }));

    vi.mock('../../../src/main/secrets/safeStorage', () => ({
      getProviderTokens: vi.fn().mockReturnValue('fake-key'),
      getActiveProvider: vi.fn().mockResolvedValue('anthropic'),
      hasFrontierKey: vi.fn().mockResolvedValue(true),
    }));

    vi.mock('../../../src/main/llm/providers', () => ({
      getFrontierModel: vi.fn().mockResolvedValue({}),
    }));

    vi.mock('ai', async (importOriginal) => {
      const actual = await importOriginal<typeof import('ai')>();
      return {
        ...actual,
        generateObject: vi.fn().mockResolvedValue({
          object: {
            summary: 'The quantum computing market is growing rapidly.',
            findings: [
              {
                heading: 'Market Size',
                body: '$5B by 2030',
                sourceUrls: ['https://q.example.com'],
              },
            ],
            sources: [
              {
                title: 'Quantum Overview',
                url: 'https://q.example.com',
                domain: 'example.com',
                relevance: 'High',
              },
            ],
            metrics: [{ label: 'CAGR', value: '32%' }],
            confidenceScore: 75,
          },
        }),
      };
    });

    const emitToRenderer = vi.fn();
    await runResearchJob(db, jobId, { logger: mockLogger, emitToRenderer });

    const job = db.prepare('SELECT status FROM research_job WHERE id = ?').get(jobId) as {
      status: string;
    };
    expect(job.status).toBe('done');

    const report = db
      .prepare('SELECT * FROM research_report WHERE job_id = ?')
      .get(jobId) as { id: string; status: string; version: number } | undefined;
    expect(report?.status).toBe('done');
    expect(report?.version).toBe(1);

    const sections = db
      .prepare('SELECT section_type FROM research_report_section WHERE report_id = ? ORDER BY ordinal')
      .all(report?.id) as { section_type: string }[];
    expect(sections.length).toBeGreaterThanOrEqual(1);
  });

  it('sets job.status=failed and report.status=failed when synthesis throws', async () => {
    const { id: jobId } = createResearchJob(db, { title: 'Failing job' });

    vi.mock('../../../src/main/secrets/safeStorage', () => ({
      getProviderTokens: vi.fn().mockReturnValue('fake-key'),
      getActiveProvider: vi.fn().mockResolvedValue('anthropic'),
      hasFrontierKey: vi.fn().mockResolvedValue(true),
    }));

    vi.mock('../../../src/main/llm/providers', () => ({
      getFrontierModel: vi.fn().mockResolvedValue({}),
    }));

    vi.mock('ai', async (importOriginal) => {
      const actual = await importOriginal<typeof import('ai')>();
      return {
        ...actual,
        generateObject: vi.fn().mockRejectedValue(new Error('LLM quota exceeded')),
      };
    });

    await runResearchJob(db, jobId, { logger: mockLogger });

    const job = db.prepare('SELECT status FROM research_job WHERE id = ?').get(jobId) as {
      status: string;
    };
    expect(job.status).toBe('failed');

    const report = db
      .prepare('SELECT status, error_message FROM research_report WHERE job_id = ?')
      .get(jobId) as { status: string; error_message: string } | undefined;
    expect(report?.status).toBe('failed');
    expect(report?.error_message).toContain('LLM quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// detectResearchTopics
// ---------------------------------------------------------------------------

describe('detectResearchTopics', () => {
  it('inserts draft research_job rows when LLM extracts topics', async () => {
    db.prepare(
      `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at, status)
       VALUES ('note-1', 'paste', 'Q3 Strategy Meeting', 'We need to research blockchain adoption and AI in fintech.', datetime('now'), 'captured')`,
    ).run();

    vi.mock('../../../src/main/secrets/safeStorage', () => ({
      getActiveProvider: vi.fn().mockResolvedValue('anthropic'),
      hasFrontierKey: vi.fn().mockResolvedValue(true),
    }));

    vi.mock('../../../src/main/llm/providers', () => ({
      getFrontierModel: vi.fn().mockResolvedValue({}),
    }));

    vi.mock('ai', async (importOriginal) => {
      const actual = await importOriginal<typeof import('ai')>();
      return {
        ...actual,
        generateObject: vi.fn().mockResolvedValue({
          object: [
            {
              title: 'Blockchain in Financial Services',
              goals: 'Understand adoption and ROI',
              domains: 'fintech, blockchain',
            },
          ],
        }),
      };
    });

    const emitToRenderer = vi.fn();
    await detectResearchTopics(db, 'note-1', 'Q3 Strategy Meeting', emitToRenderer);

    const drafts = db
      .prepare(`SELECT * FROM research_job WHERE status = 'draft'`)
      .all() as { title: string }[];
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts[0].title).toBe('Blockchain in Financial Services');
  });

  it('returns silently when LLM throws', async () => {
    db.prepare(
      `INSERT INTO meeting_note (id, source_kind, title, normalized_text, ingested_at, status)
       VALUES ('note-2', 'paste', 'Meeting', 'Short meeting.', datetime('now'), 'captured')`,
    ).run();

    vi.mock('../../../src/main/secrets/safeStorage', () => ({
      getActiveProvider: vi.fn().mockResolvedValue('anthropic'),
      hasFrontierKey: vi.fn().mockResolvedValue(true),
    }));

    vi.mock('../../../src/main/llm/providers', () => ({
      getFrontierModel: vi.fn().mockResolvedValue({}),
    }));

    vi.mock('ai', async (importOriginal) => {
      const actual = await importOriginal<typeof import('ai')>();
      return {
        ...actual,
        generateObject: vi.fn().mockRejectedValue(new Error('Model overloaded')),
      };
    });

    // Should not throw
    await expect(
      detectResearchTopics(db, 'note-2', 'Meeting'),
    ).resolves.toBeUndefined();

    const drafts = db.prepare(`SELECT * FROM research_job WHERE status = 'draft'`).all();
    expect(drafts).toHaveLength(0);
  });
});
