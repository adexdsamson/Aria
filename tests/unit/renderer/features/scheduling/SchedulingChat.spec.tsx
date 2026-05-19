/**
 * Plan 04-03 Task 2 — SchedulingChat surface tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulingChat } from '../../../../../src/renderer/features/scheduling/SchedulingChat';

interface AriaStub {
  schedulingPropose: ReturnType<typeof vi.fn>;
  schedulingConfirmTarget: ReturnType<typeof vi.fn>;
}

function installAria(stub: Partial<AriaStub>): AriaStub {
  const s: AriaStub = {
    schedulingPropose: vi.fn(),
    schedulingConfirmTarget: vi.fn(),
    ...stub,
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = s;
  return s;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('SchedulingChat', () => {
  it('(a) ProposeResult renders success message', async () => {
    installAria({
      schedulingPropose: vi.fn().mockResolvedValue({
        approvalId: 'app-1',
        primaryFeasible: true,
        conflicts: [],
        alternatives: [],
        warnings: [],
      }),
    });
    const user = userEvent.setup();
    render(<SchedulingChat />);
    await user.type(screen.getByTestId('scheduling-nl-input'), 'move my 3pm to Thursday');
    await user.click(screen.getByTestId('scheduling-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('scheduling-success')).toBeTruthy();
    });
    expect(screen.getByTestId('scheduling-success').getAttribute('data-approval-id')).toBe(
      'app-1',
    );
  });

  it('(b) ProposeClarification renders candidate buttons + click fires confirmTarget', async () => {
    const aria = installAria({
      schedulingPropose: vi.fn().mockResolvedValue({
        needsClarification: true,
        candidates: [
          { eventId: 'evA', summary: 'Sync A', startUtc: '2026-05-18T15:00:00.000Z' },
          { eventId: 'evB', summary: 'Sync B', startUtc: '2026-05-18T15:15:00.000Z' },
        ],
      }),
      schedulingConfirmTarget: vi.fn().mockResolvedValue({
        approvalId: 'app-2',
        primaryFeasible: true,
        conflicts: [],
        alternatives: [],
        warnings: [],
      }),
    });
    const user = userEvent.setup();
    render(<SchedulingChat />);
    fireEvent.change(screen.getByTestId('scheduling-nl-input'), {
      target: { value: 'move my 3pm to Thursday' },
    });
    await user.click(screen.getByTestId('scheduling-submit'));
    const candidate = await screen.findByTestId('scheduling-candidate-evA');
    await user.click(candidate);
    await waitFor(() => {
      expect(aria.schedulingConfirmTarget).toHaveBeenCalledWith({
        nl: 'move my 3pm to Thursday',
        eventId: 'evA',
      });
    });
  });

  it('(c) cancel-not-in-v1 refusal renders backend copy when present', async () => {
    installAria({
      schedulingPropose: vi.fn().mockResolvedValue({
        refused: true,
        code: 'cancel-not-in-v1',
        message: 'x',
      }),
    });
    const user = userEvent.setup();
    render(<SchedulingChat />);
    fireEvent.change(screen.getByTestId('scheduling-nl-input'), {
      target: { value: 'cancel my 3pm' },
    });
    await user.click(screen.getByTestId('scheduling-submit'));
    const refusal = await screen.findByTestId('scheduling-refusal');
    expect(refusal.getAttribute('data-code')).toBe('cancel-not-in-v1');
    expect(refusal.textContent).toMatch(/^x$/);
  });

  it('(c2) multi-attendee refusal falls back when backend copy is empty', async () => {
    installAria({
      schedulingPropose: vi.fn().mockResolvedValue({
        refused: true,
        code: 'multi-attendee',
        message: '',
      }),
    });
    const user = userEvent.setup();
    render(<SchedulingChat />);
    fireEvent.change(screen.getByTestId('scheduling-nl-input'), {
      target: { value: 'move team standup' },
    });
    await user.click(screen.getByTestId('scheduling-submit'));
    const refusal = await screen.findByTestId('scheduling-refusal');
    expect(refusal.getAttribute('data-code')).toBe('multi-attendee');
    expect(refusal.textContent).toMatch(/Multi-attendee/);
  });
});
