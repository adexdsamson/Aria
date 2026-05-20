/**
 * Plan 08-03 Task 5 — LearnedPreferencesSection tests.
 *
 *   - Reachability (L-04-04): SettingsScreen.tsx imports the section
 *   - Tree-view renders fields with current values
 *   - Per-field Reset: 3-assertion DisconnectConfirmDialog pattern
 *       a. clicking Reset opens dialog; does NOT fire IPC yet
 *       b. Cancel preserves; IPC still not fired
 *       c. Confirm dispatches LEARN_RESET_FIELD
 *   - Reset all: same 3-assertion shape on LEARN_RESET_ALL
 *   - Signal log sub-page: paginated read-only list
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearnedPreferencesSection } from '../../../../../src/renderer/features/settings/LearnedPreferencesSection';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AriaStub {
  learnGetPrefs: ReturnType<typeof vi.fn>;
  learnResetField: ReturnType<typeof vi.fn>;
  learnResetAll: ReturnType<typeof vi.fn>;
  learnListSignals: ReturnType<typeof vi.fn>;
}

function installAria(): AriaStub {
  const stub: AriaStub = {
    learnGetPrefs: vi.fn().mockResolvedValue({
      preferences: {
        voice: { terseness: 0.5, formality: 0.5 },
        briefing: { sectionOrder: ['email'] },
        scheduling: { preferredMeetingLength: 30 },
        triage: { vipDomains: [] },
      },
      signalsCount: 4,
      lastUpdatedAt: '2026-05-20T02:30:00.000Z',
    }),
    learnResetField: vi.fn().mockResolvedValue({ ok: true }),
    learnResetAll: vi.fn().mockResolvedValue({ ok: true }),
    learnListSignals: vi.fn().mockResolvedValue({ rows: [] }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('LearnedPreferencesSection', () => {
  it('Reachability — SettingsScreen.tsx imports LearnedPreferencesSection (L-04-04)', () => {
    const settingsPath = path.resolve(
      __dirname,
      '../../../../../src/renderer/features/settings/SettingsScreen.tsx',
    );
    const src = fs.readFileSync(settingsPath, 'utf8');
    expect(src).toMatch(/import\s*\{\s*LearnedPreferencesSection\s*\}/);
    expect(src).toMatch(/<LearnedPreferencesSection\s*\/>/);
  });

  it('renders tree-view with current value, signals-count, last-updated', async () => {
    installAria();
    render(<LearnedPreferencesSection />);
    await waitFor(() => screen.getByTestId('learn-field-voice.terseness'));
    expect(screen.getByText(/signals seen: 4/)).toBeTruthy();
    expect(screen.getByText(/2026-05-20T02:30/)).toBeTruthy();
  });

  it('Per-field reset: 3-assertion DisconnectConfirmDialog pattern', async () => {
    const stub = installAria();
    render(<LearnedPreferencesSection />);
    await waitFor(() => screen.getByTestId('learn-reset-voice.terseness'));

    // a. Clicking Reset opens dialog; does NOT fire IPC yet.
    await userEvent.click(screen.getByTestId('learn-reset-voice.terseness'));
    expect(screen.getByTestId('disconnect-confirm-learn-field-voice.terseness')).toBeTruthy();
    expect(stub.learnResetField).not.toHaveBeenCalled();

    // b. Cancel preserves; IPC still not fired.
    await userEvent.click(
      screen.getByTestId('disconnect-confirm-cancel-learn-field-voice.terseness'),
    );
    expect(stub.learnResetField).not.toHaveBeenCalled();

    // c. Confirm dispatches LEARN_RESET_FIELD.
    await userEvent.click(screen.getByTestId('learn-reset-voice.terseness'));
    await userEvent.click(
      screen.getByTestId('disconnect-confirm-ok-learn-field-voice.terseness'),
    );
    await waitFor(() => expect(stub.learnResetField).toHaveBeenCalledTimes(1));
    expect(stub.learnResetField).toHaveBeenCalledWith({ fieldPath: 'voice.terseness' });
  });

  it('Reset all: 3-assertion DisconnectConfirmDialog pattern', async () => {
    const stub = installAria();
    render(<LearnedPreferencesSection />);
    await waitFor(() => screen.getByTestId('learn-reset-all'));

    await userEvent.click(screen.getByTestId('learn-reset-all'));
    expect(screen.getByTestId('disconnect-confirm-learn-reset-all')).toBeTruthy();
    expect(stub.learnResetAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('disconnect-confirm-cancel-learn-reset-all'));
    expect(stub.learnResetAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('learn-reset-all'));
    await userEvent.click(screen.getByTestId('disconnect-confirm-ok-learn-reset-all'));
    await waitFor(() => expect(stub.learnResetAll).toHaveBeenCalledTimes(1));
  });

  it('View signal log toggles to the paginated sub-page', async () => {
    const stub = installAria();
    render(<LearnedPreferencesSection />);
    await waitFor(() => screen.getByTestId('learn-view-toggle'));
    await userEvent.click(screen.getByTestId('learn-view-toggle'));
    await waitFor(() => screen.getByTestId('learn-signal-log'));
    expect(stub.learnListSignals).toHaveBeenCalled();
  });
});
