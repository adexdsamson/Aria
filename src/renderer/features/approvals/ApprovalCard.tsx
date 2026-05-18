/**
 * Plan 03-01 Task 2 — ApprovalCard.
 *
 * Renders one approval row with recipients/subject/body (APPR-03), inline
 * edit-then-approve, reject (with optional reason), snooze (1h default),
 * and a multi-select checkbox for batch approve.
 *
 * Diff view: when `body_edited` differs from `body_original`, render a
 * two-column placeholder (per RESEARCH §Don't Hand-Roll: defer real diff
 * library until UI cards exist).
 *
 * Interrupted state: shows badge + "Regenerate" button (no-op in Plan 03-01;
 * Plan 03-04 wires the drafting agent).
 */
import { useEffect, useState } from 'react';
import type {
  ApprovalRowDto,
  TriageResultDto,
} from '../../../shared/ipc-contract';

export interface ApprovalCardProps {
  row: ApprovalRowDto;
  selectable: boolean;
  selected: boolean;
  onSelect(id: string, selected: boolean): void;
  onApprove(
    id: string,
    edited?: { body?: string; subject?: string },
    calendarOverrides?: {
      scope?: 'this' | 'future' | 'all';
      overrideReasons?: string[];
      afterJson?: string;
    },
  ): Promise<void>;
  onReject(id: string, reason?: string): Promise<void>;
  onSnooze(id: string, until: string): Promise<void>;
}

function parseRecipients(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseCategories(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function ApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { row } = props;
  if (row.kind === 'calendar_change') {
    return <CalendarApprovalCard {...props} />;
  }
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState<string>(row.body_edited ?? row.body_original ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [rationaleOpen, setRationaleOpen] = useState(false);

  // Plan 03-03 — triage chips + summary line. Fetched on mount when the
  // approval row has a source_message_id (email_send kind). Failures are
  // silently swallowed; chips simply don't render.
  const [triage, setTriage] = useState<TriageResultDto | null>(null);
  useEffect(() => {
    if (!row.source_message_id) return;
    let cancelled = false;
    void (async () => {
      try {
        // window.aria is set by preload (typed against AriaApi).
        const result = await window.aria.triageGetForMessage({
          messageId: row.source_message_id!,
        });
        if (cancelled) return;
        if (result && typeof result === 'object' && !('error' in result)) {
          setTriage(result as TriageResultDto);
        }
      } catch {
        /* triage row optional; chips don't render on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.source_message_id]);

  const recipients = parseRecipients(row.recipients_json);
  const categories = parseCategories(row.categories_json);

  const isInterrupted = row.state === 'interrupted';
  const isReady = row.state === 'ready';
  const isDiffed = row.body_edited !== null && row.body_edited !== row.body_original;

  // Plan 03-02 APPR-07 belt+suspenders: disable the silent-approve UI path
  // when severity='high' OR categories ∩ {financial,legal,hr} ≠ ∅. gate.ts
  // (Plan 03-01) enforces this server-side via approval_path='explicit'; the
  // UI guard is for visibility — the user sees that the silent path is closed.
  const FORCED_CATEGORIES = new Set(['financial', 'legal', 'hr']);
  const forceExplicit =
    row.severity === 'high' ||
    categories.some((c) => FORCED_CATEGORIES.has(c));

  return (
    <article
      data-testid={`approval-card-${row.id}`}
      data-state={row.state}
      style={{
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: '#fff',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        {props.selectable && (
          <input
            type="checkbox"
            data-testid={`approval-select-${row.id}`}
            aria-label={`Select ${row.subject ?? row.id}`}
            checked={props.selected}
            disabled={!isReady}
            onChange={(e) => props.onSelect(row.id, e.target.checked)}
          />
        )}
        <strong style={{ flex: '1 1 auto' }}>{row.subject ?? '(no subject)'}</strong>
        <span
          data-testid={`approval-state-${row.id}`}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: stateBg(row.state),
            color: '#fff',
          }}
        >
          {row.state}
        </span>
      </header>

      {isInterrupted && (
        <div
          data-testid={`approval-interrupted-${row.id}`}
          style={{
            background: '#fef3c7',
            color: '#92400e',
            padding: 8,
            borderRadius: 4,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          Interrupted — regenerate?{' '}
          <button
            type="button"
            data-testid={`approval-regenerate-${row.id}`}
            disabled={busy || !row.source_message_id}
            title={row.source_message_id ? 'Regenerate draft' : 'No source message to regenerate from'}
            style={{ marginLeft: 8 }}
            onClick={async () => {
              if (!row.source_message_id) return;
              setBusy(true);
              try {
                await window.aria.draftingReplyToMessage({
                  messageId: row.source_message_id,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Regenerate
          </button>
        </div>
      )}

      <p style={{ margin: '4px 0', fontSize: 13, color: '#374151' }}>
        <strong>To:</strong> {recipients.join(', ') || '(no recipients)'}
      </p>

      {(row.severity || categories.length > 0 || row.classifier_rationale || row.routed) && (
        <div
          data-testid={`approval-rationale-${row.id}`}
          style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}
        >
          {row.routed && (
            <button
              type="button"
              data-testid={`approval-routed-chip-${row.id}`}
              onClick={() => setRationaleOpen((o) => !o)}
              style={{
                ...chipStyle(),
                cursor: 'pointer',
                background: '#dbeafe',
                color: '#1e40af',
                border: '1px solid #93c5fd',
              }}
              aria-expanded={rationaleOpen}
              title="Toggle rationale"
            >
              routed: {row.routed}
            </button>
          )}
          {row.severity && <span style={chipStyle()}>severity: {row.severity}</span>}
          {categories.map((c) => (
            <span key={c} style={chipStyle()}>
              {c}
            </span>
          ))}
          {row.beta_voice === 1 && (
            <span
              data-testid={`approval-beta-voice-${row.id}`}
              style={{ ...chipStyle(), background: '#fef3c7', color: '#92400e' }}
              title="Voice model passed neither bar of the held-out eval; ship label is 'beta voice'"
            >
              beta voice
            </span>
          )}
          {forceExplicit && (
            <span
              data-testid={`approval-forced-explicit-${row.id}`}
              style={{ ...chipStyle(), background: '#fee2e2', color: '#991b1b' }}
              title="Silent-approve disabled per APPR-07"
            >
              explicit-required
            </span>
          )}
          {rationaleOpen && row.classifier_rationale && (
            <div
              data-testid={`approval-rationale-expanded-${row.id}`}
              style={{ marginTop: 4, fontSize: 12, color: '#374151' }}
            >
              {row.classifier_rationale}
            </div>
          )}
        </div>
      )}

      {triage && (
        <div
          data-testid={`approval-triage-${row.id}`}
          style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}
        >
          <span
            data-testid={`approval-triage-priority-${row.id}`}
            style={{
              ...chipStyle(),
              background: triage.priority === 'urgent' ? '#fee2e2' : '#e0f2fe',
              color: triage.priority === 'urgent' ? '#991b1b' : '#075985',
            }}
          >
            priority: {triage.priority}
          </span>
          {triage.signals.map((s) => (
            <span
              key={s}
              data-testid={`approval-triage-signal-${row.id}-${s}`}
              style={chipStyle()}
            >
              {s}
            </span>
          ))}
          {triage.summary && (
            <div
              data-testid={`approval-triage-summary-${row.id}`}
              style={{
                marginTop: 4,
                fontStyle: 'italic',
                color: '#374151',
              }}
            >
              {triage.summary}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <>
          {isDiffed ? (
            <div
              data-testid={`approval-diff-${row.id}`}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
            >
              <pre style={preStyle('#fef2f2')}>{row.body_original ?? ''}</pre>
              <pre style={preStyle('#ecfdf5')}>{row.body_edited ?? ''}</pre>
            </div>
          ) : (
            <pre style={preStyle('#f9fafb')}>
              {row.body_edited ?? row.body_original ?? '(empty draft)'}
            </pre>
          )}
        </>
      )}

      {editing && (
        <textarea
          data-testid={`approval-edit-textarea-${row.id}`}
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={8}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8 }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {isReady && !editing && !rejecting && (
          <>
            <button
              type="button"
              data-testid={`approval-approve-${row.id}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onApprove(row.id);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Approve
            </button>
            <button
              type="button"
              data-testid={`approval-edit-${row.id}`}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              data-testid={`approval-reject-${row.id}`}
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
            <button
              type="button"
              data-testid={`approval-snooze-${row.id}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                  await props.onSnooze(row.id, until);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Snooze 1h
            </button>
          </>
        )}
        {editing && (
          <>
            <button
              type="button"
              data-testid={`approval-edit-save-${row.id}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onApprove(row.id, { body: draftBody });
                  setEditing(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save & Approve
            </button>
            <button
              type="button"
              data-testid={`approval-edit-cancel-${row.id}`}
              disabled={busy}
              onClick={() => {
                setDraftBody(row.body_edited ?? row.body_original ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        )}
        {rejecting && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 100%' }}>
            <input
              type="text"
              data-testid={`approval-reject-reason-${row.id}`}
              placeholder="Reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ flex: '1 1 auto', padding: 6 }}
            />
            <button
              type="button"
              data-testid={`approval-reject-confirm-${row.id}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onReject(row.id, rejectReason || undefined);
                  setRejecting(false);
                  setRejectReason('');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm reject
            </button>
            <button
              type="button"
              data-testid={`approval-reject-cancel-${row.id}`}
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setRejectReason('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function stateBg(s: string): string {
  switch (s) {
    case 'pending':
      return '#6b7280';
    case 'generating':
      return '#2563eb';
    case 'ready':
      return '#059669';
    case 'approved':
      return '#0d9488';
    case 'rejected':
      return '#dc2626';
    case 'snoozed':
      return '#a16207';
    case 'interrupted':
      return '#b45309';
    case 'sent':
      return '#1f2937';
    default:
      return '#6b7280';
  }
}

function chipStyle(): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 6px',
    background: '#e5e7eb',
    borderRadius: 4,
    marginRight: 4,
    fontSize: 11,
  };
}

function preStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    padding: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap',
    margin: 0,
    borderRadius: 4,
    border: '1px solid #e5e7eb',
  };
}

// ─── Plan 04-03 — calendar_change variant ──────────────────────────────────

interface BeforeJson {
  summary?: string;
  startUtc?: string;
  endUtc?: string;
  recurrence?: string[];
  isRecurring?: boolean;
  attendees?: Array<{ email?: string | null; self?: boolean | null }>;
  organizer?: { email?: string | null; self?: boolean | null };
}
interface AfterJson {
  startUtc?: string;
  endUtc?: string;
}
interface ConflictJson {
  type: string;
  severity: 'hard' | 'soft';
  windowStartUtc: string;
  windowEndUtc: string;
  label?: string;
}
interface AlternativeJson {
  startUtc: string;
  endUtc: string;
  score: number;
  primeTimeMatched: boolean;
  bufferPenalty: number;
}

function safeParseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function fmtTime(iso: string | undefined, tz: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export function CalendarApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { row } = props;
  const before = safeParseJson<BeforeJson>(row.before_json) ?? {};
  const initialAfter = safeParseJson<AfterJson>(row.after_json) ?? {};
  const conflicts = safeParseJson<ConflictJson[]>(row.conflicts_json) ?? [];
  const alternatives = safeParseJson<AlternativeJson[]>(row.alternatives_json) ?? [];
  const isRecurring = Boolean(before.isRecurring) || (before.recurrence ?? []).length > 0;

  const [after, setAfter] = useState<AfterJson>(initialAfter);
  const [scope, setScope] = useState<'this' | 'future' | 'all'>(
    (row.recurring_scope as 'this' | 'future' | 'all' | null) ?? 'this',
  );
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);

  const tz = 'UTC';
  const isReady = row.state === 'ready';
  const hardConflicts = conflicts.filter((c) => c.severity === 'hard');

  const attendeeEmails = (before.attendees ?? [])
    .map((a) => a.email)
    .filter((e): e is string => !!e);
  const selfOnly = attendeeEmails.length === 0;

  async function handleApprove(): Promise<void> {
    setBusy(true);
    try {
      const overrides: {
        scope: 'this' | 'future' | 'all';
        overrideReasons?: string[];
        afterJson?: string;
      } = { scope };
      if (
        after.startUtc !== initialAfter.startUtc ||
        after.endUtc !== initialAfter.endUtc
      ) {
        overrides.afterJson = JSON.stringify(after);
      }
      if (overrideReason.trim()) {
        overrides.overrideReasons = [overrideReason.trim()];
      }
      await props.onApprove(row.id, undefined, overrides);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      data-testid={`approval-card-${row.id}`}
      data-kind="calendar_change"
      data-state={row.state}
      style={{
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: '#fff',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        {props.selectable && (
          <input
            type="checkbox"
            data-testid={`approval-select-${row.id}`}
            checked={props.selected}
            disabled={!isReady}
            onChange={(e) => props.onSelect(row.id, e.target.checked)}
          />
        )}
        <strong style={{ flex: '1 1 auto' }}>
          📅 {before.summary ?? row.calendar_action ?? 'Calendar change'}
        </strong>
        <span
          data-testid={`approval-state-${row.id}`}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: '#0d9488',
            color: '#fff',
          }}
        >
          {row.state}
        </span>
      </header>

      <div
        data-testid={`calendar-before-after-${row.id}`}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>From</div>
          <div data-testid={`calendar-before-${row.id}`}>{fmtTime(before.startUtc, tz)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>To</div>
          <div data-testid={`calendar-after-${row.id}`}>{fmtTime(after.startUtc, tz)}</div>
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <strong>Attendees:</strong>{' '}
        {selfOnly ? (
          <span
            data-testid={`calendar-self-only-${row.id}`}
            style={{ ...chipStyle(), background: '#dcfce7', color: '#166534' }}
          >
            self-only
          </span>
        ) : (
          attendeeEmails.join(', ')
        )}
      </div>

      {conflicts.length > 0 && (
        <div data-testid={`calendar-conflicts-${row.id}`} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Conflicts</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {conflicts.map((c, i) => (
              <li
                key={i}
                data-testid={`calendar-conflict-${row.id}-${i}`}
                data-severity={c.severity}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  marginBottom: 4,
                  borderRadius: 4,
                  background: c.severity === 'hard' ? '#fee2e2' : '#fef3c7',
                  color: c.severity === 'hard' ? '#991b1b' : '#92400e',
                }}
              >
                {c.severity}: {c.type}
                {c.label ? ` — ${c.label}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {alternatives.length > 0 && (
        <div data-testid={`calendar-alternatives-${row.id}`} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            Alternative slots
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {alternatives.map((a, i) => {
              const selected = after.startUtc === a.startUtc;
              return (
                <button
                  key={a.startUtc}
                  type="button"
                  data-testid={`calendar-alt-${row.id}-${i}`}
                  data-selected={selected}
                  onClick={() =>
                    setAfter({ startUtc: a.startUtc, endUtc: a.endUtc })
                  }
                  style={{
                    padding: '4px 8px',
                    border: selected ? '2px solid #2563eb' : '1px solid #d1d5db',
                    borderRadius: 4,
                    background: selected ? '#dbeafe' : '#fff',
                    fontSize: 12,
                  }}
                >
                  {fmtTime(a.startUtc, tz)}
                  {a.primeTimeMatched ? ' ⭐' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isRecurring && (
        <fieldset
          data-testid={`calendar-recurring-scope-${row.id}`}
          style={{
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: 8,
            marginBottom: 12,
          }}
        >
          <legend style={{ fontSize: 12, color: '#6b7280' }}>This is a recurring event</legend>
          {(['this', 'future', 'all'] as const).map((s) => (
            <label key={s} style={{ marginRight: 12, fontSize: 13 }}>
              <input
                type="radio"
                name={`scope-${row.id}`}
                data-testid={`calendar-scope-${row.id}-${s}`}
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
              />{' '}
              {s === 'this' ? 'this instance' : s === 'future' ? 'this & future' : 'all'}
            </label>
          ))}
        </fieldset>
      )}

      {hardConflicts.length > 0 && (
        <div
          data-testid={`calendar-override-section-${row.id}`}
          style={{ marginBottom: 12 }}
        >
          {!showOverride ? (
            <button
              type="button"
              data-testid={`calendar-override-toggle-${row.id}`}
              onClick={() => setShowOverride(true)}
              style={{ fontSize: 12, color: '#991b1b' }}
            >
              Override hard conflict and schedule anyway
            </button>
          ) : (
            <div>
              <input
                type="text"
                data-testid={`calendar-override-reason-${row.id}`}
                placeholder="Reason for override (required)"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                style={{ width: '100%', padding: 6, fontSize: 13 }}
              />
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {isReady && (
          <>
            <button
              type="button"
              data-testid={`approval-approve-${row.id}`}
              disabled={busy || (hardConflicts.length > 0 && (!showOverride || !overrideReason.trim()))}
              onClick={() => void handleApprove()}
            >
              Approve & apply
            </button>
            <button
              type="button"
              data-testid={`approval-reject-${row.id}`}
              disabled={busy}
              onClick={() => void props.onReject(row.id)}
            >
              Reject
            </button>
            <button
              type="button"
              data-testid={`approval-snooze-${row.id}`}
              disabled={busy}
              onClick={() => {
                const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                void props.onSnooze(row.id, until);
              }}
            >
              Snooze 1h
            </button>
          </>
        )}
      </div>
    </article>
  );
}
