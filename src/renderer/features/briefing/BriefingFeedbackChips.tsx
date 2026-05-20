/**
 * Plan 08-03 Task 5 — Per-section thumbs-up/down chips for BriefingScreen.
 *
 * Wires BRIEF-05: each click writes a briefing_feedback row + a learning_signal
 * in one transaction (same-txn pattern per Task 3 decision tree). Visual
 * state is optimistic — local state flips immediately; IPC error reverts.
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
      style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}
    >
      <button
        type="button"
        data-testid={`briefing-feedback-up-${props.sectionKey}`}
        aria-label="Thumbs up"
        onClick={() => void fire(1)}
        style={chipStyle(picked === 1)}
      >
        👍
      </button>
      <button
        type="button"
        data-testid={`briefing-feedback-down-${props.sectionKey}`}
        aria-label="Thumbs down"
        onClick={() => void fire(-1)}
        style={chipStyle(picked === -1)}
      >
        👎
      </button>
    </span>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#dbeafe' : 'transparent',
    border: `1px solid ${active ? '#1d4ed8' : '#d1d5db'}`,
    borderRadius: 12,
    fontSize: 12,
    padding: '2px 8px',
    cursor: 'pointer',
  };
}
