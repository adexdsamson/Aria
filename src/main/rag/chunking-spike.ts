/**
 * Plan 07-01 Task 5 — chunking spike runner.
 *
 * Loads `tests/fixtures/rag/eval-qa-set.json` (the synthetic 20-question set
 * authored under user override on 2026-05-19). For each strategy A/B/C:
 *   1. Chunk every source row.
 *   2. Build an in-process token-overlap inverted index.
 *   3. Score top-10 chunks per question.
 *   4. Compute recall@10 (overlap-by-char-range) and MRR@50.
 *
 * NOTE: the spike runs purely in-process over the fixture's `sources[]` block
 * — no DB, no harvester invocation. This is intentional for environment
 * portability (the live DB needs the Electron-ABI native binary which is
 * locked while the desktop app is running). When a real-DB fixture replaces
 * the synthetic one (see Deferred / Followups in 07-01-SUMMARY.md), this
 * runner should be re-pointed at the harvesters.
 */

import { ALL_STRATEGIES } from './chunk-strategies';
import type { ChunkingStrategy, RagChunk, SourceDoc } from './chunk-types';

export interface EvalSource extends SourceDoc {
  // SourceDoc fields plus the explicit sourceId we treat as the lookup key.
}

export interface EvalQuestion {
  id: string;
  corpus: 'email' | 'event' | 'note' | 'action';
  question: string;
  ground_truth: { sourceId: string; charStart: number; charEnd: number };
  explicit_person?: string;
}

export interface EvalSet {
  sources: EvalSource[];
  questions: EvalQuestion[];
}

interface ScoredChunk {
  chunk: Omit<RagChunk, 'id'> & { id: string };
  score: number;
}

export interface StrategyMetrics {
  name: ChunkingStrategy['name'];
  totalChunks: number;
  estimatedBytes: number;
  recallAt10: number;
  mrr50: number;
  perQuestion: Array<{
    qid: string;
    foundRank: number | null; // 1-indexed; null if not in top-50
    overlapInTop10: boolean;
  }>;
}

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','of','to','in','on','at','for','and',
  'or','but','what','who','when','where','why','how','did','do','does','that',
  'this','these','those','about','with','from','by','as','it','its','be','been',
  'has','have','had','i','you','he','she','they','we','us','our','their','my',
  'me','your','his','her','them','if','then','can','will','would','could','should',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function overlap(rangeA: { start: number; end: number }, rangeB: { start: number; end: number }): boolean {
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

function chunksForStrategy(strategy: ChunkingStrategy, sources: EvalSource[]): Array<Omit<RagChunk, 'id'> & { id: string }> {
  const out: Array<Omit<RagChunk, 'id'> & { id: string }> = [];
  for (const src of sources) {
    const pieces = strategy.chunk(src);
    pieces.forEach((p, idx) => {
      out.push({ ...p, id: `${src.sourceKind}:${src.sourceId}:chunk:${idx}` });
    });
  }
  return out;
}

function scoreAgainstQuery(chunks: Array<Omit<RagChunk, 'id'> & { id: string }>, question: string): ScoredChunk[] {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return [];
  const scored: ScoredChunk[] = chunks.map((c) => {
    const cTokens = tokenize(c.text);
    let hits = 0;
    for (const t of cTokens) {
      if (qTokens.has(t)) hits++;
    }
    // Token-overlap score, length-penalized so trivially-long chunks don't dominate.
    const score = hits / Math.log2(Math.max(2, cTokens.length));
    return { chunk: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function runSpike(evalSet: EvalSet): StrategyMetrics[] {
  const results: StrategyMetrics[] = [];

  for (const strategy of ALL_STRATEGIES) {
    const chunks = chunksForStrategy(strategy, evalSet.sources);
    const totalChunks = chunks.length;
    const estimatedBytes = totalChunks * 4096; // RESEARCH §2 ~4 KB per chunk incl. embedding

    let recallHits = 0;
    let mrrSum = 0;
    const perQuestion: StrategyMetrics['perQuestion'] = [];

    for (const q of evalSet.questions) {
      const top = scoreAgainstQuery(chunks, q.question).slice(0, 50);
      const truth = q.ground_truth;
      let foundRank: number | null = null;
      let overlapInTop10 = false;
      for (let i = 0; i < top.length; i++) {
        const c = top[i]!.chunk;
        if (c.sourceId !== truth.sourceId) continue;
        const hit = overlap(
          { start: c.charStart, end: c.charEnd },
          { start: truth.charStart, end: truth.charEnd },
        );
        if (hit) {
          if (foundRank === null) foundRank = i + 1;
          if (i < 10) overlapInTop10 = true;
          break;
        }
      }
      if (overlapInTop10) recallHits++;
      if (foundRank !== null) mrrSum += 1 / foundRank;
      perQuestion.push({ qid: q.id, foundRank, overlapInTop10 });
    }

    results.push({
      name: strategy.name,
      totalChunks,
      estimatedBytes,
      recallAt10: recallHits / evalSet.questions.length,
      mrr50: mrrSum / evalSet.questions.length,
      perQuestion,
    });
  }

  return results;
}

export function pickWinner(metrics: StrategyMetrics[]): StrategyMetrics {
  // Decision rule: highest recall@10 wins; ties broken by higher MRR.
  return [...metrics].sort((a, b) => {
    if (b.recallAt10 !== a.recallAt10) return b.recallAt10 - a.recallAt10;
    return b.mrr50 - a.mrr50;
  })[0]!;
}

export function renderSpikeMarkdown(
  metrics: StrategyMetrics[],
  winner: StrategyMetrics,
  questionCount: number,
  sourceCount: number,
): string {
  const lines: string[] = [];
  lines.push('# 07-SPIKE-CHUNKING.md');
  lines.push('');
  lines.push('> **Synthetic-fixture spike.** Authored under user override on 2026-05-19.');
  lines.push('> The chunking-strategy decision below is **PROVISIONAL**. Replace with a');
  lines.push('> user-authored fixture against real local DB rows before relying on');
  lines.push("> 07-02 / 07-03's chunk-size choices in production. See 07-01-SUMMARY.md");
  lines.push('> `Deferred / Followups`.');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(`- Eval set: ${questionCount} synthetic questions over ${sourceCount} synthetic sources, 5 questions/corpus (email / event / note / action).`);
  lines.push('- Retrieval: in-process token-overlap inverted index, length-penalized score. No FTS5, no vector — that\'s plan 07-02\'s job; the spike measures *chunk-shape effect on recall* only.');
  lines.push('- Ground truth: each question carries `{sourceId, charStart, charEnd}` from the fixture. A top-10 chunk is a hit iff it shares `sourceId` AND its `[charStart,charEnd)` overlaps the labeled span.');
  lines.push('- Metrics: `recall@10` (fraction of questions with a hit in top-10) and `MRR@50` (mean reciprocal rank of the first hit in top-50).');
  lines.push('- LLM-judge sanity check (RESEARCH §7) gated behind `RAG_SPIKE_LLM_JUDGE=1` — DEFERRED to real-fixture replacement; current run is recall/MRR only.');
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Strategy | recall@10 | MRR@50 | Total chunks | Est. storage |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const m of metrics) {
    lines.push(
      `| ${m.name} | ${(m.recallAt10 * 100).toFixed(1)}% | ${m.mrr50.toFixed(3)} | ${m.totalChunks} | ${(m.estimatedBytes / 1024).toFixed(1)} KB |`,
    );
  }
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(`**Winner (PROVISIONAL): \`${winner.name}\`** — recall@10 = ${(winner.recallAt10 * 100).toFixed(1)}%, MRR@50 = ${winner.mrr50.toFixed(3)}.`);
  lines.push('');
  lines.push('## Downstream configuration for plan 07-02');
  lines.push('');
  if (winner.name === 'A-per-message') {
    lines.push('- chunk size: 1 chunk per SourceDoc, tail-clip at 4000 tokens (~16 000 chars).');
    lines.push('- overlap: n/a.');
    lines.push('- boundary respect: none (single-chunk strategy).');
  } else if (winner.name === 'B-per-thread') {
    lines.push('- chunk size: 1 chunk per parentRef, 4000-token budget with start-and-end retention (sentinel `…[truncated]…`).');
    lines.push('- overlap: n/a (rolled chunks).');
    lines.push('- boundary respect: parentRef grouping owned by indexer.');
  } else {
    lines.push('- chunk size: ~512 tokens (~2 048 chars).');
    lines.push('- overlap: ~64 tokens.');
    lines.push('- boundary respect: transcript segments > paragraphs (`\\n\\n`) > sentences (`. `).');
  }
  lines.push('');
  lines.push('## Per-question detail');
  lines.push('');
  for (const m of metrics) {
    lines.push(`### ${m.name}`);
    lines.push('');
    lines.push('| qid | foundRank | overlap@10 |');
    lines.push('| --- | --- | --- |');
    for (const q of m.perQuestion) {
      lines.push(`| ${q.qid} | ${q.foundRank ?? '—'} | ${q.overlapInTop10 ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
