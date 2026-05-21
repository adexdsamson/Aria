/**
 * Plan 10-02 Task 3 — lifecycle tests.
 *
 * Stubs powerMonitor, verifies suspend/resume behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FolderRegistry, FolderRow } from './folder-registry';
import type { FolderIngestionService } from './ingestion-service';

// We test the lifecycle integration by stubbing everything except the
// registerLifecycleCallbacks module.

const suspendCallbacks: Array<() => void> = [];
const resumeCallbacks: Array<() => void> = [];

vi.mock('../lifecycle/powerMonitor', () => ({
  registerLifecycleCallbacks: vi.fn().mockImplementation(
    (cbs: { onSuspend?: () => void; onResume?: () => void }) => {
      if (cbs.onSuspend) suspendCallbacks.push(cbs.onSuspend);
      if (cbs.onResume) resumeCallbacks.push(cbs.onResume);
      return () => {};
    },
  ),
}));

// Stub createFolderWatcher to track calls
const watcherAddFolderMock = vi.fn();
const watcherRemoveFolderMock = vi.fn();
const watcherCloseMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./folder-watcher', () => ({
  createFolderWatcher: vi.fn().mockReturnValue({
    addFolder: watcherAddFolderMock,
    removeFolder: watcherRemoveFolderMock,
    close: watcherCloseMock,
  }),
}));

// Stub sweep-cron
const sweepStopMock = vi.fn();
const sweepRunNowMock = vi.fn().mockReturnValue(0);
vi.mock('./sweep-cron', () => ({
  startTombstoneSweep: vi.fn().mockReturnValue({ stop: sweepStopMock, runNow: sweepRunNowMock }),
}));

// Stub boot-reconciler
vi.mock('./boot-reconciler', () => ({
  runBootReconciliation: vi.fn().mockResolvedValue({ ingested: 0, tombstoned: 0 }),
}));

import { startKnowledgeFolderLifecycle, stopKnowledgeFolderLifecycle } from './lifecycle';
import { runBootReconciliation } from './boot-reconciler';

describe('startKnowledgeFolderLifecycle', () => {
  const now = new Date().toISOString();

  const folder: FolderRow = {
    id: 'f1', path: '/tmp/test', label: 'Test', sensitivity: 'general',
    status: 'active', last_scan_at: null, last_error: null, created_at: now, updated_at: now,
  };

  function makeRegistry(): FolderRegistry {
    return {
      addFolder: vi.fn(),
      listFolders: vi.fn().mockReturnValue([folder]),
      getFolder: vi.fn(),
      removeFolder: vi.fn(),
      setSensitivity: vi.fn(),
      addFile: vi.fn(),
      markFileIndexed: vi.fn(),
      markFileError: vi.fn(),
      tombstoneFile: vi.fn(),
      resurrectFile: vi.fn(),
      listFilesForFolder: vi.fn().mockReturnValue([]),
      sumBytesForFolder: vi.fn().mockReturnValue(0),
    };
  }

  function makeIngestion(): FolderIngestionService {
    return {
      ingestFolderOnce: vi.fn().mockResolvedValue({ indexed: 0, errors: 0 }),
      ingestFile: vi.fn().mockResolvedValue(undefined),
    };
  }

  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('pino').Logger;
  const mockDb = {} as import('better-sqlite3-multiple-ciphers').Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    suspendCallbacks.length = 0;
    resumeCallbacks.length = 0;
    // Reset the module-level `started` flag by re-importing would be cleaner,
    // but since lifecycle.ts is cached, we stop first to reset state.
    await stopKnowledgeFolderLifecycle(mockLogger);
  });

  it('on start: runs reconciler, attaches watchers for active folders, starts cron', async () => {
    const registry = makeRegistry();
    const ingestion = makeIngestion();

    await startKnowledgeFolderLifecycle({ db: mockDb, registry, ingestionService: ingestion, logger: mockLogger });

    expect(runBootReconciliation).toHaveBeenCalled();
    expect(watcherAddFolderMock).toHaveBeenCalledWith('f1', '/tmp/test');
  });

  it('on suspend: closes watcher and stops cron', async () => {
    const registry = makeRegistry();
    const ingestion = makeIngestion();
    await startKnowledgeFolderLifecycle({ db: mockDb, registry, ingestionService: ingestion, logger: mockLogger });

    expect(suspendCallbacks.length).toBeGreaterThan(0);
    for (const cb of suspendCallbacks) cb();

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(watcherCloseMock).toHaveBeenCalled();
    expect(sweepStopMock).toHaveBeenCalled();
  });

  it('on resume: runs reconciler and re-attaches watchers', async () => {
    const registry = makeRegistry();
    const ingestion = makeIngestion();
    await startKnowledgeFolderLifecycle({ db: mockDb, registry, ingestionService: ingestion, logger: mockLogger });

    // Simulate suspend then resume
    for (const cb of suspendCallbacks) cb();
    await new Promise((r) => setTimeout(r, 10));

    vi.clearAllMocks();

    expect(resumeCallbacks.length).toBeGreaterThan(0);
    for (const cb of resumeCallbacks) cb();
    await new Promise((r) => setTimeout(r, 50));

    expect(runBootReconciliation).toHaveBeenCalled();
    expect(watcherAddFolderMock).toHaveBeenCalledWith('f1', '/tmp/test');
  });
});
