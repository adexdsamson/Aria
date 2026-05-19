import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAccountModal } from '../../../../src/renderer/components/AddAccountModal';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('AddAccountModal', () => {
  it('offers Google and Microsoft and invokes selected IPC', async () => {
    const aria = {
      microsoftConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@contoso.com', displayName: 'User' }),
      gmailConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@gmail.com' }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<AddAccountModal open onClose={onClose} onConnected={onConnected} />);

    expect(screen.getByText('Microsoft Outlook / M365')).toBeTruthy();
    expect(screen.getByText('Google Gmail + Calendar')).toBeTruthy();
    await user.click(screen.getByTestId('add-account-connect'));

    await waitFor(() => expect(aria.microsoftConnect).toHaveBeenCalledTimes(1));
    expect(aria.gmailConnect).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
