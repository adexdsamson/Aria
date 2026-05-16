/**
 * BIP39 mnemonic generation + validation + 3-word confirm-position picker.
 *
 * Wraps @scure/bip39 with the English wordlist at strength 128 (12 words).
 * Never logs the mnemonic — callers must keep it main-RAM only.
 */
import * as crypto from 'node:crypto';
import {
  generateMnemonic as bip39Generate,
  validateMnemonic as bip39Validate,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** Generate a 12-word English BIP39 mnemonic (128 bits of entropy). */
export function generateMnemonic(): string {
  return bip39Generate(wordlist, 128);
}

/**
 * Validate a 12-word English BIP39 mnemonic. Returns true only when the word
 * count is exactly 12, every word is in the English list, and the BIP39
 * checksum bits match.
 */
export function validateMnemonic(phrase: string): boolean {
  if (typeof phrase !== 'string') return false;
  const trimmed = phrase.trim().split(/\s+/u);
  if (trimmed.length !== 12) return false;
  return bip39Validate(trimmed.join(' '), wordlist);
}

/**
 * Pick 3 distinct sorted indices in [0,11] for the D-03 3-word confirm
 * challenge. Defaults to a `crypto.randomInt`-backed RNG; tests may inject a
 * deterministic source for reproducibility.
 */
export function pickConfirmPositions(
  rng: () => number = () => crypto.randomInt(0, 12),
): [number, number, number] {
  const picked = new Set<number>();
  while (picked.size < 3) {
    const n = rng();
    if (Number.isInteger(n) && n >= 0 && n <= 11) picked.add(n);
  }
  const sorted = [...picked].sort((a, b) => a - b);
  return [sorted[0]!, sorted[1]!, sorted[2]!];
}
