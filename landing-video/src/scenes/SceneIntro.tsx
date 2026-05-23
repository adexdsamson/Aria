import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { easeOut } from '../easing';

export const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame(); // 0–119

  const logoOpacity  = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp', easing: easeOut });
  const logoY        = interpolate(frame, [0, 20], [20, 0], { extrapolateRight: 'clamp', easing: easeOut });
  const tagOpacity   = interpolate(frame, [18, 40], [0, 1], { extrapolateRight: 'clamp', easing: easeOut });
  const subOpacity   = interpolate(frame, [35, 55], [0, 1], { extrapolateRight: 'clamp', easing: easeOut });
  const ruleW        = interpolate(frame, [10, 50], [0, 160], { extrapolateRight: 'clamp', easing: easeOut });

  // Fade out at end of intro
  const exitOpacity  = interpolate(frame, [90, 115], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: T.ink,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: exitOpacity,
    }}>
      {/* Brand monogram */}
      <div style={{ opacity: logoOpacity, transform: `translateY(${logoY}px)`, marginBottom: 32 }}>
        <div style={{
          width: 80, height: 80, borderRadius: 16,
          border: `1.5px solid rgba(184,134,11,0.6)`,
          background: 'rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: T.fDisplay, fontWeight: 500, fontSize: 54,
            color: T.ivory, lineHeight: 1,
            borderBottom: `2px solid ${T.gold}`,
          }}>A</span>
        </div>
      </div>

      {/* Gold rule */}
      <div style={{
        width: ruleW, height: 1, background: T.gold, marginBottom: 28,
        opacity: 0.7,
      }} />

      {/* Logotype */}
      <div style={{ opacity: tagOpacity, marginBottom: 16 }}>
        <span style={{
          fontFamily: T.fDisplay, fontWeight: 500, fontSize: 64,
          color: T.ivory, letterSpacing: '-0.02em', lineHeight: 1,
        }}>Aria</span>
      </div>

      {/* Tagline */}
      <div style={{ opacity: subOpacity }}>
        <span style={{
          fontFamily: T.fDisplay, fontStyle: 'italic', fontSize: 26,
          color: 'rgba(255,255,255,0.5)', letterSpacing: '0.01em',
        }}>
          A chief of staff who lives on your desk.
        </span>
      </div>

      {/* Bottom strip */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 1, background: `rgba(184,134,11,0.3)`,
        opacity: subOpacity,
      }} />
    </AbsoluteFill>
  );
};
