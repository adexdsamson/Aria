/**
 * Plan 10-01 Task 2 — FolderRegistry.
 *
 * CRUD over knowledge_folders and knowledge_files. All writes use synchronous
 * prepared statements (better-sqlite3 pattern for Electron main process).
 *
 * sumBytesForFolder: intentionally has NO status filter — a 50 MB file that
 * failed to parse still takes 50 MB on disk.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import * as crypto from 'node:crypto';

type Db = Database.Database;

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export interface FolderRow {
  id: string;
  path: string;
  label: string;
  sensitivity: 'general' | 'sensitive';
  status: 'active' | 'paused' | 'error';
  last_scan_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileRow {
  id: string;
  folder_id: string;
  relative_path: string;
  absolute_path: string;
  size: number;
  mtime: string;
  content_hash: string | null;
  status: 'pending' | 'indexed' | 'error' | 'tombstoned' | 'skipped';
  last_error: string | null;
  tombstoned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderRegistry {
  addFolder(opts: { path: string; label: string; sensitivity: 'general' | 'sensitive' }): FolderRow;
  listFolders(): FolderRow[];
  getFolder(id: string): FolderRow | undefined;
  removeFolder(id: string): void;
  setSensitivity(folderId: string, sensitivity: 'general' | 'sensitive'): void;

  addFile(opts: {
    folderId: string;
    relativePath: string;
    absolutePath: string;
    size: number;
    mtime: string;
    contentHash?: string | null;
  }): FileRow;
  markFileIndexed(fileId: string): void;
  markFileError(fileId: string, error: string): void;
  tombstoneFile(fileId: string): void;
  resurrectFile(fileId: string): void;
  listFilesForFolder(folderId: string): FileRow[];
  sumBytesForFolder(folderId: string): number;
}

export function createFolderRegistry(db: Db): FolderRegistry {
  const insertFolder = db.prepare<[string, string, string, string, string, string, string]>(
    `INSERT INTO knowledge_folders (id, path, label, sensitivity, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  );

  const listFoldersStmt = db.prepare<[]>(
    `SELECT * FROM knowledge_folders ORDER BY created_at`
  );

  const getFolderStmt = db.prepare<[string]>(
    `SELECT * FROM knowledge_folders WHERE id = ?`
  );

  const removefolderStmt = db.prepare<[string]>(
    `DELETE FROM knowledge_folders WHERE id = ?`
  );

  const setSensitivityStmt = db.prepare<[string, string, string]>(
    `UPDATE knowledge_folders SET sensitivity = ?, updated_at = ? WHERE id = ?`
  );

  const insertFile = db.prepare<[string, string, string, string, number, string, string | null, string, string]>(
    `INSERT OR REPLACE INTO knowledge_files
       (id, folder_id, relative_path, absolute_path, size, mtime, content_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  );

  const markIndexedStmt = db.prepare<[string, string]>(
    `UPDATE knowledge_files SET status='indexed', last_error=NULL, updated_at=? WHERE id=?`
  );

  const markErrorStmt = db.prepare<[string, string, string]>(
    `UPDATE knowledge_files SET status='error', last_error=?, updated_at=? WHERE id=?`
  );

  const tombstoneStmt = db.prepare<[string, string, string]>(
    `UPDATE knowledge_files SET status='tombstoned', tombstoned_at=?, updated_at=? WHERE id=?`
  );

  const resurrectStmt = db.prepare<[string, string]>(
    `UPDATE knowledge_files SET status='pending', tombstoned_at=NULL, updated_at=? WHERE id=?`
  );

  const listFilesStmt = db.prepare<[string]>(
    `SELECT * FROM knowledge_files WHERE folder_id=? ORDER BY relative_path`
  );

  const sumBytesStmt = db.prepare<[string]>(
    `SELECT COALESCE(SUM(size), 0) AS bytes FROM knowledge_files WHERE folder_id = ?`
  );

  return {
    addFolder({ path, label, sensitivity }) {
      const id = sha256(path);
      const now = nowIso();
      insertFolder.run(id, path, label, sensitivity, now, now);
      return getFolderStmt.get(id) as FolderRow;
    },

    listFolders() {
      return listFoldersStmt.all() as FolderRow[];
    },

    getFolder(id) {
      return getFolderStmt.get(id) as FolderRow | undefined;
    },

    removeFolder(id) {
      removefolderStmt.run(id);
    },

    setSensitivity(folderId, sensitivity) {
      setSensitivityStmt.run(sensitivity, nowIso(), folderId);
    },

    addFile({ folderId, relativePath, absolutePath, size, mtime, contentHash }) {
      const id = sha256(folderId + relativePath);
      const now = nowIso();
      insertFile.run(id, folderId, relativePath, absolutePath, size, mtime, contentHash ?? null, now, now);
      return db.prepare('SELECT * FROM knowledge_files WHERE id=?').get(id) as FileRow;
    },

    markFileIndexed(fileId) {
      markIndexedStmt.run(nowIso(), fileId);
    },

    markFileError(fileId, error) {
      markErrorStmt.run(error, nowIso(), fileId);
    },

    tombstoneFile(fileId) {
      const now = nowIso();
      tombstoneStmt.run(now, now, fileId);
    },

    resurrectFile(fileId) {
      resurrectStmt.run(nowIso(), fileId);
    },

    listFilesForFolder(folderId) {
      return listFilesStmt.all(folderId) as FileRow[];
    },

    sumBytesForFolder(folderId) {
      const row = sumBytesStmt.get(folderId) as { bytes: number };
      return row.bytes;
    },
  };
}
