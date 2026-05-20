// app-screen-recap.jsx — Weekly Recap (Plan 08-02 shipped UI).
//
// Mirrors RecapScreen.tsx + RecapEditor.tsx:
//   • List of past recaps (most recent first) → click to open editor inline
//   • Editor with 4 editable sections (meetings / actions / wins / upcoming)
//     plus a "What Aria did this week" section: editable narrative + a
//     read-only verbatim audit list ("the trust anchor").
//   • Save / Finalize / Export DOCX / Export PDF buttons
//   • Finalized recaps go read-only; "Finalized" pill on header.

function ScreenRecap({ onNav }) {
  const [openId, setOpenId] = React.useState(null);
  const open = openId ? RECAPS.find(r => r.id === openId) : null;

  if (open) return <RecapEditor recap={open} onBack={() => setOpenId(null)} />;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 32px 80px' }}>

      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 14,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '2.25rem', letterSpacing:'-0.015em' }}>
          Weekly Recap
        </h1>
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
          <I.refresh size={12} /> Generate last-week recap
        </button>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 24, maxWidth: '46em' }}>
        Aria writes you a recap every Monday morning. Edits stick; once you finalize a week it becomes the canonical record and can be exported to DOCX or PDF.
      </p>

      <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 10 }}>
        Past recaps
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {RECAPS.map((r, i) => {
          const isCurrent = !r.finalizedAt;
          return (
            <li key={r.id} style={{
              borderTop: '1px solid var(--rule)',
              borderBottom: i === RECAPS.length - 1 ? '1px solid var(--rule)' : 'none',
            }}>
              <button onClick={() => setOpenId(r.id)} style={{
                all:'unset', boxSizing:'border-box', cursor:'default',
                display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 18,
                width: '100%', padding: '20px 0',
                alignItems: 'center',
              }}>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: isCurrent ? 'var(--gold)' : 'var(--gray)', letterSpacing: '0.1em' }}>
                  {r.isoWeek}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 19, fontWeight: 500, color: 'var(--ink)' }}>
                    {r.label}
                  </div>
                  <div style={{ marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--gray-soft)' }}>
                    {isCurrent
                      ? 'Draft \u00b7 ready for review'
                      : `Finalized ${r.finalizedAt}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isCurrent && (
                    <span style={{
                      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(184,134,11,0.10)', color: 'var(--gold-deep)',
                      border: '1px solid rgba(184,134,11,0.25)',
                    }}>Draft</span>
                  )}
                  {!isCurrent && (
                    <span style={{
                      fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(91,110,58,0.12)', color: '#3F4E26',
                      border: '1px solid rgba(91,110,58,0.25)',
                    }}>Finalized</span>
                  )}
                  <span style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic', color: 'var(--gold)', fontSize: 16 }}>open →</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────── Recap editor ─────────
function RecapEditor({ recap, onBack }) {
  const [canonical, setCanonical] = React.useState(recap.canonical);
  const [toast, setToast] = React.useState(null);
  const isFinalized = !!recap.finalizedAt;

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 1800); }
  function patch(key, next) { setCanonical({ ...canonical, [key]: next }); }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px 80px' }}>
      <button onClick={onBack} style={{
        all:'unset', boxSizing:'border-box', cursor:'default',
        fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'var(--gray-soft)',
        marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        ← Back to list
      </button>

      {/* Masthead */}
      <div style={{
        paddingBottom: 18, marginBottom: 26,
        borderBottom: '1px solid var(--rule)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="smallcaps" style={{ color: 'var(--gold)' }}>Recap \u00b7 {recap.isoWeek}</span>
          <span style={{ width: 4, height: 4, borderRadius: 50, background: 'var(--gray-faint)' }} />
          <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>{recap.label}</span>
          {isFinalized && (
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 999,
              background: 'rgba(91,110,58,0.12)', color: '#3F4E26',
              border: '1px solid rgba(91,110,58,0.25)',
            }}>Finalized</span>
          )}
        </div>
        <h1 style={{
          fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 500,
          letterSpacing: '-0.02em', marginBottom: 8,
        }}>
          The week, in brief.
        </h1>
        <p className="serif italic" style={{ fontSize: 16, color: 'var(--gray)' }}>
          Edits stick to the canonical record. Finalize when you're done — it becomes the source of truth and unlocks export.
        </p>
      </div>

      {/* Editable sections */}
      {['meetings','actions','wins','upcoming'].map(k => (
        <SectionEditor key={k} sectionKey={k}
                       section={canonical[k]}
                       readOnly={isFinalized}
                       onChange={(next) => patch(k, next)} />
      ))}

      {/* What Aria did — narrative editable + audit read-only */}
      <WhatAriaDid section={canonical.whatAriaDid} readOnly={isFinalized}
                   onNarrativeChange={(text) => patch('whatAriaDid', { ...canonical.whatAriaDid, narrative: text })} />

      {/* Actions */}
      <div style={{
        marginTop: 28, paddingTop: 18,
        borderTop: '1px solid var(--rule)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        {!isFinalized && (
          <>
            <button className="btn btn-outline" style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}
                    onClick={() => flash('Saved.')}>
              <I.check size={12} /> Save edits
            </button>
            <button className="btn btn-primary" style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}
                    onClick={() => flash('Finalized.')}>
              <I.lock size={12} /> Finalize
            </button>
            <span style={{ width: 1, height: 22, background: 'var(--rule)', margin: '0 6px' }} />
          </>
        )}
        <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}
                onClick={() => flash('Saved to ~/Documents/Aria-Recap-W20.docx')}>
          <I.doc size={12} /> Export DOCX
        </button>
        <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}
                onClick={() => flash('Saved to ~/Documents/Aria-Recap-W20.pdf')}>
          <I.doc size={12} /> Export PDF
        </button>
        <span style={{ flex: 1 }} />
        {toast && (
          <span role="status" style={{
            padding: '6px 12px',
            background: 'rgba(91,110,58,0.10)',
            border: '1px solid rgba(91,110,58,0.30)',
            color: '#3F4E26', borderRadius: 999, fontSize: 12.5,
          }}>{toast}</span>
        )}
      </div>
    </div>
  );
}

function SectionEditor({ sectionKey, section, readOnly, onChange }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <input value={section.heading} disabled={readOnly}
             onChange={(e) => onChange({ ...section, heading: e.target.value })}
             style={{
               width: '100%', padding: 0, marginBottom: 12,
               background: 'transparent', border: 'none', outline: 'none',
               fontFamily: 'var(--f-display)', fontSize: 26, fontWeight: 500,
               letterSpacing: '-0.01em', color: 'var(--ink)',
             }} />
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 6, padding: '14px 18px',
        opacity: readOnly ? 0.85 : 1,
      }}>
        {(section.blocks || []).map((b, i) => <BlockEditor key={i} block={b} readOnly={readOnly}
                                                onChange={(next) => {
                                                  const blocks = section.blocks.slice();
                                                  blocks[i] = next;
                                                  onChange({ ...section, blocks });
                                                }} />)}
        {(section.blocks || []).length === 0 && (
          <p style={{ margin: 0, color: 'var(--gray-soft)', fontStyle: 'italic', fontSize: 13.5 }}>
            (empty section — click to add notes)
          </p>
        )}
      </div>
    </section>
  );
}

function BlockEditor({ block, readOnly, onChange }) {
  if (block.kind === 'paragraph') {
    return (
      <textarea defaultValue={block.text} readOnly={readOnly} rows={2}
                onChange={(e) => onChange({ ...block, text: e.target.value })}
                style={{
                  width: '100%', border: 'none', outline: 'none', resize: 'vertical',
                  background: 'transparent', padding: 0, marginBottom: 12,
                  fontFamily: 'var(--f-body)', fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink-soft)',
                }} />
    );
  }
  if (block.kind === 'bullet_list' || block.kind === 'numbered_list') {
    const Tag = block.kind === 'numbered_list' ? 'ol' : 'ul';
    return (
      <Tag style={{ paddingLeft: 22, margin: '4px 0 10px 0' }}>
        {(block.items || []).map((it, i) => (
          <li key={i} style={{ marginBottom: 4, fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            <span contentEditable={!readOnly} suppressContentEditableWarning
                  onBlur={(e) => {
                    const items = block.items.slice();
                    items[i] = e.currentTarget.textContent || '';
                    onChange({ ...block, items });
                  }}
                  style={{ outline: 'none' }}>{it}</span>
          </li>
        ))}
      </Tag>
    );
  }
  return null;
}

function WhatAriaDid({ section, readOnly, onNarrativeChange }) {
  return (
    <section style={{
      marginTop: 36, padding: '24px 26px',
      background: 'var(--ivory)',
      border: '1px solid var(--rule)',
      borderLeft: '2px solid var(--gold)',
      borderRadius: 6,
    }}>
      <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 6 }}>
        Trust anchor
      </div>
      <h2 style={{
        fontFamily: 'var(--f-display)', fontWeight: 500, fontSize: 26,
        letterSpacing: '-0.01em', marginBottom: 14,
      }}>{section.heading}</h2>

      <div style={{ marginBottom: 18 }}>
        <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }}>Narrative \u00b7 editable</div>
        <textarea defaultValue={section.narrative} readOnly={readOnly} rows={4}
                  onChange={(e) => onNarrativeChange(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 4,
                    background: 'var(--paper)', border: '1px solid var(--rule)',
                    fontFamily: 'var(--f-display)', fontStyle: 'italic',
                    fontSize: 15, lineHeight: 1.6, color: 'var(--ink-soft)',
                    resize: 'vertical',
                  }} />
      </div>

      <div>
        <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6 }}>
          What Aria actually did \u00b7 read-only audit
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {(section.blocks || []).flatMap(b => b.items || []).map((row, i, arr) => (
            <li key={i} style={{
              padding: '8px 0',
              borderBottom: i < arr.length - 1 ? '1px dashed var(--rule)' : 'none',
              fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--gray)', letterSpacing: '0.02em',
              lineHeight: 1.55,
            }}>
              {row}
            </li>
          ))}
          {((section.blocks || []).flatMap(b => b.items || []).length === 0) && (
            <li style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--gray-soft)', fontStyle: 'italic' }}>
              No agent actions logged for this week.
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

window.ScreenRecap = ScreenRecap;
