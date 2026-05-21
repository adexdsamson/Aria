/**
 * useFrontierProvider — renderer hook that fetches the currently active
 * frontier provider from secretsGetActiveProvider IPC.
 *
 * Returns `null` while loading or when no provider has been configured.
 * Components compose this with frontierModelDisplay() / frontierFullLabel()
 * from src/shared/frontier-labels.ts to render the right model name.
 */
import { useEffect, useState } from 'react';
import type { ProviderId } from '../../shared/ipc-contract';

export function useFrontierProvider(): ProviderId | null {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await window.aria.secretsGetActiveProvider()) as {
          provider?: ProviderId | null;
        };
        if (!cancelled) setProvider(res?.provider ?? null);
      } catch {
        if (!cancelled) setProvider(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return provider;
}
