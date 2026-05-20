/**
 * Plan 08.1-03 Task 2 — PaywallScreen tests.
 *
 *  - trial-locked: shows trial-ended headline
 *  - pro-locked:   shows "couldn't verify" headline + Manage subscription link
 *  - "I have a license key" toggles the ActivateLicenseForm
 *  - Subscribe button calls entitlementOpenCheckout exactly once (and does
 *    NOT navigate the Electron window — main owns shell.openExternal)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaywallScreen } from './PaywallScreen';
import { EntitlementProvider } from './EntitlementProvider';
import type { EntitlementState } from './types';

const TRIAL_LOCKED: EntitlementState = {
  kind: 'trial-locked',
  trialExpiresAt: '2026-04-30T00:00:00Z',
};

const PRO_LOCKED: EntitlementState = {
  kind: 'pro-locked',
  lastVerifiedAt: '2026-05-01T00:00:00Z',
};

interface AriaMocks {
  entitlementGetState: ReturnType<typeof vi.fn>;
  entitlementOnStateChanged: ReturnType<typeof vi.fn>;
  entitlementActivate: ReturnType<typeof vi.fn>;
  entitlementOpenCheckout: ReturnType<typeof vi.fn>;
  entitlementOpenPortal: ReturnType<typeof vi.fn>;
  entitlementRefreshNow: ReturnType<typeof vi.fn>;
}

function installAria(): AriaMocks {
  const mocks: AriaMocks = {
    entitlementGetState: vi.fn(async () => ({ ok: true, state: TRIAL_LOCKED })),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(async () => ({ ok: true })),
    entitlementRefreshNow: vi.fn(),
  };
  (window as unknown as { aria: unknown }).aria = mocks;
  return mocks;
}

async function mount(state: EntitlementState): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <EntitlementProvider initialState={state}>
          <PaywallScreen />
        </EntitlementProvider>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
});

describe('PaywallScreen', () => {
  it('trial-locked: shows "Your trial has ended" + no Manage subscription link', async () => {
    installAria();
    await mount(TRIAL_LOCKED);
    expect(screen.getByText(/Your trial has ended/i)).toBeTruthy();
    expect(screen.queryByTestId('paywall-portal-link')).toBeNull();
  });

  it('pro-locked: shows verification copy + Manage subscription link', async () => {
    installAria();
    await mount(PRO_LOCKED);
    expect(screen.getByText(/couldn't verify your subscription/i)).toBeTruthy();
    expect(screen.getByTestId('paywall-portal-link')).toBeTruthy();
  });

  it('"I have a license key" toggles the ActivateLicenseForm', async () => {
    installAria();
    await mount(TRIAL_LOCKED);
    expect(screen.queryByTestId('activate-license-form')).toBeNull();
    fireEvent.click(screen.getByTestId('paywall-activate-toggle'));
    expect(screen.getByTestId('activate-license-form')).toBeTruthy();
    fireEvent.click(screen.getByTestId('paywall-activate-toggle'));
    expect(screen.queryByTestId('activate-license-form')).toBeNull();
  });

  it('Subscribe button calls entitlementOpenCheckout exactly once (no in-process navigation)', async () => {
    const mocks = installAria();
    await mount(TRIAL_LOCKED);
    const originalHref = window.location.href;
    await act(async () => {
      fireEvent.click(screen.getByTestId('paywall-subscribe-btn'));
    });
    expect(mocks.entitlementOpenCheckout).toHaveBeenCalledTimes(1);
    // The renderer must NOT have navigated — shell.openExternal lives in main.
    expect(window.location.href).toBe(originalHref);
  });

  it('renders nothing for non-locked states', async () => {
    installAria();
    const active: EntitlementState = {
      kind: 'trial-active-quiet',
      daysRemaining: 30,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    };
    await mount(active);
    expect(screen.queryByTestId('paywall-screen')).toBeNull();
  });
});
