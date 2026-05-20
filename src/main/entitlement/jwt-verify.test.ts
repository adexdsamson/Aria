/**
 * Plan 08.1-02 Task 3 — jwt-verify tests.
 *
 * We generate two Ed25519 keypairs at test time and round-trip JWTs signed
 * with each. We override `verifyEntitlementJwt`'s `publicKey` dep to point
 * at the test key (the embedded constant is for production).
 */
import { describe, it, expect, vi } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, importJWK } from 'jose';
import {
  verifyEntitlementJwt,
  ENTITLEMENT_PUBLIC_KEY_HEX,
  _currentServerUrl,
  type EntitlementClaims,
} from './jwt-verify';

async function makeKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  return { privateKey, publicKey };
}

async function makeJwt(
  privateKey: Awaited<ReturnType<typeof makeKeyPair>>['privateKey'],
  claims: Partial<EntitlementClaims> & { tier: 'trial' | 'pro' },
  opts: { iss?: string; aud?: string; expSec?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    install_id: 'install-test',
    ...claims,
  } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(now)
    .setExpirationTime(opts.expSec ?? now + 3600)
    .setIssuer(opts.iss ?? 'aria-license-server')
    .setAudience(opts.aud ?? 'aria-desktop')
    .sign(privateKey);
}

describe('verifyEntitlementJwt', () => {
  it('round-trips a JWT signed by the matched private key', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwt = await makeJwt(privateKey, { tier: 'trial' });
    const claims = await verifyEntitlementJwt(jwt, { publicKey });
    expect(claims.tier).toBe('trial');
    expect(claims.install_id).toBe('install-test');
  });

  it('FAILS verification when signed by a different seed', async () => {
    const goodPair = await makeKeyPair();
    const evilPair = await makeKeyPair();
    const jwt = await makeJwt(evilPair.privateKey, { tier: 'pro' });
    await expect(
      verifyEntitlementJwt(jwt, { publicKey: goodPair.publicKey }),
    ).rejects.toThrow();
  });

  it('FAILS verification when iss claim is wrong', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwt = await makeJwt(privateKey, { tier: 'trial' }, { iss: 'evil' });
    await expect(
      verifyEntitlementJwt(jwt, { publicKey }),
    ).rejects.toThrow(/issuer/i);
  });

  it('FAILS verification when aud claim is wrong', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwt = await makeJwt(
      privateKey,
      { tier: 'trial' },
      { aud: 'aria-evil' },
    );
    await expect(
      verifyEntitlementJwt(jwt, { publicKey }),
    ).rejects.toThrow(/audience/i);
  });

  it('FAILS verification when JWT has expired', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const past = Math.floor(Date.now() / 1000) - 60;
    const jwt = await makeJwt(
      privateKey,
      { tier: 'trial' },
      { expSec: past },
    );
    await expect(
      verifyEntitlementJwt(jwt, { publicKey }),
    ).rejects.toThrow();
  });

  it('rejects unknown tier values', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwt = await makeJwt(privateKey, { tier: 'bogus' as 'pro' });
    await expect(
      verifyEntitlementJwt(jwt, { publicKey }),
    ).rejects.toThrow(/tier/);
  });

  it('exports ENTITLEMENT_PUBLIC_KEY_HEX matching 08.1-01 SUMMARY', () => {
    expect(ENTITLEMENT_PUBLIC_KEY_HEX).toBe(
      '67c9a785e775d3339daa99cecb0f47d7f7e861c31fc113be3e8dca371b6a37f6',
    );
    expect(/^[0-9a-f]{64}$/.test(ENTITLEMENT_PUBLIC_KEY_HEX)).toBe(true);
  });

  it('ARIA_LICENSE_SERVER_OVERRIDE is honored in dev (app.isPackaged === false)', () => {
    const prior = process.env['ARIA_LICENSE_SERVER_OVERRIDE'];
    process.env['ARIA_LICENSE_SERVER_OVERRIDE'] = 'http://localhost:8787';
    try {
      // electron mock in tests/setup defaults app.isPackaged absent => false.
      expect(_currentServerUrl()).toBe('http://localhost:8787');
    } finally {
      if (prior === undefined) delete process.env['ARIA_LICENSE_SERVER_OVERRIDE'];
      else process.env['ARIA_LICENSE_SERVER_OVERRIDE'] = prior;
    }
  });

  it('ARIA_LICENSE_SERVER_OVERRIDE is ignored when app.isPackaged is true', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { isPackaged: true },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString('utf8'),
      },
    }));
    process.env['ARIA_LICENSE_SERVER_OVERRIDE'] = 'http://attacker.example/';
    try {
      const mod = await import('./jwt-verify');
      expect(mod._currentServerUrl()).toBe(
        'https://aria-license-server.adexdsamson.workers.dev',
      );
    } finally {
      delete process.env['ARIA_LICENSE_SERVER_OVERRIDE'];
      vi.resetModules();
      vi.doUnmock('electron');
    }
  });

  // Sanity: make sure the embedded constant decodes to a working OKP/Ed25519 JWK
  it('embedded public key hex decodes to a valid Ed25519 JWK', async () => {
    const hex = ENTITLEMENT_PUBLIC_KEY_HEX;
    const buf = Buffer.from(hex, 'hex');
    const x = buf
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x }, 'EdDSA');
    expect(key).toBeDefined();
    // Round-trip its JWK to ensure crypto subsystem accepted it.
    const back = await exportJWK(key as Awaited<ReturnType<typeof importJWK>>);
    expect(back.crv).toBe('Ed25519');
  });
});
