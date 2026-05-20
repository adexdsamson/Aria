/**
 * Restore from backup. Reached from UnlockScreen's "forgot password" link
 * after 5 failed unlock attempts. Collects mnemonic + daily password + a
 * backup file path, then invokes `window.aria.backupRestore`.
 */
import { useState } from 'react';
import { AppLogo, Button } from '../../components/editorial';

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 12px',
  marginTop: 4,
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  marginTop: 12,
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--gray)',
  fontWeight: 500,
};

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
    <section
      data-testid="restore-screen"
      style={{ padding: 32, maxWidth: 720, margin: '0 auto', color: 'var(--ink)', fontFamily: 'var(--f-body)', background: 'var(--paper)' }}
    >
      <div style={{ marginBottom: 18 }}>
        <AppLogo variant="header" />
      </div>
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
        Recovery · restore from backup
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 500,
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 12,
        }}
      >
        Restore from backup
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55 }}>{ARIABACKUP_HINT}</p>
      <label style={LABEL_STYLE}>
        Backup file path
        <input
          type="text"
          data-testid="restore-backup-path"
          value={backupPath}
          onChange={(e) => setBackupPath(e.target.value)}
          placeholder="C:\path\to\aria-2026-05-16.ariabackup"
          style={INPUT_STYLE}
        />
      </label>
      <label style={LABEL_STYLE}>
        Your 12-word recovery phrase
        <textarea
          data-testid="restore-mnemonic"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          rows={3}
          style={{
            ...INPUT_STYLE,
            minHeight: 80,
            padding: 12,
            fontFamily: 'var(--f-mono)',
          }}
        />
        <small style={{ fontFamily: 'var(--f-mono)', color: 'var(--gray)' }}>
          Words entered: {wordCount(mnemonic)}/12
        </small>
      </label>
      <label style={LABEL_STYLE}>
        Daily password (the one that goes with this vault)
        <input
          type="password"
          data-testid="restore-password"
          value={dailyPassword}
          onChange={(e) => setDailyPassword(e.target.value)}
          style={INPUT_STYLE}
        />
      </label>
      {error && (
        <p
          data-testid="restore-error"
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
      {result && (
        <p
          data-testid="restore-success"
          style={{
            color: 'var(--moss, #4a5b3a)',
            marginTop: 12,
            padding: 10,
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderTop: '2px solid var(--moss, #4a5b3a)',
            borderRadius: 'var(--radius)',
          }}
        >
          {result}
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          data-testid="restore-submit"
          onClick={submit}
          disabled={
            submitting ||
            wordCount(mnemonic) !== 12 ||
            backupPath.length === 0 ||
            dailyPassword.length < 8
          }
        >
          {submitting ? 'Restoring…' : 'Restore'}
        </Button>
      </div>
    </section>
  );
}
