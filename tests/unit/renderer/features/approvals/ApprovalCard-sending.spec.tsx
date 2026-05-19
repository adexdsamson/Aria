import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApprovalCard } from '../../../../../src/renderer/features/approvals/ApprovalCard';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function makeRow(over: Partial<ApprovalRowDto> = {}): ApprovalRowDto {
  return {
    id: 'email-1',
    kind: 'email_send',
    state: 'approved',
    created_at: '2026-05-18T12:00:00.000Z',
    updated_at: '2026-05-18T12:00:00.000Z',
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: JSON.stringify(['alice@example.com']),
    subject: 'Re: Project sync',
    body_original: 'Tuesday works for me.',
    body_edited: null,
    classifier_version: null,
    categories_json: null,
    severity: 'low',
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
    provider_key: 'microsoft',
    account_id: 'acct-1',
    idempotency_key: 'idem-1',
    last_error_message: null,
    ...over,
  };
}

function renderCard(row: ApprovalRowDto) {
  const noop = vi.fn().mockResolvedValue(undefined);
  render(
    <ApprovalCard
      row={row}
      selectable={true}
      selected={false}
      onSelect={noop}
      onApprove={noop}
      onReject={noop}
      onSnooze={noop}
    />,
  );
}

afterEach(() => cleanup());

describe('ApprovalCard sending-state duplicate-click protection', () => {
  it('keeps approved rows actionable before send dispatch starts', () => {
    renderCard(makeRow({ state: 'approved' }));
    const button = screen.getByTestId('approval-approve-email-1') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Approve');
  });

  it('disables approve while the send is in flight', () => {
    renderCard(makeRow({ state: 'sending' }));
    const button = screen.getByTestId('approval-approve-email-1') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Sending...');
  });

  it('disables approve after the message is sent', () => {
    renderCard(makeRow({ state: 'sent' }));
    const button = screen.getByTestId('approval-approve-email-1') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Approve');
  });
});
