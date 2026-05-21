/**
 * StatusPanel — one-glance integration health rollup.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > Status` parity pass:
 *   - "SETTING · I" mono gold caps eyebrow + H1 "Status"
 *   - Playfair italic body: "A one-glance rollup of every integration and
 *     service Aria depends on. Anything amber is a soft warning; anything
 *     red is blocking."
 *   - Stacked service rows in a paper card: colored dot + service name +
 *     mono details on right + status pill (OK / WARN / BLOCK)
 *   - Footer caption (Playfair italic): "Cron registry size · 3 · suspend /
 *     resume invariant holds."
 *
 * IPC + state + data-testids preserved verbatim. The legacy banner test-ids
 * (`banner-local-only`, `banner-frontier-only`, `banner-no-provider`) still
 * render — they're now wrapped in an editorial chrome but the exact text
 * strings + test-ids are unchanged.
 */
import { useEffect, useState } from 'react';
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

type RowState = 'ok' | 'warn' | 'block' | 'idle';

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
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        color: 'var(--ink)',
        background: 'var(--paper)',
        minHeight: '100%',
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
          marginBottom: 8,
        }}
      >
        Setting · I
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.05,
        }}
      >
        Status
      </h2>

      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 32px 0',
          maxWidth: '48em',
          lineHeight: 1.55,
        }}
      >
        A one-glance rollup of every integration and service Aria depends on. Anything amber is a
        soft warning; anything red is blocking.
      </p>

      {/* Provider-availability banners — preserved data-testids + copy */}
      {status?.mode === 'LOCAL_ONLY' && (
        <BannerNote tone="info" testId="banner-local-only">
          {LOCAL_ONLY_BANNER}
        </BannerNote>
      )}
      {status?.mode === 'FRONTIER_ONLY' && (
        <BannerNote tone="info" testId="banner-frontier-only">
          {FRONTIER_ONLY_BANNER}
        </BannerNote>
      )}
      {status?.mode === 'NONE' && (
        <BannerNote tone="block" testId="banner-no-provider" role="alert">
          {NONE_BANNER}
        </BannerNote>
      )}

      {status && (
        <>
          <div
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            <ServiceRow
              name="Local model"
              state={status.ollama.reachable ? 'ok' : 'block'}
              details={
                status.ollama.reachable
                  ? `Ollama · ${status.ollama.version ? `v${status.ollama.version} · ` : ''}${status.ollama.models.length} model${status.ollama.models.length === 1 ? '' : 's'}${activeModel?.modelId ? ` · active ${activeModel.modelId}` : ''}`
                  : `unreachable (${status.ollama.error ?? 'unknown'})`
              }
              testid="status-row-ollama"
            />
            <ServiceRow
              name="Frontier API"
              state={
                status.activeProvider
                  ? 'ok'
                  : status.frontierConfigured
                    ? 'warn'
                    : 'idle'
              }
              details={
                status.activeProvider
                  ? `${status.activeProvider} · ${status.frontierConfigured ? 'configured' : 'no key'}`
                  : 'no active provider'
              }
              testid="status-row-frontier"
            />
            <ServiceRow
              name="Mode"
              state={status.mode === 'NONE' ? 'block' : 'ok'}
              details={status.mode}
              testid="status-row-mode"
            />
            <ServiceRow
              name="Gmail"
              state="ok"
              details={<IntegrationStatusRow kind="gmail" />}
              testid="status-row-gmail"
            />
            <ServiceRow
              name="Google Calendar"
              state="ok"
              details={<IntegrationStatusRow kind="calendar" />}
              testid="status-row-calendar"
            />
            <ServiceRow
              name="Encrypted DB"
              state="ok"
              details={
                <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)' }}>
                  {status.dataDir}
                </code>
              }
              testid="status-row-db"
              isLast
            />
          </div>

          <p
            style={{
              marginTop: 16,
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--gray)',
            }}
          >
            Suspend / resume invariant holds.
          </p>
        </>
      )}
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function BannerNote({
  tone,
  children,
  testId,
  role,
}: {
  tone: 'info' | 'warn' | 'block';
  children: React.ReactNode;
  testId: string;
  role?: 'alert' | 'status';
}): JSX.Element {
  const colors = {
    info: { fg: 'var(--gold-deep)', bg: 'rgba(184,134,11,0.06)', border: 'rgba(184,134,11,0.30)' },
    warn: { fg: 'var(--gold-deep)', bg: 'rgba(184,134,11,0.10)', border: 'rgba(184,134,11,0.40)' },
    block: { fg: 'var(--rose)', bg: 'rgba(184,73,58,0.06)', border: 'rgba(184,73,58,0.30)' },
  }[tone];
  return (
    <div
      role={role ?? (tone === 'block' ? 'alert' : 'status')}
      data-testid={testId}
      style={{
        marginBottom: 18,
        padding: '12px 16px',
        background: colors.bg,
        color: colors.fg,
        borderLeft: `2px solid ${colors.border.replace('0.30', '1')}`,
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function ServiceRow({
  name,
  state,
  details,
  testid,
  isLast,
}: {
  name: string;
  state: RowState;
  details: React.ReactNode;
  testid: string;
  isLast?: boolean;
}): JSX.Element {
  const dotColor =
    state === 'ok' ? 'var(--moss)' : state === 'warn' ? 'var(--gold)' : state === 'block' ? 'var(--rose)' : 'var(--gray-soft)';
  const pillLabel =
    state === 'ok' ? 'OK' : state === 'warn' ? 'WARN' : state === 'block' ? 'BLOCK' : 'IDLE';
  const pillFg =
    state === 'ok' ? 'var(--moss)' : state === 'warn' ? 'var(--gold-deep)' : state === 'block' ? 'var(--rose)' : 'var(--gray)';
  const pillBg =
    state === 'ok'
      ? 'rgba(91,110,58,0.08)'
      : state === 'warn'
        ? 'rgba(184,134,11,0.08)'
        : state === 'block'
          ? 'rgba(184,73,58,0.08)'
          : 'var(--ivory-deep)';
  const pillBorder =
    state === 'ok'
      ? 'rgba(91,110,58,0.30)'
      : state === 'warn'
        ? 'rgba(184,134,11,0.30)'
        : state === 'block'
          ? 'rgba(184,73,58,0.30)'
          : 'var(--rule-strong)';

  return (
    <div
      data-testid={testid}
      style={{
        display: 'grid',
        gridTemplateColumns: '16px minmax(140px, 200px) 1fr auto',
        gap: 14,
        alignItems: 'center',
        padding: '14px 18px',
        borderBottom: isLast ? 'none' : '1px solid var(--rule)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: 50,
          background: dotColor,
          justifySelf: 'center',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11.5,
          color: 'var(--gray)',
          letterSpacing: '0.02em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {details}
      </span>
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: pillFg,
          background: pillBg,
          border: `1px solid ${pillBorder}`,
          padding: '3px 8px',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {pillLabel}
      </span>
    </div>
  );
}
