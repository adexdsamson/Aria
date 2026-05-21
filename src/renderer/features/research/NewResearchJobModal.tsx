/**
 * Phase 11 Plan 02 — NewResearchJobModal.
 * Slide-over panel from right. Fields: title, goals, domains, scheduleInterval.
 * Start Research disabled when both Brave and Exa keys absent (RES-08 / D-01).
 * Pattern: SchedulingChat.tsx (slide-over + submit).
 */
import { useEffect, useState } from 'react';
import type { ResearchJobDto } from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface NewResearchJobModalProps {
  onClose: () => void;
  onCreated: (job: ResearchJobDto) => void;
}

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function NewResearchJobModal({ onClose, onCreated }: NewResearchJobModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [domainsRaw, setDomainsRaw] = useState('');
  const [scheduleInterval, setScheduleInterval] = useState<'none' | 'daily' | 'weekly'>('none');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKeys, setHasKeys] = useState<boolean | null>(null);

  useEffect(() => {
    void window.aria.researchSecretsHas({}).then((r) => {
      if (!isErr(r)) {
        setHasKeys(r.hasBrave || r.hasExa);
      }
    });
  }, []);

  async function submit(): Promise<void> {
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const domains = domainsRaw
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const res = await window.aria.researchJobCreate({ title: title.trim(), goals, domains, scheduleInterval });
      if (isErr(res)) {
        setError(res.error);
        return;
      }
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
    ? 'Add Brave or Exa API key in Settings → Integrations'
    : undefined;

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: none; }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
        }}
        onClick={onClose}
      >
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 440,
            background: 'var(--bg)',
            padding: 32,
            overflowY: 'auto',
            animation: `slideIn 220ms ${EASE_OUT}`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 8,
            }}
          >
            New Research Job
          </div>
          <h2
            style={{
              fontFamily: 'var(--f-serif)',
              fontSize: 22,
              fontWeight: 500,
              margin: '0 0 24px',
            }}
          >
            Start a research job
          </h2>

          <label style={labelStyle}>Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you researching?"
            style={inputStyle}
          />

          <label style={labelStyle}>Goals</label>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="What do you want to learn? What decision does this inform?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          <label style={labelStyle}>Domains (comma-separated)</label>
          <input
            type="text"
            value={domainsRaw}
            onChange={(e) => setDomainsRaw(e.target.value)}
            placeholder="e.g. techcrunch.com, reuters.com"
            style={inputStyle}
          />

          <label style={labelStyle}>Schedule</label>
          <select
            value={scheduleInterval}
            onChange={(e) => setScheduleInterval(e.target.value as 'none' | 'daily' | 'weekly')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="none">One-time (no repeat)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>

          {error && (
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: '#c0392b',
                marginBottom: 12,
                padding: '8px 12px',
                border: '1px solid #c0392b',
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                background: 'none',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '10px 0',
                cursor: 'pointer',
                color: 'var(--gray-soft)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={startDisabled}
              title={startTitle}
              style={{
                flex: 1,
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                background: startDisabled ? 'var(--rule)' : 'var(--gold)',
                color: startDisabled ? 'var(--gray-soft)' : 'var(--bg)',
                border: 'none',
                borderRadius: 4,
                padding: '10px 0',
                cursor: startDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {pending ? 'Creating…' : 'Start Research'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  color: 'var(--gray-soft)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  marginBottom: 4,
  marginTop: 16,
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'var(--f-mono)',
  fontSize: 13,
  border: '1px solid var(--rule)',
  borderRadius: 4,
  padding: '8px 12px',
  background: 'var(--bg)',
  color: 'inherit',
  marginBottom: 0,
};
