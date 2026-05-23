import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  profilePathOf,
  readProfile,
  writeProfileAtomic,
} from '../../../../src/main/profile/store';
import { createTempUserDataDir } from '../../../setup';

describe('profile/store', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempUserDataDir('profile-store');
  });

  it('profilePathOf returns <dataDir>/profile.json', () => {
    expect(profilePathOf(dir)).toBe(path.join(dir, 'profile.json'));
  });

  it('readProfile returns null when file is missing', () => {
    expect(readProfile(dir)).toBeNull();
  });

  it('writeProfileAtomic → readProfile round-trips displayName', () => {
    writeProfileAtomic(dir, { displayName: 'Adex' });
    expect(readProfile(dir)).toEqual({ displayName: 'Adex' });
  });

  it('writeProfileAtomic trims surrounding whitespace before persisting', () => {
    writeProfileAtomic(dir, { displayName: '  Adex  ' });
    expect(readProfile(dir)).toEqual({ displayName: 'Adex' });
  });

  it('writeProfileAtomic rejects empty displayName', () => {
    expect(() => writeProfileAtomic(dir, { displayName: '' })).toThrow();
  });

  it('writeProfileAtomic rejects whitespace-only displayName', () => {
    expect(() => writeProfileAtomic(dir, { displayName: '   ' })).toThrow();
  });

  it('writeProfileAtomic rejects non-string displayName', () => {
    expect(() =>
      writeProfileAtomic(dir, { displayName: 42 as unknown as string }),
    ).toThrow();
  });

  it('readProfile returns null on malformed JSON', () => {
    fs.writeFileSync(profilePathOf(dir), '{ not json', 'utf8');
    expect(readProfile(dir)).toBeNull();
  });

  it('readProfile returns null when displayName is missing', () => {
    fs.writeFileSync(profilePathOf(dir), JSON.stringify({ other: 'x' }), 'utf8');
    expect(readProfile(dir)).toBeNull();
  });

  it('readProfile returns null when displayName is not a string', () => {
    fs.writeFileSync(
      profilePathOf(dir),
      JSON.stringify({ displayName: 42 }),
      'utf8',
    );
    expect(readProfile(dir)).toBeNull();
  });

  it('readProfile returns null when stored displayName is whitespace-only', () => {
    // Bypass the writer's validation by writing the file directly.
    fs.writeFileSync(
      profilePathOf(dir),
      JSON.stringify({ displayName: '   ' }),
      'utf8',
    );
    expect(readProfile(dir)).toBeNull();
  });
});
