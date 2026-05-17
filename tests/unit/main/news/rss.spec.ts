/**
 * Plan 02-03 Task 1 — fetchRssFeed cases.
 */
import { describe, it, expect } from 'vitest';
import { fetchRssFeed } from '../../../../src/main/news/rss';
import { NewsSourceError } from '../../../../src/main/news/hn';

const FEED_URL = 'https://example.com/feed.xml';

function makeParserStub(feed: {
  items?: Array<{ title?: string; link?: string; guid?: string; pubDate?: string; isoDate?: string }>;
  feedUrl?: string;
}) {
  return {
    parseURL: async (_url: string) => feed,
  };
}

describe('fetchRssFeed', () => {
  it('parses entries; resolves relative <link> against feed URL (Pitfall 17)', async () => {
    const parserImpl = makeParserStub({
      feedUrl: FEED_URL,
      items: [
        { title: 'Absolute', link: 'https://example.com/articles/absolute-one', guid: 'abs-1', isoDate: '2026-05-12T12:00:00.000Z' },
        { title: 'Relative', link: '/article/123', guid: 'rel-1', isoDate: '2026-05-12T13:00:00.000Z' },
      ],
    });
    const out = await fetchRssFeed({ url: FEED_URL, limit: 10, parserImpl });
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('https://example.com/articles/absolute-one');
    // Pitfall 17: relative link resolved to absolute
    expect(out[1].url).toBe('https://example.com/article/123');
    for (const c of out) expect(c.id.startsWith('rss-')).toBe(true);
  });

  it('throws NewsSourceError({source:"rss"}) on timeout', async () => {
    const parserImpl = {
      parseURL: () => new Promise<never>(() => { /* never resolves */ }),
    };
    await expect(
      fetchRssFeed({ url: FEED_URL, limit: 5, timeoutMs: 25, parserImpl }),
    ).rejects.toBeInstanceOf(NewsSourceError);
  });

  it('empty feed → returns []', async () => {
    const parserImpl = makeParserStub({ feedUrl: FEED_URL, items: [] });
    const out = await fetchRssFeed({ url: FEED_URL, limit: 5, parserImpl });
    expect(out).toEqual([]);
  });

  it('id derivation is deterministic across runs', async () => {
    const parserImpl = makeParserStub({
      feedUrl: FEED_URL,
      items: [{ title: 'Stable', link: 'https://example.com/x', guid: 'stable-guid', isoDate: '2026-05-12T12:00:00.000Z' }],
    });
    const a = await fetchRssFeed({ url: FEED_URL, limit: 1, parserImpl });
    const b = await fetchRssFeed({ url: FEED_URL, limit: 1, parserImpl });
    expect(a[0].id).toEqual(b[0].id);
  });
});
