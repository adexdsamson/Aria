/**
 * Plan 08.1-03 Task 4 — TrialBanner.
 *
 * Persistent top-of-screen banner. Renders for the 5 banner-eligible states:
 *   trial-active-day50 / trial-active-day55 / trial-active-day59
 *   trial-expired-grace
 *   clock-skew-warn (wrapping any underlying state — informational only)
 *
 * Dismiss "X" is in-memory only. Banner reappears on next mount (next launch).
 * NEVER persistently dismissible per UX requirements.
 */
import { useState } from 'react';
import { useEntitlement } from './useEntitlement';
import { subscribe } from '../../lib/entitlement-actions';
import { baseState, type EntitlementState } from './types';

export interface TrialBannerProps {
  /** Override — defaults to context. */
  state?: EntitlementState | null;
}

interface BannerSpec {
  testid: string;
  text: string;
  /** Tailwind / inline tone — gets stronger as urgency rises. */
  tone: 'info' | 'warn' | 'urgent';
  /** When true, the inline "Subscribe →" button is shown. */
  showSubscribe: boolean;
}

function specFor(state: EntitlementState): BannerSpec | null {
  // Clock-skew wrapper: render its own informational banner; do NOT recurse
  // into the underlying state for banner copy (it would double up).
  if (state.kind === 'clock-skew-warn') {
    return {
      testid: 'banner-clock-skew',
      text: 'Your system clock looks off. Aria uses signed timestamps — check your clock settings.',
      tone: 'info',
      showSubscribe: false,
    };
  }
  const s = baseState(state);
  switch (s.kind) {
    case 'trial-active-day50':
      return {
        testid: 'banner-day50',
        text: `${s.daysRemaining} days left in your Aria trial.`,
        tone: 'info',
        showSubscribe: true,
      };
    case 'trial-active-day55':
      return {
        testid: 'banner-day55',
        text: `${s.daysRemaining} days left in your trial.`,
        tone: 'warn',
        showSubscribe: true,
      };
    case 'trial-active-day59': {
      const date = formatExpiry(s.trialExpiresAt);
      return {
        testid: 'banner-day59',
        text: `${s.daysRemaining} day${s.daysRemaining === 1 ? '' : 's'} left. Your trial ends ${date}.`,
        tone: 'urgent',
        showSubscribe: true,
      };
    }
    case 'trial-expired-grace':
      return {
        testid: 'banner-grace',
        text: 'Your trial has ended. You can subscribe or activate a key — your data is safe.',
        tone: 'urgent',
        showSubscribe: true,
      };
    default:
      return null;
  }
}

function formatExpiry(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'soon';
  const d = new Date(t);
  // Locale-neutral short date; e.g. "May 22"
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TONE_STYLES: Record<BannerSpec['tone'], React.CSSProperties> = {
  info: { background: '#fef3c7', borderBottom: '1px solid #fcd34d', color: '#78350f' },
  warn: { background: '#fed7aa', borderBottom: '1px solid #fb923c', color: '#7c2d12' },
  urgent: { background: '#fecaca', borderBottom: '1px solid #f87171', color: '#7f1d1d' },
};

export function TrialBanner(props: TrialBannerProps): JSX.Element | null {
  const ctx = useEntitlement();
  const state = props.state ?? ctx.state;
  const [dismissed, setDismissed] = useState(false);

  if (!state || dismissed) return null;
  const spec = specFor(state);
  if (!spec) return null;

  return (
    <div
      role="status"
      data-testid={spec.testid}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 500,
        ...TONE_STYLES[spec.tone],
      }}
    >
      <span style={{ flex: 1 }}>{spec.text}</span>
      {spec.showSubscribe && (
        <button
          type="button"
          data-testid={`${spec.testid}-subscribe`}
          onClick={() => {
            void subscribe();
          }}
          style={{
            background: 'transparent',
            border: '1px solid currentColor',
            color: 'inherit',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Subscribe →
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss banner"
        data-testid={`${spec.testid}-dismiss`}
        onClick={() => setDismissed(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
