import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

/**
 * Editorial-styled input: 44px tall, paper bg, rule border. Focus turns
 * border + 2px outline gold (focus-visible style from globals.css applies).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, style, ...rest }: InputProps,
  ref,
): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: 'var(--f-body)',
      }}
    >
      {label && (
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          {label}
        </span>
      )}
      <input
        ref={ref}
        style={{
          minHeight: 44,
          padding: '0 12px',
          background: 'var(--paper)',
          color: 'var(--ink)',
          border: `1px solid ${error ? 'var(--rose)' : 'var(--rule)'}`,
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          outline: 'none',
          transition: 'border-color var(--t), outline-color var(--t)',
          ...style,
        }}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {(hint || error) && (
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: error ? 'var(--rose)' : 'var(--gray-soft)',
          }}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
});
