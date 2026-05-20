// app-screen-scheduling.jsx — Scheduling (Plan 04-03 shipped UI).
//
// Mirrors SchedulingChat.tsx exactly:
//   • NL textarea + Submit
//   • Three result kinds:
//       ProposeResultDto       → success message + link to Approvals
//       ProposeClarificationDto → candidate event buttons
//       ProposeRefusalDto       → friendly copy per code:
//          cancel-not-in-v1 / multi-attendee / no-match / parse-failed

const SCHED_EXAMPLES = [
  "move my 3pm to Thursday",
  "push board prep to 4pm Friday",
  "find me 30 min with james before EOD",
  "decline the engineering standup tomorrow",
];

const REFUSAL_COPY = {
  'cancel-not-in-v1': 'Cancel commands are coming in v1.x — please do this one in Google Calendar for now.',
  'multi-attendee':   'Multi-attendee calendar changes are coming in v1.x — please do this one in Google Calendar.',
  'no-match':         "I couldn't find an event matching that description. Try the event title or a different time.",
  'parse-failed':     "Sorry, I couldn't understand that scheduling command. Try rephrasing it.",
};

// Demo scenarios — the parser's three outcomes, plus a fourth "refusal" set.
const SCENARIOS = [
  { key: 'success', label: 'Success', input: "move my 3pm to Thursday" },
  { key: 'clarify', label: 'Clarify · multiple matches', input: "push board prep to 4pm Friday" },
  { key: 'refuse',  label: 'Refusal · multi-attendee',   input: "move the Acme review to next week" },
  { key: 'parse',   label: 'Refusal · parse-failed',     input: "uhhh do the thing" },
];

function ScreenScheduling({ onNav }) {
  const [nl, setNl] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [scenario, setScenario] = React.useState('success');
  const [result, setResult] = React.useState(null);

  function submit() {
    if (!nl.trim() || pending) return;
    setPending(true);
    setResult(null);
    setTimeout(() => {
      setResult(buildResult(scenario, nl));
      setPending(false);
    }, 700);
  }

  function buildResult(s, input) {
    if (s === 'success') {
      return { kind: 'success', approvalId: 'ap3', primaryFeasible: true, conflicts: 0,
        message: 'Proposed calendar change is ready for review on the Approvals page. No hard conflicts detected.' };
    }
    if (s === 'clarify') {
      return { kind: 'clarification', candidates: [
        { eventId: 'e_board_prep_thu', summary: 'Board prep w/ Sarah Chen',         start: 'Thu 17 May · 15:30' },
        { eventId: 'e_board_prep_fri', summary: 'Board prep — internal review',     start: 'Fri 18 May · 11:00' },
        { eventId: 'e_board_kickoff',  summary: 'Q3 board kickoff (recurring)',     start: 'Mon 23 May · 09:00' },
      ]};
    }
    if (s === 'refuse') return { kind: 'refusal', code: 'multi-attendee' };
    if (s === 'parse')  return { kind: 'refusal', code: 'parse-failed' };
    return null;
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 32px 80px' }}>

      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 14,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '2.25rem', letterSpacing:'-0.015em' }}>
          Tell Aria what to move
        </h1>
        <span style={{ flex: 1 }} />
        <span className="serif italic" style={{ fontSize: 14, color: 'var(--gray)' }}>
          Self-only changes only. Multi-attendee in v1.x.
        </span>
      </div>

      <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 18, maxWidth: '48em' }}>
        Type a scheduling command in natural language. Aria parses your intent against your calendar and scheduling rules, drafts a change, and surfaces it on{' '}
        <a href="#" onClick={(e)=>{e.preventDefault(); onNav('approvals');}}
           style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>the Approvals page</a> for review.
      </p>

      {/* Composer */}
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 10, padding: 16, marginBottom: 14,
        boxShadow: '0 1px 2px rgba(26,26,26,0.03)',
      }}>
        <textarea value={nl} onChange={(e)=>setNl(e.target.value)} rows={3}
                  placeholder='e.g. "move my 3pm to Thursday"'
                  style={{
                    width: '100%', border: 'none', outline: 'none', resize: 'vertical',
                    background: 'transparent',
                    fontFamily: 'var(--f-display)', fontSize: 19, lineHeight: 1.45,
                    color: 'var(--ink)', letterSpacing: '-0.005em',
                  }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button className="btn btn-primary" disabled={!nl.trim() || pending}
                  onClick={submit}
                  style={{ minHeight: 34, padding: '0 18px', fontSize: 13,
                           opacity: (!nl.trim() || pending) ? 0.4 : 1 }}>
            {pending ? 'Working…' : <><I.bolt size={12} /> Submit</>}
          </button>
          <span style={{ flex: 1 }} />
          <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>
            Routes through · FRONTIER claude-sonnet · NL intent parser
          </span>
        </div>
      </div>

      {/* Examples */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginRight: 4, alignSelf: 'center' }}>Try</span>
        {SCHED_EXAMPLES.map(ex => (
          <button key={ex} onClick={() => setNl(ex)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '6px 12px', borderRadius: 999,
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--gray)', fontSize: 12.5,
            fontFamily: 'var(--f-display)', fontStyle: 'italic',
          }}>“{ex}”</button>
        ))}
      </div>

      {/* Demo scenario picker (prototype) */}
      <div style={{
        border: '1px dashed var(--rule-strong)',
        padding: '10px 14px', borderRadius: 6,
        marginBottom: 24, fontSize: 12.5, color: 'var(--gray)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span className="smallcaps" style={{ color: 'var(--gold)' }}>Prototype</span>
        <span>Pick which response Aria will produce —</span>
        {SCENARIOS.map(s => (
          <button key={s.key} onClick={() => { setScenario(s.key); setNl(s.input); }} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '3px 10px', borderRadius: 4,
            border: `1px solid ${scenario === s.key ? 'var(--ink)' : 'var(--rule)'}`,
            background: scenario === s.key ? 'var(--ink)' : 'transparent',
            color: scenario === s.key ? 'var(--ivory)' : 'var(--gray)',
            fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Result panel */}
      {result && <SchedulingResult result={result} onNav={onNav} />}

      {/* Empty state when no result */}
      {!result && !pending && (
        <div style={{ marginTop: 12, padding: '14px 18px',
                      background: 'var(--ivory-deep)', borderRadius: 8,
                      color: 'var(--gray)', fontSize: 13.5, lineHeight: 1.6 }}>
          <span className="smallcaps" style={{ color: 'var(--gold)' }}>How this works</span>
          <p style={{ margin: '8px 0 0 0', maxWidth: '46em' }}>
            Aria parses your sentence, matches it against your real calendar, evaluates conflicts against your scheduling rules (focus blocks, no-meeting windows, buffers), and proposes one or more alternative slots. Nothing is sent until you approve the change.
          </p>
        </div>
      )}
    </div>
  );
}

function SchedulingResult({ result, onNav }) {
  if (result.kind === 'success') {
    return (
      <div style={{
        background: 'rgba(91,110,58,0.10)',
        border: '1px solid rgba(91,110,58,0.30)',
        borderRadius: 8, padding: '14px 18px',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <I.check size={18} style={{ color: '#3F4E26', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 17, color: 'var(--ink)', marginBottom: 4 }}>
            Proposed change ready
          </div>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13.5, lineHeight: 1.55 }}>
            {result.message}
          </p>
        </div>
        <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}
                onClick={() => onNav('approvals')}>
          Open queue <I.arrow_r size={11} />
        </button>
      </div>
    );
  }

  if (result.kind === 'clarification') {
    return (
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 8, padding: '14px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <I.filter size={14} style={{ color: 'var(--gold)' }} />
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 17, color: 'var(--ink)' }}>
            I found multiple matching events — which one?
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.candidates.map(c => (
            <button key={c.eventId} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              padding: '10px 12px', borderRadius: 6,
              border: '1px solid var(--rule)',
              background: 'var(--ivory)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
            onMouseEnter={(e)=>e.currentTarget.style.borderColor='var(--gold)'}
            onMouseLeave={(e)=>e.currentTarget.style.borderColor='var(--rule)'}>
              <I.calendar size={14} style={{ color: 'var(--gold)' }} />
              <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{c.summary}</span>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)' }}>{c.start}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // refusal
  return (
    <div style={{
      background: 'rgba(184,134,11,0.08)',
      border: '1px solid rgba(184,134,11,0.30)',
      borderRadius: 8, padding: '14px 18px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <I.flame size={16} style={{ color: 'var(--gold-deep)', marginTop: 3 }} />
      <div style={{ flex: 1 }}>
        <div className="smallcaps" style={{ color: 'var(--gold-deep)' }}>refused · {result.code}</div>
        <p style={{ margin: '4px 0 0 0', color: 'var(--ink-soft)', fontSize: 13.5, lineHeight: 1.55 }}>
          {REFUSAL_COPY[result.code]}
        </p>
      </div>
    </div>
  );
}

window.ScreenScheduling = ScreenScheduling;
