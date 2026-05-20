export type Route = 'LOCAL' | 'FRONTIER';

export interface RouteBadgeProps {
  route: Route;
}

/**
 * Small mono-uppercase pill labelling LLM routing decision.
 * LOCAL  → gold tint (var(--gold) text on gold-tinted bg)
 * FRONTIER → ink tint  (var(--ink)  text on ivory-deep)
 */
export function RouteBadge({ route }: RouteBadgeProps): JSX.Element {
  const isLocal = route === 'LOCAL';
  return (
    <span
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 'var(--radius-sm)',
        color: isLocal ? 'var(--gold-deep)' : 'var(--ink-soft)',
        background: isLocal ? 'rgba(184,134,11,0.12)' : 'var(--ivory-deep)',
        border: `1px solid ${isLocal ? 'rgba(184,134,11,0.2)' : 'var(--rule)'}`,
      }}
    >
      {route}
    </span>
  );
}
