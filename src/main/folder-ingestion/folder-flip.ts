/**
 * Plan 10-02 Task 1 — folder-flip primitive.
 *
 * flipFolderSensitivity performs a two-row UPDATE inside a single
 * better-sqlite3 transaction:
 *   1. UPDATE knowledge_folders.sensitivity (+ updated_at)
 *   2. UPDATE rag_chunk.sensitivity / sensitivity_model / sensitivity_at
 *      for all chunks belonging to that folder.
 *
 * No re-embedding. In-flight routeAnswer calls are unaffected because they
 * already hold a `chunks[]` snapshot in memory.
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface FlipResult {
  folderUpdated: number;
  chunksUpdated: number;
}

/**
 * Flips a folder's sensitivity and bulk-updates all its rag_chunk rows in a
 * single atomic transaction.
 *
 * @param db - better-sqlite3 database instance
 * @param folderId - knowledge_folders.id
 * @param nextSensitivity - 'general' → 'folder:low', 'sensitive' → 'folder:high'
 */
export function flipFolderSensitivity(
  db: Db,
  folderId: string,
  nextSensitivity: 'general' | 'sensitive',
): FlipResult {
  const tag = nextSensitivity === 'sensitive' ? 'folder:high' : 'folder:low';
  const now = new Date().toISOString();

  const updateFolder = db.prepare<[string, string, string]>(
    `UPDATE knowledge_folders SET sensitivity = ?, updated_at = ? WHERE id = ?`,
  );

  const updateChunks = db.prepare<[string, string, string, string]>(
    `UPDATE rag_chunk SET sensitivity = ?, sensitivity_model = 'folder-rule:v1', sensitivity_at = ? WHERE folder_id = ?`,
  );

  const result = db.transaction(() => {
    const folderInfo = updateFolder.run(nextSensitivity, now, folderId);
    const chunksInfo = updateChunks.run(tag, now, folderId);
    return {
      folderUpdated: folderInfo.changes,
      chunksUpdated: chunksInfo.changes,
    };
  })();

  return result as FlipResult;
}
