/**
 * Plan 03-03 Task 2 — ThreadSummaryModal (EMAIL-04).
 *
 * On-demand thread-summary dialog. Wraps the IPC call to
 * `aria.triageSummarizeThread({ threadId })`, with loading + error + retry
 * states. Result is request-scoped (not persisted); closing the modal
 * discards the rendered summary.
 *
 * Uses inline styles (matching ApprovalCard's existing Plan 03-01 visual
 * style) to avoid adding new UI deps in v1.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ThreadSummaryDto } from '../../../shared/ipc-contract';

export interface ThreadSummaryModalProps {
  threadId: string;
  open: boolean;
  onClose(): void;
}

type Phase = 'loading' | 'error' | 'ready';

export function ThreadSummaryModal(props: ThreadSummaryModalProps): JSX.Element | null {
  const { threadId, open, onClose } = props;
  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<ThreadSummaryDto | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const fetchSummary = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const result = await window.aria.triageSummarizeThread({ threadId });
      if (result && typeof result === 'object' && 'error' in result) {
        setErrorMsg(String((result as { error: string }).error));
        setPhase('error');
        return;
      }
      setSummary(result as ThreadSummaryDto);
      setPhase('ready');
    } catch (err) {
      setErrorMsg((err as Error).message || 'unknown error');
      setPhase('error');
    }
  }, [threadId]);

  useEffect(() => {
    if (open) {
      void fetchSummary();
    }
  }, [open, fetchSummary]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="thread-summary-title"
      data-testid="thread-summary-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          padding: 20,
          borderRadius: 8,
          maxWidth: 640,
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 id="thread-summary-title" style={{ margin: 0, fontSize: 18 }}>
            Thread Summary
          </h2>
          <button
            type="button"
            data-testid="thread-summary-close"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 0,
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </header>

        {phase === 'loading' && (
          <p data-testid="thread-summary-loading" style={{ color: '#6b7280' }}>
            Summarizing thread…
          </p>
        )}

        {phase === 'error' && (
          <div data-testid="thread-summary-error">
            <p style={{ color: '#991b1b' }}>Couldn’t summarize thread: {errorMsg}</p>
            <button
              type="button"
              data-testid="thread-summary-retry"
              onClick={() => void fetchSummary()}
            >
              Retry
            </button>
          </div>
        )}

        {phase === 'ready' && summary && (
          <div data-testid="thread-summary-content">
            <p style={{ marginTop: 0 }}>{summary.summary}</p>
            {summary.decisions.length > 0 && (
              <>
                <h3 style={{ fontSize: 14 }}>Decisions</h3>
                <ul>
                  {summary.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </>
            )}
            {summary.open_questions.length > 0 && (
              <>
                <h3 style={{ fontSize: 14 }}>Open questions</h3>
                <ul>
                  {summary.open_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            {summary.participants.length > 0 && (
              <>
                <h3 style={{ fontSize: 14 }}>Participants</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {summary.participants.map((p) => (
                    <span
                      key={p}
                      style={{
                        background: '#e5e7eb',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
