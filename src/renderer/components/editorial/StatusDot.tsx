export type StatusDotKind = 'ok' | 'warn' | 'err' | 'idle';

export interface StatusDotProps {
  kind?: StatusDotKind;
}

/** Per design-tokens contract: the 4 status colors are the only colors that
 *  should ever be used to signal state. */
const KIND_TO_COLOR: Record<StatusDotKind, string> = {
  ok: 'var(--moss)',
  warn: 'var(--gold)',
  err: 'var(--rose)',
  idle: 'var(--gray-faint)',
};

/**
 * 6px dot with a soft 10%-alpha halo glow.
 * Derived verbatim from design-ref/project/app-shell.jsx lines 53-64.
 */
export function StatusDot({ kind = 'ok' }: StatusDotProps): JSX.Element {
  const color = KIND_TO_COLOR[kind];
  return (
    <span
      data-status-kind={kind}
      style={{
        width: 6,
        height: 6,
        borderRadius: 50,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: `0 0 0 3px ${color === 'var(--moss)' ? 'rgba(91,110,58,0.1)' :
                       color === 'var(--gold)' ? 'rgba(184,134,11,0.1)' :
                       color === 'var(--rose)' ? 'rgba(184,73,58,0.1)' :
                       'rgba(199,194,187,0.1)'}`,
      }}
    />
  );
}
