/**
 * Plan 10-02 Task 3 — Boot reconciler tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { runBootReconciliation } from './boot-reconciler';
import type { FolderRegistry, FileRow, FolderRow } from './folder-registry';
import type { FolderIngestionService } from './ingestion-service';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `aria-reconciler-test-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('runBootReconciliation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ingests new and changed files; tombstones missing files', async () => {
    const folderId = 'folder-1';
    const now = new Date().toISOString();
    const oldMtime = new Date(Date.now() - 60_000).toISOString();

    // On disk: file1 (new), file2 (changed mtime), file3+file4 (unchanged)
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'new file');
    fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'changed');
    fs.writeFileSync(path.join(tmpDir, 'file3.txt'), 'unchanged');
    fs.writeFileSync(path.join(tmpDir, 'file4.txt'), 'unchanged');

    // Registry: file2 (with old mtime → changed), file3, file4 (unchanged), file5 (missing)
    const registryFiles: FileRow[] = [
      {
        id: 'f2', folder_id: folderId, relative_path: 'file2.txt', absolute_path: path.join(tmpDir, 'file2.txt'),
        size: 7, mtime: oldMtime, content_hash: null, status: 'indexed', last_error: null,
        tombstoned_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'f3', folder_id: folderId, relative_path: 'file3.txt', absolute_path: path.join(tmpDir, 'file3.txt'),
        size: 9, mtime: fs.statSync(path.join(tmpDir, 'file3.txt')).mtime.toISOString(),
        content_hash: null, status: 'indexed', last_error: null, tombstoned_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'f4', folder_id: folderId, relative_path: 'file4.txt', absolute_path: path.join(tmpDir, 'file4.txt'),
        size: 9, mtime: fs.statSync(path.join(tmpDir, 'file4.txt')).mtime.toISOString(),
        content_hash: null, status: 'indexed', last_error: null, tombstoned_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'f5', folder_id: folderId, relative_path: 'file5.txt', absolute_path: path.join(tmpDir, 'file5.txt'),
        size: 5, mtime: now, content_hash: null, status: 'indexed', last_error: null,
        tombstoned_at: null, created_at: now, updated_at: now,
      },
    ];

    const folder: FolderRow = { id: folderId, path: tmpDir, label: 'Test', sensitivity: 'general', status: 'active', last_scan_at: null, last_error: null, created_at: now, updated_at: now };

    const tombstoneFileCalls: string[] = [];
    const ingestFileCalls: string[] = [];

    const registry: FolderRegistry = {
      addFolder: vi.fn(),
      listFolders: vi.fn().mockReturnValue([folder]),
      getFolder: vi.fn().mockReturnValue(folder),
      removeFolder: vi.fn(),
      setSensitivity: vi.fn(),
      addFile: vi.fn().mockReturnValue({ id: 'new-file', folder_id: folderId, relative_path: 'file1.txt', absolute_path: path.join(tmpDir, 'file1.txt'), size: 8, mtime: now, content_hash: null, status: 'pending', last_error: null, tombstoned_at: null, created_at: now, updated_at: now }),
      markFileIndexed: vi.fn(),
      markFileError: vi.fn(),
      tombstoneFile: vi.fn().mockImplementation((id) => tombstoneFileCalls.push(id)),
      resurrectFile: vi.fn(),
      listFilesForFolder: vi.fn().mockReturnValue(registryFiles),
      sumBytesForFolder: vi.fn().mockReturnValue(0),
    };

    const ingestionService: FolderIngestionService = {
      ingestFolderOnce: vi.fn().mockResolvedValue({ indexed: 0, errors: 0 }),
      ingestFile: vi.fn().mockImplementation(async (_fid, absPath) => { ingestFileCalls.push(absPath); }),
    };

    const result = await runBootReconciliation({
      registry,
      ingestionService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger,
    });

    // file1 (new) and file2 (changed mtime) should be ingested
    expect(ingestFileCalls).toContain(path.join(tmpDir, 'file1.txt'));
    expect(ingestFileCalls).toContain(path.join(tmpDir, 'file2.txt'));
    // file3 and file4 unchanged — should NOT be ingested
    expect(ingestFileCalls).not.toContain(path.join(tmpDir, 'file3.txt'));
    expect(ingestFileCalls).not.toContain(path.join(tmpDir, 'file4.txt'));
    // file5 is missing on disk — should be tombstoned
    expect(tombstoneFileCalls).toContain('f5');

    expect(result.ingested).toBe(2);
    expect(result.tombstoned).toBe(1);
  });
});
