/**
 * Phase 9 Plan 02 — per-route editorial topbar.
 *
 * Eyebrow (mono uppercase gold) + Playfair display title pair; pathname-driven
 * title map mirrors design-ref/project/app-shell.jsx lines 233-245 verbatim.
 *
 * The right cluster is: ⌘K trigger button → bell (decorative, D-06) → Avatar.
 * The ⌘K trigger dispatches a global `aria:cmdk-toggle` CustomEvent that
 * CommandPalette listens for in addition to its native keydown handler.
 */
import { useLocation } from 'react-router-dom';
import { KbdHint } from './editorial';
import { AvatarMenu } from './AvatarMenu';

export interface TopbarProps {
  /** Fired after the user logs out via the avatar menu. */
  onLocked?: () => void;
}

interface TitlePair {
  eyebrow: string;
  title: string;
}

function formatTodayLong(now: Date = new Date()): string {
  try {
    // "Tuesday 20 May" — locale-aware via Intl.DateTimeFormat.
    const fmt = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return fmt.format(now);
  } catch {
    return now.toDateString();
  }
}

function isoWeekLabel(now: Date = new Date()): string {
  // "Week of 17 May" — matches the design-ref calendar masthead.
  try {
    return `Week of ${new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'long',
    }).format(now)}`;
  } catch {
    return 'This week';
  }
}

function titleForPath(pathname: string): TitlePair {
  const today = formatTodayLong();
  const weekOf = isoWeekLabel();
  const map: Record<string, TitlePair> = {
    briefing: { eyebrow: `The Morning · ${today}`, title: "Today's Briefing" },
    approvals: { eyebrow: 'Approval queue', title: 'Awaiting your call' },
    calendar: { eyebrow: 'Unified calendar', title: weekOf },
    meetings: { eyebrow: 'Meeting capture', title: 'Transcripts & action items' },
    tasks: { eyebrow: 'Tasks', title: 'Todoist + meeting actions' },
    scheduling: { eyebrow: 'Scheduling', title: 'Tell Aria what to move' },
    ask: { eyebrow: 'Ask Aria', title: 'Cited Q&A over your data' },
    recap: { eyebrow: 'Weekly recap', title: 'The week in brief' },
    settings: { eyebrow: 'Settings', title: 'Preferences & status' },
    'routing-log': { eyebrow: 'Diagnostics', title: 'Routing log' },
  };
  // Strip leading slash + take first segment.
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  return map[seg] ?? map.briefing;
}

export function emitCmdKToggle(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('aria:cmdk-toggle'));
}

export function Topbar({ onLocked }: TopbarProps = {}): JSX.Element {
  const location = useLocation();
  const { eyebrow, title } = titleForPath(location.pathname);

  return (
    <div
      data-testid="aria-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 24px',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--ivory)',
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          data-testid="aria-topbar-eyebrow"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          {eyebrow}
        </div>
        <div
          data-testid="aria-topbar-title"
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
            marginTop: 2,
          }}
        >
          {title}
        </div>
      </div>

      <button
        type="button"
        data-testid="aria-topbar-cmdk"
        onClick={emitCmdKToggle}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          color: 'var(--gray)',
          fontSize: 12.5,
        }}
      >
        <span style={{ minWidth: 180 }}>Ask Aria</span>
        <KbdHint>⌘K</KbdHint>
      </button>

      {/* Bell — decorative, non-interactive per D-06. */}
      <span
        aria-hidden="true"
        data-testid="aria-topbar-bell"
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          color: 'var(--gray)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span
          style={{
            position: 'absolute',
            top: 7,
            right: 8,
            width: 6,
            height: 6,
            borderRadius: 50,
            background: 'var(--gold)',
          }}
        />
      </span>

      <AvatarMenu initials="EV" onLocked={onLocked} />
    </div>
  );
}
