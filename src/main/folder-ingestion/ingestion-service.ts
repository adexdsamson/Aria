/**
 * Plan 10-01 Task 4 — FolderIngestionService.
 *
 * Walks knowledge_files for a folder (or a single file), parses each file via
 * the parser registry, and dispatches through createIndexWriter with
 * sourceKind='folder', the correct folderId/fileId, and a deterministic
 * sensitivity classify function (no LLM call — folder-rule:v1).
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type { FolderRegistry } from './folder-registry';
import type { Parser } from './parsers/index';
import type { IndexWriter } from '../rag/index-writer';
import { createIndexWriter } from '../rag/index-writer';
import type { ChunkingStrategy } from '../rag/chunk-types';

type Db = Database.Database;

export interface FolderIngestionServiceDeps {
  db: Db;
  logger: Logger;
  registry: FolderRegistry;
  parsers: Record<string, Parser>;
  strategy: ChunkingStrategy;
  /** Base index-writer factory; injected for testability. */
  createWriter?: (classify: (text: string) => Promise<string>, modelId: string) => IndexWriter;
}

export interface FolderIngestionService {
  ingestFolderOnce(folderId: string): Promise<{ indexed: number; errors: number }>;
  ingestFile(folderId: string, absolutePath: string): Promise<void>;
}

function folderClassify(sensitivity: 'general' | 'sensitive') {
  return async (_text: string): Promise<string> => {
    return sensitivity === 'sensitive' ? 'folder:high' : 'folder:low';
  };
}

function getExtension(filePath: string): string {
  const i = filePath.lastIndexOf('.');
  if (i < 0) return '';
  return filePath.slice(i).toLowerCase();
}

export function createFolderIngestionService(
  deps: FolderIngestionServiceDeps,
): FolderIngestionService {
  const { db, logger, registry, parsers, strategy } = deps;

  function makeWriter(folderId: string): IndexWriter {
    const folder = registry.getFolder(folderId);
    const sensitivity = folder?.sensitivity ?? 'general';
    const classify = folderClassify(sensitivity);
    if (deps.createWriter) {
      return deps.createWriter(classify, 'folder-rule:v1');
    }
    return createIndexWriter({
      db,
      logger,
      strategy,
      classify: classify as Parameters<typeof createIndexWriter>[0]['classify'],
      classifierModelId: 'folder-rule:v1',
    });
  }

  async function ingestFile(folderId: string, absolutePath: string): Promise<void> {
    const ext = getExtension(absolutePath);
    const parser = parsers[ext];
    if (!parser) {
      logger.info({ scope: 'folder-ingestion', event: 'skip_unsupported', path: absolutePath });
      return;
    }

    // Find the file row in registry to get the fileId
    const files = registry.listFilesForFolder(folderId);
    const fileRow = files.find((f) => f.absolute_path === absolutePath);
    if (!fileRow) {
      logger.warn({ scope: 'folder-ingestion', event: 'file_not_in_registry', path: absolutePath });
      return;
    }

    try {
      const parsed = await parser.parse(absolutePath);
      const writer = makeWriter(folderId);
      await writer.upsertSource({
        sourceKind: 'folder',
        sourceId: fileRow.id,
        folderId,
        fileId: fileRow.id,
        title: fileRow.relative_path,
        text: parsed.text,
      });
      registry.markFileIndexed(fileRow.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      registry.markFileError(fileRow.id, msg);
      logger.warn({ scope: 'folder-ingestion', event: 'file_error', path: absolutePath, error: msg });
    }
  }

  async function ingestFolderOnce(
    folderId: string,
  ): Promise<{ indexed: number; errors: number }> {
    const files = registry.listFilesForFolder(folderId);
    let indexed = 0;
    let errors = 0;

    for (const file of files) {
      const ext = getExtension(file.absolute_path);
      const parser = parsers[ext];
      if (!parser) {
        registry.markFileError(file.id, 'unsupported_extension');
        errors++;
        continue;
      }
      try {
        const parsed = await parser.parse(file.absolute_path);
        const writer = makeWriter(folderId);
        await writer.upsertSource({
          sourceKind: 'folder',
          sourceId: file.id,
          folderId,
          fileId: file.id,
          title: file.relative_path,
          text: parsed.text,
        });
        registry.markFileIndexed(file.id);
        indexed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        registry.markFileError(file.id, msg);
        logger.warn({ scope: 'folder-ingestion', event: 'file_error', path: file.absolute_path, error: msg });
        errors++;
      }
    }

    return { indexed, errors };
  }

  return { ingestFolderOnce, ingestFile };
}
