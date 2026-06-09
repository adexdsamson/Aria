import type Database from 'better-sqlite3-multiple-ciphers';
import type { IdentitySet, ProviderAccountInput, ProviderAccountRow, ProviderAccountStatus } from './types';

type Db = Database.Database;

function stringifyIdentitySet(identitySet: IdentitySet | null | undefined): string | null {
  if (!identitySet) return null;
  return JSON.stringify(identitySet);
}

export function upsertProviderAccount(db: Db, input: ProviderAccountInput): void {
  const nowIso = new Date().toISOString();
  const row = {
    account_id: input.accountId,
    provider_key: input.providerKey,
    display_email: input.displayEmail,
    display_label: input.displayLabel ?? null,
    display_color: input.displayColor ?? null,
    status: input.status ?? 'ok',
    identity_set_json: stringifyIdentitySet(input.identitySet),
    last_synced_at: input.lastSyncedAt ?? null,
    last_error: input.lastError ?? null,
    last_error_at: input.lastErrorAt ?? null,
    created_at: nowIso,
    capabilities_json: input.capabilitiesJson ?? '{"mail":false,"calendar":false}',
  };
  db.prepare(
    `INSERT OR REPLACE INTO provider_account (
      account_id, provider_key, display_email, display_label, display_color,
      status, identity_set_json, last_synced_at, last_error, last_error_at,
      created_at, capabilities_json
    ) VALUES (
      @account_id, @provider_key, @display_email, @display_label, @display_color,
      @status, @identity_set_json, @last_synced_at, @last_error, @last_error_at,
      @created_at, @capabilities_json
    )`,
  ).run(row);
}

export function setProviderAccountStatus(
  db: Db,
  input: {
    providerKey: 'google' | 'microsoft';
    accountId: string;
    status: ProviderAccountStatus;
    lastError?: string | null;
    lastSyncedAt?: string | null;
  },
): void {
  db.prepare(
    `UPDATE provider_account
        SET status = ?,
            last_error = ?,
            last_error_at = ?,
            last_synced_at = COALESCE(?, last_synced_at)
      WHERE provider_key = ? AND account_id = ?`,
  ).run(
    input.status,
    input.lastError ?? null,
    input.lastError ? new Date().toISOString() : null,
    input.lastSyncedAt ?? null,
    input.providerKey,
    input.accountId,
  );
}

export function listProviderAccounts(
  db: Db,
  providerKey?: 'google' | 'microsoft',
): ProviderAccountRow[] {
  const rows = (providerKey
    ? db
        .prepare(
          `SELECT
            account_id as accountId,
            provider_key as providerKey,
            display_email as displayEmail,
            display_label as displayLabel,
            display_color as displayColor,
            status,
            identity_set_json as identitySetJson,
            last_synced_at as lastSyncedAt,
            last_error as lastError,
            last_error_at as lastErrorAt,
            created_at as createdAt,
            capabilities_json as capabilitiesJson
          FROM provider_account
          WHERE provider_key = ?
          ORDER BY created_at ASC`,
        )
        .all(providerKey)
    : db
        .prepare(
          `SELECT
            account_id as accountId,
            provider_key as providerKey,
            display_email as displayEmail,
            display_label as displayLabel,
            display_color as displayColor,
            status,
            identity_set_json as identitySetJson,
            last_synced_at as lastSyncedAt,
            last_error as lastError,
            last_error_at as lastErrorAt,
            created_at as createdAt,
            capabilities_json as capabilitiesJson
          FROM provider_account
          ORDER BY provider_key ASC, created_at ASC`,
        )
        .all()) as Array<{
    accountId: string;
    providerKey: 'google' | 'microsoft';
    displayEmail: string;
    displayLabel?: string | null;
    displayColor?: string | null;
    status: ProviderAccountStatus;
    identitySetJson?: string | null;
    lastSyncedAt?: string | null;
    lastError?: string | null;
    lastErrorAt?: string | null;
    createdAt: string;
    capabilitiesJson: string;
  }>;
  return rows.map((row) => ({
    providerKey: row.providerKey,
    accountId: row.accountId,
    displayEmail: row.displayEmail,
    displayLabel: row.displayLabel ?? null,
    displayColor: row.displayColor ?? null,
    status: row.status,
    identitySet: row.identitySetJson ? (JSON.parse(row.identitySetJson) as IdentitySet) : null,
    capabilitiesJson: row.capabilitiesJson,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastError: row.lastError ?? null,
    lastErrorAt: row.lastErrorAt ?? null,
    createdAt: row.createdAt,
  }));
}

export function getProviderAccount(
  db: Db,
  providerKey: 'google' | 'microsoft' | 'todoist' | 'whatsapp',
  accountId: string,
): ProviderAccountRow | null {
  const row = db
    .prepare(
      `SELECT
        account_id as accountId,
        provider_key as providerKey,
        display_email as displayEmail,
        display_label as displayLabel,
        display_color as displayColor,
        status,
        identity_set_json as identitySetJson,
        last_synced_at as lastSyncedAt,
        last_error as lastError,
        last_error_at as lastErrorAt,
        created_at as createdAt,
        capabilities_json as capabilitiesJson
      FROM provider_account
      WHERE provider_key = ? AND account_id = ?`,
    )
    .get(providerKey, accountId) as
    | (ProviderAccountRow & { identitySetJson?: string | null; capabilitiesJson?: string })
    | undefined;
  if (!row) return null;
  return {
    providerKey: row.providerKey,
    accountId: row.accountId,
    displayEmail: row.displayEmail,
    displayLabel: row.displayLabel ?? null,
    displayColor: row.displayColor ?? null,
    status: row.status,
    identitySet: row.identitySetJson ? (JSON.parse(row.identitySetJson) as IdentitySet) : null,
    capabilitiesJson: row.capabilitiesJson,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastError: row.lastError ?? null,
    lastErrorAt: row.lastErrorAt ?? null,
    createdAt: row.createdAt,
  };
}

export function upsertProviderSyncState(db: Db, input: {
  providerKey: 'google' | 'microsoft';
  accountId: string;
  resource: 'mail' | 'calendar';
  cursor?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO provider_sync_state (
      provider_key, account_id, resource, cursor, last_sync_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.providerKey,
    input.accountId,
    input.resource,
    input.cursor ?? null,
    input.lastSyncAt ?? null,
    input.lastError ?? null,
  );
}
