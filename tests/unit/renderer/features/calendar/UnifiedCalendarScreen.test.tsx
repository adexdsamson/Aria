import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnifiedCalendarScreen } from '../../../../../src/renderer/features/calendar/UnifiedCalendarScreen';

afterEach(() => {
  cleanup();
  localStorage.clear();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('UnifiedCalendarScreen', () => {
  it('loads all account events and persists account visibility toggle', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({
        rows: [
          {
            providerKey: 'google',
            accountId: 'g@example.com',
            displayEmail: 'g@example.com',
            displayLabel: 'Google',
            displayColor: '#16a34a',
            status: 'ok',
          },
          {
            providerKey: 'microsoft',
            accountId: 'm@example.com',
            displayEmail: 'm@example.com',
            displayLabel: 'Outlook',
            displayColor: '#2563eb',
            status: 'ok',
          },
        ],
      }),
      calendarListEventsRange: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'g-event',
            calendarId: 'primary',
            summary: 'Google event',
            location: null,
            startAtUtc: '2026-05-18T15:00:00.000Z',
            endAtUtc: '2026-05-18T16:00:00.000Z',
            startDate: null,
            endDate: null,
            startTimezone: null,
            status: 'confirmed',
            recurringId: null,
            recurrenceJson: null,
            recurrenceUnsupported: false,
            webLink: null,
            providerKey: 'google',
            accountId: 'g@example.com',
            accountDisplayEmail: 'g@example.com',
          },
          {
            id: 'm-event',
            calendarId: 'primary',
            summary: 'Outlook event',
            location: null,
            startAtUtc: '2026-05-18T17:00:00.000Z',
            endAtUtc: '2026-05-18T18:00:00.000Z',
            startDate: null,
            endDate: null,
            startTimezone: null,
            status: 'confirmed',
            recurringId: null,
            recurrenceJson: null,
            recurrenceUnsupported: false,
            webLink: null,
            providerKey: 'microsoft',
            accountId: 'm@example.com',
            accountDisplayEmail: 'm@example.com',
          },
        ],
      }),
    };
    const user = userEvent.setup();

    render(<UnifiedCalendarScreen />);
    await waitFor(() => expect(screen.getByTestId('calendar-event-g-event')).toBeTruthy());
    expect(screen.getByTestId('calendar-event-m-event')).toBeTruthy();

    const outlookToggle = screen
      .getByTestId('calendar-account-toggle-microsoft-m@example.com')
      .querySelector('input') as HTMLInputElement;
    await user.click(outlookToggle);

    expect(screen.queryByTestId('calendar-event-m-event')).toBeNull();
    expect(localStorage.getItem('aria:calendar:hidden-account-ids')).toContain('m@example.com');
  });
});
