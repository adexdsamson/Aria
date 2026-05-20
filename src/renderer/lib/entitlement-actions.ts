/**
 * Plan 08.1-03 Task 7 — entitlement-actions helpers.
 *
 * Thin wrappers around window.aria.entitlement* IPC that own the
 * toast-on-success + toast-on-failure UX so components don't repeat the
 * pattern. Paste-flow activation goes through ActivateLicenseForm for inline
 * error feedback, NOT through this module.
 *
 * Toasts are surfaced via a simple global event bus consumed by a future
 * <ToastHost/> mount. For v1 we fall back to console + window.alert (jsdom
 * + Electron) since Aria doesn't yet have a shared toast component. The
 * helpers are designed so the toast surface can be swapped later without
 * touching call sites.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastApi {
  show(kind: ToastKind, message: string): void;
}

let toastImpl: ToastApi = {
  show(kind, message) {
    // eslint-disable-next-line no-console
    console[kind === 'error' ? 'error' : 'log'](`[${kind}] ${message}`);
  },
};

/** Test / future <ToastHost/> seam. */
export function setToastImpl(impl: ToastApi): void {
  toastImpl = impl;
}

/** Confirm seam — overridable for tests. Default: window.confirm. */
let confirmImpl: (message: string) => boolean = (m) =>
  typeof window !== 'undefined' &&
  typeof window.confirm === 'function'
    ? window.confirm(m)
    : true;
export function setConfirmImpl(impl: (m: string) => boolean): void {
  confirmImpl = impl;
}

function toast(kind: ToastKind, message: string): void {
  toastImpl.show(kind, message);
}

export async function subscribe(): Promise<void> {
  try {
    const res = await window.aria.entitlementOpenCheckout();
    if (res && typeof res === 'object' && 'ok' in res) {
      const r = res as { ok: boolean; error?: string };
      if (!r.ok) {
        if (r.error === 'no-checkout-url') {
          toast(
            'error',
            "Subscribe isn't wired up in this build yet. Contact support.",
          );
        } else {
          toast('error', `Couldn't open Stripe Checkout: ${r.error ?? 'unknown'}`);
        }
        throw new Error(r.error ?? 'open-checkout-failed');
      }
    }
  } catch (err) {
    if (!(err instanceof Error) || !err.message) toast('error', "Couldn't open Stripe Checkout.");
    throw err;
  }
}

export async function openCustomerPortal(): Promise<void> {
  try {
    const res = await window.aria.entitlementOpenPortal();
    if (res && typeof res === 'object' && 'ok' in res) {
      const r = res as { ok: boolean; error?: string };
      if (!r.ok) {
        toast(
          'error',
          r.error === 'no-jwt'
            ? "We don't have a verified subscription yet. Subscribe or activate a key first."
            : `Couldn't open the Customer Portal: ${r.error ?? 'unknown'}`,
        );
        throw new Error(r.error ?? 'open-portal-failed');
      }
    }
  } catch (err) {
    if (!(err instanceof Error) || !err.message) toast('error', "Couldn't open the Customer Portal.");
    throw err;
  }
}

export async function refreshNow(): Promise<void> {
  try {
    const res = await window.aria.entitlementRefreshNow();
    if (res && typeof res === 'object' && 'ok' in res) {
      const r = res as { ok: boolean; error?: string };
      if (!r.ok) {
        toast('error', "Couldn't reach the activation server.");
        throw new Error(r.error ?? 'refresh-failed');
      }
      toast('success', 'Subscription refreshed.');
      return;
    }
    toast('error', "Couldn't reach the activation server.");
    throw new Error('refresh-bad-response');
  } catch (err) {
    if (!(err instanceof Error) || !err.message) toast('error', "Couldn't reach the activation server.");
    throw err;
  }
}

/**
 * Destructive — clears the local entitlement row and the cached install_id.
 * Phase 7 trust posture: requires explicit user confirm. There is no IPC for
 * this in 08.1-02 yet; this helper surfaces the intent and falls back to
 * showing an "unavailable" toast. Future plan can wire a real signOutLicense
 * IPC handler.
 */
export async function signOutLicense(): Promise<void> {
  const ok = confirmImpl(
    'Clear the local license / trial state? Aria will need an internet connection to start a new trial or restore your subscription. This cannot be undone from inside the app.',
  );
  if (!ok) return;
  // No backend IPC yet; surface as info so the user sees the destructive
  // action was acknowledged but the wipe path is documented as a Phase 8
  // followup. The Customer Portal handles installation revocation server-side.
  toast(
    'info',
    "Use the Customer Portal to revoke this install. Local sign-out is coming in a future build.",
  );
}
