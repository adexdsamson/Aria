import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runSpike,
  pickWinner,
  renderSpikeMarkdown,
  type EvalSet,
} from '../../../src/main/rag/chunking-spike';

const FIXTURE = path.resolve(__dirname, '../../../tests/fixtures/rag/eval-qa-set.json');
const SPIKE_OUT = path.resolve(
  __dirname,
  '../../../.planning/phases/07-rag-q-a/07-SPIKE-CHUNKING.md',
);

describe('chunking spike — Plan 07-01 Task 5', () => {
  const fixtureRaw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as EvalSet & {
    _comment?: unknown;
  };
  const evalSet: EvalSet = { sources: fixtureRaw.sources, questions: fixtureRaw.questions };

  it('eval set is well-formed', () => {
    expect(evalSet.sources.length).toBeGreaterThanOrEqual(20);
    expect(evalSet.questions).toHaveLength(20);
    // every question's sourceId resolves to a fixture row
    const ids = new Set(evalSet.sources.map((s) => s.sourceId));
    for (const q of evalSet.questions) {
      expect(ids.has(q.ground_truth.sourceId)).toBe(true);
    }
    // 5 per corpus
    const counts: Record<string, number> = {};
    for (const q of evalSet.questions) counts[q.corpus] = (counts[q.corpus] ?? 0) + 1;
    expect(counts.email).toBe(5);
    expect(counts.event).toBe(5);
    expect(counts.note).toBe(5);
    expect(counts.action).toBe(5);
    // explicit-person coverage: ≥1 per corpus
    const personByCorpus: Record<string, number> = {};
    for (const q of evalSet.questions) {
      if (q.explicit_person) personByCorpus[q.corpus] = (personByCorpus[q.corpus] ?? 0) + 1;
    }
    for (const c of ['email', 'event', 'note', 'action']) {
      expect(personByCorpus[c] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('spike runs end-to-end, picks a winner, writes 07-SPIKE-CHUNKING.md when gated', () => {
    const metrics = runSpike(evalSet);
    expect(metrics).toHaveLength(3);
    for (const m of metrics) {
      expect(m.totalChunks).toBeGreaterThan(0);
      expect(m.recallAt10).toBeGreaterThanOrEqual(0);
      expect(m.recallAt10).toBeLessThanOrEqual(1);
      expect(m.perQuestion).toHaveLength(20);
    }
    const winner = pickWinner(metrics);
    expect(['A-per-message', 'B-per-thread', 'C-hybrid-token-window']).toContain(winner.name);

    const md = renderSpikeMarkdown(metrics, winner, evalSet.questions.length, evalSet.sources.length);
    expect(md).toContain('# 07-SPIKE-CHUNKING.md');
    expect(md).toContain('Winner');
    expect(md).toContain(winner.name);

    if (process.env.RAG_SPIKE_WRITE === '1') {
      fs.writeFileSync(SPIKE_OUT, md, 'utf8');
    }
  });
});
