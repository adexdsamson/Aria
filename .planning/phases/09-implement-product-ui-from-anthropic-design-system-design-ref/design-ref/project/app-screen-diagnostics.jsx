// app-screen-diagnostics.jsx — Routing log (Plan 03-02).
//
// Mirrors RoutingLogScreen.tsx + RoutingLogPanel.tsx (filter mode):
//   • date range / route / source / sensitivity filters
//   • table of every LLM call with verbatim reason
//   • per-row expand to see full reason + tokens

function ScreenRoutingLog({ onNav }) {
  const [route, setRoute] = React.useState('all');
  const [source, setSource] = React.useState('all');
  const [sensitivity, setSensitivity] = React.useState('all');
  const [expanded, setExpanded] = React.useState(null);

  const rows = ROUTING_LOG.filter(r => {
    if (route !== 'all' && r.route !== route) return false;
    if (source !== 'all' && !r.source.startsWith(source)) return false;
    if (sensitivity !== 'all' && r.sensitivity !== sensitivity) return false;
    return true;
  });

  const totals = ROUTING_LOG.reduce((acc, r) => {
    acc.calls += 1;
    acc.tokensIn  += r.tokensIn;
    acc.tokensOut += r.tokensOut;
    acc.local     += r.route === 'LOCAL' ? 1 : 0;
    acc.frontier  += r.route === 'FRONTIER' ? 1 : 0;
    return acc;
  }, { calls: 0, tokensIn: 0, tokensOut: 0, local: 0, frontier: 0 });

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 32px 80px' }}>

      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 18,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '2.25rem', letterSpacing:'-0.015em' }}>
          Routing log
        </h1>
        <span style={{ flex: 1 }} />
        <span className="serif italic" style={{ fontSize: 14, color: 'var(--gray)' }}>
          Every LLM call Aria has made, with the verbatim reason.
        </span>
      </div>

      {/* KPIs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14,
        marginBottom: 20,
      }}>
        <Kpi label="Calls (last 24h)"   value={totals.calls} />
        <Kpi label="Routed local"       value={`${totals.local}`} sub={`${Math.round(100*totals.local/totals.calls)}% of calls`} />
        <Kpi label="Routed frontier"    value={`${totals.frontier}`} sub={`${Math.round(100*totals.frontier/totals.calls)}% of calls`} />
        <Kpi label="Tokens out"         value={totals.tokensOut.toLocaleString()} sub={`${totals.tokensIn.toLocaleString()} in`} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', marginBottom: 14 }}>
        <Group label="Route" value={route} setValue={setRoute}
               options={[['all','All'],['LOCAL','Local'],['FRONTIER','Frontier']]} />
        <Group label="Source" value={source} setValue={setSource}
               options={[
                 ['all','All'],
                 ['briefing','briefing'],
                 ['email','email.triage'],
                 ['drafting','drafting'],
                 ['rag','rag.ask'],
                 ['transcript','transcript'],
                 ['scheduling','scheduling'],
               ]} />
        <Group label="Sensitivity" value={sensitivity} setValue={setSensitivity}
               options={[
                 ['all','All'],
                 ['low','low'], ['normal','normal'],
                 ['financial','financial'], ['legal','legal'], ['hr','hr'],
                 ['unknown','unknown'],
               ]} />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '140px 90px 1fr 130px 90px 1fr',
          padding: '10px 14px', background: 'var(--ivory-deep)',
          borderBottom: '1px solid var(--rule)',
          fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--gray-soft)',
        }}>
          <div>Timestamp</div>
          <div>Route</div>
          <div>Source · Model</div>
          <div>Sensitivity</div>
          <div className="tnum" style={{ textAlign: 'right' }}>Tokens</div>
          <div>Reason</div>
        </div>
        {rows.map(r => (
          <div key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{
            display: 'grid', gridTemplateColumns: '140px 90px 1fr 130px 90px 1fr',
            padding: '10px 14px',
            borderBottom: '1px solid var(--rule)',
            background: expanded === r.id ? 'var(--ivory-deep)' : 'transparent',
            cursor: 'default', fontSize: 12.5, alignItems: 'baseline',
          }}>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)' }}>{r.ts}</div>
            <div><RouteChip route={r.route} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--ink-soft)' }}>{r.source}</div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)' }}>{r.model}</div>
            </div>
            <div><SensitivityChip s={r.sensitivity} /></div>
            <div className="tnum" style={{ textAlign: 'right', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)' }}>
              {r.tokensIn}/{r.tokensOut}
            </div>
            <div style={{ color: 'var(--gray)', fontStyle: 'italic', minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: expanded === r.id ? 'normal' : 'nowrap' }}>
              {r.reason}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-soft)', fontStyle: 'italic' }}>
            No routing-log rows match the current filters.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
        click a row to expand · last 100 calls cached locally · older logs purged after 30 days
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px' }}>
      <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 28, lineHeight: 1, color: 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', marginTop: 6, letterSpacing: '0.06em' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Group({ label, value, setValue, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginRight: 6 }}>{label}</span>
      {options.map(([v, l]) => {
        const on = value === v;
        return (
          <button key={v} onClick={() => setValue(v)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '3px 9px', borderRadius: 4,
            border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
            background: on ? 'var(--ink)' : 'transparent',
            color: on ? 'var(--ivory)' : 'var(--gray)',
            fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.06em',
          }}>{l}</button>
        );
      })}
    </div>
  );
}

function RouteChip({ route }) {
  const isLocal = route === 'LOCAL';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em',
      textTransform: 'uppercase',
      background: isLocal ? 'rgba(91,110,58,0.12)' : 'rgba(184,134,11,0.10)',
      color: isLocal ? '#3F4E26' : 'var(--gold-deep)',
      border: `1px solid ${isLocal ? 'rgba(91,110,58,0.30)' : 'rgba(184,134,11,0.25)'}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 50, background: isLocal ? '#5B6E3A' : 'var(--gold)' }} />
      {route}
    </span>
  );
}

function SensitivityChip({ s }) {
  const map = {
    low:       { bg: '#EEECE6', fg: '#6B6B6B' },
    normal:    { bg: '#EEECE6', fg: '#6B6B6B' },
    financial: { bg: 'rgba(184,73,58,0.10)', fg: '#7A2B20' },
    legal:     { bg: 'rgba(184,73,58,0.10)', fg: '#7A2B20' },
    hr:        { bg: 'rgba(184,134,11,0.10)', fg: 'var(--gold-deep)' },
    unknown:   { bg: 'transparent',          fg: 'var(--gray-soft)' },
  }[s] || { bg: '#EEECE6', fg: '#6B6B6B' };
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px', borderRadius: 999,
      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.06em',
      background: map.bg, color: map.fg,
    }}>{s}</span>
  );
}

window.ScreenRoutingLog = ScreenRoutingLog;
