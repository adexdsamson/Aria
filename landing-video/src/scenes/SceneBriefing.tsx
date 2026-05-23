import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { fadeIn, slideUp } from '../easing';

/**
 * SceneBriefing — mirrors the real BriefingScreen.tsx broadsheet layout:
 *   - Masthead row (volume / date / TZ / route badge / regenerate)
 *   - h1 "Today's Briefing — <italic date>"
 *   - Dropcap paragraph (Playfair italic first letter, ❦ fleuron close)
 *   - Section cascade: Open Actions / Calendar / Email
 *   - Editorial footer
 */
export const SceneBriefing: React.FC = () => {
  const frame = useCurrentFrame(); // 0–209

  const sceneIn  = fadeIn(frame, 0, 15);
  const sceneOut = interpolate(frame, [175, 205], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity  = Math.min(sceneIn, sceneOut);

  // Cascade: each element gets fadeIn + slideUp starting at staggered frame.
  const c = (start: number) => ({
    opacity: fadeIn(frame, start, 18),
    transform: `translateY(${slideUp(frame, start, 18)}px)`,
  });

  return (
    <AbsoluteFill style={{ left: 256, top: 40, background: T.ivory, opacity }}>
      <div style={{
        maxWidth: 920, margin: '0 auto',
        padding: '56px 64px 80px',
        color: T.ink,
      }}>
        {/* Masthead row */}
        <div style={{
          ...c(8),
          display: 'flex', alignItems: 'center', gap: 12,
          paddingBottom: 14, marginBottom: 36,
          borderBottom: `1px solid ${T.rule}`,
        }}>
          <span style={{
            fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
            letterSpacing: '0.25em', textTransform: 'uppercase',
            color: T.gold, whiteSpace: 'nowrap',
          }}>
            The Morning · Vol. I, No. 144
          </span>
          <span style={{
            width: 4, height: 4, borderRadius: 50, background: T.grayFaint, flexShrink: 0,
          }} />
          <span style={{
            fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: T.gray, flex: 1, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Thursday, 21 May 2026 · America/New_York
          </span>
          <span style={{
            fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            padding: '4px 10px', borderRadius: 4,
            border: `1px solid rgba(184,134,11,0.3)`,
            background: 'rgba(184,134,11,0.08)',
            color: T.goldDeep,
          }}>
            LOCAL · llama3.1:8b
          </span>
          <span style={{
            fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            padding: '4px 8px', color: T.gold,
          }}>
            ↺ Regenerate
          </span>
        </div>

        {/* Headline */}
        <div style={{ ...c(18), marginBottom: 28 }}>
          <h1 style={{
            fontFamily: T.fDisplay, fontWeight: 500,
            fontSize: 64, lineHeight: 1.05,
            letterSpacing: '-0.02em',
            margin: '0 0 22px 0',
          }}>
            Today's Briefing —{' '}
            <span style={{ fontStyle: 'italic', color: T.gray }}>Thursday, May 21</span>
          </h1>

          {/* Dropcap paragraph */}
          <p style={{
            fontSize: 19, lineHeight: 1.75,
            color: T.inkSoft, maxWidth: '38em',
            margin: 0, letterSpacing: '0.005em',
          }}>
            <span style={{
              float: 'left',
              fontFamily: T.fDisplay, fontStyle: 'italic',
              fontWeight: 500, fontSize: '5.5em', lineHeight: 0.85,
              padding: '0.12em 0.14em 0 0',
              color: T.ink,
            }}>g</span>
            ood morning. A quiet brief of what matters today — your calendar,
            the mail flagged important, and a short pull from the wire.{' '}
            <span style={{ fontStyle: 'italic', color: T.gold }}>❦</span>
          </p>
        </div>

        {/* Open Actions */}
        <section style={{ ...c(30), marginBottom: 40 }}>
          <SectionHead>Open Actions</SectionHead>
          <ItalicLede>
            Unresolved commitments from meetings and email, ranked by deadline.
          </ItalicLede>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {[
              {
                title: 'Send revised Maple side letter to Legal',
                why: 'Marcus needs sign-off before tomorrow’s 2pm close call.',
              },
              {
                title: 'Confirm Q3 board deck timeline with Sarah',
                why: 'She committed to v3 by Monday; circle back today.',
              },
              {
                title: 'Reply to David — investor intro at Acme',
                why: 'Open since Friday; 5-day reply threshold reached.',
              },
            ].map((item, i, all) => (
              <li key={i} style={{
                padding: '14px 0',
                borderTop: `1px solid ${T.rule}`,
                borderBottom: i === all.length - 1 ? `1px solid ${T.rule}` : 'none',
              }}>
                <div style={{ fontSize: 16, color: T.ink, marginBottom: 6 }}>
                  {item.title}
                </div>
                <Why text={item.why} />
              </li>
            ))}
          </ul>
        </section>

        {/* Calendar */}
        <section style={{ ...c(42), marginBottom: 40 }}>
          <SectionHead>Calendar</SectionHead>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {[
              { t: '09:00', title: 'Series B close call', sub: 'Marcus Chen · Aldridge Capital' },
              { t: '12:30', title: 'Lunch with Sarah', sub: 'Sarah Chen' },
              { t: '15:00', title: 'Board prep — Q3 deck', sub: 'Solo · 90 min' },
            ].map((row, i) => (
              <li key={i} style={{
                display: 'grid', gridTemplateColumns: '72px 1fr',
                alignItems: 'baseline', gap: 18,
                padding: '12px 0',
                borderTop: `1px dotted ${T.rule}`,
              }}>
                <span style={{
                  fontFamily: T.fMono, fontSize: 12.5,
                  color: T.gray, letterSpacing: '0.08em',
                }}>{row.t}</span>
                <span>
                  <div style={{ fontSize: 15.5, color: T.ink }}>{row.title}</div>
                  <div style={{
                    fontFamily: T.fDisplay, fontStyle: 'italic',
                    fontSize: 13, color: T.gray, marginTop: 2,
                  }}>{row.sub}</div>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Email */}
        <section style={{ ...c(54), marginBottom: 40 }}>
          <SectionHead>Email</SectionHead>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {[
              {
                from: 'Marcus Chen',
                subj: 'Re: Term sheet — drag-along language',
                why: 'Replied 3× this week. Time-bound to today’s call.',
              },
              {
                from: 'Legal (Maple)',
                subj: 'Side letter — rev 3 ready for review',
                why: 'Blocks the close; you’re the only outstanding signer.',
              },
            ].map((row, i, all) => (
              <li key={i} style={{
                padding: '12px 0',
                borderTop: `1px solid ${T.rule}`,
                borderBottom: i === all.length - 1 ? `1px solid ${T.rule}` : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>{row.from}</span>
                  <span style={{
                    fontFamily: T.fMono, fontSize: 10, color: T.graySoft,
                    letterSpacing: '0.15em', textTransform: 'uppercase',
                  }}>Inbox</span>
                </div>
                <div style={{ fontSize: 14.5, color: T.inkSoft, marginBottom: 6 }}>{row.subj}</div>
                <Why text={row.why} />
              </li>
            ))}
          </ul>
        </section>

        {/* Footer */}
        <footer style={{
          ...c(68),
          borderTop: `1px solid ${T.rule}`,
          paddingTop: 18, marginTop: 8,
          display: 'flex', alignItems: 'center', gap: 16,
          color: T.graySoft, fontSize: 11,
        }}>
          <span style={{ fontSize: 16, color: T.gold }}>❦</span>
          <span style={{
            fontFamily: T.fMono, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Briefing generated 07:00 · Local model · llama3.1:8b
          </span>
        </footer>
      </div>
    </AbsoluteFill>
  );
};

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: T.fDisplay, fontSize: 28, fontWeight: 500,
      letterSpacing: '-0.01em', margin: '0 0 6px 0',
    }}>
      {children}
    </h2>
  );
}

function ItalicLede({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: T.fDisplay, fontStyle: 'italic',
      color: T.gray, fontSize: 15, marginBottom: 18,
    }}>
      {children}
    </div>
  );
}

function Why({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 10,
      color: T.gray, fontSize: 13.5, lineHeight: 1.55,
    }}>
      <span style={{
        fontFamily: T.fMono, fontSize: 10,
        letterSpacing: '0.2em', textTransform: 'uppercase',
        color: T.gold, flexShrink: 0,
      }}>Why</span>
      <span style={{ fontStyle: 'italic' }}>{text}</span>
    </div>
  );
}
