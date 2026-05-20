/**
 * Plan 08-04 Task 5 — Settings → Updates.
 *
 * Surfaces the channel badge ('tester' by default), a "Check for updates"
 * button, a progress bar (driven by updater:progress events forwarded
 * from main process), and an "Install and restart" button enabled only
 * after update-downloaded.
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

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdatesSection(): JSX.Element {
  const [channel, setChannel] = useState<string>('tester');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await window.aria.updaterChannel();
      if (!isErr(res)) setChannel(res.channel);
    })();
  }, []);

  useEffect(() => {
    // Subscribe to push events forwarded from src/main/release/updater.ts.
    const ipc = (window as unknown as { electron?: { ipcRenderer?: { on(c: string, h: (...a: unknown[]) => void): void; removeAllListeners(c: string): void } } }).electron?.ipcRenderer;
    if (!ipc || !ipc.on) return;
    const onAvailable = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as { version?: string } | undefined;
      setPhase('available');
      setUpdateVersion(payload?.version ?? null);
      setMessage(null);
    };
    const onProgress = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as ProgressInfo | undefined;
      setPhase('downloading');
      if (payload) setProgress(payload);
    };
    const onDownloaded = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as { version?: string } | undefined;
      setPhase('downloaded');
      if (payload?.version) setUpdateVersion(payload.version);
    };
    const onError = (..._args: unknown[]) => {
      const payload = (_args[1] ?? _args[0]) as { message?: string } | undefined;
      setPhase('error');
      setMessage(payload?.message ?? 'updater error');
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
      setMessage(('error' in res ? res.error : 'check failed') as string);
      return;
    }
    if (!res.info) {
      setPhase('idle');
      setMessage('No update available.');
    }
    // 'available' phase is set by the push event when present.
  }, []);

  const onDownload = useCallback(async () => {
    setPhase('downloading');
    setMessage(null);
    const res = await window.aria.updaterDownload();
    if (isErr(res) || 'error' in res) {
      setPhase('error');
      setMessage(('error' in res ? res.error : 'download failed') as string);
    }
  }, []);

  const onRestart = useCallback(async () => {
    const res = await window.aria.updaterRestart();
    if (isErr(res) || 'error' in res) {
      setPhase('error');
      setMessage(('error' in res ? res.error : 'restart failed') as string);
    }
  }, []);

  return (
    <section data-testid="settings-updates">
      <h2>Updates</h2>
      <div style={{ marginBottom: 12 }}>
        Channel: <strong data-testid="updates-channel">{channel}</strong>
      </div>

      <button data-testid="updates-check" onClick={() => void onCheck()}>
        Check for updates
      </button>

      {phase === 'available' && updateVersion && (
        <div style={{ marginTop: 12 }}>
          Version <code>{updateVersion}</code> available.{' '}
          <button data-testid="updates-download" onClick={() => void onDownload()}>
            Download
          </button>
        </div>
      )}

      {phase === 'downloading' && (
        <div style={{ marginTop: 12 }}>
          <progress
            data-testid="updates-progress"
            value={progress?.percent ?? 0}
            max={100}
          />
          <span style={{ marginLeft: 8 }}>{Math.round(progress?.percent ?? 0)}%</span>
        </div>
      )}

      {phase === 'downloaded' && (
        <div style={{ marginTop: 12 }}>
          Update {updateVersion ? `v${updateVersion}` : ''} ready.{' '}
          <button data-testid="updates-restart" onClick={() => void onRestart()}>
            Install and restart
          </button>
        </div>
      )}

      {message && (
        <div data-testid="updates-message" style={{ marginTop: 12, color: 'var(--aria-fg-muted)' }}>
          {message}
        </div>
      )}
    </section>
  );
}
