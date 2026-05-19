import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulingChat } from '../../../../../src/renderer/features/scheduling/SchedulingChat';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('SchedulingChat backend refusal copy', () => {
  it('shows backend refusal message first', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      schedulingPropose: vi.fn().mockResolvedValue({
        refused: true,
        code: 'multi-attendee',
        message: 'Graph refused because this meeting has external attendees.',
      }),
      schedulingConfirmTarget: vi.fn(),
    };
    const user = userEvent.setup();

    render(<SchedulingChat />);
    fireEvent.change(screen.getByTestId('scheduling-nl-input'), {
      target: { value: 'move team standup' },
    });
    await user.click(screen.getByTestId('scheduling-submit'));

    expect((await screen.findByTestId('scheduling-refusal')).textContent).toContain(
      'Graph refused because this meeting has external attendees.',
    );
  });

  it('falls back only when backend message is empty', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      schedulingPropose: vi.fn().mockResolvedValue({
        refused: true,
        code: 'multi-attendee',
        message: '',
      }),
      schedulingConfirmTarget: vi.fn(),
    };
    const user = userEvent.setup();

    render(<SchedulingChat />);
    fireEvent.change(screen.getByTestId('scheduling-nl-input'), {
      target: { value: 'move team standup' },
    });
    await user.click(screen.getByTestId('scheduling-submit'));

    expect((await screen.findByTestId('scheduling-refusal')).textContent).toContain(
      'Multi-attendee calendar changes',
    );
  });
});
