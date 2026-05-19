import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AccountChip } from '../../../../src/renderer/components/AccountChip';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('AccountChip', () => {
  it('renders provider icon, color, label, and full email tooltip from an account row', () => {
    render(
      <AccountChip
        account={{
          providerKey: 'microsoft',
          accountId: 'exec@example.com',
          displayEmail: 'exec@example.com',
          displayLabel: 'Executive Outlook',
          displayColor: '#2563eb',
          status: 'ok',
        }}
      />,
    );

    const chip = screen.getByTestId('account-chip-neutral');
    expect(chip.textContent).toContain('M');
    expect(chip.textContent).toContain('Executive Outlook');
    expect(chip.getAttribute('title')).toBe('exec@example.com');
    expect(screen.getByTestId('account-chip-color-neutral').getAttribute('data-color')).toBe(
      '#2563eb',
    );
  });

  it('fetches provider_account by account id and falls back to email handle', async () => {
    (globalThis as unknown as { window: { aria: { providerAccountsList: ReturnType<typeof vi.fn> } } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({
        rows: [
          {
            providerKey: 'google',
            accountId: 'found@example.com',
            displayEmail: 'found@example.com',
            displayLabel: null,
            displayColor: '#16a34a',
            status: 'ok',
          },
        ],
      }),
    };

    render(<AccountChip providerKey="google" accountId="found@example.com" />);
    expect(screen.getByTestId('account-chip-google-found@example.com').textContent).toContain(
      'Loading account',
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-chip-google-found@example.com').textContent).toContain(
        'found',
      );
    });
    expect(screen.getByTestId('account-chip-google-found@example.com').getAttribute('title')).toBe(
      'found@example.com',
    );
  });

  it('renders a greyed missing chip when account lookup misses', async () => {
    (globalThis as unknown as { window: { aria: { providerAccountsList: ReturnType<typeof vi.fn> } } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({ rows: [] }),
    };

    render(<AccountChip providerKey="microsoft" accountId="missing@example.com" />);

    await waitFor(() => {
      const chip = screen.getByTestId('account-chip-microsoft-missing@example.com');
      expect(chip.getAttribute('data-state')).toBe('missing');
      expect(chip.textContent).toContain('missing');
    });
  });
});
