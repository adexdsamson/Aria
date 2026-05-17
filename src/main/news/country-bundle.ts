/**
 * Plan 02-03 — Country-bundle loader + multi-feed gatherer.
 *
 * `loadBundle(country)` returns the JSON contents of `bundles/<country>.json`
 * when one ships (v1: only `'NG'`); any other country returns the L1-pinned
 * forward-compat shape `{ country, feeds: [] }` so the picker UI can offer
 * "more countries coming soon" without crashing the briefing gatherer.
 *
 * `fetchBundleCandidates({country, sectors, limit})` filters feeds by sector
 * intersection, calls `fetchRssFeed` per feed via `Promise.allSettled` (one
 * bad feed never blocks the bundle), and caps the concatenated result.
 */
import ng from './bundles/ng.json';
import { fetchRssFeed } from './rss';
import type { NewsCandidate } from './hn';

export interface BundleFeed {
  url: string;
  title: string;
  sector: string;
}

export interface CountryBundle {
  country: string;
  feeds: BundleFeed[];
}

const BUNDLES: Record<string, CountryBundle> = {
  NG: ng as CountryBundle,
};

export function loadBundle(country: string): CountryBundle {
  const found = BUNDLES[country];
  if (found) return found;
  // L1 forward-compat: unknown country → empty feeds, never throw.
  return { country, feeds: [] };
}

export interface FetchBundleOptions {
  country: string;
  sectors: string[];
  limit: number;
  /** Test seam: replace per-feed fetcher. */
  fetchFeed?: (url: string) => Promise<NewsCandidate[]>;
  /** Test seam: receive warnings when a feed throws. */
  logger?: { warn: (...args: unknown[]) => void };
}

export async function fetchBundleCandidates(opts: FetchBundleOptions): Promise<NewsCandidate[]> {
  const bundle = loadBundle(opts.country);
  if (bundle.feeds.length === 0) return [];
  const sectorSet = new Set(opts.sectors);
  const selected = bundle.feeds.filter((f) => sectorSet.has(f.sector));
  if (selected.length === 0) return [];
  const fetcher = opts.fetchFeed ?? ((url: string) => fetchRssFeed({ url, limit: opts.limit }));
  const results = await Promise.allSettled(selected.map((f) => fetcher(f.url)));
  const out: NewsCandidate[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      out.push(...r.value);
    } else if (opts.logger) {
      opts.logger.warn({ scope: 'country-bundle', url: selected[i].url, err: String(r.reason) }, 'feed failed');
    }
  }
  return out.slice(0, opts.limit);
}
