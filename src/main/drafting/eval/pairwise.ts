/**
 * Plan 03-04 Wave A — Voice-match pairwise eval harness.
 *
 * Per RESEARCH §Pattern 6 + CONTEXT §Voice-match spike. Samples 50 stratified
 * held-out sent emails, generates a candidate reply two ways (Aria few-shot
 * vs. generic-LLM baseline), and dispatches a frontier judge (Claude Sonnet)
 * to pick the better voice match. The 50 sampled IDs are persisted to the
 * `voice_match_holdout` table so the drafting agent (Task 3) can EXCLUDE them
 * from its few-shot exemplar pool, keeping the eval honest on every re-run.
 *
 * Frontier judge is MANDATORY (RESEARCH §Pitfall 7 — local judge bias). All
 * inbound + reply text is tokenized via `tokenizeForFrontier` before judge
 * dispatch (PII invariant LLM-02); rehydrate happens locally. `disposeDraftTable`
 * runs in a try/finally so token tables never leak across items.
 *
 * The router-pure design: the harness takes injectable `draftFewShot`,
 * `draftBaseline`, and `judge` functions so unit tests can wire mocks and the
 * production script wires real provider calls. Every LLM dispatch goes
 * through the shared p-queue (CONTEXT §cross-cutting).
 *
 * Pass criteria (CONTEXT-locked): winRate >= 0.65 AND catastrophic === 0.
 */
import { z } from 'zod';
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import {
  tokenizeForFrontier,
  rehydrate,
  disposeDraftTable,
} from '../../llm/tokenize';

type Db = Database.Database;
type PQueueLike = InstanceType<typeof PQueueImport>;

// =============================================================================
// Schemas / Types
// =============================================================================

export const JudgeSchema = z.object({
  winner: z.enum(['a', 'b', 'tie']),
  catastrophic: z.boolean(),
  reason: z.string().max(200),
});

export type JudgeOutput = z.infer<typeof JudgeSchema>;

/** One stratification bucket for the 50-item sample. */
export type Stratum = 'short-formal' | 'short-casual' | 'long-formal' | 'long-casual';

export interface HeldOutItem {
  /** gmail_message.id of the user's prior outbound (the gold reply). */
  id: string;
  /** The thread's preceding inbound message — what we are drafting a reply to. */
  inboundText: string;
  /** The user's actual sent reply (used to seed exemplar selection in production). */
  goldReply: string;
  stratum: Stratum;
}

export interface PerItemResult {
  id: string;
  stratum: Stratum;
  winner: JudgeOutput['winner'];
  catastrophic: boolean;
  reason: string;
}

export interface EvalReport {
  total: number;
  ariaWins: number;
  baselineWins: number;
  ties: number;
  catastrophic: number;
  winRate: number;
  passed: boolean;
  approach: 'few-shot' | 'fine-tune';
  sampleComposition: Record<Stratum, number>;
  perItem: PerItemResult[];
}

// =============================================================================
// Stratification
// =============================================================================

const SHORT_THRESHOLD_CHARS = 200;

/** Heuristic tone classifier: capitalized subject + 5+ words ⇒ formal. */
export function classifyTone(subject: string, body: string): 'formal' | 'casual' {
  const subj = (subject ?? '').trim();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const subjectCapitalized =
    subj.length > 0 &&
    subj[0] === subj[0]!.toUpperCase() &&
    /[A-Z]/.test(subj[0] ?? '');
  if (subjectCapitalized && wordCount >= 5) return 'formal';
  return 'casual';
}

export function stratumOf(item: { subject: string; body: string }): Stratum {
  const lengthBucket = item.body.length < SHORT_THRESHOLD_CHARS ? 'short' : 'long';
  const tone = classifyTone(item.subject, item.body);
  return `${lengthBucket}-${tone}` as Stratum;
}

/** Stratified sampler: 12-13 per bucket → 50 total. */
export function stratifiedSample<T extends { subject: string; body: string }>(
  pool: T[],
  targetTotal = 50,
): T[] {
  const buckets: Record<Stratum, T[]> = {
    'short-formal': [],
    'short-casual': [],
    'long-formal': [],
    'long-casual': [],
  };
  for (const it of pool) buckets[stratumOf(it)].push(it);
  // 50 = 12 + 13 + 12 + 13 across the 4 buckets.
  const perBucket: Record<Stratum, number> = {
    'short-formal': 12,
    'short-casual': 13,
    'long-formal': 12,
    'long-casual': 13,
  };
  const out: T[] = [];
  for (const k of Object.keys(perBucket) as Stratum[]) {
    const want = perBucket[k];
    const have = buckets[k];
    // Deterministic spread: bucket is already in insertion order; take the
    // first `want`. Eval harness is not security-sensitive — operator can
    // shuffle the pool upstream if randomness matters.
    out.push(...have.slice(0, want));
  }
  // If a bucket was underpopulated, top up from the largest remaining bucket.
  if (out.length < targetTotal) {
    const remaining = pool.filter((p) => !out.includes(p));
    out.push(...remaining.slice(0, targetTotal - out.length));
  }
  return out.slice(0, targetTotal);
}

// =============================================================================
// Holdout persistence
// =============================================================================

/** Persist held-out IDs to `voice_match_holdout` so the drafting agent can
 *  exclude them from its few-shot exemplar pool. INSERT OR IGNORE so re-runs
 *  with overlapping samples are idempotent. */
export function recordHoldout(db: Db, ids: string[]): void {
  const now = new Date().toISOString();
  const tx = db.transaction((rows: string[]) => {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO voice_match_holdout (id, created_at) VALUES (?, ?)`,
    );
    for (const id of rows) stmt.run(id, now);
  });
  tx(ids);
}

// =============================================================================
// Run the eval
// =============================================================================

export interface RunVoiceMatchEvalOptions {
  db: Db;
  /** Stratified, pre-sampled set. In production the caller samples from
   *  `gmail_message` rows where direction is outbound (Phase 2 doesn't yet
   *  record direction — production script applies heuristics). */
  items: HeldOutItem[];
  /** p-queue for serialization of LLM calls (CONTEXT cross-cutting). */
  queue: PQueueLike;
  /** Inject the few-shot drafter; production wires Plan 03-04 Task 3's
   *  `draftReply` (without the approval row write — pure text). */
  draftFewShot: (item: HeldOutItem) => Promise<string>;
  /** Inject the generic baseline drafter; production calls the same frontier
   *  model with NO few-shot exemplars. */
  draftBaseline: (item: HeldOutItem) => Promise<string>;
  /** Inject the judge call. Production wires Claude Sonnet via
   *  `generateObject(JudgeSchema)`. The harness handles tokenize +
   *  rehydrate around this call. */
  judge: (args: {
    exemplars: string[];
    draftA: string;
    draftB: string;
  }) => Promise<JudgeOutput>;
  /** Provide 3 voice exemplars per item (the user's prior sent emails in
   *  the same stratum, EXCLUDING the held-out set). */
  fetchExemplars: (item: HeldOutItem) => Promise<string[]>;
  /** Which approach this eval run is measuring. */
  approach: 'few-shot' | 'fine-tune';
}

/** CONTEXT-locked pass rule. */
export function evaluatePassCriteria(opts: {
  ariaWins: number;
  total: number;
  catastrophic: number;
}): boolean {
  if (opts.total === 0) return false;
  const winRate = opts.ariaWins / opts.total;
  return winRate >= 0.65 && opts.catastrophic === 0;
}

/** Run the pairwise judge over the held-out items. NEVER calls Gmail/Ollama
 *  directly — all LLM work is injected. */
export async function runVoiceMatchEval(
  opts: RunVoiceMatchEvalOptions,
): Promise<EvalReport> {
  // Record the held-out IDs first so a crash mid-eval still keeps them out
  // of the drafting agent's few-shot pool.
  recordHoldout(opts.db, opts.items.map((i) => i.id));

  const composition: Record<Stratum, number> = {
    'short-formal': 0,
    'short-casual': 0,
    'long-formal': 0,
    'long-casual': 0,
  };
  for (const it of opts.items) composition[it.stratum] = (composition[it.stratum] ?? 0) + 1;

  const perItem: PerItemResult[] = [];
  for (const item of opts.items) {
    const approvalId = `vm-eval-${item.id}`;
    try {
      const [draftA, draftB, exemplars] = await Promise.all([
        opts.queue.add(() => opts.draftFewShot(item)) as Promise<string>,
        opts.queue.add(() => opts.draftBaseline(item)) as Promise<string>,
        opts.fetchExemplars(item),
      ]);

      // Tokenize both drafts + exemplars before sending to frontier judge
      // (RESEARCH §Pattern 6 / Pitfall 7). One token table per approvalId so
      // rehydrate can recover quoted user content from the judge's reason
      // string before we read it back.
      const joinedInput = [
        '---EXEMPLARS---',
        ...exemplars,
        '---DRAFT_A---',
        draftA,
        '---DRAFT_B---',
        draftB,
      ].join('\n');
      const { prompt: tokenized } = tokenizeForFrontier(approvalId, joinedInput);

      // Re-split the tokenized blob so the judge sees structured input.
      const [, ex1Block = '', daBlock = '', dbBlock = ''] = tokenized.split(
        /---EXEMPLARS---\n|---DRAFT_A---\n|---DRAFT_B---\n/,
      );
      const tokenizedExemplars = ex1Block
        .trim()
        .split('\n')
        .filter((s) => s.length > 0);

      const raw = await opts.queue.add(() =>
        opts.judge({
          exemplars: tokenizedExemplars,
          draftA: daBlock.trim(),
          draftB: dbBlock.trim(),
        }),
      );
      const parsed = JudgeSchema.parse(raw);
      const rehydratedReason = rehydrate(approvalId, parsed.reason);

      perItem.push({
        id: item.id,
        stratum: item.stratum,
        winner: parsed.winner,
        catastrophic: parsed.catastrophic,
        reason: rehydratedReason,
      });
    } finally {
      disposeDraftTable(approvalId);
    }
  }

  const ariaWins = perItem.filter((p) => p.winner === 'a').length;
  const baselineWins = perItem.filter((p) => p.winner === 'b').length;
  const ties = perItem.filter((p) => p.winner === 'tie').length;
  const catastrophic = perItem.filter((p) => p.catastrophic).length;
  const total = perItem.length;
  const winRate = total > 0 ? ariaWins / total : 0;
  const passed = evaluatePassCriteria({ ariaWins, total, catastrophic });

  return {
    total,
    ariaWins,
    baselineWins,
    ties,
    catastrophic,
    winRate,
    passed,
    approach: opts.approach,
    sampleComposition: composition,
    perItem,
  };
}
