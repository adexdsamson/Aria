/**
 * Phase 9 Plan 02 Task 1 — Editorial shell chrome host.
 *
 * SideNav + Topbar + AppRoutes + CommandPalette stacked vertically inside the
 * authenticated shell. Background = var(--ivory). Pre-auth gate states are
 * owned by App.tsx (Branch A — see 09-02-SUMMARY decision); Layout
 * deliberately holds NO conditional suppression here.
 */
import { SideNav } from '../components/SideNav';
import { Topbar } from '../components/Topbar';
import { CommandPalette } from '../components/CommandPalette';
import { AppRoutes } from './routes';

export function Layout(): JSX.Element {
  return (
    <div
      data-testid="aria-layout"
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        background: 'var(--ivory)',
        color: 'var(--ink)',
      }}
    >
      <SideNav />
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--ivory)',
        }}
      >
        <Topbar />
        <main style={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0 }}>
          <AppRoutes />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
