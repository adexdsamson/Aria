/**
 * StatusPanel (Plan 03 Task 2).
 *
 * Polls window.aria.diagnosticsStatus() every 10s and renders four rows:
 * Ollama state, Frontier configured/active provider, Mode, Data directory.
 * When no frontier key is configured, renders the LOCAL-only banner with the
 * exact D-10 phrasing (`Frontier disabled — add an API key in Settings.`).
 */
import { useEffect, useState } from 'react';
import type { DiagnosticsStatus, GmailIntegrationStatus, IpcError } from '../../../shared/ipc-contract';

const POLL_MS = 10_000;
const LOCAL_ONLY_BANNER = 'Frontier disabled — add an API key in Settings.';

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function relativeTime(iso?: string): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'never';
  const deltaSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(deltaSec);
  if (abs < 60) return rtf.format(deltaSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), 'hour');
  return rtf.format(Math.round(deltaSec / 86400), 'day');
}

export function IntegrationStatusRow({ kind }: { kind: 'gmail' }): JSX.Element {
  const [status, setStatus] = useState<GmailIntegrationStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      if (kind !== 'gmail') return;
      const next = await window.aria.gmailStatus();
      if (!cancelled && !isErr(next)) setStatus(next);
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kind]);

  if (!status) return <span data-testid={`integration-row-${kind}`}>loading…</span>;
  const badge =
    status.tokenStatus === 'expired' || status.tokenStatus === 'revoked'
      ? 'error'
      : !status.connected
        ? 'idle'
        : status.queueDepth > 0
          ? 'syncing'
          : 'idle';
  const lastErr = (status.lastError ?? '').slice(0, 80);
  return (
    <span data-testid={`integration-row-${kind}`}>
      [{badge}] {status.email ?? '(disconnected)'} · synced {relativeTime(status.lastSyncedAt)} · queued: {status.queueDepth}
      {lastErr ? ` · err: ${lastErr}` : ''}
    </span>
  );
}

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
          <dt>Gmail</dt>
          <dd>
            <IntegrationStatusRow kind="gmail" />
          </dd>
        </dl>
      )}
    </section>
  );
}
