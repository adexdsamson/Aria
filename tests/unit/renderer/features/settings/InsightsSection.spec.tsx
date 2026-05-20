/**
 * Plan 08-01 Task 8 — InsightsSection component tests (core 3).
 *
 *  1. Mounted from SettingsScreen (reachability invariant — L-04-04).
 *  2. Calls window.aria.insightsLatest on mount and insightsRecompute on click.
 *  3. Shows locked-state copy with daysRemaining when gate is locked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InsightsSection } from '../../../../../src/renderer/features/settings/InsightsSection';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AriaStub {
  insightsLatest: ReturnType<typeof vi.fn>;
  insightsRecompute: ReturnType<typeof vi.fn>;
}

function installAria(latest: unknown, recompute: unknown = { ok: true, written: 1, skipped: [] }): AriaStub {
  const stub: AriaStub = {
    insightsLatest: vi.fn().mockResolvedValue(latest),
    insightsRecompute: vi.fn().mockResolvedValue(recompute),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('InsightsSection', () => {
  it('Reachability — SettingsScreen.tsx imports InsightsSection (L-04-04)', () => {
    const settingsPath = path.resolve(
      __dirname,
      '../../../../../src/renderer/features/settings/SettingsScreen.tsx',
    );
    const src = fs.readFileSync(settingsPath, 'utf8');
    expect(src).toMatch(/import\s*\{\s*InsightsSection\s*\}/);
    expect(src).toMatch(/<InsightsSection\s*\/>/);
  });

  it('calls insightsLatest on mount and renders unlocked rows', async () => {
    const stub = installAria({
      state: 'unlocked',
      weekYmd: '2026-05-18',
      rows: [
        { id: 1, kind: 'calendar_load', weekYmd: '2026-05-18', computedAt: 't', payload: {}, sentences: ['Up 50% this week.'], dismissed: false },
      ],
    });
    render(<InsightsSection />);
    await waitFor(() => expect(stub.insightsLatest).toHaveBeenCalled());
    expect(await screen.findByTestId('insight-card-calendar_load')).toBeTruthy();
    expect(screen.getByText('Up 50% this week.')).toBeTruthy();

    // Recompute click → calls insightsRecompute.
    const btn = screen.getByTestId('insights-recompute-btn');
    await act(async () => { await userEvent.click(btn); });
    await waitFor(() => expect(stub.insightsRecompute).toHaveBeenCalled());
  });

  it('renders locked-state copy with daysRemaining', async () => {
    installAria({
      state: 'locked',
      daysRemaining: 7,
      blockedKinds: ['calendar_load', 'response_time'],
    });
    render(<InsightsSection />);
    expect(await screen.findByTestId('insights-locked')).toBeTruthy();
    expect(screen.getByText(/Insights unlock in 7 days/)).toBeTruthy();
    expect(screen.getByTestId('insights-blocked-calendar_load')).toBeTruthy();
  });
});
