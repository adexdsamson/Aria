/**
 * Phase 11 Plan 02 — NewResearchJobModal.
 * Centered dialog with gold top accent. Segmented schedule picker.
 * Start Research disabled when both Brave and Exa keys absent (RES-08 / D-01).
 */
import { useEffect, useRef, useState } from 'react';
import type { ResearchJobDto } from '../../../shared/ipc-contract';

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface NewResearchJobModalProps {
  onClose: () => void;
  onCreated: (job: ResearchJobDto) => void;
}

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const SCHEDULE_OPTIONS: { value: 'none' | 'daily' | 'weekly'; label: string; sub: string }[] = [
  { value: 'none',   label: 'Once',   sub: 'Run once'    },
  { value: 'daily',  label: 'Daily',  sub: 'Every day'   },
  { value: 'weekly', label: 'Weekly', sub: 'Every week'  },
];

export function NewResearchJobModal({ onClose, onCreated }: NewResearchJobModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [domainsRaw, setDomainsRaw] = useState('');
  const [scheduleInterval, setScheduleInterval] = useState<'none' | 'daily' | 'weekly'>('none');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKeys, setHasKeys] = useState<boolean | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    void window.aria.researchSecretsHas({}).then((r) => {
      if (!isErr(r)) setHasKeys(r.hasBrave || r.hasExa);
    });
    function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(): Promise<void> {
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const domains = domainsRaw.split(',').map((d) => d.trim()).filter(Boolean);
      const res = await window.aria.researchJobCreate({ title: title.trim(), goals, domains, scheduleInterval });
      if (isErr(res)) { setError(res.error); return; }
      onCreated(res.job);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const startDisabled = !title.trim() || pending || hasKeys === false;
  const startTitle = hasKeys === false
    ? 'Add a Brave or Exa API key in Settings → Integrations'
    : undefined;

  return (
    <>
      <style>{`
        @keyframes nrj-backdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes nrj-panelIn {
          from { opacity: 0; transform: translateY(18px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
        .nrj-field-input {
          display: block;
          width: 100%;
          box-sizing: border-box;
          font-family: var(--f-sans, system-ui, sans-serif);
          font-size: 14px;
          border: 1px solid var(--rule);
          border-radius: 5px;
          padding: 10px 13px;
          background: var(--bg, #fff);
          color: var(--ink);
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
          resize: vertical;
        }
        .nrj-field-input::placeholder { color: var(--ink-soft, #a09880); }
        .nrj-field-input:focus {
          border-color: var(--gold);
          box-shadow: 0 0 0 2px rgba(184,134,11,0.12);
        }
        .nrj-seg-btn { transition: all 140ms ease; }
        .nrj-cancel-btn { transition: opacity 140ms ease; }
        .nrj-cancel-btn:hover { opacity: 0.75; }
        .nrj-submit-btn { transition: all 160ms ease; }
        .nrj-submit-btn:not(:disabled):hover { filter: brightness(1.07); }
      `}</style>

      {/* Backdrop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New research job"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(20,18,14,0.5)',
          backdropFilter: 'blur(2px)',
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          animation: `nrj-backdropIn 180ms ease both`,
        }}
      >
        {/* Panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 520,
            maxWidth: '100%',
            background: 'var(--paper, #faf8f4)',
            borderRadius: 8,
            boxShadow: '0 32px 80px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            animation: `nrj-panelIn 240ms ${EASE} both`,
          }}
        >
          {/* Gold accent bar */}
          <div style={{ height: 3, background: 'var(--gold)' }} />

          <div style={{ padding: '28px 32px 32px' }}>

            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <div style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
                marginBottom: 7,
              }}>
                New Research Job
              </div>
              <h2 style={{
                fontFamily: 'var(--f-serif, Georgia)',
                fontSize: 24,
                fontWeight: 400,
                margin: 0,
                color: 'var(--ink)',
                lineHeight: 1.2,
              }}>
                Start a research job
              </h2>
            </div>

            {/* No-keys warning */}
            {hasKeys === false && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                background: 'rgba(184,134,11,0.08)',
                border: '1px solid rgba(184,134,11,0.25)',
                borderRadius: 5,
                padding: '10px 14px',
                marginBottom: 20,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="var(--gold)"/>
                </svg>
                <span style={{ fontFamily: 'var(--f-sans, sans-serif)', fontSize: 12, color: 'var(--ink-soft, #6b6455)', lineHeight: 1.5 }}>
                  Add a Brave Search or Exa API key in{' '}
                  <strong style={{ color: 'var(--gold)', fontWeight: 600 }}>Settings → Integrations</strong>
                  {' '}to run research.
                </span>
              </div>
            )}

            {/* Title */}
            <FieldLabel text="Title" required />
            <input
              ref={titleRef}
              type="text"
              className="nrj-field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void submit(); }}
              placeholder="What are you researching?"
              data-testid="research-title-input"
              style={{ marginBottom: 18 }}
            />

            {/* Goals */}
            <FieldLabel text="Goals" />
            <textarea
              className="nrj-field-input"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="What do you want to learn? What decision does this inform?"
              rows={3}
              data-testid="research-goals-input"
              style={{ marginBottom: 18 }}
            />

            {/* Domains */}
            <FieldLabel text="Focus domains" sub="comma-separated, optional" />
            <input
              type="text"
              className="nrj-field-input"
              value={domainsRaw}
              onChange={(e) => setDomainsRaw(e.target.value)}
              placeholder="e.g. techcrunch.com, reuters.com"
              data-testid="research-domains-input"
              style={{ marginBottom: 20 }}
            />

            {/* Schedule — segmented buttons */}
            <FieldLabel text="Schedule" />
            <div style={{
              display: 'flex',
              gap: 6,
              marginBottom: 26,
            }}>
              {SCHEDULE_OPTIONS.map(({ value, label, sub }) => {
                const active = scheduleInterval === value;
                return (
                  <button
                    key={value}
                    className="nrj-seg-btn"
                    onClick={() => setScheduleInterval(value)}
                    style={{
                      flex: 1,
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      background: active ? 'var(--gold)' : 'var(--bg, #fff)',
                      color: active ? 'var(--bg, #fff)' : 'var(--ink-soft, #6b6455)',
                      border: `1px solid ${active ? 'var(--gold)' : 'var(--rule)'}`,
                      borderRadius: 5,
                      padding: '8px 6px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
                    <span style={{ fontSize: 9, opacity: active ? 0.85 : 0.7 }}>{sub}</span>
                  </button>
                );
              })}
            </div>

            {/* Error */}
            {error && (
              <div style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: '#dc2626',
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: 4,
                padding: '8px 12px',
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="nrj-cancel-btn"
                onClick={onClose}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  letterSpacing: '0.04em',
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  borderRadius: 5,
                  padding: '10px 22px',
                  cursor: 'pointer',
                  color: 'var(--ink-soft, #6b6455)',
                }}
              >
                Cancel
              </button>
              <button
                className="nrj-submit-btn"
                onClick={() => void submit()}
                disabled={startDisabled}
                title={startTitle}
                data-testid="research-submit-btn"
                style={{
                  flex: 1,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  background: startDisabled ? 'var(--rule)' : 'var(--gold)',
                  color: startDisabled ? 'var(--ink-soft, #9b9080)' : 'var(--bg, #fff)',
                  border: 'none',
                  borderRadius: 5,
                  padding: '10px 0',
                  cursor: startDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {pending ? 'Creating…' : 'Start Research'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FieldLabel({ text, required, sub }: { text: string; required?: boolean; sub?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--ink-soft, #6b6455)',
      }}>
        {text}
        {required && <span style={{ color: 'var(--gold)', marginLeft: 2 }}>*</span>}
      </span>
      {sub && (
        <span style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          color: 'var(--ink-soft, #a09880)',
          letterSpacing: '0.04em',
        }}>
          {sub}
        </span>
      )}
    </div>
  );
}
