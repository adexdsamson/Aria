import { MonogramSquare } from './MonogramSquare';

export type LogoVariant = 'sidebar' | 'header' | 'splash';

export interface AppLogoProps {
  variant?: LogoVariant;
}

/**
 * The Aria wordmark in three documented treatments
 * (design-ref/project/logo.html — Studies III / V / II respectively).
 *
 * - sidebar: MonogramSquare(26) + Playfair "Aria" + italic "chief of staff"
 *   (mirrors design-ref/project/app-shell.jsx lines 142-150).
 * - header: editorial lockup (Study V) — "Aria" + italic "Est. 2026"
 *   + gold underline + mono "A Chief of Staff" tag.
 * - splash: italic Study II — italic "Aria" + hairline rule + mono tag.
 *
 * Composed entirely from CSS variables — no font-CDN, no external images.
 */
export function AppLogo({ variant = 'sidebar' }: AppLogoProps): JSX.Element {
  if (variant === 'sidebar') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MonogramSquare size={26} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1,
            gap: 2,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 17,
              fontWeight: 500,
              letterSpacing: '0.01em',
              color: 'var(--ink)',
            }}
          >
            Aria
          </span>
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: 10.5,
              color: 'var(--gray)',
              whiteSpace: 'nowrap',
            }}
          >
            chief of staff
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'header') {
    return (
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: 'clamp(2.5rem, 6vw, 4rem)',
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              position: 'relative',
              lineHeight: 1,
            }}
          >
            Aria
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '8%',
                right: '8%',
                bottom: -8,
                height: 2,
                background: 'var(--gold)',
              }}
            />
          </span>
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: '1rem',
              color: 'var(--gray)',
            }}
          >
            Est. 2026
          </span>
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: 'var(--f-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          A Chief of Staff
        </div>
      </div>
    );
  }

  // splash — italic Study II
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 'clamp(3.5rem, 10vw, 6rem)',
          letterSpacing: '-0.03em',
          color: 'var(--ink)',
          lineHeight: 0.9,
        }}
      >
        Aria
      </span>
      <span
        aria-hidden="true"
        style={{ height: 1, width: '100%', maxWidth: '18rem', background: 'var(--gold)', opacity: 0.6 }}
      />
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: '0.75rem',
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
        }}
      >
        A Chief of Staff
      </span>
    </div>
  );
}
