/**
 * Plan 08-03 Task 5 — Per-section thumbs-up/down chips for BriefingScreen.
 *
 * Wires BRIEF-05: each click writes a briefing_feedback row + a learning_signal
 * in one transaction (same-txn pattern per Task 3 decision tree). Visual
 * state is optimistic — local state flips immediately; IPC error reverts.
 *
 * Phase 9 Plan 03 — RE-SKINNED. ▲/▼ glyphs replace emoji thumbs; gold-tinted
 * active state matches the design-ref BriefingFeedbackChips. data-testid and
 * IPC call wiring are unchanged.
 */
import { useState } from 'react';

export interface BriefingFeedbackChipsProps {
  briefingDate: string;
  sectionKey: string;
}

export function BriefingFeedbackChips(props: BriefingFeedbackChipsProps): JSX.Element {
  const [picked, setPicked] = useState<-1 | 0 | 1>(0);

  async function fire(thumb: -1 | 1): Promise<void> {
    const prev = picked;
    setPicked(thumb);
    try {
      const r = await window.aria.briefingFeedback({
        briefingDate: props.briefingDate,
        sectionKey: props.sectionKey,
        thumb,
      });
      if (r && typeof r === 'object' && 'error' in r) {
        setPicked(prev); // revert
      }
    } catch {
      setPicked(prev);
    }
  }

  return (
    <span
      data-testid={`briefing-feedback-${props.sectionKey}`}
      style={{ display: 'inline-flex', gap: 4, marginLeft: 8, marginTop: 8, verticalAlign: 'middle' }}
      title="Helps Aria learn what matters in your briefing"
    >
      <button
        type="button"
        data-testid={`briefing-feedback-up-${props.sectionKey}`}
        aria-label="Thumbs up"
        onClick={() => void fire(1)}
        style={chipStyle(picked === 1)}
      >
        ▲
      </button>
      <button
        type="button"
        data-testid={`briefing-feedback-down-${props.sectionKey}`}
        aria-label="Thumbs down"
        onClick={() => void fire(-1)}
        style={chipStyle(picked === -1)}
      >
        ▼
      </button>
    </span>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    fontSize: 12,
    background: active ? 'rgba(184,134,11,0.10)' : 'transparent',
    color: active ? 'var(--gold-deep)' : 'var(--gray-soft)',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--rule)'}`,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'var(--f-mono)',
  };
}
