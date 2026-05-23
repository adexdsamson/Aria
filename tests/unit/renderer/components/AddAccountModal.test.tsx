import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAccountModal } from '../../../../src/renderer/components/AddAccountModal';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('AddAccountModal', () => {
  it('offers Microsoft, Google, and Todoist and invokes selected IPC', async () => {
    const aria = {
      microsoftConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@contoso.com', displayName: 'User' }),
      gmailConnect: vi.fn().mockResolvedValue({ ok: true, email: 'user@gmail.com' }),
      todoistConnectToken: vi.fn().mockResolvedValue({ ok: true }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<AddAccountModal open onClose={onClose} onConnected={onConnected} />);

    // All three providers are listed (260523-a5w).
    expect(screen.getByText('Microsoft Outlook / M365')).toBeTruthy();
    expect(screen.getByText(/Google.*Gmail \+ Calendar/)).toBeTruthy();
    expect(screen.getByText('Todoist')).toBeTruthy();

    // Default selection is Microsoft — clicking Continue should hit microsoftConnect only.
    await user.click(screen.getByTestId('add-account-connect'));

    await waitFor(() => expect(aria.microsoftConnect).toHaveBeenCalledTimes(1));
    expect(aria.gmailConnect).not.toHaveBeenCalled();
    expect(aria.todoistConnectToken).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selecting Todoist and pasting a token calls todoistConnectToken and closes', async () => {
    const aria = {
      microsoftConnect: vi.fn(),
      gmailConnect: vi.fn(),
      todoistConnectToken: vi.fn().mockResolvedValue({ ok: true }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<AddAccountModal open onClose={onClose} onConnected={onConnected} />);

    // Pick the Todoist radio.
    const todoistRadio = screen.getByRole('radio', { name: /Todoist/i });
    await user.click(todoistRadio);

    // Token input is now present; paste a token and click the Todoist-specific connect button.
    const tokenInput = await screen.findByTestId('add-account-todoist-token');
    await user.type(tokenInput, 'todoist-pat-secret-token');
    await user.click(screen.getByTestId('add-account-todoist-connect'));

    await waitFor(() =>
      expect(aria.todoistConnectToken).toHaveBeenCalledWith({ token: 'todoist-pat-secret-token' }),
    );
    expect(aria.microsoftConnect).not.toHaveBeenCalled();
    expect(aria.gmailConnect).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Todoist + empty token surfaces an inline error and does NOT call the IPC', async () => {
    const aria = {
      microsoftConnect: vi.fn(),
      gmailConnect: vi.fn(),
      todoistConnectToken: vi.fn(),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<AddAccountModal open onClose={onClose} onConnected={onConnected} />);

    await user.click(screen.getByRole('radio', { name: /Todoist/i }));
    await user.click(screen.getByTestId('add-account-todoist-connect'));

    expect(aria.todoistConnectToken).not.toHaveBeenCalled();
    expect(await screen.findByTestId('add-account-error')).toBeTruthy();
    expect(onConnected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
