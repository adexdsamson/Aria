/**
 * StatusPanel (Plan 03 Task 2).
 *
 * Polls window.aria.diagnosticsStatus() every 10s and renders four rows:
 * Ollama state, Frontier configured/active provider, Mode, Data directory.
 * When no frontier key is configured, renders the LOCAL-only banner with the
 * exact D-10 phrasing (`Frontier disabled — add an API key in Settings.`).
 */
import { useEffect, useState } from 'react';
import type { DiagnosticsStatus } from '../../../shared/ipc-contract';

const POLL_MS = 10_000;
const LOCAL_ONLY_BANNER = 'Frontier disabled — add an API key in Settings.';

export function StatusPanel(): JSX.Element {
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      const next = (await window.aria.diagnosticsStatus()) as DiagnosticsStatus;
      if (!cancelled) setStatus(next);
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section data-testid="settings-status" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Status</h2>
      {!status?.frontierConfigured && (
        <div role="status" style={{ marginBottom: 'var(--aria-space-md)' }}>
          {LOCAL_ONLY_BANNER}
        </div>
      )}
      {status && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 8 }}>
          <dt>Ollama</dt>
          <dd>
            {status.ollama.reachable
              ? `reachable${status.ollama.version ? ` (v${status.ollama.version})` : ''}, ${status.ollama.models.length} model(s)`
              : `unreachable (${status.ollama.error ?? 'unknown'})`}
          </dd>
          <dt>Frontier</dt>
          <dd>
            {status.activeProvider
              ? `${status.activeProvider} — ${status.frontierConfigured ? 'configured' : 'no key'}`
              : 'no active provider'}
          </dd>
          <dt>Mode</dt>
          <dd>{status.mode}</dd>
          <dt>Data directory</dt>
          <dd>
            <code>{status.dataDir}</code>
          </dd>
        </dl>
      )}
    </section>
  );
}
