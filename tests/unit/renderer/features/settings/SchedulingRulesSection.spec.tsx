/**
 * Plan 04-02 Task 1 — SchedulingRulesSection renderer tests.
 *
 * Covers:
 *   (e) renders with loaded rules
 *   (f) adding a focus block updates state + enables Save
 *   (g) bad advanced-JSON disables Save
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulingRulesSection } from '../../../../../src/renderer/features/settings/SchedulingRulesSection';
import { DEFAULT_RULES } from '../../../../../src/shared/scheduling-rules';

interface AriaStub {
  schedulingRulesGet: ReturnType<typeof vi.fn>;
  schedulingRulesSet: ReturnType<typeof vi.fn>;
}

function installAria(initial: unknown = DEFAULT_RULES): AriaStub {
  const stub: AriaStub = {
    schedulingRulesGet: vi.fn().mockResolvedValue({
      rules: initial,
      timeZone: (initial as { timeZone?: string }).timeZone ?? 'UTC',
      updatedAt: null,
    }),
    schedulingRulesSet: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('SchedulingRulesSection', () => {
  it('(e) renders with loaded rules (default empty state)', async () => {
    installAria();
    render(<SchedulingRulesSection />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-scheduling')).toBeTruthy();
    });
    // Save initially disabled (form not dirty).
    const save = screen.getByTestId('scheduling-save-btn') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Focus blocks list rendered empty.
    expect(screen.getByTestId('focus-blocks-list').children).toHaveLength(0);
  });

  it('(f) adding a focus block enables Save', async () => {
    const stub = installAria();
    const user = userEvent.setup();
    render(<SchedulingRulesSection />);
    await screen.findByTestId('settings-scheduling');
    await user.click(screen.getByTestId('add-focus-block-btn'));
    const save = screen.getByTestId('scheduling-save-btn') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => {
      expect(stub.schedulingRulesSet).toHaveBeenCalledTimes(1);
    });
    const arg = stub.schedulingRulesSet.mock.calls[0][0];
    expect((arg as { rules: { focusBlocks: unknown[] } }).rules.focusBlocks).toHaveLength(1);
  });

  it('(g) invalid advanced JSON disables Save', async () => {
    installAria();
    const user = userEvent.setup();
    render(<SchedulingRulesSection />);
    await screen.findByTestId('settings-scheduling');
    // Open drawer + add a focus block so form is dirty.
    await user.click(screen.getByTestId('add-focus-block-btn'));
    const drawer = screen.getByTestId('advanced-json-drawer') as HTMLDetailsElement;
    drawer.open = true;
    const textarea = screen.getByTestId('advanced-json-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not json {' } });
    expect(screen.getByTestId('advanced-json-error')).toBeTruthy();
    const save = screen.getByTestId('scheduling-save-btn') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
