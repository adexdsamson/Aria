import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { fadeIn, slideUp } from '../easing';

/**
 * SceneAsk — mirrors the real AskScreen.tsx:
 *   - Thread sidebar (Threads list + "+" new-thread + Cmd-K footer note)
 *   - Main panel: account-filter chips header → user turn → AnswerCard → composer → privacy footer
 */

function typedText(full: string, frame: number, startFrame: number, charsPerFrame = 1.0): string {
  const chars = Math.floor(Math.max(0, frame - startFrame) * charsPerFrame);
  return full.slice(0, chars);
}

const QUESTION = 'What did Sarah commit to on the Q3 board deck?';

export const SceneAsk: React.FC = () => {
  const frame = useCurrentFrame(); // 0–209

  const sceneIn  = fadeIn(frame, 0, 15);
  const sceneOut = interpolate(frame, [175, 205], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity  = Math.min(sceneIn, sceneOut);

  const c = (start: number) => ({
    opacity: fadeIn(frame, start, 18),
    transform: `translateY(${slideUp(frame, start, 18)}px)`,
  });

  // Type-out question + reveal answer afterwards
  const question     = typedText(QUESTION, frame, 32, 1.05);
  const answerFade   = fadeIn(frame, 92, 22);
  const answerY      = slideUp(frame, 92, 22);
  const cite1Fade    = fadeIn(frame, 120, 16);
  const cite2Fade    = fadeIn(frame, 132, 16);
  const routeFade    = fadeIn(frame, 142, 14);

  return (
    <AbsoluteFill style={{ left: 256, top: 40, background: T.ivory, opacity }}>
      <div style={{ display: 'flex', height: '100%' }}>

        {/* Thread sidebar */}
        <aside style={{
          ...c(8),
          width: 256, flexShrink: 0,
          borderRight: `1px solid ${T.rule}`,
          padding: '24px 16px',
          display: 'flex', flexDirection: 'column',
          background: T.ivory,
        }}>
          <header style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'baseline', marginBottom: 14,
          }}>
            <h3 style={{
              margin: 0,
              fontFamily: T.fDisplay, fontWeight: 500,
              fontSize: 22, letterSpacing: '-0.01em',
              color: T.ink,
            }}>
              Threads
            </h3>
            <span style={{
              fontFamily: T.fMono, fontSize: 18, lineHeight: 1,
              width: 28, height: 28, borderRadius: 4,
              border: `1px solid ${T.ruleStrong}`,
              background: T.paper, color: T.goldDeep,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>+</span>
          </header>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { title: 'Q3 board deck commitments',     active: true },
              { title: 'Open items on the Maple deal',  active: false },
              { title: 'Who haven’t I replied to in 5+ days?', active: false },
              { title: 'What did Legal flag this month?', active: false },
            ].map((t) => (
              <div key={t.title} style={{
                padding: '9px 10px', borderRadius: 6,
                background: t.active ? T.ivoryDeep : 'transparent',
                borderLeft: t.active ? `2px solid ${T.gold}` : '2px solid transparent',
                color: t.active ? T.ink : T.inkSoft,
                fontFamily: T.fBody, fontSize: 13.5,
                fontWeight: t.active ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {t.title}
              </div>
            ))}
          </div>

          <p style={{
            margin: 0, paddingTop: 20,
            fontFamily: T.fMono, fontSize: 10,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: T.graySoft, lineHeight: 1.6,
          }}>
            ⌘K answers are ephemeral. Use “Expand to chat” to keep one.
          </p>
        </aside>

        {/* Main panel */}
        <main style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Account filter chips header */}
          <header style={{
            ...c(16),
            display: 'flex', gap: 8,
            padding: '18px 32px',
            borderBottom: `1px solid ${T.rule}`,
            alignItems: 'center', background: T.ivory,
          }}>
            <span style={{
              fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              color: T.gray, marginRight: 8,
            }}>Search across</span>
            {[
              { p: 'G', label: 'alex@aldridgeco.com', selected: true },
              { p: 'M', label: 'alex@aldridge.co',    selected: false },
            ].map((a) => (
              <span key={a.label} style={{
                fontFamily: T.fMono, fontSize: 12,
                letterSpacing: '0.08em',
                padding: '5px 12px',
                border: `1px solid ${a.selected ? T.gold : T.ruleStrong}`,
                borderRadius: 999,
                background: a.selected ? 'rgba(184,134,11,0.10)' : T.paper,
                color: a.selected ? T.goldDeep : T.gray,
              }}>
                {a.p} {a.label}
              </span>
            ))}
          </header>

          {/* Scroll area */}
          <section style={{
            flex: 1, overflow: 'hidden',
            padding: '32px 56px',
            maxWidth: 920, width: '100%',
            margin: '0 auto', boxSizing: 'border-box',
          }}>
            {/* User turn (typed bubble) */}
            <div style={{
              ...c(24),
              display: 'flex', justifyContent: 'flex-end',
              marginBottom: 24,
            }}>
              <div style={{
                maxWidth: '78%',
                padding: '12px 18px',
                background: T.ivoryDeep,
                border: `1px solid ${T.rule}`,
                borderRadius: 14,
                fontFamily: T.fBody, fontSize: 15.5,
                lineHeight: 1.55,
                color: T.ink,
              }}>
                {question}
                {question.length < QUESTION.length && (
                  <span style={{
                    display: 'inline-block', width: 2, height: 16,
                    background: T.ink, marginLeft: 1, verticalAlign: 'middle',
                    opacity: frame % 18 < 9 ? 1 : 0,
                  }} />
                )}
              </div>
            </div>

            {/* Answer card */}
            <div style={{
              opacity: answerFade,
              transform: `translateY(${answerY}px)`,
              maxWidth: 760, marginBottom: 18,
            }}>
              <div style={{
                fontFamily: 'Georgia, serif', fontSize: 17, lineHeight: 1.75,
                color: T.inkSoft, marginBottom: 18,
              }}>
                Sarah committed to two items in the May 6 board prep call:{' '}
                <strong style={{ color: T.ink }}>deliver v3 of the board deck by Monday</strong>{' '}
                (confirmed done) and{' '}
                <strong style={{ color: T.ink }}>lead with revenue, not pipeline, on slide 4</strong>.
              </div>

              {/* Sources */}
              <div style={{
                background: T.ivoryDeep,
                border: `1px solid ${T.rule}`,
                borderRadius: 6,
                padding: '14px 18px',
              }}>
                <div style={{
                  fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
                  color: T.gold, letterSpacing: '0.18em',
                  textTransform: 'uppercase', marginBottom: 10,
                }}>
                  Sources
                </div>
                {[
                  { kind: 'MEETING', label: 'Board prep · Sarah Chen · 6 May 2026', fade: cite1Fade },
                  { kind: 'EMAIL',   label: 'Sarah Chen · “Board deck — v3 attached” · 12 May', fade: cite2Fade },
                ].map((s) => (
                  <div key={s.kind} style={{
                    display: 'flex', alignItems: 'baseline', gap: 14,
                    padding: '9px 0',
                    borderTop: `1px dotted ${T.rule}`,
                    opacity: s.fade,
                  }}>
                    <span style={{
                      fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
                      color: T.gold, letterSpacing: '0.16em', textTransform: 'uppercase',
                      flexShrink: 0, minWidth: 60,
                    }}>{s.kind}</span>
                    <span style={{
                      fontFamily: T.fBody, fontSize: 13.5,
                      color: T.inkSoft,
                    }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Route badge */}
              <div style={{ marginTop: 14, opacity: routeFade }}>
                <span style={{
                  fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  padding: '4px 10px', borderRadius: 4,
                  border: `1px solid rgba(184,134,11,0.3)`,
                  background: 'rgba(184,134,11,0.08)',
                  color: T.goldDeep, marginRight: 10,
                }}>
                  LOCAL · llama3.1:8b
                </span>
                <span style={{
                  fontFamily: T.fMono, fontSize: 10,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: T.graySoft,
                }}>
                  3.8s · no data left your machine
                </span>
              </div>
            </div>
          </section>

          {/* Composer */}
          <footer style={{
            ...c(60),
            display: 'flex', gap: 12,
            padding: '16px 32px',
            borderTop: `1px solid ${T.rule}`,
            background: T.ivory,
            alignItems: 'flex-end',
          }}>
            <div style={{
              flex: 1,
              padding: '12px 16px',
              background: T.paper,
              border: `1px solid ${T.rule}`,
              borderRadius: 6,
              fontFamily: T.fDisplay, fontStyle: 'italic',
              fontSize: 16, lineHeight: 1.5,
              color: T.graySoft,
              minHeight: 48, boxSizing: 'border-box',
            }}>
              Ask a question about your data…
            </div>
            <div style={{
              background: T.gold, color: T.ivory,
              padding: '12px 22px', borderRadius: 6,
              fontFamily: T.fBody, fontSize: 14, fontWeight: 600,
              letterSpacing: '0.02em',
            }}>
              Ask
            </div>
          </footer>

          {/* Privacy caption row */}
          <div style={{
            ...c(70),
            padding: '10px 32px 18px',
            background: T.ivory,
            fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: T.graySoft,
            display: 'flex', gap: 14, flexWrap: 'wrap',
          }}>
            <span>BM25 + nomic-embed-text</span>
            <span>·</span>
            <span>Queries stay local</span>
            <span>·</span>
            <span>PII routes to llama3.1:8b</span>
          </div>
        </main>
      </div>
    </AbsoluteFill>
  );
};
