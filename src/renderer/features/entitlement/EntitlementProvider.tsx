/**
 * Plan 08.1-03 Task 1 — EntitlementProvider.
 *
 * Loads initial entitlement state on mount, subscribes to
 * ENTITLEMENT_STATE_CHANGED for live updates, and exposes action wrappers via
 * React context. The subscription effect runs ONCE (empty dep array) and is
 * the sole source-of-truth subscription point for the renderer.
 */
import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EntitlementState } from './types';

export interface EntitlementContextValue {
  /** Null while initial getState is in flight. */
  state: EntitlementState | null;
  /** Re-fetch from main and update state. Used by Settings → Refresh now. */
  refresh: () => Promise<void>;
  /**
   * Activate via paste flow. Returns the raw IPC response so the caller can
   * surface typed error codes inline.
   */
  activate: (license_key: string) => Promise<
    | { ok: true; state: EntitlementState }
    | { ok: false; error: { code: string; message?: string } }
  >;
  openCheckout: () => Promise<{ ok: boolean; error?: string }>;
  openPortal: () => Promise<{ ok: boolean; error?: string }>;
}

export const EntitlementContext = createContext<EntitlementContextValue | null>(
  null,
);

interface ProviderProps {
  children: ReactNode;
  /**
   * Test seam: provide an initial state to skip the async getState fetch.
   * Production code never passes this — the provider always loads from main.
   */
  initialState?: EntitlementState | null;
  /** Test seam: render a custom node while initial fetch is pending. */
  loadingFallback?: ReactNode;
}

function unwrapState(
  res:
    | { ok: true; state: unknown }
    | { ok: false; error: string }
    | { error: string }
    | unknown,
): EntitlementState | null {
  if (!res || typeof res !== 'object') return null;
  const obj = res as { ok?: boolean; state?: unknown };
  if (obj.ok === true && obj.state && typeof obj.state === 'object') {
    return obj.state as EntitlementState;
  }
  return null;
}

export function EntitlementProvider(props: ProviderProps): JSX.Element {
  const [state, setState] = useState<EntitlementState | null>(
    props.initialState ?? null,
  );
  const [loading, setLoading] = useState<boolean>(props.initialState == null);
  // Whether the caller pre-seeded state — if so, skip the initial getState
  // fetch entirely. This keeps tests deterministic when they pass an
  // initialState that differs from the mocked window.aria.entitlementGetState.
  const skipInitialFetchRef = useRef(props.initialState != null);

  // Avoid stale closures inside the once-only subscription effect.
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  // Initial fetch — runs ONCE on mount (skipped when initialState was given).
  useEffect(() => {
    if (skipInitialFetchRef.current) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.aria.entitlementGetState();
        if (cancelled) return;
        const next = unwrapState(res);
        if (next) setState(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Empty dep array — initial fetch must NOT re-run on state changes
    // (no derived-state-in-effects).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscription — runs ONCE on mount, unsubscribes on unmount.
  useEffect(() => {
    type SubFn = (
      cb: (payload: unknown) => void,
    ) => () => void;
    const subscribe = (window.aria as unknown as {
      entitlementOnStateChanged: SubFn;
    }).entitlementOnStateChanged;
    if (typeof subscribe !== 'function') return undefined;
    const unsub = subscribe((payload: unknown) => {
      // Push payload shape: { state: EntitlementState }
      if (payload && typeof payload === 'object' && 'state' in payload) {
        const next = (payload as { state: unknown }).state;
        if (next && typeof next === 'object') {
          setStateRef.current(next as EntitlementState);
        }
      } else if (payload && typeof payload === 'object' && 'kind' in payload) {
        // Tolerate bare-state payloads.
        setStateRef.current(payload as EntitlementState);
      }
    });
    return () => {
      try {
        unsub?.();
      } catch {
        /* idempotent unsubscribe */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.aria.entitlementRefreshNow();
    const next = unwrapState(res);
    if (next) setState(next);
  }, []);

  const activate = useCallback(
    async (
      license_key: string,
    ): Promise<
      | { ok: true; state: EntitlementState }
      | { ok: false; error: { code: string; message?: string } }
    > => {
      const res = await window.aria.entitlementActivate({ license_key });
      if (res && typeof res === 'object') {
        const r = res as
          | { ok: true; state: unknown }
          | { ok: false; error: { code: string; message?: string } }
          | { error: string };
        if ('ok' in r && r.ok === true) {
          const next = unwrapState(r);
          if (next) setState(next);
          return { ok: true, state: next ?? ({ kind: 'pro-active', subscriptionUntil: new Date().toISOString() } as EntitlementState) };
        }
        if ('ok' in r && r.ok === false) {
          return { ok: false, error: r.error ?? { code: 'unknown' } };
        }
        if ('error' in r && typeof r.error === 'string') {
          return { ok: false, error: { code: r.error } };
        }
      }
      return { ok: false, error: { code: 'unknown' } };
    },
    [],
  );

  const openCheckout = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    const res = await window.aria.entitlementOpenCheckout();
    if (res && typeof res === 'object' && 'ok' in res) {
      const r = res as { ok: boolean; error?: string };
      return { ok: r.ok === true, error: r.error };
    }
    return { ok: false, error: 'unknown' };
  }, []);

  const openPortal = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    const res = await window.aria.entitlementOpenPortal();
    if (res && typeof res === 'object' && 'ok' in res) {
      const r = res as { ok: boolean; error?: string };
      return { ok: r.ok === true, error: r.error };
    }
    return { ok: false, error: 'unknown' };
  }, []);

  if (loading && state === null) {
    return (
      <div data-testid="entitlement-loading" style={{ padding: 24 }}>
        {props.loadingFallback ?? <p>Loading…</p>}
      </div>
    );
  }

  const value: EntitlementContextValue = {
    state,
    refresh,
    activate,
    openCheckout,
    openPortal,
  };
  return (
    <EntitlementContext.Provider value={value}>
      {props.children}
    </EntitlementContext.Provider>
  );
}
