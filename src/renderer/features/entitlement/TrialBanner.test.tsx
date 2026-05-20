/**
 * Plan 08.1-03 Task 4 — TrialBanner tests.
 *
 *  - Renders distinct copy for day50/55/59/grace/clock-skew
 *  - All other states render null
 *  - Dismiss hides for current mount; new mount shows again (no persistence)
 *  - Subscribe button calls entitlementOpenCheckout
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TrialBanner } from './TrialBanner';
import { EntitlementProvider } from './EntitlementProvider';
import type { EntitlementState } from './types';

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
    entitlementGetState: vi.fn(async () => ({ ok: true, state: null })),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(),
    entitlementRefreshNow: vi.fn(),
  };
  (window as unknown as { aria: unknown }).aria = mocks;
  return mocks;
}

async function mountWith(state: EntitlementState): Promise<void> {
  await act(async () => {
    render(
      <EntitlementProvider initialState={state}>
        <TrialBanner />
      </EntitlementProvider>,
    );
  });
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
});

describe('TrialBanner', () => {
  it('renders day50 banner with "10 days left" copy', async () => {
    installAria();
    await mountWith({
      kind: 'trial-active-day50',
      daysRemaining: 10,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    });
    expect(screen.getByTestId('banner-day50').textContent).toMatch(/10 days left/);
  });

  it('renders day55 banner with "5 days left" copy', async () => {
    installAria();
    await mountWith({
      kind: 'trial-active-day55',
      daysRemaining: 5,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    });
    expect(screen.getByTestId('banner-day55').textContent).toMatch(/5 days left/);
  });

  it('renders day59 banner with date and urgent tone', async () => {
    installAria();
    await mountWith({
      kind: 'trial-active-day59',
      daysRemaining: 2,
      trialExpiresAt: '2026-05-22T00:00:00Z',
    });
    expect(screen.getByTestId('banner-day59').textContent).toMatch(/2 days left/);
    expect(screen.getByTestId('banner-day59').textContent).toMatch(/Your trial ends/);
  });

  it('renders grace banner copy', async () => {
    installAria();
    await mountWith({
      kind: 'trial-expired-grace',
      trialExpiresAt: '2026-05-20T00:00:00Z',
      hoursOfGraceRemaining: 12,
    });
    expect(screen.getByTestId('banner-grace').textContent).toMatch(/Your trial has ended/);
  });

  it('renders clock-skew warning banner (informational, no Subscribe)', async () => {
    installAria();
    await mountWith({
      kind: 'clock-skew-warn',
      skewDays: -30,
      underlyingState: {
        kind: 'trial-active-quiet',
        daysRemaining: 30,
        trialExpiresAt: '2026-06-30T00:00:00Z',
      },
    });
    expect(screen.getByTestId('banner-clock-skew')).toBeTruthy();
    expect(screen.queryByTestId('banner-clock-skew-subscribe')).toBeNull();
  });

  it('renders null for trial-active-quiet (non-banner state)', async () => {
    installAria();
    await mountWith({
      kind: 'trial-active-quiet',
      daysRemaining: 30,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    });
    expect(screen.queryByTestId('banner-day50')).toBeNull();
    expect(screen.queryByTestId('banner-day55')).toBeNull();
    expect(screen.queryByTestId('banner-day59')).toBeNull();
    expect(screen.queryByTestId('banner-grace')).toBeNull();
  });

  it('dismiss hides for current mount but reappears on a fresh mount (no persistence)', async () => {
    installAria();
    const state: EntitlementState = {
      kind: 'trial-active-day50',
      daysRemaining: 10,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    };
    await mountWith(state);
    fireEvent.click(screen.getByTestId('banner-day50-dismiss'));
    expect(screen.queryByTestId('banner-day50')).toBeNull();
    cleanup();
    // Fresh mount — banner reappears (no persistence).
    await mountWith(state);
    expect(screen.getByTestId('banner-day50')).toBeTruthy();
  });

  it('Subscribe button calls entitlementOpenCheckout', async () => {
    const mocks = installAria();
    await mountWith({
      kind: 'trial-active-day50',
      daysRemaining: 10,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('banner-day50-subscribe'));
    });
    expect(mocks.entitlementOpenCheckout).toHaveBeenCalledTimes(1);
  });
});
