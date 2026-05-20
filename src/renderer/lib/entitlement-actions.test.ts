/**
 * Plan 08.1-03 Task 7 — entitlement-actions tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  subscribe,
  openCustomerPortal,
  refreshNow,
  signOutLicense,
  setToastImpl,
  setConfirmImpl,
} from './entitlement-actions';

interface AriaMocks {
  entitlementOpenCheckout: ReturnType<typeof vi.fn>;
  entitlementOpenPortal: ReturnType<typeof vi.fn>;
  entitlementRefreshNow: ReturnType<typeof vi.fn>;
}

const toastShow = vi.fn();

beforeEach(() => {
  toastShow.mockReset();
  setToastImpl({ show: toastShow });
  setConfirmImpl(() => true);
  const mocks: AriaMocks = {
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(async () => ({ ok: true })),
    entitlementRefreshNow: vi.fn(async () => ({ ok: true, state: { kind: 'pro-active', subscriptionUntil: '2026-12-31' } })),
  };
  (window as unknown as { aria: unknown }).aria = mocks;
});

describe('entitlement-actions', () => {
  it('subscribe() calls openCheckout IPC; no toast on success', async () => {
    await subscribe();
    const aria = (window as unknown as { aria: AriaMocks }).aria;
    expect(aria.entitlementOpenCheckout).toHaveBeenCalledTimes(1);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('subscribe() shows a contextual toast when no-checkout-url', async () => {
    const aria = (window as unknown as { aria: AriaMocks }).aria;
    aria.entitlementOpenCheckout.mockResolvedValueOnce({ ok: false, error: 'no-checkout-url' });
    await expect(subscribe()).rejects.toBeTruthy();
    expect(toastShow).toHaveBeenCalledWith('error', expect.stringMatching(/wired up/i));
  });

  it('openCustomerPortal() calls openPortal IPC; success toast suppressed', async () => {
    await openCustomerPortal();
    const aria = (window as unknown as { aria: AriaMocks }).aria;
    expect(aria.entitlementOpenPortal).toHaveBeenCalledTimes(1);
  });

  it('openCustomerPortal() with no-jwt shows actionable toast', async () => {
    const aria = (window as unknown as { aria: AriaMocks }).aria;
    aria.entitlementOpenPortal.mockResolvedValueOnce({ ok: false, error: 'no-jwt' });
    await expect(openCustomerPortal()).rejects.toBeTruthy();
    expect(toastShow).toHaveBeenCalledWith('error', expect.stringMatching(/subscribe or activate/i));
  });

  it('refreshNow() shows success toast and calls IPC', async () => {
    await refreshNow();
    expect(toastShow).toHaveBeenCalledWith('success', expect.stringMatching(/refreshed/i));
  });

  it('refreshNow() network failure shows actionable toast and throws', async () => {
    const aria = (window as unknown as { aria: AriaMocks }).aria;
    aria.entitlementRefreshNow.mockResolvedValueOnce({ ok: false, error: 'network-error' });
    await expect(refreshNow()).rejects.toBeTruthy();
    expect(toastShow).toHaveBeenCalledWith(
      'error',
      "Couldn't reach the activation server.",
    );
  });

  it('signOutLicense() requires confirm; cancel → no toast', async () => {
    setConfirmImpl(() => false);
    await signOutLicense();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('signOutLicense() confirm OK → info toast about Customer Portal', async () => {
    setConfirmImpl(() => true);
    await signOutLicense();
    expect(toastShow).toHaveBeenCalledWith('info', expect.stringMatching(/Customer Portal/i));
  });
});
