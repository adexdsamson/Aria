/**
 * Standalone settings-section component for backup + restore.
 *
 * Plan 03 (wave 4) imports `<BackupRestoreSection/>` from this file and
 * mounts it inside SettingsScreen.tsx. Plan 02 does NOT touch
 * SettingsScreen.tsx itself.
 */
import { useState } from 'react';
import { RestoreScreen } from './RestoreScreen';

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
    <section data-testid="backup-restore-section" style={{ padding: 16, maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>Backup &amp; restore</h2>
      <p>
        Aria data is encrypted with your recovery phrase. A backup file (.ariabackup)
        can only be restored on a machine that has the same vault (or the original
        vault.json + your recovery phrase).
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          data-testid="backup-create-btn"
          disabled={busy}
          onClick={createBackup}
        >
          {busy ? 'Working…' : 'Create backup'}
        </button>
        <button
          data-testid="backup-restore-btn"
          onClick={() => setShowRestore((v) => !v)}
        >
          {showRestore ? 'Hide restore form' : 'Restore from backup'}
        </button>
      </div>
      {lastResult && (
        <p data-testid="backup-result" style={{ color: 'green' }}>
          {lastResult}
        </p>
      )}
      {error && (
        <p data-testid="backup-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      {showRestore && (
        <div style={{ marginTop: 16, borderTop: '1px solid #444', paddingTop: 16 }}>
          <RestoreScreen />
        </div>
      )}
    </section>
  );
}
