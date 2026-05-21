/**
 * Phase 11 — SearchProviderService.
 *
 * Wraps Brave Search API, Exa API, and Jina Reader (r.jina.ai) for the
 * ResearchService pipeline. Each provider degrades gracefully: HTTP errors or
 * network timeouts return [] / null rather than throwing so the pipeline can
 * continue with whatever subset of providers responded.
 *
 * Retry policy: HTTP 429 → wait 2s → one retry; any other non-OK status or
 * network error → return [] / null immediately.
 */

export interface BraveResult {
  url: string;
  title: string;
  description: string;
}

export interface ExaResult {
  url: string;
  title: string;
  text?: string;
}

/**
 * Search Brave Web Search API.
 * Returns top `count` results or [] on any error.
 */
export async function searchBrave(
  query: string,
  apiKey: string,
  count = 5,
): Promise<BraveResult[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
        { headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' } },
      );
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) return [];
      const data = await res.json() as { web?: { results?: BraveResult[] } };
      return data.web?.results ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Search Exa (semantic/neural) API.
 * Returns top `numResults` results or [] on any error.
 */
export async function searchExa(
  query: string,
  apiKey: string,
  numResults = 5,
): Promise<ExaResult[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type: 'neural', numResults }),
      });
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) return [];
      const data = await res.json() as { results?: ExaResult[] };
      return data.results ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fetch clean markdown for a URL via Jina Reader (r.jina.ai).
 * Uses a 10s AbortSignal timeout. Returns null on timeout, non-200, or error.
 */
export async function fetchWithJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'text/markdown' },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null; // timeout or network — skip URL, continue run
  }
}

/**
 * Deduplicate search results by URL. Last entry for each URL wins.
 */
export function deduplicateByUrl<T extends { url: string }>(results: T[]): T[] {
  return [...new Map(results.map((r) => [r.url, r])).values()];
}
