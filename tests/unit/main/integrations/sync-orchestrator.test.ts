import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  createSyncOrchestrator,
  syncCronKey,
} from '../../../../src/main/integrations/sync-orchestrator';
import { upsertProviderAccount } from '../../../../src/main/integrations/microsoft/provider-account';
import type { Provider } from '../../../../src/shared/provider';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-sync-orchestrator');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function fakeTask() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
}

function scheduler() {
  return {
    queue: {
      add: async <T>(fn: () => T | Promise<T>) => fn(),
    } as never,
    cronRegistry: new Map(),
  };
}

describe('SyncOrchestrator', () => {
  it('schedules cron for ok provider accounts only', () => {
    const db = freshDb();
    try {
      upsertProviderAccount(db, {
        providerKey: 'microsoft',
        accountId: 'ok-1',
        displayEmail: 'ok@example.com',
        status: 'ok',
        capabilitiesJson: '{"mail":true,"calendar":true}',
      });
      upsertProviderAccount(db, {
        providerKey: 'google',
        accountId: 'needs-auth-1',
        displayEmail: 'needs@example.com',
        status: 'needs-auth',
        capabilitiesJson: '{"mail":true,"calendar":true}',
      });
      const task = fakeTask();
      const handle = scheduler();
      createSyncOrchestrator({
        db,
        scheduler: handle,
        schedule: vi.fn(() => task as never),
        jitterMs: 0,
      }).start();

      expect(handle.cronRegistry.has(syncCronKey('microsoft', 'ok-1'))).toBe(true);
      expect(handle.cronRegistry.has(syncCronKey('google', 'needs-auth-1'))).toBe(false);
    } finally {
      closeDb(db);
    }
  });

  it('scheduleAccount adds a newly connected account without restart', () => {
    const db = freshDb();
    try {
      const handle = scheduler();
      const orchestrator = createSyncOrchestrator({
        db,
        scheduler: handle,
        schedule: vi.fn(() => fakeTask() as never),
        jitterMs: 0,
      });
      const account = {
        providerKey: 'microsoft' as const,
        accountId: 'new-1',
        displayEmail: 'new@example.com',
        status: 'ok' as const,
        identitySet: null,
        capabilitiesJson: '{"mail":true,"calendar":true}',
        createdAt: new Date().toISOString(),
      };
      orchestrator.scheduleAccount(account);
      expect(handle.cronRegistry.has(syncCronKey('microsoft', 'new-1'))).toBe(true);
    } finally {
      closeDb(db);
    }
  });

  it('ticks provider capabilities and advances provider_sync_state', async () => {
    const db = freshDb();
    try {
      upsertProviderAccount(db, {
        providerKey: 'microsoft',
        accountId: 'acct-1',
        displayEmail: 'user@example.com',
        status: 'ok',
        capabilitiesJson: '{"mail":true,"calendar":true}',
      });
      const provider: Provider = {
        providerKey: 'microsoft',
        accountId: 'acct-1',
        accountEmail: 'user@example.com',
        capabilities: {
          recurrenceFormat: 'graph',
          supportsSendUpdates: true,
          mailLabelModel: 'outlook',
          mailSendReturnsId: true,
        },
        mail: {
          listMessagesDelta: vi.fn().mockResolvedValue({ items: [], tombstones: [], cursor: 'mail-cursor', hadFullResync: false }),
          getMessage: vi.fn(),
          sendMessage: vi.fn(),
          findSentByIdempotencyKey: vi.fn(),
        },
        calendar: {
          listEventsDelta: vi.fn().mockResolvedValue({ items: [], tombstones: [], cursor: 'cal-cursor', hadFullResync: false }),
          listEventsWindow: vi.fn(),
          getEvent: vi.fn(),
          patchEvent: vi.fn(),
          insertEvent: vi.fn(),
          eventInstances: vi.fn(),
          freeBusy: vi.fn(),
        },
      };
      const orchestrator = createSyncOrchestrator({
        db,
        scheduler: scheduler(),
        registryDeps: { createMicrosoftProvider: () => provider },
        jitterMs: 0,
      });
      await orchestrator.tickAccount({
        providerKey: 'microsoft',
        accountId: 'acct-1',
        displayEmail: 'user@example.com',
        status: 'ok',
        identitySet: null,
        capabilitiesJson: '{"mail":true,"calendar":true}',
        createdAt: new Date().toISOString(),
      });

      const rows = db
        .prepare('SELECT resource, cursor FROM provider_sync_state ORDER BY resource ASC')
        .all() as Array<{ resource: string; cursor: string }>;
      expect(rows).toEqual([
        { resource: 'calendar', cursor: 'cal-cursor' },
        { resource: 'mail', cursor: 'mail-cursor' },
      ]);
    } finally {
      closeDb(db);
    }
  });
});
