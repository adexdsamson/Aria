/**
 * Plan 10-01 Task 2 — Pre-scan: read-only file/byte count walk.
 *
 * Walks a directory without parsing files. Returns { fileCount, totalBytes }.
 * Respects exclude globs (node_modules, .git, dist, out, .next, OS junk).
 * Caps absolute walk at 60s; throws prescan_timeout if exceeded.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface PrescanResult {
  fileCount: number;
  totalBytes: number;
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
]);

const TIMEOUT_MS = 60_000;

export async function prescanFolder(
  absolutePath: string,
  excludes: string[] = [],
): Promise<PrescanResult> {
  const excludeSet = new Set([
    ...DEFAULT_EXCLUDE_DIRS,
    ...excludes.map((e) => path.basename(e)),
  ]);

  let fileCount = 0;
  let totalBytes = 0;

  const deadline = Date.now() + TIMEOUT_MS;
  const queue: string[] = [absolutePath];

  while (queue.length > 0) {
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`prescanFolder timed out after 60s: ${absolutePath}`), {
        code: 'prescan_timeout',
      });
    }

    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission errors or broken symlinks — skip silently
      continue;
    }

    for (const entry of entries) {
      if (excludeSet.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(fullPath);
          fileCount++;
          totalBytes += stat.size;
        } catch {
          // Can't stat — skip
        }
      }
    }
  }

  return { fileCount, totalBytes };
}
