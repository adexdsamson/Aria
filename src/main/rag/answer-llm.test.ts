/**
 * Plan 08-04 Task 2 — unit tests for makeAnswerLlmInvocation.
 *
 * Asserts:
 *   - .generate(LOCAL) calls generateObject with the local model
 *   - .generate(FRONTIER) calls generateObject with the frontier model
 *   - returns { answer, citations } parsed against the schema
 *   - rethrows on transport error
 */
import { describe, it, expect, vi } from 'vitest';
import { makeAnswerLlmInvocation } from './answer-llm';
import {
  OllamaUnavailableError,
  FrontierUnavailableError,
} from '../llm/providers';

const SENTINEL_LOCAL = { __id: 'sentinel-local' };
const SENTINEL_FRONTIER = { __id: 'sentinel-frontier' };

function makeFakeGenObj(
  reply: { answer: string; citations: number[] } | null,
): ReturnType<typeof vi.fn> {
  // generateObject signature: ({ model, schema, prompt }) => { object: T }
  return vi.fn(async () => (reply ? { object: reply } : null));
}

describe('makeAnswerLlmInvocation', () => {
  it('Test 1 — returns an object with .generate', () => {
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: makeFakeGenObj({ answer: '', citations: [] }) as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    expect(typeof inv.generate).toBe('function');
  });

  it('Test 2 — LOCAL route calls generateObject with the local model', async () => {
    const gen = makeFakeGenObj({ answer: 'hello', citations: [1, 2] });
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: gen as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    const out = await inv.generate({
      prompt: 'q?',
      route: 'LOCAL',
      requestKey: 'rk-1',
    });
    expect(out).toEqual({ answer: 'hello', citations: [1, 2] });
    expect(gen).toHaveBeenCalledOnce();
    const firstArg = (gen.mock.calls[0] as unknown[])[0] as {
      model: unknown;
      prompt: string;
    };
    expect(firstArg.model).toBe(SENTINEL_LOCAL);
    expect(firstArg.prompt).toBe('q?');
  });

  it('Test 3 — FRONTIER route calls generateObject with the frontier model', async () => {
    const gen = makeFakeGenObj({ answer: 'reply', citations: [3] });
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: gen as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    const out = await inv.generate({
      prompt: 'p',
      route: 'FRONTIER',
      requestKey: 'rk-2',
    });
    expect(out).toEqual({ answer: 'reply', citations: [3] });
    const firstArg = (gen.mock.calls[0] as unknown[])[0] as {
      model: unknown;
    };
    expect(firstArg.model).toBe(SENTINEL_FRONTIER);
  });

  it('Test 4 — rethrows OllamaUnavailableError unchanged', async () => {
    const gen = vi.fn(async () => {
      throw new OllamaUnavailableError('5xx');
    });
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: gen as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    await expect(
      inv.generate({ prompt: 'p', route: 'LOCAL', requestKey: 'rk-3' }),
    ).rejects.toBeInstanceOf(OllamaUnavailableError);
  });

  it('Test 4b — rethrows FrontierUnavailableError unchanged', async () => {
    const gen = vi.fn(async () => {
      throw new FrontierUnavailableError('network', 'ECONNREFUSED');
    });
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: gen as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    await expect(
      inv.generate({ prompt: 'p', route: 'FRONTIER', requestKey: 'rk-4' }),
    ).rejects.toBeInstanceOf(FrontierUnavailableError);
  });

  it('returns null when SDK yields no object', async () => {
    const gen = makeFakeGenObj(null);
    const inv = makeAnswerLlmInvocation({
      generateObjectFn: gen as never,
      resolveLocalModel: () => SENTINEL_LOCAL,
      resolveFrontierModel: async () => SENTINEL_FRONTIER,
    });
    const out = await inv.generate({
      prompt: 'p',
      route: 'LOCAL',
      requestKey: 'rk-5',
    });
    expect(out).toBeNull();
  });
});
