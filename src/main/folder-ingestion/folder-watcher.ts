/**
 * Plan 10-02 Task 2 — Per-folder chokidar watcher.
 *
 * createFolderWatcher returns an object that can add/remove watched folders
 * and gracefully close all watchers. File system events are fed through a
 * p-queue (concurrency 2) to the FolderIngestionService.
 *
 * 'add' / 'change' → enqueue ingestFile
 * 'unlink'          → tombstoneFile (chunks deleted on next sweep cron)
 * 'add' of a previously tombstoned file → resurrectFile + re-enqueue ingest
 *
 * awaitWriteFinish coalesces rapid edits to a single stable event so the
 * ingestion worker never sees partial writes.
 */
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import PQueueImport from 'p-queue';
import type { Logger } from 'pino';
import type { FolderRegistry, FileRow } from './folder-registry';
import type { FolderIngestionService } from './ingestion-service';

// p-queue v8 is ESM-only; under the bundler's CJS interop the default export
// lands on `.default`. Normalize at module load (mirrors lifecycle/scheduler.ts).
// Without this, `new PQueue()` throws "is not a constructor" and the knowledge
// folder lifecycle fails to start on every boot.
const PQueue: typeof PQueueImport = ((PQueueImport as unknown as { default?: typeof PQueueImport }).default ??
  PQueueImport) as typeof PQueueImport;

/**
 * Glob patterns excluded from watching. Mirrors the prescan excludes.
 */
const EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.tmp',
  '**/*.swp',
  '**/*.lock',
];

export interface FolderWatcherDeps {
  registry: FolderRegistry;
  ingestionService: FolderIngestionService;
  logger: Logger;
  queueConcurrency?: number;
}

export interface FolderWatcher {
  addFolder(folderId: string, folderPath: string): void;
  removeFolder(folderId: string): void;
  close(): Promise<void>;
}

export function createFolderWatcher(deps: FolderWatcherDeps): FolderWatcher {
  const { registry, ingestionService, logger } = deps;
  const queueConcurrency = deps.queueConcurrency ?? 2;

  const queue = new PQueue({ concurrency: queueConcurrency });
  const watchers = new Map<string, { watcher: FSWatcher; folderPath: string }>();

  function getRelativePath(folderPath: string, absolutePath: string): string {
    return path.relative(folderPath, absolutePath);
  }

  function findFileByRelativePath(folderId: string, relativePath: string): FileRow | undefined {
    const files = registry.listFilesForFolder(folderId);
    return files.find((f) => f.relative_path === relativePath);
  }

  function handleAdd(folderId: string, folderPath: string, absolutePath: string): void {
    const relativePath = getRelativePath(folderPath, absolutePath);
    queue.add(async () => {
      try {
        const existing = findFileByRelativePath(folderId, relativePath);
        if (existing && existing.status === 'tombstoned') {
          // Resurrect within 24h window
          registry.resurrectFile(existing.id);
          logger.info({ scope: 'folder-watcher', event: 'resurrect', folderId, relativePath });
        } else if (!existing) {
          // New file — register it first
          const { size, mtime } = getFileStat(absolutePath);
          registry.addFile({
            folderId,
            relativePath,
            absolutePath,
            size,
            mtime,
          });
        }
        await ingestionService.ingestFile(folderId, absolutePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const fileRow = findFileByRelativePath(folderId, relativePath);
        if (fileRow) registry.markFileError(fileRow.id, msg);
        logger.warn({ scope: 'folder-watcher', event: 'add_error', folderId, relativePath, error: msg });
      }
    });
  }

  function handleChange(folderId: string, _folderPath: string, absolutePath: string): void {
    queue.add(async () => {
      try {
        await ingestionService.ingestFile(folderId, absolutePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ scope: 'folder-watcher', event: 'change_error', folderId, absolutePath, error: msg });
      }
    });
  }

  function handleUnlink(folderId: string, folderPath: string, absolutePath: string): void {
    const relativePath = getRelativePath(folderPath, absolutePath);
    queue.add(async () => {
      try {
        const fileRow = findFileByRelativePath(folderId, relativePath);
        if (fileRow) {
          registry.tombstoneFile(fileRow.id);
          logger.info({ scope: 'folder-watcher', event: 'tombstone', folderId, relativePath });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ scope: 'folder-watcher', event: 'unlink_error', folderId, relativePath, error: msg });
      }
    });
  }

  return {
    addFolder(folderId: string, folderPath: string): void {
      if (watchers.has(folderId)) return;
      const watcher = chokidar.watch(folderPath, {
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
        ignored: EXCLUDE_GLOBS,
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on('add', (absPath: string) => handleAdd(folderId, folderPath, absPath));
      watcher.on('change', (absPath: string) => handleChange(folderId, folderPath, absPath));
      watcher.on('unlink', (absPath: string) => handleUnlink(folderId, folderPath, absPath));
      watcher.on('error', (err: unknown) => {
        logger.warn({ scope: 'folder-watcher', event: 'watcher_error', folderId, error: String(err) });
      });

      watchers.set(folderId, { watcher, folderPath });
      logger.info({ scope: 'folder-watcher', event: 'watching', folderId, folderPath });
    },

    removeFolder(folderId: string): void {
      const entry = watchers.get(folderId);
      if (!entry) return;
      void entry.watcher.close();
      watchers.delete(folderId);
      logger.info({ scope: 'folder-watcher', event: 'unwatch', folderId });
    },

    async close(): Promise<void> {
      queue.clear();
      const closes = [...watchers.values()].map(({ watcher }) => watcher.close());
      await Promise.all(closes);
      watchers.clear();
      logger.info({ scope: 'folder-watcher', event: 'closed_all' });
    },
  };
}

function getFileStat(absolutePath: string): { size: number; mtime: string } {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const stat = fs.statSync(absolutePath);
    return { size: stat.size, mtime: stat.mtime.toISOString() };
  } catch {
    return { size: 0, mtime: new Date().toISOString() };
  }
}
