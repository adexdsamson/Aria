/**
 * D-13 design tokens — single source-of-truth for palette, type scale, radii,
 * and spacing. `tokens.light` and `tokens.dark` drive both Tailwind theme
 * extension and CSS variables in `globals.css`.
 *
 * Accent color rationale: `#5b8def` (indigo-ish) sits between Tailwind's
 * indigo-400 and blue-500. It hits WCAG AA on both the light and dark neutral
 * backgrounds defined below, reads as "calm professional" rather than playful,
 * and stays visually distinct from system blue on Windows 11 / macOS.
 */

export const tokens = {
  light: {
    'gray-50': '#fafafa',
    'gray-100': '#f4f4f5',
    'gray-200': '#e4e4e7',
    'gray-300': '#d4d4d8',
    'gray-400': '#a1a1aa',
    'gray-500': '#71717a',
    'gray-600': '#52525b',
    'gray-700': '#3f3f46',
    'gray-800': '#27272a',
    'gray-900': '#18181b',
    'gray-950': '#09090b',
    accent: '#5b8def',
    'accent-fg': '#ffffff',
    bg: '#ffffff',
    fg: '#18181b',
    'muted-fg': '#52525b',
    border: '#e4e4e7',
  },
  dark: {
    'gray-50': '#09090b',
    'gray-100': '#18181b',
    'gray-200': '#27272a',
    'gray-300': '#3f3f46',
    'gray-400': '#52525b',
    'gray-500': '#71717a',
    'gray-600': '#a1a1aa',
    'gray-700': '#d4d4d8',
    'gray-800': '#e4e4e7',
    'gray-900': '#f4f4f5',
    'gray-950': '#fafafa',
    accent: '#7aa2f7',
    'accent-fg': '#0b1220',
    bg: '#0b0b0d',
    fg: '#f4f4f5',
    'muted-fg': '#a1a1aa',
    border: '#27272a',
  },
} as const;

export const typeScale = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
} as const;

export const radii = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
} as const;

export type Tokens = typeof tokens;
