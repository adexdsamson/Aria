/**
 * Plan 07-03 Task 7 + Phase 9 re-skin — Answer card.
 *
 * Modes: answer | refusal | error | disambiguation.
 *
 * IPC + behaviour preserved:
 *  - REFUSAL_TEXT canonical copy guarded (non-canonical surface flagged inline).
 *  - ragTurnFeedback wired to thumb up/down with optimistic rollback.
 *  - directoryStale → directory-stale-hint badge (C10 echo).
 *  - data-testids unchanged.
 */
import { useState } from 'react';
import type { RagAnswerResultDto, RagAskResponse } from '../../../shared/ipc-contract';
import { Card, RouteBadge } from '../../components/editorial';
import { CitationList } from './CitationList';

export interface AnswerCardProps {
  response: RagAskResponse;
  userIanaTz: string;
  onDisambiguate?: (personId: string) => void;
  onRetry?: () => void;
}

const REFUSAL_TEXT = "I couldn't find anything in your data about that.";

export function AnswerCard({
  response,
  userIanaTz,
  onDisambiguate,
  onRetry,
}: AnswerCardProps): JSX.Element {
  if (response.kind === 'refusal') {
    return (
      <article
        data-testid="answer-refusal"
        style={{
          padding: '14px 18px',
          background: 'var(--ivory-deep)',
          borderLeft: '3px solid var(--gray-faint)',
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink-soft)',
        }}
      >
        <div
          className="smallcaps"
          style={{ color: 'var(--gray-soft)', marginBottom: 6 }}
        >
          No answer found
        </div>
        <span>{response.text /* verbatim: REFUSAL_TEXT */}</span>
        {response.text !== REFUSAL_TEXT && (
          <small style={{ color: 'var(--rose)' }}> [non-canonical refusal copy]</small>
        )}
      </article>
    );
  }
  if (response.kind === 'error') {
    return (
      <article
        data-testid="answer-error"
        role="alert"
        style={{
          padding: '14px 18px',
          background: 'rgba(184,73,58,0.06)',
          color: 'var(--rose)',
          border: '1px solid var(--rose)',
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--f-body)',
          fontSize: 14,
        }}
      >
        <div
          className="smallcaps"
          style={{ color: 'var(--rose)', marginBottom: 4 }}
        >
          Error
        </div>
        <p style={{ margin: 0 }}>{response.text}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 10,
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              padding: '4px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--rose)',
              background: 'transparent',
              color: 'var(--rose)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        )}
      </article>
    );
  }
  if (response.kind === 'disambiguation') {
    return (
      <Card>
        <article
          data-testid="answer-disambiguation"
          style={{ borderTop: '2px solid var(--rose)', marginTop: -4, paddingTop: 8 }}
        >
          <div
            className="smallcaps"
            style={{ color: 'var(--rose)', marginBottom: 8 }}
          >
            Multiple people match
          </div>
          <p
            style={{
              margin: '0 0 12px',
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: '1.0625rem',
              color: 'var(--ink)',
            }}
          >
            Which did you mean?
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {response.candidates.map((c) => (
              <li key={c.personId} style={{ marginTop: 6 }}>
                <button
                  type="button"
                  data-testid={`disambiguate-${c.personId}`}
                  onClick={() => onDisambiguate?.(c.personId)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: '1px solid var(--rule)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--paper)',
                    cursor: 'pointer',
                    fontFamily: 'var(--f-body)',
                    fontSize: 14,
                    color: 'var(--ink)',
                  }}
                >
                  <strong>{c.displayName}</strong>
                  {c.canonicalEmail && (
                    <span style={{ color: 'var(--gray)', marginLeft: 8 }}>
                      ({c.canonicalEmail})
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </article>
      </Card>
    );
  }
  return <AnswerBody answer={response} userIanaTz={userIanaTz} />;
}

function AnswerBody({
  answer,
  userIanaTz,
}: {
  answer: RagAnswerResultDto;
  userIanaTz: string;
}): JSX.Element {
  // Plan 08-03 Task 5 — Q&A thumbs wired to RAG_TURN_FEEDBACK (same-txn with
  // rag_turn.thumb update; see src/main/learning/sources/qa.ts).
  const [thumb, setThumb] = useState<-1 | 0 | 1>(0);
  const [toast, setToast] = useState<string | null>(null);

  async function fire(t: -1 | 1): Promise<void> {
    const prev = thumb;
    setThumb(t);
    try {
      const r = await window.aria.ragTurnFeedback({ turnId: answer.turnId, thumb: t });
      if (r && typeof r === 'object' && 'error' in r) {
        setThumb(prev);
      } else {
        setToast('Thanks — feedback recorded.');
        setTimeout(() => setToast(null), 1500);
      }
    } catch {
      setThumb(prev);
    }
  }

  const route = answer.routing.route === 'FRONTIER' ? 'FRONTIER' : 'LOCAL';

  return (
    <article
      data-testid="answer-body"
      className="card card-accent-top"
      style={{ padding: '18px 22px' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="smallcaps"
          style={{ color: 'var(--gray)' }}
        >
          Answer
        </span>
        <RouteBadge route={route} />
        {answer.routing.modelId && (
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--gray-soft)',
            }}
          >
            · {answer.routing.modelId}
          </span>
        )}
      </header>
      <p
        style={{
          marginTop: 0,
          marginBottom: 12,
          fontFamily: 'var(--f-body)',
          fontSize: 15,
          lineHeight: 1.6,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {answer.text}
      </p>
      <CitationList citations={answer.citations} userIanaTz={userIanaTz} />
      <footer
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid var(--rule)',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--gray-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>
          {answer.routing.route.toLowerCase()} · {answer.routing.sensitivity}
          {answer.routing.directoryStale && (
            <span data-testid="directory-stale-hint" style={{ marginLeft: 8 }}>
              · people directory is rebuilding…
            </span>
          )}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            data-testid="answer-thumb-up"
            aria-label="Thumbs up"
            aria-pressed={thumb === 1}
            onClick={() => void fire(1)}
            style={thumbStyle(thumb === 1)}
          >
            ▲
          </button>
          <button
            type="button"
            data-testid="answer-thumb-down"
            aria-label="Thumbs down"
            aria-pressed={thumb === -1}
            onClick={() => void fire(-1)}
            style={thumbStyle(thumb === -1)}
          >
            ▼
          </button>
        </span>
        {toast && (
          <span
            data-testid="answer-feedback-toast"
            role="status"
            style={{ marginLeft: 8, color: 'var(--moss)' }}
          >
            {toast}
          </span>
        )}
      </footer>
    </article>
  );
}

function thumbStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    background: active ? 'rgba(184,134,11,0.12)' : 'transparent',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--rule-strong)'}`,
    color: active ? 'var(--gold-deep)' : 'var(--gray)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 11,
    padding: '2px 8px',
    cursor: 'pointer',
  };
}
