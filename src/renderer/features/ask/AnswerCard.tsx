/**
 * Plan 07-03 Task 7 — Answer card (handles answer / refusal / error /
 * disambiguation visual modes).
 */
import { useState } from 'react';
import type {
  RagAskResponse,
  RagAnswerResultDto,
} from '../../../shared/ipc-contract';
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
          padding: 12,
          background: 'var(--aria-gray-50, #f8fafc)',
          borderLeft: '3px solid #94a3b8',
          borderRadius: 6,
        }}
      >
        {response.text /* verbatim: REFUSAL_TEXT */}
        {response.text !== REFUSAL_TEXT && (
          <small style={{ color: '#dc2626' }}> [non-canonical refusal copy]</small>
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
          padding: 12,
          background: '#fef2f2',
          color: '#991b1b',
          border: '1px solid #fecaca',
          borderRadius: 6,
        }}
      >
        <p style={{ margin: 0 }}>{response.text}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} style={{ marginTop: 6 }}>
            Retry
          </button>
        )}
      </article>
    );
  }
  if (response.kind === 'disambiguation') {
    return (
      <article data-testid="answer-disambiguation" style={{ padding: 12 }}>
        <p>Multiple people match — which did you mean?</p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {response.candidates.map((c) => (
            <li key={c.personId} style={{ marginTop: 4 }}>
              <button
                type="button"
                data-testid={`disambiguate-${c.personId}`}
                onClick={() => onDisambiguate?.(c.personId)}
              >
                {c.displayName}
                {c.canonicalEmail ? ` (${c.canonicalEmail})` : ''}
              </button>
            </li>
          ))}
        </ul>
      </article>
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

  return (
    <article data-testid="answer-body" style={{ padding: 12 }}>
      <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{answer.text}</p>
      <CitationList citations={answer.citations} userIanaTz={userIanaTz} />
      <footer
        style={{
          marginTop: 8,
          fontSize: 11,
          color: 'var(--aria-muted, #64748b)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
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
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          <button
            type="button"
            data-testid="answer-thumb-up"
            aria-label="Thumbs up"
            aria-pressed={thumb === 1}
            onClick={() => void fire(1)}
            style={thumbStyle(thumb === 1)}
          >
            👍
          </button>
          <button
            type="button"
            data-testid="answer-thumb-down"
            aria-label="Thumbs down"
            aria-pressed={thumb === -1}
            onClick={() => void fire(-1)}
            style={thumbStyle(thumb === -1)}
          >
            👎
          </button>
        </span>
        {toast && (
          <span data-testid="answer-feedback-toast" role="status" style={{ marginLeft: 8 }}>
            {toast}
          </span>
        )}
      </footer>
    </article>
  );
}

function thumbStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#dbeafe' : 'transparent',
    border: `1px solid ${active ? '#1d4ed8' : '#d1d5db'}`,
    borderRadius: 12,
    fontSize: 12,
    padding: '1px 6px',
    cursor: 'pointer',
  };
}
