/**
 * Phase 9 Plan 03 — RE-SKINNED. Rose-tinted mono pill + outline Cancel
 * button. data-testid and behaviour preserved.
 */
import type { ApprovalRowDto } from '../../../shared/ipc-contract';
import { Button } from '../../components/editorial';

export interface StuckBadgeProps {
  approval: ApprovalRowDto;
  now?: number;
  onCancel(id: string): void | Promise<void>;
}

export function StuckBadge({
  approval,
  now = Date.now(),
  onCancel,
}: StuckBadgeProps): JSX.Element | null {
  if (approval.state !== 'sending') return null;
  const updatedAt = Date.parse(approval.updated_at);
  if (!Number.isFinite(updatedAt) || now - updatedAt < 60_000) return null;
  return (
    <span
      data-testid={`stuck-badge-${approval.id}`}
      style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}
    >
      <span
        style={{
          background: 'rgba(184,73,58,0.10)',
          color: '#7A2B20',
          border: '1px solid rgba(184,73,58,0.25)',
          borderRadius: 999,
          padding: '2px 10px',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        Stuck
      </span>
      <Button
        variant="outline"
        data-testid={`stuck-cancel-${approval.id}`}
        onClick={() => void onCancel(approval.id)}
        style={{
          minHeight: 26,
          padding: '0 10px',
          fontSize: 11,
          letterSpacing: '0.08em',
        }}
      >
        Cancel
      </Button>
    </span>
  );
}
