/**
 * Plan 07-02 Task 2 — Ollama /api/embed client.
 *
 * POSTs to `${baseUrl}/embed` (NOT legacy `/api/embeddings`; Pitfall 1).
 * Imports `DEFAULT_OLLAMA_BASE_URL` from src/main/llm/providers.ts (already
 * suffixed with `/api`); we append `/embed`. Batches inputs up to `batchSize`
 * (default 16) and concatenates results in original order.
 *
 * Returned vectors from /api/embed are already L2-normalized — we do NOT
 * re-normalize. Callers can rely on `|v| ≈ 1.0` (±1e-3).
 *
 * Error taxonomy via `OllamaEmbedError` for callers to dispatch:
 *   - connection_refused: fetch threw / ECONNREFUSED
 *   - model_not_found:    404 / "model 'x' not found"
 *   - timeout:            AbortSignal fired
 *   - http:               any other non-OK status
 *
 * Logging hygiene: NEVER log `input` array content (per-request body). Log
 * counts + latency only.
 */
import { DEFAULT_OLLAMA_BASE_URL } from '../llm/providers';

export type OllamaEmbedErrorKind =
  | 'connection_refused'
  | 'model_not_found'
  | 'timeout'
  | 'http';

export class OllamaEmbedError extends Error {
  override readonly name = 'OllamaEmbedError';
  readonly kind: OllamaEmbedErrorKind;
  readonly status?: number;
  constructor(kind: OllamaEmbedErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface EmbedClient {
  embed(inputs: string[]): Promise<Float32Array[]>;
  readonly modelId: string;
  readonly dim: number;
}

export interface EmbedClientOptions {
  baseUrl?: string;
  modelId?: string;
  batchSize?: number;
  /** Per-request timeout (ms). Default 30s. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_EMBED_MODEL = 'nomic-embed-text:v1.5';
const DEFAULT_DIM = 768;
const DEFAULT_TIMEOUT_MS = 30_000;

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

export function createEmbedClient(opts: EmbedClientOptions = {}): EmbedClient {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const modelId = opts.modelId ?? DEFAULT_EMBED_MODEL;
  const batchSize = Math.max(1, opts.batchSize ?? 16);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${baseUrl}/embed`;

  async function embedBatch(batch: string[]): Promise<Float32Array[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, input: batch }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        throw new OllamaEmbedError('timeout', `embed request aborted after ${timeoutMs}ms`);
      }
      throw new OllamaEmbedError('connection_refused', msg);
    }
    clearTimeout(timer);

    if (!res.ok) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        /* swallow */
      }
      if (res.status === 404 || /not found/i.test(bodyText)) {
        throw new OllamaEmbedError(
          'model_not_found',
          `model '${modelId}' not found on Ollama (status ${res.status})`,
          res.status,
        );
      }
      throw new OllamaEmbedError(
        'http',
        `embed HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
        res.status,
      );
    }

    let parsed: OllamaEmbedResponse;
    try {
      parsed = (await res.json()) as OllamaEmbedResponse;
    } catch (err) {
      throw new OllamaEmbedError(
        'http',
        `embed response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (parsed.error) {
      throw new OllamaEmbedError('http', parsed.error);
    }
    if (!Array.isArray(parsed.embeddings) || parsed.embeddings.length !== batch.length) {
      throw new OllamaEmbedError(
        'http',
        `embed response missing/mismatched embeddings (got ${parsed.embeddings?.length ?? 0}, expected ${batch.length})`,
      );
    }
    return parsed.embeddings.map((e) => Float32Array.from(e));
  }

  async function embed(inputs: string[]): Promise<Float32Array[]> {
    if (inputs.length === 0) return [];
    const out: Float32Array[] = [];
    for (let i = 0; i < inputs.length; i += batchSize) {
      const slice = inputs.slice(i, i + batchSize);
      const result = await embedBatch(slice);
      out.push(...result);
    }
    return out;
  }

  return {
    embed,
    modelId,
    dim: DEFAULT_DIM,
  };
}
