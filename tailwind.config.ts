import type { Config } from 'tailwindcss';
import { tokens } from './src/renderer/app/theme/tokens';

/**
 * Tailwind 3.4 config (NOT v4 — locked by RESOLVED Open Question 5).
 * darkMode: 'media' implements D-13 system light/dark.
 * theme.extend pulls from the tokens module; plan 01b expands the palette.
 */
const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        ...(tokens.light as Record<string, string>),
      },
    },
  },
  plugins: [],
};

export default config;
