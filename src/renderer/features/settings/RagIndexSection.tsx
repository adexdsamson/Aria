/**
 * Plan 07-02 Task 7 — Settings → RAG Index section.
 *
 * Surfaces:
 *   - vector backend (sqlite-vec / fallback) + active model id + dim
 *   - indexing progress (X / Y embedded), rebuild banner if rebuild_in_progress
 *   - estimated storage (chunks × 4 KB)
 *   - backfill state + live ETA + Build now / Later buttons
 *   - capacity banner at 200k (warn) / 250k (red) for fallback mode (C2 Option D)
 *   - "Wipe RAG data for disconnected account" (per RESEARCH §11)
 *   - Distinct Ollama-down error copy (L-04-03) — NOT the refusal copy
 *
 * The section MUST be imported and mounted by SettingsScreen.tsx — the test
 * spec greps that file to enforce reachability (L-04-04).
 */
import { useEffect, useState } from 'react';
import type {
  RagBackfillStatusDto,
  RagIndexStatusDto,
} from '../../../shared/ipc-contract';

const POLL_MS = 5_000;
const WARN_CAP = 200_000;
const HARD_CAP = 250_000;

function hasError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  if (hours >= 1) return `≥${hours.toFixed(1)}h estimated — consider running overnight`;
  return `${Math.round(seconds / 60)}m`;
}

export function RagIndexSection(): JSX.Element {
  const [status, setStatus] = useState<RagIndexStatusDto | null>(null);
  const [backfill, setBackfill] = useState<RagBackfillStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      const s = (await window.aria.ragIndexStatus()) as RagIndexStatusDto | { error: string };
      const b = (await window.aria.ragBackfillStatus()) as RagBackfillStatusDto | { error: string };
      if (cancelled) return;
      if (hasError(s)) {
        setError(s.error);
      } else {
        setStatus(s);
        setError(null);
      }
      if (!hasError(b)) setBackfill(b);
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function onStartBackfill(): Promise<void> {
    setStarting(true);
    try {
      await window.aria.ragBackfillStart();
    } finally {
      setStarting(false);
    }
  }

  async function onSkipBackfill(): Promise<void> {
    await window.aria.ragBackfillSkip();
  }

  const ollamaDown = !!status?.lastErrorKind && status.lastErrorKind === 'connection_refused';
  const estStorage = status ? status.aliveChunkCount * 4096 : 0;

  return (
    <section data-testid="settings-rag-index" style={{ padding: 'var(--aria-space-md)' }}>
      <h2 style={{ marginTop: 0 }}>RAG Index</h2>

      {error && (
        <div role="alert" style={errorBanner()}>
          {error}
        </div>
      )}

      {ollamaDown && (
        <div role="alert" data-testid="rag-ollama-down" style={errorBanner()}>
          Aria couldn&apos;t reach the local model — please check Ollama is running.
        </div>
      )}

      {status?.vectorBackend === 'fallback' && status.aliveChunkCount >= HARD_CAP && (
        <div role="alert" data-testid="rag-capacity-hard" style={errorBanner()}>
          Fallback index at capacity ({status.aliveChunkCount.toLocaleString()}/250,000 chunks). Indexing
          is paused. Reinstall Aria from a build that ships sqlite-vec native binaries.
        </div>
      )}

      {status?.vectorBackend === 'fallback' &&
        status.aliveChunkCount >= WARN_CAP &&
        status.aliveChunkCount < HARD_CAP && (
          <div role="alert" data-testid="rag-capacity-warn" style={warnBanner()}>
            Fallback index approaching capacity ({status.aliveChunkCount.toLocaleString()}/250,000
            chunks). Consider reinstalling Aria from a build that ships sqlite-vec.
          </div>
        )}

      {status && (
        <dl style={dlStyle()}>
          <dt>Backend</dt>
          <dd data-testid="rag-backend">{status.vectorBackend}</dd>
          <dt>Active embedding model</dt>
          <dd data-testid="rag-active-model">
            {status.activeModelId} ({status.activeModelDim}-dim)
          </dd>
          <dt>Indexed chunks</dt>
          <dd data-testid="rag-chunk-count">
            {(status.aliveChunkCount - status.dirtyChunkCount).toLocaleString()} /{' '}
            {status.aliveChunkCount.toLocaleString()} embedded
          </dd>
          <dt>Estimated storage</dt>
          <dd>{bytesToHuman(estStorage)}</dd>
          {status.rebuildInProgress && (
            <>
              <dt>Rebuild</dt>
              <dd data-testid="rag-rebuild">
                Rebuilding for {status.rebuildTargetModelId} —{' '}
                {status.rebuildProgressDone}/{status.rebuildProgressTotal}
              </dd>
            </>
          )}
        </dl>
      )}

      {backfill && (
        <div style={{ marginTop: 'var(--aria-space-md)' }}>
          <h3>Backfill</h3>
          <p>State: {backfill.state}</p>
          <p>ETA remaining: {fmtEta(backfill.etaSecondsRemaining)}</p>
          {backfill.state === 'pending' && (
            <>
              <p>
                Aria can build a search index over your existing mail, calendar, and meeting notes.
              </p>
              <button onClick={onStartBackfill} disabled={starting} data-testid="rag-backfill-start">
                {starting ? 'Starting…' : 'Build now'}
              </button>{' '}
              <button onClick={onSkipBackfill} data-testid="rag-backfill-skip">
                Later
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function errorBanner(): React.CSSProperties {
  return {
    padding: 'var(--aria-space-sm)',
    backgroundColor: 'var(--aria-error-bg, #fee)',
    color: 'var(--aria-error-fg, #900)',
    borderRadius: 6,
    marginBottom: 'var(--aria-space-sm)',
  };
}

function warnBanner(): React.CSSProperties {
  return {
    padding: 'var(--aria-space-sm)',
    backgroundColor: 'var(--aria-warn-bg, #fff8e1)',
    color: 'var(--aria-warn-fg, #7a5d00)',
    borderRadius: 6,
    marginBottom: 'var(--aria-space-sm)',
  };
}

function dlStyle(): React.CSSProperties {
  return { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 12, rowGap: 6 };
}
