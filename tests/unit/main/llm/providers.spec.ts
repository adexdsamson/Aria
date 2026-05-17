/**
 * Tests for providers.getActiveLocalModelId / getLocalModel fallback +
 * persisted-id resolution.
 *
 * The real createOllama from ollama-ai-provider-v2 is stubbed via vi.doMock so
 * we don't need a running Ollama daemon — we just assert the model id passed
 * to the factory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempUserDataDir } from '../../../setup';

interface StubbedProvidersModule {
  getActiveLocalModelId: () => string;
  getLocalModel: (opts?: { modelId?: string }) => { modelId: string };
  DEFAULT_LOCAL_MODEL: string;
  _resetProviderCacheForTests: () => void;
}

async function setup(dataDir: string): Promise<{
  providers: StubbedProvidersModule;
  secrets: typeof import('../../../../src/main/secrets/safeStorage');
}> {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => dataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
      getSelectedStorageBackend: () => 'keychain',
    },
  }));
  // Stub the ollama-ai-provider-v2 client so getLocalModel returns a sentinel
  // shaped {modelId} we can assert on without a live Ollama.
  vi.doMock('ollama-ai-provider-v2', () => ({
    createOllama: () => (modelId: string) => ({ modelId }),
  }));
  const providers = (await import(
    '../../../../src/main/llm/providers'
  )) as unknown as StubbedProvidersModule;
  const secrets = await import('../../../../src/main/secrets/safeStorage');
  providers._resetProviderCacheForTests();
  return { providers, secrets };
}

describe('providers.getActiveLocalModelId / getLocalModel resolution', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempUserDataDir('aria-providers-test');
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('ollama-ai-provider-v2');
  });

  it('falls back to DEFAULT_LOCAL_MODEL when no persisted id', async () => {
    const { providers } = await setup(dataDir);
    expect(providers.getActiveLocalModelId()).toBe(providers.DEFAULT_LOCAL_MODEL);
    const m = providers.getLocalModel();
    expect(m.modelId).toBe(providers.DEFAULT_LOCAL_MODEL);
  });

  it('reads the persisted id when set', async () => {
    const { providers, secrets } = await setup(dataDir);
    secrets.setOllamaModelId('dolphin3:latest');
    expect(providers.getActiveLocalModelId()).toBe('dolphin3:latest');
    const m = providers.getLocalModel();
    expect(m.modelId).toBe('dolphin3:latest');
  });

  it('explicit opts.modelId wins over persisted id', async () => {
    const { providers, secrets } = await setup(dataDir);
    secrets.setOllamaModelId('dolphin3:latest');
    const m = providers.getLocalModel({ modelId: 'qwen2.5:7b' });
    expect(m.modelId).toBe('qwen2.5:7b');
  });
});
