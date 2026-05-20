export interface AvatarProps {
  initials?: string;
  size?: number;
  gold?: boolean;
}

/**
 * Ink (or gold) circle with ivory mono-spaced initials.
 * Derived verbatim from design-ref/project/app-shell.jsx lines 40-51.
 */
export function Avatar({ initials = 'EV', size = 28, gold = false }: AvatarProps): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gold ? 'var(--gold)' : 'var(--ink)',
        color: 'var(--ivory)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--f-mono)',
        fontSize: size * 0.36,
        fontWeight: 500,
        letterSpacing: '0.06em',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
