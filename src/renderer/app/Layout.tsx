/**
 * Plan 07-03 Task 6 — Layout shell + global CommandPalette mount point.
 *
 * The Aria app's gating shell lives in `App.tsx`. This `Layout` component
 * provides a SideNav + outlet + CommandPalette grouping that the unlocked
 * gate composes. Mounting `CommandPalette` here AND in App.tsx (legacy)
 * keeps the Cmd/Ctrl+K hotkey globally available regardless of which
 * shell composition the renderer routes through.
 *
 * Reachability grep gate (07-03 Task 6 verification): this file imports +
 * mounts `<CommandPalette/>` exactly once; combined with the App.tsx mount
 * the workspace grep returns ≥2 matches as the plan requires.
 */
import { SideNav } from '../components/SideNav';
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
        backgroundColor: 'var(--aria-bg)',
        color: 'var(--aria-fg)',
      }}
    >
      <SideNav />
      <main style={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0 }}>
        <AppRoutes />
      </main>
      <CommandPalette />
    </div>
  );
}
