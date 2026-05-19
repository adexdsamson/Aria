import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RecurrenceUnsupportedPill, useRecurrenceUnsupportedToast } from '../../../../../src/renderer/features/calendar/RecurrenceUnsupportedPill';
import type { CalendarEventDto } from '../../../../../src/shared/ipc-contract';

function event(overrides: Partial<CalendarEventDto> = {}): CalendarEventDto {
  return {
    id: 'ev-1',
    calendarId: 'primary',
    summary: 'Complex recurring event',
    location: null,
    startAtUtc: '2026-05-18T15:00:00.000Z',
    endAtUtc: '2026-05-18T16:00:00.000Z',
    startDate: null,
    endDate: null,
    startTimezone: null,
    status: 'confirmed',
    recurringId: null,
    recurrenceJson: null,
    recurrenceUnsupported: true,
    webLink: 'https://outlook.office.com/calendar/item/1',
    providerKey: 'microsoft',
    accountId: 'boss@example.com',
    accountDisplayEmail: 'boss@example.com',
    ...overrides,
  };
}

function ToastHarness({
  events,
  notify,
}: {
  events: CalendarEventDto[];
  notify: (message: string) => void;
}): JSX.Element {
  useRecurrenceUnsupportedToast(events, notify);
  return <div />;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('RecurrenceUnsupportedPill', () => {
  it('renders C14 pill with webLink for unsupported recurrence events', () => {
    render(<RecurrenceUnsupportedPill event={event()} />);
    const pill = screen.getByTestId('recurrence-unsupported-pill-ev-1') as HTMLAnchorElement;
    expect(pill.textContent).toContain('complex recurrence - see in Outlook');
    expect(pill.href).toBe('https://outlook.office.com/calendar/item/1');
  });

  it('does not render the pill for supported recurrence events', () => {
    render(<RecurrenceUnsupportedPill event={event({ recurrenceUnsupported: false })} />);
    expect(screen.queryByTestId('recurrence-unsupported-pill-ev-1')).toBeNull();
  });

  it('fires the first-detection toast once per account and persists dismissal', () => {
    const notify = vi.fn();
    const { rerender } = render(<ToastHarness events={[event()]} notify={notify} />);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('aria:recurrence-unsupported-toast-shown:boss@example.com')).toBeTruthy();

    rerender(<ToastHarness events={[event({ id: 'ev-2' })]} notify={notify} />);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not fire when localStorage already has the account key', () => {
    localStorage.setItem('aria:recurrence-unsupported-toast-shown:boss@example.com', 'yes');
    const notify = vi.fn();
    render(<ToastHarness events={[event()]} notify={notify} />);
    expect(notify).not.toHaveBeenCalled();
  });
});
