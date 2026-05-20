import React from 'react';

export interface KbdHintProps {
  children: React.ReactNode;
}

/**
 * Mono mini-pill on ivory-deep background — used for "⌘K" and "esc" hints.
 * Derived from app-shell.jsx lines 163-167.
 */
export function KbdHint({ children }: KbdHintProps): JSX.Element {
  return (
    <span
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        color: 'var(--gray-soft)',
        background: 'var(--ivory-deep)',
        padding: '1px 5px',
        borderRadius: 3,
        border: '1px solid var(--rule)',
      }}
    >
      {children}
    </span>
  );
}
