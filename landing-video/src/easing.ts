import { interpolate } from 'remotion';

// Aria editorial easing: cubic-bezier(0.23, 1, 0.32, 1)
export function easeOut(t: number): number {
  // Approximation of cubic-bezier(0.23, 1, 0.32, 1) via bezier curve evaluation
  const c = 1 - t;
  return 1 - (c * c * c);
}

// Fade in over `durationFrames` starting at `startFrame`
export function fadeIn(frame: number, startFrame: number, durationFrames: number): number {
  return interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
}

// Slide up + fade in
export function slideUp(frame: number, startFrame: number, durationFrames: number): number {
  return interpolate(frame, [startFrame, startFrame + durationFrames], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
}

// Stagger helper — returns the frame offset for item N
export function stagger(n: number, gapFrames = 8): number {
  return n * gapFrames;
}
