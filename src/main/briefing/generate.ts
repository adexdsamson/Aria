/**
 * Plan 02-04 Task 2 — Briefing engine (runBriefing).
 *
 * Flow:
 *   1. Promise.allSettled over gatherCalendar / gatherEmail / gatherNews. Single
 *      source failure surfaces as errors[section] but does NOT block the rest
 *      (BRIEF-06 + Pitfall 15).
 *   2. B4 SC2 fallback: when gatherEmail = 0 rows AND `gmail_message` has unread
 *      in last 24h, set emailEmptyStateReason='no-important-label' on payload.
 *   3. M1 PII redaction (BEFORE prompt assembly + AFTER prompt assembly).
 *      Per-field redaction (`redactPiiInBriefingInput`) covers calendar / email
 *      / news string fields EXCEPT `news[i].url` (renderer needs raw href).
 *      Then a final-prompt redactAllPii pass (UAT Gap 10) catches PII shapes
 *      embedded inside URLs — most notably the loose phone regex matching
 *      10+ contiguous digits in HN item IDs, RSS GUIDs, article slugs, etc.
 *
 *      M1 invariant (post-Gap-9 + Gap-10): both per-candidate redaction AND
 *      a final-prompt redactAllPii pass; classifier sees zero PII patterns;
 *      news URLs are preserved verbatim in the rendered payload
 *      (`payload.news[i].url`) for back-links — only the LLM-bound prompt
 *      sees the redacted form.
 *   4. router.classify({prompt, source:'generic'}) — Phase 1's router. Since
 *      the prompt is PII-free post-redaction, the classifier does NOT trip and
 *      generic routes to FRONTIER when configured (CONTEXT cost expectation).
 *   5. generateObject({model, schema:BriefingSchema, prompt}) — AI SDK 6 +
 *      Zod. ONE call per briefing.
 *   6. writeRoutingLog one row (ok=1 success / ok=0 degraded). Never logs raw
 *      prompt — only hashPrompt(prompt).
 *   7. upsertBriefing one row keyed on date (idempotent same-day retries).
 *   8. On generateObject throw → degraded payload: each section's items =
 *      raw candidates capped at 3 with why='(rationale unavailable)'. BRIEF-06.
 *
 * Never throws to caller — failures are encoded in errors{} or degraded mode.
 */
import type { Logger } from 'pino';
import type Database from 'better-sqlite3-multiple-ciphers';
import { generateObject } from 'ai';
import { z } from 'zod';
import type {
  BriefingItem,
  BriefingNewsItem,
  BriefingPayload,
  Route,
} from '../../shared/ipc-contract';
import type { LLMRouter, RoutingDecision } from '../llm/router';
import {
  getLocalModel,
  getFrontierModel,
  DEFAULT_LOCAL_MODEL,
  type ModelLike,
} from '../llm/providers';
import { writeRoutingLog, hashPrompt } from '../llm/routingLog';
import type { CalendarClient, CalendarEventRaw } from '../integrations/google/calendar';
import { readTodaysEvents } from '../integrations/google/sync-calendar';
import { fetchHnTopStories, type NewsCandidate } from '../news/hn';
import { fetchRssFeed } from '../news/rss';
import { fetchBundleCandidates } from '../news/country-bundle';
import {
  redactPiiInBriefingInput,
  redactAllPii,
  EMAIL_TOKEN_REGEX,
  type CalendarCandidate,
  type EmailCandidate,
  type BriefingCandidates,
} from './redact';
import {
  DEFAULT_PII_PATTERNS,
  DEFAULT_PII_PATTERN_NAMES,
} from '../log/redact';
import { upsertBriefing, hashFromUrl } from './persist';
import * as crypto from 'node:crypto';

type Db = Database.Database;

// ---------------------------------------------------------------------------
// Zod schema — drives generateObject. Keep aligned with BriefingPayload.
// ---------------------------------------------------------------------------

export const BriefingSchema = z.object({
  calendar: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        why: z.string().max(140),
      }),
    )
    .max(3),
  email: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        why: z.string().max(140),
      }),
    )
    .max(3),
  news: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        why: z.string().max(140),
        source_kind: z.enum(['hn', 'rss', 'bundle']),
        // UAT Gap 11: was z.string().url() but OpenAI Structured Outputs rejects
        // JSON Schema "format":"uri" (only a narrow allowlist of formats is supported).
        // URL shape is trusted: this field is carried straight from BriefingCandidate.news[i].url.
        url: z.string(),
      }),
    )
    .max(3),
});

export type BriefingLLMObject = z.infer<typeof BriefingSchema>;

// ---------------------------------------------------------------------------
// Prompt assembly. KEEP redaction-aware — buildBriefingPrompt never sees raw
// candidates; caller MUST pass the result of redactPiiInBriefingInput.
// ---------------------------------------------------------------------------

export function buildBriefingPrompt(
  persona: string,
  recentTopics: string[],
  redacted: BriefingCandidates,
): string {
  const lines: string[] = [];
  lines.push(
    `You are Aria — a terse executive chief-of-staff. Produce a daily briefing in JSON.`,
  );
  lines.push(`Persona: ${persona}`);
  if (recentTopics.length > 0) {
    lines.push(`Recent calendar topics (last 7d): ${recentTopics.join('; ')}`);
  }
  lines.push('');
  lines.push('Candidates:');
  lines.push('=== TODAYS CALENDAR ===');
  for (const e of redacted.calendar.slice(0, 10)) {
    lines.push(
      `- id=${e.id} title="${e.title}" startsAt=${e.startsAt ?? 'null'} allDay=${e.allDay ?? false} location=${e.location ?? 'null'}`,
    );
  }
  lines.push('=== PRIORITY EMAIL ===');
  for (const m of redacted.email.slice(0, 20)) {
    lines.push(
      `- id=${m.id} subject="${m.subject}" from="${m.from_addr}" snippet="${m.snippet.slice(0, 200)}"`,
    );
  }
  lines.push('=== NEWS ===');
  for (const n of redacted.news.slice(0, 50)) {
    lines.push(`- id=${n.id} title="${n.title}" url=${n.url}`);
  }
  lines.push('');
  lines.push(
    `Pick the top 3 in each section. For each item include a 1-line "why this matters" rationale (max 140 chars). Terse executive tone. Do NOT invent items not in the candidates.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gatherers. Each is wrapped in Promise.allSettled by runBriefing.
// ---------------------------------------------------------------------------

async function gatherCalendarCandidates(
  calendarClient: CalendarClient,
  userTz: string,
): Promise<CalendarCandidate[]> {
  const raws = await readTodaysEvents(calendarClient, userTz);
  return raws.map((r: CalendarEventRaw) => {
    const startsAt = r.start?.dateTime ?? r.start?.date ?? null;
    const allDay = !r.start?.dateTime && !!r.start?.date;
    return {
      id: r.id,
      title: r.summary ?? '',
      startsAt,
      allDay,
      location: r.location ?? null,
    };
  });
}

/**
 * Plan 03-03 — Phase 2 IMPORTANT-label filter removed. Email candidates now
 * sourced from the `email_triage` table (EMAIL-03), selecting messages whose
 * triage classifier marked priority IN ('urgent','needs-you'). Urgent rows
 * sort first; received_at DESC within priority bucket.
 *
 * Gracefully degrades on schema-not-present (test envs that skip migration
 * 008): returns empty list, callers fall through to "Triage in progress"
 * empty-state copy per RESEARCH §Pitfall 8.
 */
async function gatherEmailCandidates(db: Db): Promise<EmailCandidate[]> {
  try {
    const rows = db
      .prepare(
        `SELECT m.id AS id, m.subject AS subject, m.from_addr AS from_addr,
                m.snippet AS snippet, m.received_at AS received_at
         FROM gmail_message m
         INNER JOIN email_triage t ON t.message_id = m.id
         WHERE t.priority IN ('urgent','needs-you')
           AND m.received_at >= datetime('now','-24 hours')
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END,
                  m.received_at DESC
         LIMIT 20`,
      )
      .all() as EmailCandidate[];
    return rows;
  } catch {
    // email_triage table not yet migrated (e.g. test env on older schema).
    return [];
  }
}

interface NewsSource {
  kind: 'hn' | 'rss' | 'bundle';
  country: string | null;
  sector: string | null;
  url: string | null;
}

async function gatherNewsCandidates(
  db: Db,
  date: string,
  dismissedHashes: Set<string>,
): Promise<NewsCandidate[]> {
  const sources = db
    .prepare(
      `SELECT kind, country, sector, url FROM news_source WHERE enabled = 1`,
    )
    .all() as NewsSource[];

  const hasHn = sources.some((s) => s.kind === 'hn');
  const rssRows = sources.filter((s) => s.kind === 'rss' && s.url);
  const bundleRows = sources.filter((s) => s.kind === 'bundle');

  const promises: Array<Promise<NewsCandidate[]>> = [];
  if (hasHn) promises.push(fetchHnTopStories({ limit: 20 }).catch(() => [] as NewsCandidate[]));
  for (const r of rssRows.slice(0, 3)) {
    if (r.url) {
      promises.push(fetchRssFeed({ url: r.url, limit: 5 }).catch(() => [] as NewsCandidate[]));
    }
  }
  // Bundle: group by country (typically just 'NG' in v1). Use sectors from rows.
  const bundleCountry = bundleRows[0]?.country ?? null;
  const bundleSectors = Array.from(
    new Set(bundleRows.map((b) => b.sector).filter((s): s is string => !!s)),
  );
  if (bundleCountry && bundleSectors.length > 0) {
    promises.push(
      fetchBundleCandidates({ country: bundleCountry, sectors: bundleSectors, limit: 15 }).catch(
        () => [] as NewsCandidate[],
      ),
    );
  }

  const settled = await Promise.allSettled(promises);
  const all: NewsCandidate[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  // Dedupe by url-hash; cap at 50.
  const seen = new Set<string>();
  const out: NewsCandidate[] = [];
  for (const c of all) {
    const h = hashFromUrl(c.url);
    if (seen.has(h)) continue;
    if (dismissedHashes.has(h) || dismissedHashes.has(c.id)) continue;
    seen.add(h);
    out.push(c);
    if (out.length >= 50) break;
  }
  void date; // reserved for future per-day pruning
  return out;
}

// ---------------------------------------------------------------------------
// runBriefing — the engine entrypoint.
// ---------------------------------------------------------------------------

export interface RunBriefingDeps {
  db: Db;
  date: string; // YYYY-MM-DD local
  userTz: string;
  calendarClient: CalendarClient | null;
  router: LLMRouter;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Test seam — override AI SDK generateObject. */
  generateObjectFn?: typeof generateObject;
  /** Test seam — override frontier-model factory. */
  getFrontierModelFn?: typeof getFrontierModel;
  /** Test seam — override local-model factory. */
  getLocalModelFn?: typeof getLocalModel;
  persona?: string;
  recentTopics?: string[];
}

export async function runBriefing(deps: RunBriefingDeps): Promise<BriefingPayload> {
  const {
    db,
    date,
    userTz,
    calendarClient,
    router,
    logger,
    persona = 'SMB executive',
    recentTopics = [],
  } = deps;
  const gen = deps.generateObjectFn ?? generateObject;
  const localFactory = deps.getLocalModelFn ?? getLocalModel;
  const frontierFactory = deps.getFrontierModelFn ?? getFrontierModel;

  // Load dismissed hashes for `date` so gatherNews can exclude them.
  const dismissedRows = db
    .prepare('SELECT url_hash FROM briefing_item_dismissed WHERE date = ?')
    .all(date) as Array<{ url_hash: string }>;
  const dismissedHashes = new Set(dismissedRows.map((r) => r.url_hash));

  // ── Promise.allSettled gather ─────────────────────────────────────────────
  const calPromise: Promise<CalendarCandidate[]> = calendarClient
    ? gatherCalendarCandidates(calendarClient, userTz)
    : Promise.reject(new Error('calendar-not-connected'));
  const emailPromise = gatherEmailCandidates(db);
  const newsPromise = gatherNewsCandidates(db, date, dismissedHashes);

  const [calRes, emailRes, newsRes] = await Promise.allSettled([
    calPromise,
    emailPromise,
    newsPromise,
  ]);

  const errors: BriefingPayload['errors'] = {};
  const calendarCandidates: CalendarCandidate[] =
    calRes.status === 'fulfilled' ? calRes.value : [];
  if (calRes.status === 'rejected') {
    errors.calendar = describeErr(calRes.reason);
  }
  const emailCandidates: EmailCandidate[] = emailRes.status === 'fulfilled' ? emailRes.value : [];
  if (emailRes.status === 'rejected') {
    errors.email = describeErr(emailRes.reason);
  }
  const newsCandidates: NewsCandidate[] = newsRes.status === 'fulfilled' ? newsRes.value : [];
  if (newsRes.status === 'rejected') {
    errors.news = describeErr(newsRes.reason);
  }

  // ── B4 SC2 fallback detection (BEFORE LLM call) ───────────────────────────
  // Plan 03-03 supersedes Phase 2's `no-important-label` placeholder. When the
  // triage-JOIN selects zero rows AND there are gmail_message rows in the
  // window that have NOT yet been triaged (backlog), fall back to "triage in
  // progress" semantics. emailEmptyStateReason remains a literal `'no-important-label'`
  // for ipc-contract compatibility, but renderer copy is reinterpreted as
  // "Triage in progress — N messages awaiting classification" (RESEARCH
  // §Pitfall 8). The presence of unread+untriaged backlog is the trigger.
  let emailEmptyStateReason: BriefingPayload['emailEmptyStateReason'];
  if (emailRes.status === 'fulfilled' && emailCandidates.length === 0) {
    try {
      const probe = db
        .prepare(
          `SELECT COUNT(*) AS n FROM gmail_message m
           LEFT JOIN email_triage t ON t.message_id = m.id
           WHERE m.received_at >= datetime('now','-24 hours')
             AND t.message_id IS NULL`,
        )
        .get() as { n: number };
      if (probe.n > 0) emailEmptyStateReason = 'no-important-label';
    } catch {
      /* gmail_message or email_triage may not exist if user hasn't connected
       * or migration 008 hasn't run — best effort. */
    }
  }

  // ── M1 redaction (UAT Gap 9: full PII pattern set, not just email) ───────
  const redacted = redactPiiInBriefingInput({
    calendar: calendarCandidates,
    email: emailCandidates,
    news: newsCandidates,
  });
  // Defense-in-depth: re-stringify and assert no email-pattern survives.
  const dbgSerialized = JSON.stringify({
    calendar: redacted.calendar.map((c) => ({ ...c })),
    email: redacted.email.map((m) => ({ ...m })),
    news: redacted.news.map((n) => ({ id: n.id, title: n.title })), // url excluded (intentional)
  });
  if (new RegExp(EMAIL_TOKEN_REGEX.source, 'g').test(dbgSerialized)) {
    logger.warn(
      { scope: 'briefing', event: 'M1-residual-email' },
      'redaction left email-shape substring in candidates; investigate',
    );
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const prompt = buildBriefingPrompt(persona, recentTopics, redacted);
  // UAT Gap 10 — final-prompt belt-and-braces redaction. Per-field redaction
  // (above) intentionally preserves news[i].url verbatim because the renderer
  // payload needs raw URLs for back-links. But the loose phone regex matches
  // 10+ contiguous digits, which appear in many real URLs (HN item IDs, RSS
  // GUIDs, timestamps, slugs) → classifier would still trip on
  // `pii-pattern-matched:phone`. Redact the assembled prompt string ONCE more
  // here; only the LLM-bound + classifier-bound prompt sees this form. The
  // renderer payload (built later from `redacted.news`) still has raw URLs.
  const redactedPrompt = redactAllPii(prompt);
  // Defense-in-depth: scan every DEFAULT_PII_PATTERN against the redacted
  // prompt. If anything still matches, that's a redactor bug — warn-log and
  // continue (don't crash; the per-field redaction already cleaned the
  // candidate set, so a leak here would be a pattern/token mismatch).
  for (let i = 0; i < DEFAULT_PII_PATTERNS.length; i++) {
    const re = DEFAULT_PII_PATTERNS[i]!;
    const name = DEFAULT_PII_PATTERN_NAMES[i] ?? `pattern-${i}`;
    re.lastIndex = 0;
    const hit = re.test(redactedPrompt);
    re.lastIndex = 0;
    if (hit) {
      logger.warn(
        { scope: 'briefing', event: 'M1-residual-pattern', pattern: name },
        'redactAllPii left a PII pattern in the assembled prompt; investigate',
      );
    }
  }

  // ── Skip path: no candidates at all ──────────────────────────────────────
  const totalCandidates =
    calendarCandidates.length + emailCandidates.length + newsCandidates.length;

  // ── Router decision ──────────────────────────────────────────────────────
  let decision: RoutingDecision;
  try {
    decision = await router.classify({ prompt: redactedPrompt, source: 'generic' });
  } catch (err) {
    logger.warn({ scope: 'briefing', err: describeErr(err) }, 'router.classify failed');
    decision = {
      route: 'LOCAL',
      reason: 'router-failed',
      model: DEFAULT_LOCAL_MODEL,
      provider: 'ollama',
    };
  }

  const generatedAt = new Date().toISOString();
  const promptHashValue = hashPrompt(redactedPrompt);

  // ── No-candidates path: skip LLM, write ok=0 routing_log, persist ok=0. ──
  // UAT Gap 9: preserve original routing decision reason in the log, suffixed
  // with the post-call status. Format: `<decision.reason> | <post-call>`.
  if (totalCandidates === 0) {
    const noCandReason = `${decision.reason} | no-candidates`;
    safeWriteLog(db, logger, {
      ts: generatedAt,
      route: decision.route,
      reason: noCandReason,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms: 0,
      ok: 0,
    });
    const payload = buildPayload({
      date,
      generatedAt,
      tz: userTz,
      calendar: [],
      email: [],
      news: [],
      errors,
      emailEmptyStateReason,
      route: decision.route,
      reason: noCandReason,
      model: decision.model,
    });
    safeUpsert(db, logger, payload, decision, 0, 0);
    return payload;
  }

  // ── Acquire model ────────────────────────────────────────────────────────
  let model: ModelLike;
  try {
    if (decision.route === 'FRONTIER') {
      model = await frontierFactory(
        decision.provider as Exclude<RoutingDecision['provider'], 'ollama'>,
      );
    } else {
      model = localFactory();
    }
  } catch (err) {
    logger.warn({ scope: 'briefing', err: describeErr(err) }, 'model factory failed');
    // UAT Gap 9: preserve the original routing decision reason; suffix with
    // the post-call failure status so the audit trail tells the full story.
    const reason = `${decision.reason} | model-acquire-failed:${describeErr(err)}`;
    const start = Date.now();
    const degraded = degradedPayload({
      date,
      generatedAt,
      tz: userTz,
      calendarCandidates,
      emailCandidates,
      newsCandidates,
      errors,
      emailEmptyStateReason,
      route: decision.route,
      reason,
      model: decision.model,
    });
    safeWriteLog(db, logger, {
      ts: generatedAt,
      route: decision.route,
      reason,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms: Math.max(0, Date.now() - start),
      ok: 0,
    });
    safeUpsert(db, logger, degraded, decision, 0, 0);
    return degraded;
  }

  // ── generateObject ───────────────────────────────────────────────────────
  const startMs = Date.now();
  try {
    const result = await gen({
      model: model as Parameters<typeof gen>[0]['model'],
      schema: BriefingSchema,
      prompt: redactedPrompt,
    } as Parameters<typeof gen>[0]);
    const latency_ms = Math.max(0, Date.now() - startMs);
    const obj = (result as { object: BriefingLLMObject }).object;

    const calendar: BriefingItem[] = (obj.calendar ?? []).slice(0, 3).map((c) => ({
      id: c.id,
      title: c.title,
      why: c.why,
    }));
    const email: BriefingItem[] = (obj.email ?? []).slice(0, 3).map((c) => ({
      id: c.id,
      title: c.title,
      why: c.why,
    }));
    const news: BriefingNewsItem[] = (obj.news ?? []).slice(0, 3).map((c) => ({
      id: c.id,
      title: c.title,
      why: c.why,
      url: c.url,
      sourceKind: c.source_kind,
      dismissed: false,
    }));

    safeWriteLog(db, logger, {
      ts: generatedAt,
      route: decision.route,
      reason: decision.reason,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms,
      ok: 1,
    });
    const payload = buildPayload({
      date,
      generatedAt,
      tz: userTz,
      calendar,
      email,
      news,
      errors,
      emailEmptyStateReason,
      route: decision.route,
      reason: decision.reason,
      model: decision.model,
    });
    safeUpsert(db, logger, payload, decision, latency_ms, 1);
    logger.info(
      { scope: 'briefing', date, route: decision.route, reason: decision.reason, latency_ms },
      'briefing generated',
    );
    return payload;
  } catch (err) {
    const latency_ms = Math.max(0, Date.now() - startMs);
    const klass = (err as { name?: string }).name ?? 'Error';
    // UAT Gap 9: preserve the original routing decision reason; suffix with
    // the post-call failure status so the audit trail tells the full story.
    const reason = `${decision.reason} | generateObject-failed:${klass}`;
    logger.warn({ scope: 'briefing', err: describeErr(err) }, 'generateObject threw');
    safeWriteLog(db, logger, {
      ts: generatedAt,
      route: decision.route,
      reason,
      source: 'generic',
      prompt_hash: promptHashValue,
      model: decision.model,
      latency_ms,
      ok: 0,
    });
    const degraded = degradedPayload({
      date,
      generatedAt,
      tz: userTz,
      calendarCandidates,
      emailCandidates,
      newsCandidates,
      errors,
      emailEmptyStateReason,
      route: decision.route,
      reason,
      model: decision.model,
    });
    safeUpsert(db, logger, degraded, decision, latency_ms, 0);
    return degraded;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function describeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function buildPayload(args: {
  date: string;
  generatedAt: string;
  tz: string;
  calendar: BriefingItem[];
  email: BriefingItem[];
  news: BriefingNewsItem[];
  errors: BriefingPayload['errors'];
  emailEmptyStateReason: BriefingPayload['emailEmptyStateReason'];
  route: Route;
  reason: string;
  model: string;
}): BriefingPayload {
  return {
    date: args.date,
    generatedAt: args.generatedAt,
    tz: args.tz,
    calendar: args.calendar,
    email: args.email,
    news: args.news,
    errors: args.errors,
    emailEmptyStateReason: args.emailEmptyStateReason,
    route: args.route,
    reason: args.reason,
    model: args.model,
  };
}

function degradedPayload(args: {
  date: string;
  generatedAt: string;
  tz: string;
  calendarCandidates: CalendarCandidate[];
  emailCandidates: EmailCandidate[];
  newsCandidates: NewsCandidate[];
  errors: BriefingPayload['errors'];
  emailEmptyStateReason: BriefingPayload['emailEmptyStateReason'];
  route: Route;
  reason: string;
  model: string;
}): BriefingPayload {
  const calendar: BriefingItem[] = args.calendarCandidates.slice(0, 3).map((c) => ({
    id: c.id,
    title: c.title,
    why: '(rationale unavailable)',
  }));
  const email: BriefingItem[] = args.emailCandidates.slice(0, 3).map((c) => ({
    id: c.id,
    title: c.subject,
    why: '(rationale unavailable)',
  }));
  const news: BriefingNewsItem[] = args.newsCandidates.slice(0, 3).map((c) => ({
    id: c.id,
    title: c.title,
    why: '(rationale unavailable)',
    url: c.url,
    sourceKind: candidateKind(c.id),
    dismissed: false,
  }));
  return buildPayload({ ...args, calendar, email, news });
}

function candidateKind(id: string): 'hn' | 'rss' | 'bundle' {
  if (id.startsWith('hn-')) return 'hn';
  if (id.startsWith('rss-')) return 'rss';
  return 'bundle';
}

function safeWriteLog(
  db: Db,
  logger: Pick<Logger, 'warn'>,
  entry: Parameters<typeof writeRoutingLog>[1],
): void {
  try {
    writeRoutingLog(db, entry);
  } catch (err) {
    logger.warn({ scope: 'briefing', err: describeErr(err) }, 'routing_log write failed');
  }
}

function safeUpsert(
  db: Db,
  logger: Pick<Logger, 'warn'>,
  payload: BriefingPayload,
  decision: RoutingDecision,
  latency_ms: number,
  ok: 0 | 1,
): void {
  try {
    upsertBriefing(db, {
      date: payload.date,
      generatedAt: payload.generatedAt,
      tz: payload.tz,
      sections: JSON.stringify({
        calendar: payload.calendar,
        email: payload.email,
        news: payload.news,
        errors: payload.errors,
        emailEmptyStateReason: payload.emailEmptyStateReason,
        reason: payload.reason,
      }),
      route: payload.route,
      model: decision.model,
      latency_ms,
      ok,
    });
  } catch (err) {
    logger.warn({ scope: 'briefing', err: describeErr(err) }, 'upsertBriefing failed');
  }
}

// Defensive — keeps crypto import alive in case future helpers need it.
void crypto;
