/**
 * Plan 02-03 — RSS feed fetcher (rss-parser wrapper).
 *
 * Wraps `rss-parser` with a 10s timeout. Pitfall 17: relative `<link>` hrefs
 * are resolved against the feed URL BEFORE persistence; the briefing engine
 * (Plan 02-04) gets absolute URLs only.
 *
 * Throws `NewsSourceError({source:'rss'})` on parse failure or timeout. Empty
 * feeds return `[]`. Item id is derived deterministically from the feed URL
 * plus entry guid/link so re-fetching the same feed yields stable ids.
 */
import * as crypto from 'node:crypto';
import RssParser from 'rss-parser';
import { NewsSourceError, type NewsCandidate } from './hn';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchRssOptions {
  url: string;
  limit: number;
  /** Override the 10s default for tests. */
  timeoutMs?: number;
  /** Test seam: inject a parser stub (e.g. to simulate timeout). */
  parserImpl?: { parseURL: (url: string) => Promise<RssFeed> };
}

interface RssEntry {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
}

interface RssFeed {
  items?: RssEntry[];
  feedUrl?: string;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rss-timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function fetchRssFeed(opts: FetchRssOptions): Promise<NewsCandidate[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parser =
    opts.parserImpl ??
    (new RssParser({ timeout: timeoutMs }) as { parseURL: (u: string) => Promise<RssFeed> });
  let feed: RssFeed;
  try {
    feed = await withTimeout(parser.parseURL(opts.url), timeoutMs);
  } catch (err) {
    throw new NewsSourceError({ source: 'rss', cause: err });
  }
  const items = feed.items ?? [];
  const out: NewsCandidate[] = [];
  for (const entry of items.slice(0, opts.limit)) {
    if (!entry.link || !entry.title) continue;
    let resolvedHref: string;
    try {
      // Pitfall 17: resolve relative URLs against the feed URL.
      resolvedHref = new URL(entry.link, feed.feedUrl ?? opts.url).href;
    } catch {
      continue;
    }
    const idKey = `${opts.url}|${entry.guid ?? entry.link}`;
    const postedAt = entry.isoDate ?? entry.pubDate ?? new Date(0).toISOString();
    out.push({
      id: `rss-${sha256(idKey)}`,
      title: entry.title,
      url: resolvedHref,
      postedAt,
    });
  }
  return out;
}
