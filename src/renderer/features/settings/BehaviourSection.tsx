/**
 * Phase 12 / Plan 12-01 Task 3 — Settings → Behaviour panel.
 *
 * Three editorial toggles backed by the BG_GET_PREFS / BG_SET_PREFS IPC
 * channels. Uses the editorial Checkbox primitive (NOT the native blue box
 * — see project memory `editorial Checkbox primitive`).
 *
 * Layout mirrors the editorial card pattern from IntegrationsSection:
 * hairline border, Playfair italic heading, mono description, three
 * Checkbox rows separated by hairline dividers.
 */
import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { CHANNELS, type BackgroundPrefsDto, type BackgroundPrefsPatchDto, type IpcError } from '../../../shared/ipc-contract';
import { Checkbox } from '../../components/editorial/Checkbox';

interface BehaviourPrefsView {
  autoLaunch: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_VIEW: BehaviourPrefsView = {
  autoLaunch: false,
  closeToTray: true,
  notificationsEnabled: true,
};

function isPrefsDto(x: unknown): x is BackgroundPrefsDto {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { autoLaunch?: unknown }).autoLaunch === 'boolean' &&
    typeof (x as { closeToTray?: unknown }).closeToTray === 'boolean' &&
    typeof (x as { notificationsEnabled?: unknown }).notificationsEnabled === 'boolean'
  );
}

function invokeBg<T>(channel: string, payload?: unknown): Promise<T | IpcError> {
  // window.aria.invoke is not exposed by the auto-mapped bridge; call
  // through the camelCase API names directly.
  const aria = window.aria as unknown as Record<string, (req?: unknown) => Promise<T | IpcError>>;
  const method = channel === CHANNELS.BG_GET_PREFS ? 'backgroundGetPrefs' : 'backgroundSetPrefs';
  return aria[method](payload);
}

export function BehaviourSection(): JSX.Element {
  const [view, setView] = useState<BehaviourPrefsView>(DEFAULT_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invokeBg<BackgroundPrefsDto>(CHANNELS.BG_GET_PREFS);
      if (cancelled) return;
      if (isPrefsDto(res)) {
        setView({
          autoLaunch: res.autoLaunch,
          closeToTray: res.closeToTray,
          notificationsEnabled: res.notificationsEnabled,
        });
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-clear the error row after 4s.
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const update = useCallback(
    async (key: keyof BehaviourPrefsView, next: boolean) => {
      const prev = view[key];
      // Optimistic update.
      setView((v) => ({ ...v, [key]: next }));
      const patch: BackgroundPrefsPatchDto = { [key]: next };
      const res = await invokeBg<BackgroundPrefsDto>(CHANNELS.BG_SET_PREFS, patch);
      if (isPrefsDto(res)) {
        setView({
          autoLaunch: res.autoLaunch,
          closeToTray: res.closeToTray,
          notificationsEnabled: res.notificationsEnabled,
        });
        return;
      }
      // Revert + surface error.
      setView((v) => ({ ...v, [key]: prev }));
      setError('Update failed');
    },
    [view],
  );

  return (
    <div data-testid="settings-behaviour" style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>SETTINGS · BEHAVIOUR</div>
        <h2 style={titleStyle}>Background activity</h2>
        <p style={descStyle}>
          Aria runs as a chief-of-staff layer over your day. These settings
          control whether it keeps working when the window is closed and
          whether it launches automatically with your computer.
        </p>

        {error && (
          <div role="alert" data-testid="behaviour-error" style={alertStyle}>
            UPDATE FAILED
          </div>
        )}

        <div style={rowsStyle}>
          <ToggleRow
            testid="behaviour-autoLaunch"
            label="Run Aria in the background on login"
            helper="Aria starts automatically when you sign in and stays in the system tray, ready to deliver your daily briefing."
            checked={view.autoLaunch}
            disabled={!loaded}
            onChange={(v) => void update('autoLaunch', v)}
          />
          <ToggleRow
            testid="behaviour-closeToTray"
            label="Keep Aria running when I close the window"
            helper="Clicking the close button hides the window to the tray. Aria continues syncing and preparing tomorrow's briefing in the background."
            checked={view.closeToTray}
            disabled={!loaded}
            onChange={(v) => void update('closeToTray', v)}
          />
          <ToggleRow
            testid="behaviour-notificationsEnabled"
            label="Show a notification when the briefing is ready"
            helper="A native system notification announces the morning briefing. Click it to open Aria at the briefing screen."
            checked={view.notificationsEnabled}
            disabled={!loaded}
            onChange={(v) => void update('notificationsEnabled', v)}
          />
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  testid: string;
  label: string;
  helper: string;
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

function ToggleRow({ testid, label, helper, checked, disabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <div data-testid={testid} style={rowStyle}>
      <Checkbox
        label={<span style={labelStyle}>{label}</span>}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <p style={helperStyle}>{helper}</p>
    </div>
  );
}

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

const alertStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  padding: '8px 12px',
  marginBottom: 14,
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.18em',
  color: 'var(--gold)',
};

const rowsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const rowStyle: React.CSSProperties = {
  borderTop: '1px solid var(--rule)',
  paddingTop: 10,
  paddingBottom: 4,
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 15,
  color: 'var(--ink)',
};

const helperStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  lineHeight: 1.55,
  color: 'var(--ink-soft)',
  opacity: 0.7,
  margin: '4px 0 8px 30px',
};

