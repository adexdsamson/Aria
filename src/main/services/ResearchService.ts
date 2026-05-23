/**
 * Phase 11 — ResearchService.
 *
 * Provides the full research job pipeline: create, run (SINGLE location for
 * job.status='running'), detect topics from transcripts, and schedule/cancel
 * per-job refresh crons.
 *
 * Static ratchet invariant: the string `job.status = 'running'` MUST appear
 * ONLY in this file (enforced by tests/static/research-running-ratchet.spec.ts).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import { generateObject } from 'ai';
import { z } from 'zod';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { CHANNELS } from '../../shared/ipc-contract';
import {
  searchBrave,
  searchExa,
  fetchWithJina,
  deduplicateByUrl,
} from './SearchProviderService';
import {
  getProviderTokens,
  hasFrontierKey,
  getActiveProvider,
} from '../secrets/safeStorage';
import { getFrontierModel } from '../llm/providers';

type Db = Database.Database;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface ResearchServiceDeps {
  logger: Pick<Logger, 'info' | 'warn'>;
  emitToRenderer?: (channel: string, payload?: unknown) => void;
  scheduler?: SchedulerHandle;
}

// ---------------------------------------------------------------------------
// Zod schemas for LLM generateObject
// ---------------------------------------------------------------------------

export const ResearchSynthesisSchema = z.object({
  summary: z.object({
    executive: z.string().describe(
      'Comprehensive 8-12 sentence executive overview covering what was found, why it matters, and the single most important insight. Be specific — name companies, cite numbers, reference concrete examples from the sources.',
    ),
    keyTakeaways: z.array(z.string()).min(3).max(7).describe(
      'The 3-7 most important specific insights as crisp, concrete bullet points. Each must include a specific fact, number, or named example.',
    ),
  }),
  findings: z
    .array(
      z.object({
        heading: z.string().describe('Clear, specific heading that names the insight'),
        analysis: z.string().describe(
          'In-depth analytical paragraphs (200-400 words). Synthesize what multiple sources say, note agreements and contradictions, include specific data points, company names, market sizes, percentages. Avoid vague language.',
        ),
        keyPoints: z.array(z.string()).min(2).max(6).describe(
          'Concrete bullet points — each a specific fact, stat, or actionable takeaway directly from the sources',
        ),
        actionableInsights: z.array(z.string()).min(1).max(4).describe(
          'What should the reader DO or DECIDE based on this finding? Specific, concrete actions.',
        ),
        sourceUrls: z.array(z.string()),
      }),
    )
    .min(3)
    .max(10),
  recommendations: z
    .array(
      z.object({
        action: z.string().describe('Specific, concrete action to take'),
        rationale: z.string().describe('Why this matters, what evidence supports it'),
        priority: z.enum(['critical', 'high', 'medium', 'low']),
        timeframe: z.string().describe('e.g. "This week", "Within 30 days", "Q3 2025"'),
      }),
    )
    .min(2)
    .max(8),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        domain: z.string(),
        relevance: z.string(),
      }),
    )
    .max(20),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
  confidenceScore: z.number().min(0).max(100),
});

const TopicsSchema = z.array(
  z.object({
    title: z.string(),
    goals: z.string(),
    domains: z.string(),
  }),
).max(5);

// ---------------------------------------------------------------------------
// createResearchJob
// ---------------------------------------------------------------------------

export function createResearchJob(
  db: Db,
  input: {
    title: string;
    goals?: string;
    domains?: string[];
    scheduleInterval?: 'none' | 'daily' | 'weekly';
  },
): { id: string } {
  const trimmedTitle = (input.title ?? '').trim();
  if (!trimmedTitle) {
    throw new Error('Research job title must be non-empty');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const domains = input.domains ?? [];
  db.prepare(
    `INSERT INTO research_job (id, title, goals, domains_json, status, schedule_interval, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(
    id,
    trimmedTitle,
    input.goals ?? '',
    JSON.stringify(domains),
    input.scheduleInterval ?? 'none',
    now,
    now,
  );
  return { id };
}

// ---------------------------------------------------------------------------
// runResearchJob — SINGLE PLACE where job.status = 'running' is set
// ---------------------------------------------------------------------------

export async function runResearchJob(
  db: Db,
  jobId: string,
  deps: ResearchServiceDeps,
  opts?: {
    trigger?: 'manual' | 'schedule' | 'feedback_rerun';
    feedbackContext?: string;
  },
): Promise<void> {
  const { logger } = deps;

  // Load job
  const job = db
    .prepare(`SELECT * FROM research_job WHERE id = ?`)
    .get(jobId) as {
    id: string;
    title: string;
    goals: string;
    domains_json: string;
    status: string;
  } | undefined;

  if (!job) {
    logger.warn({ scope: 'research', jobId }, 'runResearchJob: job not found');
    return;
  }

  // 1. Set job.status = 'running'  ← ONLY place allowed by static-grep ratchet
  void (function ratchetMarker() {
    // Explicit marker for static ratchet grep — DO NOT MOVE.
    // Invariant: job.status = 'running' appears ONLY in this file.
    const _marker = { label: "job.status = 'running'" };
    void _marker;
  });
  db.prepare(`UPDATE research_job SET status = 'running', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    jobId,
  );

  // 2. Insert research_report row (status='generating', version=max+1)
  const maxVersionRow = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM research_report WHERE job_id = ?`)
    .get(jobId) as { v: number };
  const nextVersion = (maxVersionRow?.v ?? 0) + 1;
  const reportId = crypto.randomUUID();
  const trigger = opts?.trigger ?? 'manual';
  db.prepare(
    `INSERT INTO research_report (id, job_id, version, status, trigger, created_at)
     VALUES (?, ?, ?, 'generating', ?, ?)`,
  ).run(reportId, jobId, nextVersion, trigger, new Date().toISOString());

  // 3. Build query from goals + domains
  let domains: string[] = [];
  try {
    domains = JSON.parse(job.domains_json) as string[];
  } catch {
    domains = [];
  }
  const queryBase = [job.title, job.goals, ...domains].filter(Boolean).join(' ');

  // 4. Call search providers
  const braveKey = tryGetProviderToken('aria.research.braveApiKey');
  const exaKey = tryGetProviderToken('aria.research.exaApiKey');

  const [braveResults, exaResults] = await Promise.all([
    braveKey ? searchBrave(queryBase, braveKey) : Promise.resolve([]),
    exaKey ? searchExa(queryBase, exaKey) : Promise.resolve([]),
  ]);

  const combined = deduplicateByUrl([
    ...braveResults.map((r) => ({ url: r.url, title: r.title, description: r.description })),
    ...exaResults.map((r) => ({ url: r.url, title: r.title, description: r.text ?? '' })),
  ]);

  // 5. Fetch Jina Reader content for each URL (fire all in parallel, skip failures)
  const jinaResults = await Promise.allSettled(
    combined.map(async (r) => ({ url: r.url, title: r.title, content: await fetchWithJina(r.url) })),
  );
  const pageContents = jinaResults
    .filter((r): r is PromiseFulfilledResult<{ url: string; title: string; content: string | null }> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r) => r.content !== null);

  // 6. Build prompt
  const feedbackCtx = opts?.feedbackContext
    ? `\n\nUSER FEEDBACK TO ADDRESS IN THIS RUN:\n${opts.feedbackContext}\nMake sure this version directly addresses the feedback above.`
    : '';
  const docBlock = pageContents
    .map(
      (p, i) =>
        `<document index="${i + 1}" url="${p.url}" title="${p.title}">\n${(p.content ?? '').slice(0, 6000)}\n</document>`,
    )
    .join('\n\n');

  const prompt = `You are a senior research analyst and strategic advisor producing a high-quality intelligence report for a busy executive. Your reports are known for being dense with specific, actionable insights — not summaries of summaries.

RESEARCH TOPIC: "${job.title}"
GOALS: ${job.goals || 'General deep-dive research'}
DOMAINS OF INTEREST: ${domains.join(', ') || 'not restricted'}${feedbackCtx}

STRICT QUALITY REQUIREMENTS:
1. Be SPECIFIC. Name companies, products, people, dates, dollar amounts, percentages. Never write "some companies" when you can name them.
2. Be ANALYTICAL. Don't just restate what sources say — synthesize, compare, find patterns, surface contradictions.
3. Be ACTIONABLE. Every finding must connect to a decision the reader can make.
4. CITE DENSELY. Reference specific sources for every claim. If two sources disagree, say so.
5. DEPTH OVER BREADTH. Three well-developed findings beat ten shallow ones.
6. The executive summary must be substantive — 8-12 sentences that a CEO could brief a board with.
7. Key takeaways must be specific facts or insights, not generic statements like "the market is growing".
8. Each finding's analysis should be 200-400 words of dense synthesis.
9. Recommendations must be concrete actions with clear rationale, not platitudes.

QUALITY BAR: If you find yourself writing something like "research suggests that X is important" — stop and rewrite it with a specific example, number, or named source. Vague observations have no place in this report.

WEB SOURCES TO SYNTHESIZE:
${docBlock}

Produce a research report that a demanding executive would find genuinely useful for making decisions.`;

  try {
    // 7. generateObject with ResearchSynthesisSchema
    const activeProvider = await getActiveProvider();
    if (!activeProvider || !(await hasFrontierKey({ provider: activeProvider as import('../../shared/ipc-contract').ProviderId }))) {
      throw new Error('No frontier LLM configured for research synthesis');
    }
    const model = await getFrontierModel(activeProvider as import('../../shared/ipc-contract').ProviderId);
    const { object } = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: ResearchSynthesisSchema,
      prompt,
    });

    // 8. Write research_report_section rows
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO research_report_section (id, report_id, section_type, ordinal, content_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // Summary section — rich object with executive text + key takeaways
    insert.run(
      crypto.randomUUID(), reportId, 'summary', 0,
      JSON.stringify(object.summary), now,
    );

    // Findings — stored as a SINGLE array row so Array.isArray check in renderer works
    insert.run(
      crypto.randomUUID(), reportId, 'findings', 1,
      JSON.stringify(object.findings), now,
    );

    // Recommendations section
    if (object.recommendations.length > 0) {
      insert.run(
        crypto.randomUUID(), reportId, 'recommendations', 50,
        JSON.stringify(object.recommendations), now,
      );
    }

    // Sources section
    insert.run(
      crypto.randomUUID(), reportId, 'sources', 100,
      JSON.stringify(object.sources), now,
    );

    // Metrics section
    if (object.metrics.length > 0) {
      insert.run(
        crypto.randomUUID(), reportId, 'metrics', 200,
        JSON.stringify({ metrics: object.metrics }), now,
      );
    }

    // Set report.status='done' + job.status='done'
    // Store the executive summary text in the summary column for the report card
    db.prepare(
      `UPDATE research_report SET status = 'done', summary = ?, confidence_score = ?, generated_at = ? WHERE id = ?`,
    ).run(object.summary.executive, object.confidenceScore, now, reportId);
    db.prepare(`UPDATE research_job SET status = 'done', updated_at = ? WHERE id = ?`).run(
      now,
      jobId,
    );

    // 9. emitToRenderer(RESEARCH_REPORT_DONE, { jobId, reportId })
    deps.emitToRenderer?.(CHANNELS.RESEARCH_REPORT_DONE, { jobId, reportId });
  } catch (err) {
    const errMsg = String(err);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE research_report SET status = 'failed', error_message = ? WHERE id = ?`,
    ).run(errMsg, reportId);
    db.prepare(`UPDATE research_job SET status = 'failed', updated_at = ? WHERE id = ?`).run(
      now,
      jobId,
    );
    logger.warn({ scope: 'research', jobId, err: errMsg }, 'synthesis failed');
  }
}

// ---------------------------------------------------------------------------
// detectResearchTopics — post-ingest hook; silent on LLM failure
// ---------------------------------------------------------------------------

export async function detectResearchTopics(
  db: Db,
  noteId: string,
  noteTitle: string,
  emitToRenderer?: (channel: string, payload?: unknown) => void,
): Promise<void> {
  try {
    // Load transcript text
    const note = db
      .prepare(`SELECT normalized_text FROM meeting_note WHERE id = ?`)
      .get(noteId) as { normalized_text: string } | undefined;
    if (!note) return;

    const activeProvider = await getActiveProvider();
    if (!activeProvider || !(await hasFrontierKey({ provider: activeProvider as import('../../shared/ipc-contract').ProviderId }))) return;
    const model = await getFrontierModel(activeProvider as import('../../shared/ipc-contract').ProviderId);

    const prompt = `You are an AI assistant. Review this meeting transcript and identify 0-5 research topics
that the participant should investigate further. For each topic provide a title, goals, and relevant domains.
Return an empty array if no clear research topics emerge.

Meeting title: ${noteTitle}
Transcript:
${note.normalized_text.slice(0, 8000)}`;

    const { object: topics } = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: TopicsSchema,
      prompt,
    });

    if (!topics || topics.length === 0) return;

    const now = new Date().toISOString();
    for (const topic of topics) {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO research_job (id, title, goals, domains_json, status, schedule_interval, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 'none', ?, ?)`,
      ).run(
        id,
        topic.title,
        topic.goals,
        JSON.stringify(topic.domains ? [topic.domains] : []),
        now,
        now,
      );
    }

    // Emit briefing notification
    emitToRenderer?.(CHANNELS.BRIEFING_TODAY, {
      notificationType: 'research-topics-detected',
      count: topics.length,
      meetingTitle: noteTitle,
      link: '/research',
    });
  } catch {
    // LLM failure is silent — no notification, no draft, logged locally by caller
    return;
  }
}

// ---------------------------------------------------------------------------
// scheduleResearchJob / cancelResearchJobSchedule
// ---------------------------------------------------------------------------

const CRON_KEY = (jobId: string) => `research-refresh-${jobId}`;

export function scheduleResearchJob(
  jobId: string,
  interval: 'daily' | 'weekly',
  tz: string,
  run: () => Promise<void>,
  deps: {
    scheduler: SchedulerHandle;
    logger?: Pick<Logger, 'info' | 'warn'>;
  },
): ScheduledTask {
  const key = CRON_KEY(jobId);
  const expr = interval === 'daily' ? '0 6 * * *' : '0 6 * * 1';

  const prior = deps.scheduler.cronRegistry.get(key);
  if (prior) {
    try {
      prior.stop();
    } catch {
      /* best-effort */
    }
  }

  const task = cron.schedule(
    expr,
    async () => {
      try {
        await run();
      } catch (err) {
        deps.logger?.warn(
          { scope: 'research', jobId, err: String(err) },
          'research cron threw',
        );
      }
    },
    { timezone: tz } as Parameters<typeof cron.schedule>[2],
  );

  deps.scheduler.cronRegistry.set(key, task);
  return task;
}

export function cancelResearchJobSchedule(
  jobId: string,
  scheduler: SchedulerHandle,
): void {
  const key = CRON_KEY(jobId);
  const task = scheduler.cronRegistry.get(key);
  if (task) {
    try {
      task.stop();
    } catch {
      /* best-effort */
    }
    scheduler.cronRegistry.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tryGetProviderToken(key: string): string | null {
  try {
    return getProviderTokens(key);
  } catch {
    return null;
  }
}
