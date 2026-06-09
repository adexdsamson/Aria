/**
 * Gate 6 — session-manager.ts nightly-recycle cron registration spec.
 *
 * Asserts that the recycle cron is registered via scheduler.cronRegistry
 * (no bare cron.schedule) — enforced by the no-bare-cron-schedule ratchet.
 * Firing the task calls disconnect() then start().
 *
 * This spec RED-fails until Plan 20-04 (session-manager.ts) lands.
 * Run: npx vitest run tests/unit/main/whatsapp/session-recycle.spec.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module under test — does not exist yet; RED-fails until Plan 20-04 lands.
import { WhatsAppSessionManager } from '../../../../src/main/whatsapp/session-manager';

describe('session-manager.ts — nightly recycle cron (gate 6)', () => {
  let cronRegistry: Map<string, { fire: () => unknown }>;
  let schedulerMock: {
    cronRegistry: Map<string, unknown>;
    queue: { add: ReturnType<typeof vi.fn> };
  };
  let loggerMock: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cronRegistry = new Map();
    schedulerMock = {
      cronRegistry,
      queue: { add: vi.fn().mockResolvedValue(undefined) },
    };
    loggerMock = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  it('WhatsAppSessionManager is exported', () => {
    expect(typeof WhatsAppSessionManager).toBe('function');
  });

  it('recycle cron is registered in scheduler.cronRegistry after construction', () => {
    const manager = new WhatsAppSessionManager({
      db: null as never,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
    });

    // The cron must be registered in cronRegistry (no-bare-cron ratchet)
    expect(cronRegistry.size).toBeGreaterThan(0);
  });

  it('recycle cron key contains "whatsapp-recycle" or "whatsapp" identifier', () => {
    new WhatsAppSessionManager({
      db: null as never,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
    });

    const keys = Array.from(cronRegistry.keys());
    const hasWhatsAppKey = keys.some((k) => k.toLowerCase().includes('whatsapp'));
    expect(hasWhatsAppKey).toBe(true);
  });

  it('firing the recycle task calls stop() then start()', async () => {
    const manager = new WhatsAppSessionManager({
      db: null as never,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
    });

    const stopSpy = vi.spyOn(manager, 'stop');
    const startSpy = vi.spyOn(manager, 'start');

    // Get the registered recycle task and fire it
    const keys = Array.from(cronRegistry.keys());
    const recycleKey = keys.find((k) => k.toLowerCase().includes('whatsapp'));
    expect(recycleKey).toBeDefined();

    const task = cronRegistry.get(recycleKey!) as { fire?: () => unknown } | undefined;
    // The cron task should be callable — either via task() or task.fire()
    if (task && typeof task === 'function') {
      await (task as unknown as () => Promise<void>)();
    } else if (task && typeof (task as { fire?: () => unknown }).fire === 'function') {
      await (task as { fire: () => Promise<void> }).fire();
    }

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(startSpy).toHaveBeenCalledOnce();
    // stop must be called before start
    const stopOrder = stopSpy.mock.invocationCallOrder[0]!;
    const startOrder = startSpy.mock.invocationCallOrder[0]!;
    expect(stopOrder).toBeLessThan(startOrder);
  });
});
