import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StuckBadge } from '../../../../../src/renderer/features/approvals/StuckBadge';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function row(updated_at: string, state: ApprovalRowDto['state'] = 'sending'): ApprovalRowDto {
  return {
    id: 'stuck-1',
    kind: 'email_send',
    state,
    created_at: updated_at,
    updated_at,
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: null,
    subject: 'Hello',
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
    provider_key: 'microsoft',
    account_id: 'acct-1',
    idempotency_key: 'idem',
    last_error_message: null,
  };
}

afterEach(() => cleanup());

describe('StuckBadge', () => {
  it('shows for sending approvals older than 60s and calls cancel', () => {
    const onCancel = vi.fn();
    render(
      <StuckBadge
        approval={row('2026-05-18T12:00:00.000Z')}
        now={Date.parse('2026-05-18T12:01:05.000Z')}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByTestId('stuck-badge-stuck-1').textContent).toContain('Stuck');
    fireEvent.click(screen.getByTestId('stuck-cancel-stuck-1'));
    expect(onCancel).toHaveBeenCalledWith('stuck-1');
  });

  it('does not show before 60s', () => {
    render(
      <StuckBadge
        approval={row('2026-05-18T12:00:30.000Z')}
        now={Date.parse('2026-05-18T12:01:00.000Z')}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('stuck-badge-stuck-1')).toBeNull();
  });
});
