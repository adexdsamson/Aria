import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type Database from 'better-sqlite3-multiple-ciphers';
import type PQueueImport from 'p-queue';
import type { Logger } from 'pino';
import type { ProviderKey } from '../../shared/provider';
import { ProviderRegistry, type ProviderRegistryDeps } from './registry';
import {
  listProviderAccounts,
  setProviderAccountStatus,
  upsertProviderSyncState,
} from './microsoft/provider-account';
import type { ProviderAccountRow } from './microsoft/types';

type Db = Database.Database;

export interface SyncOrchestratorDeps {
  db: Db;
  scheduler: { queue: InstanceType<typeof PQueueImport>; cronRegistry?: Map<string, ScheduledTask> };
  logger?: Pick<Logger, 'info' | 'warn'>;
  registry?: ProviderRegistry;
  registryDeps?: ProviderRegistryDeps;
  cronSchedule?: string;
  jitterMs?: number;
  schedule?: (expression: string, fn: () => void) => ScheduledTask;
  now?: () => Date;
  tickAccount?: (account: ProviderAccountRow) => Promise<void>;
}

export interface SyncOrchestrator {
  start(): void;
  stop(): void;
  scheduleAccount(account: ProviderAccountRow): void;
  tickAccount(account: ProviderAccountRow): Promise<void>;
}

const DEFAULT_CRON_SCHEDULE = '*/5 * * * *';
const DEFAULT_JITTER_MS = 30_000;

function accountCronKey(account: Pick<ProviderAccountRow, 'providerKey' | 'accountId'>): string {
  return `provider-sync:${account.providerKey}:${account.accountId}`;
}

function readCursor(db: Db, account: ProviderAccountRow, resource: 'mail' | 'calendar'): string | null {
  const row = db
    .prepare(
      `SELECT cursor
         FROM provider_sync_state
        WHERE provider_key = ?
          AND account_id = ?
          AND resource = ?`,
    )
    .get(account.providerKey, account.accountId, resource) as { cursor?: string | null } | undefined;
  return row?.cursor ?? null;
}

function runLater(fn: () => void, jitterMs: number): void {
  const delay = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  setTimeout(fn, delay);
}

export function createSyncOrchestrator(deps: SyncOrchestratorDeps): SyncOrchestrator {
  const registry = deps.registry ?? new ProviderRegistry(deps.db, deps.registryDeps);
  const schedule = deps.schedule ?? ((expression, fn) => cron.schedule(expression, fn));
  const cronRegistry = deps.scheduler.cronRegistry ?? new Map<string, ScheduledTask>();
  const cronSchedule = deps.cronSchedule ?? DEFAULT_CRON_SCHEDULE;
  const jitterMs = deps.jitterMs ?? DEFAULT_JITTER_MS;

  async function defaultTickAccount(account: ProviderAccountRow): Promise<void> {
    const provider = registry.get(account.providerKey, account.accountId);
    const syncedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (provider.mail) {
      const cursor = readCursor(deps.db, account, 'mail');
      const delta = await deps.scheduler.queue.add(() => provider.mail!.listMessagesDelta({ cursor }));
      await deps.scheduler.queue.add(() => {
        upsertProviderSyncState(deps.db, {
          providerKey: account.providerKey,
          accountId: account.accountId,
          resource: 'mail',
          cursor: delta.cursor,
          lastSyncAt: syncedAt,
          lastError: null,
        });
      });
    }

    if (provider.calendar) {
      const cursor = readCursor(deps.db, account, 'calendar');
      const delta = await deps.scheduler.queue.add(() => provider.calendar!.listEventsDelta({ cursor }));
      await deps.scheduler.queue.add(() => {
        upsertProviderSyncState(deps.db, {
          providerKey: account.providerKey,
          accountId: account.accountId,
          resource: 'calendar',
          cursor: delta.cursor,
          lastSyncAt: syncedAt,
          lastError: null,
        });
      });
    }

    setProviderAccountStatus(deps.db, {
      providerKey: account.providerKey,
      accountId: account.accountId,
      status: 'ok',
      lastError: null,
      lastSyncedAt: syncedAt,
    });
  }

  const api: SyncOrchestrator = {
    start() {
      for (const account of listProviderAccounts(deps.db)) {
        if (account.status === 'ok') {
          api.scheduleAccount(account);
        }
      }
    },

    stop() {
      for (const [key, task] of [...cronRegistry.entries()]) {
        if (!key.startsWith('provider-sync:')) continue;
        task.stop();
        cronRegistry.delete(key);
      }
    },

    scheduleAccount(account) {
      if (account.status !== 'ok') return;
      const key = accountCronKey(account);
      if (cronRegistry.has(key)) return;
      const task = schedule(cronSchedule, () => {
        runLater(() => {
          void api.tickAccount(account).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setProviderAccountStatus(deps.db, {
              providerKey: account.providerKey,
              accountId: account.accountId,
              status: 'degraded',
              lastError: message,
            });
            deps.logger?.warn?.(
              { scope: 'sync-orchestrator', providerKey: account.providerKey, accountId: account.accountId, error: message },
              'provider sync tick failed',
            );
          });
        }, jitterMs);
      });
      cronRegistry.set(key, task);
      deps.logger?.info?.(
        { scope: 'sync-orchestrator', providerKey: account.providerKey, accountId: account.accountId, schedule: cronSchedule },
        'provider sync scheduled',
      );
    },

    async tickAccount(account) {
      await (deps.tickAccount ?? defaultTickAccount)(account);
    },
  };

  return api;
}

export function startSyncOrchestrator(deps: SyncOrchestratorDeps): SyncOrchestrator {
  const orchestrator = createSyncOrchestrator(deps);
  orchestrator.start();
  return orchestrator;
}

export function stopSyncOrchestrator(orchestrator: SyncOrchestrator | null | undefined): void {
  orchestrator?.stop();
}

export function syncCronKey(providerKey: ProviderKey, accountId: string): string {
  return accountCronKey({ providerKey, accountId });
}
