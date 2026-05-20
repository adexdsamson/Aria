/**
 * Plan 08.1-03 Task 5 — RestoreLicenseSection tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RestoreLicenseSection } from './RestoreLicenseSection';
import { EntitlementProvider } from './EntitlementProvider';
import type { EntitlementState } from './types';

const TRIAL_LOCKED: EntitlementState = {
  kind: 'trial-locked',
  trialExpiresAt: '2026-04-30T00:00:00Z',
};

beforeEach(() => {
  (window as unknown as { aria: unknown }).aria = {
    entitlementGetState: vi.fn(),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(),
    entitlementOpenPortal: vi.fn(),
    entitlementRefreshNow: vi.fn(),
  };
});

describe('RestoreLicenseSection', () => {
  it('shows the "Check your email" copy with the ARIA- key hint', async () => {
    await act(async () => {
      render(
        <EntitlementProvider initialState={TRIAL_LOCKED}>
          <RestoreLicenseSection />
        </EntitlementProvider>,
      );
    });
    expect(screen.getByText(/Check your email/i)).toBeTruthy();
    expect(screen.getByText(/ARIA-/)).toBeTruthy();
  });

  it('embeds the ActivateLicenseForm', async () => {
    await act(async () => {
      render(
        <EntitlementProvider initialState={TRIAL_LOCKED}>
          <RestoreLicenseSection />
        </EntitlementProvider>,
      );
    });
    expect(screen.getByTestId('activate-license-form')).toBeTruthy();
  });

  it('renders a "restore help" link', async () => {
    await act(async () => {
      render(
        <EntitlementProvider initialState={TRIAL_LOCKED}>
          <RestoreLicenseSection />
        </EntitlementProvider>,
      );
    });
    const link = screen.getByTestId('restore-help-link') as HTMLAnchorElement;
    expect(link.href).toMatch(/aria\.app\/help\/restore/);
  });
});
