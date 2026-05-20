/**
 * Plan 08.1-03 Task 1 — EntitlementProvider unit tests.
 *
 * Coverage:
 *  - getState called exactly once on mount
 *  - unsubscribe fn returned by entitlementOnStateChanged is called on unmount
 *  - useEntitlement outside provider throws
 *  - subscription updates state without a re-mount
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import { EntitlementProvider } from './EntitlementProvider';
import { useEntitlement } from './useEntitlement';
import type { EntitlementState } from './types';

const ACTIVE_STATE: EntitlementState = {
  kind: 'trial-active-quiet',
  daysRemaining: 30,
  trialExpiresAt: '2026-06-30T00:00:00Z',
};

const LOCKED_STATE: EntitlementState = {
  kind: 'trial-locked',
  trialExpiresAt: '2026-04-30T00:00:00Z',
};

interface SubBag {
  cb: ((payload: unknown) => void) | null;
}

function installAria(bag: SubBag, opts: { getState?: () => unknown } = {}): {
  getState: ReturnType<typeof vi.fn>;
  unsub: ReturnType<typeof vi.fn>;
} {
  const getState = vi.fn(async () =>
    (opts.getState ? opts.getState() : { ok: true, state: ACTIVE_STATE }),
  );
  const unsub = vi.fn();
  const onChanged = vi.fn((cb: (p: unknown) => void) => {
    bag.cb = cb;
    return unsub;
  });
  (window as unknown as { aria: unknown }).aria = {
    entitlementGetState: getState,
    entitlementOnStateChanged: onChanged,
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(),
    entitlementOpenPortal: vi.fn(),
    entitlementRefreshNow: vi.fn(),
  };
  return { getState, unsub };
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
});

describe('EntitlementProvider', () => {
  it('calls getState exactly once on mount', async () => {
    const bag: SubBag = { cb: null };
    const { getState } = installAria(bag);
    await act(async () => {
      render(
        <EntitlementProvider>
          <div data-testid="children">ok</div>
        </EntitlementProvider>,
      );
    });
    expect(getState).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('children')).toBeTruthy();
  });

  it('calls unsubscribe fn on unmount', async () => {
    const bag: SubBag = { cb: null };
    const { unsub } = installAria(bag);
    let unmount: () => void;
    await act(async () => {
      const result = render(
        <EntitlementProvider>
          <span>x</span>
        </EntitlementProvider>,
      );
      unmount = result.unmount;
    });
    expect(unsub).not.toHaveBeenCalled();
    unmount!();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('useEntitlement outside provider throws', () => {
    expect(() => renderHook(() => useEntitlement())).toThrow(
      /must be used within EntitlementProvider/,
    );
  });

  it('subscription payload updates state without remount', async () => {
    const bag: SubBag = { cb: null };
    installAria(bag);
    function Reader(): JSX.Element {
      const { state } = useEntitlement();
      return <div data-testid="kind">{state?.kind ?? 'none'}</div>;
    }
    await act(async () => {
      render(
        <EntitlementProvider>
          <Reader />
        </EntitlementProvider>,
      );
    });
    expect(screen.getByTestId('kind').textContent).toBe('trial-active-quiet');
    await act(async () => {
      bag.cb?.({ state: LOCKED_STATE });
    });
    expect(screen.getByTestId('kind').textContent).toBe('trial-locked');
  });
});
