import { describe, expect, it } from 'vitest';
import { LLMRouter } from '../../../../src/main/llm/router';
import { DEFAULT_LOCAL_MODEL } from '../../../../src/main/llm/providers';

function makeRouter(opts: {
  activeProvider?: 'anthropic' | 'openai' | 'google' | null;
  hasKey?: boolean;
}) {
  return new LLMRouter({
    getActiveProviderFn: async () => opts.activeProvider ?? null,
    hasFrontierKeyFn: async () => opts.hasKey ?? false,
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
});
