/**
 * SQLCipher-backed Baileys auth-state adapter (Plan 20-03).
 *
 * Provides a Signal-protocol key store that persists to the `whatsapp_auth_state`
 * table inside the existing SQLCipher database. All Signal creds and keys live
 * inside the encrypted envelope — never in flat JSON files.
 *
 * Gate 4 (hard gate — Milestone v2.1 LOCKED decision):
 *   Every `keys.set()` call runs the entire write loop inside ONE
 *   `db.transaction()`. A throw mid-loop rolls back ALL rows for that batch.
 *
 * T-20-08 mitigation:
 *   `useMultiFileAuthState` is demo-only (writes flat JSON outside SQLCipher).
 *   Never import or use it. All auth rows live here.
 *
 * BufferJSON:
 *   All values are serialized with `JSON.stringify(value, BufferJSON.replacer)` and
 *   revived with `BufferJSON.reviver`. Rolling your own Buffer handling corrupts creds.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import type {
  AuthenticationCreds,
  SignalDataSet,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';

type Db = Database.Database;

/**
 * A plain signal key store backed by `whatsapp_auth_state` in SQLCipher.
 *
 * Usage:
 *   ```ts
 *   const store = makeSQLiteSignalKeyStore(db);
 *   // Wrap with the Baileys cache layer before passing to makeWASocket:
 *   const cachedStore = makeCacheableSignalKeyStore(store, logger);
 *   ```
 */
export interface SQLiteSignalKeyStore {
  /** Retrieve keys of a given type by ID. Missing IDs map to undefined. */
  get<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): { [id: string]: SignalDataTypeMap[T] };

  /**
   * Persist a batch of key writes/deletes.
   *
   * Gate 4: the entire batch runs in ONE db.transaction().
   * A throw mid-loop rolls back ALL rows — no partial writes ever commit.
   */
  set(data: SignalDataSet): void;

  /** Delete specific key IDs of a given type. */
  del(type: string, ids: string[]): void;
}

/**
 * Factory: create a SQLCipher-backed Baileys signal key store.
 *
 * @param db - Open SQLCipher database (schema must include `whatsapp_auth_state`).
 * @returns An `SQLiteSignalKeyStore` ready to pass to `makeCacheableSignalKeyStore`.
 */
export function makeSQLiteSignalKeyStore(db: Db): SQLiteSignalKeyStore {
  // Prepare statements once at construction (EntitlementService pattern — no
  // re-prepare overhead on every set/get call).
  const upsert = db.prepare<[string, string, string]>(
    `INSERT INTO whatsapp_auth_state (type, key_id, value, updated_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(type, key_id) DO UPDATE SET
       value      = excluded.value,
       updated_at = excluded.updated_at`,
  );

  const del = db.prepare<[string, string]>(
    `DELETE FROM whatsapp_auth_state WHERE type = ? AND key_id = ?`,
  );

  const selectByType = db.prepare<[string, string]>(
    `SELECT key_id, value FROM whatsapp_auth_state WHERE type = ? AND key_id = ?`,
  ) as Database.Statement<[string, string], { key_id: string; value: string }>;

  return {
    get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): { [id: string]: SignalDataTypeMap[T] } {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const row = selectByType.get(type as string, id);
        if (row) {
          try {
            result[id] = JSON.parse(row.value, BufferJSON.reviver) as SignalDataTypeMap[T];
          } catch {
            // Corrupted row — skip and let Baileys request a fresh key
          }
        }
      }
      return result;
    },

    /**
     * Gate 4: ALL writes for this batch execute inside ONE db.transaction().
     * A throw at any point rolls back every row — no partial commit.
     */
    set(data: SignalDataSet): void {
      const tx = db.transaction(() => {
        for (const [type, entries] of Object.entries(data)) {
          if (!entries) continue;
          for (const [id, value] of Object.entries(entries)) {
            if (value == null) {
              del.run(type, id);
            } else {
              upsert.run(type, id, JSON.stringify(value, BufferJSON.replacer));
            }
          }
        }
      });
      tx();
    },

    del(type: string, ids: string[]): void {
      const tx = db.transaction(() => {
        for (const id of ids) {
          del.run(type, id);
        }
      });
      tx();
    },
  };
}

/**
 * Load the persisted Baileys auth credentials, or seed a fresh set on first link.
 *
 * CRITICAL: when no creds row exists, this returns `initAuthCreds()` — a fully
 * formed credential set (noiseKey, signedIdentityKey, signedPreKey,
 * registrationId, …). It MUST NOT return `{}`: Baileys does not lazily generate
 * creds. With an empty object, `creds.noiseKey` is undefined and the Noise
 * handshake throws `Cannot read properties of undefined (reading 'public')` in
 * processHandshake on every connection — the socket never reaches the point of
 * emitting a `qr` event, so the QR link modal hangs forever.
 *
 * Persisted creds are written by the session manager's `creds.update` handler as
 * a single row (type='creds', key_id='creds') via `JSON.stringify(creds,
 * BufferJSON.replacer)`, and revived here through the key store's
 * `BufferJSON.reviver` so Buffer key material survives a restart.
 */
export function loadOrInitCreds(db: Db): AuthenticationCreds {
  const store = makeSQLiteSignalKeyStore(db);
  const existing = store.get('creds' as keyof SignalDataTypeMap, ['creds'])[
    'creds'
  ] as AuthenticationCreds | undefined;
  return existing ?? initAuthCreds();
}
