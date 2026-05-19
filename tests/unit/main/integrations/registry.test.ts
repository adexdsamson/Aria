import * as crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempUserDataDir } from '../../../setup';
import { closeDb, openDb } from '../../../../src/main/db/connect';
import { ProviderRegistry, ProviderNotFoundError } from '../../../../src/main/integrations/registry';

function makeProvider(providerKey: 'google' | 'microsoft', accountId: string) {
  const disconnect = vi.fn();
  return {
    providerKey,
    accountId,
    accountEmail: `${accountId}@example.com`,
    capabilities: {
      recurrenceFormat: providerKey === 'google' ? 'rrule' : 'graph',
      supportsSendUpdates: true,
      mailLabelModel: providerKey === 'google' ? 'gmail' : 'outlook',
      mailSendReturnsId: true,
    },
    disconnect,
  };
}

describe('ProviderRegistry', () => {
  let dataDir: string;
  let dbKey: Buffer;

  beforeEach(() => {
    vi.clearAllMocks();
    dataDir = createTempUserDataDir('aria-provider-registry');
    dbKey = crypto.randomBytes(32);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds providers from provider_account rows, caches them, and disconnects cleanly', () => {
    const db = openDb({ dataDir, dbKey });
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES (?, 'google', ?, 'ok', ?)`,
    ).run('acct-google', 'user@gmail.com', '{"mail":true,"calendar":true}');
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, status, capabilities_json)
       VALUES (?, 'microsoft', ?, 'ok', ?)`,
    ).run('acct-ms', 'user@contoso.com', '{"mail":true,"calendar":true}');

    const createGoogleProvider = vi.fn((row) => makeProvider('google', row.accountId));
    const createMicrosoftProvider = vi.fn((row) => makeProvider('microsoft', row.accountId));
    const registry = new ProviderRegistry(db, { createGoogleProvider, createMicrosoftProvider });

    const microsoft = registry.get('microsoft', 'acct-ms');
    const microsoftAgain = registry.get('microsoft', 'acct-ms');
    const google = registry.get('google', 'acct-google');

    expect(microsoft).toBe(microsoftAgain);
    expect(google.accountEmail).toBe('acct-google@example.com');
    expect(createMicrosoftProvider).toHaveBeenCalledTimes(1);
    expect(createGoogleProvider).toHaveBeenCalledTimes(1);

    const disconnectSpy = (microsoft as ReturnType<typeof makeProvider>).disconnect as ReturnType<typeof vi.fn>;
    registry.disconnect('microsoft', 'acct-ms');
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    const microsoftReloaded = registry.get('microsoft', 'acct-ms');
    expect(microsoftReloaded).not.toBe(microsoft);
    expect(createMicrosoftProvider).toHaveBeenCalledTimes(2);

    closeDb(db);
  });

  it('throws when the provider row is missing', () => {
    const db = openDb({ dataDir, dbKey });
    const registry = new ProviderRegistry(db);
    expect(() => registry.get('google', 'missing')).toThrow(ProviderNotFoundError);
    closeDb(db);
  });

});
