/**
 * Plan 04-02 Task 1 — SchedulingRulesSection.
 *
 * Settings form for scheduling rules: focus blocks, buffers, no-meeting
 * windows, prime-time windows, time-zone, and an Advanced JSON drawer
 * (collapsed by default) for power-users.
 *
 * Client-side validation: every save runs RulesSchema.safeParse before
 * firing IPC; Save is disabled when:
 *   - form is not dirty, or
 *   - advanced-JSON drawer contains unparseable JSON, or
 *   - RulesSchema rejects the staged value.
 *
 * Server-side validation: even if the client says OK, the main process
 * re-runs safeParse and may return `{error: 'INVALID_RULES', issues}`.
 * Those issues render inline under the drawer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RulesSchema,
  DEFAULT_RULES,
  type Rules,
  type Day,
} from '../../../shared/scheduling-rules';
import type {
  SchedulingRulesGetResponse,
  SchedulingRulesSetResponse,
} from '../../../shared/ipc-contract';

const DAYS: Day[] = ['all', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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

export function SchedulingRulesSection(): JSX.Element {
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [original, setOriginal] = useState<Rules>(DEFAULT_RULES);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedJson, setAdvancedJson] = useState<string>(
    JSON.stringify(DEFAULT_RULES, null, 2),
  );
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [serverIssues, setServerIssues] = useState<unknown | null>(null);

  const detected = useMemo(detectTz, []);

  const load = useCallback(async () => {
    const got = (await window.aria.schedulingRulesGet()) as
      | SchedulingRulesGetResponse
      | { error: string };
    if ('error' in got) return;
    const parsed = RulesSchema.safeParse(got.rules);
    const loaded = parsed.success ? parsed.data : DEFAULT_RULES;
    setRules(loaded);
    setOriginal(loaded);
    setAdvancedJson(JSON.stringify(loaded, null, 2));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-stringify the structured editor's rules into the advanced drawer so
  // the two views stay in sync when the drawer is closed.
  useEffect(() => {
    if (!advancedOpen) setAdvancedJson(JSON.stringify(rules, null, 2));
  }, [rules, advancedOpen]);

  const dirty = JSON.stringify(rules) !== JSON.stringify(original);
  const clientValid = RulesSchema.safeParse(rules).success;
  const canSave = dirty && clientValid && !advancedError && !saving;

  async function onSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setServerIssues(null);
    try {
      const res = (await window.aria.schedulingRulesSet({ rules })) as
        | SchedulingRulesSetResponse
        | { error: string };
      if ('ok' in res && res.ok) {
        setOriginal(rules);
        setSavedAt(Date.now());
      } else if ('error' in res) {
        if (res.error === 'INVALID_RULES' && 'issues' in res) {
          setServerIssues(res.issues);
        } else {
          setServerIssues(res.error);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function onAdvancedJsonChange(value: string): void {
    setAdvancedJson(value);
    try {
      const parsed = JSON.parse(value);
      const result = RulesSchema.safeParse(parsed);
      if (!result.success) {
        setAdvancedError('Schema validation failed.');
        return;
      }
      setAdvancedError(null);
      setRules(result.data);
    } catch {
      setAdvancedError('Invalid JSON.');
    }
  }

  function addFocusBlock(): void {
    setRules({
      ...rules,
      focusBlocks: [
        ...rules.focusBlocks,
        { day: 'all', start: '09:00', end: '11:00' },
      ],
    });
  }

  function removeFocusBlock(idx: number): void {
    setRules({
      ...rules,
      focusBlocks: rules.focusBlocks.filter((_, i) => i !== idx),
    });
  }

  function addNoMeetingWindow(): void {
    setRules({
      ...rules,
      noMeetingWindows: [
        ...rules.noMeetingWindows,
        { day: 'all', start: '12:00', end: '13:00', label: 'Lunch' },
      ],
    });
  }

  function removeNoMeetingWindow(idx: number): void {
    setRules({
      ...rules,
      noMeetingWindows: rules.noMeetingWindows.filter((_, i) => i !== idx),
    });
  }

  function addPrimeTimeWindow(): void {
    setRules({
      ...rules,
      primeTimeWindows: [
        ...rules.primeTimeWindows,
        { day: 'all', start: '10:00', end: '12:00' },
      ],
    });
  }

  function removePrimeTimeWindow(idx: number): void {
    setRules({
      ...rules,
      primeTimeWindows: rules.primeTimeWindows.filter((_, i) => i !== idx),
    });
  }

  const tzOptions = Array.from(
    new Set([detected, ...COMMON_TZ_LIST, rules.timeZone]),
  );

  return (
    <section
      data-testid="settings-scheduling"
      style={{ padding: 'var(--aria-space-lg)' }}
    >
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12 }}>
        Scheduling Rules
      </h2>

      <h3>Focus Blocks</h3>
      <ul data-testid="focus-blocks-list">
        {rules.focusBlocks.map((b, i) => (
          <li key={i} data-testid={`focus-block-${i}`}>
            <select
              aria-label="focus-block-day"
              value={b.day}
              onChange={(e) => {
                const next = [...rules.focusBlocks];
                next[i] = { ...b, day: e.target.value as Day };
                setRules({ ...rules, focusBlocks: next });
              }}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              aria-label="focus-block-start"
              value={b.start}
              onChange={(e) => {
                const next = [...rules.focusBlocks];
                next[i] = { ...b, start: e.target.value };
                setRules({ ...rules, focusBlocks: next });
              }}
            />
            <input
              aria-label="focus-block-end"
              value={b.end}
              onChange={(e) => {
                const next = [...rules.focusBlocks];
                next[i] = { ...b, end: e.target.value };
                setRules({ ...rules, focusBlocks: next });
              }}
            />
            <button
              type="button"
              onClick={() => removeFocusBlock(i)}
              data-testid={`focus-block-remove-${i}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="add-focus-block-btn"
        onClick={addFocusBlock}
      >
        Add focus block
      </button>

      <h3>Buffers (minutes)</h3>
      <label>
        Before
        <input
          aria-label="buffer-before"
          type="number"
          min={0}
          max={120}
          value={rules.buffers.beforeMin}
          onChange={(e) =>
            setRules({
              ...rules,
              buffers: { ...rules.buffers, beforeMin: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        After
        <input
          aria-label="buffer-after"
          type="number"
          min={0}
          max={120}
          value={rules.buffers.afterMin}
          onChange={(e) =>
            setRules({
              ...rules,
              buffers: { ...rules.buffers, afterMin: Number(e.target.value) },
            })
          }
        />
      </label>

      <h3>No-Meeting Windows</h3>
      <ul data-testid="no-meeting-list">
        {rules.noMeetingWindows.map((w, i) => (
          <li key={i}>
            <input
              aria-label="no-meeting-label"
              value={w.label}
              onChange={(e) => {
                const next = [...rules.noMeetingWindows];
                next[i] = { ...w, label: e.target.value };
                setRules({ ...rules, noMeetingWindows: next });
              }}
            />
            <select
              aria-label="no-meeting-day"
              value={w.day}
              onChange={(e) => {
                const next = [...rules.noMeetingWindows];
                next[i] = { ...w, day: e.target.value as Day };
                setRules({ ...rules, noMeetingWindows: next });
              }}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              aria-label="no-meeting-start"
              value={w.start}
              onChange={(e) => {
                const next = [...rules.noMeetingWindows];
                next[i] = { ...w, start: e.target.value };
                setRules({ ...rules, noMeetingWindows: next });
              }}
            />
            <input
              aria-label="no-meeting-end"
              value={w.end}
              onChange={(e) => {
                const next = [...rules.noMeetingWindows];
                next[i] = { ...w, end: e.target.value };
                setRules({ ...rules, noMeetingWindows: next });
              }}
            />
            <button type="button" onClick={() => removeNoMeetingWindow(i)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="add-no-meeting-btn"
        onClick={addNoMeetingWindow}
      >
        Add no-meeting window
      </button>

      <h3>Prime-Time Windows</h3>
      <ul data-testid="prime-time-list">
        {rules.primeTimeWindows.map((w, i) => (
          <li key={i}>
            <select
              aria-label="prime-time-day"
              value={w.day}
              onChange={(e) => {
                const next = [...rules.primeTimeWindows];
                next[i] = { ...w, day: e.target.value as Day };
                setRules({ ...rules, primeTimeWindows: next });
              }}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              aria-label="prime-time-start"
              value={w.start}
              onChange={(e) => {
                const next = [...rules.primeTimeWindows];
                next[i] = { ...w, start: e.target.value };
                setRules({ ...rules, primeTimeWindows: next });
              }}
            />
            <input
              aria-label="prime-time-end"
              value={w.end}
              onChange={(e) => {
                const next = [...rules.primeTimeWindows];
                next[i] = { ...w, end: e.target.value };
                setRules({ ...rules, primeTimeWindows: next });
              }}
            />
            <button type="button" onClick={() => removePrimeTimeWindow(i)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="add-prime-time-btn"
        onClick={addPrimeTimeWindow}
      >
        Add prime-time window
      </button>

      <h3>Time Zone</h3>
      <label>
        IANA zone
        <select
          aria-label="rules-tz-select"
          data-testid="rules-tz-select"
          value={rules.timeZone}
          onChange={(e) => setRules({ ...rules, timeZone: e.target.value })}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <p data-testid="rules-tz-hint" style={{ color: 'var(--aria-muted-fg)' }}>
        Detected from your system: {detected}. The connected Google primary
        calendar's time-zone is canonical when available.
      </p>

      <details
        data-testid="advanced-json-drawer"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Advanced JSON</summary>
        <textarea
          data-testid="advanced-json-textarea"
          aria-label="advanced-json"
          rows={12}
          cols={64}
          value={advancedJson}
          onChange={(e) => onAdvancedJsonChange(e.target.value)}
        />
        {advancedError && (
          <p data-testid="advanced-json-error" style={{ color: 'red' }}>
            {advancedError}
          </p>
        )}
        {serverIssues && (
          <pre data-testid="server-issues" style={{ color: 'red' }}>
            {typeof serverIssues === 'string'
              ? serverIssues
              : JSON.stringify(serverIssues, null, 2)}
          </pre>
        )}
      </details>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          data-testid="scheduling-save-btn"
          onClick={() => void onSave()}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt > 0 && (
          <span
            data-testid="scheduling-saved"
            style={{ marginLeft: 8, color: 'var(--aria-muted-fg)' }}
          >
            Saved.
          </span>
        )}
      </div>
    </section>
  );
}
