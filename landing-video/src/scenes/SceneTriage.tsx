import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { fadeIn, slideUp } from '../easing';

/**
 * SceneTriage — mirrors the real ApprovalsScreen.tsx:
 *   - h1 "Awaiting your call" + count + "Nothing leaves Aria without this page."
 *   - Filter row: pending / generating / ready / sending / interrupted / snoozed
 *   - Batch action bar (appears when one row is selected mid-scene)
 *   - Approval cards (email_send / task_batch / calendar_change)
 */
export const SceneTriage: React.FC = () => {
  const frame = useCurrentFrame(); // 0–209

  const sceneIn  = fadeIn(frame, 0, 15);
  const sceneOut = interpolate(frame, [175, 205], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity  = Math.min(sceneIn, sceneOut);

  const c = (start: number) => ({
    opacity: fadeIn(frame, start, 18),
    transform: `translateY(${slideUp(frame, start, 18)}px)`,
  });

  // The first card becomes "selected" mid-scene to demonstrate the batch bar.
  const cardSelected = frame >= 90;
  const batchBarOpacity = fadeIn(frame, 90, 14);
  const batchBarY       = slideUp(frame, 90, 14);

  return (
    <AbsoluteFill style={{ left: 256, top: 40, background: T.ivory, opacity }}>
      <div style={{
        maxWidth: 1180, margin: '0 auto',
        padding: '48px 56px 80px',
        color: T.ink,
      }}>
        {/* Header */}
        <header style={{
          ...c(8),
          display: 'flex', alignItems: 'baseline', gap: 16,
          paddingBottom: 16, marginBottom: 22,
          borderBottom: `1px solid ${T.rule}`,
          flexWrap: 'wrap',
        }}>
          <h1 style={{
            fontFamily: T.fDisplay, fontWeight: 500,
            fontSize: 44, letterSpacing: '-0.015em',
            margin: 0,
          }}>
            Awaiting your call
          </h1>
          <span style={{
            fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: T.graySoft,
          }}>
            3 of 4
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontFamily: T.fDisplay, fontStyle: 'italic',
            color: T.gray, fontSize: 16,
          }}>
            Nothing leaves Aria without this page.
          </span>
        </header>

        {/* Filter chips */}
        <div style={{
          ...c(16),
          display: 'flex', gap: 8, marginBottom: 18,
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{
            fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: T.graySoft, marginRight: 4,
          }}>Filter</span>
          {[
            { label: 'pending',     count: 3, active: true },
            { label: 'generating',  count: 0, active: true },
            { label: 'ready',       count: 1, active: true },
            { label: 'sending',     count: 0, active: true },
            { label: 'interrupted', count: 0, active: true },
            { label: 'snoozed',     count: 1, active: true },
          ].map((f) => (
            <FilterChip key={f.label} {...f} />
          ))}
        </div>

        {/* Batch action bar — appears once first card is "selected" */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          background: 'rgba(184,134,11,0.08)',
          border: `1px solid rgba(184,134,11,0.25)`,
          borderRadius: 6,
          marginBottom: 18,
          opacity: batchBarOpacity,
          transform: `translateY(${batchBarY}px)`,
        }}>
          <span style={{ fontSize: 14, color: T.ink }}>
            <strong>1</strong> selected ·{' '}
            <span style={{ color: T.gray }}>1 ready to approve</span>
          </span>
          <span style={{ flex: 1 }} />
          <ButtonPrimary>Batch approve</ButtonPrimary>
          <ButtonGhost>Clear</ButtonGhost>
        </div>

        {/* Approval queue */}
        <ApprovalCard
          c={c(28)}
          kind="EMAIL_SEND"
          state="ready"
          title="Re: Term sheet — drag-along language"
          recipient="marcus@aldridgeco.com"
          body={`Marcus,\n\nAgreed on 1.2× and the 7-year sunset. I will concede board composition.\nFor drag, hold at 60% — I want headroom for a strategic later.\n\nSee you this afternoon.\n\n— E`}
          flags={['VOICE MATCH 94%', 'FINANCIAL']}
          selected={cardSelected}
        />
        <ApprovalCard
          c={c(40)}
          kind="TASK_BATCH"
          state="pending"
          title="Push 4 new actions to Todoist"
          recipient="From: 2026-05-20 board prep transcript"
          body={`• Send revised side letter to Legal (you, Mon)\n• Confirm Q3 deck timeline with Sarah (you, Tue)\n• Schedule investor intro at Acme (you, Wed)\n• Brief board on drag-along rationale (you, Thu)`}
          flags={['INTEGRATIONS · TODOIST']}
        />
        <ApprovalCard
          c={c(52)}
          kind="CALENDAR_CHANGE"
          state="pending"
          title="Reschedule “Acme Q3 review” → Thursday 14:00"
          recipient="alex@aldridge.co · self-only"
          body={`Reason: Tuesday now has three back-to-back meetings with no buffer.\nThursday 14:00 has a 90-minute open slot before your travel block.`}
          flags={['SELF-ONLY · NON-RECURRING']}
        />
      </div>
    </AbsoluteFill>
  );
};

function FilterChip({ label, count, active }: { label: string; count: number; active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 999,
      fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
      letterSpacing: '0.1em', textTransform: 'uppercase',
      border: `1px solid ${active ? T.ink : T.rule}`,
      background: active ? T.ink : 'transparent',
      color: active ? T.ivory : T.gray,
    }}>
      {label} <span style={{ opacity: 0.7 }}>· {count}</span>
    </span>
  );
}

function ApprovalCard({
  c, kind, state, title, recipient, body, flags, selected,
}: {
  c: React.CSSProperties;
  kind: string;
  state: 'ready' | 'pending';
  title: string;
  recipient: string;
  body: string;
  flags: string[];
  selected?: boolean;
}) {
  return (
    <div style={{
      ...c,
      padding: '18px 22px',
      border: `1px solid ${selected ? T.gold : T.rule}`,
      borderRadius: 8,
      marginBottom: 14,
      background: selected ? 'rgba(184,134,11,0.04)' : T.paper,
      boxShadow: selected ? '0 0 0 3px rgba(184,134,11,0.10)' : 'none',
    }}>
      {/* Card head */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <Checkbox checked={!!selected} />
        <span style={{
          fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: T.gold,
        }}>{kind}</span>
        <StatePill state={state} />
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: T.fMono, fontSize: 10,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: T.graySoft,
        }}>
          2 min ago
        </span>
      </div>

      {/* Title + meta */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontFamily: T.fDisplay, fontSize: 20, fontWeight: 500,
          color: T.ink, letterSpacing: '-0.005em', marginBottom: 4,
        }}>{title}</div>
        <div style={{
          fontFamily: T.fMono, fontSize: 11, color: T.gray,
          letterSpacing: '0.06em',
        }}>{recipient}</div>
      </div>

      {/* Body excerpt */}
      <div style={{
        background: T.ivoryDeep,
        borderLeft: `2px solid ${T.rule}`,
        padding: '12px 16px',
        marginBottom: 12,
        fontFamily: 'Georgia, serif',
        fontSize: 14, lineHeight: 1.65,
        color: T.inkSoft, whiteSpace: 'pre-wrap',
      }}>
        {body}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ButtonPrimary>Approve</ButtonPrimary>
        <ButtonGhost>Reject</ButtonGhost>
        <ButtonGhost>Snooze</ButtonGhost>
        <span style={{ flex: 1 }} />
        {flags.map((f) => (
          <span key={f} style={{
            fontFamily: T.fMono, fontSize: 10,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: T.gold,
          }}>● {f}</span>
        ))}
      </div>
    </div>
  );
}

function StatePill({ state }: { state: 'ready' | 'pending' }) {
  const ready = state === 'ready';
  return (
    <span style={{
      fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
      letterSpacing: '0.16em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 4,
      color: ready ? T.goldDeep : T.gray,
      background: ready ? 'rgba(184,134,11,0.10)' : T.ivoryDeep,
      border: `1px solid ${ready ? 'rgba(184,134,11,0.25)' : T.rule}`,
    }}>{state}</span>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: 3,
      border: `1px solid ${checked ? T.gold : T.ruleStrong}`,
      background: checked ? T.gold : T.paper,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={T.ivory} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l4 4 10-10" />
        </svg>
      )}
    </div>
  );
}

function ButtonPrimary({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: T.gold, color: T.ivory,
      padding: '7px 14px', borderRadius: 6,
      fontFamily: T.fBody, fontSize: 13, fontWeight: 600,
      letterSpacing: '0.01em',
    }}>{children}</span>
  );
}

function ButtonGhost({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: 'transparent', color: T.ink,
      border: `1px solid ${T.ruleStrong}`,
      padding: '6px 13px', borderRadius: 6,
      fontFamily: T.fBody, fontSize: 13, fontWeight: 500,
    }}>{children}</span>
  );
}
