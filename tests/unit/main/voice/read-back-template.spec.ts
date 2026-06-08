/**
 * Plan 17-03 Task 1 (TDD RED) — buildReadBackText() unit tests.
 *
 * Tests cover all 4 kind branches, null/missing field edge cases,
 * and the "function never accepts raw transcript" contract (pure row-reader).
 */
import { describe, it, expect } from 'vitest';
import { buildReadBackText } from '../../../../src/main/voice/read-back-template';
import type { ApprovalRow } from '../../../../src/main/approvals/persist';

function makeRow(overrides: Partial<ApprovalRow>): ApprovalRow {
  return {
    id: 'test-id',
    kind: 'email_send',
    state: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    calendar_event_id: null,
    calendar_action: null,
    recurring_scope: null,
    before_json: null,
    after_json: null,
    conflicts_json: null,
    alternatives_json: null,
    rule_overrides_json: null,
    provider_key: null,
    account_id: null,
    idempotency_key: null,
    last_error_message: null,
    meeting_note_id: null,
    ...overrides,
  };
}

const TZ = 'America/New_York';

describe('buildReadBackText()', () => {
  describe('email_send kind', () => {
    it('includes recipient email in output', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: JSON.stringify(['a@b.com']),
        subject: 'Re: Q4',
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('a@b.com');
    });

    it('includes subject in output', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: JSON.stringify(['a@b.com']),
        subject: 'Re: Q4',
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('Re: Q4');
    });

    it('includes multiple recipients', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: JSON.stringify(['alice@corp.com', 'bob@corp.com']),
        subject: 'Team update',
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('alice@corp.com');
      expect(text).toContain('bob@corp.com');
    });

    it('falls back gracefully when recipients_json is null', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: null,
        subject: 'Hello',
      });
      const text = buildReadBackText(row, TZ);
      // Should not throw; should mention "(no recipients)" or similar fallback
      expect(text).toContain('(no recipients)');
    });

    it('falls back gracefully when subject is null', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: JSON.stringify(['alice@corp.com']),
        subject: null,
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('(no subject)');
    });

    it('includes voice affordance copy (say yes / cancel)', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: JSON.stringify(['a@b.com']),
        subject: 'Test',
      });
      const text = buildReadBackText(row, TZ);
      expect(text.toLowerCase()).toContain('yes');
      expect(text.toLowerCase()).toContain('cancel');
    });
  });

  describe('calendar_change kind', () => {
    it('formats date in the given timezone', () => {
      // 2026-06-15T18:00:00Z = 2:00 PM EDT (America/New_York UTC-4 in summer)
      const row = makeRow({
        kind: 'calendar_change',
        after_json: JSON.stringify({ startIso: '2026-06-15T18:00:00Z' }),
      });
      const text = buildReadBackText(row, 'America/New_York');
      // Should contain a formatted date string (Mon Jun 15, 2:00 PM or similar)
      expect(text).toBeTruthy();
      // The date string should appear in the output
      expect(text).toMatch(/Jun|june/i);
    });

    it('falls back when after_json is null', () => {
      const row = makeRow({
        kind: 'calendar_change',
        after_json: null,
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('(unknown time)');
    });

    it('falls back when after_json has no startIso', () => {
      const row = makeRow({
        kind: 'calendar_change',
        after_json: JSON.stringify({ endIso: '2026-06-15T19:00:00Z' }),
      });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('(unknown time)');
    });

    it('includes voice affordance copy', () => {
      const row = makeRow({
        kind: 'calendar_change',
        after_json: JSON.stringify({ startIso: '2026-06-15T18:00:00Z' }),
      });
      const text = buildReadBackText(row, TZ);
      expect(text.toLowerCase()).toContain('yes');
      expect(text.toLowerCase()).toContain('cancel');
    });
  });

  describe('task_batch kind', () => {
    it('mentions Todoist', () => {
      const row = makeRow({ kind: 'task_batch' });
      const text = buildReadBackText(row, TZ);
      expect(text).toContain('Todoist');
    });

    it('includes voice affordance copy', () => {
      const row = makeRow({ kind: 'task_batch' });
      const text = buildReadBackText(row, TZ);
      expect(text.toLowerCase()).toContain('yes');
      expect(text.toLowerCase()).toContain('cancel');
    });
  });

  describe('unknown/fallback kind', () => {
    it('returns generic action ready fallback for unknown kind', () => {
      // Force an unknown kind by casting
      const row = makeRow({ kind: 'task_batch' });
      // Manually override kind to unknown value (simulate future kind)
      const unknownRow = { ...row, kind: 'unknown_future_kind' as ApprovalRow['kind'] };
      const text = buildReadBackText(unknownRow, TZ);
      // Should return a safe fallback
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toContain('action ready');
    });
  });

  describe('JSON parse resilience', () => {
    it('falls back gracefully when recipients_json is malformed JSON', () => {
      const row = makeRow({
        kind: 'email_send',
        recipients_json: 'NOT_VALID_JSON',
        subject: 'Test',
      });
      expect(() => buildReadBackText(row, TZ)).not.toThrow();
      const text = buildReadBackText(row, TZ);
      expect(text).toBeTruthy();
    });

    it('falls back gracefully when after_json is malformed JSON', () => {
      const row = makeRow({
        kind: 'calendar_change',
        after_json: 'NOT_VALID_JSON',
      });
      expect(() => buildReadBackText(row, TZ)).not.toThrow();
      const text = buildReadBackText(row, TZ);
      expect(text).toBeTruthy();
    });
  });
});
