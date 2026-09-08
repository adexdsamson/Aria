/**
 * Bench statistics helpers.
 *
 * Latency: nearest-rank percentiles (no interpolation) so a reported p95 is
 * always a value that was actually observed.
 * Retrieval quality: recall@k, MRR, nDCG@k over binary relevance judgements.
 */

export interface LatencySummary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile. `p` in [0,1]. Returns NaN for an empty sample. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx] as number;
}

export function summarise(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { n: 0, min: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0] as number,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] as number,
    mean: sum / sorted.length,
  };
}

/** Fraction of relevant items that appear in the top-k ranking. */
export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return Number.NaN;
  const top = ranked.slice(0, k);
  let hit = 0;
  for (const id of top) if (relevant.has(id)) hit += 1;
  return hit / relevant.size;
}

/** Precision within the top-k ranking. */
export function precisionAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return Number.NaN;
  let hit = 0;
  for (const id of top) if (relevant.has(id)) hit += 1;
  return hit / top.length;
}

/** Reciprocal rank of the first relevant hit. 0 when none is retrieved. */
export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  for (let i = 0; i < ranked.length; i += 1) {
    if (relevant.has(ranked[i] as string)) return 1 / (i + 1);
  }
  return 0;
}

/** nDCG@k with binary gains and log2 discount. */
export function ndcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return Number.NaN;
  let dcg = 0;
  const top = ranked.slice(0, k);
  for (let i = 0; i < top.length; i += 1) {
    if (relevant.has(top[i] as string)) dcg += 1 / Math.log2(i + 2);
  }
  const ideal = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? Number.NaN : dcg / idcg;
}

export function mean(xs: readonly number[]): number {
  const usable = xs.filter((x) => Number.isFinite(x));
  if (usable.length === 0) return Number.NaN;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/** Monotonic high-resolution timer in milliseconds. */
export function nowMs(): number {
  const [s, ns] = process.hrtime();
  return s * 1e3 + ns / 1e6;
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = nowMs();
  const value = await fn();
  return { ms: nowMs() - t0, value };
}

export function timedSync<T>(fn: () => T): { ms: number; value: T } {
  const t0 = nowMs();
  const value = fn();
  return { ms: nowMs() - t0, value };
}
