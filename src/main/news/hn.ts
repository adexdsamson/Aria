/**
 * Plan 02-03 — Hacker News top-stories fetcher.
 *
 * GETs https://hacker-news.firebaseio.com/v0/topstories.json, then fetches
 * the first `limit` story items at concurrency=4. Per-item failures are
 * swallowed (Promise.allSettled); a failure of the index endpoint throws
 * `NewsSourceError({source:'hn'})`.
 *
 * No auth, no SDK — just `fetch`. Returns normalized rows that the briefing
 * engine (Plan 02-04) will rank.
 */

export interface NewsCandidate {
  /** Stable per-source id; format: `<sourceKind>-<innerId>`. */
  id: string;
  title: string;
  url: string;
  postedAt: string;
}

export class NewsSourceError extends Error {
  readonly source: 'hn' | 'rss' | 'bundle';
  constructor(opts: { source: 'hn' | 'rss' | 'bundle'; cause?: unknown }) {
    super(`news-source-failed:${opts.source}`);
    this.name = 'NewsSourceError';
    this.source = opts.source;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

const HN_TOPSTORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const HN_ITEM_URL = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const ITEM_CONCURRENCY = 4;

interface HnItem {
  id: number;
  title?: string;
  url?: string;
  time?: number; // unix seconds
  type?: string;
}

export interface FetchHnOptions {
  limit: number;
  /** Test seam: replace global fetch. */
  fetchImpl?: typeof fetch;
}

export async function fetchHnTopStories(opts: FetchHnOptions): Promise<NewsCandidate[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let topIds: number[];
  try {
    const res = await fetchImpl(HN_TOPSTORIES_URL);
    if (!res.ok) throw new Error(`topstories http ${res.status}`);
    topIds = (await res.json()) as number[];
  } catch (err) {
    throw new NewsSourceError({ source: 'hn', cause: err });
  }
  const subset = topIds.slice(0, opts.limit);
  // Concurrency-bounded fan-out via simple worker pool.
  const results: Array<NewsCandidate | null> = new Array(subset.length).fill(null);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= subset.length) return;
      const storyId = subset[i];
      try {
        const r = await fetchImpl(HN_ITEM_URL(storyId));
        if (!r.ok) continue;
        const item = (await r.json()) as HnItem | null;
        if (!item || !item.title) continue;
        results[i] = {
          id: `hn-${item.id}`,
          title: item.title,
          url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
          postedAt: item.time ? new Date(item.time * 1000).toISOString() : new Date(0).toISOString(),
        };
      } catch {
        // Per-item errors are swallowed; remaining successful items returned.
      }
    }
  }
  const workers = Array.from({ length: Math.min(ITEM_CONCURRENCY, subset.length) }, () => worker());
  await Promise.allSettled(workers);
  return results.filter((x): x is NewsCandidate => x !== null);
}
