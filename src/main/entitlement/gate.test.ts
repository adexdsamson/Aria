/**
 * Plan 08.1-02 Task 5 — assertEntitled tests.
 *
 * Uses an in-memory SQLCipher DB with just the entitlement + entitlement_audit
 * tables (no full migrations path) to keep the test fast and decoupled. The
 * JWT verifier is exercised end-to-end against a freshly generated keypair.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

// Hoisted: store the test public key so the mocked verifier can use it.
const testKeyHolder = vi.hoisted(() => ({
  publicKey: null as unknown,
}));

// Replace the verifier with a test-key-bound implementation. Must come BEFORE
// the gate import so the SUT picks up the mocked module.
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

import { assertEntitled, EntitlementError } from './gate';

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
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  // Also confirm round-trip exports work for the verifier surface
  await exportJWK(publicKey);
  return { privateKey, publicKey };
}

async function mintJwt(
  privateKey: Awaited<ReturnType<typeof makeKey>>['privateKey'],
  claims: Record<string, unknown>,
  opts: { expSec?: number; iss?: string; aud?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(now)
    .setExpirationTime(opts.expSec ?? now + 3600)
    .setIssuer(opts.iss ?? 'aria-license-server')
    .setAudience(opts.aud ?? 'aria-desktop')
    .sign(privateKey);
}

function insertRow(
  db: Db,
  row: Partial<{
    install_id: string;
    tier: 'trial' | 'pro' | 'locked';
    jwt: string | null;
    jwt_iat: string | null;
    jwt_exp: string | null;
    trial_started_at: string | null;
    trial_expires_at: string | null;
    license_key: string | null;
    last_verified_at: string;
  }> = {},
): void {
  db.prepare(
    `INSERT INTO entitlement (
      id, install_id, tier, jwt, jwt_iat, jwt_exp,
      trial_started_at, trial_expires_at, license_key,
      last_verified_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.install_id ?? 'install-test',
    row.tier ?? 'trial',
    row.jwt ?? null,
    row.jwt_iat ?? null,
    row.jwt_exp ?? null,
    row.trial_started_at ?? null,
    row.trial_expires_at ?? null,
    row.license_key ?? null,
    row.last_verified_at ?? new Date().toISOString(),
    new Date().toISOString(),
  );
}

function auditCount(db: Db): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM entitlement_audit`).get() as {
    n: number;
  };
  return r.n;
}

describe('assertEntitled', () => {
  let db: Db;
  let publicKey: Awaited<ReturnType<typeof makeKey>>['publicKey'];
  let privateKey: Awaited<ReturnType<typeof makeKey>>['privateKey'];

  beforeEach(async () => {
    db = freshDb();
    ({ privateKey, publicKey } = await makeKey());
    testKeyHolder.publicKey = publicKey;
  });

  afterEach(() => {
    db.close();
  });

  it('throws no-entitlement when no row exists', async () => {
    await expect(assertEntitled(db, 'email_send')).rejects.toBeInstanceOf(
      EntitlementError,
    );
    try {
      await assertEntitled(db, 'email_send');
    } catch (e) {
      expect((e as EntitlementError).code).toBe('no-entitlement');
    }
    expect(auditCount(db)).toBeGreaterThanOrEqual(2);
  });

  it('allows when trial JWT is valid and active', async () => {
    const trialExpires = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const jwt = await mintJwt(privateKey, {
      tier: 'trial',
      install_id: 'install-test',
      trial_started_at: new Date().toISOString(),
      trial_expires_at: trialExpires,
    });
    insertRow(db, { tier: 'trial', jwt, trial_expires_at: trialExpires });
    await expect(assertEntitled(db, 'email_send')).resolves.toBeUndefined();
  });

  it('throws trial-locked when trial JWT claim expired more than 24h ago', async () => {
    const trialExpiresLongPast = new Date(
      Date.now() - 3 * 86_400_000,
    ).toISOString();
    const jwt = await mintJwt(
      privateKey,
      {
        tier: 'trial',
        install_id: 'install-test',
        trial_started_at: new Date(Date.now() - 65 * 86_400_000).toISOString(),
        trial_expires_at: trialExpiresLongPast,
      },
      { expSec: Math.floor(Date.now() / 1000) + 3600 }, // jwt itself still valid
    );
    insertRow(db, {
      tier: 'trial',
      jwt,
      trial_expires_at: trialExpiresLongPast,
    });
    await expect(assertEntitled(db, 'email_send')).rejects.toMatchObject({
      code: 'trial-locked',
    });
  });

  it('throws jwt-invalid when JWT is tampered', async () => {
    const trialExpires = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const jwt = await mintJwt(privateKey, {
      tier: 'trial',
      install_id: 'install-test',
      trial_started_at: new Date().toISOString(),
      trial_expires_at: trialExpires,
    });
    const tampered = jwt.slice(0, -4) + 'AAAA';
    insertRow(db, { tier: 'trial', jwt: tampered, trial_expires_at: trialExpires });
    await expect(assertEntitled(db, 'email_send')).rejects.toMatchObject({
      code: expect.stringMatching(/jwt-(invalid|expired)/),
    });
  });

  it('allows when pro JWT is valid and in grace window', async () => {
    const jwt = await mintJwt(privateKey, {
      tier: 'pro',
      install_id: 'install-test',
    });
    // last_verified 3 days ago — grace window (24h < x < 14d)
    insertRow(db, {
      tier: 'pro',
      jwt,
      last_verified_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    await expect(assertEntitled(db, 'email_send')).resolves.toBeUndefined();
  });

  it('throws pro-locked once last_verified_at + 14d < now', async () => {
    const jwt = await mintJwt(privateKey, {
      tier: 'pro',
      install_id: 'install-test',
    });
    insertRow(db, {
      tier: 'pro',
      jwt,
      last_verified_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    await expect(assertEntitled(db, 'email_send')).rejects.toMatchObject({
      code: 'pro-locked',
    });
  });

  it('allows during trial-expired-grace (within 24h of expiry)', async () => {
    const trialExpires = new Date(Date.now() - 4 * 3_600_000).toISOString(); // 4h ago
    const jwt = await mintJwt(privateKey, {
      tier: 'trial',
      install_id: 'install-test',
      trial_started_at: new Date(Date.now() - 65 * 86_400_000).toISOString(),
      trial_expires_at: trialExpires,
    });
    insertRow(db, { tier: 'trial', jwt, trial_expires_at: trialExpires });
    await expect(assertEntitled(db, 'email_send')).resolves.toBeUndefined();
  });

  it('SECURITY: tier=pro in row but JWT claims tier=trial (expired) still locks', async () => {
    const trialExpiresLongPast = new Date(
      Date.now() - 3 * 86_400_000,
    ).toISOString();
    // JWT minted with trial tier + expired
    const jwt = await mintJwt(privateKey, {
      tier: 'trial',
      install_id: 'install-test',
      trial_started_at: new Date(Date.now() - 65 * 86_400_000).toISOString(),
      trial_expires_at: trialExpiresLongPast,
    });
    // But the row's tier column is tampered to 'pro' with a fresh
    // last_verified_at — gate MUST ignore the row.tier and trust the JWT.
    insertRow(db, {
      tier: 'pro',
      jwt,
      last_verified_at: new Date().toISOString(),
    });
    await expect(assertEntitled(db, 'email_send')).rejects.toMatchObject({
      code: 'trial-locked',
    });
  });

  it('writes an entitlement_audit row of event=lock on every throw', async () => {
    const before = auditCount(db);
    await expect(assertEntitled(db, 'rag_ask')).rejects.toBeInstanceOf(
      EntitlementError,
    );
    const after = auditCount(db);
    expect(after).toBeGreaterThan(before);
    const row = db
      .prepare(
        `SELECT event, detail FROM entitlement_audit ORDER BY id DESC LIMIT 1`,
      )
      .get() as { event: string; detail: string };
    expect(row.event).toBe('lock');
    const detail = JSON.parse(row.detail);
    expect(detail.action).toBe('rag_ask');
  });
});
