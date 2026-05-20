export interface MonogramSquareProps {
  size?: number;
}

/**
 * Ivory squircle + Playfair "A" + gold underline rule.
 * Derived verbatim from design-ref/project/app-shell.jsx lines 18-38.
 * Used in sidebar brand block, window chrome, and the application icon
 * (study III in design-ref/project/logo.html).
 */
export function MonogramSquare({ size = 28 }: MonogramSquareProps): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: 'var(--ivory)',
        border: '1px solid var(--rule)',
        boxShadow: '0 1px 2px rgba(26,26,26,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 500,
          fontSize: size * 0.62,
          lineHeight: 1,
          color: 'var(--ink)',
          position: 'relative',
          paddingBottom: 2,
        }}
      >
        A
        <span
          style={{
            position: 'absolute',
            left: '20%',
            right: '20%',
            bottom: '14%',
            height: 1.5,
            background: 'var(--gold)',
          }}
        />
      </span>
    </div>
  );
}
