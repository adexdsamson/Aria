/**
 * Plan 10-02 Task 3 — Boot reconciler.
 *
 * On app start (or powerMonitor 'resume'), scans every active folder and
 * reconciles the registry against the live filesystem:
 *   - Files on disk but not in registry (or changed mtime/size) → re-ingest
 *   - Files in registry but missing on disk → tombstone
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from 'pino';
import type { FolderRegistry, FileRow } from './folder-registry';
import type { FolderIngestionService } from './ingestion-service';

export interface BootReconcilerDeps {
  registry: FolderRegistry;
  ingestionService: FolderIngestionService;
  logger: Logger;
}

interface DiskEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtime: string;
}

/**
 * Walk a directory recursively and return one DiskEntry per file.
 * Excludes node_modules, .git, and hidden directories.
 */
function walkDir(rootPath: string): DiskEntry[] {
  const results: DiskEntry[] = [];
  const EXCLUDE_DIRS = new Set(['node_modules', '.git']);

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(absPath);
          results.push({
            relativePath: path.relative(rootPath, absPath),
            absolutePath: absPath,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        } catch {
          // unreadable file — skip
        }
      }
    }
  }

  visit(rootPath);
  return results;
}

/**
 * Reconcile registry vs disk for all active folders. Returns counts of
 * ingested and tombstoned files.
 */
export async function runBootReconciliation(deps: BootReconcilerDeps): Promise<{
  ingested: number;
  tombstoned: number;
}> {
  const { registry, ingestionService, logger } = deps;
  let ingested = 0;
  let tombstoned = 0;

  const folders = registry.listFolders();
  const activeFolders = folders.filter((f) => f.status === 'active');

  for (const folder of activeFolders) {
    try {
      const diskEntries = walkDir(folder.path);
      const diskMap = new Map<string, DiskEntry>(diskEntries.map((e) => [e.relativePath, e]));

      const registryFiles: FileRow[] = registry.listFilesForFolder(folder.id);
      const registryMap = new Map<string, FileRow>(registryFiles.map((f) => [f.relative_path, f]));

      // Tombstone registry rows that are missing on disk
      for (const [relPath, fileRow] of registryMap) {
        if (!diskMap.has(relPath) && fileRow.status !== 'tombstoned') {
          registry.tombstoneFile(fileRow.id);
          tombstoned++;
          logger.info({
            scope: 'boot-reconciler',
            event: 'tombstone_missing',
            folderId: folder.id,
            relativePath: relPath,
          });
        }
      }

      // Ingest new files or files with changed mtime/size
      for (const [relPath, diskEntry] of diskMap) {
        const existing = registryMap.get(relPath);
        const isNew = !existing;
        const isChanged =
          existing &&
          existing.status !== 'tombstoned' &&
          (existing.mtime !== diskEntry.mtime || existing.size !== diskEntry.size);

        if (isNew || isChanged) {
          if (isNew) {
            registry.addFile({
              folderId: folder.id,
              relativePath: diskEntry.relativePath,
              absolutePath: diskEntry.absolutePath,
              size: diskEntry.size,
              mtime: diskEntry.mtime,
            });
          }
          await ingestionService.ingestFile(folder.id, diskEntry.absolutePath);
          ingested++;
          logger.info({
            scope: 'boot-reconciler',
            event: isNew ? 'ingest_new' : 'ingest_changed',
            folderId: folder.id,
            relativePath: relPath,
          });
        }
      }
    } catch (err) {
      logger.warn({
        scope: 'boot-reconciler',
        event: 'folder_error',
        folderId: folder.id,
        error: String(err),
      });
    }
  }

  return { ingested, tombstoned };
}
