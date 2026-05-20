import React from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const SIZE_TO_WIDTH: Record<ModalSize, string> = {
  sm: 'min(420px, 92vw)',
  md: 'min(560px, 92vw)',
  lg: 'min(720px, 92vw)',
};

/**
 * Editorial modal — paper card with 2px gold top accent rule, mono uppercase
 * eyebrow + Playfair title. Closes on Esc + backdrop click.
 *
 * Used by Plan 09-05 for the DisconnectConfirmDialog re-skin (D-12);
 * preserves role="dialog" + aria-modal so existing test selectors keep working.
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  size = 'md',
  children,
  footer,
}: ModalProps): JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    function k(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(26,26,26,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: SIZE_TO_WIDTH[size],
          background: 'var(--paper)',
          border: '1px solid var(--rule-strong)',
          borderTop: '2px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '14px 22px 14px',
            background: 'var(--ivory-deep)',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          {eyebrow && (
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
                marginBottom: 4,
              }}
            >
              {eyebrow}
            </div>
          )}
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1.2,
            }}
          >
            {title}
          </div>
        </div>
        <div style={{ padding: '18px 22px', color: 'var(--ink)' }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '12px 22px 16px',
              borderTop: '1px solid var(--rule)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
