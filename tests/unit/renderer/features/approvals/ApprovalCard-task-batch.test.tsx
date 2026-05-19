import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalCard } from '../../../../../src/renderer/features/approvals/ApprovalCard';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function row(): ApprovalRowDto {
  return {
    id: 'task-batch-1',
    kind: 'task_batch',
    state: 'ready',
    created_at: '2026-05-19T10:00:00.000Z',
    updated_at: '2026-05-19T10:00:00.000Z',
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: null,
    subject: 'Meeting actions',
    body_original: JSON.stringify([
      { id: 'a1', text: 'Send the deck', owner: 'self', citationStart: 0, citationEnd: 5, priorityHint: 'p2' },
      { id: 'a2', text: 'Clarify owner', owner: 'unassigned', citationStart: 6, citationEnd: 12 },
    ]),
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
    meeting_note_id: 'note-1',
  };
}

afterEach(() => cleanup());

describe('ApprovalCard task_batch variant', () => {
  it('renders actions and approves only selected pushable actions', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCard
        row={row()}
        selectable={false}
        selected={false}
        onSelect={() => undefined}
        onApprove={onApprove}
        onReject={vi.fn().mockResolvedValue(undefined)}
        onSnooze={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId('task-batch-action-a1').textContent).toContain('Send the deck');
    const unassigned = screen.getByTestId('task-batch-action-a2').querySelector('input') as HTMLInputElement;
    expect(unassigned.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('approval-approve-task-batch-1'));
    await Promise.resolve();
    expect(onApprove).toHaveBeenCalledWith(
      'task-batch-1',
      expect.objectContaining({ body: expect.stringContaining('Send the deck') }),
    );
  });
});
