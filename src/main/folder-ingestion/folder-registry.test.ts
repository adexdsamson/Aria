/**
 * Plan 10-01 Task 2 — FolderRegistry tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createFolderRegistry } from './folder-registry';
import { createTempUserDataDir } from '../../../tests/setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

describe('FolderRegistry', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-registry-test');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
    db.pragma('foreign_keys=ON');
  });

  it('addFolder, listFolders roundtrip', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/docs', label: 'My Docs', sensitivity: 'general' });
    expect(folder.id).toBeTruthy();
    expect(folder.path).toBe('/tmp/docs');
    expect(folder.sensitivity).toBe('general');
    expect(folder.status).toBe('active');

    const folders = registry.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]!.path).toBe('/tmp/docs');
  });

  it('addFile, listFilesForFolder roundtrip', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/docs', label: 'Docs', sensitivity: 'general' });
    const file = registry.addFile({
      folderId: folder.id,
      relativePath: 'report.md',
      absolutePath: '/tmp/docs/report.md',
      size: 1024,
      mtime: new Date().toISOString(),
    });
    expect(file.status).toBe('pending');
    expect(file.folder_id).toBe(folder.id);

    const files = registry.listFilesForFolder(folder.id);
    expect(files).toHaveLength(1);
    expect(files[0]!.relative_path).toBe('report.md');
  });

  it('removeFolder cascades to knowledge_files', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/cascade', label: 'Cascade', sensitivity: 'general' });
    registry.addFile({ folderId: folder.id, relativePath: 'a.txt', absolutePath: '/tmp/cascade/a.txt', size: 100, mtime: new Date().toISOString() });
    registry.addFile({ folderId: folder.id, relativePath: 'b.txt', absolutePath: '/tmp/cascade/b.txt', size: 200, mtime: new Date().toISOString() });

    registry.removeFolder(folder.id);

    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_files WHERE folder_id=?').get(folder.id) as { n: number }
    ).n;
    expect(count).toBe(0);
  });

  it('sumBytesForFolder includes rows with status=error (no status filter)', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/bytes', label: 'Bytes', sensitivity: 'general' });
    const file = registry.addFile({ folderId: folder.id, relativePath: 'big.pdf', absolutePath: '/tmp/bytes/big.pdf', size: 1000, mtime: new Date().toISOString() });
    registry.markFileError(file.id, 'parse failed');

    // error-status file must still be included in the sum
    const bytes = registry.sumBytesForFolder(folder.id);
    expect(bytes).toBe(1000);
  });

  it('sumBytesForFolder has no AND status filter on the query', () => {
    // Grep-style acceptance: verify the SQL used in sumBytesForFolder does not filter by status.
    // The easiest way is to verify the behavior: add files in multiple statuses.
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/mix', label: 'Mix', sensitivity: 'general' });
    const f1 = registry.addFile({ folderId: folder.id, relativePath: 'a.txt', absolutePath: '/tmp/mix/a.txt', size: 100, mtime: new Date().toISOString() });
    const f2 = registry.addFile({ folderId: folder.id, relativePath: 'b.txt', absolutePath: '/tmp/mix/b.txt', size: 200, mtime: new Date().toISOString() });
    const f3 = registry.addFile({ folderId: folder.id, relativePath: 'c.txt', absolutePath: '/tmp/mix/c.txt', size: 300, mtime: new Date().toISOString() });

    registry.markFileIndexed(f1.id);
    registry.markFileError(f2.id, 'err');
    registry.tombstoneFile(f3.id);

    expect(registry.sumBytesForFolder(folder.id)).toBe(600);
  });

  it('markFileIndexed / markFileError / tombstoneFile / resurrectFile state transitions', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/states', label: 'States', sensitivity: 'general' });
    const file = registry.addFile({ folderId: folder.id, relativePath: 'f.txt', absolutePath: '/tmp/states/f.txt', size: 50, mtime: new Date().toISOString() });

    registry.markFileIndexed(file.id);
    expect((registry.listFilesForFolder(folder.id)[0]!).status).toBe('indexed');

    registry.markFileError(file.id, 'oops');
    const errFile = registry.listFilesForFolder(folder.id)[0]!;
    expect(errFile.status).toBe('error');
    expect(errFile.last_error).toBe('oops');

    registry.tombstoneFile(file.id);
    const tombFile = registry.listFilesForFolder(folder.id)[0]!;
    expect(tombFile.status).toBe('tombstoned');
    expect(tombFile.tombstoned_at).not.toBeNull();

    registry.resurrectFile(file.id);
    expect((registry.listFilesForFolder(folder.id)[0]!).status).toBe('pending');
  });

  it('setSensitivity updates knowledge_folders row only', () => {
    const registry = createFolderRegistry(db);
    const folder = registry.addFolder({ path: '/tmp/sens', label: 'Sensitive', sensitivity: 'general' });
    registry.setSensitivity(folder.id, 'sensitive');
    const updated = registry.getFolder(folder.id)!;
    expect(updated.sensitivity).toBe('sensitive');
  });
});
