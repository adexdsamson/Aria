/**
 * Phase 11 Plan 02 — RerunModal.
 * Centered dialog. Read-only feedback summary + guidance textarea + Re-run button.
 * Pattern: DisconnectConfirmDialog.tsx (confirm modal analog).
 */
import { useState } from 'react';
import type { ResearchFeedbackDto } from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface RerunModalProps {
  feedbackItems: ResearchFeedbackDto[];
  onClose: () => void;
  onRerun: (opts: { feedbackContext: string }) => Promise<void>;
}

export function RerunModal({ feedbackItems, onClose, onRerun }: RerunModalProps): JSX.Element {
  const [guidance, setGuidance] = useState('');
  const [pending, setPending] = useState(false);

  const upCount = feedbackItems.filter((f) => f.thumb === 1).length;
  const downCount = feedbackItems.filter((f) => f.thumb === -1).length;

  async function confirm(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onRerun({ feedbackContext: guidance });
    } finally {
      setPending(false);
      onClose();
    }
  }

  return (
    <>
      <style>{`
        @keyframes dialogEntry {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(20,18,14,0.55)',
          zIndex: 1100,
          backdropFilter: 'blur(2px)',
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: 'var(--paper, #faf8f4)',
            borderRadius: 8,
            padding: 32,
            width: 480,
            maxWidth: '90vw',
            boxShadow: '0 24px 64px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1)',
            animation: `dialogEntry 200ms ${EASE_OUT}`,
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Gold top accent — matches design system */}
          <div style={{ height: 3, background: 'var(--gold)', margin: '-32px -32px 28px', borderRadius: '8px 8px 0 0' }} />
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 8,
            }}
          >
            Re-run Research
          </div>
          <h3
            style={{
              fontFamily: 'var(--f-serif)',
              fontSize: 20,
              fontWeight: 500,
              marginBottom: 16,
              margin: '0 0 16px',
            }}
          >
            Run research again
          </h3>

          {/* Feedback summary */}
          {feedbackItems.length > 0 && (
            <div
              style={{
                borderLeft: '2px solid var(--gold)',
                paddingLeft: 12,
                marginBottom: 16,
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--gray-soft)',
              }}
            >
              Prior feedback: {upCount} helpful, {downCount} not helpful
            </div>
          )}

          <label
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              color: 'var(--gray-soft)',
              letterSpacing: '0.05em',
              display: 'block',
              marginBottom: 6,
            }}
          >
            ADDITIONAL DIRECTION
          </label>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Additional direction for this re-run…"
            rows={4}
            style={{
              width: '100%',
              fontFamily: 'var(--f-mono)',
              fontSize: 13,
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '8px 12px',
              background: 'var(--bg)',
              color: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
              marginBottom: 20,
            }}
          />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                background: 'none',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '8px 16px',
                cursor: 'pointer',
                color: 'var(--gray-soft)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void confirm()}
              disabled={pending}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                background: 'var(--gold)',
                color: 'var(--on-gold, #fff)',
                border: 'none',
                borderRadius: 4,
                padding: '8px 20px',
                cursor: pending ? 'not-allowed' : 'pointer',
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? 'Running…' : 'Re-run Research'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
