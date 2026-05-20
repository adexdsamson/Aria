/**
 * Plan 08.1-02 Task 3 — Ed25519 JWT verification against the embedded license-
 * server public key.
 *
 * The public key + license-server URL are baked in at build time. Rotation
 * requires shipping a new Aria release. RESEARCH §1 documents a 7d server-side
 * double-sign window for rotation (server signs with BOTH old + new keys
 * during the overlap so older Aria builds keep verifying).
 *
 * SECURITY INVARIANT (RESEARCH §8 / Plan 08.1-02 gate.ts):
 *   `verifyEntitlementJwt` MUST be called on EVERY entitlement gate check.
 *   Do NOT cache a "valid" boolean — caching defeats the SQLCipher-tampering
 *   defense (an attacker who flips `tier = 'pro'` in the row should not have
 *   any cached truthy value to ride on).
 */
import { jwtVerify, importJWK, type JWTPayload, type KeyLike } from 'jose';

/**
 * Embedded Ed25519 public key (hex, 32 bytes raw) — from 08.1-01-SUMMARY.md.
 * Rotation = ship a new Aria release; coordinate with a 7d server-side
 * double-sign overlap window (RESEARCH §1).
 */
export const ENTITLEMENT_PUBLIC_KEY_HEX =
  '67c9a785e775d3339daa99cecb0f47d7f7e861c31fc113be3e8dca371b6a37f6';

/**
 * License server base URL. Production = the deployed Cloudflare Worker. Dev
 * builds may override via `ARIA_LICENSE_SERVER_OVERRIDE` env var so the user
 * can point at a `wrangler dev` instance. Production (packaged) builds
 * REFUSE the override — a tampered prod build cannot redirect entitlement
 * traffic to an attacker-controlled host.
 */
const PROD_URL = 'https://aria-license-server.adexdsamson.workers.dev';

function isPackagedBuild(): boolean {
  // Lazy require because non-Electron contexts (CLI scripts, some tests) may
  // import this module without electron available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as { app?: { isPackaged?: boolean } };
    return Boolean(app?.isPackaged);
  } catch {
    return false;
  }
}

function resolveServerUrl(): string {
  const override = process.env['ARIA_LICENSE_SERVER_OVERRIDE'];
  if (override && !isPackagedBuild()) return override;
  return PROD_URL;
}

export const LICENSE_SERVER_URL: string = resolveServerUrl();

/**
 * Re-evaluate the server URL — exported so tests that mutate
 * `process.env.ARIA_LICENSE_SERVER_OVERRIDE` after import can observe the
 * current resolution. Production code should NEVER need this.
 */
export function _currentServerUrl(): string {
  return resolveServerUrl();
}

export interface EntitlementClaims extends JWTPayload {
  /** "trial" | "pro" — claim-side tier, the only trustworthy source. */
  tier: 'trial' | 'pro';
  /** install_id this JWT was minted for. */
  install_id: string;
  /** ISO8601 — only present on trial JWTs. */
  trial_started_at?: string;
  /** ISO8601 — only present on trial JWTs. */
  trial_expires_at?: string;
  /** sha256(license_key) — only present on pro JWTs. */
  license_key_hash?: string;
  features?: string[];
}

function hexToBase64Url(hex: string): string {
  const buf = Buffer.from(hex, 'hex');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let _publicKeyPromise: Promise<KeyLike | Uint8Array> | null = null;

function getPublicKey(): Promise<KeyLike | Uint8Array> {
  if (_publicKeyPromise) return _publicKeyPromise;
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: hexToBase64Url(ENTITLEMENT_PUBLIC_KEY_HEX),
  };
  _publicKeyPromise = importJWK(jwk, 'EdDSA') as Promise<KeyLike | Uint8Array>;
  return _publicKeyPromise;
}

/**
 * Test-only: reset cached imported key (for swapping the embedded constant in
 * unit tests). Production code MUST NOT call this.
 */
export function _resetPublicKeyCacheForTests(): void {
  _publicKeyPromise = null;
}

const EXPECTED_ISS = 'aria-license-server';
const EXPECTED_AUD = 'aria-desktop';

/**
 * Verify an entitlement JWT. Throws on any signature, iss, aud, or exp
 * problem. Returns typed claims on success.
 *
 * IMPORTANT: callers (gate.ts) MUST re-derive trial/pro tier from the returned
 * claims, NOT from the local DB row's `tier` column. The row column is
 * tamperable; the JWT signature is the trust root.
 */
export async function verifyEntitlementJwt(
  jwt: string,
  opts: { publicKey?: KeyLike | Uint8Array } = {},
): Promise<EntitlementClaims> {
  const key = opts.publicKey ?? (await getPublicKey());
  const { payload } = await jwtVerify(jwt, key, {
    issuer: EXPECTED_ISS,
    audience: EXPECTED_AUD,
  });
  const claims = payload as EntitlementClaims;
  if (claims.tier !== 'trial' && claims.tier !== 'pro') {
    throw new Error(`entitlement-jwt: unknown tier "${claims.tier}"`);
  }
  if (typeof claims.install_id !== 'string' || claims.install_id.length === 0) {
    throw new Error('entitlement-jwt: missing install_id claim');
  }
  return claims;
}
