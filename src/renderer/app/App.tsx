import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
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
import { AppLogo } from '../components/editorial/Logo';

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
      {/* Phase 12 / Plan 12-03 — aria:navigate push channel listener */}
      <AppShellNavigateListener />
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
      <div data-testid="gate-loading" style={{ ...shellStyle(), background: 'var(--paper)' }}>
        <GateLoadingScreen />
      </div>
    );
  }

  if (gate === 'onboarding') {
    return (
      <div data-testid="gate-onboarding" style={{ ...shellStyle(), background: 'var(--paper)', minHeight: '100vh' }}>
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

function GateLoadingScreen(): JSX.Element {
  return (
    <>
      <style>{`
        @keyframes gate-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes gate-progress {
          0%   { width: 0%;   }
          60%  { width: 55%;  }
          85%  { width: 62%;  }
          100% { width: 66%;  }
        }
        @media (prefers-reduced-motion: reduce) {
          .gate-logo { animation: none !important; opacity: 1 !important; }
          .gate-bar  { animation: none !important; width: 40% !important; opacity: 0.4 !important; }
        }
      `}</style>
      <div
        className="gate-logo"
        style={{
          margin: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          animation: 'gate-fade-in 400ms cubic-bezier(0.23,1,0.32,1) both',
          animationDelay: '60ms',
        }}
      >
        <AppLogo variant="splash" />
        {/* Gold progress bar — suggests activity without implying exact progress */}
        <div
          style={{
            width: 160,
            height: 2,
            background: 'var(--rule)',
            borderRadius: 2,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            className="gate-bar"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              background: 'var(--gold)',
              borderRadius: 2,
              animation: 'gate-progress 2.4s cubic-bezier(0.23,1,0.32,1) forwards',
            }}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase 12 / Plan 12-03 — aria:navigate listener (BG-03, T-12-10)
//
// Subscribes to the main-process push channel at mount. Allowlist enforced:
// only /briefing and /approvals are routed programmatically. Any other path
// is logged and ignored — prevents an open-redirect via IPC.
//
// Exported for unit-testing (navigate-listener.spec.tsx).
// ---------------------------------------------------------------------------

const NAVIGATE_ALLOWLIST = ['/briefing', '/approvals'] as const;
type AllowedPath = (typeof NAVIGATE_ALLOWLIST)[number];

function isAllowedPath(path: string): path is AllowedPath {
  return (NAVIGATE_ALLOWLIST as readonly string[]).includes(path);
}

/**
 * Thin component that mounts inside the MemoryRouter and registers the
 * aria:navigate subscription. Renders nothing — pure side-effect.
 */
export function AppShellNavigateListener(): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined' || !window.aria?.onNavigate) return;
    const unsubscribe = window.aria.onNavigate((path: string) => {
      if (isAllowedPath(path)) {
        navigate(path);
      }
      // Non-allowlisted paths are silently ignored (T-12-10 defence).
    });
    return () => {
      unsubscribe();
    };
  }, [navigate]);

  return null;
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

