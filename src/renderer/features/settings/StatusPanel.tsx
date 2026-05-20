/**
 * StatusPanel (Plan 03 Task 2).
 *
 * Polls window.aria.diagnosticsStatus() every 10s and renders four rows:
 * Ollama state, Frontier configured/active provider, Mode, Data directory.
 * When no frontier key is configured, renders the LOCAL-only banner with the
 * exact D-10 phrasing (`Frontier disabled — add an API key in Settings.`).
 */
import { useEffect, useState } from 'react';
import { Card, LabelRule } from '../../components/editorial';
import type {
  CalendarIntegrationStatus,
  DiagnosticsStatus,
  GmailIntegrationStatus,
  IpcError,
  OllamaActiveModel,
} from '../../../shared/ipc-contract';

const POLL_MS = 10_000;
const LOCAL_ONLY_BANNER = 'Frontier disabled — add an API key in Settings.';
const FRONTIER_ONLY_BANNER =
  'Local model unavailable — Aria will use Frontier (OpenAI/Anthropic/Google) for all reasoning. Install Ollama for local-first routing.';
const NONE_BANNER =
  'No LLM provider available. Aria needs either a Frontier API key OR Ollama to generate briefings and respond to Ask-Aria.';

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

export function IntegrationStatusRow({ kind }: { kind: 'gmail' | 'calendar' }): JSX.Element {
  const [status, setStatus] = useState<GmailIntegrationStatus | CalendarIntegrationStatus | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      const next =
        kind === 'gmail'
          ? await window.aria.gmailStatus()
          : await window.aria.calendarStatus();
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
  const [activeModel, setActiveModel] = useState<OllamaActiveModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      const next = (await window.aria.diagnosticsStatus()) as DiagnosticsStatus;
      if (!cancelled) setStatus(next);
      const am = (await window.aria.ollamaGetActiveModel()) as OllamaActiveModel | IpcError;
      if (!cancelled && !isErr(am)) setActiveModel(am);
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section
      data-testid="settings-status"
      style={{
        padding: 32,
        maxWidth: '64rem',
        margin: '0 auto',
        color: 'var(--ink)',
        background: 'var(--paper)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Settings · Status
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 18,
        }}
      >
        Status
      </h2>
      <LabelRule label="Providers" align="left" />
      {status?.mode === 'LOCAL_ONLY' && (
        <div role="status" data-testid="banner-local-only" style={{ marginBottom: 'var(--aria-space-md)' }}>
          {LOCAL_ONLY_BANNER}
        </div>
      )}
      {status?.mode === 'FRONTIER_ONLY' && (
        <div role="status" data-testid="banner-frontier-only" style={{ marginBottom: 'var(--aria-space-md)' }}>
          {FRONTIER_ONLY_BANNER}
        </div>
      )}
      {status?.mode === 'NONE' && (
        <div role="alert" data-testid="banner-no-provider" style={{ marginBottom: 'var(--aria-space-md)', color: '#b91c1c' }}>
          {NONE_BANNER}
        </div>
      )}
      {status && (
        <Card style={{ padding: 16, marginTop: 12 }}>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 8, margin: 0, fontFamily: 'var(--f-body)' }}>
          <dt>Ollama</dt>
          <dd>
            {status.ollama.reachable
              ? `reachable${status.ollama.version ? ` (v${status.ollama.version})` : ''}, ${status.ollama.models.length} model(s)`
              : `unreachable (${status.ollama.error ?? 'unknown'})`}
            {status.ollama.reachable && activeModel && (
              <span data-testid="status-ollama-active">
                {' '}· active: <strong>{activeModel.modelId ?? '(unset)'}</strong>
              </span>
            )}
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
          <dt>Calendar</dt>
          <dd>
            <IntegrationStatusRow kind="calendar" />
          </dd>
        </dl>
        </Card>
      )}
    </section>
  );
}
