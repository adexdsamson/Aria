/**
 * Global toast surface.
 *
 * Mounted once at the AppShell layer. Subscribes to the `aria:toast` window
 * CustomEvent that helpers (entitlement-actions, future surfaces) dispatch
 * via {@link emitToast}. Renders a vertical stack of editorial-styled cards
 * in the bottom-right and auto-dismisses each after `duration` ms.
 *
 * Design — matches Topbar / Avatar editorial language: ivory paper card,
 * 1px rule border, gold accent for success, muted ink for info, ink-on-paper
 * for errors. No dependency on shadcn or 3rd-party toast libs (consistent
 * with the rest of Aria's hand-built UI primitives).
 */
import { useEffect, useState } from 'react';
import { setToastImpl, type ToastKind } from '../lib/entitlement-actions';

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastEventDetail {
  kind: ToastKind;
  message: string;
  /** Override default 4500ms auto-dismiss. */
  duration?: number;
}

/** Public helper — any module can fire a toast without importing the host. */
export function emitToast(kind: ToastKind, message: string, duration?: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastEventDetail>('aria:toast', {
      detail: { kind, message, duration },
    }),
  );
}

const DEFAULT_DURATION = 4500;

export function ToastHost(): JSX.Element {
  const [entries, setEntries] = useState<ToastEntry[]>([]);

  useEffect(() => {
    let nextId = 1;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    function push(detail: ToastEventDetail): void {
      const id = nextId++;
      setEntries((prev) => [...prev, { id, kind: detail.kind, message: detail.message }]);
      const t = setTimeout(() => {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        timers.delete(id);
      }, detail.duration ?? DEFAULT_DURATION);
      timers.set(id, t);
    }

    function onEvent(e: Event): void {
      const ce = e as CustomEvent<ToastEventDetail>;
      if (!ce.detail || typeof ce.detail.message !== 'string') return;
      push(ce.detail);
    }

    // Wire the entitlement-actions toast surface to this host so existing
    // toast() calls light up the UI instead of console.log fallback.
    setToastImpl({
      show(kind, message) {
        push({ kind, message });
      },
    });

    window.addEventListener('aria:toast', onEvent);
    return () => {
      window.removeEventListener('aria:toast', onEvent);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      // Restore console fallback so unmounted-state toasts aren't silently dropped.
      setToastImpl({
        show(kind, message) {
          // eslint-disable-next-line no-console
          console[kind === 'error' ? 'error' : 'log'](`[${kind}] ${message}`);
        },
      });
    };
  }, []);

  function dismiss(id: number): void {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  if (entries.length === 0) {
    return <div data-testid="aria-toast-host" aria-live="polite" />;
  }

  return (
    <div
      data-testid="aria-toast-host"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 9000,
        pointerEvents: 'none',
      }}
    >
      {entries.map((e) => (
        <div
          key={e.id}
          role={e.kind === 'error' ? 'alert' : 'status'}
          data-testid={`aria-toast-${e.kind}`}
          style={{
            pointerEvents: 'auto',
            minWidth: 260,
            maxWidth: 380,
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: `1px solid ${e.kind === 'error' ? 'var(--ink)' : 'var(--rule)'}`,
            borderLeft: `3px solid ${
              e.kind === 'success'
                ? 'var(--gold)'
                : e.kind === 'error'
                  ? 'var(--ink)'
                  : 'var(--gray)'
            }`,
            borderRadius: 6,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontFamily: 'var(--f-sans)',
            fontSize: 13,
            lineHeight: 1.4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color:
                e.kind === 'success'
                  ? 'var(--gold)'
                  : e.kind === 'error'
                    ? 'var(--ink)'
                    : 'var(--gray)',
              marginTop: 1,
              minWidth: 48,
            }}
          >
            {e.kind}
          </span>
          <span style={{ flex: 1 }}>{e.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            data-testid={`aria-toast-dismiss-${e.id}`}
            onClick={() => dismiss(e.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: 'var(--gray)',
              fontSize: 14,
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
