/**
 * R-WA04 — WHATSAPP_DISCONNECT cascade integration target.
 *
 * After WHATSAPP_DISCONNECT is handled:
 *   - 0 rows in whatsapp_auth_state
 *   - 0 rows in whatsapp_group
 *   - 0 rows in whatsapp_message (FK CASCADE from whatsapp_group)
 *   - 0 rows in whatsapp_group_digest (FK CASCADE from whatsapp_group)
 *   - 0 matching rows in provider_account
 *   - manager.stop() was called
 *
 * The cascade is implemented in Plan 20-06 Task 3
 * (src/main/ipc/provider-accounts.ts whatsapp branch).
 *
 * This spec RED-fails until Plan 20-06 wires the disconnect cascade.
 * Run: npx vitest run tests/unit/main/whatsapp/whatsapp-disconnect.spec.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';

// The disconnect handler is in provider-accounts — not yet wired for whatsapp.
// RED-fails until Plan 20-06 extends the disconnect cascade.
import { handleProviderAccountDisconnect } from '../../../../src/main/ipc/provider-accounts';
// The session manager stop method is what the cascade calls.
import { WhatsAppSessionManager } from '../../../../src/main/whatsapp/session-manager';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

const WA_JID = '+1234567890@s.whatsapp.net';

describe('WHATSAPP_DISCONNECT cascade (R-WA04 → Plan 20-06)', () => {
  let db: ReturnType<typeof openDb>;
  let managerStopSpy: ReturnType<typeof vi.fn>;
  let manager: InstanceType<typeof WhatsAppSessionManager>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-disconnect');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    managerStopSpy = vi.fn().mockResolvedValue(undefined);

    const schedulerMock = {
      cronRegistry: new Map(),
      queue: { add: vi.fn().mockResolvedValue(undefined) },
    };
    const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    manager = new WhatsAppSessionManager({
      db,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
    });
    // Override stop with the spy
    (manager as unknown as { stop: typeof managerStopSpy }).stop = managerStopSpy;

    // Seed WhatsApp data: provider_account, auth_state, group, message, digest
    db.prepare(
      `INSERT INTO provider_account (account_id, provider_key, display_email, capabilities_json)
       VALUES (?, 'whatsapp', ?, ?)`,
    ).run(WA_JID, WA_JID, '{"messaging":1}');

    db.prepare(
      `INSERT INTO whatsapp_auth_state (type, key_id, value_json) VALUES (?, ?, ?)`,
    ).run('creds', 'creds-main', '{"me":{"id":"' + WA_JID + '"}}');

    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`,
    ).run('test-group@g.us', 'Test Group', 5, 1);

    // message row (FK → whatsapp_group)
    db.prepare(
      `INSERT INTO whatsapp_message (jid, sender_jid, wa_id, sent_at, body_text) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-group@g.us', 'sender@s.whatsapp.net', 'wa-id-1',
      new Date().toISOString(), 'Test message');
  });

  it('handleProviderAccountDisconnect is exported', () => {
    expect(typeof handleProviderAccountDisconnect).toBe('function');
  });

  it('after disconnect: 0 rows in whatsapp_auth_state', async () => {
    await handleProviderAccountDisconnect({
      db,
      manager,
      providerKey: 'whatsapp',
      accountId: WA_JID,
    } as never);

    const rows = db.prepare('SELECT * FROM whatsapp_auth_state').all();
    expect(rows).toHaveLength(0);
  });

  it('after disconnect: 0 rows in whatsapp_group', async () => {
    await handleProviderAccountDisconnect({
      db,
      manager,
      providerKey: 'whatsapp',
      accountId: WA_JID,
    } as never);

    const rows = db.prepare('SELECT * FROM whatsapp_group').all();
    expect(rows).toHaveLength(0);
  });

  it('after disconnect: 0 rows in whatsapp_message (FK CASCADE)', async () => {
    await handleProviderAccountDisconnect({
      db,
      manager,
      providerKey: 'whatsapp',
      accountId: WA_JID,
    } as never);

    const rows = db.prepare('SELECT * FROM whatsapp_message').all();
    expect(rows).toHaveLength(0);
  });

  it('after disconnect: provider_account row for whatsapp is gone', async () => {
    await handleProviderAccountDisconnect({
      db,
      manager,
      providerKey: 'whatsapp',
      accountId: WA_JID,
    } as never);

    const row = db.prepare(
      "SELECT * FROM provider_account WHERE provider_key='whatsapp'",
    ).get();
    expect(row).toBeUndefined();
  });

  it('after disconnect: manager.stop() was called', async () => {
    await handleProviderAccountDisconnect({
      db,
      manager,
      providerKey: 'whatsapp',
      accountId: WA_JID,
    } as never);

    expect(managerStopSpy).toHaveBeenCalledOnce();
  });
});
