/**
 * Phase 9 Plan 02 Task 2 — editorial sidebar.
 *
 * Composition mirrors design-ref/project/app-shell.jsx lines 131-207:
 *   AppLogo(sidebar) → ⌘K trigger → Workspace section (8 items) →
 *   System section (2 items) → spacer → footer (first-run + SidebarStatus).
 *
 * Each NavItem is a react-router NavLink rendered with the editorial style:
 *   active → ivory-deep background + 2px gold left rail + gold icon + ink text
 *   idle   → transparent background + gray-soft icon + gray text
 *
 * Badges:
 *   approvals → pending approval count (gold variant)
 *   tasks     → open tasks count (neutral variant)
 *
 * The ⌘K trigger and Topbar's ⌘K button both dispatch the
 * `aria:cmdk-toggle` CustomEvent that CommandPalette listens for.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { AppLogo, KbdHint } from './editorial';
import { SidebarStatus } from './editorial/SidebarStatus';
import { emitCmdKToggle } from './Topbar';

type BadgeColor = 'gold' | 'neutral';

interface ItemDef {
  to: string;
  label: string;
  testid: string;
  icon: ReactNode;
  badge?: number;
  badgeColor?: BadgeColor;
}

// Lightweight inline SVG icons (1.5 stroke, currentColor) — no new dep.
function Ic(d: string): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<string, JSX.Element> = {
  briefing: Ic('M4 5h16M4 9h16M4 13h10M4 17h6'),
  approvals: Ic('M5 12l4 4 10-10'),
  calendar: Ic('M3 8h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 2v4M16 2v4'),
  meetings: Ic('M3 7h13l5 5v5a2 2 0 0 1-2 2H3z M7 11h9 M7 15h6'),
  tasks: Ic('M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'),
  scheduling: Ic('M21 11.5a8.4 8.4 0 0 1-15-5A8.4 8.4 0 0 1 21 11.5z M3 21l3-3'),
  ask: Ic('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  recap: Ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6'),
  settings: Ic('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
  'routing-log': Ic('M9 2v6 M15 2v6 M5 8h14v12H5z M9 12h6 M9 16h6'),
  search: Ic('M21 21l-4.35-4.35 M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z'),
  onboard: Ic('M12 19l9-7-9-7-9 7 9 7z M12 5v14'),
};

function NavItem({ item }: { item: ItemDef }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      data-testid={item.testid}
      style={({ isActive }) => ({
        boxSizing: 'border-box',
        textDecoration: 'none',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 10px',
        borderRadius: 6,
        margin: '1px 0',
        color: isActive ? 'var(--ink)' : 'var(--gray)',
        background: isActive ? 'var(--ivory-deep)' : 'transparent',
        position: 'relative',
        transition: 'background var(--t), color var(--t)',
        fontFamily: 'var(--f-body)',
        fontSize: 13.5,
        fontWeight: isActive ? 500 : 400,
        letterSpacing: '0.005em',
      })}
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: -2,
                top: 6,
                bottom: 6,
                width: 2,
                background: 'var(--gold)',
                borderRadius: 2,
              }}
            />
          ) : null}
          <span
            style={{
              width: 18,
              display: 'inline-flex',
              color: isActive ? 'var(--gold)' : 'var(--gray-soft)',
            }}
          >
            {item.icon}
          </span>
          <span
            style={{
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.label}
          </span>
          {item.badge != null && item.badge > 0 && (
            <span
              data-testid={`${item.testid}-badge`}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.05em',
                padding: '1px 6px',
                borderRadius: 4,
                color:
                  item.badgeColor === 'gold' ? 'var(--gold-deep)' : 'var(--gray)',
                background:
                  item.badgeColor === 'gold'
                    ? 'rgba(184,134,11,0.12)'
                    : 'var(--ivory-deep)',
                border:
                  item.badgeColor === 'gold'
                    ? '1px solid rgba(184,134,11,0.2)'
                    : '1px solid var(--rule)',
              }}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function NavSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={{ marginTop: 14, marginBottom: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '0 12px 6px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
          }}
        >
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function useApprovalsCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.aria.approvalsList();
        if (cancelled || 'error' in res) return;
        // Pending = anything not yet decided. Status "pending" is the gold-badge trigger.
        const rows = (res as { rows?: Array<{ state?: string; status?: string }> }).rows ?? [];
        const pending = rows.filter((r) => (r.state ?? r.status) === 'pending').length;
        setN(pending);
      } catch {
        /* swallow — badge stays 0 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return n;
}

function useTasksOpenCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.aria.tasksList({ completed: false });
        if (cancelled || 'error' in res) return;
        const rows = (res as { rows?: unknown[]; tasks?: unknown[] }).rows
          ?? (res as { tasks?: unknown[] }).tasks
          ?? [];
        setN(rows.length);
      } catch {
        /* swallow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return n;
}

export function SideNav(): JSX.Element {
  const approvals = useApprovalsCount();
  const tasks = useTasksOpenCount();

  const workspace: ItemDef[] = [
    { to: '/briefing', label: 'Briefing', testid: 'sidenav-briefing', icon: ICONS.briefing },
    {
      to: '/approvals',
      label: 'Approvals',
      testid: 'sidenav-approvals',
      icon: ICONS.approvals,
      badge: approvals,
      badgeColor: 'gold',
    },
    { to: '/calendar', label: 'Calendar', testid: 'sidenav-calendar', icon: ICONS.calendar },
    { to: '/meetings', label: 'Meetings', testid: 'sidenav-meetings', icon: ICONS.meetings },
    {
      to: '/tasks',
      label: 'Tasks',
      testid: 'sidenav-tasks',
      icon: ICONS.tasks,
      badge: tasks,
      badgeColor: 'neutral',
    },
    { to: '/scheduling', label: 'Scheduling', testid: 'sidenav-scheduling', icon: ICONS.scheduling },
    { to: '/ask', label: 'Ask Aria', testid: 'sidenav-ask', icon: ICONS.ask },
    { to: '/recap', label: 'Weekly Recap', testid: 'sidenav-recap', icon: ICONS.recap },
  ];
  const system: ItemDef[] = [
    { to: '/settings', label: 'Settings', testid: 'sidenav-settings', icon: ICONS.settings },
    { to: '/routing-log', label: 'Routing log', testid: 'sidenav-routing-log', icon: ICONS['routing-log'] },
  ];

  return (
    <aside
      aria-label="Primary"
      data-testid="sidenav"
      style={{
        width: 256,
        flex: '0 0 256px',
        background: 'var(--ivory)',
        borderRight: '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 12px 12px',
        boxSizing: 'border-box',
        height: '100%',
      }}
    >
      {/* Brand row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 4px 14px' }}>
        <AppLogo variant="sidebar" />
      </div>

      {/* Cmd-K trigger */}
      <button
        type="button"
        data-testid="sidenav-cmdk"
        onClick={emitCmdKToggle}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          color: 'var(--gray)',
          fontSize: 12.5,
          marginBottom: 4,
        }}
      >
        <span style={{ width: 14, display: 'inline-flex', color: 'var(--gold)' }}>{ICONS.search}</span>
        <span style={{ flex: 1 }}>Ask Aria</span>
        <KbdHint>⌘K</KbdHint>
      </button>

      <NavSection label="Workspace">
        {workspace.map((item) => (
          <NavItem key={item.to} item={item} />
        ))}
      </NavSection>

      <NavSection label="System">
        {system.map((item) => (
          <NavItem key={item.to} item={item} />
        ))}
      </NavSection>

      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div
        style={{
          padding: '10px 10px 8px',
          marginTop: 8,
          borderTop: '1px solid var(--rule)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <SidebarStatus />
      </div>
    </aside>
  );
}
