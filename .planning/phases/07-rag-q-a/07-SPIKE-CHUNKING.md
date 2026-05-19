# 07-SPIKE-CHUNKING.md

> **Synthetic-fixture spike.** Authored under user override on 2026-05-19.
> The chunking-strategy decision below is **PROVISIONAL**. Replace with a
> user-authored fixture against real local DB rows before relying on
> 07-02 / 07-03's chunk-size choices in production. See 07-01-SUMMARY.md
> `Deferred / Followups`.

## Methodology

- Eval set: 20 synthetic questions over 20 synthetic sources, 5 questions/corpus (email / event / note / action).
- Retrieval: in-process token-overlap inverted index, length-penalized score. No FTS5, no vector — that's plan 07-02's job; the spike measures *chunk-shape effect on recall* only.
- Ground truth: each question carries `{sourceId, charStart, charEnd}` from the fixture. A top-10 chunk is a hit iff it shares `sourceId` AND its `[charStart,charEnd)` overlaps the labeled span.
- Metrics: `recall@10` (fraction of questions with a hit in top-10) and `MRR@50` (mean reciprocal rank of the first hit in top-50).
- LLM-judge sanity check (RESEARCH §7) gated behind `RAG_SPIKE_LLM_JUDGE=1` — DEFERRED to real-fixture replacement; current run is recall/MRR only.

## Results

| Strategy | recall@10 | MRR@50 | Total chunks | Est. storage |
| --- | --- | --- | --- | --- |
| A-per-message | 100.0% | 0.825 | 20 | 80.0 KB |
| B-per-thread | 100.0% | 0.825 | 20 | 80.0 KB |
| C-hybrid-token-window | 100.0% | 0.825 | 20 | 80.0 KB |

## Decision

**Winner (PROVISIONAL): `A-per-message`** — recall@10 = 100.0%, MRR@50 = 0.825.

## Downstream configuration for plan 07-02

- chunk size: 1 chunk per SourceDoc, tail-clip at 4000 tokens (~16 000 chars).
- overlap: n/a.
- boundary respect: none (single-chunk strategy).

## Per-question detail

### A-per-message

| qid | foundRank | overlap@10 |
| --- | --- | --- |
| q-email-01 | 1 | yes |
| q-email-02 | 3 | yes |
| q-email-03 | 1 | yes |
| q-email-04 | 3 | yes |
| q-email-05 | 1 | yes |
| q-event-01 | 1 | yes |
| q-event-02 | 2 | yes |
| q-event-03 | 1 | yes |
| q-event-04 | 1 | yes |
| q-event-05 | 1 | yes |
| q-note-01 | 1 | yes |
| q-note-02 | 1 | yes |
| q-note-03 | 3 | yes |
| q-note-04 | 1 | yes |
| q-note-05 | 1 | yes |
| q-action-01 | 1 | yes |
| q-action-02 | 1 | yes |
| q-action-03 | 1 | yes |
| q-action-04 | 2 | yes |
| q-action-05 | 2 | yes |

### B-per-thread

| qid | foundRank | overlap@10 |
| --- | --- | --- |
| q-email-01 | 1 | yes |
| q-email-02 | 3 | yes |
| q-email-03 | 1 | yes |
| q-email-04 | 3 | yes |
| q-email-05 | 1 | yes |
| q-event-01 | 1 | yes |
| q-event-02 | 2 | yes |
| q-event-03 | 1 | yes |
| q-event-04 | 1 | yes |
| q-event-05 | 1 | yes |
| q-note-01 | 1 | yes |
| q-note-02 | 1 | yes |
| q-note-03 | 3 | yes |
| q-note-04 | 1 | yes |
| q-note-05 | 1 | yes |
| q-action-01 | 1 | yes |
| q-action-02 | 1 | yes |
| q-action-03 | 1 | yes |
| q-action-04 | 2 | yes |
| q-action-05 | 2 | yes |

### C-hybrid-token-window

| qid | foundRank | overlap@10 |
| --- | --- | --- |
| q-email-01 | 1 | yes |
| q-email-02 | 3 | yes |
| q-email-03 | 1 | yes |
| q-email-04 | 3 | yes |
| q-email-05 | 1 | yes |
| q-event-01 | 1 | yes |
| q-event-02 | 2 | yes |
| q-event-03 | 1 | yes |
| q-event-04 | 1 | yes |
| q-event-05 | 1 | yes |
| q-note-01 | 1 | yes |
| q-note-02 | 1 | yes |
| q-note-03 | 3 | yes |
| q-note-04 | 1 | yes |
| q-note-05 | 1 | yes |
| q-action-01 | 1 | yes |
| q-action-02 | 1 | yes |
| q-action-03 | 1 | yes |
| q-action-04 | 2 | yes |
| q-action-05 | 2 | yes |
