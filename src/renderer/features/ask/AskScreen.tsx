/**
 * Plan 07-03 Task 7 — /ask chat panel.
 *
 * Layout: thread sidebar (left) + main panel (right) with the active thread's
 * turn history + question input.
 *
 * Surfaces:
 *   - thread list via ragThreadList; transient threads ("(transient)" prefix
 *     from Cmd-K) are FILTERED OUT (REVIEWS C9 — transient flow doesn't
 *     pollute the sidebar)
 *   - Multi-account filter chip-bar across the top (provider accounts)
 *   - C9 echo: ?thread=<id> query param hydrates the chosen thread
 *   - C10 echo: routing.directoryStale → "People directory is rebuilding…" hint
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
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(
    initialThreadId,
  );
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
    <div data-testid="ask-screen" style={{ display: 'flex', height: '100%' }}>
      {/* Thread sidebar */}
      <aside
        data-testid="ask-thread-sidebar"
        style={{
          width: 240,
          borderRight: '1px solid var(--aria-border, #e5e7eb)',
          padding: 12,
          overflowY: 'auto',
        }}
      >
        <header
          style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}
        >
          <h3 style={{ margin: 0 }}>Threads</h3>
          <button
            type="button"
            data-testid="ask-new-thread"
            onClick={() => {
              setActiveThreadId(undefined);
              setLoaded(null);
              setPending(null);
              navigate('/ask');
            }}
          >
            +
          </button>
        </header>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                data-testid={`ask-thread-${t.id}`}
                onClick={() => setActiveThreadId(t.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background:
                    t.id === activeThreadId
                      ? 'var(--aria-accent-bg, #eef2ff)'
                      : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main panel */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          data-testid="ask-account-filter-bar"
          style={{
            display: 'flex',
            gap: 6,
            padding: 8,
            borderBottom: '1px solid var(--aria-border, #e5e7eb)',
            flexWrap: 'wrap',
          }}
        >
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
                  padding: '2px 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 999,
                  background: selected ? '#eef2ff' : 'transparent',
                  fontSize: 12,
                }}
              >
                {a.providerKey === 'microsoft' ? 'M' : 'G'} {a.displayEmail}
              </button>
            );
          })}
        </header>

        <section style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loaded && (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {loaded.turns.map((t) => (
                <li
                  key={t.id}
                  data-testid={`ask-turn-${t.id}`}
                  style={{ marginBottom: 12 }}
                >
                  {t.role === 'user' ? (
                    <div style={{ fontWeight: 600 }}>You: {t.text}</div>
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
            gap: 8,
            padding: 8,
            borderTop: '1px solid var(--aria-border, #e5e7eb)',
          }}
        >
          <input
            data-testid="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your data…"
            style={{ flex: 1, padding: 8 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onAsk();
              }
            }}
          />
          <button
            type="button"
            data-testid="ask-submit"
            onClick={() => void onAsk()}
            disabled={busy}
          >
            Ask
          </button>
        </footer>
      </main>
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
