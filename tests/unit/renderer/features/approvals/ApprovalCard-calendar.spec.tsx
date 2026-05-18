/**
 * Plan 04-03 Task 2 — ApprovalCard calendar_change variant tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from '../../../../../src/renderer/features/approvals/ApprovalCard';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function makeRow(over: Partial<ApprovalRowDto> = {}): ApprovalRowDto {
  return {
    id: 'cal-1',
    kind: 'calendar_change',
    state: 'ready',
    created_at: '2026-05-18T12:00:00.000Z',
    updated_at: '2026-05-18T12:00:00.000Z',
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: null,
    subject: null,
    body_original: null,
    body_edited: null,
    classifier_version: null,
    categories_json: null,
    severity: null,
    confidence: null,
    classifier_rationale: null,
    routed: null,
    triage_signals_json: null,
    triage_summary: null,
    rejection_reason: null,
    snooze_until: null,
    sent_at: null,
    send_log_id: null,
    beta_voice: 0,
    calendar_event_id: 'ev1',
    calendar_action: 'move',
    recurring_scope: null,
    before_json: JSON.stringify({
      summary: '3pm sync',
      startUtc: '2026-05-18T15:00:00.000Z',
      endUtc: '2026-05-18T16:00:00.000Z',
      isRecurring: false,
      attendees: [],
      organizer: { email: 'me@example.com', self: true },
    }),
    after_json: JSON.stringify({
      startUtc: '2026-05-21T15:00:00.000Z',
      endUtc: '2026-05-21T16:00:00.000Z',
    }),
    conflicts_json: '[]',
    alternatives_json: '[]',
    rule_overrides_json: null,
    ...over,
  };
}

afterEach(() => cleanup());

describe('ApprovalCard — calendar_change variant', () => {
  const noop = vi.fn().mockResolvedValue(undefined);

  it('(a) non-recurring shows no scope radio', () => {
    render(
      <ApprovalCard
        row={makeRow()}
        selectable={false}
        selected={false}
        onSelect={() => undefined}
        onApprove={noop}
        onReject={noop}
        onSnooze={noop}
      />,
    );
    expect(screen.queryByTestId('calendar-recurring-scope-cal-1')).toBeNull();
  });

  it('(b) recurring shows three scope radios with "this" selected by default', () => {
    const recurring = makeRow({
      before_json: JSON.stringify({
        summary: 'Weekly standup',
        startUtc: '2026-05-18T15:00:00.000Z',
        endUtc: '2026-05-18T16:00:00.000Z',
        isRecurring: true,
        recurrence: ['RRULE:FREQ=WEEKLY'],
        attendees: [],
        organizer: { email: 'me@example.com', self: true },
      }),
    });
    render(
      <ApprovalCard
        row={recurring}
        selectable={false}
        selected={false}
        onSelect={() => undefined}
        onApprove={noop}
        onReject={noop}
        onSnooze={noop}
      />,
    );
    expect(screen.getByTestId('calendar-recurring-scope-cal-1')).toBeTruthy();
    const thisR = screen.getByTestId('calendar-scope-cal-1-this') as HTMLInputElement;
    expect(thisR.checked).toBe(true);
  });

  it('(c) alternatives picker swaps after on click + passes overrides on approve', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const row = makeRow({
      alternatives_json: JSON.stringify([
        {
          startUtc: '2026-05-22T15:00:00.000Z',
          endUtc: '2026-05-22T16:00:00.000Z',
          score: -1000,
          primeTimeMatched: false,
          bufferPenalty: 0,
        },
      ]),
    });
    render(
      <ApprovalCard
        row={row}
        selectable={false}
        selected={false}
        onSelect={() => undefined}
        onApprove={onApprove}
        onReject={noop}
        onSnooze={noop}
      />,
    );
    const alt = screen.getByTestId('calendar-alt-cal-1-0');
    fireEvent.click(alt);
    expect(alt.getAttribute('data-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('approval-approve-cal-1'));
    await Promise.resolve();
    expect(onApprove).toHaveBeenCalled();
    const args = onApprove.mock.calls[0]!;
    expect(args[2]).toMatchObject({ scope: 'this' });
    expect(args[2].afterJson).toContain('2026-05-22T15:00');
  });

  it('(d) conflicts list renders hard in red, soft in amber', () => {
    const row = makeRow({
      conflicts_json: JSON.stringify([
        { type: 'busy', severity: 'hard', windowStartUtc: 'x', windowEndUtc: 'y' },
        { type: 'buffer', severity: 'soft', windowStartUtc: 'a', windowEndUtc: 'b' },
      ]),
    });
    render(
      <ApprovalCard
        row={row}
        selectable={false}
        selected={false}
        onSelect={() => undefined}
        onApprove={noop}
        onReject={noop}
        onSnooze={noop}
      />,
    );
    const hard = screen.getByTestId('calendar-conflict-cal-1-0');
    const soft = screen.getByTestId('calendar-conflict-cal-1-1');
    expect(hard.getAttribute('data-severity')).toBe('hard');
    expect(soft.getAttribute('data-severity')).toBe('soft');
  });
});
