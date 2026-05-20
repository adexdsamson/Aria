/**
 * Plan 08.1-03 Task 1 — useEntitlement hook.
 *
 * Reads EntitlementContext. Throws when used outside the provider so missing
 * wiring surfaces as a loud error in dev rather than a silent null state.
 */
import { useContext } from 'react';
import {
  EntitlementContext,
  type EntitlementContextValue,
} from './EntitlementProvider';

export function useEntitlement(): EntitlementContextValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) {
    throw new Error('useEntitlement must be used within EntitlementProvider');
  }
  return ctx;
}
