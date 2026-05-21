/**
 * Plan 07-03 Task 7 + Phase 9 re-skin — /ask chat panel.
 *
 * Layout: thread sidebar (left) + main panel (right) with the active thread's
 * turn history + question input.
 *
 * IPC contract preserved:
 *   - ragThreadList / ragThreadGet / ragAsk / providerAccountsList
 *   - transient ("(transient)" prefix) threads filtered out (REVIEWS C9)
 *   - ?thread=<id> query param hydrates the chosen thread (C9 echo)
 *   - routing.directoryStale rendered in AnswerCard (C10 echo)
 *
 * Phase 9 re-skin: editorial threads rail + per-account filter chips +
 * editorial composer. data-testids unchanged.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  ProviderAccountDto,
  RagAskRequest,
  RagAskResponse,
  RagThreadDto,
  RagTurnDto,
} from '../../../shared/ipc-contract';
import { Button } from '../../components/editorial';
import { AnswerCard } from './AnswerCard';

type LoadedTurns = { thread: RagThreadDto; turns: RagTurnDto[] } | null;

function ipcErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function AskScreen(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialThreadId = params.get('thread') ?? undefined;
  const tz = useMemo(() => userTimeZone(), []);

  const [threads, setThreads] = useState<RagThreadDto[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(initialThreadId);
  const [loaded, setLoaded] = useState<LoadedTurns>(null);
  const [accounts, setAccounts] = useState<ProviderAccountDto[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<RagAskResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshThreads = useCallback(async () => {
    const res = await window.aria.ragThreadList({});
    if (ipcErr(res)) return;
    // Filter out transient Cmd-K threads (C9).
    setThreads(res.threads.filter((t) => !t.title.startsWith('(transient)')));
  }, []);

  const loadThread = useCallback(async (tid: string) => {
    const res = await window.aria.ragThreadGet({ threadId: tid, lastN: 100 });
    if (res === null || ipcErr(res)) {
      setLoaded(null);
      return;
    }
    setLoaded(res);
  }, []);

  const refreshAccounts = useCallback(async () => {
    const res = await window.aria.providerAccountsList();
    if (ipcErr(res)) return;
    setAccounts(res.rows);
  }, []);

  useEffect(() => {
    void refreshThreads();
    void refreshAccounts();
  }, [refreshThreads, refreshAccounts]);

  useEffect(() => {
    if (activeThreadId) void loadThread(activeThreadId);
  }, [activeThreadId, loadThread]);

  const accountFilter = useMemo<RagAskRequest['accountFilter']>(() => {
    if (selectedAccountIds.size === 0) return undefined;
    return accounts
      .filter((a) => selectedAccountIds.has(`${a.providerKey}:${a.accountId}`))
      .map((a) => ({ providerKey: a.providerKey, accountId: a.accountId }));
  }, [accounts, selectedAccountIds]);

  const onAsk = useCallback(async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setPending(null);
    const req: RagAskRequest = {
      question,
      threadId: activeThreadId,
      accountFilter,
    };
    const res = await window.aria.ragAsk(req);
    if (ipcErr(res)) {
      setPending({ kind: 'error', text: res.error });
      setBusy(false);
      return;
    }
    setPending(res);
    setBusy(false);
    setQuestion('');
    if (
      (res.kind === 'answer' || res.kind === 'refusal') &&
      'threadId' in res &&
      res.threadId
    ) {
      setActiveThreadId(res.threadId);
      await refreshThreads();
      await loadThread(res.threadId);
    }
  }, [question, busy, activeThreadId, accountFilter, refreshThreads, loadThread]);

  const onDisambiguate = useCallback(
    async (personId: string) => {
      setBusy(true);
      const res = await window.aria.ragAsk({
        question,
        threadId: activeThreadId,
        forcePersonId: personId,
        accountFilter,
      });
      setBusy(false);
      if (!ipcErr(res)) setPending(res);
    },
    [question, activeThreadId, accountFilter],
  );

  return (
    <div
      data-testid="ask-screen"
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--ivory)',
        color: 'var(--ink)',
      }}
    >
      {/* Thread sidebar */}
      <aside
        data-testid="ask-thread-sidebar"
        style={{
          width: 256,
          flexShrink: 0,
          borderRight: '1px solid var(--rule)',
          padding: '20px 16px',
          overflowY: 'auto',
          background: 'var(--ivory)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 12,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: '1.125rem',
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
            }}
          >
            Threads
          </h3>
          <button
            type="button"
            data-testid="ask-new-thread"
            onClick={() => {
              setActiveThreadId(undefined);
              setLoaded(null);
              setPending(null);
              navigate('/ask');
            }}
            aria-label="New thread"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 16,
              lineHeight: 1,
              width: 26,
              height: 26,
              borderRadius: 4,
              border: '1px solid var(--rule-strong)',
              background: 'var(--paper)',
              color: 'var(--gold-deep)',
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </header>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          {threads.length === 0 && (
            <li
              style={{
                fontFamily: 'var(--f-body)',
                fontStyle: 'italic',
                fontSize: 13,
                color: 'var(--gray-soft)',
                padding: '8px 6px',
              }}
            >
              No prior threads yet.
            </li>
          )}
          {threads.map((t) => {
            const active = t.id === activeThreadId;
            return (
              <li key={t.id} style={{ marginBottom: 2 }}>
                <button
                  type="button"
                  data-testid={`ask-thread-${t.id}`}
                  onClick={() => setActiveThreadId(t.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius)',
                    background: active ? 'var(--ivory-deep)' : 'transparent',
                    borderLeft: active
                      ? '2px solid var(--gold)'
                      : '2px solid transparent',
                    border: 'none',
                    borderLeftWidth: 2,
                    borderLeftStyle: 'solid',
                    borderLeftColor: active ? 'var(--gold)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--f-body)',
                    fontSize: 13.5,
                    color: active ? 'var(--ink)' : 'var(--ink-soft)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {t.title}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Ephemeral / Cmd-K hint — design-ref left-rail footer note */}
        <p
          style={{
            marginTop: 'auto',
            paddingTop: 20,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            lineHeight: 1.55,
          }}
        >
          ⌘K answers are ephemeral. Use "Expand to chat" to keep one.
        </p>
      </aside>

      {/* Main panel */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          data-testid="ask-account-filter-bar"
          style={{
            display: 'flex',
            gap: 6,
            padding: '14px 24px',
            borderBottom: '1px solid var(--rule)',
            flexWrap: 'wrap',
            alignItems: 'center',
            background: 'var(--ivory)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
              marginRight: 8,
            }}
          >
            Search across
          </span>
          {accounts.length === 0 && (
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: 'var(--gray-soft)',
                letterSpacing: '0.1em',
              }}
            >
              none connected
            </span>
          )}
          {accounts.map((a) => {
            const k = `${a.providerKey}:${a.accountId}`;
            const selected = selectedAccountIds.has(k);
            return (
              <button
                key={k}
                type="button"
                data-testid={`ask-filter-${a.providerKey}-${a.accountId}`}
                onClick={() => {
                  setSelectedAccountIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  });
                }}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  padding: '4px 10px',
                  border: `1px solid ${selected ? 'var(--gold)' : 'var(--rule-strong)'}`,
                  borderRadius: 999,
                  background: selected ? 'rgba(184,134,11,0.10)' : 'var(--paper)',
                  color: selected ? 'var(--gold-deep)' : 'var(--gray)',
                  cursor: 'pointer',
                }}
              >
                {a.providerKey === 'microsoft' ? 'M' : 'G'} {a.displayEmail}
              </button>
            );
          })}
        </header>

        <section
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
            maxWidth: 'var(--container)',
            width: '100%',
            margin: '0 auto',
            boxSizing: 'border-box',
          }}
        >
          {loaded && (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {loaded.turns.map((t) => (
                <li
                  key={t.id}
                  data-testid={`ask-turn-${t.id}`}
                  style={{ marginBottom: 18 }}
                >
                  {t.role === 'user' ? (
                    <UserTurn text={t.text} />
                  ) : (
                    <AnswerCard
                      response={renderTurnAsResponse(t)}
                      userIanaTz={tz}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          {pending && (
            <AnswerCard
              response={pending}
              userIanaTz={tz}
              onDisambiguate={onDisambiguate}
              onRetry={() => void onAsk()}
            />
          )}
        </section>

        <footer
          style={{
            display: 'flex',
            gap: 10,
            padding: '14px 24px',
            borderTop: '1px solid var(--rule)',
            background: 'var(--ivory)',
            alignItems: 'flex-end',
          }}
        >
          <textarea
            data-testid="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your data…"
            rows={2}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: 'var(--paper)',
              color: 'var(--ink)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: 15,
              lineHeight: 1.5,
              outline: 'none',
              resize: 'vertical',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onAsk();
              }
            }}
          />
          <Button
            data-testid="ask-submit"
            onClick={() => void onAsk()}
            disabled={busy}
            variant="primary"
          >
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </footer>

        {/* Routing/privacy caption row — design-ref footer microcopy. Tells the
            user what runs locally vs. what routes to the local LLM. */}
        <div
          aria-hidden="true"
          style={{
            padding: '8px 24px 14px',
            background: 'var(--ivory)',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span>BM25 + nomic-embed-text</span>
          <span>·</span>
          <span>Queries stay local</span>
          <span>·</span>
          <span>PII routes to llama3.1:8b</span>
        </div>
      </main>
    </div>
  );
}

function UserTurn({ text }: { text: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 14px',
          background: 'var(--ivory-deep)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function renderTurnAsResponse(t: RagTurnDto): RagAskResponse {
  if (t.role === 'user') {
    return { kind: 'error', text: t.text }; // not used
  }
  // Refusal turns store the verbatim copy.
  if (t.text === "I couldn't find anything in your data about that.") {
    return {
      kind: 'refusal',
      text: t.text,
      threadId: t.threadId,
      turnId: t.id,
    };
  }
  return {
    kind: 'answer',
    text: t.text,
    citations: t.citations ?? [],
    routing: t.routing ?? {
      route: 'LOCAL',
      modelId: '',
      sensitivity: 'unknown',
      reason: '',
    },
    threadId: t.threadId,
    turnId: t.id,
  };
}
