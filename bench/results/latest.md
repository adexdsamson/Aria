## Benchmarks

Generated 2026-09-08 on win32/x64, 8 vCPU, 7.8 GB, Node v22.23.0.
Reproduce with `pnpm bench`. Every figure below comes from synthetic data committed to this repo, never from a user vault.

### Retrieval

Corpus: 680 chunks across 12 topics, 12 queries, 20 repeats per query. Vector backend: `fallback`.

**Read recall@10 against its ceiling.** Each topic has 40 relevant chunks and k is 10, so the maximum attainable recall@10 is 0.25. A figure near that is near-optimal, not poor. precision@10, MRR and nDCG@10 are the unbounded quality signals here.

| Query form | Strategy | recall@10 | precision@10 | MRR | nDCG@10 | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|
| natural | bm25 | 0.00 | n/a | 0.00 | 0.00 | 0.243 | 0.430 |
| natural | vector | 0.16 | 0.64 | 0.96 | 0.72 | 14.19 | 23.27 |
| natural | hybrid | 0.16 | 0.64 | 0.96 | 0.72 | 14.06 | 23.30 |
| keywords | bm25 | 0.17 | 1.00 | 1.00 | 0.78 | 0.155 | 0.308 |
| keywords | vector | 0.24 | 0.96 | 1.00 | 0.97 | 12.25 | 15.46 |
| keywords | hybrid | 0.24 | 0.97 | 1.00 | 0.98 | 13.12 | 18.23 |

**Query form matters more than strategy.** `natural` is a full question ("what is the status of the Q3 budget approval"); `keywords` is what someone types into a search box ("budget approval"). `buildFtsMatchExpr` joins every surviving token with FTS5 implicit AND, so a natural-language question only matches a chunk containing *all* of its words, stopwords included. On natural queries BM25 therefore returns nothing and hybrid silently degrades to vector-only, which is visible as identical vector and hybrid rows.

> The offline embedder is a hashing vectorizer, not a neural model, so vector and hybrid quality here are a **floor** rather than a prediction of the shipped Ollama model. Vector latency excludes a real embedding call and is likewise a floor. The comparison between rows is the useful signal.

### Privacy routing, prefilter

| Metric | Value |
|---|---|
| Prompts in corpus | 18 |
| PII prompts caught by regex prefilter | 100.0% |
| Benign prompts flagged anyway | 0.0% |
| Category prompts (financial/legal/hr) caught by regex | 0.0% |
| Classify latency p50 / p95 | 4.4e-3 / 7.3e-3 ms |

> Stage 1 is a regex PII prefilter, so PII detection is the number it should be held to. The last row is deliberately low: financial, legal and hr are semantic judgements made by the LLM classifier at stage 2, and this row documents where the responsibility sits rather than grading the regex. A PII miss, by contrast, is a privacy gap.

### Privacy routing, end to end

_Not measured. Reason: `ollama-unreachable`._

- **What happened:** nothing listening on http://127.0.0.1:11434 (ECONNREFUSED)
- **What fixes it:** Start the Ollama daemon (`ollama serve`), then retry.

