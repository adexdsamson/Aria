import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  validateMnemonic,
  pickConfirmPositions,
} from '../../../../src/main/vault/mnemonic';
import { wordlist } from '@scure/bip39/wordlists/english.js';

describe('vault/mnemonic', () => {
  it('generateMnemonic returns 12 English BIP39 words that pass validation', () => {
    const phrase = generateMnemonic();
    const words = phrase.split(' ');
    expect(words).toHaveLength(12);
    for (const w of words) expect(wordlist).toContain(w);
    expect(validateMnemonic(phrase)).toBe(true);
  });

  it('validateMnemonic rejects a phrase with one altered word', () => {
    const phrase = generateMnemonic();
    const words = phrase.split(' ');
    // Swap last word for a different valid wordlist entry (likely fails checksum).
    const alt = wordlist[(wordlist.indexOf(words[11]!) + 7) % wordlist.length]!;
    words[11] = alt;
    const tampered = words.join(' ');
    // We don't care which path fails — checksum or wordcount — only that
    // validateMnemonic does NOT return true for the tampered phrase.
    expect(validateMnemonic(tampered)).toBe(false);
  });

  it('validateMnemonic rejects nonsense input', () => {
    expect(validateMnemonic('')).toBe(false);
    expect(validateMnemonic('not a valid phrase')).toBe(false);
    expect(validateMnemonic('abandon '.repeat(11).trim())).toBe(false); // 11 words
  });

  it('pickConfirmPositions returns 3 distinct sorted indices in [0,11]', () => {
    for (let i = 0; i < 50; i++) {
      const positions = pickConfirmPositions();
      expect(positions).toHaveLength(3);
      const [a, b, c] = positions;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(11);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
      expect(new Set(positions).size).toBe(3);
    }
  });

  it('pickConfirmPositions accepts an injected RNG (determinism)', () => {
    const queue = [3, 3, 7, 1];
    const rng = (): number => queue.shift()!;
    expect(pickConfirmPositions(rng)).toEqual([1, 3, 7]);
  });
});
