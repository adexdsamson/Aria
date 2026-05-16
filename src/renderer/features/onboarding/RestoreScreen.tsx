/**
 * Restore from backup. Reached from UnlockScreen's "forgot password" link
 * after 5 failed unlock attempts. Collects mnemonic + daily password + a
 * backup file path, then invokes `window.aria.backupRestore`.
 */
import { useState } from 'react';

const ARIABACKUP_HINT =
  'Pick an .ariabackup file you previously saved from Settings → Create backup.';

export function RestoreScreen(): JSX.Element {
  const [mnemonic, setMnemonic] = useState('');
  const [dailyPassword, setDailyPassword] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function wordCount(s: string): number {
    return s.trim().split(/\s+/u).filter(Boolean).length;
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setResult(null);
    const res = (await window.aria.backupRestore({
      source: backupPath,
      backupPath,
      mnemonic: mnemonic.trim(),
      dailyPassword,
      passphrase: dailyPassword,
    } as never)) as { ok?: boolean; error?: string; restartRequired?: boolean };
    setSubmitting(false);
    if (res.ok) {
      setResult('Restore successful — please relaunch Aria.');
    } else {
      setError(res.error ?? 'Restore failed');
    }
  }

  return (
    <section data-testid="restore-screen" style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Restore from backup</h1>
      <p>{ARIABACKUP_HINT}</p>
      <label style={{ display: 'block', marginTop: 12 }}>
        Backup file path
        <input
          type="text"
          data-testid="restore-backup-path"
          value={backupPath}
          onChange={(e) => setBackupPath(e.target.value)}
          placeholder="C:\path\to\aria-2026-05-16.ariabackup"
          style={{ width: '100%', padding: 8, marginTop: 4 }}
        />
      </label>
      <label style={{ display: 'block', marginTop: 12 }}>
        Your 12-word recovery phrase
        <textarea
          data-testid="restore-mnemonic"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          rows={3}
          style={{ width: '100%', padding: 8, marginTop: 4, fontFamily: 'monospace' }}
        />
        <small>Words entered: {wordCount(mnemonic)}/12</small>
      </label>
      <label style={{ display: 'block', marginTop: 12 }}>
        Daily password (the one that goes with this vault)
        <input
          type="password"
          data-testid="restore-password"
          value={dailyPassword}
          onChange={(e) => setDailyPassword(e.target.value)}
          style={{ width: '100%', padding: 8, marginTop: 4 }}
        />
      </label>
      {error && (
        <p data-testid="restore-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      {result && (
        <p data-testid="restore-success" style={{ color: 'green' }}>
          {result}
        </p>
      )}
      <button
        data-testid="restore-submit"
        onClick={submit}
        disabled={
          submitting ||
          wordCount(mnemonic) !== 12 ||
          backupPath.length === 0 ||
          dailyPassword.length < 8
        }
        style={{ marginTop: 16, padding: '8px 16px' }}
      >
        {submitting ? 'Restoring…' : 'Restore'}
      </button>
    </section>
  );
}
