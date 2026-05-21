/**
 * AvatarMenu — dropdown + logout wiring tests.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { AvatarMenu } from '../AvatarMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Stub window.aria.onboardingLock for these tests.
  (window as unknown as { aria: { onboardingLock: () => Promise<unknown> } }).aria = {
    onboardingLock: vi.fn().mockResolvedValue({ ok: true }),
  } as never;
});

describe('AvatarMenu', () => {
  it('is closed by default and shows the avatar trigger', () => {
    render(<AvatarMenu initials="EV" />);
    expect(screen.getByTestId('aria-topbar-avatar')).toBeInTheDocument();
    expect(screen.queryByTestId('aria-avatar-menu')).not.toBeInTheDocument();
  });

  it('opens the menu on avatar click and shows a Log out item', () => {
    render(<AvatarMenu initials="EV" />);
    fireEvent.click(screen.getByTestId('aria-topbar-avatar'));
    expect(screen.getByTestId('aria-avatar-menu')).toBeInTheDocument();
    expect(screen.getByTestId('aria-avatar-menu-logout')).toHaveTextContent(/log out/i);
  });

  it('Escape closes the menu', () => {
    render(<AvatarMenu initials="EV" />);
    fireEvent.click(screen.getByTestId('aria-topbar-avatar'));
    expect(screen.getByTestId('aria-avatar-menu')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('aria-avatar-menu')).not.toBeInTheDocument();
  });

  it('Log out calls window.aria.onboardingLock and fires onLocked', async () => {
    const onLocked = vi.fn();
    render(<AvatarMenu initials="EV" onLocked={onLocked} />);
    fireEvent.click(screen.getByTestId('aria-topbar-avatar'));
    fireEvent.click(screen.getByTestId('aria-avatar-menu-logout'));
    await waitFor(() => {
      expect(
        (window as unknown as { aria: { onboardingLock: ReturnType<typeof vi.fn> } }).aria
          .onboardingLock,
      ).toHaveBeenCalledTimes(1);
      expect(onLocked).toHaveBeenCalledTimes(1);
    });
  });

  it('does not crash if onLocked is omitted', async () => {
    render(<AvatarMenu initials="EV" />);
    fireEvent.click(screen.getByTestId('aria-topbar-avatar'));
    fireEvent.click(screen.getByTestId('aria-avatar-menu-logout'));
    await waitFor(() => {
      expect(
        (window as unknown as { aria: { onboardingLock: ReturnType<typeof vi.fn> } }).aria
          .onboardingLock,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
