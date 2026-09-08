/**
 * Deterministic offline embedder: a hashing vectorizer.
 *
 * WHY THIS EXISTS. The live bench measures the real Ollama embedding model.
 * That requires a running daemon and a downloaded model, so nobody else can
 * reproduce the numbers. This embedder makes the offline bench reproducible
 * by anyone who clones the repo: same input, same vector, no network, no
 * model download, no GPU.
 *
 * WHAT IT IS NOT. It has no learned semantics. Similarity here tracks lexical
 * overlap only, so offline vector-recall is a FLOOR on what a real embedding
 * model achieves, never a prediction of it. Report the two separately and
 * never present an offline figure as the product's retrieval quality.
 *
 * Method: tokenise, hash each token into `dim` buckets with three independent
 * hash functions, accumulate sublinear term-frequency weight, L2-normalise.
 */

export const OFFLINE_EMBED_DIM = 768;
export const OFFLINE_EMBED_ID = 'offline-hashing-vectorizer:v1';

function fnv1a(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

export function embedText(text: string, dim = OFFLINE_EMBED_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const counts = new Map<string, number>();
  for (const tok of tokenise(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);

  for (const [tok, tf] of counts) {
    // Sublinear tf, the standard damping so one repeated word cannot dominate.
    const w = 1 + Math.log(tf);
    for (const seed of [0, 0x9e3779b9, 0x85ebca6b]) {
      const h = fnv1a(tok, seed);
      const idx = h % dim;
      // Sign from a spare bit keeps collisions from systematically inflating
      // similarity, which is the usual failure of naive hashing vectorizers.
      const sign = (h >>> 31) & 1 ? -1 : 1;
      vec[idx] = (vec[idx] as number) + sign * w;
    }
  }

  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += (vec[i] as number) ** 2;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i += 1) vec[i] = (vec[i] as number) / norm;
  return vec;
}

/** Satisfies the EmbedClient interface in src/main/rag/hybrid-retrieval.ts. */
export function createOfflineEmbedClient(dim = OFFLINE_EMBED_DIM): {
  embed(texts: string[]): Promise<Float32Array[]>;
} {
  return {
    embed(texts: string[]): Promise<Float32Array[]> {
      return Promise.resolve(texts.map((t) => embedText(t, dim)));
    },
  };
}
