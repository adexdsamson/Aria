/**
 * Plan 07-02 Task 7 — RagIndexSection unit + reachability test.
 *
 * Reachability gate (L-04-04): the test reads SettingsScreen.tsx and asserts
 * RagIndexSection is BOTH imported and JSX-mounted there. Future regressions
 * that orphan the section get caught at unit-test time, not at UAT.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { RagIndexSection } from '../../../../../src/renderer/features/settings/RagIndexSection';

function setupAriaApi(overrides: Partial<{
  index: unknown;
  backfill: unknown;
}> = {}): void {
  (window as unknown as { aria: Record<string, unknown> }).aria = {
    ragIndexStatus: vi.fn(async () =>
      overrides.index ?? {
        vectorBackend: 'fallback',
        activeModelId: 'nomic-embed-text:v1.5',
        activeModelDim: 768,
        rebuildInProgress: false,
        rebuildTargetModelId: null,
        rebuildProgressDone: 0,
        rebuildProgressTotal: 0,
        aliveChunkCount: 250,
        dirtyChunkCount: 50,
        perMinute: 0,
      },
    ),
    ragBackfillStatus: vi.fn(async () =>
      overrides.backfill ?? {
        state: 'pending',
        enqueuedBySourceKind: { email: 0, event: 0, note: 0, action: 0 },
        dirtyRemaining: 0,
        etaSecondsRemaining: 0,
      },
    ),
    ragBackfillStart: vi.fn(async () => ({ enqueuedBySourceKind: { email: 0, event: 0, note: 0, action: 0 } })),
    ragBackfillSkip: vi.fn(async () => ({ ok: true })),
  };
}

describe('RagIndexSection — Plan 07-02 Task 7', () => {
  beforeEach(() => {
    setupAriaApi();
  });

  it('renders backend + active model + chunk count', async () => {
    render(<RagIndexSection />);
    await waitFor(() => expect(screen.getByTestId('rag-backend')).toHaveTextContent('fallback'));
    expect(screen.getByTestId('rag-active-model')).toHaveTextContent('nomic-embed-text:v1.5');
    expect(screen.getByTestId('rag-chunk-count')).toHaveTextContent('200 / 250 embedded');
  });

  it('shows the capacity-warn banner at >= 200k chunks (fallback)', async () => {
    setupAriaApi({
      index: {
        vectorBackend: 'fallback',
        activeModelId: 'nomic-embed-text:v1.5',
        activeModelDim: 768,
        rebuildInProgress: false,
        rebuildTargetModelId: null,
        rebuildProgressDone: 0,
        rebuildProgressTotal: 0,
        aliveChunkCount: 210_000,
        dirtyChunkCount: 0,
        perMinute: 0,
      },
    });
    render(<RagIndexSection />);
    await waitFor(() => expect(screen.getByTestId('rag-capacity-warn')).toBeInTheDocument());
  });

  it('shows the hard-cap banner at >= 250k chunks (fallback)', async () => {
    setupAriaApi({
      index: {
        vectorBackend: 'fallback',
        activeModelId: 'nomic-embed-text:v1.5',
        activeModelDim: 768,
        rebuildInProgress: false,
        rebuildTargetModelId: null,
        rebuildProgressDone: 0,
        rebuildProgressTotal: 0,
        aliveChunkCount: 260_000,
        dirtyChunkCount: 0,
        perMinute: 0,
      },
    });
    render(<RagIndexSection />);
    await waitFor(() => expect(screen.getByTestId('rag-capacity-hard')).toBeInTheDocument());
  });

  it('shows Build now / Later when backfill state is pending', async () => {
    render(<RagIndexSection />);
    await waitFor(() => expect(screen.getByTestId('rag-backfill-start')).toBeInTheDocument());
    expect(screen.getByTestId('rag-backfill-skip')).toBeInTheDocument();
  });
});

describe('Reachability — L-04-04', () => {
  it('SettingsScreen.tsx imports AND mounts RagIndexSection', () => {
    const filePath = path.resolve(
      __dirname,
      '../../../../../src/renderer/features/settings/SettingsScreen.tsx',
    );
    const src = fs.readFileSync(filePath, 'utf8');
    expect(src).toMatch(/import\s*\{\s*RagIndexSection\s*\}\s*from\s*['"]\.\/RagIndexSection['"]/);
    expect(src).toMatch(/<RagIndexSection\s*\/?>/);
  });
});
