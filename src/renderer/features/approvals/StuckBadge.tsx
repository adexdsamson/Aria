import type { ApprovalRowDto } from '../../../shared/ipc-contract';

export interface StuckBadgeProps {
  approval: ApprovalRowDto;
  now?: number;
  onCancel(id: string): void | Promise<void>;
}

export function StuckBadge({ approval, now = Date.now(), onCancel }: StuckBadgeProps): JSX.Element | null {
  if (approval.state !== 'sending') return null;
  const updatedAt = Date.parse(approval.updated_at);
  if (!Number.isFinite(updatedAt) || now - updatedAt < 60_000) return null;
  return (
    <span data-testid={`stuck-badge-${approval.id}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>
        Stuck
      </span>
      <button
        type="button"
        data-testid={`stuck-cancel-${approval.id}`}
        onClick={() => void onCancel(approval.id)}
      >
        Cancel
      </button>
    </span>
  );
}
