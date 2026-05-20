import { NavLink } from 'react-router-dom';

/**
 * Left-rail side nav listing the three Phase-1 sections.
 * Active link uses the D-13 accent color via inline style; downstream phases
 * can swap to Tailwind utility classes once the design system stabilizes.
 *
 * NavLink testid pattern: `sidenav-<slug>` (e.g. sidenav-briefing, sidenav-settings).
 * Tests should click these rather than writing window.location.hash — the app
 * uses MemoryRouter, which ignores hash changes.
 */
const ITEMS: ReadonlyArray<{ to: string; label: string; testid: string }> = [
  { to: '/briefing', label: 'Briefing', testid: 'sidenav-briefing' },
  { to: '/approvals', label: 'Approvals', testid: 'sidenav-approvals' },
  { to: '/calendar', label: 'Calendar', testid: 'sidenav-calendar' },
  { to: '/meetings', label: 'Meetings', testid: 'sidenav-meetings' },
  { to: '/tasks', label: 'Tasks', testid: 'sidenav-tasks' },
  { to: '/scheduling', label: 'Scheduling', testid: 'sidenav-scheduling' },
  { to: '/ask', label: 'Ask Aria', testid: 'sidenav-ask' },
  { to: '/recap', label: 'Weekly Recap', testid: 'sidenav-recap' },
  { to: '/settings', label: 'Settings', testid: 'sidenav-settings' },
];

export function SideNav(): JSX.Element {
  return (
    <nav
      aria-label="Primary"
      style={{
        width: 220,
        flex: '0 0 220px',
        borderRight: '1px solid var(--aria-border)',
        padding: 'var(--aria-space-md)',
        boxSizing: 'border-box',
        backgroundColor: 'var(--aria-gray-50)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--aria-type-lg)',
          margin: 0,
          marginBottom: 'var(--aria-space-md)',
        }}
      >
        Aria
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {ITEMS.map((item) => (
          <li key={item.to} style={{ marginBottom: 'var(--aria-space-xs)' }}>
            <NavLink
              to={item.to}
              data-testid={item.testid}
              style={({ isActive }) => ({
                display: 'block',
                padding: 'var(--aria-space-sm) var(--aria-space-md)',
                borderRadius: 'var(--aria-radius-md)',
                textDecoration: 'none',
                color: isActive ? 'var(--aria-accent-fg)' : 'var(--aria-fg)',
                backgroundColor: isActive ? 'var(--aria-accent)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
