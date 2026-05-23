import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { fadeIn, easeOut } from '../easing';

export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame(); // 0–89

  const bgFade   = fadeIn(frame, 0, 16);
  const logoFade = fadeIn(frame, 10, 18);
  const tagFade  = fadeIn(frame, 22, 18);
  const ctaFade  = fadeIn(frame, 38, 20);
  const noteFade = fadeIn(frame, 52, 16);

  // End hold: fade out the very last 10 frames (freeze-frame on black)
  const endOut = interpolate(frame, [78, 89], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: T.ink,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: Math.min(bgFade, endOut),
    }}>
      {/* Brand */}
      <div style={{ opacity: logoFade, marginBottom: 24, textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 13,
            border: `1.5px solid rgba(184,134,11,0.5)`,
            background: 'rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: T.fDisplay, fontWeight: 500, fontSize: 42,
              color: T.ivory, lineHeight: 1,
            }}>A</span>
          </div>
          <span style={{
            fontFamily: T.fDisplay, fontWeight: 500, fontSize: 54,
            color: T.ivory, letterSpacing: '-0.02em',
          }}>Aria</span>
        </div>
      </div>

      {/* Gold rule */}
      <div style={{
        width: interpolate(frame, [8, 45], [0, 140], { extrapolateRight: 'clamp', easing: easeOut }),
        height: 1, background: T.gold, opacity: 0.65,
        marginBottom: 28,
      }} />

      {/* Tagline */}
      <div style={{ opacity: tagFade, marginBottom: 40, textAlign: 'center' }}>
        <p style={{
          fontFamily: T.fDisplay, fontStyle: 'italic', fontSize: 28,
          color: 'rgba(255,255,255,0.55)', margin: 0,
        }}>
          Local-first · private by design
        </p>
      </div>

      {/* CTA buttons */}
      <div style={{ opacity: ctaFade, display: 'flex', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Download for Windows', sub: '.exe · Windows 10+' },
          { label: 'Download for macOS', sub: '.dmg · Apple Silicon' },
        ].map((btn) => (
          <div key={btn.label} style={{
            background: T.ivory, color: T.ink,
            padding: '14px 28px', borderRadius: 8,
            fontFamily: T.fBody, cursor: 'default',
            textAlign: 'center',
          }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 3 }}>{btn.label}</div>
            <div style={{ fontFamily: T.fMono, fontSize: 10, color: T.gray, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{btn.sub}</div>
          </div>
        ))}
      </div>

      {/* Note */}
      <div style={{ opacity: noteFade }}>
        <span style={{ fontFamily: T.fMono, fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          Free early access · aria.app
        </span>
      </div>
    </AbsoluteFill>
  );
};
