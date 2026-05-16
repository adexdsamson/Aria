import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createBackup } from '../../../../src/main/db/backup';
import { restoreBackup, RestoreInvalidError } from '../../../../src/main/db/restore';
import { sealVault } from '../../../../src/main/vault/unlock';
import { deriveDbKey } from '../../../../src/main/vault/derive';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WRONG_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const DAILY_PW = 'horse-battery-staple-2';

describe('db/backup + db/restore', () => {
  let dataDir: string;
  let vaultPath: string;
  let appSalt: Buffer;

  beforeEach(async () => {
    dataDir = createTempUserDataDir('aria-db-backup');
    vaultPath = path.join(dataDir, 'vault.json');
    appSalt = crypto.randomBytes(16);
    sealVault(DAILY_PW, MNEMONIC, vaultPath, appSalt);
  });

  it('round-trips a settings row through VACUUM INTO + restoreBackup', async () => {
    const dbKey = await deriveDbKey(MNEMONIC, appSalt);

    // Seed.
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.prepare('INSERT INTO settings(k, v) VALUES (?, ?)').run('theme', 'dark');
    expect(
      (db.prepare('SELECT v FROM settings WHERE k=?').get('theme') as { v: string }).v,
    ).toBe('dark');

    // Backup.
    const backupPath = path.join(dataDir, 'aria-test.ariabackup');
    createBackup(db, { outPath: backupPath });
    expect(fs.existsSync(backupPath)).toBe(true);
    closeDb(db);

    // Open the backup directly with the same key — row must be present.
    const verifyDir = createTempUserDataDir('aria-db-verify');
    fs.copyFileSync(backupPath, path.join(verifyDir, 'aria.db'));
    const verifyDb = openDb({ dataDir: verifyDir, dbKey, runMigrationsOnOpen: false });
    const row = verifyDb.prepare('SELECT v FROM settings WHERE k=?').get('theme') as
      | { v: string }
      | undefined;
    expect(row?.v).toBe('dark');
    closeDb(verifyDb);

    // Remove the live aria.db, then restore: result is the backup contents.
    const livePath = path.join(dataDir, 'aria.db');
    fs.unlinkSync(livePath);
    // Drop sidecar journal/wal files so the restore replaces a clean slate.
    for (const ext of ['-shm', '-wal', '-journal']) {
      const side = livePath + ext;
      if (fs.existsSync(side)) fs.unlinkSync(side);
    }

    const result = await restoreBackup({
      dataDir,
      backupPath,
      mnemonic: MNEMONIC,
      dailyPassword: DAILY_PW,
    });
    expect(result.ok).toBe(true);

    const restored = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    const restoredRow = restored
      .prepare('SELECT v FROM settings WHERE k=?')
      .get('theme') as { v: string } | undefined;
    expect(restoredRow?.v).toBe('dark');
    closeDb(restored);
  });

  it('wrong mnemonic throws RestoreInvalidError and aria.db is unchanged', async () => {
    const dbKey = await deriveDbKey(MNEMONIC, appSalt);
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.prepare('INSERT INTO settings(k, v) VALUES (?, ?)').run('marker', 'live-db-row');

    const backupPath = path.join(dataDir, 'aria-test.ariabackup');
    createBackup(db, { outPath: backupPath });
    closeDb(db);

    const livePath = path.join(dataDir, 'aria.db');
    const liveHashBefore = crypto
      .createHash('sha256')
      .update(fs.readFileSync(livePath))
      .digest('hex');

    await expect(
      restoreBackup({
        dataDir,
        backupPath,
        mnemonic: WRONG_MNEMONIC,
        dailyPassword: DAILY_PW,
      }),
    ).rejects.toBeInstanceOf(RestoreInvalidError);

    const liveHashAfter = crypto
      .createHash('sha256')
      .update(fs.readFileSync(livePath))
      .digest('hex');
    expect(liveHashAfter).toBe(liveHashBefore);
  });

  it('createBackup refuses to overwrite without { overwrite: true }', async () => {
    const dbKey = await deriveDbKey(MNEMONIC, appSalt);
    const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    const outPath = path.join(dataDir, 'b.ariabackup');
    createBackup(db, { outPath });
    expect(() => createBackup(db, { outPath })).toThrow();
    createBackup(db, { outPath, overwrite: true });
    closeDb(db);
  });
});
