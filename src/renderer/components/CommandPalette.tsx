/**
 * Plan 07-03 Task 6 — Global Cmd/Ctrl+K command palette.
 *
 * Powered by `cmdk@1.1.1` (per CONTEXT.md §4).
 *
 * Behavior (REVIEWS C9):
 *   - Cmd-K is EPHEMERAL by default. Each Enter creates a TRANSIENT thread
 *     server-side (so routing/cost logging still happen) but the renderer
 *     does not surface it in /ask's sidebar (`title.startsWith('(transient)')`
 *     filter applied in AskScreen).
 *   - "Expand to chat" creates a NEW non-transient thread via
 *     `ragThreadCreate({ seedTurns: [user, assistant] })` carrying the
 *     CURRENT Q+A as turn 0/1, then router-navigates to `/ask?thread=<id>`.
 *   - Distinct visual modes per response kind: answer / refusal (neutral) /
 *     error (red Alert) / disambiguation (candidate buttons).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import type {
  RagAskResponse,
  RagAnswerResultDto,
  RagCitationDto,
  RagRoutingDto,
} from '../../shared/ipc-contract';

type Mode = 'idle' | 'loading' | 'result';

interface Result {
  question: string;
  response: RagAskResponse;
}

export function CommandPalette(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const navigate = useNavigate();

  // Cmd/Ctrl + K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setMode('loading');
    const res = await window.aria.ragAsk({ question: q, transient: true });
    if ('error' in res) {
      setResult({
        question: q,
        response: { kind: 'error', text: (res as { error: string }).error },
      });
    } else {
      setResult({ question: q, response: res as RagAskResponse });
    }
    setMode('result');
  }, []);

  const onExpand = useCallback(async () => {
    if (!result || result.response.kind !== 'answer') return;
    const ans = result.response;
    const created = await window.aria.ragThreadCreate({
      seedTurns: [
        { role: 'user', text: result.question },
        {
          role: 'assistant',
          text: ans.text,
          citations: ans.citations,
          routing: ans.routing,
        },
      ],
    });
    if ('error' in created) return;
    const tid = (created as { thread: { id: string } }).thread.id;
    setOpen(false);
    setMode('idle');
    setQuery('');
    setResult(null);
    navigate(`/ask?thread=${encodeURIComponent(tid)}`);
  }, [navigate, result]);

  if (!open) return <></>;

  return (
    <div
      data-testid="command-palette-root"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        style={{
          width: 'min(640px, 92vw)',
          background: 'var(--aria-bg, #fff)',
          color: 'var(--aria-fg, #0f172a)',
          borderRadius: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <Command label="Ask Aria">
          <Command.Input
            data-testid="command-palette-input"
            placeholder="Ask Aria…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void ask(query);
              }
            }}
            style={{
              width: '100%',
              padding: '14px 18px',
              fontSize: 16,
              border: 'none',
              outline: 'none',
              borderBottom: '1px solid var(--aria-border, #e5e7eb)',
              background: 'transparent',
              color: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <Command.List style={{ padding: 12, maxHeight: '50vh', overflowY: 'auto' }}>
            {mode === 'idle' && (
              <Command.Empty>Press Enter to ask Aria a question about your data.</Command.Empty>
            )}
            {mode === 'loading' && (
              <div data-testid="command-palette-loading" style={{ padding: 8 }}>
                Thinking…
              </div>
            )}
            {mode === 'result' && result && (
              <ResultPanel result={result} onExpand={onExpand} />
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  onExpand,
}: {
  result: Result;
  onExpand: () => void;
}): JSX.Element {
  const r = result.response;
  if (r.kind === 'refusal') {
    return (
      <div
        data-testid="cmdk-refusal"
        style={{ padding: 10, background: 'var(--aria-gray-50,#f8fafc)', borderRadius: 8 }}
      >
        {r.text}
      </div>
    );
  }
  if (r.kind === 'error') {
    return (
      <div
        data-testid="cmdk-error"
        role="alert"
        style={{
          padding: 10,
          background: '#fef2f2',
          color: '#991b1b',
          borderRadius: 8,
          border: '1px solid #fecaca',
        }}
      >
        {r.text}
      </div>
    );
  }
  if (r.kind === 'disambiguation') {
    return (
      <div data-testid="cmdk-disambiguation" style={{ padding: 10 }}>
        <p>Multiple people match — which did you mean?</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.candidates.map((c) => (
            <li key={c.personId} style={{ marginTop: 4 }}>
              <button type="button">{c.displayName}</button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <AnswerPanel question={result.question} answer={r} onExpand={onExpand} />;
}

function AnswerPanel({
  answer,
  onExpand,
}: {
  question: string;
  answer: RagAnswerResultDto;
  onExpand: () => void;
}): JSX.Element {
  return (
    <div data-testid="cmdk-answer" style={{ padding: 10 }}>
      <p style={{ marginTop: 0 }}>{answer.text}</p>
      {answer.citations.slice(0, 3).length > 0 && (
        <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
          {answer.citations.slice(0, 3).map((c) => (
            <li key={`${c.sourceKind}:${c.sourceId}:${c.index}`}>
              <strong>{c.title}</strong>
              <span style={{ color: 'var(--aria-muted, #64748b)', marginLeft: 6 }}>
                {c.snippet}
              </span>
            </li>
          ))}
        </ol>
      )}
      <button type="button" data-testid="cmdk-expand-chat" onClick={onExpand}>
        Expand to chat →
      </button>
      <RoutingTag routing={answer.routing} />
    </div>
  );
}

function RoutingTag({ routing }: { routing: RagRoutingDto }): JSX.Element {
  const tag = useMemo(
    () => `${routing.route.toLowerCase()} · ${routing.sensitivity}`,
    [routing],
  );
  return (
    <span
      data-testid="cmdk-routing"
      style={{ marginLeft: 8, fontSize: 11, color: 'var(--aria-muted, #64748b)' }}
    >
      {tag}
    </span>
  );
}

// Re-export for test introspection.
export type { Result as _CmdKResult };
export type { RagCitationDto as _CmdKCitation };
