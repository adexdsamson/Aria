/**
 * AvatarMenu — header avatar with editorial dropdown.
 *
 * Click the avatar to open a small ivory-paper panel with menu items.
 * Minimum item: "Log out" → calls window.aria.onboardingLock() and the
 * onboarding status gate flips back to 'locked' so UnlockScreen reappears.
 *
 * Designed to match Topbar / Avatar editorial language (no shadcn — Aria
 * UI is hand-rolled). No portal: positioned relative to the trigger via
 * absolute layout, with an outside-click listener to dismiss.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './editorial';
import { emitToast } from './ToastHost';

export interface AvatarMenuProps {
  initials?: string;
  /**
   * Called after a successful lock. AppShell uses this to refresh the
   * onboarding gate (which then renders <UnlockScreen/>).
   */
  onLocked?: () => void;
}

export function AvatarMenu({ initials = 'EV', onLocked }: AvatarMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      const t = e.target as Node | null;
      if (wrapRef.current && t && !wrapRef.current.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = (await window.aria.onboardingLock()) as { ok?: boolean; error?: string };
      if (res && res.ok) {
        setOpen(false);
        onLocked?.();
      } else {
        emitToast('error', `Couldn't lock Aria: ${res?.error ?? 'unknown'}`);
      }
    } catch (err) {
      emitToast('error', `Couldn't lock Aria: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setPending(false);
    }
  }, [pending, onLocked]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="aria-topbar-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          borderRadius: '50%',
          display: 'inline-flex',
          // Hairline ring on open for affordance feedback.
          boxShadow: open ? '0 0 0 2px var(--gold)' : 'none',
          transition: 'box-shadow 120ms ease-out',
        }}
      >
        <Avatar initials={initials} size={30} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="aria-avatar-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 200,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
            padding: '6px 0',
            zIndex: 8000,
            fontFamily: 'var(--f-sans)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              padding: '6px 14px 8px',
              borderBottom: '1px solid var(--rule)',
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 9.5,
                fontWeight: 500,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
              }}
            >
              Signed in
            </div>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 14,
                color: 'var(--ink)',
                marginTop: 2,
              }}
            >
              {initials}
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            data-testid="aria-avatar-menu-logout"
            disabled={pending}
            onClick={() => void handleLogout()}
            style={{
              all: 'unset',
              cursor: pending ? 'wait' : 'pointer',
              display: 'block',
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 14px',
              fontSize: 13,
              color: 'var(--ink)',
              opacity: pending ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--ivory)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            {pending ? 'Locking…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
