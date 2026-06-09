/**
 * Plan 03-01 Task 2 — ApprovalCard.
 *
 * Renders one approval row with recipients/subject/body (APPR-03), inline
 * edit-then-approve, reject (with optional reason), snooze (1h default),
 * and a multi-select checkbox for batch approve.
 *
 * Three variants: email_send (default), calendar_change, task_batch.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial card chrome (paper bg, rule
 * borders, gold accents), mono chips, Playfair subjects. All data-testid,
 * data-kind, data-state, behaviour, callback wiring, and chokepoint
 * call-paths preserved verbatim.
 */
import { useEffect, useState } from 'react';
import type {
  ApprovalRowDto,
  TriageResultDto,
} from '../../../shared/ipc-contract';
import { Button } from '../../components/editorial';
import { AccountChip } from '../../components/AccountChip';

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

// ─── Shared editorial helpers ──────────────────────────────────────────────

type ChipTone = 'neutral' | 'gold' | 'rose' | 'moss' | 'blue';

function chipPalette(tone: ChipTone): { bg: string; fg: string; border: string } {
  switch (tone) {
    case 'gold':
      return { bg: 'rgba(184,134,11,0.10)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.25)' };
    case 'rose':
      return { bg: 'rgba(184,73,58,0.10)', fg: '#7A2B20', border: 'rgba(184,73,58,0.25)' };
    case 'moss':
      return { bg: 'rgba(91,110,58,0.12)', fg: '#3F4E26', border: 'rgba(91,110,58,0.25)' };
    case 'blue':
      return { bg: 'rgba(31,58,95,0.10)', fg: '#1F3A5F', border: 'rgba(31,58,95,0.25)' };
    default:
      return { bg: 'var(--ivory-deep)', fg: 'var(--gray)', border: 'var(--rule)' };
  }
}

function chipStyle(tone: ChipTone = 'neutral'): React.CSSProperties {
  const p = chipPalette(tone);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.05em',
    background: p.bg,
    color: p.fg,
    border: `1px solid ${p.border}`,
    marginRight: 4,
  };
}

function articleStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'var(--paper)',
    border: '1px solid var(--rule)',
    borderRadius: 8,
    padding: '16px 20px 18px',
    marginBottom: 12,
    opacity: busy ? 0.6 : 1,
  };
}

function StateBadge({ state, id }: { state: string; id: string }): JSX.Element {
  const palette = stateBadgePalette(state);
  return (
    <span
      data-testid={`approval-state-${id}`}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 9.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '3px 8px',
        borderRadius: 3,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {state}
    </span>
  );
}

function stateBadgePalette(s: string): { bg: string; fg: string; border: string } {
  switch (s) {
    case 'pending':
      return { bg: 'var(--ivory-deep)', fg: 'var(--gray)', border: 'var(--rule)' };
    case 'generating':
      return { bg: 'rgba(184,134,11,0.16)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.30)' };
    case 'ready':
    case 'approved':
      return { bg: 'rgba(91,110,58,0.18)', fg: '#3F4E26', border: 'rgba(91,110,58,0.30)' };
    case 'sending':
      return { bg: 'rgba(31,58,95,0.16)', fg: '#1F3A5F', border: 'rgba(31,58,95,0.30)' };
    case 'failed':
    case 'rejected':
      return { bg: 'rgba(184,73,58,0.16)', fg: '#7A2B20', border: 'rgba(184,73,58,0.30)' };
    case 'interrupted':
      return { bg: 'rgba(184,73,58,0.10)', fg: '#7A2B20', border: 'rgba(184,73,58,0.25)' };
    case 'snoozed':
      return { bg: 'var(--ivory-deep)', fg: 'var(--gray-soft)', border: 'var(--rule)' };
    case 'sent':
      return { bg: 'var(--ink)', fg: 'var(--ivory)', border: 'var(--ink)' };
    case 'needs-operator-decision':
      return { bg: 'rgba(184,134,11,0.16)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.30)' };
    default:
      return { bg: 'var(--ivory-deep)', fg: 'var(--gray)', border: 'var(--rule)' };
  }
}

function BackendError({ row }: { row: ApprovalRowDto }): JSX.Element | null {
  const message = row.last_error_message?.trim();
  if (!message) return null;
  return (
    <details
      data-testid={`approval-backend-error-${row.id}`}
      open
      style={{
        background: 'rgba(184,73,58,0.08)',
        color: '#7A2B20',
        border: '1px solid rgba(184,73,58,0.25)',
        borderRadius: 6,
        padding: 10,
        marginBottom: 10,
        fontSize: 12,
      }}
    >
      <summary
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Backend error
      </summary>
      <code style={{ whiteSpace: 'pre-wrap', display: 'block', marginTop: 6 }}>{message}</code>
    </details>
  );
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function ApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { row } = props;
  if (row.kind === 'calendar_change') {
    return <CalendarApprovalCard {...props} />;
  }
  if (row.kind === 'task_batch') {
    return <TaskBatchApprovalCard {...props} />;
  }
  return <EmailApprovalCard {...props} />;
}

// ─── email_send variant ────────────────────────────────────────────────────

function EmailApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { row } = props;
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState<string>(row.body_edited ?? row.body_original ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);

  const [triage, setTriage] = useState<TriageResultDto | null>(null);
  useEffect(() => {
    if (!row.source_message_id) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.aria.triageGetForMessage({
          messageId: row.source_message_id!,
        });
        if (cancelled) return;
        if (result && typeof result === 'object' && !('error' in result)) {
          setTriage(result as TriageResultDto);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.source_message_id]);

  const recipients = parseRecipients(row.recipients_json);
  const categories = parseCategories(row.categories_json);

  const isInterrupted = row.state === 'interrupted';
  const isSending = row.state === 'sending';
  const isTerminal = row.state === 'sent' || row.state === 'failed' || row.state === 'cancelled'; // Phase 17 D-11
  const canApprove = row.state === 'ready' || row.state === 'approved';
  const showApprovalActions = canApprove || isSending || isTerminal;
  const isDiffed = row.body_edited !== null && row.body_edited !== row.body_original;

  const FORCED_CATEGORIES = new Set(['financial', 'legal', 'hr']);
  const forceExplicit =
    row.severity === 'high' ||
    categories.some((c) => FORCED_CATEGORIES.has(c));

  return (
    <article
      data-testid={`approval-card-${row.id}`}
      data-state={row.state}
      className="card-accent-top"
      style={{ ...articleStyle(busy), borderTop: '2px solid var(--gold)' }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        {props.selectable && (
          <input
            type="checkbox"
            data-testid={`approval-select-${row.id}`}
            aria-label={`Select ${row.subject ?? row.id}`}
            checked={props.selected}
            disabled={!canApprove || isSending || isTerminal}
            onChange={(e) => props.onSelect(row.id, e.target.checked)}
            style={{ accentColor: 'var(--gold)', marginTop: 4 }}
          />
        )}
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginTop: 4,
          }}
        >
          Email
        </span>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <strong
            style={{
              display: 'block',
              fontFamily: 'var(--f-display)',
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '-0.005em',
              color: 'var(--ink)',
              lineHeight: 1.3,
            }}
          >
            {row.subject ?? '(no subject)'}
          </strong>
        </div>
        <AccountChip providerKey={row.provider_key} accountId={row.account_id} compact />
        <StateBadge state={row.state} id={row.id} />
      </header>

      <BackendError row={row} />

      {isInterrupted && (
        <div
          data-testid={`approval-interrupted-${row.id}`}
          style={{
            background: 'rgba(184,73,58,0.08)',
            color: '#7A2B20',
            border: '1px solid rgba(184,73,58,0.20)',
            padding: '10px 12px',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ flex: 1 }}>
            Interrupted — draft generation suspended. No partial draft was saved.
          </span>
          <Button
            variant="outline"
            data-testid={`approval-regenerate-${row.id}`}
            disabled={busy || !row.source_message_id}
            title={row.source_message_id ? 'Regenerate draft' : 'No source message to regenerate from'}
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
            style={{ minHeight: 28, padding: '0 12px', fontSize: 12.5 }}
          >
            Regenerate
          </Button>
        </div>
      )}

      <p style={{ margin: '4px 0 10px 0', fontSize: 13, color: 'var(--ink-soft)' }}>
        <span
          className="smallcaps"
          style={{ color: 'var(--gray-soft)', marginRight: 6 }}
          aria-hidden="true"
        >
          To
        </span>
        {recipients.join(', ') || '(no recipients)'}
      </p>

      {(row.severity || categories.length > 0 || row.classifier_rationale || row.routed) && (
        <div
          data-testid={`approval-rationale-${row.id}`}
          style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}
        >
          {row.routed && (
            <button
              type="button"
              data-testid={`approval-routed-chip-${row.id}`}
              onClick={() => setRationaleOpen((o) => !o)}
              style={{ ...chipStyle('blue'), cursor: 'pointer' }}
              aria-expanded={rationaleOpen}
              title="Toggle rationale"
            >
              routed: {row.routed}
            </button>
          )}
          {row.severity && (
            <span style={chipStyle(row.severity === 'high' ? 'rose' : row.severity === 'med' ? 'gold' : 'neutral')}>
              severity: {row.severity}
            </span>
          )}
          {categories.map((c) => (
            <span key={c} style={chipStyle('gold')}>
              {c}
            </span>
          ))}
          {row.beta_voice === 1 && (
            <span
              data-testid={`approval-beta-voice-${row.id}`}
              style={chipStyle('gold')}
              title="Voice model passed neither bar of the held-out eval; ship label is 'beta voice'"
            >
              beta voice
            </span>
          )}
          {forceExplicit && (
            <span
              data-testid={`approval-forced-explicit-${row.id}`}
              style={chipStyle('rose')}
              title="Silent-approve disabled per APPR-07"
            >
              explicit-required
            </span>
          )}
          {rationaleOpen && row.classifier_rationale && (
            <div
              data-testid={`approval-rationale-expanded-${row.id}`}
              style={{ flex: '1 1 100%', marginTop: 4, fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}
            >
              {row.classifier_rationale}
            </div>
          )}
        </div>
      )}

      {triage && (
        <div
          data-testid={`approval-triage-${row.id}`}
          style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}
        >
          <span
            data-testid={`approval-triage-priority-${row.id}`}
            style={chipStyle(triage.priority === 'urgent' ? 'rose' : 'blue')}
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
                flex: '1 1 100%',
                marginTop: 6,
                fontFamily: 'var(--f-display)',
                fontStyle: 'italic',
                color: 'var(--ink-soft)',
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              “{triage.summary}”
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
              <pre style={preStyle('rgba(184,73,58,0.05)')}>{row.body_original ?? ''}</pre>
              <pre style={preStyle('rgba(91,110,58,0.06)')}>{row.body_edited ?? ''}</pre>
            </div>
          ) : (
            <pre style={preStyle('var(--ivory)')}>
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
          rows={9}
          style={{
            width: '100%',
            fontFamily: 'var(--f-body)',
            fontSize: 13.5,
            padding: '14px 16px',
            borderRadius: 6,
            border: '1px solid var(--rule-strong)',
            background: 'var(--paper)',
            color: 'var(--ink-soft)',
            lineHeight: 1.55,
            boxSizing: 'border-box',
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {showApprovalActions && !editing && !rejecting && (
          <>
            <Button
              variant="primary"
              data-testid={`approval-approve-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onApprove(row.id);
                } finally {
                  setBusy(false);
                }
              }}
              style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
            >
              {isSending ? 'Sending...' : forceExplicit ? 'Approve (explicit)' : 'Approve'}
            </Button>
            <Button
              variant="outline"
              data-testid={`approval-edit-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={() => setEditing(true)}
              style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
            >
              Edit
            </Button>
            {/* D-07: voice-confirm affordance suppressed when forceExplicit=true.
                For normal (non-forced) ready rows the user can speak "confirm"
                as a second channel alongside the Approve button. Disabled when
                forceExplicit so forced/high-severity rows are on-screen-tap only.
                Phase-14 HARD GATE (assertApproved throws voice-forbidden-forced)
                is the backstop even if this UI suppression is bypassed. */}
            {row.state === 'ready' && (
              <Button
                variant="ghost"
                data-testid={`approval-voice-confirm-${row.id}`}
                disabled={busy || forceExplicit}
                title={
                  forceExplicit
                    ? 'Voice confirm disabled — explicit tap required for this approval type'
                    : 'Confirm this approval by voice'
                }
                onClick={() => {
                  void window.aria.voiceConfirmApproval({
                    approvalId: row.id,
                    transcript: 'confirm',
                  });
                }}
                style={{
                  minHeight: 32,
                  padding: '0 12px',
                  fontSize: 12.5,
                  opacity: forceExplicit ? 0.35 : 1,
                }}
              >
                Confirm by voice
              </Button>
            )}
            {/* D-09/D-12: Always-visible Cancel button for ready-state rows.
                The reliable second channel for aborting a staged voice approval.
                Calls voiceCancelApproval directly (ready→cancelled). */}
            {row.state === 'ready' && (
              <Button
                variant="ghost"
                data-testid={`approval-cancel-voice-${row.id}`}
                disabled={busy}
                onClick={() => {
                  void window.aria.voiceCancelApproval({ approvalId: row.id });
                }}
                style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
              >
                Cancel
              </Button>
            )}
            <Button
              variant="ghost"
              data-testid={`approval-reject-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={() => setRejecting(true)}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              data-testid={`approval-snooze-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={async () => {
                setBusy(true);
                try {
                  const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                  await props.onSnooze(row.id, until);
                } finally {
                  setBusy(false);
                }
              }}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
            >
              Snooze 1h
            </Button>
          </>
        )}
        {editing && (
          <>
            <Button
              variant="primary"
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
              style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
            >
              Save &amp; Approve
            </Button>
            <Button
              variant="ghost"
              data-testid={`approval-edit-cancel-${row.id}`}
              disabled={busy}
              onClick={() => {
                setDraftBody(row.body_edited ?? row.body_original ?? '');
                setEditing(false);
              }}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
            >
              Cancel
            </Button>
          </>
        )}
        {rejecting && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 100%' }}>
            <input
              type="text"
              data-testid={`approval-reject-reason-${row.id}`}
              placeholder="Reason (optional, helps Aria learn)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{
                flex: '1 1 auto',
                padding: '7px 10px',
                borderRadius: 4,
                border: '1px solid var(--rule-strong)',
                fontSize: 13,
                fontFamily: 'var(--f-body)',
              }}
            />
            <Button
              variant="outline"
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
              style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
            >
              Confirm reject
            </Button>
            <Button
              variant="ghost"
              data-testid={`approval-reject-cancel-${row.id}`}
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setRejectReason('');
              }}
              style={{ minHeight: 30, padding: '0 10px', fontSize: 12.5 }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function preStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    padding: '14px 16px',
    fontSize: 13.5,
    fontFamily: 'var(--f-body)',
    whiteSpace: 'pre-wrap',
    margin: 0,
    borderRadius: 6,
    border: '1px solid var(--rule)',
    color: 'var(--ink-soft)',
    lineHeight: 1.6,
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
  const [tz, setTz] = useState('UTC');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.aria.schedulingRulesGet();
        if (!cancelled && !('error' in res) && res.timeZone) {
          setTz(res.timeZone);
        }
      } catch {
        /* UTC fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isSending = row.state === 'sending';
  const isTerminal = row.state === 'sent' || row.state === 'failed' || row.state === 'cancelled'; // Phase 17 D-11
  const canApprove = row.state === 'ready' || row.state === 'approved';
  const showApprovalActions = canApprove || isSending || isTerminal;
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
      style={articleStyle(busy)}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        {props.selectable && (
          <input
            type="checkbox"
            data-testid={`approval-select-${row.id}`}
            checked={props.selected}
            disabled={!canApprove || isSending || isTerminal}
            onChange={(e) => props.onSelect(row.id, e.target.checked)}
            style={{ accentColor: 'var(--gold)', marginTop: 4 }}
          />
        )}
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginTop: 4,
          }}
        >
          Calendar
        </span>
        <strong
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.3,
          }}
        >
          {before.summary ?? row.calendar_action ?? 'Calendar change'}
        </strong>
        <AccountChip providerKey={row.provider_key} accountId={row.account_id} compact />
        <StateBadge state={row.state} id={row.id} />
      </header>

      <BackendError row={row} />

      <div
        data-testid={`calendar-before-after-${row.id}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 14,
          alignItems: 'center',
          marginBottom: 14,
          padding: 14,
          background: 'var(--ivory)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
        }}
      >
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }} aria-hidden="true">
            From
          </div>
          <div
            data-testid={`calendar-before-${row.id}`}
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 16,
              color: 'var(--gray)',
              textDecoration: 'line-through',
              textDecorationColor: 'var(--rule-strong)',
            }}
          >
            {fmtTime(before.startUtc, tz)}
          </div>
        </div>
        <span style={{ color: 'var(--gold)', fontFamily: 'var(--f-mono)', fontSize: 18 }} aria-hidden="true">
          →
        </span>
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }} aria-hidden="true">
            To
          </div>
          <div
            data-testid={`calendar-after-${row.id}`}
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 16,
              color: 'var(--ink)',
              fontWeight: 500,
            }}
          >
            {fmtTime(after.startUtc, tz)}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="smallcaps" style={{ color: 'var(--gray-soft)' }} aria-hidden="true">
          Attendees
        </span>
        {selfOnly ? (
          <span
            data-testid={`calendar-self-only-${row.id}`}
            style={chipStyle('moss')}
          >
            self-only
          </span>
        ) : (
          <span style={{ color: 'var(--ink-soft)' }}>{attendeeEmails.join(', ')}</span>
        )}
      </div>

      {conflicts.length > 0 && (
        <div data-testid={`calendar-conflicts-${row.id}`} style={{ marginBottom: 12 }}>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }} aria-hidden="true">
            Conflicts
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {conflicts.map((c, i) => (
              <li
                key={i}
                data-testid={`calendar-conflict-${row.id}-${i}`}
                data-severity={c.severity}
                style={chipStyle(c.severity === 'hard' ? 'rose' : 'gold')}
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
          <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }} aria-hidden="true">
            Alternative slots
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {alternatives.map((a, i) => {
              const sel = after.startUtc === a.startUtc;
              return (
                <button
                  key={a.startUtc}
                  type="button"
                  data-testid={`calendar-alt-${row.id}-${i}`}
                  data-selected={sel}
                  onClick={() =>
                    setAfter({ startUtc: a.startUtc, endUtc: a.endUtc })
                  }
                  style={{
                    padding: '6px 12px',
                    border: `1px solid ${sel ? 'var(--gold)' : 'var(--rule)'}`,
                    borderRadius: 6,
                    background: sel ? 'rgba(184,134,11,0.08)' : 'var(--paper)',
                    fontSize: 12.5,
                    color: sel ? 'var(--ink)' : 'var(--gray)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {fmtTime(a.startUtc, tz)}
                  {a.primeTimeMatched ? <span style={{ color: 'var(--gold)' }}>★</span> : ''}
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
            border: '1px solid var(--rule)',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          <legend
            className="smallcaps"
            style={{ color: 'var(--gray-soft)' }}
            aria-hidden="true"
          >
            Recurring event
          </legend>
          {(['this', 'future', 'all'] as const).map((s) => (
            <label key={s} style={{ marginRight: 14, fontSize: 13, color: 'var(--ink-soft)' }}>
              <input
                type="radio"
                name={`scope-${row.id}`}
                data-testid={`calendar-scope-${row.id}-${s}`}
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                style={{ accentColor: 'var(--gold)', marginRight: 4 }}
              />
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
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--rose)',
                padding: 0,
              }}
            >
              ↳ Override hard conflict and schedule anyway
            </button>
          ) : (
            <input
              type="text"
              data-testid={`calendar-override-reason-${row.id}`}
              placeholder="Reason for override (required)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid var(--rose)',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {showApprovalActions && (
          <>
            <Button
              variant="primary"
              data-testid={`approval-approve-${row.id}`}
              disabled={
                busy ||
                isSending ||
                isTerminal ||
                (hardConflicts.length > 0 && (!showOverride || !overrideReason.trim()))
              }
              onClick={() => void handleApprove()}
              style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
            >
              {isSending ? 'Sending...' : 'Approve & apply'}
            </Button>
            <Button
              variant="ghost"
              data-testid={`approval-reject-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={() => void props.onReject(row.id)}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              data-testid={`approval-snooze-${row.id}`}
              disabled={busy || isSending || isTerminal}
              onClick={() => {
                const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                void props.onSnooze(row.id, until);
              }}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
            >
              Snooze 1h
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

// ─── task_batch variant ────────────────────────────────────────────────────

interface TaskBatchAction {
  id: string;
  text: string;
  owner: 'self' | 'follow-up' | 'unassigned';
  followUpWith?: string | null;
  dueIso?: string | null;
  dueRaw?: string | null;
  priorityHint?: 'p1' | 'p2' | 'p3' | 'p4' | null;
  citationStart: number;
  citationEnd: number;
  status?: string;
}

export function TaskBatchApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { row } = props;
  const actions = safeParseJson<TaskBatchAction[]>(row.body_original) ?? [];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(actions.filter((action) => action.owner !== 'unassigned').map((action) => action.id)),
  );
  const [busy, setBusy] = useState(false);

  async function approve(): Promise<void> {
    setBusy(true);
    try {
      const approved = actions.filter((action) => selected.has(action.id));
      await props.onApprove(row.id, { body: JSON.stringify(approved) });
    } finally {
      setBusy(false);
    }
  }

  const unassignedCount = actions.filter((a) => a.owner === 'unassigned').length;

  return (
    <article
      data-testid={`approval-card-${row.id}`}
      data-kind="task_batch"
      data-state={row.state}
      style={articleStyle(busy)}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        {props.selectable && (
          <input
            type="checkbox"
            data-testid={`approval-select-${row.id}`}
            checked={props.selected}
            onChange={(event) => props.onSelect(row.id, event.target.checked)}
            style={{ accentColor: 'var(--gold)', marginTop: 4 }}
          />
        )}
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginTop: 4,
          }}
        >
          Tasks
        </span>
        <strong
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.3,
          }}
        >
          {row.subject ?? 'Meeting actions'}
        </strong>
        <StateBadge state={row.state} id={row.id} />
      </header>
      <BackendError row={row} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={chipStyle('moss')}>{actions.length} extracted</span>
        <span style={chipStyle('blue')}>target: Todoist</span>
        {unassignedCount > 0 && (
          <span style={chipStyle()}>{unassignedCount} need owner</span>
        )}
      </div>
      <div data-testid={`task-batch-actions-${row.id}`} style={{ marginBottom: 12 }}>
        {actions.map((action) => {
          const isPushable = action.owner !== 'unassigned';
          return (
            <label
              key={action.id}
              data-testid={`task-batch-action-${action.id}`}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: '10px 12px',
                marginBottom: 8,
                borderRadius: 6,
                background: isPushable ? 'var(--ivory)' : 'transparent',
                border: '1px solid var(--rule)',
                opacity: isPushable ? 1 : 0.6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(action.id)}
                disabled={!isPushable}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(action.id);
                  else next.delete(action.id);
                  setSelected(next);
                }}
                style={{ accentColor: 'var(--gold)', marginTop: 4 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>
                  {action.text}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10.5,
                    color: 'var(--gray-soft)',
                    letterSpacing: '0.04em',
                  }}
                >
                  owner: <span style={{ color: 'var(--gray)' }}>{action.owner}{action.followUpWith ? ` (${action.followUpWith})` : ''}</span>
                  {action.dueIso || action.dueRaw ? <> · due <span style={{ color: 'var(--gray)' }}>{action.dueIso ?? action.dueRaw}</span></> : null}
                  {action.priorityHint ? <> · <span style={{ color: 'var(--gold)' }}>{action.priorityHint}</span></> : null}
                  {` · citation ${action.citationStart}-${action.citationEnd}`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          data-testid={`approval-approve-${row.id}`}
          disabled={busy || selected.size === 0 || row.state !== 'ready'}
          onClick={() => void approve()}
          style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5, opacity: (busy || selected.size === 0 || row.state !== 'ready') ? 0.4 : 1 }}
        >
          Approve selected actions
        </Button>
        <Button
          variant="ghost"
          data-testid={`approval-reject-${row.id}`}
          disabled={busy || row.state !== 'ready'}
          onClick={() => void props.onReject(row.id)}
          style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
        >
          Reject batch
        </Button>
      </div>
    </article>
  );
}
