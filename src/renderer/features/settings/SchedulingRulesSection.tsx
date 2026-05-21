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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// ── Shared dialog styles ───────────────────────────────────────────────────

const DIALOG_BACKDROP: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const DIALOG_PANEL: React.CSSProperties = {
  width: 420, maxWidth: '92vw',
  background: 'var(--paper)', borderRadius: 'var(--radius)',
  padding: '28px 28px 24px',
  boxShadow: '0 8px 48px rgba(0,0,0,0.2)',
  fontFamily: 'var(--f-body)', color: 'var(--ink)',
};

const FIELD_LABEL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
};

const FIELD_CAPTION: React.CSSProperties = {
  fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--gray)',
};

const FIELD_INPUT: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--rule)',
  borderRadius: 'var(--radius)', background: 'var(--paper)',
  fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)',
  outline: 'none', width: '100%', boxSizing: 'border-box' as const,
};

const FIELD_SELECT: React.CSSProperties = { ...FIELD_INPUT, cursor: 'pointer' };

function DialogActions({ onCancel, onConfirm, confirmLabel = 'Add', disabled = false }: {
  onCancel(): void; onConfirm(): void; confirmLabel?: string; disabled?: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
      <button
        type="button" onClick={onCancel}
        style={{ padding: '8px 18px', border: '1px solid var(--rule)', borderRadius: 'var(--radius)', background: 'var(--paper)', fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink-soft, #6b6455)', cursor: 'pointer' }}
      >
        Cancel
      </button>
      <button
        type="button" onClick={onConfirm} disabled={disabled}
        style={{ padding: '8px 20px', border: 'none', borderRadius: 'var(--radius)', background: disabled ? 'var(--rule)' : 'var(--gold)', color: '#fff', fontFamily: 'var(--f-body)', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

// ── Focus block dialog ─────────────────────────────────────────────────────

interface FocusBlockDialogProps {
  onAdd(block: { day: Day; start: string; end: string }): void;
  onClose(): void;
}

function FocusBlockDialog({ onAdd, onClose }: FocusBlockDialogProps): JSX.Element {
  const [day, setDay] = useState<Day>('all');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:00');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { ref.current?.querySelector('select')?.focus(); }, []);

  return (
    <div role="dialog" aria-modal="true" style={DIALOG_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} style={DIALOG_PANEL}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>Focus block</div>
        <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 400, margin: '0 0 16px' }}>Add focus block</h3>
        <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft, #6b6455)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Protected time — anything that lands here gets declined with a polite alt.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={FIELD_LABEL}>
            <span style={FIELD_CAPTION}>Day</span>
            <select style={FIELD_SELECT} value={day} onChange={e => setDay(e.target.value as Day)} aria-label="focus-block-day-dialog">
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>Start</span>
              <input type="time" style={FIELD_INPUT} value={start} onChange={e => setStart(e.target.value)} aria-label="focus-block-start-dialog" />
            </label>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>End</span>
              <input type="time" style={FIELD_INPUT} value={end} onChange={e => setEnd(e.target.value)} aria-label="focus-block-end-dialog" />
            </label>
          </div>
        </div>
        <DialogActions onCancel={onClose} onConfirm={() => { onAdd({ day, start, end }); onClose(); }} confirmLabel="Add focus block" disabled={!start || !end || start >= end} />
      </div>
    </div>
  );
}

// ── No-meeting window dialog ───────────────────────────────────────────────

interface NoMeetingDialogProps {
  onAdd(w: { day: Day; start: string; end: string; label: string }): void;
  onClose(): void;
}

function NoMeetingDialog({ onAdd, onClose }: NoMeetingDialogProps): JSX.Element {
  const [day, setDay] = useState<Day>('all');
  const [start, setStart] = useState('12:00');
  const [end, setEnd] = useState('13:00');
  const [label, setLabel] = useState('Lunch');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { ref.current?.querySelector('input')?.focus(); }, []);

  return (
    <div role="dialog" aria-modal="true" style={DIALOG_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} style={DIALOG_PANEL}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>No-meeting window</div>
        <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 400, margin: '0 0 16px' }}>Add no-meeting window</h3>
        <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft, #6b6455)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Hard boundary — Aria refuses to schedule anything here.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={FIELD_LABEL}>
            <span style={FIELD_CAPTION}>Label</span>
            <input style={FIELD_INPUT} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Lunch" aria-label="no-meeting-label-dialog" />
          </label>
          <label style={FIELD_LABEL}>
            <span style={FIELD_CAPTION}>Day</span>
            <select style={FIELD_SELECT} value={day} onChange={e => setDay(e.target.value as Day)} aria-label="no-meeting-day-dialog">
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>Start</span>
              <input type="time" style={FIELD_INPUT} value={start} onChange={e => setStart(e.target.value)} aria-label="no-meeting-start-dialog" />
            </label>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>End</span>
              <input type="time" style={FIELD_INPUT} value={end} onChange={e => setEnd(e.target.value)} aria-label="no-meeting-end-dialog" />
            </label>
          </div>
        </div>
        <DialogActions onCancel={onClose} onConfirm={() => { onAdd({ day, start, end, label }); onClose(); }} confirmLabel="Add window" disabled={!start || !end || !label.trim() || start >= end} />
      </div>
    </div>
  );
}

// ── Prime-time dialog ──────────────────────────────────────────────────────

interface PrimeTimeDialogProps {
  onAdd(w: { day: Day; start: string; end: string }): void;
  onClose(): void;
}

function PrimeTimeDialog({ onAdd, onClose }: PrimeTimeDialogProps): JSX.Element {
  const [day, setDay] = useState<Day>('all');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('12:00');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { ref.current?.querySelector('select')?.focus(); }, []);

  return (
    <div role="dialog" aria-modal="true" style={DIALOG_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} style={DIALOG_PANEL}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>Prime time</div>
        <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 400, margin: '0 0 16px' }}>Add prime-time window</h3>
        <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft, #6b6455)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Aria prefers to schedule meetings inside these windows.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={FIELD_LABEL}>
            <span style={FIELD_CAPTION}>Day</span>
            <select style={FIELD_SELECT} value={day} onChange={e => setDay(e.target.value as Day)} aria-label="prime-time-day-dialog">
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>Start</span>
              <input type="time" style={FIELD_INPUT} value={start} onChange={e => setStart(e.target.value)} aria-label="prime-time-start-dialog" />
            </label>
            <label style={{ ...FIELD_LABEL, flex: 1 }}>
              <span style={FIELD_CAPTION}>End</span>
              <input type="time" style={FIELD_INPUT} value={end} onChange={e => setEnd(e.target.value)} aria-label="prime-time-end-dialog" />
            </label>
          </div>
        </div>
        <DialogActions onCancel={onClose} onConfirm={() => { onAdd({ day, start, end }); onClose(); }} confirmLabel="Add window" disabled={!start || !end || start >= end} />
      </div>
    </div>
  );
}

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
  const [serverIssues, setServerIssues] = useState<string | null>(null);

  // Dialog state
  const [focusDialog, setFocusDialog] = useState(false);
  const [noMeetingDialog, setNoMeetingDialog] = useState(false);
  const [primeTimeDialog, setPrimeTimeDialog] = useState(false);

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
          setServerIssues(JSON.stringify(res.issues));
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

  function addFocusBlock(block: { day: Day; start: string; end: string }): void {
    setRules(r => ({ ...r, focusBlocks: [...r.focusBlocks, block] }));
  }

  function removeFocusBlock(idx: number): void {
    setRules(r => ({ ...r, focusBlocks: r.focusBlocks.filter((_, i) => i !== idx) }));
  }

  function addNoMeetingWindow(w: { day: Day; start: string; end: string; label: string }): void {
    setRules(r => ({ ...r, noMeetingWindows: [...r.noMeetingWindows, w] }));
  }

  function removeNoMeetingWindow(idx: number): void {
    setRules(r => ({ ...r, noMeetingWindows: r.noMeetingWindows.filter((_, i) => i !== idx) }));
  }

  function addPrimeTimeWindow(w: { day: Day; start: string; end: string }): void {
    setRules(r => ({ ...r, primeTimeWindows: [...r.primeTimeWindows, w] }));
  }

  function removePrimeTimeWindow(idx: number): void {
    setRules(r => ({ ...r, primeTimeWindows: r.primeTimeWindows.filter((_, i) => i !== idx) }));
  }

  const tzOptions = Array.from(
    new Set([detected, ...COMMON_TZ_LIST, rules.timeZone]),
  );

  return (
    <section
      data-testid="settings-scheduling"
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
        Setting · VII
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
        Rules of engagement
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 36px 0',
          maxWidth: '52em',
          lineHeight: 1.6,
        }}
      >
        Your meeting boundaries. Aria enforces these when drafting calendar changes.
      </p>

      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 19,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: '0 0 6px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: 50, background: 'var(--gold)' }}
        />
        Focus blocks
      </h3>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--gray)',
          margin: '0 0 14px 0',
        }}
      >
        Protected. Anything that lands here gets declined with a polite alt.
      </p>
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
        onClick={() => setFocusDialog(true)}
        style={schedulingGhostBtn()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--gold-light)';
          e.currentTarget.style.color = 'var(--gold-deep)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--rule-strong)';
          e.currentTarget.style.color = 'var(--ink-soft)';
        }}
      >
        + Add focus block
      </button>

      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 19,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: '32px 0 14px 0',
        }}
      >
        Buffers (minutes)
      </h3>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={schedulingFieldLabel()}>
          <span style={schedulingFieldLabelSpan()}>Before</span>
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
            style={schedulingNumberInput()}
          />
        </label>
        <label style={schedulingFieldLabel()}>
          <span style={schedulingFieldLabelSpan()}>After</span>
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
            style={schedulingNumberInput()}
          />
        </label>
      </div>

      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 19,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: '32px 0 6px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: 50, background: 'var(--rose)' }}
        />
        No-meeting windows
      </h3>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--gray)',
          margin: '0 0 14px 0',
        }}
      >
        Hard boundary — Aria refuses to schedule here.
      </p>
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
        onClick={() => setNoMeetingDialog(true)}
        style={schedulingGhostBtn()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--gold-light)';
          e.currentTarget.style.color = 'var(--gold-deep)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--rule-strong)';
          e.currentTarget.style.color = 'var(--ink-soft)';
        }}
      >
        + Add no-meeting window
      </button>

      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 19,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: '32px 0 6px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: 50, background: 'var(--moss)' }}
        />
        Prime time
      </h3>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--gray)',
          margin: '0 0 14px 0',
        }}
      >
        Aria prefers to schedule meetings inside these windows.
      </p>
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
        onClick={() => setPrimeTimeDialog(true)}
        style={schedulingGhostBtn()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--gold-light)';
          e.currentTarget.style.color = 'var(--gold-deep)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--rule-strong)';
          e.currentTarget.style.color = 'var(--ink-soft)';
        }}
      >
        + Add prime-time window
      </button>

      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 19,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: '32px 0 6px 0',
        }}
      >
        Time zone
      </h3>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--gray)',
          margin: '0 0 14px 0',
        }}
      >
        All scheduling math runs in UTC; display always uses this zone.
      </p>
      <label style={schedulingFieldLabel()}>
        <span style={schedulingFieldLabelSpan()}>IANA zone</span>
        <select
          aria-label="rules-tz-select"
          data-testid="rules-tz-select"
          value={rules.timeZone}
          onChange={(e) => setRules({ ...rules, timeZone: e.target.value })}
          style={schedulingSelect()}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <p
        data-testid="rules-tz-hint"
        style={{
          marginTop: 10,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--gray)',
          letterSpacing: '0.04em',
          lineHeight: 1.55,
          maxWidth: '54em',
        }}
      >
        Detected from your system: {detected}. The connected Google primary calendar's time-zone
        is canonical when available.
      </p>

      <details
        data-testid="advanced-json-drawer"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        style={{ marginTop: 28 }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            padding: '6px 0',
            userSelect: 'none',
          }}
        >
          Advanced JSON
        </summary>
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
            {serverIssues}
          </pre>
        )}
      </details>

      <div
        style={{
          marginTop: 28,
          paddingTop: 18,
          borderTop: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          data-testid="scheduling-save-btn"
          onClick={() => void onSave()}
          disabled={!canSave}
          style={{
            padding: '9px 22px',
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--paper)',
            background: canSave ? 'var(--gold)' : 'var(--rule-strong)',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: canSave ? 'pointer' : 'not-allowed',
            transition:
              'background 200ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
          onMouseEnter={(e) => {
            if (canSave) e.currentTarget.style.background = 'var(--gold-deep)';
          }}
          onMouseLeave={(e) => {
            if (canSave) e.currentTarget.style.background = 'var(--gold)';
          }}
          onMouseDown={(e) => {
            if (canSave) e.currentTarget.style.transform = 'scale(0.97)';
          }}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt > 0 && (
          <span
            data-testid="scheduling-saved"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--moss)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--moss)' }}
            />
            Saved
          </span>
        )}
      </div>

      {/* Dialogs */}
      {focusDialog && (
        <FocusBlockDialog
          onAdd={addFocusBlock}
          onClose={() => setFocusDialog(false)}
        />
      )}
      {noMeetingDialog && (
        <NoMeetingDialog
          onAdd={addNoMeetingWindow}
          onClose={() => setNoMeetingDialog(false)}
        />
      )}
      {primeTimeDialog && (
        <PrimeTimeDialog
          onAdd={addPrimeTimeWindow}
          onClose={() => setPrimeTimeDialog(false)}
        />
      )}
    </section>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────

function schedulingGhostBtn(): React.CSSProperties {
  return {
    marginTop: 8,
    padding: '7px 14px',
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    color: 'var(--ink-soft)',
    background: 'var(--paper)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition: 'border-color 180ms ease, color 180ms ease',
  };
}

function schedulingFieldLabel(): React.CSSProperties {
  return {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 6,
  };
}

function schedulingFieldLabelSpan(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--gray)',
  };
}

function schedulingNumberInput(): React.CSSProperties {
  return {
    width: 80,
    padding: '8px 12px',
    fontFamily: 'var(--f-mono)',
    fontSize: 14,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
  };
}

function schedulingSelect(): React.CSSProperties {
  return {
    padding: '8px 12px',
    fontFamily: 'var(--f-mono)',
    fontSize: 13,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    minWidth: 220,
  };
}
