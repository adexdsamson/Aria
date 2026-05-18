/**
 * Plan 04-03 Task 2 — SchedulingChat surface.
 *
 * Mounts at /scheduling. Single NL textarea + Submit button. On submit calls
 * window.aria.schedulingPropose(nl) and renders one of three result types:
 *   - ProposeResultDto         → success toast with link to /approvals
 *   - ProposeClarificationDto  → candidate buttons; clicking calls
 *                                window.aria.schedulingConfirmTarget(nl, eventId)
 *   - ProposeRefusalDto        → friendly refusal message keyed on code
 */
import { useState } from 'react';
import type {
  ProposeResponse,
  ProposeResultDto,
  ProposeClarificationDto,
  ProposeRefusalDto,
} from '../../../shared/ipc-contract';

function isError(r: ProposeResponse): r is { error: string } {
  return !!r && typeof r === 'object' && 'error' in r;
}
function isClarification(r: ProposeResponse): r is ProposeClarificationDto {
  return !!r && typeof r === 'object' && 'needsClarification' in r;
}
function isRefusal(r: ProposeResponse): r is ProposeRefusalDto {
  return !!r && typeof r === 'object' && 'refused' in r;
}

const REFUSAL_COPY: Record<ProposeRefusalDto['code'], string> = {
  'cancel-not-in-v1':
    'Cancel commands are coming in v1.x — please do this one in Google Calendar for now.',
  'multi-attendee':
    'Multi-attendee calendar changes are coming in v1.x — please do this one in Google Calendar.',
  'no-match':
    "I couldn't find an event matching that description. Try the event title or a different time.",
  'parse-failed':
    "Sorry, I couldn't understand that scheduling command. Try rephrasing it.",
};

export function SchedulingChat(): JSX.Element {
  const [nl, setNl] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProposeResponse | null>(null);
  const [lastNl, setLastNl] = useState('');

  async function submit(): Promise<void> {
    if (!nl.trim() || pending) return;
    setPending(true);
    setResult(null);
    setLastNl(nl);
    try {
      const res = await window.aria.schedulingPropose({ nl });
      setResult(res);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  async function confirm(eventId: string): Promise<void> {
    setPending(true);
    try {
      const res = await window.aria.schedulingConfirmTarget({ nl: lastNl, eventId });
      setResult(res);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      data-testid="scheduling-chat"
      style={{ padding: 'var(--aria-space-xl)', color: 'var(--aria-fg)' }}
    >
      <h1 style={{ fontSize: 'var(--aria-type-3xl)', margin: 0, marginBottom: 16 }}>
        Scheduling
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
        Type a scheduling command in natural language. Aria will draft a calendar change
        and surface it on the Approvals page for review.
      </p>
      <textarea
        data-testid="scheduling-nl-input"
        rows={3}
        placeholder='e.g. "move my 3pm to Thursday"'
        value={nl}
        onChange={(e) => setNl(e.target.value)}
        disabled={pending}
        style={{ width: '100%', padding: 8, fontFamily: 'inherit', fontSize: 13 }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          data-testid="scheduling-submit"
          disabled={pending || !nl.trim()}
          onClick={() => void submit()}
        >
          {pending ? 'Working…' : 'Submit'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          {isError(result) && (
            <p
              data-testid="scheduling-error"
              role="alert"
              style={{ color: '#b91c1c', fontSize: 13 }}
            >
              {result.error}
            </p>
          )}
          {isRefusal(result) && (
            <p
              data-testid="scheduling-refusal"
              data-code={result.code}
              role="alert"
              style={{
                background: '#fef3c7',
                color: '#92400e',
                padding: 12,
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {result.message || REFUSAL_COPY[result.code]}
            </p>
          )}
          {isClarification(result) && (
            <div data-testid="scheduling-clarification">
              <p style={{ fontSize: 13 }}>I found multiple matching events — which one?</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {result.candidates.map((c) => (
                  <button
                    key={c.eventId}
                    type="button"
                    data-testid={`scheduling-candidate-${c.eventId}`}
                    disabled={pending}
                    onClick={() => void confirm(c.eventId)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      background: '#fff',
                    }}
                  >
                    {c.summary} — {new Date(c.startUtc).toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isError(result) && !isRefusal(result) && !isClarification(result) && (
            <p
              data-testid="scheduling-success"
              data-approval-id={(result as ProposeResultDto).approvalId}
              style={{
                background: '#dcfce7',
                color: '#166534',
                padding: 12,
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              Proposed calendar change is ready for review on{' '}
              <a href="/approvals">the Approvals page</a>.
              {(result as ProposeResultDto).primaryFeasible
                ? ' No hard conflicts detected.'
                : ` ${(result as ProposeResultDto).conflicts.length} conflict(s) detected — see alternatives.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
