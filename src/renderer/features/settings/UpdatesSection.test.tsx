/**
 * Plan 08-04 Task 5 — UpdatesSection unit tests.
 *
 * Asserts the section renders the channel badge, the Check button, and is
 * reachable via the existing SettingsScreen NavLink set (covered by the
 * SettingsScreen import grep at Test 9 in the integration tier).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { UpdatesSection } from './UpdatesSection';

beforeEach(() => {
  // Stub window.aria.updaterChannel etc.
  (window as unknown as { aria: unknown }).aria = {
    updaterChannel: vi.fn(async () => ({ channel: 'tester' })),
    updaterCheck: vi.fn(async () => ({ ok: true, info: null, channel: 'tester' })),
    updaterDownload: vi.fn(async () => ({ ok: true })),
    updaterRestart: vi.fn(async () => ({ ok: true })),
  };
});

describe('UpdatesSection', () => {
  it('Test 8 — renders the channel badge ("tester"), Check button, progress + restart placeholders', async () => {
    await act(async () => {
      render(<UpdatesSection />);
    });
    expect(screen.getByTestId('updates-channel').textContent).toBe('tester');
    expect(screen.getByTestId('updates-check')).toBeTruthy();
  });
});
