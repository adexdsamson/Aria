// app-shell.jsx — Aria desktop shell.
//
// Sidebar reflects what the codebase actually ships (routes.tsx + SideNav.tsx):
//   Briefing · Approvals · Calendar · Meetings · Tasks · Scheduling · Ask Aria · Settings
//
// Inbox triage and Weekly recap, which were earlier "design previews", were
// removed from the renderer entirely:
//   • Triage is no longer a screen — it surfaces as severity/categories chips
//     on email_send rows inside Approvals.
//   • Weekly recap was cut from the v1 plan.
//
// The first-run wizard is reachable from the footer affordance.

const { useState, useEffect, useRef, useMemo } = React;

// ────────────────── primitives ──────────────────

function MonogramSquare({ size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.22,
      background: 'var(--ivory)',
      border: '1px solid var(--rule)',
      boxShadow: '0 1px 2px rgba(26,26,26,0.04)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: 'var(--f-display)', fontWeight: 500,
        fontSize: size * 0.62, lineHeight: 1, color: 'var(--ink)',
        position: 'relative', paddingBottom: 2,
      }}>
        A
        <span style={{ position:'absolute', left: '20%', right: '20%', bottom: '14%', height: 1.5, background: 'var(--gold)' }} />
      </span>
    </div>
  );
}

function Avatar({ initials = 'EV', size = 28, gold = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: gold ? 'var(--gold)' : 'var(--ink)',
      color: 'var(--ivory)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--f-mono)', fontSize: size * 0.36, fontWeight: 500,
      letterSpacing: '0.06em', flexShrink: 0,
    }}>{initials}</div>
  );
}

function StatusDot({ kind = 'ok' }) {
  const color = kind === 'ok' ? 'var(--moss)' :
                kind === 'warn' ? 'var(--gold)' :
                kind === 'err' ? 'var(--rose)' : 'var(--gray-faint)';
  return (
    <span style={{
      width: 6, height: 6, borderRadius: 50, background: color,
      display: 'inline-block', flexShrink: 0,
      boxShadow: `0 0 0 3px ${color}1A`,
    }} />
  );
}

function NavItem({ active, onClick, icon: Ic, label, badge, badgeColor }) {
  return (
    <button onClick={onClick}
      className={"nav-item " + (active ? 'active' : '')}
      style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'default',
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 12, padding: '7px 10px',
        borderRadius: 6, margin: '1px 0',
        color: active ? 'var(--ink)' : 'var(--gray)',
        background: active ? 'var(--ivory-deep)' : 'transparent',
        position: 'relative',
        transition: 'all var(--t)',
        fontFamily: 'var(--f-body)', fontSize: 13.5, fontWeight: active ? 500 : 400,
        letterSpacing: '0.005em',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--ivory-deep)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
      {active && <span style={{ position:'absolute', left: -2, top: 6, bottom: 6, width: 2, background: 'var(--gold)', borderRadius: 2 }} />}
      <span style={{ width: 18, display: 'inline-flex',
                      color: active ? 'var(--gold)' : 'var(--gray-soft)' }}>
        <Ic size={17} stroke={1.5} />
      </span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {badge != null && (
        <span style={{
          fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
          letterSpacing: '0.05em',
          padding: '1px 6px', borderRadius: 4,
          color: badgeColor === 'gold' ? 'var(--gold-deep)' : 'var(--gray)',
          background: badgeColor === 'gold' ? 'rgba(184,134,11,0.12)' : 'var(--ivory-deep)',
          border: badgeColor === 'gold' ? '1px solid rgba(184,134,11,0.2)' : '1px solid var(--rule)',
        }}>{badge}</span>
      )}
    </button>
  );
}

function NavSection({ label, sub, children }) {
  return (
    <div style={{ marginTop: 14, marginBottom: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: '0 12px 6px',
      }}>
        <span style={{
          fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'var(--gray-soft)',
        }}>{label}</span>
        {sub && (
          <span style={{
            fontFamily: 'var(--f-display)', fontStyle: 'italic', fontSize: 10.5,
            color: 'var(--gray-faint)',
          }}>{sub}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ────────────────── sidebar ──────────────────

function Sidebar({ active, onNav, counts, onCmdK }) {
  return (
    <aside style={{
      width: 256,
      background: 'var(--ivory)',
      borderRight: '1px solid var(--rule)',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0,
      padding: '14px 12px 12px',
      height: '100%',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px 14px' }}>
        <MonogramSquare size={26} />
        <div style={{ display:'flex', flexDirection:'column', lineHeight: 1, gap: 2, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 17, fontWeight: 500, letterSpacing: '0.01em' }}>Aria</span>
          <span style={{ fontFamily:'var(--f-display)', fontStyle:'italic', fontSize: 10.5, color:'var(--gray)', whiteSpace: 'nowrap' }}>chief of staff</span>
        </div>
        <span style={{ flex: 1 }} />
      </div>

      {/* Cmd-K — global ephemeral Ask. Opens the palette overlay. */}
      <button onClick={onCmdK} style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'default',
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6,
        color: 'var(--gray)', fontSize: 12.5,
        marginBottom: 4,
      }}>
        <I.search size={14} />
        <span style={{ flex: 1 }}>Ask Aria</span>
        <span style={{
          fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
          background: 'var(--ivory-deep)', padding: '1px 5px', borderRadius: 3,
          border: '1px solid var(--rule)'
        }}>⌘K</span>
      </button>

      {/* Primary surfaces — mirror SideNav.tsx order exactly */}
      <NavSection label="Workspace">
        <NavItem active={active==='briefing'}   onClick={() => onNav('briefing')}   icon={I.briefing} label="Briefing" />
        <NavItem active={active==='approvals'}  onClick={() => onNav('approvals')}  icon={I.approve}  label="Approvals" badge={counts.approvals} badgeColor="gold" />
        <NavItem active={active==='calendar'}   onClick={() => onNav('calendar')}   icon={I.calendar} label="Calendar" />
        <NavItem active={active==='meetings'}   onClick={() => onNav('meetings')}   icon={I.meeting}  label="Meetings" />
        <NavItem active={active==='tasks'}      onClick={() => onNav('tasks')}      icon={I.task}     label="Tasks" badge={counts.tasksOpen} />
        <NavItem active={active==='scheduling'} onClick={() => onNav('scheduling')} icon={I.chat}     label="Scheduling" />
        <NavItem active={active==='ask'}        onClick={() => onNav('ask')}        icon={I.ask}      label="Ask Aria" />
        <NavItem active={active==='recap'}      onClick={() => onNav('recap')}      icon={I.recap}    label="Weekly Recap" />
      </NavSection>

      <NavSection label="System">
        <NavItem active={active==='settings'}      onClick={() => onNav('settings')}     icon={I.settings} label="Settings" />
        <NavItem active={active==='routing-log'}   onClick={() => onNav('routing-log')}  icon={I.cpu}      label="Routing log" />
      </NavSection>

      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{
        padding: '10px 10px 8px', marginTop: 8,
        borderTop: '1px solid var(--rule)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <button onClick={() => onNav('onboarding')} style={{
          all:'unset', boxSizing:'border-box', cursor:'default',
          display:'flex', alignItems:'center', gap: 8,
          fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing:'0.12em',
          textTransform:'uppercase', color: 'var(--gray-soft)',
          marginBottom: 4,
        }}>
          <I.onboarding size={12} /> Run first-run wizard
        </button>
        <SidebarStatus />
      </div>
    </aside>
  );
}

// Footer status block — mirrors StatusPanel.tsx rows in compact form.
function SidebarStatus() {
  const rows = [
    { label: 'Ollama',     value: 'llama3.1:8b · ready',  kind: 'ok' },
    { label: 'Frontier',   value: 'Anthropic · configured', kind: 'ok' },
    { label: 'Gmail',      value: 'synced 09:34',          kind: 'ok' },
    { label: 'Calendar',   value: '2 accounts · live',     kind: 'ok' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map(r => (
        <div key={r.label} style={{ display:'flex', alignItems:'center', gap: 8, fontSize: 11, color: 'var(--gray)' }}>
          <StatusDot kind={r.kind} />
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gray-soft)', width: 56 }}>{r.label}</span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ────────────────── topbar ──────────────────

function Topbar({ screen, onNav, onCmdK }) {
  const titles = {
    briefing:    { eyebrow: 'The Morning · Tuesday 17 May',  title: 'Today\u2019s Briefing' },
    approvals:   { eyebrow: 'Approval queue',                title: 'Awaiting your call' },
    calendar:    { eyebrow: 'Unified calendar',              title: 'Week of 17 May' },
    meetings:    { eyebrow: 'Meeting capture',               title: 'Transcripts & action items' },
    tasks:       { eyebrow: 'Tasks',                         title: 'Todoist + meeting actions' },
    scheduling:  { eyebrow: 'Scheduling',                    title: 'Tell Aria what to move' },
    ask:         { eyebrow: 'Ask Aria',                      title: 'Cited Q&A over your data' },
    recap:        { eyebrow: 'Weekly recap',                title: 'The week in brief' },
    settings:    { eyebrow: 'Settings',                      title: 'Preferences & status' },
   'routing-log':{ eyebrow: 'Diagnostics',                   title: 'Routing log' },
    onboarding:  { eyebrow: 'First-run wizard',              title: 'Welcome to Aria' },
  };
  const t = titles[screen] || titles.briefing;

  return (
    <div style={{
      display:'flex', alignItems:'center', gap: 16,
      padding: '12px 24px',
      borderBottom: '1px solid var(--rule)',
      background: 'var(--ivory)',
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                      letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)' }}>
          {t.eyebrow}
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 500,
                      letterSpacing: '-0.01em', lineHeight: 1.1, marginTop: 2 }}>
          {t.title}
        </div>
      </div>

      <button onClick={onCmdK} style={{
        all:'unset', boxSizing:'border-box', cursor:'default',
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6,
        color: 'var(--gray)', fontSize: 12.5,
      }}>
        <I.search size={14} />
        <span style={{ minWidth: 180 }}>Ask Aria</span>
        <span style={{
          fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
          background: 'var(--ivory-deep)', padding: '1px 5px', borderRadius: 3,
          border: '1px solid var(--rule)'
        }}>⌘K</span>
      </button>

      <button style={{
        all:'unset', boxSizing:'border-box', cursor:'default',
        width: 34, height: 34, borderRadius: 6, color: 'var(--gray)',
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        position: 'relative',
      }} onMouseEnter={(e)=>e.currentTarget.style.background='var(--ivory-deep)'}
         onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}>
        <I.bell size={17} />
        <span style={{ position:'absolute', top: 7, right: 8, width: 6, height: 6, borderRadius: 50, background: 'var(--gold)' }} />
      </button>

      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <Avatar initials={USER.initials} size={30} />
      </div>
    </div>
  );
}

// ────────────────── chrome ──────────────────

function MacChrome({ children, title = 'Aria' }) {
  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      background: 'var(--ivory)',
      boxShadow: '0 20px 60px rgba(26,26,26,0.12), 0 2px 6px rgba(26,26,26,0.04)',
      border: '1px solid var(--rule-strong)',
      display:'flex', flexDirection:'column',
      width: '100%', height: '100%',
    }}>
      <div style={{
        height: 32, display:'flex', alignItems:'center',
        padding: '0 12px', background: 'var(--ivory-deep)',
        borderBottom: '1px solid var(--rule)',
        flexShrink: 0,
        position: 'relative',
      }}>
        <div style={{ display:'flex', gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: 50, background: '#FF5F57', border: '0.5px solid rgba(0,0,0,0.06)' }} />
          <span style={{ width: 12, height: 12, borderRadius: 50, background: '#FEBC2E', border: '0.5px solid rgba(0,0,0,0.06)' }} />
          <span style={{ width: 12, height: 12, borderRadius: 50, background: '#28C840', border: '0.5px solid rgba(0,0,0,0.06)' }} />
        </div>
        <div style={{
          position:'absolute', left: 0, right: 0, textAlign:'center', pointerEvents:'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 12, fontWeight: 500, color: 'var(--gray)',
        }}>{title}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow:'hidden' }}>{children}</div>
    </div>
  );
}

function WinChrome({ children, title = 'Aria' }) {
  return (
    <div style={{
      borderRadius: 4, overflow: 'hidden',
      background: 'var(--ivory)',
      boxShadow: '0 20px 60px rgba(26,26,26,0.12), 0 2px 6px rgba(26,26,26,0.04)',
      border: '1px solid var(--rule-strong)',
      display:'flex', flexDirection:'column',
      width: '100%', height: '100%',
    }}>
      <div style={{
        height: 32, display:'flex', alignItems:'center',
        background: 'var(--ivory)',
        borderBottom: '1px solid var(--rule)',
        flexShrink: 0,
      }}>
        <div style={{
          padding: '0 14px', fontFamily: 'Segoe UI, system-ui, sans-serif',
          fontSize: 12, color: 'var(--ink)', display:'flex', alignItems:'center', gap: 8,
        }}>
          <MonogramSquare size={16} /> Aria
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display:'flex' }}>
          {['—','▢','×'].map((g, i) => (
            <span key={i} style={{
              width: 46, height: 32, display:'inline-flex',
              alignItems:'center', justifyContent:'center', fontSize: 11, color: 'var(--gray)',
              fontFamily: 'Segoe UI, sans-serif',
            }}>{g}</span>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow:'hidden' }}>{children}</div>
    </div>
  );
}

// ────────────────── command palette overlay ──────────────────

function CommandPaletteOverlay({ open, onClose, onExpand }) {
  const [q, setQ] = React.useState('');
  const [mode, setMode] = React.useState('idle'); // 'idle' | 'loading' | 'answer'
  const [answer, setAnswer] = React.useState(null);

  React.useEffect(() => {
    function k(e) {
      if (e.key === 'Escape' && open) onClose();
    }
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) { setQ(''); setMode('idle'); setAnswer(null); }
  }, [open]);

  function submit(e) {
    e?.preventDefault?.();
    if (!q.trim()) return;
    setMode('loading');
    setTimeout(() => {
      setAnswer({
        question: q,
        text: "Sarah committed to producing v3 of the board deck by Monday 12 May and to leading with revenue (not pipeline) on slide 4.",
        cites: [
          { kind: 'meeting', label: 'Board prep — Q1 close · 06 May 2026', span: 'turn 14' },
          { kind: 'email',   label: 'Sarah Chen · Board deck — v3 attached', span: 'Mon 22:18' },
        ],
        route: 'LOCAL', model: 'llama3.1:8b', reason: 'PII present (employee names) — routed local per L-04-03',
      });
      setMode('answer');
    }, 700);
  }

  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(26,26,26,0.45)',
      backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh',
    }}>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width: 'min(720px, 92vw)',
        background: 'var(--ivory)',
        border: '1px solid var(--rule-strong)',
        borderRadius: 10,
        boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
        overflow: 'hidden',
      }}>
        <form onSubmit={submit} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', borderBottom: '1px solid var(--rule)',
        }}>
          <I.search size={18} style={{ color: 'var(--gold)' }} />
          <input autoFocus value={q} onChange={(e)=>setQ(e.target.value)}
                 placeholder="Ask anything across your mail, meetings, tasks…"
                 style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)',
                 }} />
          <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
            border: '1px solid var(--rule)', padding: '2px 6px', borderRadius: 3,
          }}>ephemeral</span>
          <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
            border: '1px solid var(--rule)', padding: '2px 6px', borderRadius: 3,
          }}>esc</span>
        </form>

        <div style={{ padding: '14px 18px 18px', maxHeight: '50vh', overflow: 'auto' }}>
          {mode === 'idle' && (
            <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
              <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>Try</div>
              {[
                "What did Sarah commit to on the board deck?",
                "When did I last talk to David Yoo?",
                "Open items from the Acme kickoff",
                "Show pricing memo thread",
              ].map((s, i) => (
                <button key={i} onClick={() => { setQ(s); setTimeout(submit, 0); }} style={{
                  all:'unset', boxSizing:'border-box', cursor:'default',
                  padding: '8px 10px', borderRadius: 6, color: 'var(--ink-soft)',
                  fontSize: 13.5, fontFamily: 'var(--f-display)', fontStyle: 'italic',
                }}
                onMouseEnter={(e)=>e.currentTarget.style.background='var(--ivory-deep)'}
                onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}>
                  “{s}”
                </button>
              ))}
            </div>
          )}

          {mode === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gray)' }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)' }}>Searching</span>
              <span style={{ fontStyle: 'italic', fontFamily: 'var(--f-display)' }}>BM25 + nomic-embed-text v1.5…</span>
            </div>
          )}

          {mode === 'answer' && answer && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gold)' }}>Answer</span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)' }}>· [{answer.route}] · {answer.model}</span>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ink)', marginBottom: 12 }}>{answer.text}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {answer.cites.map((c, i) => (
                  <a key={i} href="#" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--gray)' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gold)' }}>{c.kind}</span>
                    <span style={{ flex: 1, textDecoration: 'underline', textDecorationColor: 'var(--rule-strong)', textUnderlineOffset: 3 }}>{c.label}</span>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10 }}>{c.span}</span>
                  </a>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
                        onClick={() => { onExpand(answer); onClose(); }}>
                  Expand to chat →
                </button>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Cmd-K answers don't appear in /ask threads
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────── shell ──────────────────

function AppShell() {
  const [screen, setScreen] = React.useState('briefing');
  const [chrome, setChrome] = React.useState('mac');
  const [accent, setAccent] = React.useState('gold');
  const [emailFallback, setEmailFallback] = React.useState(false);
  const [route, setRoute] = React.useState('FRONTIER');
  const [hasBriefing, setHasBriefing] = React.useState(true);
  const [cmdkOpen, setCmdkOpen] = React.useState(false);
  const [entitlementKey, setEntitlementKey] = React.useState('trial-active-day55');
  const entitlement = ENTITLEMENT_STATES[entitlementKey];

  // ⌘K global binding
  React.useEffect(() => {
    function k(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdkOpen(v => !v);
      }
    }
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // accent variable override
  React.useEffect(() => {
    const map = {
      gold:    { '--gold': '#B8860B', '--gold-light': '#D4A84B', '--gold-deep': '#8E6708' },
      oxblood: { '--gold': '#7B2C2C', '--gold-light': '#A0463F', '--gold-deep': '#5A1E1E' },
      ink:     { '--gold': '#1A1A1A', '--gold-light': '#4A4A4A', '--gold-deep': '#000' },
      moss:    { '--gold': '#4A5D32', '--gold-light': '#6B7E4A', '--gold-deep': '#324020' },
      navy:    { '--gold': '#1F3A5F', '--gold-light': '#3B5681', '--gold-deep': '#142540' },
    };
    Object.entries(map[accent] || map.gold).forEach(([k,v]) => {
      document.documentElement.style.setProperty(k, v);
    });
  }, [accent]);

  function nav(target) {
    if (target === 'settings-diagnostics') {
      window.__ariaSettingsTab = 'diagnostics';
      setScreen('settings');
    } else if (target === 'settings-rag') {
      window.__ariaSettingsTab = 'rag';
      setScreen('settings');
    } else if (target === 'settings-scheduling') {
      window.__ariaSettingsTab = 'scheduling';
      setScreen('settings');
    } else if (target === 'settings-subscription') {
      window.__ariaSettingsTab = 'subscription';
      setScreen('settings');
    } else if (target === 'settings-integrations') {
      window.__ariaSettingsTab = 'integrations';
      setScreen('settings');
    } else {
      setScreen(target);
    }
  }

  const counts = {
    approvals: APPROVALS.length,
    tasksOpen: TASKS.filter(t => !t.completed).length,
  };

  const screens = {
    briefing:    (p) => <ScreenBriefing {...p} route={route} hasBriefing={hasBriefing} emailFallback={emailFallback} />,
    approvals:   ScreenApprovals,
    calendar:    ScreenCalendar,
    meetings:    ScreenMeetings,
    tasks:       ScreenTasks,
    scheduling:  ScreenScheduling,
    ask:         ScreenAsk,
    recap:       ScreenRecap,
    settings:    (p) => <ScreenSettings {...p} entitlement={entitlement} onChangeEntitlement={setEntitlementKey} />,
   'routing-log':ScreenRoutingLog,
    onboarding:  ScreenOnboarding,
  };
  const Active = screens[screen] || screens.briefing;

  // Allow-list of routes that stay reachable when entitlement is locked.
  // Mirrors READ_ONLY_ALLOW_LIST in src/renderer/app/routes.tsx.
  const READ_ONLY = new Set(['briefing','approvals','calendar','meetings','tasks','ask','recap','settings','routing-log']);
  const locked = isEntitlementLocked(entitlement);
  const showPaywall = locked && !READ_ONLY.has(screen);

  const isOnboarding = screen === 'onboarding';

  const inner = isOnboarding ? (
    <div style={{ height: '100%', minHeight: 0, background: 'var(--ivory)', overflow: 'auto' }}>
      <Active onNav={nav} />
    </div>
  ) : (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Sidebar active={screen} onNav={nav} counts={counts} onCmdK={() => setCmdkOpen(true)} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--ivory)' }}>
        <TrialBanner state={entitlement} onSubscribe={() => nav('settings-subscription')} />
        <Topbar screen={screen} onNav={nav} onCmdK={() => setCmdkOpen(true)} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {showPaywall
            ? <PaywallScreen state={entitlement} onExit={(t) => nav(t)} onActivate={() => setEntitlementKey('pro-active')} />
            : <Active onNav={nav} />}
        </div>
      </div>
    </div>
  );

  const Wrap = chrome === 'mac' ? MacChrome : chrome === 'win' ? WinChrome : (({children}) => <>{children}</>);

  return (
    <div style={{ minHeight: '100vh', padding: chrome === 'none' ? 0 : 24, background: chrome === 'none' ? 'var(--ivory)' : '#EDEAE4' }}>
      <div style={{ width: '100%', height: chrome === 'none' ? '100vh' : 'calc(100vh - 48px)', minHeight: chrome === 'none' ? '100vh' : 800 }}>
        <Wrap>{inner}</Wrap>
      </div>

      <CommandPaletteOverlay
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onExpand={() => setScreen('ask')}
      />

      <AppTweaks
        chrome={chrome}     setChrome={setChrome}
        accent={accent}     setAccent={setAccent}
        screen={screen}     setScreen={setScreen}
        route={route}       setRoute={setRoute}
        emailFallback={emailFallback} setEmailFallback={setEmailFallback}
        hasBriefing={hasBriefing}     setHasBriefing={setHasBriefing}
        onOpenCmdK={() => setCmdkOpen(true)}
        entitlementKey={entitlementKey} setEntitlementKey={setEntitlementKey}
      />
    </div>
  );
}

// Tweaks panel
function AppTweaks({ chrome, setChrome, accent, setAccent, screen, setScreen,
                    route, setRoute, emailFallback, setEmailFallback,
                    hasBriefing, setHasBriefing, onOpenCmdK,
                    entitlementKey, setEntitlementKey }) {
  return (
    <TweaksPanel>
      <TweakSection label="View" />
      <TweakRadio  label="Window chrome" value={chrome}
                   options={[{value:'mac',label:'macOS'},{value:'win',label:'Win'},{value:'none',label:'none'}]}
                   onChange={setChrome} />
      <TweakSelect label="Screen" value={screen}
                   options={[
                     {value:'briefing',label:'Briefing'},
                     {value:'approvals',label:'Approvals'},
                     {value:'calendar',label:'Calendar'},
                     {value:'meetings',label:'Meetings'},
                     {value:'tasks',label:'Tasks'},
                     {value:'scheduling',label:'Scheduling'},
                     {value:'ask',label:'Ask Aria'},
                     {value:'recap',label:'Weekly Recap'},
                     {value:'settings',label:'Settings'},
                     {value:'routing-log',label:'Routing log'},
                     {value:'onboarding',label:'First-run wizard'},
                   ]}
                   onChange={setScreen} />
      <TweakButton label="Open ⌘K palette" onClick={onOpenCmdK} />

      <TweakSection label="Entitlement" />
      <TweakSelect label="State" value={entitlementKey}
                   options={Object.keys(ENTITLEMENT_STATES).map(k => ({ value: k, label: k }))}
                   onChange={setEntitlementKey} />

      <TweakSection label="Briefing state" />
      <TweakRadio label="LLM route" value={route}
                  options={[{value:'FRONTIER',label:'FRONTIER'},{value:'LOCAL',label:'LOCAL'}]}
                  onChange={setRoute} />
      <TweakToggle label="No-IMPORTANT-label fallback" value={emailFallback} onChange={setEmailFallback} />
      <TweakToggle label="Briefing exists for today"   value={hasBriefing}   onChange={setHasBriefing} />

      <TweakSection label="Brand" />
      <TweakColor  label="Accent" value={accentToColor(accent)}
                   options={['#B8860B','#7B2C2C','#1F3A5F','#4A5D32','#1A1A1A']}
                   onChange={(v) => setAccent(colorToAccent(v))} />
    </TweaksPanel>
  );
}
function accentToColor(a) { return { gold:'#B8860B', oxblood:'#7B2C2C', navy:'#1F3A5F', moss:'#4A5D32', ink:'#1A1A1A' }[a] || '#B8860B'; }
function colorToAccent(c) { return { '#B8860B':'gold','#7B2C2C':'oxblood','#1F3A5F':'navy','#4A5D32':'moss','#1A1A1A':'ink' }[c] || 'gold'; }

window.AppShell = AppShell;
window.MonogramSquare = MonogramSquare;
window.Avatar = Avatar;
window.StatusDot = StatusDot;
