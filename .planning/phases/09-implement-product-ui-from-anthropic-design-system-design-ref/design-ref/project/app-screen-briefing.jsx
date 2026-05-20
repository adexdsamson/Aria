// app-screen-briefing.jsx — the daily briefing, faithful to the shipped UI.
//
// The shipped renderer has three sections only: Today's Calendar, Priority
// Email (with the B4 "no-IMPORTANT-label" fallback copy), and News (with
// per-item dismiss and back-link). A route badge ([LOCAL]/[FRONTIER]) sits on
// the header row, and a "Regenerate" link sits opposite it. Every item carries
// a "why this mattered" rationale. We keep the editorial frame (date masthead,
// dropcap intro paragraph), but the body matches what Phase 2 actually built.

function ScreenBriefing({ onNav, route: routeProp, hasBriefing: hasProp, emailFallback: fbProp }) {
  // Pulled into state so Tweaks can rewrite live without remount.
  const [route, _setRoute]            = React.useState(routeProp        ?? 'FRONTIER');
  const [hasBriefing, _setHas]        = React.useState(hasProp          ?? true);
  const [emailFallback, _setFallback] = React.useState(fbProp           ?? false);
  const [regenerateOpen, setRegenerateOpen] = React.useState(false);

  // Keep state in sync if parent passes new props
  React.useEffect(() => { if (routeProp != null) _setRoute(routeProp); }, [routeProp]);
  React.useEffect(() => { if (hasProp  != null) _setHas(hasProp); }, [hasProp]);
  React.useEffect(() => { if (fbProp   != null) _setFallback(fbProp); }, [fbProp]);

  if (!hasBriefing) {
    return <GenerateNowAffordance onGenerate={() => _setHas(true)} />;
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px' }}>

      {/* Date masthead — keeps the editorial frame even though the body is
          a faithful adaptation of what Phase 2 shipped. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 12, marginBottom: 32,
        borderBottom: '1px solid var(--rule)',
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                         letterSpacing: '0.25em', textTransform: 'uppercase',
                         color: 'var(--gold)' }}>The Morning · Vol. I, No. 87</span>
          <span style={{ width: 4, height: 4, borderRadius: 50, background: 'var(--gray-faint)' }} />
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                         letterSpacing: '0.2em', textTransform: 'uppercase',
                         color: 'var(--gray)' }}>Tuesday, 17 May 2026 · America/New_York</span>
        </div>
        <RouteBadge route={route} />
        <button onClick={() => setRegenerateOpen(true)} style={{
          all:'unset', boxSizing:'border-box', cursor:'default',
          fontFamily:'var(--f-mono)', fontSize: 10, letterSpacing:'0.18em',
          textTransform:'uppercase', color: 'var(--gold)',
        }}>
          ↺ Regenerate
        </button>
      </div>

      {/* Headline + dropcap preamble */}
      <div style={{ marginBottom: 56 }}>
        <h1 style={{
          fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', lineHeight: 1.05,
          marginBottom: 22, fontWeight: 500, letterSpacing: '-0.02em',
        }}>
          Today’s Briefing — <span style={{ fontStyle: 'italic', color: 'var(--gray)' }}>Tuesday, 17 May</span>
        </h1>
        <p className="dropcap" style={{
          fontSize: '1.0625rem', lineHeight: 1.75, color: 'var(--ink-soft)',
          maxWidth: '38em', textWrap: 'pretty', letterSpacing: '0.005em',
        }}>
          good morning, Eleanor. Three calendar items today, the Acme review chief among them. Two pieces of mail are marked priority — one from Marcus on the term sheet, one from Diana on tomorrow's materials. From the wire, a quiet day in venture and one item on policy worth a glance. <span className="fleuron" style={{ fontStyle: 'italic', color: 'var(--gold)' }}>❦</span>
        </p>
      </div>

      {regenerateOpen && (
        <RegenerateDialog
          onConfirm={() => setRegenerateOpen(false)}
          onCancel={()  => setRegenerateOpen(false)}
        />
      )}

      <InlineApprovalsPreview onNav={onNav} />
      <SectionOpenActions onNav={onNav} />
      <SectionCalendar />
      <SectionEmail fallback={emailFallback} />
      <SectionNews onNav={onNav} />

      {/* Footer routing log line — the actual app surfaces routing in
          Settings → Diagnostics. We echo a compact line here so users know
          where to look. */}
      <div style={{
        borderTop: '1px solid var(--rule)', paddingTop: 16, marginTop: 56,
        display: 'flex', alignItems: 'center', gap: 16,
        color: 'var(--gray-soft)', fontSize: 11,
      }}>
        <span className="fleuron" style={{ fontSize: 14, color: 'var(--gold)' }}>❦</span>
        <span style={{ fontFamily:'var(--f-mono)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
          Briefing generated 07:00 · {route === 'FRONTIER' ? 'PII redacted · Anthropic claude-sonnet' : 'Local model · llama3.1:8b'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost"
                onClick={() => onNav('settings')}
                style={{ minHeight: 'auto', padding: '4px 8px' }}>
          <I.cpu size={14} /> See routing log
        </button>
      </div>
    </div>
  );
}

// ── Route badge ──────────────────────────────────────────────────────────────
function RouteBadge({ route }) {
  const isFrontier = route === 'FRONTIER';
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
      letterSpacing: '0.18em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 3,
      color: isFrontier ? 'var(--gold-deep)' : 'var(--gray)',
      background: isFrontier ? 'rgba(184,134,11,0.10)' : 'var(--ivory-deep)',
      border: '1px solid ' + (isFrontier ? 'rgba(184,134,11,0.25)' : 'var(--rule)'),
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: 50,
        background: isFrontier ? 'var(--gold)' : 'var(--moss)',
      }} />
      [{route}]
    </span>
  );
}

// ── Regenerate confirmation ─────────────────────────────────────────────────
function RegenerateDialog({ onConfirm, onCancel }) {
  return (
    <div role="dialog" aria-modal="true" style={{
      border: '1px solid var(--rule-strong)',
      background: 'var(--ivory-deep)',
      padding: '14px 18px', borderRadius: 6,
      marginBottom: 24, fontSize: 13.5,
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <I.flame size={16} style={{ color: 'var(--gold)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        Regenerate today's briefing? This replaces the current one and writes a new row to <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>routing_log</span>.
      </div>
      <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
              onClick={onConfirm}>Regenerate</button>
      <button className="btn btn-ghost"   style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
              onClick={onCancel}>Cancel</button>
    </div>
  );
}

// ── Inline Approvals preview (faithful to InlineApprovalsPreview.tsx) ──────
function InlineApprovalsPreview({ onNav }) {
  const rows = (window.APPROVALS_V2 || []).filter(r => ['ready','pending','interrupted'].includes(r.state)).slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <section style={{
      marginBottom: 36,
      border: '1px solid rgba(184,134,11,0.30)',
      background: 'rgba(184,134,11,0.05)',
      borderRadius: 8,
      padding: '14px 18px',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 10 }}>
        <I.approve size={14} style={{ color: 'var(--gold)' }} />
        <span style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 17 }}>Approvals</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 22, height: 18, borderRadius: 999, padding: '0 6px',
          background: 'var(--rose)', color: '#fff',
          fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600,
        }}>{rows.length}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => onNav('approvals')} style={{
          all:'unset', boxSizing:'border-box', cursor:'default',
          fontFamily: 'var(--f-mono)', fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--gold-deep)',
        }}>Open queue →</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                   display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(r => (
          <li key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, color: 'var(--ink-soft)',
          }}>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: 3,
              background: 'var(--ivory)', color: 'var(--gray)',
              border: '1px solid var(--rule)', width: 56, textAlign: 'center',
            }}>{r.state}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.subject}
            </span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {r.kind.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Open Actions (faithful to BriefingScreen.tsx openActions block) ────────
function SectionOpenActions({ onNav }) {
  // Pull from ACTIONS already in app-data
  const open = ACTIONS.filter(a => a.status === 'open' || a.status === 'overdue').slice(0, 4);
  if (open.length === 0) return null;
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionHead count={open.length} feedbackKey="open-actions">Open Actions</SectionHead>
      <div style={{
        fontFamily: 'var(--f-display)', fontStyle: 'italic',
        color: 'var(--gray)', fontSize: 14, marginBottom: 18,
      }}>Unresolved commitments from meetings and email, ranked by deadline.</div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {open.map((a, i) => (
          <li key={a.id} style={{
            padding: '14px 0',
            borderTop: '1px solid var(--rule)',
            borderBottom: i === open.length - 1 ? '1px solid var(--rule)' : 'none',
            display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 14,
            alignItems: 'baseline',
          }}>
            <div style={{
              fontFamily: 'var(--f-mono)', fontSize: 11,
              color: a.status === 'overdue' ? 'var(--rose)' : 'var(--gray)',
              letterSpacing: '0.08em',
            }}>
              {a.due}
            </div>
            <div>
              <div style={{ fontSize: 14.5, color: 'var(--ink)', marginBottom: 4 }}>
                {a.text}
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
                {a.source}
              </div>
            </div>
            <button onClick={() => onNav('tasks')} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--gold)',
            }}>Open task →</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Section header (shared) ─────────────────────────────────────────────────
function SectionHead({ children, count, feedbackKey }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 12,
      marginBottom: 4,
    }}>
      <h2 style={{
        fontSize: '1.75rem', fontWeight: 500, letterSpacing: '-0.01em',
        margin: 0,
      }}>{children}</h2>
      {count != null && (
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em',
                       textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          Top {count}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {feedbackKey && <BriefingFeedbackChips sectionKey={feedbackKey} />}
    </div>
  );
}

// ── Today's Calendar (faithful to SectionCalendar.tsx) ──────────────────────
function SectionCalendar() {
  // Briefing renders top-3; first three real-meeting items
  const items = EVENTS.filter(e => e.type === 'meeting').slice(0, 3);
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionHead count={items.length} feedbackKey="calendar">Today’s Calendar</SectionHead>
      <div style={{
        fontFamily: 'var(--f-display)', fontStyle: 'italic',
        color: 'var(--gray)', fontSize: 14, marginBottom: 18,
      }}>Calendar items ranked by attendee weight, prep status, and time.</div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((ev, i) => (
          <li key={ev.id} style={{
            padding: '18px 0',
            borderTop: '1px solid var(--rule)',
            borderBottom: i === items.length - 1 ? '1px solid var(--rule)' : 'none',
            display: 'grid', gridTemplateColumns: '78px 1fr', gap: 18,
          }}>
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink)' }}>
                {ev.time}
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
                            letterSpacing: '0.1em', marginTop: 2 }}>
                {ev.attendees.length} attending
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.0625rem', fontWeight: 500, color: 'var(--ink)',
                            lineHeight: 1.35, marginBottom: 6 }}>
                {ev.title}
              </div>
              <Rationale text={calendarRationale(ev)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
function calendarRationale(ev) {
  if (ev.title.startsWith('Acme')) return "Q3 partnership review · external counterparties · last touched yesterday; Diana sent materials this morning.";
  if (ev.title.startsWith('Lunch')) return "First in-person with David Yoo since his Maple investment was confirmed; he is moving the slot to 12:15.";
  if (ev.title.startsWith('1:1'))   return "Weekly 1:1 with James — open thread on the Tomás offer letter; legal returned it overnight.";
  if (ev.title.startsWith('Board')) return "Sarah's v3 board deck has two open questions for you — answer before this prep.";
  return "Calendar item · today.";
}

// ── Priority Email (with B4 SC2 fallback for the no-IMPORTANT-label case) ──
function SectionEmail({ fallback }) {
  const NO_IMPORTANT_LABEL_COPY =
    "No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier.";

  const items = fallback ? [] : EMAILS.filter(e => e.classification === 'URGENT').slice(0, 3);

  return (
    <section style={{ marginBottom: 48 }}>
      <SectionHead count={fallback ? null : items.length} feedbackKey="email">Priority Email</SectionHead>
      <div style={{
        fontFamily: 'var(--f-display)', fontStyle: 'italic',
        color: 'var(--gray)', fontSize: 14, marginBottom: 18,
      }}>
        Sourced from Gmail's <span style={{ fontFamily:'var(--f-mono)', fontStyle:'normal', fontSize: 12.5 }}>IMPORTANT</span> label. Aria's own classifier replaces this in Phase 3.
      </div>

      {fallback ? (
        <div style={{
          padding: '24px 26px',
          border: '1px solid var(--rule)',
          borderLeft: '2px solid var(--gold)',
          borderRadius: 6, background: 'var(--paper)',
        }}>
          <div className="smallcaps" style={{ marginBottom: 8, color: 'var(--gold)' }}>Phase 2 limitation · documented</div>
          <p style={{ margin: 0, fontSize: '1.0625rem', color: 'var(--ink)', lineHeight: 1.55 }}>
            {NO_IMPORTANT_LABEL_COPY}
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((m, i) => (
            <li key={m.id} style={{
              padding: '18px 0',
              borderTop: '1px solid var(--rule)',
              borderBottom: i === items.length - 1 ? '1px solid var(--rule)' : 'none',
              display: 'grid', gridTemplateColumns: '78px 1fr', gap: 18,
            }}>
              <div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink)' }}>{m.time}</div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
                              letterSpacing: '0.1em', marginTop: 2 }}>
                  IMPORTANT
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 3 }}>
                  {m.from} — <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>{m.sender_email}</span>
                </div>
                <div style={{ fontSize: '1.0625rem', fontWeight: 500, color: 'var(--ink)',
                              lineHeight: 1.35, marginBottom: 6 }}>
                  {m.subject}
                </div>
                <Rationale text={m.why} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── News (faithful to SectionNews.tsx — dismissible, http(s) back-links) ──
const NEWS_SEED = [
  { id: 'n1',
    title: "FG approves N3.2trn supplementary budget; capex weighted toward roads and power",
    source: "The Cable · NG",
    url: "https://www.thecable.ng/",
    why: "Government & policy · your saved sector · published 04:12 GMT.",
  },
  { id: 'n2',
    title: "CBN holds MPR at 18.75% in surprise pause, signals end of hiking cycle",
    source: "Bloomberg · Finance",
    url: "https://www.bloomberg.com/",
    why: "Finance & markets · your saved sector · contradicts last week's analyst consensus.",
  },
  { id: 'n3',
    title: "Y Combinator W26 batch leans hard into infra-AI; cohort smallest in five years",
    source: "Hacker News",
    url: "https://news.ycombinator.com/",
    why: "Technology · your saved sector · 312 points · trending on HN front page.",
  },
];

function SectionNews({ onNav }) {
  const [dismissed, setDismissed] = React.useState(new Set());
  const visible = NEWS_SEED.filter(n => !dismissed.has(n.id));

  function dismiss(id) {
    setDismissed(prev => { const s = new Set(prev); s.add(id); return s; });
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <SectionHead count={visible.length} feedbackKey="news">News</SectionHead>
      <div style={{
        fontFamily: 'var(--f-display)', fontStyle: 'italic',
        color: 'var(--gray)', fontSize: 14, marginBottom: 18,
      }}>
        From your saved feeds. Dismiss anything that isn't useful — the choice is remembered for today.
      </div>

      {visible.length === 0 ? (
        <p style={{ fontStyle:'italic', color:'var(--gray)' }}>No items today.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((n, i) => (
            <li key={n.id} style={{
              padding: '18px 0',
              borderTop: '1px solid var(--rule)',
              borderBottom: i === visible.length - 1 ? '1px solid var(--rule)' : 'none',
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
            }}>
              <div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gold)',
                              letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>
                  {n.source}
                </div>
                <a href={n.url} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: '1.0625rem', fontWeight: 500, color: 'var(--ink)',
                    lineHeight: 1.35, marginBottom: 6,
                    textDecoration: 'none',
                    display: 'inline-block',
                    backgroundImage: 'linear-gradient(to right, var(--rule-strong), var(--rule-strong))',
                    backgroundSize: '100% 1px', backgroundPosition: '0 100%',
                    backgroundRepeat: 'no-repeat',
                  }}
                >{n.title}</a>
                <Rationale text={n.why} />
              </div>
              <button onClick={() => dismiss(n.id)} style={{
                all:'unset', boxSizing:'border-box', cursor:'default',
                fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.15em',
                textTransform: 'uppercase', color: 'var(--gray-soft)',
                padding: '4px 10px', borderRadius: 4,
                border: '1px solid var(--rule)', height: 'fit-content',
                alignSelf: 'start',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.borderColor = 'var(--rule-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--gray-soft)'; e.currentTarget.style.borderColor = 'var(--rule)'; }}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Rationale line ("why this mattered") ───────────────────────────────────
function Rationale({ text }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      color: 'var(--gray)', fontSize: 13.5, lineHeight: 1.55,
    }}>
      <span style={{
        fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'var(--gold)', flexShrink: 0,
        marginTop: 1,
      }}>Why</span>
      <span style={{ fontStyle: 'italic' }}>{text}</span>
    </div>
  );
}

// ── First-load empty state (matches GenerateNowAffordance) ──────────────────
function GenerateNowAffordance({ onGenerate }) {
  const [busy, setBusy] = React.useState(false);
  function go() {
    setBusy(true);
    setTimeout(() => { setBusy(false); onGenerate(); }, 900);
  }
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '64px 40px' }}>
      <div style={{
        display:'flex', alignItems:'center', gap: 12,
        paddingBottom: 12, marginBottom: 28,
        borderBottom: '1px solid var(--rule)',
      }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.25em',
                       textTransform: 'uppercase', color: 'var(--gold)' }}>The Morning</span>
        <span style={{ width: 4, height: 4, borderRadius: 50, background: 'var(--gray-faint)' }} />
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em',
                       textTransform: 'uppercase', color: 'var(--gray)' }}>
          Tuesday, 17 May 2026
        </span>
      </div>
      <h1 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 500,
                   letterSpacing: '-0.02em', marginBottom: 14 }}>
        Today’s Briefing
      </h1>
      <p style={{
        fontFamily: 'var(--f-display)', fontStyle: 'italic',
        fontSize: '1.125rem', color: 'var(--gray)', maxWidth: '34em',
        marginBottom: 28, lineHeight: 1.55,
      }}>
        Nothing has been written for today yet. Aria can put one together now — or wait until 07:00 if you'd prefer the scheduled run.
      </p>
      <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Generating…' : 'Generate now'}
        </button>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
                       letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Routes through the LLM router · 2–4 seconds
        </span>
      </div>
    </div>
  );
}

function BriefingFeedbackChips({ sectionKey }) {
  const [picked, setPicked] = React.useState(0);
  function fire(t) { setPicked(p => p === t ? 0 : t); }
  const baseStyle = (on) => ({
    all:'unset', boxSizing:'border-box', cursor:'default',
    width: 24, height: 22, borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12,
    border: '1px solid ' + (on ? 'var(--gold)' : 'var(--rule)'),
    background: on ? 'rgba(184,134,11,0.10)' : 'transparent',
    color: on ? 'var(--gold-deep)' : 'var(--gray-soft)',
  });
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
          title="Helps Aria learn what matters in your briefing">
      <button onClick={() => fire(1)}  style={baseStyle(picked === 1)} aria-label="Useful">▲</button>
      <button onClick={() => fire(-1)} style={baseStyle(picked === -1)} aria-label="Not useful">▼</button>
    </span>
  );
}

window.ScreenBriefing = ScreenBriefing;
