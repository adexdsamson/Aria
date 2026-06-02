/**
 * Phase 11 — ResearchService unit tests.
 *
 * Tests createResearchJob, runResearchJob, detectResearchTopics,
 * and scheduleResearchJob (RES-03).
 *
 * Uses in-memory SQLite (same pattern as existing service tests).
 * All external mocks declared at top level (vitest hoists vi.mock calls).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { Database } from 'better-sqlite3-multiple-ciphers';
import type { ScheduledTask } from 'node-cron';
import {
  createResearchJob,
  runResearchJob,
  detectResearchTopics,
  scheduleResearchJob,
} from '../../../src/main/services/ResearchService';

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by vitest — per-test behavior set via mockImplementation)
// ---------------------------------------------------------------------------

vi.mock('../../../src/main/services/SearchProviderService', () => ({
  searchBrave: vi.fn(),
  searchExa: vi.fn(),
  fetchWithJina: vi.fn(),
  deduplicateByUrl: (results: { url: string }[]) =>
    [...new Map(results.map((r) => [r.url, r])).values()],
}));

vi.mock('../../../src/main/secrets/safeStorage', () => ({
  getProviderTokens: vi.fn(),
  setProviderTokens: vi.fn(),
  getActiveProvider: vi.fn(),
  hasFrontierKey: vi.fn(),
}));

vi.mock('../../../src/main/llm/providers', () => ({
  getFrontierModel: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import mocked modules after vi.mock declarations
// ---------------------------------------------------------------------------

import { searchBrave, searchExa, fetchWithJina } from '../../../src/main/services/SearchProviderService';
import { getProviderTokens, getActiveProvider, hasFrontierKey } from '../../../src/main/secrets/safeStorage';
import { getFrontierModel } from '../../../src/main/llm/providers';
import { generateObject } from 'ai';
import cron from 'node-cron';

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

/** Standard synthesis object matching ResearchSynthesisSchema */
function makeSynthesisObject() {
  return {
    summary: {
      executive: 'Comprehensive executive summary spanning 8 to 12 sentences describing key findings.',
      keyTakeaways: ['Takeaway 1 with specific fact', 'Takeaway 2 with data point', 'Takeaway 3 with named example'],
    },
    findings: [
      {
        heading: 'Market Size',
        analysis: 'In-depth analysis with specific numbers. Market is worth $5B. Companies X, Y, Z lead.',
        keyPoints: ['$5B by 2030', 'CAGR 32%'],
        actionableInsights: ['Invest in sector Q'],
        sourceUrls: ['https://q.example.com'],
      },
      {
        heading: 'Key Players',
        analysis: 'Players analysis with specific companies and percentages.',
        keyPoints: ['Company A has 40% share', 'Company B growing 20% YoY'],
        actionableInsights: ['Partner with Company B'],
        sourceUrls: ['https://q.example.com'],
      },
      {
        heading: 'Technology Trends',
        analysis: 'Technology trends analysis in the quantum computing space.',
        keyPoints: ['Qubit counts doubled in 2024', 'Error rates below 1%'],
        actionableInsights: ['Monitor IBM roadmap'],
        sourceUrls: ['https://q.example.com'],
      },
    ],
    recommendations: [
      { action: 'Evaluate quantum partnerships', rationale: 'Market growing 32% CAGR', priority: 'high' as const, timeframe: 'Q3 2025' },
      { action: 'Monitor IBM timeline', rationale: 'IBM leads in error correction', priority: 'medium' as const, timeframe: 'Quarterly' },
    ],
    sources: [
      { title: 'Quantum Overview', url: 'https://q.example.com', domain: 'example.com', relevance: 'High' },
    ],
    metrics: [{ label: 'CAGR', value: '32%' }],
    confidenceScore: 75,
  };
}

beforeEach(() => {
  db = createTestDb();
  vi.clearAllMocks();

  // Default mock implementations
  vi.mocked(getProviderTokens).mockReturnValue('fake-key');
  vi.mocked(getActiveProvider).mockResolvedValue('anthropic');
  vi.mocked(hasFrontierKey).mockResolvedValue(true);
  vi.mocked(getFrontierModel).mockResolvedValue({} as ReturnType<typeof getFrontierModel> extends Promise<infer T> ? T : never);
  vi.mocked(generateObject).mockResolvedValue({ object: makeSynthesisObject() } as Awaited<ReturnType<typeof generateObject>>);
  vi.mocked(searchBrave).mockResolvedValue([
    { url: 'https://q.example.com', title: 'Quantum', description: 'Overview' },
  ]);
  vi.mocked(searchExa).mockResolvedValue([]);
  vi.mocked(fetchWithJina).mockResolvedValue('# Quantum computing\n\nContent here.');
  vi.mocked(cron.schedule).mockReturnValue({ stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask);
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

    vi.mocked(generateObject).mockRejectedValueOnce(new Error('LLM quota exceeded'));

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

  it('degrades gracefully when one provider returns 429 twice (still produces report from other provider)', async () => {
    const { id: jobId } = createResearchJob(db, {
      title: 'Resilience test job',
      goals: 'Test graceful degradation',
    });

    // Brave returns [] (simulating 429 exhausted), Exa returns results
    vi.mocked(searchBrave).mockResolvedValueOnce([]);
    vi.mocked(searchExa).mockResolvedValueOnce([
      { url: 'https://exa.example.com/result', title: 'Exa result', text: 'Exa content' },
    ]);
    vi.mocked(fetchWithJina).mockResolvedValueOnce('# Exa Result\n\nContent from exa.');

    const emitToRenderer = vi.fn();
    await runResearchJob(db, jobId, { logger: mockLogger, emitToRenderer });

    // Should still produce a done report despite Brave returning nothing
    const job = db.prepare('SELECT status FROM research_job WHERE id = ?').get(jobId) as { status: string };
    expect(job.status).toBe('done');

    const report = db
      .prepare('SELECT status FROM research_report WHERE job_id = ?')
      .get(jobId) as { status: string } | undefined;
    expect(report?.status).toBe('done');
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

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: [
        {
          title: 'Blockchain in Financial Services',
          goals: 'Understand adoption and ROI',
          domains: 'fintech, blockchain',
        },
      ],
    } as Awaited<ReturnType<typeof generateObject>>);

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

    vi.mocked(generateObject).mockRejectedValueOnce(new Error('Model overloaded'));

    // Should not throw
    await expect(
      detectResearchTopics(db, 'note-2', 'Meeting'),
    ).resolves.toBeUndefined();

    const drafts = db.prepare(`SELECT * FROM research_job WHERE status = 'draft'`).all();
    expect(drafts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scheduleResearchJob — RES-03: cron callback fires and inserts version=2 report
// ---------------------------------------------------------------------------

describe('scheduleResearchJob (RES-03)', () => {
  it('fires the cron callback and inserts a version=2 research_report row', async () => {
    // Capture the callback that node-cron.schedule receives
    let capturedCallback: (() => Promise<void>) | null = null;
    vi.mocked(cron.schedule).mockImplementationOnce(
      (_expr: string, fn: () => void | Promise<void>) => {
        capturedCallback = fn as () => Promise<void>;
        return { stop: vi.fn(), start: vi.fn() } as unknown as ScheduledTask;
      },
    );

    const { id: jobId } = createResearchJob(db, {
      title: 'Daily market pulse',
      goals: 'Track market changes',
    });

    const mockScheduler = {
      queue: {} as import('p-queue').default,
      cronRegistry: new Map<string, ScheduledTask>(),
    };

    // First run: seed version=1
    await runResearchJob(db, jobId, { logger: mockLogger });
    const countAfterFirst = (
      db.prepare('SELECT COUNT(*) as n FROM research_report WHERE job_id = ?').get(jobId) as { n: number }
    ).n;
    expect(countAfterFirst).toBe(1);

    // Register schedule — captures the cron callback via mock
    scheduleResearchJob(
      jobId,
      'daily',
      'UTC',
      async () => {
        await runResearchJob(db, jobId, { logger: mockLogger }, { trigger: 'schedule' });
      },
      { scheduler: mockScheduler, logger: mockLogger },
    );

    expect(capturedCallback).not.toBeNull();

    // Fire the cron callback directly (simulates cron trigger after 24h)
    await capturedCallback!();

    // version=2 report should now exist
    const countAfterCron = (
      db.prepare('SELECT COUNT(*) as n FROM research_report WHERE job_id = ?').get(jobId) as { n: number }
    ).n;
    expect(countAfterCron).toBe(2);

    const latestReport = db
      .prepare('SELECT version FROM research_report WHERE job_id = ? ORDER BY version DESC LIMIT 1')
      .get(jobId) as { version: number };
    expect(latestReport.version).toBe(2);
  });
});
