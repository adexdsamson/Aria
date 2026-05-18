/**
 * AI SDK 6 provider factories (Plan 04 Task 1).
 *
 * Lazy-constructs ollama / anthropic / openai / google provider clients on
 * first use; caches the constructed model objects keyed by provider+key-hash
 * so repeated calls reuse the same client (avoids re-hashing key per request).
 *
 * Default model IDs are pinned here as exported consts and recorded in the
 * Plan 04 SUMMARY. Update them when vendor docs change.
 *
 * Pitfall — ollama: MUST import from `ollama-ai-provider-v2`. The legacy
 * `ollama-ai-provider` package is incompatible with AI SDK 6.
 *   (01-RESEARCH.md lines 539-547)
 */
import * as crypto from 'node:crypto';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { ProviderId } from '../../shared/ipc-contract';
import { getFrontierKey, getOllamaModelId } from '../secrets/safeStorage';

export const DEFAULT_LOCAL_MODEL = 'llama3.1:8b-instruct-q4_K_M';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/api';

export class OllamaUnavailableError extends Error {
  override readonly name = 'OllamaUnavailableError';
}
export class FrontierUnavailableError extends Error {
  override readonly name = 'FrontierUnavailableError';
  readonly classification: 'network' | 'auth' | 'rate-limited-or-down';
  constructor(
    classification: 'network' | 'auth' | 'rate-limited-or-down',
    message?: string,
  ) {
    super(message ?? `frontier-unavailable:${classification}`);
    this.classification = classification;
  }
}

/** AI SDK 6 LanguageModelV2-compatible shape; we keep it `unknown` to avoid
 *  pulling the type symbol from `ai` (it lives behind multiple aliases). */
export type ModelLike = unknown;

interface CacheEntry {
  model: ModelLike;
}
const cache = new Map<string, CacheEntry>();

function keyHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export interface LocalModelOptions {
  modelId?: string;
  baseURL?: string;
}

/**
 * Resolve the active local model id. Persisted user choice wins; the exported
 * `DEFAULT_LOCAL_MODEL` is the documented fallback for users who haven't
 * picked a model yet (e.g. fresh-install Ollama with a single non-default tag).
 *
 * Sync by design — `secrets.json` is tiny and every Ollama call hits this once.
 * Safe to call before app.isReady() (returns null → fallback).
 */
export function getActiveLocalModelId(): string {
  try {
    const persisted = getOllamaModelId();
    if (persisted && persisted.length > 0) return persisted;
  } catch {
    // safeStorage may throw pre-ready; fall through to default.
  }
  return DEFAULT_LOCAL_MODEL;
}

export function getLocalModel(opts: LocalModelOptions = {}): ModelLike {
  const modelId = opts.modelId ?? getActiveLocalModelId();
  const baseURL = opts.baseURL ?? DEFAULT_OLLAMA_BASE_URL;
  const cacheKey = `ollama:${baseURL}:${modelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached.model;
  try {
    const ollama = createOllama({ baseURL });
    const model = ollama(modelId);
    cache.set(cacheKey, { model });
    return model;
  } catch (err) {
    throw new OllamaUnavailableError(
      `getLocalModel failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface FrontierModelOptions {
  modelId?: string;
}

export function defaultModelIdFor(provider: ProviderId): string {
  switch (provider) {
    case 'anthropic':
      return DEFAULT_ANTHROPIC_MODEL;
    case 'openai':
      return DEFAULT_OPENAI_MODEL;
    case 'google':
      return DEFAULT_GOOGLE_MODEL;
  }
}

export async function getFrontierModel(
  provider: ProviderId,
  opts: FrontierModelOptions = {},
): Promise<ModelLike> {
  const key = await getFrontierKey({ provider });
  if (!key) {
    throw new FrontierUnavailableError('auth', 'no-key-for-provider');
  }
  const modelId = opts.modelId ?? defaultModelIdFor(provider);
  const cacheKey = `${provider}:${keyHash(key)}:${modelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached.model;
  let model: ModelLike;
  switch (provider) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey: key });
      model = client(modelId);
      break;
    }
    case 'openai': {
      const client = createOpenAI({ apiKey: key });
      model = client(modelId);
      break;
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey: key });
      model = client(modelId);
      break;
    }
  }
  cache.set(cacheKey, { model });
  return model;
}

/** Test-only: wipe the provider-model cache between tests. */
export function _resetProviderCacheForTests(): void {
  cache.clear();
}
