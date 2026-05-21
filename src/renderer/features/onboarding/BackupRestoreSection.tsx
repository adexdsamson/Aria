/**
 * Backup & restore settings section — redesigned to match design-ref VII.
 */
import { useState, useEffect, useCallback } from 'react';
import { RestoreScreen } from './RestoreScreen';

interface BackupStats {
  dbSizeBytes: number;
  lastBackupName: string | null;
  lastBackupAt: string | null;
  schemaVersion: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatBackupDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getTodayBackupName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `aria-backup-${y}-${m}-${day}.db`;
}

export function BackupRestoreSection(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [showPhraseVerify, setShowPhraseVerify] = useState(false);
  const [stats, setStats] = useState<BackupStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await window.aria.backupStats();
      setStats(s);
    } catch {
      // stats unavailable before DB open
    }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats]);

  async function createBackup(): Promise<void> {
    setBusy(true);
    setError(null);
    setLastResult(null);
    const res = (await window.aria.backupCreate()) as { path?: string; error?: string };
    setBusy(false);
    if (res.path) {
      setLastResult(res.path);
      void loadStats();
    } else if (res.error === 'CANCELLED') {
      setError(null);
    } else {
      setError(res.error ?? 'Backup failed');
    }
  }

  const schemaVer = stats?.schemaVersion != null
    ? `v${String(stats.schemaVersion).padStart(3, '0')}`
    : 'v—';

  return (
    <section
      data-testid="backup-restore-section"
      style={{ padding: '40px 48px', maxWidth: 860, fontFamily: 'var(--f-body)', color: 'var(--ink)' }}
    >
      <style>{`
        .brs-stat-card {
          flex: 1;
          min-width: 200px;
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          padding: 20px 24px;
          background: var(--paper);
        }
        .brs-stat-label {
          font-family: var(--f-mono);
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--gray);
          margin-bottom: 10px;
        }
        .brs-stat-value {
          font-family: var(--f-display);
          font-size: 36px;
          font-weight: 400;
          color: var(--ink);
          line-height: 1;
          margin-bottom: 6px;
        }
        .brs-stat-sub {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--gray);
          letter-spacing: 0.05em;
        }
        .brs-action-card {
          flex: 1;
          min-width: 220px;
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          padding: 20px 24px;
          background: var(--paper);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          text-align: left;
        }
        .brs-action-card:hover {
          border-color: var(--gold);
          background: var(--ivory-deep, #faf8f4);
        }
        .brs-action-card.primary {
          border-color: var(--gold);
          background: rgba(185,144,60,0.06);
        }
        .brs-action-card.primary:hover {
          background: rgba(185,144,60,0.12);
        }
        .brs-action-card:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .brs-action-title {
          font-family: var(--f-body);
          font-size: 15px;
          font-weight: 500;
          color: var(--ink);
          margin-bottom: 4px;
        }
        .brs-action-card.primary .brs-action-title {
          color: var(--gold);
        }
        .brs-action-sub {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--gray);
          letter-spacing: 0.02em;
        }
        .brs-phrase-link {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          font-family: var(--f-body);
          font-size: 14px;
          color: var(--ink-soft, #6b6455);
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .brs-phrase-link:hover { color: var(--ink); }
        .brs-result {
          margin-top: 16px;
          padding: 12px 16px;
          background: var(--ivory-deep, #faf8f4);
          border: 1px solid var(--rule);
          border-top: 2px solid var(--moss, #4a5b3a);
          border-radius: var(--radius);
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--ink);
          word-break: break-all;
        }
        .brs-error {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(177,52,52,0.06);
          border: 1px solid var(--rose, #b13434);
          border-radius: var(--radius);
          font-size: 13px;
          color: var(--rose, #b13434);
        }
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
        Setting · VII
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
        Backup &amp; restore
      </h2>

      {/* Description */}
      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 14,
        fontStyle: 'italic',
        color: 'var(--ink-soft, #6b6455)',
        lineHeight: 1.6,
        margin: '0 0 28px',
        maxWidth: 640,
      }}>
        Everything Aria knows lives in one encrypted SQLite database on this machine.
        Backups are VACUUM-INTO copies of that database, still encrypted with your
        daily password and recoverable with your 12-word phrase.
      </p>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div className="brs-stat-card">
          <div className="brs-stat-label">Database</div>
          <div className="brs-stat-value">
            {stats ? formatBytes(stats.dbSizeBytes) : '—'}
          </div>
          <div className="brs-stat-sub">SQLCipher · chacha20 · {schemaVer}</div>
        </div>
        <div className="brs-stat-card">
          <div className="brs-stat-label">Last Backup</div>
          <div className="brs-stat-value" style={{ fontSize: 28 }}>
            {stats ? formatBackupDate(stats.lastBackupAt) : '—'}
          </div>
          <div className="brs-stat-sub">
            {stats?.lastBackupName ?? 'No backups found'}
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <button
          className="brs-action-card primary"
          data-testid="backup-create-btn"
          disabled={busy}
          onClick={createBackup}
        >
          <div className="brs-action-title">
            {busy ? 'Working…' : 'Export encrypted backup'}
          </div>
          <div className="brs-action-sub">VACUUM INTO '{getTodayBackupName()}'</div>
        </button>
        <button
          className="brs-action-card"
          data-testid="backup-restore-btn"
          onClick={() => { setShowRestore(v => !v); setShowPhraseVerify(false); }}
        >
          <div className="brs-action-title">Restore from file</div>
          <div className="brs-action-sub">Verifies recovery phrase before swap</div>
        </button>
      </div>

      {lastResult && (
        <div className="brs-result" data-testid="backup-result">
          ✓ Saved to {lastResult}
        </div>
      )}
      {error && (
        <div className="brs-error" data-testid="backup-error">{error}</div>
      )}

      {showRestore && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 24 }}>
          <RestoreScreen />
        </div>
      )}

      {/* Recovery phrase section */}
      <div style={{
        marginTop: 32,
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius)',
        padding: '20px 24px',
        background: 'var(--paper)',
      }}>
        <div style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 10,
        }}>
          Recovery Phrase
        </div>
        <p style={{ fontSize: 14, color: 'var(--ink-soft, #6b6455)', margin: '0 0 12px', lineHeight: 1.55 }}>
          Your 12-word phrase was shown once during setup. It is the only way to
          recover your data if you lose your daily password.
        </p>
        <button
          className="brs-phrase-link"
          onClick={() => { setShowPhraseVerify(v => !v); setShowRestore(false); }}
        >
          {showPhraseVerify ? 'Hide verification' : 'Verify I still have my phrase →'}
        </button>
        {showPhraseVerify && (
          <div style={{ marginTop: 16 }}>
            <RestoreScreen />
          </div>
        )}
      </div>
    </section>
  );
}
