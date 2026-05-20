// app-screen-meetings.jsx — Meeting Capture (Plan 06 shipped UI).
//
// Mirrors TranscriptCaptureScreen.tsx + NoteView.tsx + NoteReviewScreen.tsx:
//   • Paste transcript OR upload .txt / .vtt / .srt / .json
//   • Ingest → extract commitments/decisions/follow-ups via structured-output
//     (Vercel AI SDK generateObject, routed LOCAL)
//   • Note view: transcript with citation-highlighted spans + side-rail of
//     extracted actions; ready-to-push as a task_batch approval.
//   • Aria does NOT join calls — paste only.

function ScreenMeetings({ onNav }) {
  const [activeId, setActiveId] = React.useState(TRANSCRIPTS[0].id);
  const [composing, setComposing] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [sourceKind, setSourceKind] = React.useState('paste');
  const [ingesting, setIngesting] = React.useState(false);
  const [pushedId, setPushedId] = React.useState(null);
  const [hoverCite, setHoverCite] = React.useState(null);

  const active = TRANSCRIPTS.find(t => t.id === activeId);

  function ingest() {
    if (!text.trim() || ingesting) return;
    setIngesting(true);
    setTimeout(() => {
      setIngesting(false);
      setComposing(false);
      setActiveId('tx1'); // pretend we just ingested
      setTitle(''); setText('');
    }, 1100);
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Left rail — transcript list + new */}
      <aside style={{
        width: 280, flexShrink: 0,
        borderRight: '1px solid var(--rule)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--ivory)',
      }}>
        <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--rule)' }}>
          <button className="btn btn-primary" style={{ width: '100%', minHeight: 34, fontSize: 12.5 }}
                  onClick={() => setComposing(true)}>
            <I.plus size={12} /> Paste / upload transcript
          </button>
          <div className="smallcaps" style={{ marginTop: 16, color: 'var(--gray-soft)' }}>Recent</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {TRANSCRIPTS.map(t => {
            const on = !composing && activeId === t.id;
            return (
              <button key={t.id} onClick={() => { setActiveId(t.id); setComposing(false); }} style={{
                all:'unset', boxSizing:'border-box', cursor:'default',
                display: 'block', width: '100%',
                padding: '10px 12px', borderRadius: 6, marginBottom: 4,
                background: on ? 'var(--ivory-deep)' : 'transparent',
                borderLeft: on ? '2px solid var(--gold)' : '2px solid transparent',
              }}
              onMouseEnter={(e)=>{ if(!on) e.currentTarget.style.background='var(--ivory-deep)'; }}
              onMouseLeave={(e)=>{ if(!on) e.currentTarget.style.background='transparent'; }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                  {t.title}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
                  {t.date} · {t.sourceKind} · {t.extracted.length} items
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rule)',
                      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
                      textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          Aria does not join calls.
        </div>
      </aside>

      {/* Right pane */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {composing
          ? <ComposeTranscript title={title} setTitle={setTitle}
                               text={text} setText={setText}
                               sourceKind={sourceKind} setSourceKind={setSourceKind}
                               ingesting={ingesting} onIngest={ingest}
                               onCancel={() => setComposing(false)} />
          : <NoteView note={active}
                      onPush={() => setPushedId(active.id)}
                      pushed={pushedId === active.id}
                      hoverCite={hoverCite} setHoverCite={setHoverCite}
                      onNav={onNav} />}
      </div>
    </div>
  );
}

// ── Compose ──────────────────────────────────────────────────────────────────
function ComposeTranscript({ title, setTitle, text, setText, sourceKind, setSourceKind, ingesting, onIngest, onCancel }) {
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 32px 80px' }}>
      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 14,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '1.875rem', letterSpacing:'-0.01em' }}>
          New meeting note
        </h1>
        <span style={{ flex: 1 }} />
        <button onClick={onCancel} className="btn btn-ghost" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}>
          <I.x size={12} /> Cancel
        </button>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 18, maxWidth: '48em' }}>
        Paste a transcript below, or upload one from Granola, Fireflies, Zoom captions, or Google Meet. Aria will extract commitments, decisions, and follow-ups locally via <span className="mono">llama3.1:8b</span> — your transcript never leaves the device.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 12 }}>
        <input value={title} onChange={(e)=>setTitle(e.target.value)}
               placeholder="Meeting title (optional)" style={{
          padding: '10px 14px', borderRadius: 6,
          border: '1px solid var(--rule-strong)',
          background: 'var(--paper)', fontSize: 14, color: 'var(--ink)',
        }} />
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '0 14px', borderRadius: 6,
          border: '1px solid var(--rule-strong)', background: 'var(--paper)',
          color: 'var(--gray)', fontSize: 12.5, cursor: 'default',
        }}>
          <I.upload size={13} /> Upload .txt / .vtt / .srt / .json
          <input type="file" hidden accept=".txt,.vtt,.srt,.json" onChange={() => setSourceKind('vtt')} />
        </label>
      </div>

      <textarea rows={16} value={text} onChange={(e)=>setText(e.target.value)}
                placeholder={"Paste transcript here…\n\nMarcus: We need a decision on the drag-along by Friday.\nEleanor: 60% is fine. I'll send Aaron the pricing memo too.\n…"}
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: 8,
                  border: '1px solid var(--rule-strong)',
                  background: 'var(--paper)', color: 'var(--ink-soft)',
                  fontFamily: 'var(--f-body)', fontSize: 13.5, lineHeight: 1.6,
                  resize: 'vertical',
                }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary" disabled={!text.trim() || ingesting}
                onClick={onIngest}
                style={{ minHeight: 34, padding: '0 18px', fontSize: 13,
                         opacity: (!text.trim() || ingesting) ? 0.4 : 1 }}>
          {ingesting ? 'Extracting…' : <><I.sparkle size={12} /> Ingest & extract</>}
        </button>
        <span style={{ flex: 1 }} />
        <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>
          source: <span style={{ color: 'var(--gray)' }}>{sourceKind}</span> · routed local
        </span>
      </div>
    </div>
  );
}

// ── Note view ────────────────────────────────────────────────────────────────
function NoteView({ note, onPush, pushed, hoverCite, setHoverCite, onNav }) {
  const commitments = note.extracted.filter(x => x.kind === 'commitment');
  const decisions   = note.extracted.filter(x => x.kind === 'decision');
  const ownerCounts = {
    self:        commitments.filter(c => c.owner === 'self').length,
    followUp:    commitments.filter(c => c.owner === 'follow-up').length,
    unassigned:  commitments.filter(c => c.owner === 'unassigned').length,
  };
  const pushable = commitments.filter(c => c.owner !== 'unassigned').length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24,
                  padding: '28px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>

      {/* Transcript column */}
      <div>
        <div style={{
          paddingBottom: 14, marginBottom: 14,
          borderBottom: '1px solid var(--rule)',
        }}>
          <div className="smallcaps" style={{ color: 'var(--gold)' }}>
            Meeting · {note.date} · {note.attendees.length} attendees · {note.sourceKind}
          </div>
          <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 500,
                       fontSize: '2.25rem', letterSpacing: '-0.015em', marginTop: 6 }}>
            {note.title}
          </h1>
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--gray)' }}>
            {note.attendees.join(' · ')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {note.bodyChunks.map((c, i) => {
            const highlighted = hoverCite === c.cite;
            return (
              <div key={i} data-cite={c.cite}
                onMouseEnter={() => setHoverCite(c.cite)}
                onMouseLeave={() => setHoverCite(null)}
                style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr', gap: 14,
                  padding: '8px 12px',
                  borderRadius: 4,
                  background: highlighted ? 'rgba(184,134,11,0.10)' : 'transparent',
                  borderLeft: highlighted ? '2px solid var(--gold)' : '2px solid transparent',
                  transition: 'all 120ms',
                }}>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
                  {c.spk}<br/>
                  <span style={{ color: 'var(--gray-faint)', fontSize: 9.5 }}>{c.cite}</span>
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                  {c.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side rail */}
      <aside style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start',
        background: 'var(--paper)',
        border: '1px solid var(--rule)', borderRadius: 8,
        padding: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 18 }}>Extracted</span>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em',
                                          textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
            local · llama3.1:8b
          </span>
        </div>

        {/* Counts strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
          marginBottom: 14,
          padding: '8px 10px', borderRadius: 6,
          background: 'var(--ivory-deep)',
        }}>
          <div><div style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 22 }}>{ownerCounts.self}</div><div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>yours</div></div>
          <div><div style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 22 }}>{ownerCounts.followUp}</div><div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>follow-up</div></div>
          <div><div style={{ fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 22, color: ownerCounts.unassigned > 0 ? 'var(--rose)' : 'var(--gray-soft)' }}>{ownerCounts.unassigned}</div><div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>unowned</div></div>
        </div>

        {decisions.length > 0 && (
          <ExtractGroup label="Decisions" items={decisions} hoverCite={hoverCite} setHoverCite={setHoverCite} />
        )}
        {commitments.length > 0 && (
          <ExtractGroup label="Commitments" items={commitments} hoverCite={hoverCite} setHoverCite={setHoverCite} />
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
          {pushed ? (
            <div style={{
              padding: '10px 12px',
              background: 'rgba(91,110,58,0.10)',
              border: '1px solid rgba(91,110,58,0.30)',
              borderRadius: 6,
              fontSize: 12.5, color: '#3F4E26',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <I.check size={12} /> Pushed to{' '}
              <a href="#" onClick={(e)=>{e.preventDefault(); onNav('approvals');}}
                 style={{ color: '#3F4E26', textDecoration: 'underline' }}>Approvals</a> — review before Todoist send.
            </div>
          ) : (
            <>
              <button className="btn btn-primary" style={{ width: '100%', minHeight: 34, fontSize: 13 }}
                      onClick={onPush}>
                <I.upload size={12} /> Push {pushable} actions to Approvals
              </button>
              <div style={{ marginTop: 6, fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em',
                            textTransform: 'uppercase', color: 'var(--gray-soft)', textAlign: 'center' }}>
                Unowned items stay here until assigned
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function ExtractGroup({ label, items, hoverCite, setHoverCite }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 6 }}>{label}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(x => {
          const on = hoverCite === x.cite;
          return (
            <li key={x.id}
                onMouseEnter={() => setHoverCite(x.cite)}
                onMouseLeave={() => setHoverCite(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: on ? 'rgba(184,134,11,0.10)' : 'var(--ivory)',
                  borderLeft: on ? '2px solid var(--gold)' : '2px solid transparent',
                  fontSize: 13, lineHeight: 1.45, color: 'var(--ink)',
                  transition: 'all 120ms',
                }}>
              {x.text}
              <div style={{ marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
                {x.owner && <>owner: <span style={{ color: x.owner === 'unassigned' ? 'var(--rose)' : 'var(--gray)' }}>{x.owner}{x.followUpWith ? ` (${x.followUpWith})` : ''}</span> · </>}
                {x.dueIso && <>due {x.dueIso} · </>}
                {x.priorityHint && <span style={{ color: 'var(--gold)' }}>{x.priorityHint} · </span>}
                <span style={{ color: 'var(--gold)' }}>cite {x.cite}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

window.ScreenMeetings = ScreenMeetings;
