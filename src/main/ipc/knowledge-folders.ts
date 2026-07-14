/**
 * Plan 10-01 Task 4 / Plan 10-02 Task 1 — Knowledge Folders IPC.
 *
 * Registers 8 channels (7 from plan 10-01 + aria:knowledge:set-sensitivity
 * added in plan 10-02 alongside the chunk-bulk-flip — no intermediate-state
 * hole).
 */
import type { IpcMain, Dialog } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS } from '../../shared/ipc-contract';
import type { FolderRegistry } from '../folder-ingestion/folder-registry';
import type { FolderIngestionService } from '../folder-ingestion/ingestion-service';
import { prescanFolder } from '../folder-ingestion/prescan';
import { flipFolderSensitivity } from '../folder-ingestion/folder-flip';
import { runBootReconciliation } from '../folder-ingestion/boot-reconciler';
import { addFolderToWatcher } from '../folder-ingestion/lifecycle';
import type Database from 'better-sqlite3-multiple-ciphers';

const FILE_COUNT_THRESHOLD = 5000;
const BYTES_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2 GB

export interface KnowledgeFolderIpcDeps {
  ipcMain: IpcMain;
  registry: FolderRegistry;
  ingestionService: FolderIngestionService;
  dialog: Pick<Dialog, 'showOpenDialog'>;
  logger: Logger;
  db: Database.Database;
}

/**
 * Canonical list of every invoke channel registerKnowledgeFolderIpc() registers.
 * SINGLE SOURCE OF TRUTH: registerHandlers (ipc/index.ts) registers no-op stubs for
 * these pre-unlock, and the post-unlock bootPoll in src/main/index.ts re-registers
 * the real handlers. ipcMain.handle THROWS on a 2nd registration (it does not
 * override), so bootPoll MUST removeHandler each of these first. If you add or
 * remove an `ipcMain.handle(CHANNELS.KNOWLEDGE_*, …)` below, update this array.
 */
export const KNOWLEDGE_FOLDER_CHANNELS = [
  CHANNELS.KNOWLEDGE_PICK_FOLDER,
  CHANNELS.KNOWLEDGE_PRESCAN_FOLDER,
  CHANNELS.KNOWLEDGE_ADD_FOLDER,
  CHANNELS.KNOWLEDGE_LIST_FOLDERS,
  CHANNELS.KNOWLEDGE_REMOVE_FOLDER,
  CHANNELS.KNOWLEDGE_FOLDER_STATS,
  CHANNELS.KNOWLEDGE_REINDEX,
  CHANNELS.KNOWLEDGE_SET_SENSITIVITY,
] as const;

export function registerKnowledgeFolderIpc(deps: KnowledgeFolderIpcDeps): void {
  const { ipcMain, registry, ingestionService, dialog, logger, db } = deps;

  // aria:knowledge:pick-folder
  ipcMain.handle(CHANNELS.KNOWLEDGE_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { path: result.filePaths[0]! };
  });

  // aria:knowledge:prescan-folder
  ipcMain.handle(CHANNELS.KNOWLEDGE_PRESCAN_FOLDER, async (_event, req: { path: string }) => {
    try {
      const { fileCount, totalBytes } = await prescanFolder(req.path);
      return {
        fileCount,
        totalBytes,
        exceedsThreshold: fileCount > FILE_COUNT_THRESHOLD || totalBytes > BYTES_THRESHOLD,
      };
    } catch (err) {
      logger.warn({ scope: 'knowledge-ipc', event: 'prescan_error', error: String(err) });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // aria:knowledge:add-folder
  ipcMain.handle(
    CHANNELS.KNOWLEDGE_ADD_FOLDER,
    async (_event, req: { path: string; label: string; sensitivity: 'general' | 'sensitive' }) => {
      const folder = registry.addFolder({ path: req.path, label: req.label, sensitivity: req.sensitivity });
      logger.info({ scope: 'knowledge-ipc', event: 'add_folder', folderId: folder.id });
      // Attach to the live watcher so future file changes are picked up without
      // a restart (watcher uses ignoreInitial:true, so it won't scan existing
      // files — that's what the reconciliation below is for).
      addFolderToWatcher(folder.id, req.path);
      // Kick off the initial scan of the folder's EXISTING files. Without this,
      // add only registered the folder row and nothing walked the directory, so
      // the card showed Files 0 / Last scan — until the next app restart (when
      // boot reconciliation runs). Fire-and-forget: the handler returns the id
      // immediately and the renderer re-reads stats once indexing progresses.
      void runBootReconciliation({ registry, ingestionService, logger }).catch((err) => {
        logger.error({
          scope: 'knowledge-ipc',
          event: 'add_folder_scan_error',
          folderId: folder.id,
          error: String(err),
        });
      });
      return { folderId: folder.id };
    },
  );

  // aria:knowledge:list-folders
  ipcMain.handle(CHANNELS.KNOWLEDGE_LIST_FOLDERS, async () => {
    const folderRows = registry.listFolders();
    const folders = folderRows.map((f) => {
      const files = registry.listFilesForFolder(f.id);
      const bytesIndexed = registry.sumBytesForFolder(f.id);
      return {
        id: f.id,
        path: f.path,
        label: f.label,
        sensitivity: f.sensitivity,
        status: f.status,
        fileCount: files.length,
        bytesIndexed,
        lastScanAt: f.last_scan_at ?? null,
        lastError: f.last_error ?? null,
      };
    });
    return { folders };
  });

  // aria:knowledge:remove-folder
  ipcMain.handle(CHANNELS.KNOWLEDGE_REMOVE_FOLDER, async (_event, req: { folderId: string }) => {
    registry.removeFolder(req.folderId);
    logger.info({ scope: 'knowledge-ipc', event: 'remove_folder', folderId: req.folderId });
    return { ok: true };
  });

  // aria:knowledge:folder-stats
  ipcMain.handle(CHANNELS.KNOWLEDGE_FOLDER_STATS, async (_event, req: { folderId: string }) => {
    const files = registry.listFilesForFolder(req.folderId);
    const bytesIndexed = registry.sumBytesForFolder(req.folderId);
    const folder = registry.getFolder(req.folderId);

    let indexedCount = 0;
    let errorCount = 0;
    let pendingCount = 0;
    let tombstonedCount = 0;

    for (const f of files) {
      if (f.status === 'indexed') indexedCount++;
      else if (f.status === 'error') errorCount++;
      else if (f.status === 'pending') pendingCount++;
      else if (f.status === 'tombstoned') tombstonedCount++;
    }

    return {
      fileCount: files.length,
      bytesIndexed,
      indexedCount,
      errorCount,
      pendingCount,
      tombstonedCount,
      lastScanAt: folder?.last_scan_at ?? null,
    };
  });

  // aria:knowledge:reindex
  ipcMain.handle(CHANNELS.KNOWLEDGE_REINDEX, async (_event, req: { folderId: string }) => {
    // Re-scan the folder from disk first (registers new/changed files), THEN
    // re-ingest — ingestFolderOnce alone only iterates already-registered rows,
    // so a folder that was never disk-scanned would re-index nothing. Await the
    // whole thing so the renderer can show a spinner and refresh on completion,
    // and stamp last_scan_at so the "Last scan" metric updates.
    try {
      await runBootReconciliation({ registry, ingestionService, logger });
      const { indexed, errors } = await ingestionService.ingestFolderOnce(req.folderId);
      registry.markFolderScanned(req.folderId);
      logger.info({ scope: 'knowledge-ipc', event: 'reindex_done', folderId: req.folderId, indexed, errors });
      return { ok: true as const, indexed, errors };
    } catch (err) {
      logger.error({ scope: 'knowledge-ipc', event: 'reindex_error', folderId: req.folderId, error: String(err) });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // aria:knowledge:set-sensitivity (Plan 10-02 — shipped together with chunk-bulk-flip)
  ipcMain.handle(
    CHANNELS.KNOWLEDGE_SET_SENSITIVITY,
    async (_event, req: { folderId: string; sensitivity: 'general' | 'sensitive' }) => {
      const { folderUpdated, chunksUpdated } = flipFolderSensitivity(db, req.folderId, req.sensitivity);
      logger.info({
        scope: 'knowledge-ipc',
        event: 'set_sensitivity',
        folderId: req.folderId,
        sensitivity: req.sensitivity,
        folderUpdated,
        chunksUpdated,
      });
      return { ok: true, folderUpdated, chunksUpdated };
    },
  );
}
