/**
 * Plan 08-04 Task 2 — answer-service-factory unit tests.
 *
 * Asserts the B-2 round 2 invariants:
 *   - Test 5: first .get() with null db → returns null, NO log emitted.
 *   - Test 5b: first .get() with non-null db → builds + emits ONE log line.
 *   - Test 6: second .get() → returns cached instance, NO second log line.
 *             callCount increments on every invocation regardless.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { createAnswerServiceFactory } from './answer-service-factory';

// Minimal stub deps. createAnswerService is invoked but its DB-touching deps
// are deferred to .ask() — construction itself only stores references.
function buildFactoryStubs(opts: { hasDb: boolean }): {
  factory: ReturnType<typeof createAnswerServiceFactory>;
  logger: Logger;
  info: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const logger = {
    info,
    warn,
    debug: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
    level: 'info',
  } as unknown as Logger;

  const fakeDb = { __id: 'fake-db' } as never;
  const dbHolder = { db: opts.hasDb ? fakeDb : null };

  const factory = createAnswerServiceFactory({
    logger,
    dbHolder,
    llm: { generate: async () => null },
    openVectorStore: () => ({ search: async () => [] }) as never,
    makeEmbedClient: () => ({ embed: async () => [] }) as never,
    readActiveEmbedModelId: () => 'nomic-embed-text:v1.5',
  });
  return { factory, logger, info };
}

describe('createAnswerServiceFactory', () => {
  it('Test 5 — first .get() with null db returns null and emits NO log', () => {
    const { factory, info } = buildFactoryStubs({ hasDb: false });
    const svc = factory.get();
    expect(svc).toBeNull();
    expect(factory.isConstructed()).toBe(false);
    // No factory.constructed log line emitted while DB is still null.
    const ctorLogs = info.mock.calls.filter((c) => {
      const meta = (c as unknown[])[0] as { event?: string } | undefined;
      return meta?.event === 'factory.constructed';
    });
    expect(ctorLogs).toHaveLength(0);
    expect(factory.callCount()).toBe(1);
  });

  it('Test 5b — first .get() with non-null db builds + emits ONE log line', () => {
    const { factory, info } = buildFactoryStubs({ hasDb: true });
    const svc = factory.get();
    expect(svc).not.toBeNull();
    expect(factory.isConstructed()).toBe(true);
    const ctorLogs = info.mock.calls.filter((c) => {
      const meta = (c as unknown[])[0] as { event?: string } | undefined;
      return meta?.event === 'factory.constructed';
    });
    expect(ctorLogs).toHaveLength(1);
    const [meta, msg] = ctorLogs[0] as [
      { scope: string; event: string },
      string,
    ];
    expect(meta.scope).toBe('answer-service');
    expect(meta.event).toBe('factory.constructed');
    expect(msg).toBe('answer-service factory constructed; route active');
  });

  it('Test 6 — second .get() returns cached instance + emits NO second log line; callCount increments', () => {
    const { factory, info } = buildFactoryStubs({ hasDb: true });
    const a = factory.get();
    const b = factory.get();
    expect(a).toBe(b);
    expect(factory.callCount()).toBe(2);
    const ctorLogs = info.mock.calls.filter((c) => {
      const meta = (c as unknown[])[0] as { event?: string } | undefined;
      return meta?.event === 'factory.constructed';
    });
    expect(ctorLogs).toHaveLength(1);
  });
});
