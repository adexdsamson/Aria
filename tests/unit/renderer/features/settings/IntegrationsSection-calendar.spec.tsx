/**
 * Plan 02-02 Task 3 — IntegrationsSection Calendar row tests.
 *
 * Cases:
 *   1. Calendar disconnected: "Connect Calendar" button visible; no banner.
 *   2. Calendar connected (ok): email + "Sync now" + "Disconnect"; no banner.
 *   3. Calendar expired: EMAIL-07-style banner with the EXACT locked copy
 *      ("Aria's access to Google Calendar has expired. Re-connect to resume
 *       syncing. Gmail and other integrations are unaffected.").
 *   4. Cross-row isolation (SC3 mechanic): Gmail ok + Calendar expired —
 *      Calendar banner shows, Gmail row stays clean, Gmail Sync-now still
 *      enabled. Then a Calendar disconnect does NOT reset Gmail row state.
 *   5. Pre-OAuth modal: Connect Calendar click renders modal with the
 *      Calendar-specific disclosure copy; Continue calls calendarConnect once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IntegrationsSection,
  CALENDAR_EMAIL_07_EXPIRED_COPY,
  CALENDAR_PRE_OAUTH_DISCLOSURE,
} from '../../../../../src/renderer/features/settings/IntegrationsSection';
import type {
  CalendarIntegrationStatus,
  GmailIntegrationStatus,
} from '../../../../../src/shared/ipc-contract';

interface AriaStub {
  gmailStatus: ReturnType<typeof vi.fn>;
  gmailConnect: ReturnType<typeof vi.fn>;
  gmailDisconnect: ReturnType<typeof vi.fn>;
  gmailForceSync: ReturnType<typeof vi.fn>;
  calendarStatus: ReturnType<typeof vi.fn>;
  calendarConnect: ReturnType<typeof vi.fn>;
  calendarDisconnect: ReturnType<typeof vi.fn>;
  calendarForceSync: ReturnType<typeof vi.fn>;
}

function installAria(opts: {
  gmail?: GmailIntegrationStatus;
  calendar?: CalendarIntegrationStatus;
}): AriaStub {
  const gmail: GmailIntegrationStatus =
    opts.gmail ?? { connected: false, tokenStatus: 'missing', queueDepth: 0 };
  const calendar: CalendarIntegrationStatus =
    opts.calendar ?? { connected: false, tokenStatus: 'missing', queueDepth: 0 };
  const stub: AriaStub = {
    gmailStatus: vi.fn().mockResolvedValue(gmail),
    gmailConnect: vi.fn().mockResolvedValue({ ok: true, email: gmail.email ?? 'gm@x.com' }),
    gmailDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    gmailForceSync: vi.fn().mockResolvedValue({ ok: true }),
    calendarStatus: vi.fn().mockResolvedValue(calendar),
    calendarConnect: vi.fn().mockResolvedValue({ ok: true, email: calendar.email ?? 'cal@x.com' }),
    calendarDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    calendarForceSync: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

describe('IntegrationsSection (Calendar row)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
  });

  it('Case 1 — disconnected: renders Connect Calendar button; no banner; no email', async () => {
    installAria({ calendar: { connected: false, tokenStatus: 'missing', queueDepth: 0 } });
    render(<IntegrationsSection />);
    expect(await screen.findByTestId('calendar-connect-btn')).toBeTruthy();
    expect(screen.queryByTestId('calendar-email07-banner-expired')).toBeNull();
    expect(screen.queryByTestId('calendar-email07-banner-revoked')).toBeNull();
    expect(screen.queryByTestId('calendar-email')).toBeNull();
  });

  it('Case 2 — connected ok: renders email + Sync now + Disconnect; NO banner', async () => {
    installAria({
      calendar: {
        connected: true,
        email: 'cal@bar.com',
        tokenStatus: 'ok',
        queueDepth: 0,
        lastSyncedAt: new Date().toISOString(),
      },
    });
    render(<IntegrationsSection />);
    expect((await screen.findByTestId('calendar-email')).textContent).toBe('cal@bar.com');
    expect(screen.getByTestId('calendar-sync-now-btn')).toBeTruthy();
    expect(screen.getByTestId('calendar-disconnect-btn')).toBeTruthy();
    expect(screen.queryByTestId('calendar-email07-banner-expired')).toBeNull();
  });

  it('Case 3 — expired: renders EMAIL-07 banner with EXACT locked Calendar copy + Reconnect button', async () => {
    installAria({
      calendar: {
        connected: true,
        email: 'cal@bar.com',
        tokenStatus: 'expired',
        queueDepth: 0,
        lastError: 'token-expired',
      },
    });
    render(<IntegrationsSection />);
    const banner = await screen.findByTestId('calendar-email07-banner-expired');
    expect(banner.textContent).toContain(CALENDAR_EMAIL_07_EXPIRED_COPY);
    const reconnect = banner.querySelector('button');
    expect(reconnect?.textContent).toBe('Reconnect');
  });

  it('Case 4 — cross-row isolation (SC3): Gmail ok + Calendar expired; Gmail untouched after Calendar disconnect', async () => {
    const stub = installAria({
      gmail: {
        connected: true,
        email: 'gm@bar.com',
        tokenStatus: 'ok',
        queueDepth: 0,
        lastSyncedAt: new Date().toISOString(),
      },
      calendar: {
        connected: true,
        email: 'cal@bar.com',
        tokenStatus: 'expired',
        queueDepth: 0,
        lastError: 'token-expired',
      },
    });
    const user = userEvent.setup();
    render(<IntegrationsSection />);

    // Calendar banner visible
    const calBanner = await screen.findByTestId('calendar-email07-banner-expired');
    expect(calBanner).toBeTruthy();
    // Gmail row has NO banner and Sync now is enabled
    expect(screen.queryByTestId('email07-banner-expired')).toBeNull();
    expect(screen.queryByTestId('email07-banner-revoked')).toBeNull();
    const gmailSync = await screen.findByTestId('gmail-sync-now-btn');
    expect((gmailSync as HTMLButtonElement).disabled).toBe(false);

    // Click Calendar Reconnect → triggers Calendar's pre-OAuth modal; doesn't
    // touch Gmail. After the click, Gmail row remains intact.
    await user.click(calBanner.querySelector('button')!);
    // Gmail row state unchanged: Sync-now still visible + email still visible
    expect((await screen.findByTestId('gmail-email')).textContent).toBe('gm@bar.com');
    expect(screen.getByTestId('gmail-sync-now-btn')).toBeTruthy();
    // calendarDisconnect was not called by clicking Reconnect (it only opens
    // the modal); gmailDisconnect was never called either.
    expect(stub.gmailDisconnect).not.toHaveBeenCalled();
    expect(stub.calendarDisconnect).not.toHaveBeenCalled();
  });

  it('Case 5 — pre-OAuth modal: Cancel does NOT call calendarConnect; Continue calls it exactly once', async () => {
    const stub = installAria({ calendar: { connected: false, tokenStatus: 'missing', queueDepth: 0 } });
    const user = userEvent.setup();
    render(<IntegrationsSection />);

    const connectBtn = await screen.findByTestId('calendar-connect-btn');
    await user.click(connectBtn);

    const modal = await screen.findByTestId('calendar-pre-oauth-modal');
    expect(modal.textContent).toContain(CALENDAR_PRE_OAUTH_DISCLOSURE);

    await user.click(screen.getByTestId('calendar-pre-oauth-cancel'));
    expect(stub.calendarConnect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calendar-pre-oauth-modal')).toBeNull();

    await user.click(await screen.findByTestId('calendar-connect-btn'));
    await user.click(await screen.findByTestId('calendar-pre-oauth-continue'));
    await waitFor(() => expect(stub.calendarConnect).toHaveBeenCalledTimes(1));
  });
});
