/**
 * Atomic read/write helpers for `profile.json`.
 *
 * Holds the user-supplied display name collected on the first step of
 * onboarding. Lives in `<dataDir>/profile.json` as a sibling to `vault.json`
 * so it is readable BEFORE the encrypted DB is opened — UnlockScreen needs
 * it to render the personalized greeting.
 *
 * Plaintext storage rationale: a first name has sensitivity comparable to
 * the news country/sector bundle already accepted by the app. The vault.json
 * schema is locked (v: 1, key-storage manifest only) so the name does not
 * belong there.
 *
 * Quick task 260523-eaf — design spec at
 * docs/superpowers/specs/2026-05-23-onboarding-name-personalization-design.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Profile {
  displayName: string;
}

/** `<dataDir>/profile.json` */
export function profilePathOf(dataDir: string): string {
  return path.join(dataDir, 'profile.json');
}

/**
 * Read profile.json. Returns `null` for any failure mode — missing file,
 * unreadable bytes, JSON parse error, or schema mismatch. Never throws,
 * because callers (PROFILE_GET) may run pre-unlock and the UnlockScreen
 * gracefully falls back to a generic greeting on `null`.
 */
export function readProfile(dataDir: string): Profile | null {
  const p = profilePathOf(dataDir);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['displayName'] !== 'string'
  ) {
    return null;
  }
  const displayName = (parsed as { displayName: string }).displayName;
  if (displayName.trim().length === 0) return null;
  return { displayName };
}

/**
 * Atomically write profile.json: serialize to a sibling `.tmp` file then
 * rename over the destination. Same idiom as writeVaultJsonAtomic.
 *
 * Throws on invalid input — the IPC handler catches and surfaces a
 * structured error to the renderer.
 */
export function writeProfileAtomic(dataDir: string, profile: Profile): void {
  if (typeof profile.displayName !== 'string') {
    throw new Error('writeProfileAtomic: displayName must be a string');
  }
  const trimmed = profile.displayName.trim();
  if (trimmed.length === 0) {
    throw new Error('writeProfileAtomic: displayName must be non-empty after trim');
  }
  const p = profilePathOf(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ displayName: trimmed }), { encoding: 'utf8' });
  fs.renameSync(tmp, p);
}
