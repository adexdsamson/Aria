// PHASE-8 PRE-RELEASE: un-skip and run against packaged build
/**
 * Plan 08-04 Task 4 Test 9 — end-to-end close→rename→reopen with held key.
 *
 * This integration test exercises the full happy path with a real
 * SQLCipher DB (a) open the vault, (b) capture pre-migration backup,
 * (c) force migration throw, (d) restore + reopen with the SAME cached
 * key (assert reference equality — NOT a re-prompt), (e) verify pre-throw
 * marker still readable.
 *
 * Currently deferred under the same Electron-ABI lock that affected
 * 08-01/02/03: the Aria desktop app holds the native-binary lock so
 * better-sqlite3-multiple-ciphers cannot be loaded in a Node test
 * harness while the app is running. Un-skip as part of the final
 * release-verification human checkpoint.
 */
import { describe, it } from 'vitest';

describe.skip('Plan 08-04 Task 4 Test 9 — full restore round-trip (integration)', () => {
  it('TODO: open vault → write marker → snapshot → force throw → restoreFromBackup → marker still readable', () => {
    // Implemented in Phase-8 pre-release pass — see file header.
  });
});
