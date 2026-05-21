/**
 * Plan 10-01 Task 2 — prescanFolder tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { prescanFolder } from './prescan';

describe('prescanFolder', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs) {
      await fsp.rm(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('counts 7 real files and ignores node_modules (100 files inside)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aria-prescan-'));
    tmpDirs.push(tmpDir);

    // Create 7 regular files
    for (let i = 0; i < 7; i++) {
      await fsp.writeFile(path.join(tmpDir, `file${i}.txt`), `content ${i}`);
    }

    // Create node_modules with 100 files
    const nmDir = path.join(tmpDir, 'node_modules');
    await fsp.mkdir(nmDir);
    for (let i = 0; i < 100; i++) {
      await fsp.writeFile(path.join(nmDir, `dep${i}.js`), 'module');
    }

    const result = await prescanFolder(tmpDir);
    expect(result.fileCount).toBe(7);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('counts files in nested subdirectories', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aria-prescan-'));
    tmpDirs.push(tmpDir);

    await fsp.mkdir(path.join(tmpDir, 'sub1'));
    await fsp.mkdir(path.join(tmpDir, 'sub1', 'sub2'));
    await fsp.writeFile(path.join(tmpDir, 'root.txt'), 'root');
    await fsp.writeFile(path.join(tmpDir, 'sub1', 'a.txt'), 'a');
    await fsp.writeFile(path.join(tmpDir, 'sub1', 'sub2', 'b.txt'), 'b');

    const result = await prescanFolder(tmpDir);
    expect(result.fileCount).toBe(3);
  });

  it('respects .git exclude', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aria-prescan-'));
    tmpDirs.push(tmpDir);

    await fsp.writeFile(path.join(tmpDir, 'readme.md'), '# Readme');
    const gitDir = path.join(tmpDir, '.git');
    await fsp.mkdir(gitDir);
    await fsp.writeFile(path.join(gitDir, 'config'), '[core]');

    const result = await prescanFolder(tmpDir);
    expect(result.fileCount).toBe(1);
  });

  it('returns totalBytes as sum of file sizes', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aria-prescan-'));
    tmpDirs.push(tmpDir);

    const content1 = 'A'.repeat(1000);
    const content2 = 'B'.repeat(2000);
    await fsp.writeFile(path.join(tmpDir, 'f1.txt'), content1);
    await fsp.writeFile(path.join(tmpDir, 'f2.txt'), content2);

    const result = await prescanFolder(tmpDir);
    expect(result.totalBytes).toBe(3000);
  });
});
