/**
 * R-WA01 — session-manager.ts QR-push unit spec.
 *
 * Asserts:
 *   1. A fake connection.update carrying a `qr` string drives a
 *      WHATSAPP_QR_UPDATE push whose payload is a `data:image/...` data-URL
 *      with an expiry.
 *   2. A `connection==='open'` event upserts a provider_account row
 *      (account_id = creds.me.id JID) and emits WHATSAPP_STATE_CHANGED
 *      status='ok'.
 *
 * This spec RED-fails until Plan 20-04 (session-manager.ts) lands.
 * Run: npx vitest run tests/unit/main/whatsapp/whatsapp-session.spec.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { CHANNELS } from '../../../../src/shared/ipc-contract';

// Module under test — does not exist yet; RED-fails until Plan 20-04 lands.
import { WhatsAppSessionManager } from '../../../../src/main/whatsapp/session-manager';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('session-manager.ts — QR push + connection open (R-WA01)', () => {
  let db: ReturnType<typeof openDb>;
  let pushEvents: Array<{ channel: string; payload: unknown }>;
  let pushFn: ReturnType<typeof vi.fn>;
  let schedulerMock: {
    cronRegistry: Map<string, unknown>;
    queue: { add: ReturnType<typeof vi.fn> };
  };
  let loggerMock: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-session');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    pushEvents = [];
    pushFn = vi.fn((channel: string, payload: unknown) => {
      pushEvents.push({ channel, payload });
    });

    schedulerMock = {
      cronRegistry: new Map(),
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

  it('QR string from connection.update drives WHATSAPP_QR_UPDATE push with data-URL payload', async () => {
    // Mock the Baileys makeWASocket to simulate connection.update.qr
    const connectionUpdateCallbacks: Array<(update: unknown) => void> = [];
    const mockSocket = {
      ev: {
        on: vi.fn((event: string, cb: (update: unknown) => void) => {
          if (event === 'connection.update') connectionUpdateCallbacks.push(cb);
        }),
        off: vi.fn(),
      },
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      end: vi.fn(),
    };

    const manager = new WhatsAppSessionManager({
      db,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
      emitToRenderer: pushFn,
      _socketFactory: () => mockSocket as never, // test-injectable socket factory
    });

    await manager.start();

    // Simulate a QR update from Baileys
    const fakeQrString = 'fake-qr-data-123';
    for (const cb of connectionUpdateCallbacks) {
      cb({ qr: fakeQrString });
    }

    // Allow any async operations to settle
    await new Promise((r) => setTimeout(r, 0));

    const qrPushes = pushEvents.filter((e) => e.channel === CHANNELS.WHATSAPP_QR_UPDATE);
    expect(qrPushes.length).toBeGreaterThan(0);

    const qrPayload = qrPushes[0]!.payload as { dataUrl?: string; expiresAt?: number };
    expect(qrPayload.dataUrl).toBeDefined();
    expect(qrPayload.dataUrl).toMatch(/^data:image\//);
    expect(typeof qrPayload.expiresAt).toBe('number');
  });

  it('connection:open event upserts provider_account row with status=ok', async () => {
    const connectionUpdateCallbacks: Array<(update: unknown) => void> = [];
    const mockSocket = {
      ev: {
        on: vi.fn((event: string, cb: (update: unknown) => void) => {
          if (event === 'connection.update') connectionUpdateCallbacks.push(cb);
        }),
        off: vi.fn(),
      },
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      end: vi.fn(),
      authState: {
        creds: { me: { id: '+1234567890@s.whatsapp.net', name: 'Test User' } },
      },
    };

    const manager = new WhatsAppSessionManager({
      db,
      scheduler: schedulerMock as never,
      logger: loggerMock as never,
      emitToRenderer: pushFn,
      _socketFactory: () => mockSocket as never,
    });

    await manager.start();

    // Simulate connection:open
    for (const cb of connectionUpdateCallbacks) {
      cb({ connection: 'open' });
    }

    await new Promise((r) => setTimeout(r, 10));

    // Check provider_account row was upserted
    const row = db.prepare("SELECT * FROM provider_account WHERE provider_key='whatsapp'").get() as
      | { account_id: string; status: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.status).toBe('ok');

    // Check WHATSAPP_STATE_CHANGED push was emitted
    const statePushes = pushEvents.filter((e) => e.channel === CHANNELS.WHATSAPP_STATE_CHANGED);
    expect(statePushes.length).toBeGreaterThan(0);
    const statePayload = statePushes[0]!.payload as { status?: string };
    expect(statePayload.status).toBe('ok');
  });
});
