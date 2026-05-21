/**
 * RagIndexSection — Settings → RAG index ("Personal index" per design-ref).
 *
 * Phase 9 design-ref `app-screen-settings.jsx > RagIndex` parity pass:
 *   - "SETTING · VI" gold mono eyebrow + h1 "Personal index"
 *   - Playfair italic body: "Embeddings over your mail and meetings. Local-only —
 *     nothing leaves the device."
 *   - KPI strip card: 4 columns (Backend / Model / Dimensions / Estimated) with
 *     Playfair display values + mono uppercase labels
 *   - Indexed-chunks progress bar + last-indexed mono subline
 *   - Backfill card: heading + body explainer + Build now / Later buttons
 *     (only when state=pending)
 *   - Capacity banners (warn/hard) when fallback backend nears caps
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useEffect, useState } from 'react';
import type {
  RagBackfillStatusDto,
  RagIndexStatusDto,
} from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
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
  const estStorageBytes = status ? status.aliveChunkCount * 4096 : 0;
  const embedded = status ? status.aliveChunkCount - status.dirtyChunkCount : 0;
  const total = status?.aliveChunkCount ?? 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((embedded / total) * 100)) : 0;

  return (
    <section
      data-testid="settings-rag-index"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
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
        Setting · VI
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
        Personal index
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 32px 0',
          maxWidth: '52em',
          lineHeight: 1.6,
        }}
      >
        Embeddings over your mail and meetings. Local-only — nothing leaves the device.
      </p>

      {error && <BannerNote tone="block">{error}</BannerNote>}
      {ollamaDown && (
        <BannerNote tone="block" testId="rag-ollama-down">
          Aria couldn&apos;t reach the local model — please check Ollama is running.
        </BannerNote>
      )}
      {status?.vectorBackend === 'fallback' && status.aliveChunkCount >= HARD_CAP && (
        <BannerNote tone="block" testId="rag-capacity-hard">
          Fallback index at capacity ({status.aliveChunkCount.toLocaleString()}/250,000 chunks).
          Indexing is paused. Reinstall Aria from a build that ships sqlite-vec native binaries.
        </BannerNote>
      )}
      {status?.vectorBackend === 'fallback' &&
        status.aliveChunkCount >= WARN_CAP &&
        status.aliveChunkCount < HARD_CAP && (
          <BannerNote tone="warn" testId="rag-capacity-warn">
            Fallback index approaching capacity ({status.aliveChunkCount.toLocaleString()}/250,000
            chunks). Consider reinstalling Aria from a build that ships sqlite-vec.
          </BannerNote>
        )}

      {status && (
        <>
          {/* KPI strip card */}
          <div
            style={{
              padding: '20px 24px',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 22,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 20,
                marginBottom: 22,
              }}
            >
              <KpiCell label="Backend" value={status.vectorBackend} testid="rag-backend" />
              <KpiCell
                label="Model"
                value={status.activeModelId}
                testid="rag-active-model"
                size="sm"
              />
              <KpiCell label="Dimensions" value={`${status.activeModelDim}d`} />
              <KpiCell label="Estimated" value={bytesToHuman(estStorageBytes)} />
            </div>

            {/* Progress */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--gray)',
                }}
              >
                Indexed chunks
              </span>
              <span
                data-testid="rag-chunk-count"
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--ink)',
                  fontWeight: 600,
                }}
              >
                {embedded.toLocaleString()} / {total.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: 'var(--ivory-deep)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: 'var(--gold)',
                  borderRadius: 999,
                  transition: 'width 320ms cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              />
            </div>

            {/* Last-indexed mono subline */}
            <div
              style={{
                marginTop: 10,
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                color: 'var(--gray-soft)',
                letterSpacing: '0.06em',
              }}
            >
              {status.rebuildInProgress
                ? `Rebuilding for ${status.rebuildTargetModelId ?? 'new model'} — ${status.rebuildProgressDone}/${status.rebuildProgressTotal}`
                : status.dirtyChunkCount > 0
                  ? `${status.dirtyChunkCount.toLocaleString()} dirty chunks · ${status.perMinute}/min throughput`
                  : 'No backfill running'}
            </div>
          </div>
        </>
      )}

      {/* Backfill card */}
      {backfill && (
        <div
          style={{
            padding: '20px 24px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 22,
          }}
        >
          <h3
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 19,
              fontWeight: 500,
              color: 'var(--ink)',
              margin: '0 0 10px 0',
              lineHeight: 1.2,
            }}
          >
            Backfill
          </h3>
          <p
            style={{
              margin: '0 0 14px 0',
              fontSize: 14,
              color: 'var(--ink-soft)',
              lineHeight: 1.6,
              maxWidth: '52em',
            }}
          >
            {backfill.state === 'pending' ? (
              <>
                On first run Aria walks your historical mail and meetings to build the embedding
                index. Average time on Apple Silicon is ~6 min per 10k items; expect to leave this
                overnight on first run.
              </>
            ) : backfill.state === 'in_progress' ? (
              <>
                Backfill running — ETA {fmtEta(backfill.etaSecondsRemaining)} ·{' '}
                {backfill.dirtyRemaining.toLocaleString()} items remaining.
              </>
            ) : backfill.state === 'done' ? (
              <>Backfill complete. New mail and meeting notes are indexed incrementally.</>
            ) : (
              <>Backfill skipped — only new content will be indexed going forward.</>
            )}
          </p>

          {backfill.state === 'pending' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-testid="rag-backfill-start"
                onClick={() => void onStartBackfill()}
                disabled={starting}
                style={{
                  padding: '9px 18px',
                  fontFamily: 'var(--f-body)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--paper)',
                  background: starting ? 'var(--rule-strong)' : 'var(--gold)',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: starting ? 'not-allowed' : 'pointer',
                  transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (!starting) e.currentTarget.style.background = 'var(--gold-deep)';
                }}
                onMouseLeave={(e) => {
                  if (!starting) e.currentTarget.style.background = 'var(--gold)';
                }}
                onMouseDown={(e) => {
                  if (!starting) e.currentTarget.style.transform = 'scale(0.97)';
                }}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                {starting ? 'Starting…' : 'Build now'}
              </button>
              <button
                type="button"
                data-testid="rag-backfill-skip"
                onClick={() => void onSkipBackfill()}
                style={{
                  padding: '9px 16px',
                  fontFamily: 'var(--f-body)',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  background: 'transparent',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  transition: 'border-color 180ms ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold-light)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--rule-strong)')}
              >
                Later
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function KpiCell({
  label,
  value,
  testid,
  size,
}: {
  label: string;
  value: string;
  testid?: string;
  size?: 'sm';
}): JSX.Element {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        {...(testid ? { 'data-testid': testid } : {})}
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: size === 'sm' ? 18 : 24,
          fontWeight: 500,
          color: 'var(--ink)',
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function BannerNote({
  tone,
  testId,
  children,
}: {
  tone: 'block' | 'warn';
  testId?: string;
  children: React.ReactNode;
}): JSX.Element {
  const colors =
    tone === 'block'
      ? { fg: 'var(--rose)', bg: 'rgba(184,73,58,0.06)', border: 'var(--rose)' }
      : { fg: 'var(--gold-deep)', bg: 'rgba(184,134,11,0.08)', border: 'var(--gold)' };
  return (
    <div
      role={tone === 'block' ? 'alert' : 'status'}
      {...(testId ? { 'data-testid': testId } : {})}
      style={{
        marginBottom: 16,
        padding: '10px 14px',
        background: colors.bg,
        color: colors.fg,
        borderLeft: `2px solid ${colors.border}`,
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        fontSize: 13.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
