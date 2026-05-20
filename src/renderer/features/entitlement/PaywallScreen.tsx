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
import { Button, Card } from '../../components/editorial';
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 48,
        background: 'var(--ivory-deep)',
        color: 'var(--ink)',
        overflowY: 'auto',
        fontFamily: 'var(--f-body)',
      }}
    >
      <Card
        accent="top"
        style={{
          maxWidth: 560,
          width: '100%',
          padding: 36,
          background: 'var(--paper)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 10,
          }}
        >
          Subscription · Aria Pro
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            marginTop: 0,
            marginBottom: 14,
            lineHeight: 1.15,
          }}
        >
          {heading}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink-soft)', margin: 0 }}>
          {subhead}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
          <Button
            variant="primary"
            data-testid="paywall-subscribe-btn"
            onClick={() => {
              void subscribe();
            }}
          >
            Subscribe with Stripe
          </Button>
          <Button
            variant="outline"
            data-testid="paywall-activate-toggle"
            onClick={() => setShowActivate((v) => !v)}
          >
            {showActivate ? 'Hide license key form' : 'I have a license key'}
          </Button>

          {showActivate && (
            <div
              data-testid="paywall-activate-form-wrap"
              style={{
                marginTop: 4,
                padding: 18,
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius)',
                background: 'var(--ivory-deep)',
              }}
            >
              <ActivateLicenseForm onClose={() => setShowActivate(false)} />
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 32,
            paddingTop: 18,
            borderTop: '1px solid var(--rule)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
              marginBottom: 10,
            }}
          >
            Or continue read-only
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
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
              style={{ ...linkButtonStyle(), textDecoration: 'underline' }}
            >
              Settings &amp; export
            </Link>
            <Link
              to="/briefing"
              data-testid="paywall-briefing-link"
              style={{ ...linkButtonStyle(), textDecoration: 'underline' }}
            >
              Read existing briefings
            </Link>
            <button
              type="button"
              data-testid="paywall-signout-btn"
              onClick={() => {
                void signOutLicense();
              }}
              style={{ ...linkButtonStyle(), color: 'var(--rose)' }}
            >
              Sign out / clear license
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function linkButtonStyle(): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: '4px 0',
    color: 'var(--ink)',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'var(--f-body)',
  };
}
