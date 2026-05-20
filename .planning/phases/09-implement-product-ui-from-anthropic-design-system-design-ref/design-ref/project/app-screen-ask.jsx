// app-screen-ask.jsx — Ask Aria (Plan 07-03 shipped UI).
//
// Mirrors AskScreen.tsx:
//   • Left sidebar: thread list (transient Cmd-K threads filtered out)
//   • Top: provider-account filter chip bar across all connected accounts
//   • Center: turn history with cited AnswerCard per assistant turn
//   • Footer: question input (Enter submits, Shift+Enter newline)
//   • Routing badge per answer: [LOCAL]/[FRONTIER] + model + reason

function ScreenAsk({ onNav }) {
  const [activeId, setActiveId] = React.useState(ASK_THREADS[0].id);
  const [question, setQuestion] = React.useState('');
  const [pending, setPending]   = React.useState(false);
  const [accountSel, setAccountSel] = React.useState(new Set()); // empty = all
  const [pendingAnswer, setPendingAnswer] = React.useState(null);
  const [showDisamb, setShowDisamb] = React.useState(false);

  const active = ASK_THREADS.find(t => t.id === activeId) || ASK_THREADS[0];

  function ask() {
    if (!question.trim() || pending) return;
    const q = question;
    setPending(true);
    setPendingAnswer({ kind: 'user', text: q });
    setTimeout(() => {
      // 1-in-3 chance we get disambiguation
      const disamb = /james|sarah|david|marcus/i.test(q) && question.toLowerCase().includes('james');
      if (disamb) {
        setShowDisamb(true);
        setPending(false);
        return;
      }
      setPendingAnswer({
        kind: 'assistant',
        text: synthesize(q),
        route: 'LOCAL', model: 'llama3.1:8b', sensitivity: 'normal',
        cites: [
          { kind: 'email',   label: 'Diana Reeves · tomorrow\u2019s review', span: 'today 06:42' },
          { kind: 'meeting', label: 'Acme \u2014 kickoff call', span: 'turn 12-37' },
        ],
      });
      setPending(false);
    }, 900);
    setQuestion('');
  }

  function synthesize(q) {
    if (/sarah/i.test(q)) {
      return "Sarah committed to producing v3 of the board deck by Monday 12 May (already shipped) and to leading with revenue, not pipeline, on slide 4. Two open questions remain in her email from yesterday at 22:18.";
    }
    if (/david/i.test(q)) {
      return "Your last live contact with David Yoo was today at 12:15 (lunch, moved from 12:00). Before that, the most recent indexed touch was 02 May (Maple wire confirmation).";
    }
    return "Across the indexed mail and meetings, you committed to (1) sending Aaron a pricing memo by Friday (overdue 2 days) and (2) a 60-day pilot scope with Acme, pending Q3 review.";
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Threads sidebar */}
      <aside style={{
        width: 260, flexShrink: 0,
        borderRight: '1px solid var(--rule)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--ivory)',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--rule)',
                      display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 500 }}>Threads</span>
          <button onClick={() => setActiveId(null)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            width: 26, height: 26, borderRadius: 4,
            border: '1px solid var(--rule)', color: 'var(--gray)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><I.plus size={13} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {ASK_THREADS.map(t => {
            const on = activeId === t.id;
            return (
              <button key={t.id} onClick={() => setActiveId(t.id)} style={{
                all:'unset', boxSizing:'border-box', cursor:'default',
                display:'block', width:'100%',
                padding: '8px 10px', borderRadius: 5, marginBottom: 2,
                background: on ? 'var(--ivory-deep)' : 'transparent',
                borderLeft: on ? '2px solid var(--gold)' : '2px solid transparent',
              }}
              onMouseEnter={(e)=>{ if(!on) e.currentTarget.style.background='var(--ivory-deep)'; }}
              onMouseLeave={(e)=>{ if(!on) e.currentTarget.style.background='transparent'; }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3,
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap' }}>
                  {t.title}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
                              letterSpacing: '0.06em', marginTop: 2 }}>
                  {t.updatedAt}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--rule)',
                      fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.14em',
                      textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          ⌘K answers are ephemeral.<br />
          Use "Expand to chat" to keep one.
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Account filter bar */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          padding: '12px 24px', borderBottom: '1px solid var(--rule)',
          background: 'var(--ivory)',
        }}>
          <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginRight: 4 }}>Search across</span>
          {PROVIDER_ACCOUNTS.map(a => {
            const on = accountSel.has(a.id);
            return (
              <button key={a.id} onClick={() => {
                const n = new Set(accountSel);
                n.has(a.id) ? n.delete(a.id) : n.add(a.id);
                setAccountSel(n);
              }} style={{
                all:'unset', boxSizing:'border-box', cursor:'default',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                fontSize: 12,
                border: `1px solid ${on ? a.color : 'var(--rule)'}`,
                background: on ? `${a.color}15` : 'transparent',
                color: on ? 'var(--ink)' : 'var(--gray)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 50, background: a.color }} />
                {a.providerKey === 'microsoft' ? 'M' : 'G'} {a.displayEmail}
              </button>
            );
          })}
          {accountSel.size === 0 && (
            <span className="serif italic" style={{ fontSize: 12.5, color: 'var(--gray)' }}>
              · all {PROVIDER_ACCOUNTS.length} accounts
            </span>
          )}
        </div>

        {/* Conversation */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {active && active.turns.length > 0 ? (
            <div style={{ maxWidth: 780, margin: '0 auto' }}>
              {active.turns.map(turn => (
                <div key={turn.id} style={{ marginBottom: 28 }}>
                  {turn.role === 'user' ? <UserTurn text={turn.text} /> : <AnswerCard turn={turn} />}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState onPick={(q) => setQuestion(q)} />
          )}

          {pendingAnswer && pendingAnswer.kind === 'user' && (
            <div style={{ maxWidth: 780, margin: '0 auto' }}>
              <UserTurn text={pendingAnswer.text} />
              {showDisamb ? (
                <DisambCard onPick={(personId) => {
                  setShowDisamb(false);
                  setPendingAnswer({
                    kind: 'assistant',
                    text: "From your work account: James Park (cofounder) responded yesterday at 19:45 about pushing the Tomás offer by a day. Last actual conversation thread was 14 May. He has 1 outstanding ask of you: confirm new offer terms when legal returns it.",
                    route: 'LOCAL', model: 'llama3.1:8b', sensitivity: 'normal',
                    cites: [
                      { kind: 'email',    label: 'James Park · push offer for Tomás', span: 'yesterday 19:45' },
                      { kind: 'calendar', label: '1:1 with James Park · 14 May', span: '09:30' },
                    ],
                  });
                }} />
              ) : pending && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gray)' }}>
                  <span className="smallcaps" style={{ color: 'var(--gold)' }}>thinking</span>
                  <Dots />
                </div>
              )}
            </div>
          )}

          {pendingAnswer && pendingAnswer.kind === 'assistant' && (
            <div style={{ maxWidth: 780, margin: '0 auto', marginBottom: 28 }}>
              <AnswerCard turn={pendingAnswer} fresh />
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: '16px 24px 20px', borderTop: '1px solid var(--rule)', background: 'var(--ivory)' }}>
          <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea rows={1} value={question}
                      onChange={(e)=>setQuestion(e.target.value)}
                      onKeyDown={(e)=>{ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                      placeholder="Ask a question about your data…"
                      style={{
                        flex: 1, padding: '12px 14px', borderRadius: 8,
                        border: '1px solid var(--rule-strong)',
                        background: 'var(--paper)',
                        fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.4,
                        resize: 'none', minHeight: 44, maxHeight: 160,
                      }} />
            <button className="btn btn-primary" disabled={!question.trim() || pending}
                    onClick={ask}
                    style={{ minHeight: 44, padding: '0 18px', fontSize: 13,
                             opacity: (!question.trim() || pending) ? 0.4 : 1 }}>
              <I.arrow_r size={13} /> Ask
            </button>
          </div>
          <div style={{ maxWidth: 780, margin: '6px auto 0',
                        fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em',
                        textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
            BM25 + nomic-embed-text · queries stay local · PII routes to llama3.1:8b
          </div>
        </div>
      </main>
    </div>
  );
}

function UserTurn({ text }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
      <Avatar initials={USER.initials} size={28} />
      <div style={{ flex: 1 }}>
        <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 4 }}>You</div>
        <p style={{ margin: 0, fontFamily: 'var(--f-display)', fontStyle: 'italic',
                    fontSize: 19, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
          “{text}”
        </p>
      </div>
    </div>
  );
}

function AnswerCard({ turn, fresh }) {
  const isLocal = turn.route === 'LOCAL';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14,
      animation: fresh ? 'fadeIn 240ms ease-out' : 'none',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: 'var(--gold)', color: 'var(--ivory)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 14,
      }}>A</div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="smallcaps" style={{ color: 'var(--gold)' }}>Aria</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 7px', borderRadius: 999,
            fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
            background: isLocal ? 'rgba(91,110,58,0.12)' : 'rgba(184,134,11,0.10)',
            color: isLocal ? '#3F4E26' : 'var(--gold-deep)',
            border: `1px solid ${isLocal ? 'rgba(91,110,58,0.25)' : 'rgba(184,134,11,0.25)'}`,
          }}>{turn.route} · {turn.model}</span>
          {turn.sensitivity && (
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              · sensitivity {turn.sensitivity}
            </span>
          )}
        </div>

        <p style={{ margin: '0 0 12px 0', fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
          {turn.text}
        </p>

        {(turn.cites || []).length > 0 && (
          <div style={{
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderRadius: 6, padding: '10px 12px',
          }}>
            <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }}>Cited from</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {turn.cites.map((c, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em',
                                 textTransform: 'uppercase', color: 'var(--gold)', width: 60 }}>{c.kind}</span>
                  <a href="#" style={{ flex: 1, color: 'var(--ink-soft)',
                                       textDecoration: 'underline', textDecorationColor: 'var(--rule-strong)',
                                       textUnderlineOffset: 3 }}>{c.label}</a>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)' }}>{c.span}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 12, fontFamily: 'var(--f-mono)', fontSize: 10,
                      letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          <button style={{ all:'unset', cursor:'default' }}>↑ helpful</button>
          <button style={{ all:'unset', cursor:'default' }}>↓ not useful</button>
          <button style={{ all:'unset', cursor:'default' }}>↻ retry</button>
        </div>
      </div>
    </div>
  );
}

function DisambCard({ onPick }) {
  return (
    <div style={{
      background: 'var(--paper)',
      border: '1px solid var(--rule)',
      borderRadius: 8, padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, marginBottom: 8 }}>
        Two people match that name — which one?
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { id: 'james-park',    name: 'James Park',        sub: 'Cofounder · 48 emails · 14 meetings · evance@northwind.co' },
          { id: 'james-aldred',  name: 'James Aldred',      sub: 'Maple Capital · 3 emails · 0 meetings · evance@gmail.com' },
        ].map(p => (
          <button key={p.id} onClick={() => onPick(p.id)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--rule)',
            background: 'var(--ivory)',
          }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{p.name}</div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', marginTop: 2, letterSpacing: '0.06em' }}>
              {p.sub}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onPick }) {
  const prompts = [
    "What did we commit to Acme this quarter?",
    "When did I last talk to David Yoo?",
    "Open items from the board meeting in March",
    "Find any emails about the Series B term sheet",
    "What did Sarah commit to on Q3 OKRs?",
  ];
  return (
    <div style={{ maxWidth: 640, margin: '24px auto' }}>
      <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 500,
                   fontSize: '2.5rem', letterSpacing: '-0.015em', marginBottom: 14 }}>
        Ask Aria anything — about your data.
      </h1>
      <p className="serif italic" style={{ fontSize: 17, color: 'var(--gray)', lineHeight: 1.5, marginBottom: 28 }}>
        Aria runs BM25 + vector retrieval over your mail and meetings, then synthesises an answer with sources. Queries stay on this device.
      </p>
      <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 10 }}>Try one</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompts.map(p => (
          <button key={p} onClick={() => onPick(p)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '10px 14px', borderRadius: 6,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            color: 'var(--ink-soft)', fontSize: 14,
            fontFamily: 'var(--f-display)', fontStyle: 'italic',
          }}
          onMouseEnter={(e)=>e.currentTarget.style.borderColor='var(--gold)'}
          onMouseLeave={(e)=>e.currentTarget.style.borderColor='var(--rule)'}>
            “{p}”
          </button>
        ))}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: 50, background: 'var(--gold)',
          animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite`,
        }} />
      ))}
    </span>
  );
}

window.ScreenAsk = ScreenAsk;
