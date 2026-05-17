/**
 * Plan 02-04 Task 3 — BriefingSettingsSection renderer tests (5 cases, M3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BriefingSettingsSection } from '../../../../../src/renderer/features/settings/BriefingSettingsSection';

interface AriaStub {
  briefingGetSettings: ReturnType<typeof vi.fn>;
  briefingSetSettings: ReturnType<typeof vi.fn>;
  briefingHistory: ReturnType<typeof vi.fn>;
  briefingGenerateNow: ReturnType<typeof vi.fn>;
}

function installAria(opts: {
  settings?: { time: string; tz: string };
  lastDate?: string;
} = {}): AriaStub {
  const stub: AriaStub = {
    briefingGetSettings: vi
      .fn()
      .mockResolvedValue(opts.settings ?? { time: '07:00', tz: 'UTC' }),
    briefingSetSettings: vi.fn().mockResolvedValue({ ok: true }),
    briefingHistory: vi
      .fn()
      .mockResolvedValue({
        entries: opts.lastDate
          ? [{ date: opts.lastDate, generatedAt: `${opts.lastDate}T07:00:00.000Z`, route: 'LOCAL', ok: 1 }]
          : [],
      }),
    briefingGenerateNow: vi.fn().mockResolvedValue({ ok: true, date: '2026-05-20' }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('BriefingSettingsSection (M3)', () => {
  it('Case 1 — renders 24 whole-hour <option> elements (00:00 through 23:00)', async () => {
    installAria();
    render(<BriefingSettingsSection />);
    const select = (await screen.findByTestId('briefing-time-select')) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toHaveLength(24);
    expect(opts[0]).toBe('00:00');
    expect(opts[7]).toBe('07:00');
    expect(opts[23]).toBe('23:00');
  });

  it('Case 2 — tz dropdown defaulted to detected tz', async () => {
    installAria();
    render(<BriefingSettingsSection />);
    const tzSelect = (await screen.findByTestId('briefing-tz-select')) as HTMLSelectElement;
    // Default loaded from briefingGetSettings (mocked to UTC).
    expect(tzSelect.value).toBe('UTC');
  });

  it('Case 3 — changing time from 07:00 to 06:00 fires briefingSetSettings once', async () => {
    const stub = installAria({ settings: { time: '07:00', tz: 'UTC' } });
    const user = userEvent.setup();
    render(<BriefingSettingsSection />);
    const select = (await screen.findByTestId('briefing-time-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('07:00'));
    await user.selectOptions(select, '06:00');
    await waitFor(() => {
      expect(stub.briefingSetSettings).toHaveBeenCalledTimes(1);
    });
    expect(stub.briefingSetSettings).toHaveBeenCalledWith({ time: '06:00', tz: 'UTC' });
  });

  it('Case 4 — "Last briefing: <date>" displayed when a row exists', async () => {
    installAria({ lastDate: '2026-05-19' });
    render(<BriefingSettingsSection />);
    const status = await screen.findByTestId('briefing-last-status');
    await waitFor(() => expect(status.textContent).toBe('Last briefing: 2026-05-19'));
  });

  it('Case 5 — M3 reinstantiation cross-reference: SET handler called → e2e covers scheduler.scheduleBriefing replacement', async () => {
    // Unit-level: the renderer dispatch is the only thing we can directly
    // assert here. The actual scheduler.cronRegistry replacement is exercised
    // by the e2e (tests/e2e/briefing.spec.ts case 7) — see test description.
    const stub = installAria({ settings: { time: '07:00', tz: 'UTC' } });
    const user = userEvent.setup();
    render(<BriefingSettingsSection />);
    const select = (await screen.findByTestId('briefing-time-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('07:00'));
    await user.selectOptions(select, '08:00');
    await waitFor(() => expect(stub.briefingSetSettings).toHaveBeenCalledTimes(1));
    // The handler returned ok → "Saved." indicator appears.
    await waitFor(() => expect(screen.queryByTestId('briefing-settings-saved')).toBeTruthy());
  });
});
