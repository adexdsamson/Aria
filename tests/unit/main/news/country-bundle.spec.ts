/**
 * Plan 02-03 Task 1 — country-bundle cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadBundle, fetchBundleCandidates } from '../../../../src/main/news/country-bundle';
import type { NewsCandidate } from '../../../../src/main/news/hn';

describe('loadBundle', () => {
  it("'NG' returns ng.json contents (country=NG, >=3 feeds)", () => {
    const b = loadBundle('NG');
    expect(b.country).toBe('NG');
    expect(b.feeds.length).toBeGreaterThanOrEqual(3);
    for (const f of b.feeds) {
      expect(typeof f.url).toBe('string');
      expect(typeof f.sector).toBe('string');
    }
  });

  it("L1 forward-compat: unknown country (e.g. 'XX') returns {country, feeds: []} without throwing", () => {
    expect(() => loadBundle('XX')).not.toThrow();
    expect(loadBundle('XX')).toEqual({ country: 'XX', feeds: [] });
    expect(loadBundle('US')).toEqual({ country: 'US', feeds: [] });
  });
});

describe('fetchBundleCandidates', () => {
  it("NG/finance with one fulfilled + one rejected feed → returns fulfilled's items only (Promise.allSettled)", async () => {
    const success: NewsCandidate[] = [
      { id: 'rss-a1', title: 'A1', url: 'https://a/1', postedAt: '2026-05-12T00:00:00.000Z' },
      { id: 'rss-a2', title: 'A2', url: 'https://a/2', postedAt: '2026-05-12T01:00:00.000Z' },
    ];
    let call = 0;
    const fetchFeed = async (_url: string): Promise<NewsCandidate[]> => {
      call++;
      if (call === 1) return success;
      throw new Error('boom');
    };
    const logger = { warn: vi.fn() };
    const out = await fetchBundleCandidates({
      country: 'NG',
      sectors: ['finance'],
      limit: 10,
      fetchFeed,
      logger,
    });
    expect(out).toEqual(success);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('sector filtering: picks gov only → fetches gov-tagged feeds only', async () => {
    const ng = loadBundle('NG');
    const govFeedCount = ng.feeds.filter((f) => f.sector === 'gov').length;
    const seen: string[] = [];
    const fetchFeed = async (url: string): Promise<NewsCandidate[]> => {
      seen.push(url);
      return [];
    };
    await fetchBundleCandidates({ country: 'NG', sectors: ['gov'], limit: 5, fetchFeed });
    expect(seen).toHaveLength(govFeedCount);
    // none of the urls should be a non-gov feed
    const govUrls = new Set(ng.feeds.filter((f) => f.sector === 'gov').map((f) => f.url));
    for (const u of seen) expect(govUrls.has(u)).toBe(true);
  });

  it('unknown country returns [] without throwing or fetching', async () => {
    const fetchFeed = vi.fn();
    const out = await fetchBundleCandidates({
      country: 'XX',
      sectors: ['gov'],
      limit: 5,
      fetchFeed: fetchFeed as unknown as (u: string) => Promise<NewsCandidate[]>,
    });
    expect(out).toEqual([]);
    expect(fetchFeed).not.toHaveBeenCalled();
  });
});
