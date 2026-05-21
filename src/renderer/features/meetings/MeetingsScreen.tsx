/**
 * MeetingsScreen — orchestrating container for /meetings.
 *
 * Design-ref `app-screen-meetings.jsx` shows two distinct states:
 *   - EMPTY → only the paste/upload form (no recent meetings yet)
 *   - POPULATED → 3-pane layout:
 *       LEFT  : "+ Paste / upload transcript" button + RECENT meetings list
 *       CENTER: selected meeting transcript view (NoteReviewScreen owns this)
 *       RIGHT : extracted actions panel (NoteReviewScreen owns this too)
 *
 * Phase 9 pixel-diff exposed that the prior implementation routed
 * /meetings → TranscriptCaptureScreen directly, with NoteReviewScreen orphaned
 * (no parent imported it). Classic verifier-blindspot pattern — 4th
 * occurrence in this project. This screen wires NoteReviewScreen via state
 * (the selected noteId) so users can actually open a parsed meeting.
 *
 * Re-skin invariant respected:
 *   - No new IPC, no DTO changes — uses existing transcriptListNotes
 *     + transcriptGetReview
 *   - Existing tests for TranscriptCaptureScreen + NoteReviewScreen
 *     continue to pass because both components are unchanged here
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TranscriptCaptureScreen } from './TranscriptCaptureScreen';
import { NoteReviewScreen } from './NoteReviewScreen';
import { SkeletonRoot, SkeletonLine } from '../../components/Skeleton';

type RecentNote = {
  noteId: string;
  title: string | null;
  source: string | null;
  createdAt: string | null;
  itemCount?: number | null;
};

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function formatRecentDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}

export function MeetingsScreen(): JSX.Element {
  const [recent, setRecent] = useState<RecentNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [showPasteForm, setShowPasteForm] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const fn = (window as { aria?: { transcriptListNotes?: typeof window.aria.transcriptListNotes } })
        .aria?.transcriptListNotes;
      if (!fn) {
        setLoaded(true);
        return;
      }
      const res = await fn();
      if (!isErr(res) && res && 'rows' in res) {
        const rows = (res.rows as RecentNote[]) ?? [];
        setRecent(rows);
        if (rows.length > 0 && !selectedNoteId) {
          setSelectedNoteId(rows[0].noteId);
        }
      }
    } catch {
      /* keep empty */
    }
    setLoaded(true);
  }, [selectedNoteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isEmpty = useMemo(() => loaded && recent.length === 0, [loaded, recent.length]);

  // ── Empty state — only the paste/upload form ───────────────────────────
  if (!loaded) {
    return (
      <section data-testid="meetings-loading" style={{ padding: '32px 40px', maxWidth: '52rem' }}>
        <SkeletonRoot style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SkeletonLine width={100} height={10} />
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr',
                gap: 12,
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <SkeletonLine width={44} height={44} style={{ borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <SkeletonLine width={`${60 + (i % 3) * 15}%`} height={14} />
                <SkeletonLine width={`${35 + (i % 2) * 20}%`} height={11} />
              </div>
            </div>
          ))}
        </SkeletonRoot>
      </section>
    );
  }

  if (isEmpty || showPasteForm) {
    return (
      <section
        data-testid="meetings-screen"
        style={{
          padding: '24px 32px 80px',
          color: 'var(--ink)',
          background: 'var(--ivory)',
          minHeight: '100%',
        }}
      >
        {!isEmpty && (
          <div style={{ marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => setShowPasteForm(false)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--gold-deep)',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              ← Back to meetings
            </button>
          </div>
        )}
        <TranscriptCaptureScreen
          onIngested={() => {
            setShowPasteForm(false);
            void refresh();
          }}
        />
      </section>
    );
  }

  // ── Populated state — 3-pane layout ────────────────────────────────────
  return (
    <section
      data-testid="meetings-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 280px) 1fr',
        gap: 0,
        color: 'var(--ink)',
        background: 'var(--ivory)',
        minHeight: '100%',
      }}
    >
      {/* Left rail — paste-new button + recent list */}
      <aside
        style={{
          padding: '24px 20px',
          borderRight: '1px solid var(--rule)',
          background: 'var(--ivory)',
        }}
      >
        <button
          type="button"
          data-testid="meetings-paste-new"
          onClick={() => setShowPasteForm(true)}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 13.5,
            fontFamily: 'var(--f-body)',
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--paper)',
            background: 'var(--gold)',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            transition:
              'background 200ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
            marginBottom: 22,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gold-deep)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gold)')}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          + Paste / upload transcript
        </button>

        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            marginBottom: 12,
          }}
        >
          Recent
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {recent.map((row) => {
            const isSelected = row.noteId === selectedNoteId;
            return (
              <li key={row.noteId}>
                <button
                  type="button"
                  data-testid={`meetings-recent-${row.noteId}`}
                  onClick={() => setSelectedNoteId(row.noteId)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 12px',
                    border: '1px solid transparent',
                    background: isSelected ? 'var(--paper)' : 'transparent',
                    borderColor: isSelected ? 'var(--rule-strong)' : 'transparent',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    transition: 'background 160ms ease, border-color 160ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(184,134,11,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontSize: 14.5,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      lineHeight: 1.3,
                      marginBottom: 4,
                    }}
                  >
                    {row.title ?? '(untitled)'}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10.5,
                      color: 'var(--gray)',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {formatRecentDate(row.createdAt)}
                    {row.source ? ` · ${row.source}` : ''}
                    {row.itemCount != null ? ` · ${row.itemCount} items` : ''}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <p
          style={{
            marginTop: 28,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
          }}
        >
          Aria does not join calls.
        </p>
      </aside>

      {/* Center + right — handled by NoteReviewScreen's 2-column internal layout */}
      <div style={{ minWidth: 0, overflowY: 'auto' }}>
        {selectedNoteId ? (
          <NoteReviewScreen noteId={selectedNoteId} />
        ) : (
          <div
            style={{
              padding: '64px 40px',
              textAlign: 'center',
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              color: 'var(--gray)',
            }}
          >
            Select a meeting from the list, or paste a new transcript.
          </div>
        )}
      </div>
    </section>
  );
}
