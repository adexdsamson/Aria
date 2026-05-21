/**
 * Plan 10-03 Task 1 — Settings → Knowledge Folders section.
 *
 * Surfaces:
 *   - List of indexed folders (label, path, sensitivity badge, fileCount,
 *     bytesIndexed, status, lastScanAt, lastError)
 *   - Add-folder flow: pick-folder -> prescan -> threshold confirm (if
 *     >5k files OR >2 GB) -> label+sensitivity modal -> add-folder IPC
 *   - Per-folder controls: Reindex, flip sensitivity, Remove
 *   - Remove confirm dialog (3-split: render / cancel / confirm)
 *
 * Editorial design language (Phase 9), Aria animation patterns.
 * Destructive actions gate IPC behind confirm dialog.
 *
 * IPC channels used (window.aria.knowledge.*):
 *   listFolders, pickFolder, prescanFolder, addFolder, removeFolder,
 *   setSensitivity, reindex — total 7 distinct channels.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';

// ─── IPC shape (from ipc-contract) ──────────────────────────────────────────

interface KnowledgeFolderDto {
  id: string;
  path: string;
  label: string;
  sensitivity: 'general' | 'sensitive';
  status: 'active' | 'paused' | 'error';
  fileCount: number;
  bytesIndexed: number;
  lastScanAt: string | null;
  lastError: string | null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function truncatePath(p: string, maxLen = 48): string {
  if (p.length <= maxLen) return p;
  const half = Math.floor((maxLen - 3) / 2);
  return p.slice(0, half) + '…' + p.slice(-half);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
  destructive?: boolean;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
}: ConfirmDialogProps): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kf-confirm-title"
      style={overlayStyle()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div style={dialogStyle()}>
        <h3
          id="kf-confirm-title"
          style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginTop: 0, marginBottom: 10 }}
        >
          {title}
        </h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55, margin: '0 0 20px' }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            data-testid="kf-dialog-cancel"
            onClick={onCancel}
            style={outlineBtnStyle()}
          >
            Cancel
          </button>
          <button
            data-testid="kf-dialog-confirm"
            onClick={onConfirm}
            style={destructive ? destructiveBtnStyle() : primaryBtnStyle()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddFolderModalProps {
  path: string;
  onCancel(): void;
  onSubmit(label: string, sensitivity: 'general' | 'sensitive'): void;
}

function AddFolderModal({ path, onCancel, onSubmit }: AddFolderModalProps): JSX.Element {
  const [label, setLabel] = useState(path.split(/[/\\]/).pop() ?? '');
  const [sensitivity, setSensitivity] = useState<'general' | 'sensitive'>('general');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kf-add-title"
      style={overlayStyle()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div style={dialogStyle()}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
          Knowledge Folders
        </div>
        <h3
          id="kf-add-title"
          style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginTop: 0, marginBottom: 4 }}
        >
          Add folder
        </h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
          {truncatePath(path)}
        </p>

        <label style={labelStyle()}>
          Label
          <input
            data-testid="kf-add-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle()}
          />
        </label>

        <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 20px' }}>
          <legend style={{ ...labelStyle(), display: 'block', marginBottom: 8 }}>Sensitivity</legend>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input
                type="radio"
                name="kf-sensitivity"
                value="general"
                checked={sensitivity === 'general'}
                onChange={() => setSensitivity('general')}
                data-testid="kf-sensitivity-general"
              />
              General
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input
                type="radio"
                name="kf-sensitivity"
                value="sensitive"
                checked={sensitivity === 'sensitive'}
                onChange={() => setSensitivity('sensitive')}
                data-testid="kf-sensitivity-sensitive"
              />
              Sensitive
            </label>
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button data-testid="kf-add-cancel" onClick={onCancel} style={outlineBtnStyle()}>Cancel</button>
          <button
            data-testid="kf-add-submit"
            disabled={!label.trim()}
            onClick={() => { if (label.trim()) onSubmit(label.trim(), sensitivity); }}
            style={primaryBtnStyle()}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder card ─────────────────────────────────────────────────────────────

interface FolderCardProps {
  folder: KnowledgeFolderDto;
  onReindex(id: string): void;
  onFlipSensitivity(id: string, next: 'general' | 'sensitive'): void;
  onRemove(folder: KnowledgeFolderDto): void;
}

function FolderCard({ folder, onReindex, onFlipSensitivity, onRemove }: FolderCardProps): JSX.Element {
  const isSensitive = folder.sensitivity === 'sensitive';
  const nextSensitivity: 'general' | 'sensitive' = isSensitive ? 'general' : 'sensitive';

  return (
    <div
      data-testid={`kf-folder-card-${folder.id}`}
      style={folderCardStyle()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>
              {folder.label}
            </span>
            <span
              data-testid={`kf-sensitivity-badge-${folder.id}`}
              style={sensitivityBadgeStyle(isSensitive)}
            >
              {isSensitive ? 'Sensitive' : 'General'}
            </span>
            <span style={statusBadgeStyle(folder.status)}>{folder.status}</span>
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)', marginBottom: 8, wordBreak: 'break-all' }}>
            {truncatePath(folder.path)}
          </div>
          <dl style={statRowStyle()}>
            <dt>Files</dt>
            <dd data-testid={`kf-file-count-${folder.id}`}>{folder.fileCount.toLocaleString()}</dd>
            <dt>Size</dt>
            <dd>{bytesToHuman(folder.bytesIndexed)}</dd>
            <dt>Last scan</dt>
            <dd>{fmtDate(folder.lastScanAt)}</dd>
          </dl>
          {folder.lastError && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--aria-error-fg, #900)', marginTop: 4 }}>
              {folder.lastError}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            data-testid={`kf-reindex-${folder.id}`}
            onClick={() => onReindex(folder.id)}
            style={outlineBtnStyle()}
            title="Re-index this folder"
          >
            Reindex
          </button>
          <button
            data-testid={`kf-flip-sensitivity-${folder.id}`}
            onClick={() => onFlipSensitivity(folder.id, nextSensitivity)}
            style={outlineBtnStyle()}
            title={isSensitive ? 'Mark as General (allow Frontier routing)' : 'Mark as Sensitive (force Local routing)'}
          >
            {isSensitive ? 'Mark general' : 'Mark sensitive'}
          </button>
          <button
            data-testid={`kf-remove-${folder.id}`}
            onClick={() => onRemove(folder)}
            style={dangerOutlineBtnStyle()}
            title="Remove folder and its index"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

type Step =
  | { kind: 'idle' }
  | { kind: 'threshold-confirm'; path: string; fileCount: number; totalBytes: number }
  | { kind: 'add-modal'; path: string }
  | { kind: 'remove-confirm'; folder: KnowledgeFolderDto };

export function KnowledgeFoldersSection(): JSX.Element {
  const [folders, setFolders] = useState<KnowledgeFolderDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await window.aria.knowledgeListFolders();
      if ('error' in res) {
        setLoadError(String(res.error));
        return;
      }
      setFolders(res.folders);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fresh on focus / visibility change
  useEffect(() => {
    function onVisible(): void {
      if (!document.hidden) void refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function handleAddFolder(): Promise<void> {
    const pick = await window.aria.knowledgePickFolder();
    if ('canceled' in pick && pick.canceled) return;
    if (!('path' in pick)) return;

    const { path } = pick as { path: string };
    setBusy(true);
    try {
      const scan = await window.aria.knowledgePrescanFolder({ path });
      if ('error' in scan) {
        setLoadError(String(scan.error));
        return;
      }
      if (scan.exceedsThreshold) {
        setStep({ kind: 'threshold-confirm', path, fileCount: scan.fileCount, totalBytes: scan.totalBytes });
      } else {
        setStep({ kind: 'add-modal', path });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitAdd(path: string, label: string, sensitivity: 'general' | 'sensitive'): Promise<void> {
    setStep({ kind: 'idle' });
    setBusy(true);
    try {
      await window.aria.knowledgeAddFolder({ path, label, sensitivity });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReindex(folderId: string): Promise<void> {
    await window.aria.knowledgeReindex({ folderId });
    // Optimistic: refresh after brief delay to pick up state changes
    setTimeout(() => void refresh(), 500);
  }

  async function handleFlipSensitivity(folderId: string, sensitivity: 'general' | 'sensitive'): Promise<void> {
    await window.aria.knowledgeSetSensitivity({ folderId, sensitivity });
    await refresh();
  }

  function handleRemoveRequest(folder: KnowledgeFolderDto): void {
    setStep({ kind: 'remove-confirm', folder });
  }

  async function handleConfirmRemove(folderId: string): Promise<void> {
    setStep({ kind: 'idle' });
    setBusy(true);
    try {
      await window.aria.knowledgeRemoveFolder({ folderId });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="settings-knowledge-folders"
      style={{ padding: 'var(--aria-space-md, 24px)', maxWidth: 760, margin: '0 auto', color: 'var(--ink)', fontFamily: 'var(--f-body)' }}
    >
      <style>{sectionAnimation}</style>

      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
        Settings · Knowledge &amp; Memory
      </div>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12, marginBottom: 6 }}>
        Knowledge Folders
      </h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55, marginTop: 0, marginBottom: 20 }}>
        Index local folders so /ask can cite their content. Files are read locally — nothing is uploaded.
      </p>

      {loadError && (
        <div role="alert" style={errorBannerStyle()}>
          {loadError}
        </div>
      )}

      <button
        data-testid="kf-add-folder-btn"
        disabled={busy}
        onClick={handleAddFolder}
        style={{ ...primaryBtnStyle(), marginBottom: 20 }}
      >
        {busy ? 'Working…' : '+ Add folder'}
      </button>

      {folders.length === 0 && !loadError && (
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
          No folders indexed yet. Add a folder to make its files searchable from /ask.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {folders.map((f, i) => (
          <div key={f.id} style={{ animationDelay: `${i * 60}ms` }} className="kf-cascade-in">
            <FolderCard
              folder={f}
              onReindex={handleReindex}
              onFlipSensitivity={handleFlipSensitivity}
              onRemove={handleRemoveRequest}
            />
          </div>
        ))}
      </div>

      {/* Threshold confirm dialog */}
      {step.kind === 'threshold-confirm' && (
        <ConfirmDialog
          title="Large folder"
          body={`This folder has ${step.fileCount.toLocaleString()} files (${bytesToHuman(step.totalBytes)}). Initial indexing will take a while. Continue?`}
          confirmLabel="Continue"
          onCancel={() => setStep({ kind: 'idle' })}
          onConfirm={() => setStep({ kind: 'add-modal', path: step.path })}
        />
      )}

      {/* Add-folder modal */}
      {step.kind === 'add-modal' && (
        <AddFolderModal
          path={step.path}
          onCancel={() => setStep({ kind: 'idle' })}
          onSubmit={(label, sensitivity) => void handleSubmitAdd(step.path, label, sensitivity)}
        />
      )}

      {/* Remove confirm dialog */}
      {step.kind === 'remove-confirm' && (
        <ConfirmDialog
          title={`Remove "${step.folder.label}"?`}
          body={`Remove '${step.folder.label}'? This deletes the folder's index and citations from /ask. The files on disk are not touched.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setStep({ kind: 'idle' })}
          onConfirm={() => void handleConfirmRemove(step.folder.id)}
        />
      )}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sectionAnimation = `
@keyframes kf-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.kf-cascade-in {
  animation: kf-fade-in 260ms cubic-bezier(0.23, 1, 0.32, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  .kf-cascade-in { animation: none; }
}
`;

function overlayStyle(): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
}

function dialogStyle(): React.CSSProperties {
  return {
    background: 'var(--paper)',
    borderRadius: 10,
    padding: '28px 28px 24px',
    width: 440,
    maxWidth: '90vw',
    boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
    animation: 'kf-fade-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
  };
}

function folderCardStyle(): React.CSSProperties {
  return {
    background: 'var(--paper)',
    border: '1px solid var(--rule)',
    borderRadius: 8,
    padding: '16px 18px',
    transition: 'box-shadow 140ms cubic-bezier(0.23,1,0.32,1)',
  };
}

function sensitivityBadgeStyle(isSensitive: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'var(--f-mono)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    background: isSensitive ? 'var(--gold-wash, #fff8e6)' : 'var(--ivory-deep, #f5f4f0)',
    color: isSensitive ? 'var(--gold, #b8860b)' : 'var(--gray)',
    border: isSensitive ? '1px solid var(--gold-light, #e8d5a3)' : '1px solid var(--rule)',
  };
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#e8f5e9', fg: '#2e7d32' },
    paused: { bg: '#fff8e1', fg: '#7a5d00' },
    error: { bg: '#ffebee', fg: '#c62828' },
  };
  const c = colors[status] ?? { bg: '#f5f5f5', fg: '#666' };
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: 'var(--f-mono)',
    background: c.bg,
    color: c.fg,
  };
}

function statRowStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: 12,
    rowGap: 2,
    fontSize: 12,
    color: 'var(--ink-soft)',
    margin: 0,
  };
}

function errorBannerStyle(): React.CSSProperties {
  return {
    padding: '10px 14px',
    background: 'var(--aria-error-bg, #fee)',
    color: 'var(--aria-error-fg, #900)',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 16,
  };
}

function labelStyle(): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
  };
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)',
    fontSize: 14,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--rule)',
    background: 'var(--paper)',
    color: 'var(--ink)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--ink)',
    color: 'var(--paper)',
    cursor: 'pointer',
    transition: 'transform 80ms cubic-bezier(0.23,1,0.32,1), opacity 80ms',
  };
}

function outlineBtnStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid var(--rule)',
    background: 'transparent',
    color: 'var(--ink)',
    cursor: 'pointer',
    transition: 'background 80ms cubic-bezier(0.23,1,0.32,1)',
  };
}

function destructiveBtnStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#c62828',
    color: '#fff',
    cursor: 'pointer',
  };
}

function dangerOutlineBtnStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid #f4a0a0',
    background: 'transparent',
    color: '#c62828',
    cursor: 'pointer',
  };
}
