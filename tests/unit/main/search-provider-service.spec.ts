/**
 * Phase 11 — SearchProviderService unit tests.
 *
 * Uses MSW (or vi.spyOn(global, 'fetch')) to mock HTTP responses.
 * Tests: searchBrave, searchExa, fetchWithJina, deduplicateByUrl
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  searchBrave,
  searchExa,
  fetchWithJina,
  deduplicateByUrl,
} from '../../../src/main/services/SearchProviderService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchBrave', () => {
  it('returns results on HTTP 200 happy path', async () => {
    const mockResults = [
      { url: 'https://example.com/a', title: 'Article A', description: 'Desc A' },
      { url: 'https://example.com/b', title: 'Article B', description: 'Desc B' },
    ];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: mockResults } }), { status: 200 }),
    );
    const results = await searchBrave('test query', 'fake-api-key', 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://example.com/a');
  });

  it('returns [] on non-200 status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );
    const results = await searchBrave('test query', 'fake-api-key');
    expect(results).toEqual([]);
  });

  it('retries once on HTTP 429 then returns results', async () => {
    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ web: { results: [{ url: 'https://x.com', title: 'X', description: '' }] } }),
          { status: 200 },
        ),
      );
    const results = await searchBrave('query', 'key');
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns [] when fetch throws (network error)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));
    const results = await searchBrave('query', 'key');
    expect(results).toEqual([]);
  });
});

describe('searchExa', () => {
  it('returns results on HTTP 200 happy path', async () => {
    const mockResults = [
      { url: 'https://exa.com/1', title: 'Exa Result 1', text: 'Some text' },
    ];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: mockResults }), { status: 200 }),
    );
    const results = await searchExa('AI research', 'exa-key');
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://exa.com/1');
  });

  it('returns [] on non-200 status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );
    const results = await searchExa('query', 'bad-key');
    expect(results).toEqual([]);
  });

  it('retries once on HTTP 429 then returns []', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('Still limited', { status: 429 }));
    const results = await searchExa('query', 'key');
    expect(results).toEqual([]);
  });

  it('returns [] when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
    const results = await searchExa('query', 'key');
    expect(results).toEqual([]);
  });
});

describe('fetchWithJina', () => {
  it('returns text content on HTTP 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('# Article\n\nContent here.', { status: 200 }),
    );
    const content = await fetchWithJina('https://example.com/article');
    expect(content).toBe('# Article\n\nContent here.');
  });

  it('returns null on non-200 status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );
    const content = await fetchWithJina('https://example.com/missing');
    expect(content).toBeNull();
  });

  it('returns null on timeout / AbortError', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    );
    const content = await fetchWithJina('https://slow-site.example.com');
    expect(content).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const content = await fetchWithJina('https://unreachable.example.com');
    expect(content).toBeNull();
  });
});

describe('deduplicateByUrl', () => {
  it('removes exact URL duplicates, keeping last entry', () => {
    const input = [
      { url: 'https://a.com', title: 'First' },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'Second' },
    ];
    const result = deduplicateByUrl(input);
    expect(result).toHaveLength(2);
    // Map keeps the last value for each key
    expect(result.find((r) => r.url === 'https://a.com')?.title).toBe('Second');
  });

  it('returns same array when no duplicates', () => {
    const input = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ];
    const result = deduplicateByUrl(input);
    expect(result).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(deduplicateByUrl([])).toEqual([]);
  });
});
