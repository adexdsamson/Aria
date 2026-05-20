/**
 * Plan 07-03 Task 6 — Global Cmd/Ctrl+K command palette.
 * Phase 9 Plan 02 Task 3 — re-skinned to editorial visual (ivory card, gold
 * accents, Playfair input). IPC plumbing + Cmd-K hotkey untouched; only the
 * JSX + inline styles change.
 *
 * Behavior (REVIEWS C9):
 *   - Cmd-K is EPHEMERAL by default. Each Enter creates a TRANSIENT thread
 *     server-side (so routing/cost logging still happen) but the renderer
 *     does not surface it in /ask's sidebar.
 *   - "Expand to chat" creates a NEW non-transient thread via
 *     ragThreadCreate({ seedTurns: [user, assistant] }) carrying the
 *     CURRENT Q+A as turn 0/1, then router-navigates to /ask?thread=<id>.
 *   - Distinct visual modes per response kind.
 *
 * Topbar bridge: a `aria:cmdk-toggle` CustomEvent fired from the Topbar /
 * SideNav ⌘K buttons opens (or toggles) the palette without needing the
 * physical hotkey.
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
import { KbdHint, Button } from './editorial';

type Mode = 'idle' | 'loading' | 'result';

interface Result {
  question: string;
  response: RagAskResponse;
}

const EXAMPLE_QUERIES = [
  'What did Sarah commit to on the board deck?',
  'When did I last talk to David Yoo?',
  'Open items from the Acme kickoff',
  'Show pricing memo thread',
];

export function CommandPalette(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const navigate = useNavigate();

  // Cmd/Ctrl + K toggle + custom-event bridge from Topbar / SideNav buttons.
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
    function onToggle(): void {
      setOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('aria:cmdk-toggle', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('aria:cmdk-toggle', onToggle);
    };
  }, [open]);

  // Reset transient state when palette closes.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setMode('idle');
      setResult(null);
    }
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
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)',
          background: 'var(--ivory)',
          border: '1px solid var(--rule-strong)',
          borderRadius: 10,
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          overflow: 'hidden',
        }}
      >
        <Command label="Ask Aria">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <Command.Input
              data-testid="command-palette-input"
              autoFocus
              placeholder="Ask anything across your mail, meetings, tasks…"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void ask(query);
                }
              }}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'var(--f-display)',
                fontSize: 20,
                color: 'var(--ink)',
              }}
            />
            <KbdHint>ephemeral</KbdHint>
            <KbdHint>esc</KbdHint>
          </div>
          <Command.List
            style={{ padding: '14px 18px 18px', maxHeight: '50vh', overflowY: 'auto' }}
          >
            {mode === 'idle' && (
              <Command.Empty>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    className="smallcaps"
                    style={{ color: 'var(--gray-soft)' }}
                  >
                    Try
                  </div>
                  {EXAMPLE_QUERIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setQuery(s);
                        void ask(s);
                      }}
                      style={{
                        all: 'unset',
                        boxSizing: 'border-box',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 6,
                        color: 'var(--ink-soft)',
                        fontSize: 13.5,
                        fontFamily: 'var(--f-display)',
                        fontStyle: 'italic',
                      }}
                    >
                      “{s}”
                    </button>
                  ))}
                </div>
              </Command.Empty>
            )}
            {mode === 'loading' && (
              <div
                data-testid="command-palette-loading"
                style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gray)' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: 'var(--gold)',
                  }}
                >
                  Searching
                </span>
                <span style={{ fontStyle: 'italic', fontFamily: 'var(--f-display)' }}>
                  BM25 + nomic-embed-text v1.5…
                </span>
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
        style={{
          padding: 12,
          background: 'var(--ivory-deep)',
          borderRadius: 8,
          color: 'var(--ink)',
          fontSize: 13.5,
        }}
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
          padding: 12,
          background: 'rgba(190,52,52,0.08)',
          color: 'var(--rose)',
          borderRadius: 8,
          border: '1px solid rgba(190,52,52,0.25)',
          fontSize: 13.5,
        }}
      >
        {r.text}
      </div>
    );
  }
  if (r.kind === 'disambiguation') {
    return (
      <div data-testid="cmdk-disambiguation" style={{ padding: 4 }}>
        <p style={{ color: 'var(--ink)' }}>Multiple people match — which did you mean?</p>
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
    <div data-testid="cmdk-answer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          Answer
        </span>
        <RoutingTag routing={answer.routing} />
      </div>
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 15,
          lineHeight: 1.5,
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 12,
        }}
      >
        {answer.text}
      </p>
      {answer.citations.slice(0, 3).length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 14,
          }}
        >
          {answer.citations.slice(0, 3).map((c) => (
            <a
              key={`${c.sourceKind}:${c.sourceId}:${c.index}`}
              href="#"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                color: 'var(--gray)',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--gold)',
                }}
              >
                {c.sourceKind}
              </span>
              <span
                style={{
                  flex: 1,
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--rule-strong)',
                  textUnderlineOffset: 3,
                  color: 'var(--ink-soft)',
                }}
              >
                {c.title}
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  color: 'var(--gray-soft)',
                }}
              >
                {c.snippet}
              </span>
            </a>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button
          variant="primary"
          data-testid="cmdk-expand-chat"
          onClick={onExpand}
          style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
        >
          Expand to chat →
        </Button>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            color: 'var(--gray-soft)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Cmd-K answers don't appear in /ask threads
        </span>
      </div>
    </div>
  );
}

function RoutingTag({ routing }: { routing: RagRoutingDto }): JSX.Element {
  const tag = useMemo(
    () => `· [${routing.route}] · ${routing.sensitivity}`,
    [routing],
  );
  return (
    <span
      data-testid="cmdk-routing"
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        color: 'var(--gray-soft)',
      }}
    >
      {tag}
    </span>
  );
}

// Re-export for test introspection.
export type { Result as _CmdKResult };
export type { RagCitationDto as _CmdKCitation };
