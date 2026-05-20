/**
 * Standalone settings-section component for backup + restore.
 *
 * Plan 03 (wave 4) imports `<BackupRestoreSection/>` from this file and
 * mounts it inside SettingsScreen.tsx. Plan 02 does NOT touch
 * SettingsScreen.tsx itself.
 */
import { useState } from 'react';
import { RestoreScreen } from './RestoreScreen';
import { Button } from '../../components/editorial';

export function BackupRestoreSection(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  async function createBackup(): Promise<void> {
    setBusy(true);
    setError(null);
    setLastResult(null);
    const res = (await window.aria.backupCreate()) as {
      path?: string;
      error?: string;
    };
    setBusy(false);
    if (res.path) setLastResult(`Backup saved to ${res.path}`);
    else if (res.error === 'CANCELLED') setError(null);
    else setError(res.error ?? 'Backup failed');
  }

  return (
    <section
      data-testid="backup-restore-section"
      style={{ padding: 32, maxWidth: 720, margin: '0 auto', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--f-body)' }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Settings · Account
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          color: 'var(--ink)',
          marginTop: 0,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 12,
        }}
      >
        Backup &amp; restore
      </h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55 }}>
        Aria data is encrypted with your recovery phrase. A backup file (.ariabackup)
        can only be restored on a machine that has the same vault (or the original
        vault.json + your recovery phrase).
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button
          variant="primary"
          data-testid="backup-create-btn"
          disabled={busy}
          onClick={createBackup}
        >
          {busy ? 'Working…' : 'Create backup'}
        </Button>
        <Button
          variant="outline"
          data-testid="backup-restore-btn"
          onClick={() => setShowRestore((v) => !v)}
        >
          {showRestore ? 'Hide restore form' : 'Restore from backup'}
        </Button>
      </div>
      {lastResult && (
        <p
          data-testid="backup-result"
          style={{
            color: 'var(--ink)',
            marginTop: 12,
            padding: 10,
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderTop: '2px solid var(--moss, #4a5b3a)',
            borderRadius: 'var(--radius)',
          }}
        >
          {lastResult}
        </p>
      )}
      {error && (
        <p
          data-testid="backup-error"
          style={{
            color: 'var(--rose)',
            marginTop: 12,
            padding: 10,
            background: 'rgba(177,52,52,0.06)',
            border: '1px solid var(--rose)',
            borderRadius: 'var(--radius)',
          }}
        >
          {error}
        </p>
      )}
      {showRestore && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
          <RestoreScreen />
        </div>
      )}
    </section>
  );
}
