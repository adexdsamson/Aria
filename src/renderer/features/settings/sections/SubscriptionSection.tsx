/**
 * Plan 08.1-03 Task 5 — Settings → Subscription section.
 *
 * Shows tier + state badge, trial countdown / pro management affordances,
 * and a destructive sign-out action gated by confirm. MUST be imported by
 * SettingsScreen (verifier-blindspot guard from Phase 4 LEARNINGS).
 */
import { useState } from 'react';
import { useEntitlement } from '../../entitlement/useEntitlement';
import { ActivateLicenseForm } from '../../entitlement/ActivateLicenseForm';
import { baseState, type EntitlementState } from '../../entitlement/types';
import {
  subscribe,
  openCustomerPortal,
  refreshNow,
  signOutLicense,
} from '../../../lib/entitlement-actions';

function stateBadge(state: EntitlementState): { label: string; color: string } {
  const s = baseState(state);
  switch (s.kind) {
    case 'pro-active':
      return { label: 'Pro · active', color: '#16a34a' };
    case 'pro-grace':
      return { label: `Pro · grace (${s.daysUntilLock}d to lock)`, color: '#d97706' };
    case 'pro-locked':
      return { label: 'Pro · locked (verification failed)', color: '#b91c1c' };
    case 'trial-active-quiet':
    case 'trial-active-day50':
    case 'trial-active-day55':
    case 'trial-active-day59':
      return {
        label: `Trial · ${s.daysRemaining} day${s.daysRemaining === 1 ? '' : 's'} left`,
        color: '#2563eb',
      };
    case 'trial-expired-grace':
      return { label: 'Trial · expired (grace)', color: '#d97706' };
    case 'trial-locked':
      return { label: 'Trial · ended', color: '#b91c1c' };
    default:
      return { label: 'Unknown', color: '#6b7280' };
  }
}

export function SubscriptionSection(): JSX.Element {
  const { state } = useEntitlement();
  const [showActivate, setShowActivate] = useState(false);

  if (!state) {
    return (
      <section data-testid="settings-subscription" style={sectionStyle()}>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12 }}>Subscription</h2>
        <p style={{ fontSize: 13, color: '#6b7280' }}>Loading subscription state…</p>
      </section>
    );
  }

  const badge = stateBadge(state);
  const s = baseState(state);
  const isPro =
    s.kind === 'pro-active' || s.kind === 'pro-grace' || s.kind === 'pro-locked';
  const isTrial =
    s.kind === 'trial-active-quiet' ||
    s.kind === 'trial-active-day50' ||
    s.kind === 'trial-active-day55' ||
    s.kind === 'trial-active-day59';

  return (
    <section data-testid="settings-subscription" style={sectionStyle()}>
      <h2 style={{ marginTop: 0 }}>Subscription</h2>
      <p style={{ fontSize: 13, color: '#6b7280', maxWidth: 640 }}>
        Aria runs on a 60-day no-card trial; after that you can subscribe or
        activate a license key. Your data stays on this machine in either case.
      </p>

      <div
        data-testid="subscription-state-badge"
        style={{
          display: 'inline-block',
          padding: '4px 10px',
          borderRadius: 999,
          background: badge.color,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        {badge.label}
      </div>

      {state.kind === 'clock-skew-warn' && (
        <p
          data-testid="subscription-clock-skew"
          style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 12 }}
        >
          Your system clock looks off by ~{Math.abs(state.skewDays)} days. Check
          your clock settings — Aria's signed timestamps rely on it.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {(isTrial || s.kind === 'trial-locked' || s.kind === 'trial-expired-grace') && (
          <button
            type="button"
            data-testid="subscription-subscribe"
            onClick={() => void subscribe()}
          >
            Subscribe
          </button>
        )}
        {isPro && (
          <button
            type="button"
            data-testid="subscription-manage"
            onClick={() => void openCustomerPortal()}
          >
            Manage subscription
          </button>
        )}
        <button
          type="button"
          data-testid="subscription-refresh"
          onClick={() => void refreshNow()}
        >
          Refresh now
        </button>
        <button
          type="button"
          data-testid="subscription-activate-toggle"
          onClick={() => setShowActivate((v) => !v)}
        >
          {showActivate ? 'Hide license-key form' : 'Activate a license key'}
        </button>
        <button
          type="button"
          data-testid="subscription-signout"
          onClick={() => void signOutLicense()}
          style={{ color: '#b91c1c' }}
        >
          Sign out / clear license
        </button>
      </div>

      {showActivate && (
        <div
          data-testid="subscription-activate-wrap"
          style={{
            padding: 16,
            border: '1px solid var(--aria-border, #e5e7eb)',
            borderRadius: 6,
            marginTop: 8,
          }}
        >
          <ActivateLicenseForm onClose={() => setShowActivate(false)} />
        </div>
      )}
    </section>
  );
}

function sectionStyle(): React.CSSProperties {
  return { padding: 'var(--aria-space-xl)' };
}
