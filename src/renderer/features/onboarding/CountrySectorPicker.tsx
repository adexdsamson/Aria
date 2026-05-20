/**
 * Plan 02-03 Task 2 — CountrySectorPicker onboarding step.
 *
 * Renders after MnemonicConfirm during fresh-install onboarding. The user
 * picks a home country (NG default; other countries show a "more coming
 * soon" hint and seed zero bundle rows) and 1–4 sectors of interest.
 *
 * Post-UAT correction: The DB is not opened until after `onboardingSeal`
 * runs in the password step. Calling `newsSetBundle` from inside this
 * picker therefore fails with `{ ok: false }` because `dbHolder.db` is
 * still null. The picker is now a pure "collect + report up" step — it
 * reports the selection via `onSelected` and the wizard buffers it,
 * persisting via `newsSetBundle` AFTER the seal succeeds.
 */
import { useState } from 'react';
import { AppLogo, Button } from '../../components/editorial';

export const COUNTRIES: ReadonlyArray<{ code: string; label: string; hasBundle: boolean }> = [
  { code: 'NG', label: 'Nigeria', hasBundle: true },
  { code: 'US', label: 'United States', hasBundle: false },
  { code: 'UK', label: 'United Kingdom', hasBundle: false },
  { code: 'KE', label: 'Kenya', hasBundle: false },
  { code: 'ZA', label: 'South Africa', hasBundle: false },
];

export const SECTORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gov', label: 'Government & policy' },
  { id: 'finance', label: 'Finance & markets' },
  { id: 'tech', label: 'Technology' },
  { id: 'energy', label: 'Energy' },
];

export const MORE_COUNTRIES_HINT = 'More countries coming soon — selecting now seeds zero feeds.';

export interface CountrySectorPickerProps {
  onSelected: (selection: { country: string; sectors: string[] }) => void;
}

export function CountrySectorPicker({ onSelected }: CountrySectorPickerProps): JSX.Element {
  const [country, setCountry] = useState<string>('NG');
  const [sectors, setSectors] = useState<string[]>(['gov', 'finance']);

  const selectedCountry = COUNTRIES.find((c) => c.code === country);

  function toggleSector(id: string): void {
    setSectors((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function submit(): void {
    onSelected({ country, sectors });
  }

  return (
    <section
      data-testid="onboarding-news-picker"
      style={{
        padding: 32,
        maxWidth: 560,
        margin: '0 auto',
        color: 'var(--ink)',
        fontFamily: 'var(--f-body)',
        background: 'var(--paper)',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <AppLogo variant="header" />
      </div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Step 3 of 4 · personalise your briefing
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 14,
        }}
      >
        Pick your news sources
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55 }}>
        Aria&apos;s daily briefing will surface up to three news items each morning. Tell
        Aria which country and which sectors you care about; you can change this any
        time in Settings.
      </p>

      <label
        htmlFor="news-country"
        style={{
          display: 'block',
          marginTop: 16,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          fontWeight: 500,
        }}
      >
        Country
      </label>
      <select
        id="news-country"
        data-testid="news-country-select"
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          fontSize: 14,
          marginTop: 6,
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontFamily: 'var(--f-body)',
        }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
      {selectedCountry && !selectedCountry.hasBundle && (
        <p data-testid="news-more-countries-hint" style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          {MORE_COUNTRIES_HINT}
        </p>
      )}

      <fieldset style={{ marginTop: 16, border: 0, padding: 0 }}>
        <legend
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            fontWeight: 500,
          }}
        >
          Sectors of interest
        </legend>
        {SECTORS.map((s) => (
          <label
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}
          >
            <input
              type="checkbox"
              data-testid={`news-sector-${s.id}`}
              checked={sectors.includes(s.id)}
              onChange={() => toggleSector(s.id)}
            />
            {s.label}
          </label>
        ))}
      </fieldset>

      <div style={{ marginTop: 16 }}>
        <Button variant="primary" data-testid="news-picker-submit" onClick={submit}>
          Continue
        </Button>
      </div>
    </section>
  );
}
