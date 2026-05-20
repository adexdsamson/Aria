/**
 * Plan 08.1-03 Task 6 — Locked-state route guard tests.
 *
 *  - trial-locked + non-allow-listed route → PaywallScreen renders
 *  - trial-locked + /settings (allow-listed) → real settings; no paywall
 *  - trial-active-day55 → TrialBanner renders + route renders normally
 *  - isReadOnlyAllowed unit checks
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes, isReadOnlyAllowed } from './routes';
import { EntitlementProvider } from '../features/entitlement/EntitlementProvider';
import { TrialBanner } from '../features/entitlement/TrialBanner';
import type { EntitlementState } from '../features/entitlement/types';

function installAria(): void {
  (window as unknown as { aria: unknown }).aria = {
    entitlementGetState: vi.fn(async () => ({ ok: true, state: null })),
    entitlementOnStateChanged: vi.fn(() => () => undefined),
    entitlementActivate: vi.fn(),
    entitlementOpenCheckout: vi.fn(async () => ({ ok: true })),
    entitlementOpenPortal: vi.fn(async () => ({ ok: true })),
    entitlementRefreshNow: vi.fn(async () => ({ ok: true, state: null })),
    // Stub the rest of the renderer IPC surface — the AppRoutes <Routes/>
    // mounts every Screen lazily, so we stub the broad set used at boot.
    briefingToday: vi.fn(async () => ({ error: 'no-data' })),
    briefingHistory: vi.fn(async () => ({ entries: [] })),
    approvalsList: vi.fn(async () => ({ rows: [] })),
    diagnosticsStatus: vi.fn(async () => ({})),
  };
}

async function mountAt(
  pathname: string,
  state: EntitlementState | null,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <EntitlementProvider initialState={state}>
          <TrialBanner />
          <AppRoutes />
        </EntitlementProvider>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  delete (window as unknown as { aria?: unknown }).aria;
});

describe('isReadOnlyAllowed', () => {
  it('allows /settings + nested /settings/*', () => {
    expect(isReadOnlyAllowed('/settings')).toBe(true);
    expect(isReadOnlyAllowed('/settings/subscription')).toBe(true);
  });
  it('allows /briefing /approvals /calendar /ask /recap /tasks', () => {
    for (const p of ['/briefing', '/approvals', '/calendar', '/ask', '/recap', '/tasks']) {
      expect(isReadOnlyAllowed(p)).toBe(true);
    }
  });
  it('rejects /scheduling (write-action chat)', () => {
    expect(isReadOnlyAllowed('/scheduling')).toBe(false);
  });
});

describe('LockedGuard', () => {
  it('trial-locked + /scheduling → PaywallScreen rendered', async () => {
    installAria();
    await mountAt('/scheduling', {
      kind: 'trial-locked',
      trialExpiresAt: '2026-04-30T00:00:00Z',
    });
    expect(screen.getByTestId('paywall-screen')).toBeTruthy();
  });

  it('trial-locked + /settings/subscription → settings rendered (allow-listed); no paywall', async () => {
    installAria();
    await mountAt('/settings/subscription', {
      kind: 'trial-locked',
      trialExpiresAt: '2026-04-30T00:00:00Z',
    });
    expect(screen.queryByTestId('paywall-screen')).toBeNull();
    expect(screen.getByTestId('settings-subscription')).toBeTruthy();
  });

  it('trial-active-day55 → TrialBanner renders + scheduling route accessible', async () => {
    installAria();
    await mountAt('/scheduling', {
      kind: 'trial-active-day55',
      daysRemaining: 5,
      trialExpiresAt: '2026-06-04T00:00:00Z',
    });
    expect(screen.getByTestId('banner-day55')).toBeTruthy();
    expect(screen.queryByTestId('paywall-screen')).toBeNull();
  });
});
