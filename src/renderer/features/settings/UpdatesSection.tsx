/**
 * Plan 08-04 Task 5 — Settings → Updates.
 * Redesigned to match design-ref (SETTINGS · UPDATES layout).
 */
import { useCallback, useEffect, useState } from 'react';
import type { IpcError } from '../../../shared/ipc-contract';

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

interface ProgressInfo {
  percent: number;
  transferred?: number;
  total?: number;
}

interface UpdateInfo {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ note: string }> | null;
}

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

function parseReleaseNotes(notes: UpdateInfo['releaseNotes']): string[] {
  if (!notes) return [];
  if (typeof notes === 'string') {
    return notes
      .split(/\n/)
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (Array.isArray(notes)) {
    return notes.map(n => (typeof n === 'string' ? n : n.note)).filter(Boolean).slice(0, 8);
  }
  return [];
}


export function UpdatesSection(): JSX.Element {
  const [channel, setChannel] = useState<string>('tester');
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await window.aria.updaterChannel();
      if (!isErr(res)) setChannel(res.channel);
    })();
    // Read installed version from package info if exposed
    try {
      const appVer = (window as unknown as { __ARIA_VERSION__?: string }).__ARIA_VERSION__;
      if (appVer) setInstalledVersion(appVer);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const ipc = (window as unknown as {
      electron?: {
        ipcRenderer?: {
          on(c: string, h: (...a: unknown[]) => void): void;
          removeAllListeners(c: string): void;
        };
      };
    }).electron?.ipcRenderer;
    if (!ipc?.on) return;

    const onAvailable = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as UpdateInfo | undefined;
      setPhase('available');
      setUpdateInfo(payload ?? null);
      setMessage(null);
    };
    const onProgress = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as ProgressInfo | undefined;
      setPhase('downloading');
      if (payload) setProgress(payload);
    };
    const onDownloaded = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as UpdateInfo | undefined;
      setPhase('downloaded');
      if (payload) setUpdateInfo(u => ({ ...u, ...payload }));
    };
    const onError = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as { message?: string } | undefined;
      setPhase('error');
      setMessage(payload?.message ?? 'Updater error');
    };

    ipc.on('updater:available', onAvailable);
    ipc.on('updater:progress', onProgress);
    ipc.on('updater:downloaded', onDownloaded);
    ipc.on('updater:error', onError);
    return () => {
      ipc.removeAllListeners?.('updater:available');
      ipc.removeAllListeners?.('updater:progress');
      ipc.removeAllListeners?.('updater:downloaded');
      ipc.removeAllListeners?.('updater:error');
    };
  }, []);

  const onCheck = useCallback(async () => {
    setPhase('checking');
    setMessage(null);
    const res = await window.aria.updaterCheck();
    if (isErr(res) || 'error' in res) {
      setPhase('error');
      setMessage(('error' in res ? res.error : 'Check failed') as string);
      return;
    }
    if (!res.info) {
      setPhase('idle');
      setMessage('Aria is up to date.');
    }
  }, []);

  const onDownload = useCallback(async () => {
    setPhase('downloading');
    setMessage(null);
    const res = await window.aria.updaterDownload();
    if (isErr(res) || 'error' in res) {
      setPhase('error');
      setMessage(('error' in res ? res.error : 'Download failed') as string);
    }
  }, []);

  const onRestart = useCallback(async () => {
    const res = await window.aria.updaterRestart();
    if (isErr(res) || 'error' in res) {
      setPhase('error');
      setMessage(('error' in res ? res.error : 'Restart failed') as string);
    }
  }, []);

  const releaseNotes = parseReleaseNotes(updateInfo?.releaseNotes);
  const releaseVersion = updateInfo?.version;
  const releaseDate = updateInfo?.releaseDate;

  return (
    <section
      data-testid="settings-updates"
      style={{ padding: '40px 48px', maxWidth: 860, fontFamily: 'var(--f-body)', color: 'var(--ink)' }}
    >
      <style>{`
        .upd-status-card {
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          padding: 18px 24px;
          display: flex;
          align-items: center;
          gap: 0;
          background: var(--paper);
          margin-bottom: 20px;
        }
        .upd-status-col {
          flex: 1;
          padding-right: 24px;
          border-right: 1px solid var(--rule);
        }
        .upd-status-col:last-of-type {
          border-right: none;
          padding-right: 0;
          padding-left: 24px;
        }
        .upd-col-label {
          font-family: var(--f-mono);
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--gray);
          margin-bottom: 4px;
        }
        .upd-col-value {
          font-family: var(--f-display);
          font-size: 22px;
          font-weight: 400;
          color: var(--ink);
        }
        .upd-check-btn {
          margin-left: auto;
          flex-shrink: 0;
          padding: 8px 18px;
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          background: var(--paper);
          font-family: var(--f-body);
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: border-color 0.15s;
        }
        .upd-check-btn:hover { border-color: var(--gold); }
        .upd-check-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .upd-available-card {
          border: 1px solid var(--gold);
          border-left: 3px solid var(--gold);
          border-radius: var(--radius);
          padding: 20px 24px;
          background: rgba(185,144,60,0.04);
          margin-bottom: 20px;
        }
        .upd-avail-header {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 14px;
        }
        .upd-avail-lightning {
          color: var(--gold);
          font-size: 14px;
        }
        .upd-avail-version {
          font-family: var(--f-display);
          font-size: 20px;
          font-weight: 400;
          color: var(--ink);
        }
        .upd-avail-date {
          font-family: var(--f-mono);
          font-size: 10px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--gray);
        }
        .upd-download-btn {
          margin-left: auto;
          padding: 8px 20px;
          background: var(--gold);
          border: none;
          border-radius: var(--radius);
          font-family: var(--f-body);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: opacity 0.15s;
        }
        .upd-download-btn:hover { opacity: 0.88; }
        .upd-download-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .upd-whats-new-label {
          font-family: var(--f-mono);
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--gray);
          margin-bottom: 10px;
        }
        .upd-notes-list {
          margin: 0;
          padding: 0 0 0 18px;
          list-style: disc;
          color: var(--ink-soft, #6b6455);
          font-size: 14px;
          line-height: 1.65;
        }
        .upd-progress-bar {
          height: 3px;
          background: var(--rule);
          border-radius: 2px;
          margin-top: 12px;
          overflow: hidden;
        }
        .upd-progress-fill {
          height: 100%;
          background: var(--gold);
          border-radius: 2px;
          transition: width 0.3s;
        }
        .upd-message {
          margin-top: 16px;
          font-size: 13px;
          color: var(--ink-soft, #6b6455);
          font-style: italic;
        }
        .upd-error {
          margin-top: 16px;
          padding: 12px 16px;
          border: 1px solid var(--rose, #b13434);
          border-radius: var(--radius);
          background: rgba(177,52,52,0.06);
          font-size: 13px;
          color: var(--rose, #b13434);
        }
        .upd-restart-btn {
          margin-top: 16px;
          padding: 10px 24px;
          background: var(--gold);
          border: none;
          border-radius: var(--radius);
          font-family: var(--f-body);
          font-size: 14px;
          font-weight: 500;
          color: #fff;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .upd-restart-btn:hover { opacity: 0.88; }
      `}</style>

      {/* Breadcrumb */}
      <div style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'var(--gold)',
        marginBottom: 10,
      }}>
        Settings · Updates
      </div>

      {/* Heading */}
      <h2 style={{
        fontFamily: 'var(--f-display)',
        fontSize: 32,
        fontWeight: 400,
        color: 'var(--ink)',
        margin: '0 0 12px',
        borderBottom: '1px solid var(--rule)',
        paddingBottom: 16,
      }}>
        Software updates
      </h2>

      {/* Description */}
      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 14,
        fontStyle: 'italic',
        color: 'var(--ink-soft, #6b6455)',
        lineHeight: 1.6,
        margin: '0 0 28px',
        maxWidth: 560,
      }}>
        Aria auto-updates on the {channel} channel by default. Notarized
        binaries; signature verified before install.
      </p>

      {/* Channel + version status card */}
      <div className="upd-status-card">
        <div className="upd-status-col">
          <div className="upd-col-label">Channel</div>
          <div className="upd-col-value" data-testid="updates-channel">{channel}</div>
        </div>
        {installedVersion && (
          <div className="upd-status-col">
            <div className="upd-col-label">Installed</div>
            <div className="upd-col-value">v{installedVersion}</div>
          </div>
        )}
        <button
          className="upd-check-btn"
          data-testid="updates-check"
          disabled={phase === 'checking' || phase === 'downloading'}
          onClick={() => void onCheck()}
        >
          <span>↺</span>
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {/* Update available card */}
      {(phase === 'available' || phase === 'downloading' || phase === 'downloaded') && releaseVersion && (
        <div className="upd-available-card">
          <div className="upd-avail-header">
            <span className="upd-avail-lightning">⚡</span>
            <span className="upd-avail-version">v{releaseVersion} available</span>
            {releaseDate && (
              <span className="upd-avail-date">
                Released {new Date(releaseDate).toLocaleDateString('en-GB', {
                  year: 'numeric', month: 'short', day: 'numeric',
                }).toUpperCase()}
              </span>
            )}
            {phase === 'available' && (
              <button
                className="upd-download-btn"
                data-testid="updates-download"
                onClick={() => void onDownload()}
              >
                <span>↓</span> Download
              </button>
            )}
            {phase === 'downloaded' && (
              <button
                className="upd-download-btn"
                data-testid="updates-restart"
                onClick={() => void onRestart()}
              >
                ↺ Install &amp; restart
              </button>
            )}
          </div>

          {releaseNotes.length > 0 && (
            <>
              <div className="upd-whats-new-label">What's new</div>
              <ul className="upd-notes-list">
                {releaseNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </>
          )}

          {phase === 'downloading' && (
            <div>
              <div className="upd-progress-bar">
                <div
                  className="upd-progress-fill"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: 'var(--gray)',
                marginTop: 6,
                textAlign: 'right',
              }}>
                {Math.round(progress?.percent ?? 0)}%
              </div>
              <progress
                data-testid="updates-progress"
                value={progress?.percent ?? 0}
                max={100}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Idle up-to-date message */}
      {message && phase !== 'error' && (
        <div className="upd-message" data-testid="updates-message">{message}</div>
      )}

      {phase === 'error' && (
        <div className="upd-error" data-testid="updates-message">{message}</div>
      )}
    </section>
  );
}
