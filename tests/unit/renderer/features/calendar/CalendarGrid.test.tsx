import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CalendarGrid } from '../../../../../src/renderer/features/calendar/CalendarGrid';
import type { CalendarEventDto, ProviderAccountDto } from '../../../../../src/shared/ipc-contract';

const accounts: ProviderAccountDto[] = [
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
];

function event(overrides: Partial<CalendarEventDto>): CalendarEventDto {
  return {
    id: 'ev',
    calendarId: 'primary',
    summary: 'Weekly standup',
    location: null,
    startAtUtc: '2026-05-18T15:00:00.000Z',
    endAtUtc: '2026-05-18T16:00:00.000Z',
    startDate: null,
    endDate: null,
    startTimezone: null,
    status: 'confirmed',
    recurringId: null,
    recurrenceJson: '["RRULE:FREQ=WEEKLY"]',
    recurrenceUnsupported: false,
    webLink: null,
    providerKey: 'google',
    accountId: 'g@example.com',
    accountDisplayEmail: 'g@example.com',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('CalendarGrid', () => {
  it('renders Google and Outlook recurring events with identical tile structure and account chips', () => {
    render(
      <CalendarGrid
        accounts={accounts}
        hiddenAccountIds={new Set()}
        events={[
          event({ id: 'g-standup', providerKey: 'google', accountId: 'g@example.com' }),
          event({ id: 'm-standup', providerKey: 'microsoft', accountId: 'm@example.com' }),
        ]}
      />,
    );

    expect(screen.getByTestId('calendar-event-g-standup').querySelectorAll('strong')).toHaveLength(1);
    expect(screen.getByTestId('calendar-event-m-standup').querySelectorAll('strong')).toHaveLength(1);
    expect(screen.getByTestId('account-chip-google-g@example.com').textContent).toContain('Google');
    expect(screen.getByTestId('account-chip-microsoft-m@example.com').textContent).toContain('Outlook');
  });

  it('hides events for hidden accounts', () => {
    render(
      <CalendarGrid
        accounts={accounts}
        hiddenAccountIds={new Set(['m@example.com'])}
        events={[
          event({ id: 'g-standup', providerKey: 'google', accountId: 'g@example.com' }),
          event({ id: 'm-standup', providerKey: 'microsoft', accountId: 'm@example.com' }),
        ]}
      />,
    );

    expect(screen.getByTestId('calendar-event-g-standup')).toBeTruthy();
    expect(screen.queryByTestId('calendar-event-m-standup')).toBeNull();
  });
});
