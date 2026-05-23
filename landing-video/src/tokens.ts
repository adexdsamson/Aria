// Design tokens — mirrors the Aria editorial system
export const T = {
  ivory:       '#FAFAF8',
  ivoryDeep:   '#F5F3F0',
  paper:       '#FFFFFF',
  ink:         '#1A1A1A',
  inkSoft:     '#2A2826',
  gray:        '#6B6B6B',
  graySoft:    '#8A8784',
  grayFaint:   '#C7C2BB',
  rule:        '#E8E4DF',
  ruleStrong:  '#D6D1C8',
  gold:        '#B8860B',
  goldLight:   '#D4A84B',
  goldDeep:    '#8E6708',

  // Typography (Google Fonts loaded via @remotion/google-fonts or inline fallbacks)
  fDisplay: '"Playfair Display", Georgia, serif',
  fBody:    '"Source Sans 3", system-ui, sans-serif',
  fMono:    '"IBM Plex Mono", ui-monospace, monospace',
} as const;
