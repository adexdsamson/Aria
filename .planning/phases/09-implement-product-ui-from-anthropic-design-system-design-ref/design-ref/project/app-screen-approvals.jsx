// app-screen-approvals.jsx — full Approval queue (Plan 03 shipped UI).
//
// Faithful to ApprovalsScreen.tsx + ApprovalCard.tsx:
//   • filter chips by state (pending | generating | ready | sending | interrupted | snoozed)
//   • multi-select + batch approve (only `ready` rows are batchable)
//   • 3 kinds of card: email_send, calendar_change, task_batch
//   • email_send shows severity + categories + triage chips
//     and a "rationale" disclosure; force-explicit when severity=high
//     OR any of {financial, legal, hr} categories.
//   • interrupted state shows Regenerate; snoozed shows Unsnooze.

const APPROVAL_STATES = ['pending','generating','ready','sending','interrupted','snoozed'];

function ScreenApprovals({ onNav }) {
  const [filter, setFilter]     = React.useState(new Set(APPROVAL_STATES));
  const [selected, setSelected] = React.useState(new Set());
  const [confirmOpen, setConfirm] = React.useState(false);

  const rows = APPROVALS_V2;
  const visible = rows.filter(r => filter.has(r.state));
  const batchable = Array.from(selected).filter(id => rows.find(r => r.id === id)?.state === 'ready').length;

  function toggleFilter(s) {
    const next = new Set(filter);
    next.has(s) ? next.delete(s) : next.add(s);
    setFilter(next);
  }
  function toggleSelect(id, on) {
    const next = new Set(selected);
    on ? next.add(id) : next.delete(id);
    setSelected(next);
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 32px 80px' }}>

      {/* Header */}
      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 18,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '2.25rem', letterSpacing:'-0.015em' }}>
          Awaiting your call
        </h1>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          {visible.length} of {rows.length}
        </span>
        <span style={{ flex: 1 }} />
        <span className="serif italic" style={{ fontSize: 14, color: 'var(--gray)' }}>
          Nothing leaves Aria without this page.
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginRight: 4 }}>Filter</span>
        {APPROVAL_STATES.map(s => {
          const on = filter.has(s);
          const count = rows.filter(r => r.state === s).length;
          return (
            <button key={s} onClick={() => toggleFilter(s)} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              fontFamily: 'var(--f-mono)', fontSize: 10.5,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
              background: on ? 'var(--ink)' : 'transparent',
              color: on ? 'var(--ivory)' : 'var(--gray)',
              transition: 'all var(--t)',
            }}>
              {s} <span style={{ opacity: 0.7 }}>· {count}</span>
            </button>
          );
        })}
      </div>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div style={{
          display:'flex', alignItems:'center', gap: 12,
          padding: '10px 14px',
          background: 'rgba(184,134,11,0.08)',
          border: '1px solid rgba(184,134,11,0.25)',
          borderRadius: 6, marginBottom: 14,
        }}>
          <I.check size={14} style={{ color: 'var(--gold)' }} />
          <span style={{ fontSize: 13 }}>
            <strong>{selected.size}</strong> selected · <span style={{ color: 'var(--gray)' }}>{batchable} ready to approve</span>
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={batchable === 0}
                  style={{ minHeight: 30, padding: '0 14px', fontSize: 12.5,
                           opacity: batchable === 0 ? 0.4 : 1 }}
                  onClick={() => setConfirm(true)}>
            Batch approve
          </button>
          <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
                  onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {confirmOpen && (
        <div role="dialog" style={{
          border: '1px solid var(--rule-strong)', background: 'var(--ivory-deep)',
          padding: 14, borderRadius: 6, marginBottom: 14, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <I.flame size={16} style={{ color: 'var(--gold)' }} />
          <span style={{ flex: 1 }}>
            Approve {batchable} ready draft(s)? Approvals are final and unlock the send gate for each row. This cannot be undone.
          </span>
          <button className="btn btn-primary" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
                  onClick={() => { setConfirm(false); setSelected(new Set()); }}>
            Confirm
          </button>
          <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
                  onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}

      {visible.length === 0 ? (
        <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--gray-soft)', fontStyle: 'italic' }}>
          No approvals match the current filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visible.map(row => (
            <ApprovalCard key={row.id}
              row={row}
              selected={selected.has(row.id)}
              onSelect={(on) => toggleSelect(row.id, on)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── card dispatcher ─────────
function ApprovalCard({ row, selected, onSelect }) {
  if (row.kind === 'calendar_change') return <CalendarApprovalCard row={row} selected={selected} onSelect={onSelect} />;
  if (row.kind === 'task_batch')      return <TaskBatchApprovalCard row={row} selected={selected} onSelect={onSelect} />;
  return <EmailApprovalCard row={row} selected={selected} onSelect={onSelect} />;
}

// Shared card chrome
function CardShell({ row, selected, onSelect, kindLabel, kindIcon: KI, accountId, children }) {
  const acc = (PROVIDER_ACCOUNTS || []).find(a => a.id === accountId);
  return (
    <article style={{
      background: 'var(--paper)',
      border: '1px solid var(--rule)',
      borderRadius: 8,
      padding: 0, overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '36px 1fr',
    }}>
      {/* Gutter — checkbox + state lock */}
      <div style={{
        background: 'var(--ivory-deep)',
        borderRight: '1px solid var(--rule)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 18, gap: 14,
      }}>
        <input type="checkbox"
          checked={selected}
          disabled={row.state !== 'ready'}
          onChange={(e) => onSelect(e.target.checked)}
          style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
        <StateBadge state={row.state} />
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px 18px' }}>

        {/* Header line */}
        <div style={{ display:'flex', alignItems:'flex-start', gap: 12, marginBottom: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--gold)',
            paddingTop: 4,
          }}>
            <KI size={11} /> {kindLabel}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 500,
                          letterSpacing: '-0.005em', color: 'var(--ink)', lineHeight: 1.3 }}>
              {row.subject}
            </div>
            {acc && (
              <div style={{ marginTop: 3, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', letterSpacing: '0.04em' }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: 50,
                  background: acc.color, marginRight: 6, verticalAlign: 'middle',
                }} />
                {acc.providerKey === 'microsoft' ? 'Outlook' : 'Gmail'} · {acc.displayEmail}
              </div>
            )}
          </div>
        </div>

        {children}
      </div>
    </article>
  );
}

function StateBadge({ state }) {
  const palette = {
    pending:     { bg: '#EEECE6', fg: '#6B6B6B', lbl: 'pend' },
    generating:  { bg: 'rgba(184,134,11,0.16)', fg: 'var(--gold-deep)', lbl: 'gen' },
    ready:       { bg: 'rgba(91,110,58,0.18)',  fg: '#3F4E26',          lbl: 'ready' },
    sending:     { bg: 'rgba(31,58,95,0.16)',   fg: '#1F3A5F',          lbl: 'send' },
    interrupted: { bg: 'rgba(184,73,58,0.16)',  fg: '#7A2B20',          lbl: 'intr' },
    snoozed:     { bg: '#EEECE6',               fg: '#8A8784',          lbl: 'snze' },
  }[state] || { bg: '#EEECE6', fg: '#6B6B6B', lbl: state };
  return (
    <span style={{
      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.22em',
      textTransform: 'uppercase',
      padding: '8px 3px', borderRadius: 3,
      background: palette.bg, color: palette.fg,
    }}>{palette.lbl}</span>
  );
}

function Chip({ children, tone = 'neutral', testId, title }) {
  const tones = {
    neutral:  { bg: 'var(--ivory-deep)', fg: 'var(--gray)',    border: 'var(--rule)' },
    gold:     { bg: 'rgba(184,134,11,0.10)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.25)' },
    rose:     { bg: 'rgba(184,73,58,0.10)',  fg: '#7A2B20',          border: 'rgba(184,73,58,0.25)' },
    moss:     { bg: 'rgba(91,110,58,0.12)',  fg: '#3F4E26',          border: 'rgba(91,110,58,0.25)' },
    blue:     { bg: 'rgba(31,58,95,0.10)',   fg: '#1F3A5F',          border: 'rgba(31,58,95,0.25)' },
  }[tone] || tones?.neutral;
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 999,
      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.05em',
      background: tones.bg, color: tones.fg,
      border: `1px solid ${tones.border}`,
    }}>{children}</span>
  );
}

function ChipsRow({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>{children}</div>;
}

function Rationale({ text, label = 'Why' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      color: 'var(--gray)', fontSize: 13, lineHeight: 1.55, marginBottom: 12,
    }}>
      <span style={{
        fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'var(--gold)', flexShrink: 0, marginTop: 1,
      }}>{label}</span>
      <span style={{ fontStyle: 'italic' }}>{text}</span>
    </div>
  );
}

function Actions({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{children}</div>;
}

// ───────── email_send card ─────────
function EmailApprovalCard({ row, selected, onSelect }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]     = React.useState(row.bodyEdited ?? row.bodyOriginal ?? '');
  const [showRationale, setShowRationale] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const forceExplicit = row.severity === 'high'
    || (row.categories || []).some(c => ['financial','legal','hr'].includes(c));
  const interrupted = row.state === 'interrupted';
  const snoozed     = row.state === 'snoozed';

  return (
    <CardShell row={row} selected={selected} onSelect={onSelect}
      kindLabel="Email" kindIcon={I.send} accountId={row.accountId}>

      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
                       textTransform: 'uppercase', color: 'var(--gray-soft)', marginRight: 6 }}>To</span>
        {(row.recipients || []).join(', ')}
      </div>

      {/* Triage + severity chips */}
      <ChipsRow>
        {row.triage && (
          <Chip tone={row.triage.priority === 'urgent' ? 'rose' : 'blue'}>
            priority: {row.triage.priority}
          </Chip>
        )}
        {(row.triage?.signals || []).map(s => <Chip key={s}>{s}</Chip>)}
        {row.severity && <Chip tone={row.severity === 'high' ? 'rose' : row.severity === 'med' ? 'gold' : 'neutral'}>severity: {row.severity}</Chip>}
        {(row.categories || []).map(c => <Chip key={c} tone="gold">{c}</Chip>)}
        {row.voiceBeta && <Chip tone="gold" title="Voice model below ship bar — labeled beta voice">beta voice</Chip>}
        {forceExplicit && <Chip tone="rose" title="Silent-approve disabled per APPR-07">explicit-required</Chip>}
        {row.routed && (
          <button onClick={() => setShowRationale(v => !v)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
          }}>
            <Chip tone="blue">routed: {row.routed.split(' · ')[0]}</Chip>
          </button>
        )}
      </ChipsRow>

      {row.triage?.summary && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', fontStyle: 'italic',
                    margin: '0 0 12px 0', lineHeight: 1.55, fontFamily: 'var(--f-display)' }}>
          “{row.triage.summary}”
        </p>
      )}

      {showRationale && <Rationale label="Rationale" text={row.rationale} />}

      {interrupted ? (
        <div style={{
          background: 'rgba(184,73,58,0.08)',
          border: '1px solid rgba(184,73,58,0.2)',
          padding: 12, borderRadius: 6, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: '#7A2B20',
        }}>
          <I.flame size={14} />
          Draft generation interrupted — the app suspended mid-generation. No partial draft was saved.
          <span style={{ flex: 1 }} />
          <button className="btn btn-outline" style={{ minHeight: 28, padding: '0 12px', fontSize: 12.5 }}>
            <I.refresh size={12} /> Regenerate
          </button>
        </div>
      ) : (
        <>
          {!editing ? (
            <pre style={{
              fontFamily: 'var(--f-body)',
              background: 'var(--ivory)',
              border: '1px solid var(--rule)',
              borderRadius: 6, padding: '14px 16px',
              fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)',
              whiteSpace: 'pre-wrap', margin: '0 0 4px 0',
            }}>{row.bodyEdited ?? row.bodyOriginal ?? '(empty draft)'}</pre>
          ) : (
            <textarea value={draft} onChange={(e)=>setDraft(e.target.value)} rows={9} style={{
              width: '100%', fontFamily: 'var(--f-body)', fontSize: 13.5,
              padding: '14px 16px', borderRadius: 6,
              border: '1px solid var(--rule-strong)', background: 'var(--paper)',
              color: 'var(--ink-soft)', lineHeight: 1.55,
            }} />
          )}
        </>
      )}

      {/* Reject form */}
      {rejecting && (
        <div style={{ display:'flex', gap: 8, alignItems:'center', marginTop: 10 }}>
          <input value={reason} onChange={e=>setReason(e.target.value)}
                 placeholder="Reason (optional, helps Aria learn)"
                 style={{ flex: 1, padding: '7px 10px', borderRadius: 4,
                          border: '1px solid var(--rule-strong)', fontSize: 13 }} />
          <button className="btn btn-outline" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
                  onClick={() => { setRejecting(false); setReason(''); }}>Confirm reject</button>
          <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 10px', fontSize: 12.5 }}
                  onClick={() => setRejecting(false)}>Cancel</button>
        </div>
      )}

      <Actions>
        {!editing && !rejecting && !interrupted && !snoozed && (
          <>
            <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}>
              <I.send size={12} /> Approve {forceExplicit && '(explicit)'}
            </button>
            <button className="btn btn-outline" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
                    onClick={() => setEditing(true)}>
              <I.edit size={12} /> Edit
            </button>
            <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
                    onClick={() => setRejecting(true)}>Reject</button>
            <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>
              <I.snooze size={12} /> Snooze 1h
            </button>
          </>
        )}
        {editing && (
          <>
            <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
                    onClick={() => setEditing(false)}>
              <I.check size={12} /> Save & approve
            </button>
            <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}
                    onClick={() => { setDraft(row.bodyOriginal ?? ''); setEditing(false); }}>Cancel</button>
          </>
        )}
        {snoozed && (
          <button className="btn btn-outline" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
            <I.refresh size={12} /> Unsnooze
          </button>
        )}
      </Actions>
    </CardShell>
  );
}

// ───────── calendar_change card ─────────
function CalendarApprovalCard({ row, selected, onSelect }) {
  const [pick, setPick] = React.useState(row.alternatives?.[0]?.startUtc || row.after?.startUtc);
  const [override, setOverride] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const tz = SCHEDULING_RULES.timeZone;
  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { return iso; }
  };
  const hardConflicts = (row.conflicts || []).filter(c => c.severity === 'hard');

  return (
    <CardShell row={row} selected={selected} onSelect={onSelect}
      kindLabel="Calendar" kindIcon={I.calendar} accountId={row.accountId}>

      <ChipsRow>
        <Chip tone="blue">{row.calendarAction}</Chip>
        {(row.before?.attendees || []).length === 0
          ? <Chip tone="moss">self-only</Chip>
          : <Chip>{(row.before?.attendees || []).length} attendees</Chip>}
        {(row.conflicts || []).map((c, i) => (
          <Chip key={i} tone={c.severity === 'hard' ? 'rose' : 'gold'}>
            conflict: {c.label || c.type}
          </Chip>
        ))}
      </ChipsRow>

      <Rationale text={row.rationale} />

      {/* Before / After */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14,
        alignItems: 'center', marginBottom: 14,
        padding: 14, background: 'var(--ivory)',
        border: '1px solid var(--rule)', borderRadius: 6,
      }}>
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>From</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 17, color: 'var(--gray)', textDecoration: 'line-through', textDecorationColor: 'var(--rule-strong)' }}>
            {fmt(row.before?.startUtc)}
          </div>
        </div>
        <I.arrow_r size={20} style={{ color: 'var(--gold)' }} />
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>To</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 17, color: 'var(--ink)', fontWeight: 500 }}>
            {fmt(pick)}
          </div>
        </div>
      </div>

      {/* Alternatives */}
      {(row.alternatives || []).length > 0 && (
        <>
          <div className="smallcaps" style={{ marginBottom: 6, color: 'var(--gray-soft)' }}>Alternative slots</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {row.alternatives.map((a, i) => {
              const sel = pick === a.startUtc;
              return (
                <button key={i} onClick={() => setPick(a.startUtc)} style={{
                  all:'unset', boxSizing:'border-box', cursor:'default',
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${sel ? 'var(--gold)' : 'var(--rule)'}`,
                  background: sel ? 'rgba(184,134,11,0.08)' : 'var(--paper)',
                  fontSize: 12.5, color: sel ? 'var(--ink)' : 'var(--gray)',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {fmt(a.startUtc)}
                  {a.primeTimeMatched && <I.star size={11} style={{ color: 'var(--gold)' }} />}
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--gray-soft)' }}>{(a.score*100).toFixed(0)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {hardConflicts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {!override ? (
            <button onClick={() => setOverride(true)} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--rose)',
            }}>↳ Override hard conflict and schedule anyway</button>
          ) : (
            <input value={reason} onChange={(e)=>setReason(e.target.value)}
                   placeholder="Reason for override (required)"
                   style={{ width: '100%', padding: '8px 12px', borderRadius: 4,
                            border: '1px solid var(--rose)', fontSize: 13 }} />
          )}
        </div>
      )}

      <Actions>
        <button className="btn btn-primary"
                disabled={hardConflicts.length > 0 && (!override || !reason.trim())}
                style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5,
                         opacity: (hardConflicts.length > 0 && (!override || !reason.trim())) ? 0.4 : 1 }}>
          <I.check size={12} /> Approve & apply
        </button>
        <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>Reject</button>
        <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>
          <I.snooze size={12} /> Snooze 1h
        </button>
      </Actions>
    </CardShell>
  );
}

// ───────── task_batch card ─────────
function TaskBatchApprovalCard({ row, selected, onSelect }) {
  const initialSel = new Set((row.actions || []).filter(a => a.owner !== 'unassigned').map(a => a.id));
  const [picks, setPicks] = React.useState(initialSel);

  function toggle(id) {
    const next = new Set(picks);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicks(next);
  }

  return (
    <CardShell row={row} selected={selected} onSelect={onSelect}
      kindLabel="Tasks" kindIcon={I.task} accountId={row.accountId}>

      <ChipsRow>
        <Chip tone="moss">{row.actions.length} extracted</Chip>
        <Chip tone="blue">target: Todoist</Chip>
        <Chip>{(row.actions || []).filter(a => a.owner === 'unassigned').length} need owner</Chip>
      </ChipsRow>

      <Rationale text={row.rationale} />

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 4px 0',
                   display: 'flex', flexDirection: 'column', gap: 8 }}>
        {row.actions.map(a => {
          const pushable = a.owner !== 'unassigned';
          const on = picks.has(a.id);
          return (
            <li key={a.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: pushable ? 'var(--ivory)' : 'transparent',
              border: '1px solid var(--rule)',
              opacity: pushable ? 1 : 0.6,
            }}>
              <input type="checkbox" checked={on} disabled={!pushable}
                     onChange={() => toggle(a.id)}
                     style={{ marginTop: 4, accentColor: 'var(--gold)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>
                  {a.text}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', letterSpacing: '0.04em' }}>
                  owner: <span style={{ color: 'var(--gray)' }}>{a.owner}{a.followUpWith ? ` (${a.followUpWith})` : ''}</span>
                  {a.dueIso && <> · due <span style={{ color: 'var(--gray)' }}>{a.dueIso}</span></>}
                  {a.priorityHint && <> · <span style={{ color: 'var(--gold)' }}>{a.priorityHint}</span></>}
                  {a.cite && <> · cite <a href="#" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>{a.cite}</a></>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Actions>
        <button className="btn btn-primary" disabled={picks.size === 0}
                style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5, opacity: picks.size === 0 ? 0.4 : 1 }}>
          <I.upload size={12} /> Approve {picks.size} → push to Todoist
        </button>
        <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>Reject batch</button>
      </Actions>
    </CardShell>
  );
}

window.ScreenApprovals = ScreenApprovals;
