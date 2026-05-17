import { describe, expect, it } from 'vitest';
import { LLMRouter, NoLlmProviderError } from '../../../../src/main/llm/router';
import { DEFAULT_LOCAL_MODEL } from '../../../../src/main/llm/providers';

function makeRouter(opts: {
  activeProvider?: 'anthropic' | 'openai' | 'google' | null;
  hasKey?: boolean;
  ollamaReachable?: boolean;
}) {
  return new LLMRouter({
    getActiveProviderFn: async () => opts.activeProvider ?? null,
    hasFrontierKeyFn: async () => opts.hasKey ?? false,
    ollamaReachableFn: async () => opts.ollamaReachable ?? true,
  });
}

describe('LLMRouter.classify', () => {
  it('fail-closed when source is undefined', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: true });
    const d = await r.classify({ prompt: 'hi', source: undefined });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('fail-closed-source-unset');
    expect(d.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(d.provider).toBe('ollama');
  });

  it('fail-closed when source is empty string', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: true });
    const d = await r.classify({ prompt: 'hi', source: '' });
    expect(d.reason).toBe('fail-closed-source-unset');
  });

  it('routes LOCAL on PII match (email)', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: true });
    const d = await r.classify({
      prompt: 'Email me at foo@bar.com',
      source: 'generic',
    });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('pii-pattern-matched:email');
  });

  it('routes LOCAL for user-email source', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: true });
    const d = await r.classify({ prompt: 'summarize', source: 'user-email' });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('user-data-source:user-email');
  });

  it('routes FRONTIER for generic when frontier active+key', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: true });
    const d = await r.classify({
      prompt: 'What is the capital of France?',
      source: 'generic',
    });
    expect(d.route).toBe('FRONTIER');
    expect(d.reason).toBe('generic-source-frontier-active');
    expect(d.provider).toBe('anthropic');
  });

  it('routes LOCAL when frontier not configured', async () => {
    const r = makeRouter({ activeProvider: null, hasKey: false });
    const d = await r.classify({
      prompt: 'What is the capital of France?',
      source: 'generic',
    });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('frontier-not-configured');
  });

  it('routes LOCAL when provider active but no key', async () => {
    const r = makeRouter({ activeProvider: 'anthropic', hasKey: false });
    const d = await r.classify({ prompt: 'hi', source: 'generic' });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('frontier-not-configured');
  });

  // ── UAT Gap 8 — FRONTIER_ONLY + NONE modes ────────────────────────────────

  it('FRONTIER_ONLY: routes FRONTIER for generic when Ollama unreachable', async () => {
    const r = makeRouter({ activeProvider: 'openai', hasKey: true, ollamaReachable: false });
    const d = await r.classify({ prompt: 'capital of France?', source: 'generic' });
    expect(d.route).toBe('FRONTIER');
    expect(d.reason).toBe('generic-source-frontier-active');
    expect(d.provider).toBe('openai');
  });

  it('FRONTIER_ONLY: routes FRONTIER for user-email when Ollama unreachable (override)', async () => {
    const r = makeRouter({ activeProvider: 'openai', hasKey: true, ollamaReachable: false });
    const d = await r.classify({ prompt: 'summarize', source: 'user-email' });
    expect(d.route).toBe('FRONTIER');
    expect(d.reason).toBe('user-data-source:user-email:frontier-only');
    expect(d.provider).toBe('openai');
  });

  it('FRONTIER_ONLY: routes FRONTIER on PII when Ollama unreachable (override)', async () => {
    const r = makeRouter({ activeProvider: 'openai', hasKey: true, ollamaReachable: false });
    const d = await r.classify({ prompt: 'Email me at foo@bar.com', source: 'generic' });
    expect(d.route).toBe('FRONTIER');
    expect(d.reason).toBe('pii-pattern-matched:email:frontier-only');
  });

  it('FRONTIER_ONLY: routes FRONTIER for unset source (override)', async () => {
    const r = makeRouter({ activeProvider: 'openai', hasKey: true, ollamaReachable: false });
    const d = await r.classify({ prompt: 'hi', source: undefined });
    expect(d.route).toBe('FRONTIER');
    expect(d.reason).toBe('fail-closed-source-unset:frontier-only');
  });

  it('NONE: throws NoLlmProviderError when Ollama unreachable AND no key', async () => {
    const r = makeRouter({ activeProvider: null, hasKey: false, ollamaReachable: false });
    await expect(r.classify({ prompt: 'hi', source: 'generic' })).rejects.toBeInstanceOf(
      NoLlmProviderError,
    );
  });

  it('NONE: throws even on PII-matching prompt (fail-fast, no silent fallback)', async () => {
    const r = makeRouter({ activeProvider: null, hasKey: false, ollamaReachable: false });
    await expect(
      r.classify({ prompt: 'Email me at foo@bar.com', source: 'generic' }),
    ).rejects.toMatchObject({ code: 'no-llm-provider' });
  });

  it('LOCAL_ONLY: still routes LOCAL for generic (no change from pre-Gap-8 behavior)', async () => {
    const r = makeRouter({ activeProvider: null, hasKey: false, ollamaReachable: true });
    const d = await r.classify({ prompt: 'capital of France?', source: 'generic' });
    expect(d.route).toBe('LOCAL');
    expect(d.reason).toBe('frontier-not-configured');
    expect(d.model).toBe(DEFAULT_LOCAL_MODEL);
  });
});
