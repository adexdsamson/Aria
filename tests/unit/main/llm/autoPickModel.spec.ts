/**
 * Tests for the bootstrap auto-pick helper (Phase 2 UAT Test 7 fix).
 */
import { describe, expect, it, vi } from 'vitest';
import { autoPickOllamaModel } from '../../../../src/main/llm/autoPickModel';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('autoPickOllamaModel', () => {
  it('picks tags[0] and emits info when nothing persisted, Ollama reachable, tags non-empty', async () => {
    const logger = makeLogger();
    const setModelId = vi.fn();
    await autoPickOllamaModel({
      logger,
      getModelId: () => null,
      setModelId,
      probe: async () => ({ reachable: true, models: ['dolphin3:latest', 'llama3.1:8b'] }),
    });
    expect(setModelId).toHaveBeenCalledWith('dolphin3:latest');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ollama', event: 'auto-picked-model', modelId: 'dolphin3:latest' }),
      expect.any(String),
    );
  });

  it('skips when an id is already persisted (idempotent across boots)', async () => {
    const logger = makeLogger();
    const setModelId = vi.fn();
    await autoPickOllamaModel({
      logger,
      getModelId: () => 'already-set:1.0',
      setModelId,
      probe: async () => ({ reachable: true, models: ['anything'] }),
    });
    expect(setModelId).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('skips when Ollama unreachable (avoids racing on probe failure)', async () => {
    const logger = makeLogger();
    const setModelId = vi.fn();
    await autoPickOllamaModel({
      logger,
      getModelId: () => null,
      setModelId,
      probe: async () => ({ reachable: false, models: [] }),
    });
    expect(setModelId).not.toHaveBeenCalled();
  });

  it('skips when tags list is empty', async () => {
    const logger = makeLogger();
    const setModelId = vi.fn();
    await autoPickOllamaModel({
      logger,
      getModelId: () => null,
      setModelId,
      probe: async () => ({ reachable: true, models: [] }),
    });
    expect(setModelId).not.toHaveBeenCalled();
  });

  it('swallows probe errors and logs warn (non-fatal)', async () => {
    const logger = makeLogger();
    const setModelId = vi.fn();
    await autoPickOllamaModel({
      logger,
      getModelId: () => null,
      setModelId,
      probe: async () => {
        throw new Error('boom');
      },
    });
    expect(setModelId).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
