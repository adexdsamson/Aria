/**
 * Direct behavioral spec for performAsk() extracted from ipc/ask.ts (Plan 17-02).
 *
 * Tests the routing logic directly without the IPC layer.
 * Uses vi.fn() stubs for all AskServiceDeps fields.
 *
 * Behaviors tested:
 *   - LOCAL route → returns { answer, route:'LOCAL', reason, latency_ms }
 *   - FRONTIER route → returns { answer, route:'FRONTIER', reason, latency_ms }
 *   - router.classify throws NoLlmProviderError → { error: 'no-llm-provider' }
 *   - LOCAL gen throws OllamaUnavailableError → { error: 'ollama-unreachable' }
 *   - FRONTIER gen throws FrontierUnavailableError → falls back to LOCAL (LLM-05)
 *   - writeRoutingLog called with prompt_hash (not raw prompt) in all success paths
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskServiceDeps } from '../../../../src/main/rag/ask-service';
import {
  performAsk,
  classifyFrontierError,
} from '../../../../src/main/rag/ask-service';
import {
  NoLlmProviderError,
  type RoutingDecision,
} from '../../../../src/main/llm/router';
import {
  OllamaUnavailableError,
  FrontierUnavailableError,
} from '../../../../src/main/llm/providers';
import pino from 'pino';

const logger = pino({ level: 'silent' });

/** Build a minimal AskServiceDeps with safe defaults; override per-test. */
function makeDeps(overrides: Partial<AskServiceDeps> = {}): AskServiceDeps {
  const mockWriteRoutingLog = vi.fn();
  const mockLocalModelFactory = vi.fn(() => ({ __local: true }));
  const mockFrontierModelFactory = vi.fn(async () => ({ __frontier: true }));
  const mockGen = vi.fn(async () => ({ text: 'default-answer' }));
  const mockRouter = {
    classify: vi.fn(async (): Promise<RoutingDecision> => ({
      route: 'LOCAL',
      reason: 'test-reason',
      model: 'llama3.1:8b',
      provider: 'ollama',
    })),
  };
  const mockDbGetter = vi.fn(() => null);

  return {
    logger,
    router: mockRouter as any,
    localModelFactory: mockLocalModelFactory as any,
    frontierModelFactory: mockFrontierModelFactory as any,
    gen: mockGen as any,
    dbGetter: mockDbGetter,
    writeRoutingLogFn: mockWriteRoutingLog,
    ...overrides,
  };
}

describe('performAsk', { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('LOCAL route: returns { answer, route:"LOCAL", reason, latency_ms }', async () => {
    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'LOCAL',
          reason: 'frontier-not-configured',
          model: 'llama3.1:8b',
          provider: 'ollama',
        })),
      } as any,
      gen: vi.fn(async () => ({ text: 'hello world' })) as any,
    });

    const result = await performAsk(deps, 'What is 2+2?', 'generic', performance.now());

    expect(result).toMatchObject({
      answer: 'hello world',
      route: 'LOCAL',
      reason: 'frontier-not-configured',
    });
    expect(typeof (result as any).latency_ms).toBe('number');
  });

  it('FRONTIER route: returns { answer, route:"FRONTIER", reason, latency_ms }', async () => {
    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'FRONTIER',
          reason: 'generic-source-frontier-active',
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
        })),
      } as any,
      frontierModelFactory: vi.fn(async () => ({ __frontier: true })) as any,
      gen: vi.fn(async () => ({ text: 'paris' })) as any,
    });

    const result = await performAsk(deps, 'Capital of France?', 'generic', performance.now());

    expect(result).toMatchObject({
      answer: 'paris',
      route: 'FRONTIER',
      reason: 'generic-source-frontier-active',
    });
    expect(typeof (result as any).latency_ms).toBe('number');
  });

  it('NoLlmProviderError → { error: "no-llm-provider" }', async () => {
    const deps = makeDeps({
      router: {
        classify: vi.fn(async () => {
          throw new NoLlmProviderError();
        }),
      } as any,
    });

    const result = await performAsk(deps, 'anything', undefined, performance.now());

    expect(result).toEqual({ error: 'no-llm-provider' });
  });

  it('LOCAL gen throws OllamaUnavailableError → { error: "ollama-unreachable" }', async () => {
    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'LOCAL',
          reason: 'frontier-not-configured',
          model: 'llama3.1:8b',
          provider: 'ollama',
        })),
      } as any,
      gen: vi.fn(async () => {
        throw new OllamaUnavailableError('Ollama not running');
      }) as any,
    });

    const result = await performAsk(deps, 'query', 'generic', performance.now());

    expect((result as any).error).toBe('ollama-unreachable');
  });

  it('FRONTIER gen throws → falls back to LOCAL (LLM-05), route:"LOCAL"', async () => {
    let callIdx = 0;
    const frontierModel = { __frontier: true };
    const localModel = { __local: true };

    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'FRONTIER',
          reason: 'generic-source-frontier-active',
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
        })),
      } as any,
      frontierModelFactory: vi.fn(async () => frontierModel) as any,
      localModelFactory: vi.fn(() => localModel) as any,
      gen: vi.fn(async (args: { model: unknown }) => {
        callIdx++;
        if (args.model === frontierModel) {
          throw new FrontierUnavailableError('rate-limited-or-down');
        }
        return { text: 'local-fallback-answer' };
      }) as any,
    });

    const result = await performAsk(deps, 'What is 2+2?', 'generic', performance.now());

    expect(callIdx).toBe(2); // frontier call + local fallback call
    expect(result).toMatchObject({
      answer: 'local-fallback-answer',
      route: 'LOCAL',
    });
    expect((result as any).reason).toMatch(/^frontier-unavailable:/);
  });

  it('LOCAL success: writeRoutingLog called once with prompt_hash (not raw prompt)', async () => {
    const mockWriteRoutingLog = vi.fn();
    const rawPrompt = 'What is the capital of France?';

    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'LOCAL',
          reason: 'frontier-not-configured',
          model: 'llama3.1:8b',
          provider: 'ollama',
        })),
      } as any,
      gen: vi.fn(async () => ({ text: 'paris' })) as any,
      writeRoutingLogFn: mockWriteRoutingLog,
    });

    await performAsk(deps, rawPrompt, 'generic', performance.now());

    expect(mockWriteRoutingLog).toHaveBeenCalledTimes(1);
    const logArg = mockWriteRoutingLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof logArg.prompt_hash).toBe('string');
    expect(logArg.prompt_hash).not.toBe(rawPrompt); // never log raw prompt
    expect((logArg.prompt_hash as string).length).toBe(64); // SHA-256 hex = 64 chars
  });

  it('FRONTIER success: writeRoutingLog called once with prompt_hash', async () => {
    const mockWriteRoutingLog = vi.fn();
    const rawPrompt = 'Classify this email';

    const deps = makeDeps({
      router: {
        classify: vi.fn(async (): Promise<RoutingDecision> => ({
          route: 'FRONTIER',
          reason: 'generic-source-frontier-active',
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
        })),
      } as any,
      frontierModelFactory: vi.fn(async () => ({ __frontier: true })) as any,
      gen: vi.fn(async () => ({ text: 'classified' })) as any,
      writeRoutingLogFn: mockWriteRoutingLog,
    });

    await performAsk(deps, rawPrompt, 'generic', performance.now());

    expect(mockWriteRoutingLog).toHaveBeenCalledTimes(1);
    const logArg = mockWriteRoutingLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof logArg.prompt_hash).toBe('string');
    expect(logArg.prompt_hash).not.toBe(rawPrompt);
  });
});

describe('classifyFrontierError', () => {
  it('FrontierUnavailableError → returns its classification', () => {
    const err = new FrontierUnavailableError('auth');
    expect(classifyFrontierError(err)).toBe('auth');
  });

  it('ENOTFOUND code → network', () => {
    const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    expect(classifyFrontierError(err)).toBe('network');
  });

  it('statusCode 401 → auth', () => {
    const err = Object.assign(new Error('401'), { statusCode: 401 });
    expect(classifyFrontierError(err)).toBe('auth');
  });

  it('statusCode 429 → rate-limited-or-down', () => {
    const err = Object.assign(new Error('429'), { statusCode: 429 });
    expect(classifyFrontierError(err)).toBe('rate-limited-or-down');
  });

  it('unknown error → rate-limited-or-down', () => {
    expect(classifyFrontierError(new Error('unknown'))).toBe('rate-limited-or-down');
  });
});
