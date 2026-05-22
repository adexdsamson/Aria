/**
 * Phase 12 / Plan 12-01 Task 3 — BehaviourSection renderer spec.
 *
 * Three cases per PLAN.md:
 *  (a) mounts and renders 3 toggles reflecting initial values from
 *      backgroundGetPrefs
 *  (b) clicking a toggle fires backgroundSetPrefs with the right patch
 *  (c) error response surfaces the alert row and the toggle reverts to its
 *      prior state
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BehaviourSection } from '../../../src/renderer/features/settings/BehaviourSection';

interface AriaStub {
  backgroundGetPrefs: ReturnType<typeof vi.fn>;
  backgroundSetPrefs: ReturnType<typeof vi.fn>;
}

function installAria(initial?: Partial<{
  autoLaunch: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  firstCloseToastShown: boolean;
}>): AriaStub {
  const prefs = {
    autoLaunch: false,
    closeToTray: true,
    notificationsEnabled: true,
    firstCloseToastShown: false,
    ...initial,
  };
  const stub: AriaStub = {
    backgroundGetPrefs: vi.fn().mockResolvedValue(prefs),
    backgroundSetPrefs: vi.fn().mockImplementation(async (patch: Record<string, boolean>) => ({
      ...prefs,
      ...patch,
    })),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

function checkboxInsideRow(testid: string): HTMLInputElement {
  const row = screen.getByTestId(testid);
  return within(row).getByRole('checkbox', { hidden: true }) as HTMLInputElement;
}

describe('BehaviourSection', () => {
  it('(a) renders 3 toggles with initial values from backgroundGetPrefs', async () => {
    installAria({ autoLaunch: true, closeToTray: false, notificationsEnabled: true });
    render(<BehaviourSection />);
    await waitFor(() => {
      expect(checkboxInsideRow('behaviour-autoLaunch').checked).toBe(true);
    });
    expect(checkboxInsideRow('behaviour-closeToTray').checked).toBe(false);
    expect(checkboxInsideRow('behaviour-notificationsEnabled').checked).toBe(true);
  });

  it('(b) clicking a toggle fires backgroundSetPrefs with the right patch', async () => {
    const stub = installAria({ closeToTray: true });
    const user = userEvent.setup();
    render(<BehaviourSection />);
    const cb = await waitFor(() => {
      const el = checkboxInsideRow('behaviour-closeToTray');
      expect(el.checked).toBe(true);
      return el;
    });
    await user.click(cb);
    await waitFor(() => {
      expect(stub.backgroundSetPrefs).toHaveBeenCalledTimes(1);
    });
    expect(stub.backgroundSetPrefs).toHaveBeenCalledWith({ closeToTray: false });
  });

  it('(c) error response surfaces alert + toggle reverts', async () => {
    const stub = installAria({ autoLaunch: false });
    stub.backgroundSetPrefs.mockResolvedValueOnce({ error: 'invalid-payload' });
    const user = userEvent.setup();
    render(<BehaviourSection />);
    const cb = await waitFor(() => {
      const el = checkboxInsideRow('behaviour-autoLaunch');
      expect(el.checked).toBe(false);
      return el;
    });
    await user.click(cb);
    // Alert surfaces.
    await waitFor(() => {
      expect(screen.queryByTestId('behaviour-error')).toBeTruthy();
    });
    // Toggle reverts to the pre-click value.
    await waitFor(() => {
      expect(checkboxInsideRow('behaviour-autoLaunch').checked).toBe(false);
    });
  });
});
