import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalQueue } from '../../../../../src/renderer/features/approvals/ApprovalQueue';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function row(id: string, provider_key: 'google' | 'microsoft', account_id: string): ApprovalRowDto {
  return {
    id,
    kind: 'email_send',
    state: 'ready',
    created_at: '2026-05-18T12:00:00.000Z',
    updated_at: '2026-05-18T12:00:00.000Z',
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: '[]',
    subject: id,
    body_original: 'body',
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
    provider_key,
    account_id,
  };
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('ApprovalQueue account filter', () => {
  it('filters rows by account chip', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const user = userEvent.setup();

    render(
      <ApprovalQueue
        rows={[row('g-approval', 'google', 'g@example.com'), row('m-approval', 'microsoft', 'm@example.com')]}
        selected={new Set()}
        onSelect={() => undefined}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onReject={vi.fn().mockResolvedValue(undefined)}
        onSnooze={vi.fn().mockResolvedValue(undefined)}
        onCancelStuck={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByTestId('approval-account-filter-microsoft-m@example.com'));
    expect(screen.queryByTestId('approval-card-g-approval')).toBeNull();
    expect(screen.getByTestId('approval-card-m-approval')).toBeTruthy();
  });
});
