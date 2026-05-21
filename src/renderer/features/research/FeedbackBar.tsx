/**
 * Phase 11 Plan 02 — FeedbackBar.
 * Thumbs up/down + optional note expander. Calls researchFeedbackSave IPC.
 * Pattern: BriefingFeedbackChips.tsx (exact analog).
 */
import { useState } from 'react';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface FeedbackBarProps {
  reportId: string;
  sectionId: string | null;
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
    transition: `all 120ms ${EASE_OUT}`,
  };
}

export function FeedbackBar({ reportId, sectionId }: FeedbackBarProps): JSX.Element {
  const [picked, setPicked] = useState<-1 | 0 | 1>(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  async function fire(thumb: -1 | 1): Promise<void> {
    const prev = picked;
    setPicked(thumb);
    try {
      const r = await window.aria.researchFeedbackSave({
        reportId,
        sectionId,
        thumb,
        note: null,
      });
      if (r && typeof r === 'object' && 'error' in r) setPicked(prev);
    } catch {
      setPicked(prev);
    }
  }

  async function saveNote(): Promise<void> {
    await window.aria.researchFeedbackSave({
      reportId,
      sectionId,
      thumb: picked !== 0 ? picked : null,
      note: note.trim() || null,
    }).catch(() => undefined);
    setNoteOpen(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
      <button
        style={chipStyle(picked === 1)}
        onClick={() => void fire(1)}
        aria-label="Helpful"
        title="Mark helpful"
      >
        ▲
      </button>
      <button
        style={chipStyle(picked === -1)}
        onClick={() => void fire(-1)}
        aria-label="Not helpful"
        title="Mark not helpful"
      >
        ▼
      </button>
      <button
        style={{
          background: 'none',
          border: 'none',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--gray-soft)',
          cursor: 'pointer',
          padding: '0 4px',
        }}
        onClick={() => setNoteOpen((o) => !o)}
      >
        {noteOpen ? 'Cancel' : 'Add note'}
      </button>
      {noteOpen && (
        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={1}
            style={{
              flex: 1,
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '3px 8px',
              background: 'var(--bg)',
              color: 'inherit',
              resize: 'none',
            }}
          />
          <button
            onClick={() => void saveNote()}
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              background: 'var(--gold)',
              color: 'var(--bg)',
              border: 'none',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
