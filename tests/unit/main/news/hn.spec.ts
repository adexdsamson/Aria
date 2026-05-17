/**
 * Plan 02-03 Task 1 — fetchHnTopStories cases.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fetchHnTopStories, NewsSourceError } from '../../../../src/main/news/hn';
import { restoreFetch } from '../../../setup';

afterEach(() => {
  restoreFetch();
});

describe('fetchHnTopStories', () => {
  it('returns N normalized rows when topstories + items resolve', async () => {
    const topIds = [101, 102, 103, 104, 105];
    const items: Record<number, { id: number; title: string; url: string; time: number }> = {
      101: { id: 101, title: 'Story A', url: 'https://a.example/1', time: 1715000000 },
      102: { id: 102, title: 'Story B', url: 'https://b.example/2', time: 1715000100 },
      103: { id: 103, title: 'Story C', url: 'https://c.example/3', time: 1715000200 },
      104: { id: 104, title: 'Story D', url: 'https://d.example/4', time: 1715000300 },
      105: { id: 105, title: 'Story E', url: 'https://e.example/5', time: 1715000400 },
    };
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('topstories.json')) {
        return { ok: true, status: 200, json: async () => topIds } as unknown as Response;
      }
      const m = url.match(/item\/(\d+)\.json/);
      if (m) {
        const id = Number(m[1]);
        return { ok: true, status: 200, json: async () => items[id] } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => null } as unknown as Response;
    }) as typeof fetch;

    const result = await fetchHnTopStories({ limit: 5, fetchImpl: fakeFetch });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.id)).toEqual(['hn-101', 'hn-102', 'hn-103', 'hn-104', 'hn-105']);
    expect(result[0]).toMatchObject({ title: 'Story A', url: 'https://a.example/1' });
    expect(result[0].postedAt).toBe(new Date(1715000000 * 1000).toISOString());
  });

  it('per-item HTTP 500 is swallowed; remaining items returned', async () => {
    const topIds = [201, 202, 203];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('topstories.json')) {
        return { ok: true, status: 200, json: async () => topIds } as unknown as Response;
      }
      if (url.includes('/item/202.')) {
        return { ok: false, status: 500, json: async () => null } as unknown as Response;
      }
      const m = url.match(/item\/(\d+)\.json/);
      const id = m ? Number(m[1]) : 0;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, title: `t${id}`, url: `https://x/${id}`, time: 1 }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await fetchHnTopStories({ limit: 3, fetchImpl: fakeFetch });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['hn-201', 'hn-203']);
  });

  it('throws NewsSourceError({source:"hn"}) when topstories.json fails', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await expect(fetchHnTopStories({ limit: 5, fetchImpl: fakeFetch })).rejects.toBeInstanceOf(NewsSourceError);
    try {
      await fetchHnTopStories({ limit: 5, fetchImpl: fakeFetch });
    } catch (err) {
      expect((err as NewsSourceError).source).toBe('hn');
    }
  });
});
