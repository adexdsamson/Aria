/**
 * Unit tests for probeOllama — stubs global fetch to cover the three branches
 * (reachable / unreachable / timeout).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeOllama } from '../../../../src/main/llm/ollamaProbe';

describe('probeOllama', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns reachable=true with version and models on 200 responses', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 });
      }
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'nomic-embed-text' }] }),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const status = await probeOllama();
    expect(status.reachable).toBe(true);
    expect(status.version).toBe('0.4.0');
    expect(status.models).toEqual(['llama3.1:8b', 'nomic-embed-text']);
  });

  it('returns reachable=false with error=unreachable on ECONNREFUSED', async () => {
    const fetchMock = vi.fn(async () => {
      const e = new TypeError('fetch failed');
      (e as any).cause = { code: 'ECONNREFUSED' };
      throw e;
    });
    vi.stubGlobal('fetch', fetchMock);
    const status = await probeOllama({ timeoutMs: 500 });
    expect(status.reachable).toBe(false);
    expect(status.error).toBe('unreachable');
    expect(status.models).toEqual([]);
  });

  it('returns reachable=false with error=timeout when AbortSignal fires', async () => {
    const fetchMock = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    vi.stubGlobal('fetch', fetchMock);
    const status = await probeOllama({ timeoutMs: 10 });
    expect(status.reachable).toBe(false);
    expect(status.error).toBe('timeout');
  });

  it('returns reachable=false on non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const status = await probeOllama();
    expect(status.reachable).toBe(false);
    expect(status.error).toBe('unreachable');
  });
});
