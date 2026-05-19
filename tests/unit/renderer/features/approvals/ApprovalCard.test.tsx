import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ApprovalCard } from '../../../../../src/renderer/features/approvals/ApprovalCard';
import type { ApprovalRowDto } from '../../../../../src/shared/ipc-contract';

function baseRow(overrides: Partial<ApprovalRowDto> = {}): ApprovalRowDto {
  return {
    id: 'app-1',
    kind: 'email_send',
    state: 'ready',
    created_at: '2026-05-18T12:00:00.000Z',
    updated_at: '2026-05-18T12:00:00.000Z',
    approval_path: 'explicit',
    source_message_id: null,
    recipients_json: '[]',
    subject: 'Draft',
    body_original: 'hello',
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
    account_id: 'boss@example.com',
    ...overrides,
  };
}

function renderCard(row: ApprovalRowDto): void {
  render(
    <ApprovalCard
      row={row}
      selectable={false}
      selected={false}
      onSelect={() => undefined}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      onReject={vi.fn().mockResolvedValue(undefined)}
      onSnooze={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('ApprovalCard wave 3 fixes', () => {
  it('renders last_error_message verbatim when present', () => {
    renderCard(baseRow({ last_error_message: 'Graph said: mailbox temporarily unavailable' }));

    expect(screen.getByTestId('approval-backend-error-app-1').textContent).toContain(
      'Graph said: mailbox temporarily unavailable',
    );
  });

  it('renders an account chip for the approval row', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({
        rows: [
          {
            providerKey: 'microsoft',
            accountId: 'boss@example.com',
            displayEmail: 'boss@example.com',
            displayLabel: 'Outlook Boss',
            displayColor: '#2563eb',
            status: 'ok',
          },
        ],
      }),
    };

    renderCard(baseRow());

    await waitFor(() => {
      expect(screen.getByTestId('account-chip-microsoft-boss@example.com').textContent).toContain(
        'Outlook Boss',
      );
    });
  });

  it('formats calendar approval times with scheduling rules timezone', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      providerAccountsList: vi.fn().mockResolvedValue({ rows: [] }),
      schedulingRulesGet: vi.fn().mockResolvedValue({
        rules: {},
        timeZone: 'America/New_York',
        updatedAt: null,
      }),
    };

    renderCard(
      baseRow({
        id: 'cal-ny',
        kind: 'calendar_change',
        subject: null,
        body_original: null,
        calendar_action: 'move',
        before_json: JSON.stringify({
          summary: 'Late sync',
          startUtc: '2026-05-18T15:00:00.000Z',
          endUtc: '2026-05-18T16:00:00.000Z',
          attendees: [],
        }),
        after_json: JSON.stringify({
          startUtc: '2026-05-21T15:00:00.000Z',
          endUtc: '2026-05-21T16:00:00.000Z',
        }),
        conflicts_json: '[]',
        alternatives_json: '[]',
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('calendar-before-cal-ny').textContent).toContain('11:00 AM');
    });
  });
});
