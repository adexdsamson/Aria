import { describe, it, expect, vi } from 'vitest';
import {
  createEmbedClient,
  OllamaEmbedError,
} from '../../../../src/main/rag/ollama-embeddings';

function fakeResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function unitVec(dim: number): number[] {
  const v = new Array<number>(dim);
  let s = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random();
    s += v[i]! * v[i]!;
  }
  const n = Math.sqrt(s);
  for (let i = 0; i < dim; i++) v[i] = v[i]! / n;
  return v;
}

describe('ollama-embeddings — Plan 07-02 Task 2', () => {
  it('POSTs exactly to http://127.0.0.1:11434/api/embed with the correct model', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, body: JSON.parse(init!.body as string) });
      return fakeResponse({ embeddings: [unitVec(768)] });
    }) as unknown as typeof fetch;
    const client = createEmbedClient({ fetchImpl });
    await client.embed(['hello']);
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/embed');
    expect((calls[0]!.body as { model: string }).model).toBe('nomic-embed-text:v1.5');
  });

  it('batches inputs into multiple requests at batchSize=16', async () => {
    let count = 0;
    const fetchImpl: typeof fetch = (async (_url, init?: RequestInit) => {
      count++;
      const body = JSON.parse(init!.body as string) as { input: string[] };
      const embeddings = body.input.map(() => unitVec(768));
      return fakeResponse({ embeddings });
    }) as unknown as typeof fetch;
    const client = createEmbedClient({ fetchImpl, batchSize: 16 });
    const inputs = Array.from({ length: 40 }, (_, i) => `input-${i}`);
    const out = await client.embed(inputs);
    expect(out.length).toBe(40);
    expect(count).toBe(3); // 16 + 16 + 8
  });

  it('returns L2-normalized vectors as Float32Array (no re-normalize)', async () => {
    const v = unitVec(768);
    const fetchImpl: typeof fetch = (async () => fakeResponse({ embeddings: [v] })) as unknown as typeof fetch;
    const client = createEmbedClient({ fetchImpl });
    const [out] = await client.embed(['hi']);
    expect(out).toBeInstanceOf(Float32Array);
    let s = 0;
    for (let i = 0; i < out!.length; i++) s += out![i]! * out![i]!;
    expect(Math.sqrt(s)).toBeCloseTo(1.0, 3);
  });

  it('throws OllamaEmbedError("model_not_found") on 404', async () => {
    const fetchImpl: typeof fetch = (async () => fakeResponse({ error: 'model not found' }, { ok: false, status: 404 })) as unknown as typeof fetch;
    const client = createEmbedClient({ fetchImpl });
    await expect(client.embed(['x'])).rejects.toBeInstanceOf(OllamaEmbedError);
    try {
      await client.embed(['x']);
    } catch (e) {
      expect((e as OllamaEmbedError).kind).toBe('model_not_found');
    }
  });

  it('throws OllamaEmbedError("connection_refused") when fetch throws', async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:11434');
    }) as unknown as typeof fetch;
    const client = createEmbedClient({ fetchImpl });
    await expect(client.embed(['x'])).rejects.toMatchObject({ kind: 'connection_refused' });
  });

  it('never logs input array content', async () => {
    // Spy on console.log/warn/error/info — assert chunk text never appears.
    const sink: string[] = [];
    const orig = {
      log: console.log,
      warn: console.warn,
      info: console.info,
      error: console.error,
    };
    const cap = (...a: unknown[]) => sink.push(a.map(String).join(' '));
    console.log = cap; console.warn = cap; console.info = cap; console.error = cap;
    try {
      const fetchImpl: typeof fetch = (async () => fakeResponse({ embeddings: [unitVec(768)] })) as unknown as typeof fetch;
      const client = createEmbedClient({ fetchImpl });
      await client.embed(['SECRET-PII-NEVER-LOGGED']);
      expect(sink.join('\n')).not.toContain('SECRET-PII-NEVER-LOGGED');
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.info = orig.info;
      console.error = orig.error;
    }
  });
});
