// app-screen-calendar.jsx — Unified Calendar (Plan 04-01 shipped UI).
//
// Mirrors UnifiedCalendarScreen.tsx + CalendarGrid.tsx + AccountVisibilityToggle.tsx:
//   • Lists events for the next 7 days, fanned out across all connected
//     provider accounts (Google + Microsoft).
//   • Per-account visibility toggle (persisted via localStorage in the real app).
//   • Recurrence-unsupported pill on rows the v1 write-scope can't edit.
//   • Side panel surfaces the active event with prep + approvals + rules check.

const WEEK_DAYS = [
  { iso: '2026-05-17', label: 'Tue 17', spotlight: true,  isToday: true },
  { iso: '2026-05-18', label: 'Wed 18', spotlight: false },
  { iso: '2026-05-19', label: 'Thu 19', spotlight: false },
  { iso: '2026-05-20', label: 'Fri 20', spotlight: false },
  { iso: '2026-05-21', label: 'Sat 21', spotlight: false, weekend: true },
  { iso: '2026-05-22', label: 'Sun 22', spotlight: false, weekend: true },
  { iso: '2026-05-23', label: 'Mon 23', spotlight: false },
];

// One week of events fanned across the three connected accounts.
const CAL_EVENTS = [
  // Tuesday (today)
  { id: 'c1', day: '2026-05-17', accountId: 'g1', t: 8.5,  dur: 0.5, title: 'Focus — Series B deck', type: 'focus' },
  { id: 'c2', day: '2026-05-17', accountId: 'g1', t: 9.5,  dur: 0.5, title: '1:1 with James Park', type: 'meeting', prep: true },
  { id: 'c3', day: '2026-05-17', accountId: 'g1', t: 10.5, dur: 1,   title: 'Acme — Q3 partnership review', type: 'meeting', prep: true, prime: true },
  { id: 'c4', day: '2026-05-17', accountId: 'g1', t: 12,   dur: 1,   title: 'Lunch — David Yoo', type: 'meeting' },
  { id: 'c5', day: '2026-05-17', accountId: 'g1', t: 14,   dur: 0.5, title: 'Engineering standup', type: 'meeting' },
  { id: 'c6', day: '2026-05-17', accountId: 'g1', t: 15.5, dur: 1,   title: 'Board prep w/ Sarah', type: 'meeting', prep: true },
  { id: 'c7', day: '2026-05-17', accountId: 'g2', t: 17,   dur: 0.5, title: 'School pickup', type: 'personal' },

  // Wednesday
  { id: 'c8',  day: '2026-05-18', accountId: 'g1', t: 9,    dur: 1,   title: 'Investor catch-up · Ridgepoint', type: 'meeting', recurring: true, unsupported: true },
  { id: 'c9',  day: '2026-05-18', accountId: 'g1', t: 10.5, dur: 0.5, title: 'Aaron — pricing memo review', type: 'meeting', prep: true, prime: true },
  { id: 'c10', day: '2026-05-18', accountId: 'm1', t: 14,   dur: 1,   title: 'Board: comp committee', type: 'meeting' },

  // Thursday
  { id: 'c11', day: '2026-05-19', accountId: 'g1', t: 11,   dur: 1,   title: 'Acme — Q3 review (rescheduled)', type: 'meeting', proposed: true, prime: true },
  { id: 'c12', day: '2026-05-19', accountId: 'g1', t: 13,   dur: 1.5, title: 'Focus — board deck', type: 'focus' },
  { id: 'c13', day: '2026-05-19', accountId: 'g2', t: 17,   dur: 0.5, title: 'School pickup', type: 'personal' },

  // Friday
  { id: 'c14', day: '2026-05-20', accountId: 'g1', t: 9,    dur: 0.5, title: 'Sales sync', type: 'meeting' },
  { id: 'c15', day: '2026-05-20', accountId: 'g1', t: 10.5, dur: 1,   title: 'Tomás — offer call', type: 'meeting', prep: true },
  { id: 'c16', day: '2026-05-20', accountId: 'g1', t: 14,   dur: 4,   title: 'No-meeting window', type: 'block', clear: true },

  // Mon
  { id: 'c17', day: '2026-05-23', accountId: 'g1', t: 9,    dur: 0.5, title: 'Weekly leadership', type: 'meeting', recurring: true, unsupported: true },
  { id: 'c18', day: '2026-05-23', accountId: 'm1', t: 10,   dur: 1,   title: 'Audit committee — quarterly', type: 'meeting' },
];

const HOUR_START = 8;
const HOUR_END   = 18;

function ScreenCalendar({ onNav }) {
  const [hidden, setHidden] = React.useState(new Set());
  const [selected, setSelected] = React.useState(null);

  function toggle(id) {
    const next = new Set(hidden);
    next.has(id) ? next.delete(id) : next.add(id);
    setHidden(next);
  }

  const visibleEvents = CAL_EVENTS.filter(e => !hidden.has(e.accountId));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Left rail — account toggles + rules */}
      <aside style={{
        width: 256, flexShrink: 0,
        borderRight: '1px solid var(--rule)',
        background: 'var(--ivory)',
        padding: '20px 16px', overflowY: 'auto',
      }}>
        <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 10 }}>Accounts</div>
        {PROVIDER_ACCOUNTS.map(a => {
          const on = !hidden.has(a.id);
          return (
            <label key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 0', cursor: 'default',
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(a.id)}
                     style={{ accentColor: a.color }} />
              <span style={{ width: 10, height: 10, borderRadius: 2, background: a.color }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{a.label}</span>
                <span style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.providerKey === 'microsoft' ? 'Outlook' : 'Gmail'} · {a.displayEmail}
                </span>
              </span>
            </label>
          );
        })}

        <div className="smallcaps" style={{ marginTop: 18, marginBottom: 8, color: 'var(--gray-soft)' }}>Rules in force</div>
        <RulePill label="Prime time 10:00–12:30" active />
        <RulePill label="No meetings 16:00–18:00" active />
        <RulePill label="Friday afternoons clear" active />
        <RulePill label="10 min buffer between" active />

        <button className="btn btn-ghost" style={{ marginTop: 10, padding: 0, fontSize: 12, color: 'var(--gold)' }}
                onClick={() => onNav('settings-scheduling')}>
          Edit rules →
        </button>

        <div className="smallcaps" style={{ marginTop: 18, marginBottom: 8, color: 'var(--gray-soft)' }}>Write scope</div>
        <p style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5, margin: 0 }}>
          v1 only edits self-only, non-recurring events. Multi-attendee and recurring events stay read-only — Aria will refuse.
        </p>
      </aside>

      {/* Grid */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '64px repeat(7, 1fr)',
          borderBottom: '1px solid var(--rule)',
          background: 'var(--ivory)',
          position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div></div>
          {WEEK_DAYS.map(d => (
            <div key={d.iso} style={{
              padding: '10px 12px',
              borderLeft: '1px solid var(--rule)',
              background: d.spotlight ? 'rgba(184,134,11,0.05)' : (d.weekend ? 'var(--ivory-deep)' : 'transparent'),
            }}>
              <div className="smallcaps" style={{ color: d.isToday ? 'var(--gold)' : 'var(--gray-soft)' }}>
                {d.isToday ? 'Today' : d.label.split(' ')[0]}
              </div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 500,
                            color: d.isToday ? 'var(--ink)' : 'var(--gray)' }}>
                {d.label.split(' ')[1]}
              </div>
            </div>
          ))}
        </div>

        <div style={{ position: 'relative', flex: 1,
                      display: 'grid', gridTemplateColumns: '64px repeat(7, 1fr)' }}>
          {/* Hour column */}
          <div>
            {Array.from({ length: HOUR_END - HOUR_START }).map((_, i) => (
              <div key={i} style={{
                height: 56,
                fontFamily: 'var(--f-mono)', fontSize: 10,
                color: 'var(--gray-soft)',
                padding: '4px 8px 0',
                borderTop: '1px solid var(--rule)',
                letterSpacing: '0.06em',
              }}>{(HOUR_START + i).toString().padStart(2, '0')}:00</div>
            ))}
          </div>

          {WEEK_DAYS.map(d => (
            <DayColumn key={d.iso} day={d}
                       events={visibleEvents.filter(e => e.day === d.iso)}
                       selected={selected}
                       onSelect={setSelected} />
          ))}
        </div>
      </div>

      {/* Right details */}
      {selected && (
        <aside style={{
          width: 340, flexShrink: 0,
          borderLeft: '1px solid var(--rule)',
          background: 'var(--ivory)',
          padding: '20px 18px', overflowY: 'auto',
        }}>
          <EventDetail ev={selected} onClose={() => setSelected(null)} onNav={onNav} />
        </aside>
      )}
    </div>
  );
}

function DayColumn({ day, events, selected, onSelect }) {
  return (
    <div style={{
      position: 'relative',
      borderLeft: '1px solid var(--rule)',
      background: day.weekend ? 'var(--ivory-deep)' : 'transparent',
    }}>
      {Array.from({ length: HOUR_END - HOUR_START }).map((_, i) => (
        <div key={i} style={{
          height: 56,
          borderTop: '1px solid var(--rule)',
        }} />
      ))}

      {/* Prime time band */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        top: (10 - HOUR_START) * 56,
        height: 2.5 * 56,
        background: 'rgba(184,134,11,0.05)',
        borderTop: '1px dashed rgba(184,134,11,0.25)',
        borderBottom: '1px dashed rgba(184,134,11,0.25)',
        pointerEvents: 'none',
      }} />

      {/* No-meeting band 16-18 */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        top: (16 - HOUR_START) * 56,
        height: 2 * 56,
        background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(184,73,58,0.06) 6px, rgba(184,73,58,0.06) 7px)',
        pointerEvents: 'none',
      }} />

      {events.map(ev => (
        <EventBlock key={ev.id} ev={ev}
                    onClick={() => onSelect(ev)}
                    selected={selected?.id === ev.id} />
      ))}
    </div>
  );
}

function EventBlock({ ev, onClick, selected }) {
  const account = PROVIDER_ACCOUNTS.find(a => a.id === ev.accountId) || { color: '#888' };
  const top = (ev.t - HOUR_START) * 56;
  const height = ev.dur * 56 - 2;

  const tones = {
    meeting:  { bg: 'var(--paper)',   border: account.color, fg: 'var(--ink)' },
    focus:    { bg: 'rgba(184,134,11,0.10)', border: 'var(--gold)', fg: 'var(--gold-deep)' },
    personal: { bg: 'var(--ivory-deep)', border: 'var(--gray-faint)', fg: 'var(--gray)' },
    block:    { bg: 'transparent',    border: 'var(--rule-strong)', fg: 'var(--gray-soft)' },
  }[ev.type] || { bg: 'var(--paper)', border: 'var(--rule)', fg: 'var(--ink)' };

  return (
    <button onClick={onClick} style={{
      all:'unset', boxSizing:'border-box', cursor:'default',
      position: 'absolute', left: 4, right: 4,
      top, height: Math.max(height, 24),
      background: tones.bg,
      border: '1px solid var(--rule)',
      borderLeft: `3px solid ${tones.border}`,
      borderRadius: 4,
      padding: '4px 6px 4px 8px',
      overflow: 'hidden',
      boxShadow: selected ? '0 0 0 2px var(--gold)' : 'none',
      opacity: ev.proposed ? 0.85 : 1,
      backgroundImage: ev.proposed ? 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(184,134,11,0.08) 6px, rgba(184,134,11,0.08) 7px)' : 'none',
    }}>
      <div style={{
        fontSize: 11.5, fontWeight: 500,
        color: tones.fg, lineHeight: 1.25,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {ev.title}
      </div>
      <div style={{
        marginTop: 2,
        fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.06em',
        color: 'var(--gray-soft)',
        display: 'flex', alignItems: 'center', gap: 6,
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        {ev.unsupported && <span title="Recurring · v1 write scope cannot edit" style={{ color: 'var(--rose)' }}>↻ ro</span>}
        {ev.prep && <span style={{ color: 'var(--gold)' }}>★ prep</span>}
        {ev.prime && <span style={{ color: 'var(--gold-deep)' }}>prime</span>}
        {ev.proposed && <span style={{ color: 'var(--gold)' }}>proposed</span>}
        {ev.clear && <span>clear</span>}
      </div>
    </button>
  );
}

function RulePill({ label, active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 0',
      fontSize: 12, color: active ? 'var(--ink-soft)' : 'var(--gray-soft)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 50,
        background: active ? 'var(--gold)' : 'var(--gray-faint)',
      }} />
      {label}
    </div>
  );
}

function EventDetail({ ev, onClose, onNav }) {
  const account = PROVIDER_ACCOUNTS.find(a => a.id === ev.accountId);
  const hr = Math.floor(ev.t);
  const mn = (ev.t - hr) * 60;
  const startStr = `${String(hr).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: 50, background: account?.color }} />
        <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>{account?.label} · {startStr}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ all:'unset', cursor:'default', color: 'var(--gray)' }}>
          <I.x size={14} />
        </button>
      </div>
      <h3 style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 22, lineHeight: 1.2, marginBottom: 12 }}>
        {ev.title}
      </h3>

      {ev.unsupported && (
        <div style={{
          padding: '8px 12px', marginBottom: 12,
          background: 'rgba(184,73,58,0.08)',
          border: '1px solid rgba(184,73,58,0.20)',
          borderRadius: 6, fontSize: 12, color: '#7A2B20',
        }}>
          <I.flame size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Recurring · Aria can't edit this in v1. Open in Google Calendar.
        </div>
      )}

      {ev.proposed && (
        <div style={{
          padding: '8px 12px', marginBottom: 12,
          background: 'rgba(184,134,11,0.08)',
          border: '1px solid rgba(184,134,11,0.30)',
          borderRadius: 6, fontSize: 12, color: 'var(--gold-deep)',
        }}>
          <I.bolt size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Proposed change · awaiting approval.
          <a href="#" onClick={(e)=>{e.preventDefault(); onNav('approvals');}}
             style={{ color: 'var(--gold-deep)', textDecoration: 'underline', marginLeft: 4 }}>Open queue →</a>
        </div>
      )}

      {ev.prep && (
        <div style={{ marginBottom: 14 }}>
          <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 6 }}>Prep brief</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, margin: 0 }}>
            Diana sent the cohort numbers at 06:42; Aaron's pricing memo is overdue. Marcus is on the call for the partnership read — keep an eye on the Q3 scope item.
          </p>
        </div>
      )}

      <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }}>Rules check</div>
      <RulePill label={`Inside prime time · ${ev.prime ? 'yes' : 'no'}`} active />
      <RulePill label="Outside no-meeting window · yes" active />
      <RulePill label="10-min buffer respected · yes" active />

      <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" disabled={ev.unsupported}
                style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5, opacity: ev.unsupported ? 0.4 : 1 }}
                onClick={() => onNav('scheduling')}>
          <I.chat size={11} /> Reschedule with Aria
        </button>
        <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 10px', fontSize: 12.5 }}>
          Open in Calendar
        </button>
      </div>
    </div>
  );
}

window.ScreenCalendar = ScreenCalendar;
