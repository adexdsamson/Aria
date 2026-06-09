/**
 * R-WA03 → Plan 20-07 Task 2 — AccountRow whatsapp extensions spec.
 *
 * Asserts the three concrete whatsapp-specific edits to AccountRow (PATTERNS.md):
 *   1. Status chip color mapping: needs-auth → #c98a3a, degraded → #b34
 *      (these already exist in chipStyle; this test ensures whatsapp accounts
 *       flow through and produce the correct colors).
 *   2. The Reconnect button dispatches WHATSAPP_LINK when the account is
 *      needs-auth AND providerKey==='whatsapp'.
 *   3. A "Manage groups" link is rendered ONLY for providerKey==='whatsapp'
 *      (and NOT for google/microsoft/todoist accounts).
 *
 * The current AccountRow does NOT have the whatsapp IPC wiring or the
 * "Manage groups" link — this spec RED-fails until Plan 20-07 extends
 * the component.
 *
 * Run: npx vitest run tests/unit/renderer/AccountRow.spec.tsx
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountRow } from '../../../src/renderer/components/AccountRow';
import type { ProviderAccountDto } from '../../../src/shared/ipc-contract';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

const waAccount: ProviderAccountDto = {
  providerKey: 'whatsapp',
  accountId: '+1234567890@s.whatsapp.net',
  displayEmail: '+1234567890',
  displayLabel: 'My WhatsApp',
  displayColor: '#25d366',
  status: 'needs-auth',
  capabilitiesJson: '{"messaging":1}',
  lastError: null,
  lastSyncedAt: null,
};

const waAccountDegraded: ProviderAccountDto = {
  ...waAccount,
  status: 'degraded',
};

const googleAccount: ProviderAccountDto = {
  providerKey: 'google',
  accountId: 'user@gmail.com',
  displayEmail: 'user@gmail.com',
  displayLabel: null,
  displayColor: null,
  status: 'ok',
  capabilitiesJson: '{"email":1}',
  lastError: null,
  lastSyncedAt: null,
};

describe('AccountRow — whatsapp chip color mapping (R-WA03)', () => {
  it('needs-auth status chip renders with color #c98a3a for whatsapp account', () => {
    render(
      <AccountRow
        account={waAccount}
        onDisconnect={vi.fn()}
      />,
    );

    const chip = screen.getByTestId(`account-status-${waAccount.accountId}`);
    const style = (chip as HTMLElement).style;
    // The chip should use #c98a3a for needs-auth
    expect(style.color).toContain('c98a3a');
  });

  it('degraded status chip renders with color #b34 for whatsapp account', () => {
    render(
      <AccountRow
        account={waAccountDegraded}
        onDisconnect={vi.fn()}
      />,
    );

    const chip = screen.getByTestId(`account-status-${waAccountDegraded.accountId}`);
    const style = (chip as HTMLElement).style;
    // The chip should use #b34 for degraded
    expect(style.color).toContain('b34');
  });
});

describe('AccountRow — Reconnect dispatches WHATSAPP_LINK (R-WA03)', () => {
  it('Reconnect button dispatches whatsappLink IPC for whatsapp needs-auth account', async () => {
    const whatsappLink = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as unknown as { window: { aria: { whatsappLink: typeof whatsappLink } } }).window.aria = {
      whatsappLink,
    };

    const user = userEvent.setup();
    render(
      <AccountRow
        account={waAccount}
        onDisconnect={vi.fn()}
      />,
    );

    const reconnectBtn = screen.getByTestId(`account-reconnect-${waAccount.accountId}`);
    await user.click(reconnectBtn);

    expect(whatsappLink).toHaveBeenCalledOnce();
  });
});

describe('AccountRow — "Manage groups" link visible only for whatsapp (R-WA03)', () => {
  it('"Manage groups" link renders for providerKey==="whatsapp"', () => {
    render(
      <AccountRow
        account={{ ...waAccount, status: 'ok' }}
        onDisconnect={vi.fn()}
      />,
    );

    const manageGroups = screen.queryByTestId(`account-manage-groups-${waAccount.accountId}`);
    expect(manageGroups).not.toBeNull();
  });

  it('"Manage groups" link does NOT render for providerKey==="google"', () => {
    render(
      <AccountRow
        account={googleAccount}
        onDisconnect={vi.fn()}
      />,
    );

    const manageGroups = screen.queryByTestId(`account-manage-groups-${googleAccount.accountId}`);
    expect(manageGroups).toBeNull();
  });

  it('"Manage groups" link does NOT render for providerKey==="microsoft"', () => {
    const msAccount: ProviderAccountDto = {
      providerKey: 'microsoft',
      accountId: 'user@contoso.com',
      displayEmail: 'user@contoso.com',
      displayLabel: null,
      displayColor: null,
      status: 'ok',
      capabilitiesJson: '{"email":1}',
      lastError: null,
      lastSyncedAt: null,
    };
    render(
      <AccountRow
        account={msAccount}
        onDisconnect={vi.fn()}
      />,
    );

    const manageGroups = screen.queryByTestId(`account-manage-groups-${msAccount.accountId}`);
    expect(manageGroups).toBeNull();
  });
});
