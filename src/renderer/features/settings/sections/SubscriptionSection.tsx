/**
 * Plan 08.1-03 Task 5 — Settings → Subscription section.
 * Redesigned to match design-ref (SETTINGS · SUBSCRIPTION layout).
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

interface BadgeInfo {
  label: string;
  color: string;
  bg: string;
}

function stateBadge(state: EntitlementState): BadgeInfo {
  const s = baseState(state);
  switch (s.kind) {
    case 'pro-active':
      return { label: 'Pro · active', color: '#2d5a1b', bg: 'rgba(74,147,44,0.12)' };
    case 'pro-grace':
      return { label: `Pro · grace (${s.daysUntilLock}d to lock)`, color: '#92400e', bg: 'rgba(217,119,6,0.1)' };
    case 'pro-locked':
      return { label: 'Pro · locked', color: '#7f1d1d', bg: 'rgba(185,28,28,0.08)' };
    case 'trial-active-quiet':
    case 'trial-active-day50':
    case 'trial-active-day55':
    case 'trial-active-day59':
      return {
        label: `Trial · ${s.daysRemaining} day${s.daysRemaining === 1 ? '' : 's'} left`,
        color: 'var(--gold)',
        bg: 'rgba(185,144,60,0.1)',
      };
    case 'trial-expired-grace':
      return { label: 'Trial · expired (grace)', color: '#92400e', bg: 'rgba(217,119,6,0.1)' };
    case 'trial-locked':
      return { label: 'Trial · ended', color: '#7f1d1d', bg: 'rgba(185,28,28,0.08)' };
    default:
      return { label: 'Unknown', color: 'var(--gray)', bg: 'var(--ivory-deep, #f5f3ef)' };
  }
}

function planTitle(state: EntitlementState): string {
  const s = baseState(state);
  if (s.kind === 'pro-active' || s.kind === 'pro-grace' || s.kind === 'pro-locked') return 'Aria Pro';
  return 'Aria Trial';
}

function planSubline(state: EntitlementState): string {
  const s = baseState(state);
  switch (s.kind) {
    case 'trial-active-quiet':
    case 'trial-active-day50':
    case 'trial-active-day55':
    case 'trial-active-day59': {
      const exp = new Date(s.trialExpiresAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
      return `Trial expires ${exp}. Subscribe to keep drafting, scheduling, and recaps.`;
    }
    case 'trial-expired-grace':
      return 'Your trial has ended. Subscribe or activate a key to continue.';
    case 'trial-locked':
      return 'Your trial has ended and access is locked. Subscribe to restore access.';
    case 'pro-active': {
      const until = new Date(s.subscriptionUntil).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
      return `Subscription active until ${until}.`;
    }
    case 'pro-grace':
      return `Subscription verification failed. ${s.daysUntilLock} day${s.daysUntilLock === 1 ? '' : 's'} until access locks.`;
    case 'pro-locked':
      return 'Subscription verification failed and access is locked.';
    default:
      return '';
  }
}

export function SubscriptionSection(): JSX.Element {
  const { state } = useEntitlement();
  const [showActivate, setShowActivate] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (!state) {
    return (
      <section data-testid="settings-subscription" style={{ padding: '40px 48px', maxWidth: 860, fontFamily: 'var(--f-body)', color: 'var(--ink)' }}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
          Settings · Subscription
        </div>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, fontWeight: 400, color: 'var(--ink)', margin: '0 0 12px', borderBottom: '1px solid var(--rule)', paddingBottom: 16 }}>
          Plan &amp; billing
        </h2>
        <p style={{ fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>Loading subscription state…</p>
      </section>
    );
  }

  const badge = stateBadge(state);
  const s = baseState(state);
  const isPro = s.kind === 'pro-active' || s.kind === 'pro-grace' || s.kind === 'pro-locked';
  const isTrial =
    s.kind === 'trial-active-quiet' ||
    s.kind === 'trial-active-day50' ||
    s.kind === 'trial-active-day55' ||
    s.kind === 'trial-active-day59';

  return (
    <section data-testid="settings-subscription" style={{ padding: '40px 48px', maxWidth: 860, fontFamily: 'var(--f-body)', color: 'var(--ink)' }}>
      <style>{`
        .sub-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: var(--radius);
          font-family: var(--f-body);
          font-size: 13px;
          cursor: pointer;
          transition: opacity 0.15s, border-color 0.15s;
          border: none;
          background: none;
        }
        .sub-action-btn.primary {
          background: var(--gold);
          color: #fff;
        }
        .sub-action-btn.primary:hover { opacity: 0.88; }
        .sub-action-btn.ghost {
          border: 1px solid var(--rule);
          color: var(--ink-soft, #6b6455);
          background: var(--paper);
        }
        .sub-action-btn.ghost:hover { border-color: var(--gold); color: var(--ink); }
        .sub-action-btn.danger {
          color: var(--rose, #b13434);
          border: none;
          background: none;
          margin-left: auto;
        }
        .sub-action-btn.danger:hover { opacity: 0.75; }
        .sub-confirm-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 6px;
          padding: 10px 14px;
          border: 1px solid var(--rose, #b13434);
          border-radius: var(--radius);
          background: rgba(177,52,52,0.05);
          font-size: 13px;
          color: var(--ink);
        }
      `}</style>

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
        Settings · Subscription
      </div>

      {/* Heading */}
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 32, fontWeight: 400, color: 'var(--ink)', margin: '0 0 12px', borderBottom: '1px solid var(--rule)', paddingBottom: 16 }}>
        Plan &amp; billing
      </h2>

      {/* Description */}
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontStyle: 'italic', color: 'var(--ink-soft, #6b6455)', lineHeight: 1.6, margin: '0 0 28px', maxWidth: 560 }}>
        Aria runs on a 60-day no-card trial; after that, subscribe or activate a
        license key. Your data stays on this machine either way.
      </p>

      {/* Plan card */}
      <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--radius)', padding: '20px 24px', background: 'var(--paper)', marginBottom: 20, maxWidth: 780 }}>
        {/* Badge */}
        <div
          data-testid="subscription-state-badge"
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 999,
            border: `1px solid ${badge.color}`,
            background: badge.bg,
            color: badge.color,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          {badge.label}
        </div>

        {/* Plan name */}
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 400, color: 'var(--ink)', marginBottom: 6 }}>
          {planTitle(state)}
        </div>

        {/* Subline */}
        <div style={{ fontSize: 13, color: 'var(--ink-soft, #6b6455)', marginBottom: 18, lineHeight: 1.5 }}>
          {planSubline(state)}
        </div>

        {state.kind === 'clock-skew-warn' && (
          <p data-testid="subscription-clock-skew" style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 14, padding: '8px 12px', background: 'rgba(185,28,28,0.06)', border: '1px solid rgba(185,28,28,0.2)', borderRadius: 'var(--radius)' }}>
            Your system clock appears off by ~{Math.abs(state.skewDays)} days. Aria's signed timestamps rely on it — check your clock settings.
          </p>
        )}

        {/* Actions row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {(isTrial || s.kind === 'trial-locked' || s.kind === 'trial-expired-grace') && (
            <button type="button" className="sub-action-btn primary" data-testid="subscription-subscribe" onClick={() => void subscribe()}>
              ✦ Subscribe
            </button>
          )}
          {isPro && (
            <button type="button" className="sub-action-btn primary" data-testid="subscription-manage" onClick={() => void openCustomerPortal()}>
              Manage subscription
            </button>
          )}
          <button type="button" className="sub-action-btn ghost" data-testid="subscription-refresh" onClick={() => void refreshNow()}>
            ↺ Refresh now
          </button>
          <button type="button" className="sub-action-btn ghost" data-testid="subscription-activate-toggle" onClick={() => setShowActivate(v => !v)}>
            ⌘ {showActivate ? 'Hide license-key form' : 'Activate a license key'}
          </button>
          <button
            type="button"
            className="sub-action-btn danger"
            data-testid="subscription-signout"
            onClick={() => setConfirmSignOut(true)}
          >
            🗑 Sign out / clear license
          </button>
        </div>

        {confirmSignOut && (
          <div className="sub-confirm-row" data-testid="subscription-signout-confirm">
            <span>Remove all license data from this device?</span>
            <button
              type="button"
              className="sub-action-btn primary"
              style={{ background: 'var(--rose, #b13434)', padding: '5px 14px', fontSize: 12 }}
              data-testid="subscription-signout-confirm-yes"
              onClick={() => { void signOutLicense(); setConfirmSignOut(false); }}
            >
              Yes, sign out
            </button>
            <button
              type="button"
              className="sub-action-btn ghost"
              style={{ padding: '5px 14px', fontSize: 12 }}
              onClick={() => setConfirmSignOut(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Activate form */}
      {showActivate && (
        <div data-testid="subscription-activate-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--radius)', padding: '20px 24px', background: 'var(--paper)', maxWidth: 680 }}>
          <ActivateLicenseForm onClose={() => setShowActivate(false)} />
        </div>
      )}
    </section>
  );
}
