import type Database from 'better-sqlite3-multiple-ciphers';
import type { Provider, ProviderKey } from '../../shared/provider';
import { createGoogleProvider } from './google/provider-adapter';
import { createMicrosoftProvider } from './microsoft/provider-adapter';
import { getProviderAccount, listProviderAccounts } from './microsoft/provider-account';
import type { ProviderAccountRow } from './microsoft/types';

type Db = Database.Database;

export class ProviderNotFoundError extends Error {
  override readonly name = 'ProviderNotFoundError';
}

export interface ProviderRegistryDeps {
  createGoogleProvider?: (row: ProviderAccountRow) => Provider;
  createMicrosoftProvider?: (row: ProviderAccountRow) => Provider;
}

function providerKey(providerKey: ProviderKey, accountId: string): string {
  return `${providerKey}:${accountId}`;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  private readonly rows = new Map<string, ProviderAccountRow>();

  constructor(
    private readonly db: Db,
    private readonly deps: ProviderRegistryDeps = {},
  ) {
    for (const row of listProviderAccounts(db)) {
      this.rows.set(providerKey(row.providerKey, row.accountId), row);
    }
  }

  get(providerKey: ProviderKey, accountId: string): Provider {
    if (providerKey === 'todoist') {
      throw new ProviderNotFoundError('todoist-provider-is-task-only');
    }
    if (providerKey === 'whatsapp') {
      throw new ProviderNotFoundError('whatsapp-uses-session-manager');
    }
    const key = providerKey + ':' + accountId;
    const cached = this.providers.get(key);
    if (cached) {
      return cached;
    }

    const row = this.rows.get(key) ?? getProviderAccount(this.db, providerKey, accountId);
    if (!row) {
      throw new ProviderNotFoundError(`provider-not-found:${providerKey}:${accountId}`);
    }
    this.rows.set(key, row);

    const provider = this.buildProvider(row);
    this.providers.set(key, provider);
    return provider;
  }

  disconnect(providerKey: ProviderKey, accountId: string): void {
    const key = providerKey + ':' + accountId;
    const cached = this.providers.get(key);
    this.providers.delete(key);
    if (cached?.disconnect) {
      void Promise.resolve(cached.disconnect()).catch(() => undefined);
    }
  }

  private buildProvider(row: ProviderAccountRow): Provider {
    if (row.providerKey === 'google') {
      return (this.deps.createGoogleProvider ?? createGoogleProvider)(row);
    }
    if (row.providerKey === 'todoist') {
      throw new ProviderNotFoundError('todoist-provider-is-task-only');
    }
    return (this.deps.createMicrosoftProvider ?? createMicrosoftProvider)(row);
  }
}

export function getProvider(
  registry: ProviderRegistry,
  providerKey: ProviderKey,
  accountId: string,
): Provider {
  return registry.get(providerKey, accountId);
}
