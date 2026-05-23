/**
 * Plan 02-03 Task 2 — CountrySectorPicker (H5) tests.
 *
 * Post-UAT correction: The picker no longer calls `newsSetBundle` directly
 * (DB is not open until after seal). Instead it reports the selection via
 * `onSelected` and the wizard buffers it, persisting post-seal.
 *
 * Covers:
 *   1. After MnemonicConfirm completes, the wizard advances to the picker.
 *   2. Picker renders country select (default 'NG') + 4 sector checkboxes.
 *   3. Submit calls `onSelected({country, sectors})` exactly once and does
 *      NOT call `newsSetBundle` from the picker itself.
 *   4. Selecting a non-NG country shows the "more countries coming soon"
 *      hint AND Submit still fires onSelected with that country.
 *   5. Submit advances the wizard to the password step; after seal succeeds
 *      the wizard calls `newsSetBundle` with the buffered selection.
 *   6. A failing `newsSetBundle` post-seal does NOT block `onComplete`.
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
  profileSet: ReturnType<typeof vi.fn>;
  profileGet: ReturnType<typeof vi.fn>;
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
    profileSet: vi.fn().mockResolvedValue({ ok: true }),
    profileGet: vi.fn().mockResolvedValue({ displayName: null }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

async function advanceThroughMnemonic(): Promise<void> {
  // Quick 260523-eaf — Step 1: NameStep — type a name and Continue.
  const nameInput = await screen.findByTestId('name-input');
  fireEvent.change(nameInput, { target: { value: 'Adex' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('name-submit'));
  });

  // Step 2: MnemonicShow — tick the ack checkbox, then click Continue.
  const ack = await screen.findByTestId('mnemonic-ack');
  fireEvent.click(ack);
  await act(async () => {
    fireEvent.click(screen.getByTestId('mnemonic-continue'));
  });

  // Step 3: MnemonicConfirm — fill 3 inputs with the right words, submit.
  const inputs = await screen.findAllByTestId(/confirm-input-\d/);
  for (let i = 0; i < POSITIONS.length; i++) {
    fireEvent.change(inputs[i], { target: { value: WORDS[POSITIONS[i]] } });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId('confirm-submit'));
  });
}

async function fillPasswordAndSubmit(): Promise<void> {
  const input = await screen.findByTestId('password-input');
  fireEvent.change(input, { target: { value: 'correcthorse' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('password-submit'));
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
    render(<CountrySectorPicker onSelected={() => undefined} />);
    const select = await screen.findByTestId('news-country-select');
    expect((select as HTMLSelectElement).value).toBe('NG');
    for (const id of ['gov', 'finance', 'tech', 'energy']) {
      expect(screen.getByTestId(`news-sector-${id}`)).toBeTruthy();
    }
  });

  it('Case 3 — submit calls onSelected({country:"NG", sectors:["gov","finance"]}) and does NOT call newsSetBundle', async () => {
    const stub = installAria();
    const onSelected = vi.fn();
    render(<CountrySectorPicker onSelected={onSelected} />);

    // Defaults already select gov + finance. Click Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(onSelected).toHaveBeenCalledWith({
      country: 'NG',
      sectors: ['gov', 'finance'],
    });
    // Critical: picker must NOT touch the DB itself — it isn't open yet.
    expect(stub.newsSetBundle).not.toHaveBeenCalled();
  });

  it('Case 4 — selecting US shows hint AND Submit fires onSelected with US', async () => {
    const stub = installAria();
    const onSelected = vi.fn();
    render(<CountrySectorPicker onSelected={onSelected} />);
    const select = await screen.findByTestId('news-country-select');
    fireEvent.change(select, { target: { value: 'US' } });

    expect((await screen.findByTestId('news-more-countries-hint')).textContent).toContain(
      MORE_COUNTRIES_HINT,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(onSelected).toHaveBeenCalledWith({
      country: 'US',
      sectors: ['gov', 'finance'],
    });
    expect(stub.newsSetBundle).not.toHaveBeenCalled();
  });

  it('Case 5 — submit advances wizard to password step; newsSetBundle fires post-seal with buffered selection', async () => {
    const stub = installAria();
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);
    await advanceThroughMnemonic();

    // Picker visible
    expect(await screen.findByTestId('onboarding-news-picker')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });

    expect(await screen.findByTestId('onboarding-password')).toBeTruthy();
    // newsSetBundle MUST NOT have been called yet — DB isn't open.
    expect(stub.newsSetBundle).not.toHaveBeenCalled();

    await fillPasswordAndSubmit();

    await waitFor(() => expect(stub.onboardingSeal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stub.newsSetBundle).toHaveBeenCalledTimes(1));
    expect(stub.newsSetBundle).toHaveBeenCalledWith({
      country: 'NG',
      sectors: ['gov', 'finance'],
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('Case 6 — failing newsSetBundle post-seal does NOT block onComplete', async () => {
    const stub = installAria();
    stub.newsSetBundle.mockResolvedValueOnce({ ok: false });
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);
    await advanceThroughMnemonic();

    await act(async () => {
      fireEvent.click(screen.getByTestId('news-picker-submit'));
    });
    await fillPasswordAndSubmit();

    await waitFor(() => expect(stub.newsSetBundle).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
