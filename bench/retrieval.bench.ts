/**
 * Offline retrieval bench.
 *
 * Measures three strategies on the same synthetic corpus and the same queries:
 *   bm25    — lexical only  (src/main/rag/bm25-search.ts)
 *   vector  — dense only    (vectorSearch + BruteForceStore)
 *   hybrid  — RRF fusion    (src/main/rag/hybrid-retrieval.ts, the shipped path)
 *
 * Reports recall@10, precision@10, MRR, nDCG@10 and per-query latency
 * percentiles for each. The point is the DELTA between strategies: it shows
 * whether fusion actually earns its complexity on this corpus.
 *
 * Runs with no network, no Ollama and no model download. The embedder is a
 * hashing vectorizer (see lib/fake-embed.ts) so quality figures are a floor,
 * not a prediction of the real model. Latency for the vector path is likewise
 * a floor: a real embedding call dominates it. Both caveats are printed with
 * the results so a reader cannot mistake one for the other.
 */
import { bm25Search } from '../src/main/rag/bm25-search';
import { hybridRetrieve, vectorSearch } from '../src/main/rag/hybrid-retrieval';
import { getVectorStore } from '../src/main/rag/vector-store';
import { buildCorpus, TOPICS, type Corpus } from './lib/corpus';
import { createOfflineEmbedClient } from './lib/fake-embed';
import {
  mean, ndcgAtK, precisionAtK, recallAtK, reciprocalRank, summarise, timed, timedSync,
  type LatencySummary,
} from './lib/stats';

export type QueryForm = 'natural' | 'keywords';

export interface StrategyResult {
  strategy: 'bm25' | 'vector' | 'hybrid';
  queryForm: QueryForm;
  recallAt10: number;
  precisionAt10: number;
  mrr: number;
  ndcgAt10: number;
  latencyMs: LatencySummary;
}

export interface RetrievalBenchResult {
  corpus: { totalChunks: number; topics: number; chunksPerTopic: number; dim: number; modelId: string };
  vectorBackend: string;
  queries: number;
  repeats: number;
  strategies: StrategyResult[];
}

const TOP_K = 10;

async function runStrategy(
  corpus: Corpus,
  strategy: 'bm25' | 'vector' | 'hybrid',
  queryForm: QueryForm,
  repeats: number,
): Promise<StrategyResult> {
  const embedClient = createOfflineEmbedClient(corpus.dim);
  const vectorStore = getVectorStore(corpus.db, { force: 'fallback' });
  const deps = { db: corpus.db, embedClient, vectorStore };

  const latencies: number[] = [];
  const recalls: number[] = [];
  const precisions: number[] = [];
  const rrs: number[] = [];
  const ndcgs: number[] = [];

  for (const topic of TOPICS) {
    const relevant = corpus.judgements.get(topic.key);
    if (!relevant) continue;
    const qtext = queryForm === 'natural' ? topic.query : topic.keywords;

    let ranked: string[] = [];
    for (let rep = 0; rep < repeats; rep += 1) {
      if (strategy === 'bm25') {
        const { ms, value } = timedSync(() => bm25Search(corpus.db, qtext, { k: TOP_K }));
        latencies.push(ms);
        ranked = value.map((h) => h.chunkId);
      } else if (strategy === 'vector') {
        const { ms, value } = await timed(() =>
          vectorSearch(embedClient, vectorStore, qtext, TOP_K),
        );
        latencies.push(ms);
        ranked = value.map((h) => h.chunkId);
      } else {
        const { ms, value } = await timed(() =>
          hybridRetrieve(deps, qtext, { topK: TOP_K }),
        );
        latencies.push(ms);
        ranked = value.map((c) => c.id);
      }
    }

    recalls.push(recallAtK(ranked, relevant, TOP_K));
    precisions.push(precisionAtK(ranked, relevant, TOP_K));
    rrs.push(reciprocalRank(ranked, relevant));
    ndcgs.push(ndcgAtK(ranked, relevant, TOP_K));
  }

  return {
    strategy,
    queryForm,
    recallAt10: mean(recalls),
    precisionAt10: mean(precisions),
    mrr: mean(rrs),
    ndcgAt10: mean(ndcgs),
    latencyMs: summarise(latencies),
  };
}

export async function runRetrievalBench(
  opts: { chunksPerTopic?: number; distractors?: number; repeats?: number } = {},
): Promise<RetrievalBenchResult> {
  const repeats = opts.repeats ?? 20;
  const corpus = buildCorpus({
    chunksPerTopic: opts.chunksPerTopic ?? 40,
    distractors: opts.distractors ?? 200,
  });
  try {
    const backend = getVectorStore(corpus.db, { force: 'fallback' }).backendName();
    const strategies: StrategyResult[] = [];
    for (const form of ['natural', 'keywords'] as const) {
      for (const s of ['bm25', 'vector', 'hybrid'] as const) {
        strategies.push(await runStrategy(corpus, s, form, repeats));
      }
    }
    return {
      corpus: {
        totalChunks: corpus.totalChunks,
        topics: TOPICS.length,
        chunksPerTopic: opts.chunksPerTopic ?? 40,
        dim: corpus.dim,
        modelId: corpus.modelId,
      },
      vectorBackend: backend,
      queries: TOPICS.length,
      repeats,
      strategies,
    };
  } finally {
    corpus.close();
  }
}
