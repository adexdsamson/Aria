import type { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  label: ReactNode;
  /** Render divider beneath the row — useful in vertical lists. */
  withDivider?: boolean;
}

/**
 * Editorial checkbox: hairline box that fills with --gold on check.
 * Native input is visually hidden but keyboard- and screen-reader-accessible.
 */
export function Checkbox({ label, withDivider, checked, style, ...rest }: CheckboxProps): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--f-body)',
        fontSize: 15,
        color: 'var(--ink)',
        borderBottom: withDivider ? '1px solid var(--rule)' : 'none',
        opacity: rest.disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        {...rest}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          flex: '0 0 auto',
          border: `1px solid ${checked ? 'var(--gold)' : 'var(--rule)'}`,
          background: checked ? 'var(--gold)' : 'var(--paper)',
          borderRadius: 2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 140ms ease, border-color 140ms ease',
        }}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2.5 6.2 5 8.7l4.5-5"
              stroke="var(--paper)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}
