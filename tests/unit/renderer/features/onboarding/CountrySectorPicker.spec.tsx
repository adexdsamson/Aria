/**
 * Plan 02-03 Task 2 — CountrySectorPicker (H5) tests.
 *
 * Covers:
 *   1. After MnemonicConfirm completes, the wizard advances to the picker
 *      (not directly to password / completion).
 *   2. Picker renders a country select (default 'NG') + 4 sector checkboxes.
 *   3. Submit calls `window.aria.newsSetBundle({country, sectors})` exactly
 *      once with the exact args.
 *   4. Selecting a non-NG country shows the "more countries coming soon" hint
 *      AND Submit still works (fires the IPC; backend would seed zero rows).
 *   5. Submit advances the wizard to the password (next) step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingWizard } from '../../../../../src/renderer/features/onboarding/OnboardingWizard';
import {
  CountrySectorPicker,
  MORE_COUNTRIES_HINT,
} from '../../../../../src/renderer/features/onboarding/CountrySectorPicker';

interface AriaStub {
  onboardingGenMnemonic: ReturnType<typeof vi.fn>;
  onboardingConfirm: ReturnType<typeof vi.fn>;
  onboardingSeal: ReturnType<typeof vi.fn>;
  onboardingUnlock: ReturnType<typeof vi.fn>;
  onboardingStatus: ReturnType<typeof vi.fn>;
  newsSetBundle: ReturnType<typeof vi.fn>;
}

const WORDS =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'.split(' ');
const POSITIONS = [0, 4, 11];

function installAria(): AriaStub {
  const stub: AriaStub = {
    onboardingGenMnemonic: vi.fn().mockResolvedValue({
      mnemonic: WORDS.join(' '),
      positions: POSITIONS,
    }),
    onboardingConfirm: vi.fn().mockResolvedValue({ ok: true }),
    onboardingSeal: vi.fn().mockResolvedValue({ ok: true }),
    onboardingUnlock: vi.fn().mockResolvedValue({ ok: true }),
    onboardingStatus: vi.fn().mockResolvedValue({ sealed: false, unlocked: false }),
    newsSetBundle: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

async function advanceThroughMnemonic(): Promise<void> {
  // Step 1: MnemonicShow — tick the ack checkbox, then click Continue.
  const ack = await screen.findByTestId('mnemonic-ack');
  fireEvent.click(ack);
  await act(async () => {
    fireEvent.click(screen.getByTestId('mnemonic-continue'));
  });

  // Step 2: MnemonicConfirm — fill 3 inputs with the right words, submit.
  const inputs = await screen.findAllByTestId(/confirm-input-\d/);
  for (let i = 0; i < POSITIONS.length; i++) {
    fireEvent.change(inputs[i], { target: { value: WORDS[POSITIONS[i]] } });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId('confirm-submit'));
  });
}

describe('CountrySectorPicker (H5)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
  });

  it('Case 1 — wizard advances to picker after MnemonicConfirm (not to password)', async () => {
    installAria();
    render(<OnboardingWizard onComplete={() => undefined} />);
    await advanceThroughMnemonic();

    expect(await screen.findByTestId('onboarding-news-picker')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-password')).toBeNull();
  });

  it('Case 2 — picker renders country select (default NG) + 4 sector checkboxes', async () => {
    render(<CountrySectorPicker onSubmitted={() => undefined} />);
    const select = await screen.findByTestId('news-country-select');
    expect((select as HTMLSelectElement).value).toBe('NG');
    for (const id of ['gov', 'finance', 'tech', 'energy']) {
      expect(screen.getByTestId(`news-sector-${id}`)).toBeTruthy();
    }
  });

  it('Case 3 — submit fires newsSetBundle({country:"NG", sectors:["gov","finance"]}) exactly once', async () => {
    const stub = installAria();
    const onSubmitted = vi.fn();
    render(<CountrySectorPicker onSubmitted={onSubmitted} />);

    // Defaults already select gov + finance. Click Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    await waitFor(() => {
      expect(stub.newsSetBundle).toHaveBeenCalledTimes(1);
    });
    expect(stub.newsSetBundle).toHaveBeenCalledWith({
      country: 'NG',
      sectors: ['gov', 'finance'],
    });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });

  it('Case 4 — selecting US shows "more countries coming soon" hint AND Submit still fires the IPC', async () => {
    const stub = installAria();
    render(<CountrySectorPicker onSubmitted={() => undefined} />);
    const select = await screen.findByTestId('news-country-select');
    fireEvent.change(select, { target: { value: 'US' } });

    expect((await screen.findByTestId('news-more-countries-hint')).textContent).toContain(
      MORE_COUNTRIES_HINT,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    await waitFor(() => expect(stub.newsSetBundle).toHaveBeenCalledTimes(1));
    expect(stub.newsSetBundle).toHaveBeenCalledWith({
      country: 'US',
      sectors: ['gov', 'finance'],
    });
  });

  it('Case 5 — submit advances the wizard to the password step', async () => {
    installAria();
    render(<OnboardingWizard onComplete={() => undefined} />);
    await advanceThroughMnemonic();

    // Picker visible
    expect(await screen.findByTestId('onboarding-news-picker')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    expect(await screen.findByTestId('onboarding-password')).toBeTruthy();
  });
});
