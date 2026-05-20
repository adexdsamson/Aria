/**
 * Plan 08.1-02 Task 7 — EntitlementService tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { SignJWT, generateKeyPair } from 'jose';

const testKeyHolder = vi.hoisted(() => ({
  publicKey: null as unknown,
}));

vi.mock('./jwt-verify', async () => {
  const real = (await vi.importActual('./jwt-verify')) as typeof import('./jwt-verify');
  return {
    ...real,
    verifyEntitlementJwt: async (jwt: string) =>
      real.verifyEntitlementJwt(jwt, {
        publicKey: testKeyHolder.publicKey as Parameters<
          typeof real.verifyEntitlementJwt
        >[1] extends { publicKey?: infer P } | undefined
          ? P
          : never,
      }),
  };
});

import { EntitlementService } from './service';
import { LicenseServerClient, LicenseServerError } from './license-server-client';

type Db = Database.Database;

const SCHEMA = `
CREATE TABLE entitlement (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  install_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  jwt TEXT,
  jwt_iat TEXT,
  jwt_exp TEXT,
  trial_started_at TEXT,
  trial_expires_at TEXT,
  license_key TEXT,
  last_verified_at TEXT NOT NULL,
  last_check_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE entitlement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  detail TEXT
);
`;

function freshDb(): Db {
  const db = new Database(':memory:') as unknown as Db;
  db.exec(SCHEMA);
  return db;
}

async function makeKey() {
  return generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
}

async function mintTrialJwt(priv: Awaited<ReturnType<typeof makeKey>>['privateKey']) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    install_id: 'install-test',
    tier: 'trial',
    trial_started_at: new Date(now * 1000).toISOString(),
    trial_expires_at: new Date((now + 60 * 86400) * 1000).toISOString(),
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(now)
    .setExpirationTime(now + 7 * 86400)
    .setIssuer('aria-license-server')
    .setAudience('aria-desktop')
    .sign(priv);
}

async function mintProJwt(priv: Awaited<ReturnType<typeof makeKey>>['privateKey']) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    install_id: 'install-test',
    tier: 'pro',
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(now)
    .setExpirationTime(now + 7 * 86400)
    .setIssuer('aria-license-server')
    .setAudience('aria-desktop')
    .sign(priv);
}

function auditRows(db: Db) {
  return db
    .prepare(`SELECT event, detail FROM entitlement_audit ORDER BY id ASC`)
    .all() as Array<{ event: string; detail: string | null }>;
}

describe('EntitlementService', () => {
  let db: Db;
  let publicKey: Awaited<ReturnType<typeof makeKey>>['publicKey'];
  let privateKey: Awaited<ReturnType<typeof makeKey>>['privateKey'];
  let installIdProvider: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = freshDb();
    ({ privateKey, publicKey } = await makeKey());
    testKeyHolder.publicKey = publicKey;
    installIdProvider = vi.fn(async () => 'install-test');
  });

  afterEach(() => {
    db.close();
  });

  it('first-launch bootstrap calls startTrial once and seeds the row', async () => {
    const trialJwt = await mintTrialJwt(privateKey);
    const client = {
      startTrial: vi.fn(async () => ({
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: trialJwt,
      })),
    } as unknown as LicenseServerClient;

    const svc = new EntitlementService({
      db,
      client,
      installIdProvider,
    });
    await svc.bootstrap();

    expect(client.startTrial).toHaveBeenCalledTimes(1);
    const row = db.prepare('SELECT * FROM entitlement WHERE id = 1').get();
    expect(row).toBeTruthy();
    expect(auditRows(db).map((r) => r.event)).toContain('trial-start');
  });

  it('second-launch bootstrap is a no-op when the row already exists', async () => {
    const trialJwt = await mintTrialJwt(privateKey);
    const client = {
      startTrial: vi.fn(async () => ({
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: trialJwt,
      })),
    } as unknown as LicenseServerClient;
    const svc = new EntitlementService({ db, client, installIdProvider });
    await svc.bootstrap();
    await svc.bootstrap();
    expect(client.startTrial).toHaveBeenCalledTimes(1);
  });

  it('concurrent bootstrap calls share the same in-flight promise', async () => {
    const trialJwt = await mintTrialJwt(privateKey);
    let startCalls = 0;
    const client = {
      startTrial: vi.fn(async () => {
        startCalls++;
        await new Promise((r) => setTimeout(r, 5));
        return { trial_started_at: '2026-05-20T00:00:00.000Z', jwt: trialJwt };
      }),
    } as unknown as LicenseServerClient;
    const svc = new EntitlementService({ db, client, installIdProvider });
    await Promise.all([svc.bootstrap(), svc.bootstrap(), svc.bootstrap()]);
    expect(startCalls).toBe(1);
  });

  it('cold-start trial-start failure leaves NO row and surfaces the error', async () => {
    const client = {
      startTrial: vi.fn(async () => {
        throw new LicenseServerError('server-error', 'boom', 500);
      }),
    } as unknown as LicenseServerClient;
    const svc = new EntitlementService({ db, client, installIdProvider });
    await expect(svc.bootstrap()).rejects.toBeInstanceOf(LicenseServerError);
    const row = db.prepare('SELECT * FROM entitlement WHERE id = 1').get();
    expect(row).toBeFalsy();
    expect(auditRows(db).map((r) => r.event)).toContain('refresh-fail');
  });

  it('refresh updates last_verified_at and jwt', async () => {
    const trialJwt = await mintTrialJwt(privateKey);
    const client = {
      startTrial: vi.fn(async () => ({
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: trialJwt,
      })),
      refresh: vi.fn(async () => ({ jwt: trialJwt })),
    } as unknown as LicenseServerClient;
    const svc = new EntitlementService({ db, client, installIdProvider });
    await svc.bootstrap();
    const before = db
      .prepare('SELECT last_verified_at FROM entitlement WHERE id = 1')
      .get() as { last_verified_at: string };
    await new Promise((r) => setTimeout(r, 10));
    await svc.refresh();
    const after = db
      .prepare('SELECT last_verified_at FROM entitlement WHERE id = 1')
      .get() as { last_verified_at: string };
    expect(after.last_verified_at).not.toBe(before.last_verified_at);
    expect(auditRows(db).map((r) => r.event)).toContain('refresh-success');
  });

  it('activate replaces JWT and sets tier=pro', async () => {
    const trialJwt = await mintTrialJwt(privateKey);
    const proJwt = await mintProJwt(privateKey);
    const client = {
      startTrial: vi.fn(async () => ({
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: trialJwt,
      })),
      activate: vi.fn(async () => ({ jwt: proJwt })),
    } as unknown as LicenseServerClient;
    const svc = new EntitlementService({ db, client, installIdProvider });
    await svc.bootstrap();
    await svc.activate('ARIA-XXX-YYYY');
    const row = db
      .prepare('SELECT tier, license_key, jwt FROM entitlement WHERE id = 1')
      .get() as { tier: string; license_key: string; jwt: string };
    expect(row.tier).toBe('pro');
    expect(row.license_key).toBe('ARIA-XXX-YYYY');
    expect(row.jwt).toBe(proJwt);
    expect(auditRows(db).map((r) => r.event)).toContain('activate-success');
  });
});
