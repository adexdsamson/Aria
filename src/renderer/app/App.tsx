import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SideNav } from '../components/SideNav';
import { Topbar } from '../components/Topbar';
import { CommandPalette } from '../components/CommandPalette';
import { ToastHost } from '../components/ToastHost';
import { AppRoutes } from './routes';
import { OnboardingWizard } from '../features/onboarding/OnboardingWizard';
import { UnlockScreen } from '../features/onboarding/UnlockScreen';
import { RestoreScreen } from '../features/onboarding/RestoreScreen';
import { EntitlementProvider } from '../features/entitlement/EntitlementProvider';
import { TrialBanner } from '../features/entitlement/TrialBanner';

type GateState = 'loading' | 'onboarding' | 'locked' | 'unlocked';

/**
 * Top-level shell. Before rendering the side-nav + routed content we ask the
 * main process for vault/db status:
 *   - !vaultPresent           → render <OnboardingWizard/>
 *   - vaultPresent && !dbOpen → render <UnlockScreen/>
 *   - dbOpen                  → normal SideNav + AppRoutes layout
 *
 * /restore is reachable from the UnlockScreen "forgot password" link and is
 * mounted inside the same MemoryRouter so navigation works.
 */
export function App(): JSX.Element {
  return (
    <MemoryRouter initialEntries={['/briefing']}>
      <AppShell />
    </MemoryRouter>
  );
}

function AppShell(): JSX.Element {
  const [gate, setGate] = useState<GateState>('loading');

  const refresh = useCallback(async (): Promise<void> => {
    const status = (await window.aria.onboardingStatus()) as {
      vaultPresent?: boolean;
      dbOpen?: boolean;
      sealed?: boolean;
      unlocked?: boolean;
    };
    const vaultPresent = status.vaultPresent ?? status.sealed ?? false;
    const dbOpen = status.dbOpen ?? status.unlocked ?? false;
    if (!vaultPresent) setGate('onboarding');
    else if (!dbOpen) setGate('locked');
    else setGate('unlocked');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (gate === 'loading') {
    return (
      <div data-testid="gate-loading" style={shellStyle()}>
        <p style={{ padding: 24 }}>Loading…</p>
      </div>
    );
  }

  if (gate === 'onboarding') {
    return (
      <div data-testid="gate-onboarding" style={shellStyle()}>
        <OnboardingWizard onComplete={() => void refresh()} />
      </div>
    );
  }

  if (gate === 'locked') {
    return (
      <div data-testid="gate-locked" style={shellStyle()}>
        <Routes>
          <Route path="/restore" element={<RestoreScreen />} />
          <Route path="*" element={<UnlockScreen onUnlocked={() => void refresh()} />} />
        </Routes>
      </div>
    );
  }

  return (
    <EntitlementProvider>
      <div data-testid="gate-unlocked" style={shellStyle()}>
        <SideNav />
        <main
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            background: 'var(--ivory)',
            color: 'var(--ink)',
          }}
        >
          <TrialBanner />
          <Topbar onLocked={() => void refresh()} />
          <div style={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0 }}>
            <AppRoutes />
          </div>
        </main>
        <CommandPalette />
        <ToastHost />
      </div>
    </EntitlementProvider>
  );
}

function shellStyle(): React.CSSProperties {
  return {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    backgroundColor: 'var(--aria-bg)',
    color: 'var(--aria-fg)',
  };
}

