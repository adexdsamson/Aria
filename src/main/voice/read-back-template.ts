/**
 * Plan 17-03 Task 1 — Read-back template builder (D-05).
 *
 * Pure string-builder: no async, no DB access, no IPC. Accepts a persisted
 * ApprovalRow and the user's timezone string, returns the TTS read-back text
 * for each kind branch.
 *
 * Contract:
 *   - Reads ONLY from ApprovalRow fields (resolved entity values).
 *   - NEVER accepts the raw voice transcript as an argument (Pitfall 5 / T-17-06).
 *   - JSON.parse calls are wrapped in try/catch; parse errors return branch fallbacks.
 *   - timezone = scheduling_rules.timeZone (caller reads via loadActiveRules).
 */
import type { ApprovalRow } from '../approvals/persist';

/**
 * Build the TTS read-back string for an approval row.
 *
 * @param row - The persisted ApprovalRow in state 'ready' — provides resolved entities.
 * @param tz  - IANA timezone string (e.g. 'America/New_York') for date formatting.
 * @returns   A short spoken-language string suitable for TTS playback.
 */
export function buildReadBackText(row: ApprovalRow, tz: string): string {
  switch (row.kind) {
    case 'email_send': {
      let recipients: string[] = [];
      if (row.recipients_json) {
        try {
          const parsed = JSON.parse(row.recipients_json) as unknown;
          if (Array.isArray(parsed)) {
            recipients = parsed
              .filter((x): x is string => typeof x === 'string')
              .map((s) => s.trim())
              .filter(Boolean);
          }
        } catch {
          // malformed JSON — fall through to empty list
        }
      }

      const recipientDisplay =
        recipients.length > 0 ? recipients.join(', ') : '(no recipients)';
      const subjectDisplay = row.subject ?? '(no subject)';

      return `Draft to ${recipientDisplay}, subject "${subjectDisplay}". Say yes to send, or say cancel.`;
    }

    case 'calendar_change': {
      let dateStr = '(unknown time)';

      if (row.after_json) {
        try {
          const after = JSON.parse(row.after_json) as Record<string, unknown>;
          if (after && typeof after.startIso === 'string' && after.startIso) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            dateStr = formatter.format(new Date(after.startIso));
          }
        } catch {
          // malformed JSON or invalid date — fall through to fallback
        }
      }

      return `Schedule change to ${dateStr}. Say yes to confirm, or say cancel.`;
    }

    case 'task_batch': {
      return `Push tasks to Todoist. Say yes to confirm, or say cancel.`;
    }

    default: {
      return `Action ready. Say yes to confirm, or say cancel.`;
    }
  }
}
