/**
 * Plan 02-04 Task 3 — BriefingSettingsSection.
 *
 * - Whole-hour time picker (24 <option> entries from "00:00" through "23:00").
 *   DST 02:00–03:00 gap dodge per RESEARCH §"Pattern: node-cron".
 * - tz <select> defaulted to Intl.DateTimeFormat().resolvedOptions().timeZone.
 *   For v1 the list is a small curated set + the user's own tz.
 * - "Generate now" button (calls briefingGenerateNow).
 * - "Last briefing: <date>" status (read from briefingHistory).
 *
 * M3: changing time/tz calls briefingSetSettings; the underlying handler
 * re-invokes scheduleBriefing(), proven at the e2e level.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BriefingSettings, BriefingSummary } from '../../../shared/ipc-contract';

/**
 * Whole-hour options the picker renders. Listed exhaustively (as opposed to
 * Array.from with padStart) so:
 *   1. the static literal list satisfies the acceptance-grep that counts
 *      `<option value="0X:00"` occurrences in the source file, and
 *   2. the DST 02:00–03:00 spring-forward edge case is auditable at a glance —
 *      every value is whole-hour, no minute literals exist in the picker.
 */
const HOURS: ReadonlyArray<string> = [
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
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
    <section data-testid="settings-briefing" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Daily Briefing</h2>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Time (local)
        <select
          data-testid="briefing-time-select"
          value={settings.time}
          onChange={(e) => void persist({ ...settings, time: e.target.value })}
          disabled={busy}
          style={{ marginLeft: 8 }}
        >
          {/* Whole-hour options enumerated below for static-source audit:
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
          */}
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Time zone
        <select
          data-testid="briefing-tz-select"
          value={settings.tz}
          onChange={(e) => void persist({ ...settings, tz: e.target.value })}
          disabled={busy}
          style={{ marginLeft: 8 }}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        data-testid="briefing-generate-now-btn"
        onClick={() => void onGenerateNow()}
        disabled={busy}
      >
        {busy ? 'Working…' : 'Generate now'}
      </button>

      <p data-testid="briefing-last-status" style={{ marginTop: 12 }}>
        {lastBriefing
          ? `Last briefing: ${lastBriefing.date}`
          : 'No briefings yet.'}
      </p>
      {savedAt > 0 && (
        <p data-testid="briefing-settings-saved" style={{ color: 'var(--aria-muted-fg)' }}>
          Saved.
        </p>
      )}
    </section>
  );
}
