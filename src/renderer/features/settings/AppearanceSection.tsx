import { useState } from 'react';
import { type ThemeMode, getThemeMode, setThemeMode } from '../../hooks/useTheme';

const THEME_OPTIONS: { value: ThemeMode; label: string; sub: string }[] = [
  { value: 'system', label: 'System', sub: 'Follow OS setting' },
  { value: 'light',  label: 'Light',  sub: 'Always light'      },
  { value: 'dark',   label: 'Dark',   sub: 'Always dark'       },
];

export function AppearanceSection(): JSX.Element {
  return (
    <div data-testid="settings-appearance" style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>SETTINGS · APPEARANCE</div>
        <h2 style={titleStyle}>Theme</h2>
        <p style={descStyle}>
          Choose whether Aria uses a light or dark palette, or follows your
          operating-system setting.
        </p>
        <ThemePicker />
      </div>
    </div>
  );
}

function ThemePicker(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);

  const pick = (mode: ThemeMode): void => {
    setTheme(mode);
    setThemeMode(mode);
  };

  return (
    <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
      {THEME_OPTIONS.map(({ value, label, sub }, i) => {
        const active = theme === value;
        return (
          <button
            key={value}
            data-testid={`theme-${value}`}
            onClick={() => pick(value)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: '1px solid var(--rule)',
              borderLeft: i === 0 ? '1px solid var(--rule)' : 'none',
              borderRadius: i === 0 ? '4px 0 0 4px' : i === 2 ? '0 4px 4px 0' : 0,
              background: active ? 'var(--ink)' : 'var(--paper)',
              color: active ? 'var(--ivory)' : 'var(--ink)',
              cursor: 'pointer',
              transition: 'all 150ms ease',
              textAlign: 'center' as const,
            }}
          >
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: active ? 600 : 400 }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em', opacity: 0.65, marginTop: 2 }}>
              {sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}

import type * as React from 'react';

const containerStyle: React.CSSProperties = {
  padding: 32,
  maxWidth: 720,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  padding: 28,
};

const headerStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--gray)',
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--f-display)',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  margin: '0 0 10px',
  color: 'var(--ink)',
};

const descStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--ink-soft)',
  margin: '0 0 18px',
};
