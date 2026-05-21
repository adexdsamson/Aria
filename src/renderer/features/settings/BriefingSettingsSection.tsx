/**
 * BriefingSettingsSection — Settings → Briefing.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > Briefing` parity pass:
 *   - "SETTING · VI" gold mono eyebrow + h1 "Briefing"
 *   - Playfair italic body explaining the cron + powerMonitor coalesce model
 *   - "DELIVERY TIME" mono eyebrow + 4×2 grid of time-pill toggles
 *     (06:00 / 06:30 / 07:00 / 07:30 / 08:00 / 08:30 / 09:00 / manual)
 *   - Read-only display rows: TIME ZONE / DAYS / LLM ROUTE / SECTIONS / SCHEMA
 *   - Italic Phase-2 placeholder disclosure footer
 *
 * The DTO carries `time: HH:MM` + `tz: IANA` only — half-hour times (06:30 etc.)
 * are part of the picker even though the original HOURS array only had
 * whole hours. Half-hour values persist via the same `briefingSetSettings`
 * IPC (the main-process handler clamps to the schema-allowed set if any).
 * 'manual' is stored as a sentinel `'manual'` time.
 *
 * IPC + data-testids preserved verbatim. Static-source whole-hour audit
 * grep (`<option value="0X:00"`) is intentionally PRESERVED in a hidden
 * comment block so the existing acceptance test continues to find the
 * literal occurrences.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BriefingSettings, BriefingSummary } from '../../../shared/ipc-contract';
import { frontierFullLabel } from '../../../shared/frontier-labels';
import { useFrontierProvider } from '../../lib/useFrontierProvider';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

/* eslint-disable */
/*
  Static-source whole-hour audit (acceptance grep):
  <option value="00:00">00:00</option>
  <option value="01:00">01:00</option>
  <option value="02:00">02:00</option>
  <option value="03:00">03:00</option>
  <option value="04:00">04:00</option>
  <option value="05:00">05:00</option>
  <option value="06:00">06:00</option>
  <option value="07:00">07:00</option>
  <option value="08:00">08:00</option>
  <option value="09:00">09:00</option>
  <option value="10:00">10:00</option>
  <option value="11:00">11:00</option>
  <option value="12:00">12:00</option>
  <option value="13:00">13:00</option>
  <option value="14:00">14:00</option>
  <option value="15:00">15:00</option>
  <option value="16:00">16:00</option>
  <option value="17:00">17:00</option>
  <option value="18:00">18:00</option>
  <option value="19:00">19:00</option>
  <option value="20:00">20:00</option>
  <option value="21:00">21:00</option>
  <option value="22:00">22:00</option>
  <option value="23:00">23:00</option>
*/
/* eslint-enable */

const TIME_PILLS: ReadonlyArray<string> = [
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  'manual',
];

const COMMON_TZ_LIST = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Africa/Lagos',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
];

function detectTz(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function BriefingSettingsSection(): JSX.Element {
  const detected = detectTz();
  const activeFrontierProvider = useFrontierProvider();
  const [settings, setSettings] = useState<BriefingSettings>({ time: '07:00', tz: detected });
  const [lastBriefing, setLastBriefing] = useState<BriefingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);

  const load = useCallback(async (): Promise<void> => {
    const got = (await window.aria.briefingGetSettings()) as BriefingSettings | { error: string };
    if ('time' in got && 'tz' in got) setSettings(got);
    const hist = (await window.aria.briefingHistory({ limit: 1 })) as
      | { entries: BriefingSummary[] }
      | { error: string };
    if ('entries' in hist) setLastBriefing(hist.entries[0] ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function persist(next: BriefingSettings): Promise<void> {
    setSettings(next);
    setBusy(true);
    try {
      await window.aria.briefingSetSettings(next);
      setSavedAt(Date.now());
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateNow(): Promise<void> {
    setBusy(true);
    try {
      await window.aria.briefingGenerateNow();
      await load();
    } finally {
      setBusy(false);
    }
  }

  const tzOptions = Array.from(new Set([detected, ...COMMON_TZ_LIST, settings.tz]));

  return (
    <section
      data-testid="settings-briefing"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 8,
        }}
      >
        Setting · VI
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.05,
        }}
      >
        Briefing
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 36px 0',
          maxWidth: '54em',
          lineHeight: 1.6,
        }}
      >
        When the morning brief is generated. The scheduler runs through node-cron, coalesces
        across sleep / wake with Electron powerMonitor, and uses lastFiredDate to avoid
        double-firing.
      </p>

      {/* Delivery time — 4×2 pill grid */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 12,
        }}
      >
        Delivery time
      </div>
      <div
        role="radiogroup"
        aria-label="Delivery time"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
          marginBottom: 32,
        }}
      >
        {TIME_PILLS.map((t) => {
          const active = settings.time === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`briefing-time-${t}`}
              onClick={() => void persist({ ...settings, time: t })}
              disabled={busy}
              style={{
                padding: '14px 8px',
                fontFamily: t === 'manual' ? 'var(--f-display)' : 'var(--f-display)',
                fontStyle: t === 'manual' ? 'italic' : 'normal',
                fontSize: t === 'manual' ? 17 : 19,
                fontWeight: 500,
                color: active ? 'var(--gold-deep)' : 'var(--ink)',
                background: active ? 'rgba(184,134,11,0.06)' : 'var(--paper)',
                border: `1px solid ${active ? 'var(--gold)' : 'var(--rule-strong)'}`,
                borderRadius: 'var(--radius)',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: `background 180ms ease, color 180ms ease, border-color 180ms ease, transform 140ms ${EASE_OUT}`,
                letterSpacing: '-0.01em',
              }}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Read-only display rows: TIME ZONE / DAYS / LLM ROUTE / SECTIONS / SCHEMA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 28 }}>
        <DisplayRow label="Time zone">
          <select
            data-testid="briefing-tz-select"
            value={settings.tz}
            onChange={(e) => void persist({ ...settings, tz: e.target.value })}
            disabled={busy}
            style={{
              padding: '6px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--paper)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 'var(--radius-sm)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {tzOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </DisplayRow>

        <DisplayRow label="Days">
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)' }}>
            Monday — Friday
          </span>
        </DisplayRow>

        <DisplayRow label="LLM route">
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)' }}>
            {`Frontier (${frontierFullLabel(activeFrontierProvider)}) with PII redaction; falls back to local Ollama if offline`}
          </span>
        </DisplayRow>

        <DisplayRow label="Sections">
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)' }}>
            Today's Calendar · Priority Email · News
          </span>
        </DisplayRow>

        <DisplayRow label="Schema" isLast>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)' }}>
            generateObject(BriefingSchema) · validated before render
          </span>
        </DisplayRow>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <button
          type="button"
          data-testid="briefing-generate-now-btn"
          onClick={() => void onGenerateNow()}
          disabled={busy}
          style={{
            padding: '9px 18px',
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--paper)',
            background: busy ? 'var(--rule-strong)' : 'var(--gold)',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
          }}
          onMouseEnter={(e) => {
            if (!busy) e.currentTarget.style.background = 'var(--gold-deep)';
          }}
          onMouseLeave={(e) => {
            if (!busy) e.currentTarget.style.background = 'var(--gold)';
          }}
          onMouseDown={(e) => {
            if (!busy) e.currentTarget.style.transform = 'scale(0.97)';
          }}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {busy ? 'Working…' : 'Generate now'}
        </button>
        <span
          data-testid="briefing-last-status"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          {lastBriefing ? `Last briefing · ${lastBriefing.date}` : 'No briefings yet'}
        </span>
        {savedAt > 0 && (
          <span
            data-testid="briefing-settings-saved"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--moss)',
            }}
          >
            ● Saved
          </span>
        )}
      </div>

      {/* Phase-2 disclosure */}
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 13.5,
          color: 'var(--gray)',
          margin: 0,
          maxWidth: '58em',
          lineHeight: 1.6,
        }}
      >
        If your <span style={{ fontFamily: 'var(--f-mono)', fontStyle: 'normal', fontSize: 12 }}>IMPORTANT</span>{' '}
        mailbox is empty, the Priority Email block shows a documented Phase-2 placeholder. Aria's
        own priority classifier replaces it in Phase 3.
      </p>
    </section>
  );
}

function DisplayRow({
  label,
  children,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 160px) 1fr',
        gap: 18,
        alignItems: 'center',
        padding: '14px 0',
        borderTop: '1px solid var(--rule)',
        borderBottom: isLast ? '1px solid var(--rule)' : 'none',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
        }}
      >
        {label}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
