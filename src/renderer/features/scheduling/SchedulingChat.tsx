/**
 * Plan 04-03 Task 2 — SchedulingChat surface.
 *
 * Mounts at /scheduling. Single NL textarea + Submit button. On submit calls
 * window.aria.schedulingPropose(nl) and renders one of three result types:
 *   - ProposeResultDto         → success toast with link to /approvals
 *   - ProposeClarificationDto  → candidate buttons; clicking calls
 *                                window.aria.schedulingConfirmTarget(nl, eventId)
 *   - ProposeRefusalDto        → friendly refusal message keyed on code
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial composer card with Playfair
 * placeholder, moss/gold/rose result panes per design-ref/project/
 * app-screen-scheduling.jsx. IPC, parsing, and assertSelfOnly behaviour
 * preserved verbatim.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ProposeResponse,
  ProposeResultDto,
  ProposeClarificationDto,
  ProposeRefusalDto,
} from '../../../shared/ipc-contract';
import { Button } from '../../components/editorial';
import { frontierModelDisplay } from '../../../shared/frontier-labels';
import { useFrontierProvider } from '../../lib/useFrontierProvider';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const TRY_EXAMPLES = [
  'move my 3pm to Thursday',
  'push board prep to 4pm Friday',
  'find me 30 min with james before EOD',
  'decline the engineering standup tomorrow',
];

function isError(r: ProposeResponse): r is { error: string } {
  return !!r && typeof r === 'object' && 'error' in r;
}
function isClarification(r: ProposeResponse): r is ProposeClarificationDto {
  return !!r && typeof r === 'object' && 'needsClarification' in r;
}
function isRefusal(r: ProposeResponse): r is ProposeRefusalDto {
  return !!r && typeof r === 'object' && 'refused' in r;
}

function refusalMessage(result: ProposeRefusalDto): string {
  return result.message?.trim() || REFUSAL_COPY[result.code];
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
  const activeFrontierProvider = useFrontierProvider();
  const [nl, setNl] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProposeResponse | null>(null);
  const [lastNl, setLastNl] = useState('');
  const navigate = useNavigate();

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
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '32px 32px 80px',
        color: 'var(--ink)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          paddingBottom: 14,
          marginBottom: 14,
          borderBottom: '1px solid var(--rule)',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '2.25rem',
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Tell Aria what to move
        </h1>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            fontSize: 14,
          }}
        >
          Self-only changes only. Multi-attendee in v1.x.
        </span>
      </header>
      <p
        style={{
          fontSize: 14,
          color: 'var(--gray)',
          lineHeight: 1.6,
          margin: '0 0 22px 0',
          maxWidth: '48em',
        }}
      >
        Type a scheduling command in natural language. Aria parses your intent against your
        calendar and scheduling rules, drafts a change, and surfaces it on{' '}
        <a
          href="#"
          data-testid="scheduling-approvals-link"
          onClick={(e) => {
            e.preventDefault();
            navigate('/approvals');
          }}
          style={{
            color: 'var(--ink)',
            textDecoration: 'none',
            backgroundImage: 'linear-gradient(to right, var(--gold), var(--gold))',
            backgroundSize: '100% 1px',
            backgroundPosition: '0 100%',
            backgroundRepeat: 'no-repeat',
            paddingBottom: 1,
            transition: 'color 160ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold-deep)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink)')}
        >
          the Approvals page
        </a>{' '}
        for review.
      </p>

      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 10,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <textarea
          data-testid="scheduling-nl-input"
          rows={3}
          placeholder='e.g. "move my 3pm to Thursday"'
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          disabled={pending}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            background: 'transparent',
            fontFamily: 'var(--f-display)',
            fontSize: 19,
            lineHeight: 1.45,
            color: 'var(--ink)',
            letterSpacing: '-0.005em',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <Button
            variant="primary"
            data-testid="scheduling-submit"
            disabled={pending || !nl.trim()}
            onClick={() => void submit()}
            style={{
              minHeight: 34,
              padding: '0 18px',
              fontSize: 13,
              opacity: !nl.trim() || pending ? 0.4 : 1,
            }}
          >
            {pending ? 'Working…' : 'Submit'}
          </Button>
          <span style={{ flex: 1 }} />
          <span
            className="smallcaps"
            style={{ color: 'var(--gray-soft)' }}
            aria-hidden="true"
          >
            {`Routes through · FRONTIER ${frontierModelDisplay(activeFrontierProvider)} · NL intent parser`}
          </span>
        </div>
      </div>

      {/* "Try" example chips — click populates the input. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 28,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            marginRight: 4,
          }}
        >
          Try
        </span>
        {TRY_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            data-testid={`scheduling-try-${example.slice(0, 16).replace(/\s+/g, '-')}`}
            disabled={pending}
            onClick={() => setNl(example)}
            style={{
              padding: '6px 14px',
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: 13.5,
              color: 'var(--ink-soft)',
              background: 'var(--paper)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 999,
              cursor: pending ? 'not-allowed' : 'pointer',
              transition: `background 180ms ease, color 180ms ease, border-color 180ms ease, transform 140ms ${EASE_OUT}`,
            }}
            onMouseEnter={(e) => {
              if (!pending) {
                e.currentTarget.style.background = 'rgba(184,134,11,0.05)';
                e.currentTarget.style.borderColor = 'var(--gold-light)';
                e.currentTarget.style.color = 'var(--ink)';
              }
            }}
            onMouseLeave={(e) => {
              if (!pending) {
                e.currentTarget.style.background = 'var(--paper)';
                e.currentTarget.style.borderColor = 'var(--rule-strong)';
                e.currentTarget.style.color = 'var(--ink-soft)';
              }
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            "{example}"
          </button>
        ))}
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          {isError(result) && (
            <p
              data-testid="scheduling-error"
              role="alert"
              style={{
                color: '#7A2B20',
                background: 'rgba(184,73,58,0.08)',
                border: '1px solid rgba(184,73,58,0.25)',
                padding: '12px 16px',
                borderRadius: 6,
                fontSize: 13,
                margin: 0,
              }}
            >
              {result.error}
            </p>
          )}
          {isRefusal(result) && (
            <div
              role="alert"
              style={{
                background: 'rgba(184,134,11,0.08)',
                border: '1px solid rgba(184,134,11,0.30)',
                borderRadius: 8,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  className="smallcaps"
                  style={{ color: 'var(--gold-deep)' }}
                  aria-hidden="true"
                >
                  refused · {result.code}
                </div>
                <p
                  data-testid="scheduling-refusal"
                  data-code={result.code}
                  style={{
                    margin: '6px 0 0 0',
                    color: 'var(--ink-soft)',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {refusalMessage(result)}
                </p>
              </div>
            </div>
          )}
          {isClarification(result) && (
            <div
              data-testid="scheduling-clarification"
              style={{
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                borderRadius: 8,
                padding: '14px 18px',
              }}
            >
              <p
                style={{
                  margin: '0 0 10px 0',
                  fontFamily: 'var(--f-display)',
                  fontSize: 17,
                  color: 'var(--ink)',
                }}
              >
                I found multiple matching events — which one?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.candidates.map((c) => (
                  <button
                    key={c.eventId}
                    type="button"
                    data-testid={`scheduling-candidate-${c.eventId}`}
                    disabled={pending}
                    onClick={() => void confirm(c.eventId)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--rule)',
                      background: 'var(--ivory)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>
                      {c.summary}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        color: 'var(--gray)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {new Date(c.startUtc).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isError(result) && !isRefusal(result) && !isClarification(result) && (
            <div
              data-testid="scheduling-success"
              data-approval-id={(result as ProposeResultDto).approvalId}
              className="card-accent-top"
              style={{
                background: 'rgba(91,110,58,0.10)',
                border: '1px solid rgba(91,110,58,0.30)',
                borderTop: '2px solid var(--gold)',
                borderRadius: 8,
                padding: '14px 18px',
                fontSize: 13.5,
                color: 'var(--ink-soft)',
                lineHeight: 1.55,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 17,
                  color: 'var(--ink)',
                  marginBottom: 6,
                }}
              >
                Proposed change ready
              </div>
              Proposed calendar change is ready for review on{' '}
              <a
                href="/approvals"
                style={{
                  color: 'var(--gold-deep)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                the Approvals page
              </a>
              .{' '}
              {(result as ProposeResultDto).primaryFeasible
                ? 'No hard conflicts detected.'
                : `${(result as ProposeResultDto).conflicts.length} conflict(s) detected — see alternatives.`}
            </div>
          )}
        </div>
      )}

      {/* "How this works" explainer — design-ref shows a quiet
          editorial block teaching the proposal-review flow. */}
      <aside
        data-testid="scheduling-how-it-works"
        aria-labelledby="scheduling-how-it-works-title"
        style={{
          marginTop: 40,
          padding: '20px 24px',
          background: 'var(--ivory-deep)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div
          id="scheduling-how-it-works-title"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 10,
          }}
        >
          How this works
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--ink-soft)',
            lineHeight: 1.65,
            maxWidth: '52em',
            textWrap: 'pretty' as const,
          }}
        >
          Aria parses your sentence, matches it against your real calendar, evaluates conflicts
          against your scheduling rules (focus blocks, no-meeting windows, buffers), and proposes
          one or more alternative slots. Nothing is sent until you approve the change.
        </p>
      </aside>
    </section>
  );
}
