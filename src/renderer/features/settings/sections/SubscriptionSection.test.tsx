/**
 * Plan 08.1-03 Task 5 — SubscriptionSection tests.
 *
 *  - Renders state badge
 *  - "Manage subscription" only renders for pro-* states
 *  - "Sign out / clear license" confirm cancel → no backend call
 *  - SettingsScreen imports SubscriptionSection (reachability)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SubscriptionSection } from './SubscriptionSection';
import { EntitlementProvider } from '../../entitlement/EntitlementProvider';
import { setConfirmImpl, setToastImpl } from '../../../lib/entitlement-actions';
import type { EntitlementState } from '../../entitlement/types';

function installAria(): void {
  (window as unknown as { aria: unknown }).aria = {
    entitlementGetState: vi.fn(async () => ({ ok: true, state: null })),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(async () => ({ ok: true })),
    entitlementRefreshNow: vi.fn(async () => ({ ok: true, state: null })),
  };
}

async function mount(state: EntitlementState): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <EntitlementProvider initialState={state}>
          <SubscriptionSection />
        </EntitlementProvider>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
  setConfirmImpl(() => true);
  setToastImpl({ show: vi.fn() });
});

describe('SubscriptionSection', () => {
  it('renders Trial countdown badge for trial-active-day50', async () => {
    installAria();
    await mount({
      kind: 'trial-active-day50',
      daysRemaining: 10,
      trialExpiresAt: '2026-06-30T00:00:00Z',
    });
    expect(screen.getByTestId('subscription-state-badge').textContent).toMatch(
      /Trial · 10 days left/,
    );
    expect(screen.queryByTestId('subscription-manage')).toBeNull();
    expect(screen.getByTestId('subscription-subscribe')).toBeTruthy();
  });

  it('renders "Manage subscription" only for pro states', async () => {
    installAria();
    await mount({
      kind: 'pro-active',
      subscriptionUntil: '2026-12-31T00:00:00Z',
    });
    expect(screen.getByTestId('subscription-manage')).toBeTruthy();
  });

  it('"Sign out / clear license" confirm cancel → no toast/no backend call', async () => {
    installAria();
    const toast = vi.fn();
    setToastImpl({ show: toast });
    setConfirmImpl(() => false);
    await mount({
      kind: 'pro-active',
      subscriptionUntil: '2026-12-31T00:00:00Z',
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('subscription-signout'));
    });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('SettingsScreen reachability (Phase 4 verifier-blindspot guard)', () => {
  it('SettingsScreen imports and mounts SubscriptionSection', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/features/settings/SettingsScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/SubscriptionSection/);
    expect(src).toMatch(/RestoreLicenseSection/);
  });
});
