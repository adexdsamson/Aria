/**
 * Plan 02-01 Task 3 — IntegrationsSection (Gmail row) tests.
 *
 * Covers the four UI states (disconnected / connected-ok / connected-expired /
 * connected-revoked), the pre-OAuth disclosure modal flow, and the SC3 mechanic
 * that the EMAIL-07 banner does not hide adjacent integration rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IntegrationsSection,
  EMAIL_07_EXPIRED_COPY,
  EMAIL_07_REVOKED_COPY,
  PRE_OAUTH_DISCLOSURE,
} from '../../../../../src/renderer/features/settings/IntegrationsSection';
import type { GmailIntegrationStatus } from '../../../../../src/shared/ipc-contract';

interface AriaStub {
  gmailStatus: ReturnType<typeof vi.fn>;
  gmailConnect: ReturnType<typeof vi.fn>;
  gmailDisconnect: ReturnType<typeof vi.fn>;
  gmailForceSync: ReturnType<typeof vi.fn>;
  calendarStatus: ReturnType<typeof vi.fn>;
  calendarConnect: ReturnType<typeof vi.fn>;
  calendarDisconnect: ReturnType<typeof vi.fn>;
  calendarForceSync: ReturnType<typeof vi.fn>;
  // Phase 6 added a Todoist row inside IntegrationsSection; it polls on mount.
  todoistStatus: ReturnType<typeof vi.fn>;
  todoistConnectToken: ReturnType<typeof vi.fn>;
  todoistDisconnect: ReturnType<typeof vi.fn>;
  todoistForceSync: ReturnType<typeof vi.fn>;
  // Phase 7 embedded RagDisconnectedSection inside IntegrationsSection; both
  // of these run on mount as well.
  ragAccountChunkCounts: ReturnType<typeof vi.fn>;
  ragWipeAccount: ReturnType<typeof vi.fn>;
  providerAccountsList: ReturnType<typeof vi.fn>;
  providerAccountDisconnect: ReturnType<typeof vi.fn>;
}

function installAria(initial: GmailIntegrationStatus): AriaStub {
  const stub: AriaStub = {
    gmailStatus: vi.fn().mockResolvedValue(initial),
    gmailConnect: vi.fn().mockResolvedValue({ ok: true, email: initial.email ?? 'foo@bar.com' }),
    gmailDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    gmailForceSync: vi.fn().mockResolvedValue({ ok: true }),
    // Plan 02-02: the Calendar row also polls; default to disconnected so the
    // Gmail-focused cases here behave identically pre-/post-merge.
    calendarStatus: vi
      .fn()
      .mockResolvedValue({ connected: false, tokenStatus: 'missing', queueDepth: 0 }),
    calendarConnect: vi.fn().mockResolvedValue({ ok: true, email: 'cal@bar.com' }),
    calendarDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    calendarForceSync: vi.fn().mockResolvedValue({ ok: true }),
    todoistStatus: vi
      .fn()
      .mockResolvedValue({ connected: false, tokenStatus: 'missing', queueDepth: 0 }),
    todoistConnectToken: vi.fn().mockResolvedValue({ ok: true }),
    todoistDisconnect: vi.fn().mockResolvedValue({ ok: true }),
    todoistForceSync: vi.fn().mockResolvedValue({ ok: true }),
    ragAccountChunkCounts: vi.fn().mockResolvedValue({ rows: [] }),
    ragWipeAccount: vi.fn().mockResolvedValue({ deletedChunks: 0 }),
    providerAccountsList: vi.fn().mockResolvedValue({ rows: [] }),
    providerAccountDisconnect: vi.fn().mockResolvedValue({ ok: true }),
  };
  // jsdom global
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

describe('IntegrationsSection (Gmail row)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    // Reset window.aria after each test.
    (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
  });

  it('Case 1 — disconnected: renders Connect Gmail button; no banner; no email', async () => {
    installAria({ connected: false, tokenStatus: 'missing', queueDepth: 0 });
    render(<IntegrationsSection />);
    expect(await screen.findByTestId('gmail-connect-btn')).toBeTruthy();
    expect(screen.queryByTestId('email07-banner-expired')).toBeNull();
    expect(screen.queryByTestId('email07-banner-revoked')).toBeNull();
    expect(screen.queryByTestId('gmail-email')).toBeNull();
  });

  it('Case 2 — connected ok: renders email + Sync now + Disconnect; NO banner', async () => {
    installAria({
      connected: true,
      email: 'foo@bar.com',
      tokenStatus: 'ok',
      queueDepth: 0,
      lastSyncedAt: new Date().toISOString(),
    });
    render(<IntegrationsSection />);
    expect((await screen.findByTestId('gmail-email')).textContent).toBe('foo@bar.com');
    expect(screen.getByTestId('gmail-sync-now-btn')).toBeTruthy();
    expect(screen.getByTestId('gmail-disconnect-btn')).toBeTruthy();
    expect(screen.queryByTestId('email07-banner-expired')).toBeNull();
    expect(screen.queryByTestId('email07-banner-revoked')).toBeNull();
  });

  it('Case 3 — connected expired: renders EMAIL-07 banner with locked copy + Reconnect button', async () => {
    installAria({
      connected: true,
      email: 'foo@bar.com',
      tokenStatus: 'expired',
      queueDepth: 0,
      lastError: 'token-expired',
    });
    render(<IntegrationsSection />);
    const banner = await screen.findByTestId('email07-banner-expired');
    expect(banner.textContent).toContain(EMAIL_07_EXPIRED_COPY);
    // The Reconnect button lives inside the banner.
    const reconnect = banner.querySelector('button');
    expect(reconnect?.textContent).toBe('Reconnect');
  });

  it('Case 4 — connected revoked: renders EMAIL-07 revoked variant copy', async () => {
    installAria({
      connected: true,
      email: 'foo@bar.com',
      tokenStatus: 'revoked',
      queueDepth: 0,
      lastError: 'token-revoked',
    });
    render(<IntegrationsSection />);
    const banner = await screen.findByTestId('email07-banner-revoked');
    expect(banner.textContent).toContain(EMAIL_07_REVOKED_COPY);
  });

  it('Case 5 — pre-OAuth modal: Cancel does NOT call gmailConnect; Continue calls it exactly once', async () => {
    const stub = installAria({ connected: false, tokenStatus: 'missing', queueDepth: 0 });
    const user = userEvent.setup();
    render(<IntegrationsSection />);

    const connectBtn = await screen.findByTestId('gmail-connect-btn');
    await user.click(connectBtn);

    const modal = await screen.findByTestId('pre-oauth-modal');
    expect(modal.textContent).toContain(PRE_OAUTH_DISCLOSURE);

    // Cancel path
    await user.click(screen.getByTestId('pre-oauth-cancel'));
    expect(stub.gmailConnect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pre-oauth-modal')).toBeNull();

    // Continue path
    await user.click(await screen.findByTestId('gmail-connect-btn'));
    await user.click(await screen.findByTestId('pre-oauth-continue'));
    await waitFor(() => expect(stub.gmailConnect).toHaveBeenCalledTimes(1));
  });

  it('Case 6 — SC3 mechanic: expired Gmail banner does not visually hide the Gmail email/header', async () => {
    installAria({
      connected: true,
      email: 'foo@bar.com',
      tokenStatus: 'expired',
      queueDepth: 0,
      lastError: 'token-expired',
    });
    render(<IntegrationsSection />);
    // Gmail row header is still visible alongside the EMAIL-07 banner; this is
    // the SC3 mechanic for the Gmail half (Calendar half lands in Plan 02-02).
    const row = await screen.findByTestId('integration-row-gmail');
    const banner = screen.getByTestId('email07-banner-expired');
    expect(row.contains(banner)).toBe(true);
    expect(row.querySelector('h3')?.textContent).toBe('Gmail');
    expect((screen.getByTestId('gmail-email')).textContent).toBe('foo@bar.com');
  });
});
