/**
 * Quick 260523-eaf — NameStep + OnboardingWizard name-flow tests.
 *
 * Covers:
 *   1. NameStep — Continue disabled until trimmed value is non-empty.
 *   2. NameStep — Continue fires onContinue with the trimmed value.
 *   3. OnboardingWizard — `name` is the first step rendered after `loading`.
 *   4. OnboardingWizard — profileSet is invoked during seal() with the
 *      buffered display name, and a failure does not block onComplete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NameStep } from '../../../../../src/renderer/features/onboarding/NameStep';
import { OnboardingWizard } from '../../../../../src/renderer/features/onboarding/OnboardingWizard';

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

async function advanceThroughWizard(name: string): Promise<void> {
  const nameInput = await screen.findByTestId('name-input');
  fireEvent.change(nameInput, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('name-submit'));
  });

  const ack = await screen.findByTestId('mnemonic-ack');
  fireEvent.click(ack);
  await act(async () => {
    fireEvent.click(screen.getByTestId('mnemonic-continue'));
  });

  const inputs = await screen.findAllByTestId(/confirm-input-\d/);
  for (let i = 0; i < POSITIONS.length; i++) {
    fireEvent.change(inputs[i], { target: { value: WORDS[POSITIONS[i]] } });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId('confirm-submit'));
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId('news-picker-submit'));
  });

  const pwd = await screen.findByTestId('password-input');
  fireEvent.change(pwd, { target: { value: 'correcthorse' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('password-submit'));
  });
}

describe('NameStep', () => {
  afterEach(() => {
    cleanup();
  });

  it('Continue is disabled with an empty input', () => {
    render(<NameStep onContinue={() => undefined} />);
    expect((screen.getByTestId('name-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Continue stays disabled when the input is whitespace only', () => {
    render(<NameStep onContinue={() => undefined} />);
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: '   ' } });
    expect((screen.getByTestId('name-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Continue fires onContinue with the trimmed value', () => {
    const onContinue = vi.fn();
    render(<NameStep onContinue={onContinue} />);
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: '  Adex  ' } });
    fireEvent.click(screen.getByTestId('name-submit'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith('Adex');
  });
});

describe('OnboardingWizard — name flow', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
  });

  it('renders NameStep as the first step after loading', async () => {
    installAria();
    render(<OnboardingWizard onComplete={() => undefined} />);
    expect(await screen.findByTestId('onboarding-name')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-show')).toBeNull();
  });

  it('profileSet fires after seal succeeds with the buffered display name', async () => {
    const stub = installAria();
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);
    await advanceThroughWizard('Adex');

    await waitFor(() => expect(stub.onboardingSeal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stub.profileSet).toHaveBeenCalledTimes(1));
    expect(stub.profileSet).toHaveBeenCalledWith({ displayName: 'Adex' });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('failing profileSet post-seal does NOT block onComplete', async () => {
    const stub = installAria();
    stub.profileSet.mockResolvedValueOnce({ ok: false, error: 'WRITE_FAILED' });
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);
    await advanceThroughWizard('Adex');

    await waitFor(() => expect(stub.profileSet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
