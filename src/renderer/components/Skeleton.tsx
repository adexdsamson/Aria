/**
 * Skeleton — shimmer placeholder components for loading states.
 *
 * GPU-accelerated: only `transform` animates on the highlight overlay,
 * never `background-position`. Renders a keyframe `<style>` tag inline
 * (same pattern as BriefingScreen animation block).
 *
 * Exports:
 *   SkeletonLine   — thin single line (text-like)
 *   SkeletonBlock  — taller rectangular block (card / image)
 *   SkeletonRows   — N stacked lines with stagger
 *   SkeletonRoot   — fade-in wrapper for a loading section
 *
 * prefers-reduced-motion: shimmer removed, static fill kept.
 */
import type * as React from 'react';

// ─── Keyframes (injected once) ────────────────────────────────────────────

const SK_STYLE = (
  <style key="aria-skeleton-styles">{`
    @keyframes sk-shimmer {
      0%   { transform: translateX(-160%); }
      100% { transform: translateX(160%);  }
    }
    @keyframes sk-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sk-shimmer { display: none; }
    }
  `}</style>
);

// ─── Shimmer highlight overlay ────────────────────────────────────────────

function Shimmer(): JSX.Element {
  return (
    <div
      className="sk-shimmer"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
        animation: 'sk-shimmer 1.6s linear infinite',
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── Base bar (shared) ────────────────────────────────────────────────────

interface BarProps {
  width?: string | number;
  height?: string | number;
  radius?: number;
  style?: React.CSSProperties;
}

function Bar({ width = '100%', height = 12, radius = 4, style }: BarProps): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        width,
        height,
        borderRadius: radius,
        background: 'var(--rule)',
        flexShrink: 0,
        ...style,
      }}
    >
      <Shimmer />
    </div>
  );
}

// ─── Public exports ───────────────────────────────────────────────────────

/** Single thin line — mimics a line of text. */
export function SkeletonLine({
  width = '100%',
  height = 13,
  style,
}: {
  width?: string | number;
  height?: number;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <>
      {SK_STYLE}
      <Bar width={width} height={height} radius={4} style={style} />
    </>
  );
}

/** Taller rectangle — mimics a card, image, or content block. */
export function SkeletonBlock({
  width = '100%',
  height = 60,
  radius = 6,
  style,
}: {
  width?: string | number;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <>
      {SK_STYLE}
      <Bar width={width} height={height} radius={radius} style={style} />
    </>
  );
}

/**
 * N stacked lines with variable widths and 40ms stagger.
 * Each item in `lines` is a width string (e.g. `'85%'`).
 */
export function SkeletonRows({
  lines = ['100%', '85%', '70%'],
  lineHeight = 13,
  gap = 10,
}: {
  lines?: (string | number)[];
  lineHeight?: number;
  gap?: number;
}): JSX.Element {
  return (
    <>
      {SK_STYLE}
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {lines.map((w, i) => (
          <Bar
            key={i}
            width={w}
            height={lineHeight}
            radius={4}
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Fade-in wrapper — delays appearance by 80ms so instant loads
 * never flash a skeleton, then fades in smoothly over 200ms.
 */
export function SkeletonRoot({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <>
      {SK_STYLE}
      <div
        style={{
          opacity: 0,
          animation: 'sk-fade-in 220ms ease-out 80ms forwards',
          ...style,
        }}
      >
        {children}
      </div>
    </>
  );
}
