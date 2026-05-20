/**
 * Phase 9 Plan 03 — RE-SKINNED. Rose-tinted mono pill matching the
 * design-ref read-only badge palette. Hook behaviour, toast dispatch,
 * and localStorage key preserved.
 */
import { useEffect } from 'react';
import type { CalendarEventDto } from '../../../shared/ipc-contract';

const TOAST_PREFIX = 'aria:recurrence-unsupported-toast-shown:';

export function RecurrenceUnsupportedPill({
  event,
}: {
  event: CalendarEventDto;
}): JSX.Element | null {
  if (!event.recurrenceUnsupported) return null;
  const label = 'complex recurrence - see in Outlook';
  if (event.webLink) {
    return (
      <a
        href={event.webLink}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`recurrence-unsupported-pill-${event.id}`}
        style={pillStyle()}
        title="This recurrence pattern uses features Aria cannot fully represent locally."
      >
        {label}
      </a>
    );
  }
  return (
    <span
      data-testid={`recurrence-unsupported-pill-${event.id}`}
      style={pillStyle()}
      title="This recurrence pattern uses features Aria cannot fully represent locally."
    >
      {label}
    </span>
  );
}

export function useRecurrenceUnsupportedToast(
  events: CalendarEventDto[],
  notify: (message: string) => void = defaultNotify,
): void {
  useEffect(() => {
    const accountIds = Array.from(
      new Set(
        events
          .filter((event) => event.recurrenceUnsupported && event.accountId)
          .map((event) => event.accountId),
      ),
    );
    for (const accountId of accountIds) {
      const key = `${TOAST_PREFIX}${accountId}`;
      if (localStorage.getItem(key)) continue;
      notify(
        "Some Outlook events use recurrence patterns Aria can't fully represent. They'll show with a 'View in Outlook' badge.",
      );
      localStorage.setItem(key, new Date().toISOString());
    }
  }, [events, notify]);
}

function defaultNotify(message: string): void {
  window.dispatchEvent(new CustomEvent('aria:toast', { detail: { message, tone: 'info' } }));
}

function pillStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    padding: '2px 10px',
    background: 'rgba(184,73,58,0.08)',
    color: '#7A2B20',
    border: '1px solid rgba(184,73,58,0.25)',
    fontFamily: 'var(--f-mono)',
    fontSize: 10.5,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    textDecoration: 'none',
  };
}
