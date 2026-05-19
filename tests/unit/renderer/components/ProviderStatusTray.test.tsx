import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderStatusTray } from '../../../../src/renderer/components/ProviderStatusTray';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('ProviderStatusTray', () => {
  it('aggregates account status and expands reconnect rows', async () => {
    const microsoftConnect = vi.fn().mockResolvedValue({ ok: true, email: 'boss@example.com', displayName: 'Boss' });
    const providerAccountsList = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            providerKey: 'google',
            accountId: 'ok@example.com',
            displayEmail: 'ok@example.com',
            displayLabel: 'Gmail',
            displayColor: '#16a34a',
            status: 'ok',
          },
          {
            providerKey: 'microsoft',
            accountId: 'boss@example.com',
            displayEmail: 'boss@example.com',
            displayLabel: 'Outlook',
            displayColor: '#2563eb',
            status: 'needs-auth',
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      providerAccountsList,
      microsoftConnect,
      gmailConnect: vi.fn(),
    };

    const user = userEvent.setup();
    render(<ProviderStatusTray />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-status-tray-toggle').textContent).toContain(
        '1 account need attention',
      );
    });
    await user.click(screen.getByTestId('provider-status-tray-toggle'));
    expect(screen.getByTestId('provider-status-row-microsoft-boss@example.com')).toBeTruthy();
    await user.click(screen.getByTestId('provider-reconnect-microsoft-boss@example.com'));
    expect(microsoftConnect).toHaveBeenCalled();
  });
});
