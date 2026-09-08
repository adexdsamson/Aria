# Benchmarks

Measured numbers for Aria's retrieval and privacy-routing paths.

```bash
pnpm bench          # offline. No Ollama, no network, reproducible by anyone.
pnpm bench:quick    # smaller corpus, fewer repeats. Fast inner loop.
pnpm bench:live     # adds the end-to-end routing split. Requires Ollama.
```

Output goes to `bench/results/latest.json` (machine-readable) and
`bench/results/latest.md` (paste-ready for the root README). The markdown is
also printed to stdout.

## Why this exists

Two claims sit at the centre of this project: that retrieval is good enough to
answer questions over a personal corpus, and that the privacy routing keeps
sensitive work on the machine. Both were assertions. This directory turns them
into numbers that anyone can re-run.

The design constraint that shapes everything here: **no figure may depend on a
real vault.** Every input is synthetic and committed to the repo, so the results
are publishable and reproducible by a stranger who clones the project.

## What is measured

### Retrieval (`retrieval.bench.ts`)

Three strategies on one corpus, two query forms each:

| | |
|---|---|
| `bm25` | lexical only, `src/main/rag/bm25-search.ts` |
| `vector` | dense only, `vectorSearch` over `BruteForceStore` |
| `hybrid` | RRF fusion, `src/main/rag/hybrid-retrieval.ts`, the shipped path |

Query forms are `natural` (a full question, as asked of an assistant) and
`keywords` (what someone types into a search box). Splitting them is the point,
not a detail: see Findings below.

Metrics are recall@10, precision@10, MRR and nDCG@10 over binary relevance
judgements, plus nearest-rank latency percentiles so a reported p95 is always a
value actually observed.

### Privacy routing (`routing.bench.ts`)

Offline mode exercises the pure regex prefilter, `classifySensitivity`. It
reports PII detection rate, the false-positive rate on benign prompts, and how
much of the category work (financial, legal, hr) the regex catches. That last
number is expected to be near zero and is recorded to document where
responsibility sits, not to grade stage 1.

Live mode exercises `decideHybridRoute` end to end and reports the three-way
`local` / `hybrid` / `frontier` split. **`neverSentRaw` is the headline number
for a local-first product**: the share of work that never leaves the machine in
the clear. It requires a running Ollama daemon and is skipped cleanly without
one.

## Methodology and its limits

Read these before quoting any figure.

**The corpus is synthetic and topic-clustered.** 12 topics, 40 chunks each plus
200 distractors, generated from a fixed seed (`20260908`) so the corpus is
byte-identical on every run. Each chunk belongs to exactly one topic and a
topic's query is judged relevant to precisely that topic's chunks. That yields
clean binary judgements without human labelling, at the cost of being an easier
task than real email: there is no topic drift and no near-duplicate across
topics. **Absolute scores are an upper bound. The comparison between rows is
what the numbers are for.**

**The offline embedder is not a neural model.** `lib/fake-embed.ts` is a hashing
vectorizer: tokenise, hash into 768 buckets with three hash functions, sublinear
term-frequency weight, L2 normalise. Similarity therefore tracks lexical overlap
only. Offline vector and hybrid quality is a **floor** on what the real Ollama
embedding model achieves, never a prediction of it. Offline vector latency
likewise excludes a real embedding call and is a floor.

**Recall@10 has a ceiling below 1.0.** With 40 relevant chunks per topic and
k=10, the maximum attainable recall@10 is 0.25. A figure near 0.24 is
near-optimal, not poor. precision@10, MRR and nDCG@10 are the unbounded signals.

**Latency is machine-specific.** Every report embeds the platform, CPU, core
count, memory and Node version it was produced on. Do not compare figures across
machines.

**The prompt corpus is small.** 18 labelled prompts. Enough to catch a
regression in the routing contract, not enough to characterise classifier
quality. Treat routing percentages as a contract check, not a benchmark score.

## Findings

Things the harness surfaced that were not visible before.

### Natural-language queries return zero BM25 hits

`buildFtsMatchExpr` joins every surviving token with FTS5 implicit AND, so
`"what is the status of the Q3 budget approval"` becomes
`"what" "is" "the" "status" "of" "the" "q3" "budget" "approval"` and matches only
a chunk containing all nine words, stopwords included. No chunk does.

Consequence: on conversational queries BM25 contributes nothing and
`hybridRetrieve` silently degrades to vector-only. The RRF fusion does no work
in exactly the case the `/ask` UX generates. It is visible in the results table
as identical `natural | vector` and `natural | hybrid` rows, against a
`keywords | bm25` row that scores precision@10 of 1.00.

The degradation is silent because `hybridRetrieve` only logs a fallback when the
*vector* path throws. An empty BM25 result set is indistinguishable from a
legitimate no-match.

Worth considering: OR-ing the terms with a minimum-should-match, dropping
stopwords before building the expression, or treating an empty BM25 result on a
multi-token query as a signal to retry with a relaxed expression.

### The phone regex requires a full 3-3-4 number

Not a bug, but worth recording because it cost a debugging cycle. The block
comment above `DEFAULT_PII_PATTERNS` in `src/main/log/redact.ts` says the phone
pattern matches "~10+ contiguous digits" and "7-15 digits total", while the
regex requires an optional country code followed by a 3-3-4 group, so exactly 10
digits. A 7-digit local number such as `+1 555 0100` is not matched. The
behaviour is correct and deliberately permissive as documented; the "7-15
digits" phrasing in the comment is what misleads.

## Adding to the corpus

New retrieval topic: append to `TOPICS` in `lib/corpus.ts` with a `query`, a
`keywords` form and 5 to 8 distinctive `terms`. Judgements are derived
automatically.

New routing prompt: append to `PROMPTS` in `lib/prompts.ts` with the `expect`
label the privacy contract requires. Use RFC-5737 or RFC-2606 reserved ranges
for any identifier so nothing resembling real personal data enters the repo.

Changing `chunksPerTopic` moves the recall@10 ceiling. The report recalculates
and states it, but historical figures are not comparable across that change.
