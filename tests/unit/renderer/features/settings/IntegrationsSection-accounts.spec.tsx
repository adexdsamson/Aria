import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsSection } from '../../../../../src/renderer/features/settings/IntegrationsSection';

function installAria() {
  const aria = {
    gmailStatus: vi.fn().mockResolvedValue({ connected: false, tokenStatus: 'missing', queueDepth: 0 }),
    gmailConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@gmail.com' }),
    gmailDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    gmailForceSync: vi.fn().mockResolvedValue({ ok: true }),
    calendarStatus: vi.fn().mockResolvedValue({ connected: false, tokenStatus: 'missing', queueDepth: 0 }),
    calendarConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@gmail.com' }),
    calendarDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    calendarForceSync: vi.fn().mockResolvedValue({ ok: true }),
    microsoftConnect: vi.fn().mockResolvedValue({ ok: true, email: 'ceo@contoso.com', displayName: 'CEO' }),
    providerAccountsList: vi.fn().mockResolvedValue({
      rows: [
        {
          providerKey: 'microsoft',
          accountId: 'acct-1',
          displayEmail: 'ceo@contoso.com',
          displayLabel: 'Work Outlook',
          displayColor: '#2563eb',
          status: 'ok',
        },
        {
          providerKey: 'google',
          accountId: 'gmail',
          displayEmail: 'founder@gmail.com',
          displayLabel: null,
          displayColor: null,
          status: 'needs-auth',
        },
      ],
    }),
    providerAccountDisconnect: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;
  return aria;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('IntegrationsSection provider accounts', () => {
  it('renders one AccountRow per provider account with status and reconnect affordance', async () => {
    installAria();
    render(<IntegrationsSection />);

    expect(await screen.findByTestId('account-row-microsoft-acct-1')).toBeTruthy();
    expect(await screen.findByTestId('account-row-google-gmail')).toBeTruthy();
    expect(screen.getByTestId('account-label-acct-1').textContent).toBe('Work Outlook');
    expect(screen.getByTestId('account-email-acct-1').textContent).toContain('ceo@contoso.com');
    expect(screen.getByTestId('account-status-gmail').textContent).toBe('needs-auth');
    expect(screen.getByTestId('account-reconnect-gmail')).toBeTruthy();
  });

  it('disconnect requires confirmation before calling providerAccountDisconnect (Phase 7 Gap 10)', async () => {
    const aria = installAria();
    const user = userEvent.setup();
    render(<IntegrationsSection />);

    // Initial click opens confirm dialog but MUST NOT fire the IPC.
    await user.click(await screen.findByTestId('account-disconnect-acct-1'));
    expect(await screen.findByTestId('disconnect-confirm-account-acct-1')).toBeTruthy();
    expect(aria.providerAccountDisconnect).not.toHaveBeenCalled();

    // Cancel should leave the account intact.
    await user.click(screen.getByTestId('disconnect-confirm-cancel-account-acct-1'));
    expect(aria.providerAccountDisconnect).not.toHaveBeenCalled();

    // Re-open and confirm — IPC fires now.
    await user.click(screen.getByTestId('account-disconnect-acct-1'));
    await user.click(await screen.findByTestId('disconnect-confirm-ok-account-acct-1'));
    await waitFor(() => expect(aria.providerAccountDisconnect).toHaveBeenCalledWith({
      providerKey: 'microsoft',
      accountId: 'acct-1',
    }));
  });
});
