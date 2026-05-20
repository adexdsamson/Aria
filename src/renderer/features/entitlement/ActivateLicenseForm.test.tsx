/**
 * Plan 08.1-03 Task 3 — ActivateLicenseForm tests.
 *
 *  - Trims pasted whitespace and validates format
 *  - Each of 4 server-error codes renders a distinct inline message
 *  - Invalid-format key never calls activate (no wasted round-trip)
 *  - Submit button disabled while in-flight
 *  - Successful activate calls onClose
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActivateLicenseForm } from './ActivateLicenseForm';
import { EntitlementProvider } from './EntitlementProvider';
import type { EntitlementState } from './types';

const QUIET: EntitlementState = {
  kind: 'trial-active-quiet',
  daysRemaining: 30,
  trialExpiresAt: '2026-06-30T00:00:00Z',
};

const VALID_KEY = 'ARIA-ABCDEFGHJKMNPQRSTVWXYZ1234-DEAD';

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
    entitlementGetState: vi.fn(async () => ({ ok: true, state: QUIET })),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(async () => ({
      ok: true,
      state: { kind: 'pro-active', subscriptionUntil: '2026-12-31' },
    })),
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(async () => ({ ok: true })),
    entitlementRefreshNow: vi.fn(async () => ({ ok: true })),
  };
  (window as unknown as { aria: unknown }).aria = mocks;
  return mocks;
}

async function mountForm(onClose = vi.fn()): Promise<{ onClose: typeof onClose }> {
  await act(async () => {
    render(
      <EntitlementProvider initialState={QUIET}>
        <ActivateLicenseForm onClose={onClose} />
      </EntitlementProvider>,
    );
  });
  return { onClose };
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
});

describe('ActivateLicenseForm', () => {
  it('invalid-format key never calls activate (no server roundtrip)', async () => {
    const mocks = installAria();
    await mountForm();
    fireEvent.change(screen.getByTestId('activate-license-input'), {
      target: { value: 'not-a-key' },
    });
    fireEvent.click(screen.getByTestId('activate-submit'));
    expect(screen.getByTestId('activate-format-hint')).toBeTruthy();
    expect(mocks.entitlementActivate).not.toHaveBeenCalled();
  });

  it('trims leading/trailing whitespace and submits a valid key', async () => {
    const mocks = installAria();
    const { onClose } = await mountForm();
    fireEvent.change(screen.getByTestId('activate-license-input'), {
      target: { value: `   ${VALID_KEY}   ` },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('activate-submit'));
    });
    expect(mocks.entitlementActivate).toHaveBeenCalledWith({ license_key: VALID_KEY });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders distinct inline message for install-cap-exceeded with portal link', async () => {
    const mocks = installAria();
    mocks.entitlementActivate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'install-cap-exceeded' },
    });
    await mountForm();
    fireEvent.change(screen.getByTestId('activate-license-input'), {
      target: { value: VALID_KEY },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('activate-submit'));
    });
    expect(screen.getByTestId('activate-error-install-cap-exceeded')).toBeTruthy();
    expect(screen.getByTestId('activate-error-portal-link')).toBeTruthy();
  });

  it.each([
    ['key-not-found', /Key not recognized/i],
    ['key-revoked', /revoked/i],
    ['network-error', /reach the activation server/i],
  ])('error code %s renders matching copy', async (code, matcher) => {
    const mocks = installAria();
    mocks.entitlementActivate.mockResolvedValueOnce({
      ok: false,
      error: { code },
    });
    await mountForm();
    fireEvent.change(screen.getByTestId('activate-license-input'), {
      target: { value: VALID_KEY },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('activate-submit'));
    });
    expect(screen.getByTestId(`activate-error-${code}`).textContent).toMatch(
      matcher,
    );
  });

  it('disables submit button while activation is in flight', async () => {
    const mocks = installAria();
    let resolve!: (v: unknown) => void;
    mocks.entitlementActivate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await mountForm();
    fireEvent.change(screen.getByTestId('activate-license-input'), {
      target: { value: VALID_KEY },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('activate-submit'));
    });
    const btn = screen.getByTestId('activate-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => {
      resolve({ ok: true, state: QUIET });
    });
  });
});
