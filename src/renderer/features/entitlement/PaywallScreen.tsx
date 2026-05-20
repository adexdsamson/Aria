/**
 * Plan 08.1-03 Task 2 — PaywallScreen.
 *
 * Full-screen lock (NOT a modal). Renders when the entitlement state is
 * `trial-locked` or `pro-locked`. Read-only routes (briefing/transcripts/
 * settings/etc.) remain reachable via the centralized route guard in App.tsx.
 *
 * Stripe Checkout opens externally via shell.openExternal (handled in main's
 * ENTITLEMENT_OPEN_CHECKOUT). The renderer NEVER hosts the payment flow.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEntitlement } from './useEntitlement';
import { ActivateLicenseForm } from './ActivateLicenseForm';
import { baseState, type EntitlementState } from './types';
import {
  subscribe,
  openCustomerPortal,
  signOutLicense,
} from '../../lib/entitlement-actions';

export interface PaywallScreenProps {
  /**
   * Optional override — when omitted, reads from EntitlementContext. Tests
   * sometimes prefer to pass the state directly to keep the harness simple.
   */
  state?: EntitlementState;
}

export function PaywallScreen(props: PaywallScreenProps): JSX.Element | null {
  const ctx = useEntitlement();
  const raw = props.state ?? ctx.state;
  if (!raw) return null;
  const s = baseState(raw);
  const [showActivate, setShowActivate] = useState(false);

  const isTrialLocked = s.kind === 'trial-locked';
  const isProLocked = s.kind === 'pro-locked';
  if (!isTrialLocked && !isProLocked) return null;

  const heading = isTrialLocked
    ? 'Your trial has ended'
    : "We couldn't verify your subscription";
  const subhead = isTrialLocked
    ? "Aria's daily briefing + chief-of-staff actions are paused. Your data is safe — you can still read existing briefings, transcripts, and queued approvals, and export anything you need."
    : "Aria couldn't reach the activation server for the last 14 days. Reconnect to the internet, then click Refresh in Settings → Subscription. Your data is safe and still readable.";

  return (
    <div
      data-testid="paywall-screen"
      data-kind={s.kind}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: 'var(--aria-bg, #fff)',
        color: 'var(--aria-fg)',
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: 560, width: '100%' }}>
        <h1 style={{ fontSize: 28, marginTop: 0, marginBottom: 12 }}>{heading}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: '#374151' }}>{subhead}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
          <button
            type="button"
            data-testid="paywall-subscribe-btn"
            onClick={() => {
              void subscribe();
            }}
            style={{
              padding: '12px 18px',
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 8,
              background: '#0f172a',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Subscribe
          </button>
          <button
            type="button"
            data-testid="paywall-activate-toggle"
            onClick={() => setShowActivate((v) => !v)}
            style={{
              padding: '10px 16px',
              fontSize: 14,
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--aria-fg)',
              border: '1px solid var(--aria-border, #d1d5db)',
              cursor: 'pointer',
            }}
          >
            {showActivate ? 'Hide license key form' : 'I have a license key'}
          </button>

          {showActivate && (
            <div
              data-testid="paywall-activate-form-wrap"
              style={{
                marginTop: 8,
                padding: 16,
                border: '1px solid var(--aria-border, #e5e7eb)',
                borderRadius: 8,
              }}
            >
              <ActivateLicenseForm onClose={() => setShowActivate(false)} />
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 28,
            paddingTop: 16,
            borderTop: '1px solid var(--aria-border, #e5e7eb)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 13,
          }}
        >
          {isProLocked && (
            <button
              type="button"
              data-testid="paywall-portal-link"
              onClick={() => {
                void openCustomerPortal();
              }}
              style={linkButtonStyle()}
            >
              Manage existing subscription
            </button>
          )}
          <Link
            to="/settings"
            data-testid="paywall-settings-link"
            style={{ ...linkButtonStyle(), textDecoration: 'none' }}
          >
            Settings &amp; export
          </Link>
          <Link
            to="/briefing"
            data-testid="paywall-briefing-link"
            style={{ ...linkButtonStyle(), textDecoration: 'none' }}
          >
            Read existing briefings
          </Link>
          <button
            type="button"
            data-testid="paywall-signout-btn"
            onClick={() => {
              void signOutLicense();
            }}
            style={{ ...linkButtonStyle(), color: '#b91c1c' }}
          >
            Sign out / clear license
          </button>
        </div>
      </div>
    </div>
  );
}

function linkButtonStyle(): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: '4px 6px',
    color: 'var(--aria-accent-fg, #2563eb)',
    cursor: 'pointer',
    fontSize: 13,
  };
}
