import { describe, it, expect } from 'vitest';
import { deriveDbKey, toPragmaKeyHex, DB_KEY_BYTES } from '../../../../src/main/vault/derive';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_SALT = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

describe('vault/derive', () => {
  it('deriveDbKey returns a 32-byte Buffer', async () => {
    const key = await deriveDbKey(TEST_MNEMONIC, TEST_SALT);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(DB_KEY_BYTES);
  });

  it('deriveDbKey is deterministic for identical inputs', async () => {
    const a = await deriveDbKey(TEST_MNEMONIC, TEST_SALT);
    const b = await deriveDbKey(TEST_MNEMONIC, TEST_SALT);
    expect(a.equals(b)).toBe(true);
  });

  it('deriveDbKey changes when appSalt changes', async () => {
    const a = await deriveDbKey(TEST_MNEMONIC, TEST_SALT);
    const otherSalt = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
    const b = await deriveDbKey(TEST_MNEMONIC, otherSalt);
    expect(a.equals(b)).toBe(false);
  });

  it(
    'deriveDbKey locks a known hex for the BIP39 test-vector mnemonic + fixed salt',
    async () => {
      // KDF parameter lock (T-01-02-02): any drift in scrypt N/r/p, salt
      // handling, or NFKD normalization will break this assertion. This
      // value was captured on the first successful run with
      // scrypt(N=2^15, r=8, p=1) over NFKD(mnemonic) + TEST_SALT.
      const key = await deriveDbKey(TEST_MNEMONIC, TEST_SALT);
      const hex = toPragmaKeyHex(key);
      expect(hex).toHaveLength(64);
      // Snapshot the actual derivation to lock against future drift.
      expect(hex).toMatchSnapshot('abandon-x11-about + fixed-salt scrypt 2^15');
    },
    20_000,
  );

  it('rejects empty mnemonic / empty salt', async () => {
    await expect(deriveDbKey('', TEST_SALT)).rejects.toThrow();
    await expect(deriveDbKey(TEST_MNEMONIC, Buffer.alloc(0))).rejects.toThrow();
  });
});
